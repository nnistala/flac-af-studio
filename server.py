import os
import sys
import asyncio
import re
import json
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from urllib.parse import unquote, quote
from collections import deque

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, Request, Response
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import mutagen
from mutagen.mp4 import MP4
from mutagen.flac import FLAC
from mutagen.mp3 import MP3

from SpotiFLAC.core.spotify_metadata import SpotifyMetadataClient, parse_spotify_url

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("HiResRip")

BASE_DIR = Path(__file__).resolve().parent
DOWNLOADS_DIR = Path(os.environ.get("FLAC_DOWNLOADS_DIR", BASE_DIR / "downloads"))
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR = BASE_DIR / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

REGISTRY_URL = "https://raw.githubusercontent.com/spotiflacapp/spotiflac-extension/main/registry.json"

app = FastAPI(title="Flac AF · Hi-Res Lossless Studio", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

metadata_client = SpotifyMetadataClient()

# In-memory log buffer (stores last 1000 lines)
global_logs = deque(maxlen=1000)

def add_log(msg: str):
    logger.info(msg)
    global_logs.append(msg)

class DownloadItem(BaseModel):
    id: str
    url: str
    title: str
    artist: str
    album: str = ""
    cover_url: str = ""
    folder_name: str = ""
    status: str = "queued"  # queued, downloading, tagging, completed, failed
    progress: int = 0
    provider: str = ""
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    error: Optional[str] = None
    duration_str: str = ""
    added_at: float = 0.0
    logs: List[str] = []

download_queue: Dict[str, DownloadItem] = {}
queue_order: List[str] = []
queue_lock = asyncio.Lock()
worker_running = False

def normalize_text(text: str) -> str:
    """Normalize text for fuzzy title/artist matching."""
    if not text:
        return ""
    s = re.sub(r"\(.*?\)|\[.*?\]", "", text.lower())
    s = re.sub(r"[^\w\s]", "", s)
    return " ".join(s.split())

def sanitize_folder_name(name: str) -> str:
    """Sanitize string for use as a folder/directory name."""
    if not name:
        return ""
    clean = re.sub(r'[<>:"/\\|?*]', '_', name.strip())
    clean = re.sub(r'\s+', ' ', clean)
    clean = clean.strip(". ")
    return clean[:120]

def scan_local_library() -> List[Dict[str, Any]]:
    """Scan the downloads directory recursively and return metadata of all audio files."""
    tracks = []
    if not DOWNLOADS_DIR.exists():
        return tracks

    audio_exts = {".flac", ".m4a", ".mp3", ".wav", ".alac"}
    for file in sorted(DOWNLOADS_DIR.rglob("*.*")):
        if file.suffix.lower() not in audio_exts or not file.is_file():
            continue

        try:
            rel_path = file.relative_to(DOWNLOADS_DIR).as_posix()
        except Exception:
            rel_path = file.name

        folder_name = file.parent.name if file.parent != DOWNLOADS_DIR else ""

        item = {
            "file_name": file.name,
            "rel_path": rel_path,
            "folder": folder_name,
            "path": str(file),
            "size_bytes": file.stat().st_size,
            "size_mb": round(file.stat().st_size / (1024 * 1024), 2),
            "modified_time": file.stat().st_mtime,
            "format": file.suffix.lower().replace(".", "").upper(),
            "title": file.stem,
            "artist": "Unknown Artist",
            "album": folder_name or "",
            "year": "",
            "duration_sec": 0,
            "bitrate_kbps": 0,
            "samplerate_hz": 44100,
            "is_lossless": True,
            "stream_url": f"/api/stream/{quote(rel_path)}",
            "cover_url": "",
        }

        try:
            audio = mutagen.File(str(file))
            if audio is not None:
                if hasattr(audio, "info"):
                    info = audio.info
                    item["duration_sec"] = int(getattr(info, "length", 0))
                    item["samplerate_hz"] = getattr(info, "sample_rate", 44100)
                    bitrate = getattr(info, "bitrate", 0)
                    if bitrate:
                        item["bitrate_kbps"] = int(bitrate / 1000)
                    elif item["size_bytes"] and item["duration_sec"]:
                        item["bitrate_kbps"] = int((item["size_bytes"] * 8) / (item["duration_sec"] * 1000))

                # Tags parsing
                if isinstance(audio, MP4):
                    tags = audio.tags or {}
                    if "©nam" in tags:
                        item["title"] = str(tags["©nam"][0])
                    if "©ART" in tags:
                        item["artist"] = str(tags["©ART"][0])
                    if "©alb" in tags:
                        item["album"] = str(tags["©alb"][0])
                    if "©day" in tags:
                        item["year"] = str(tags["©day"][0])
                    if not item["duration_sec"] and "----:com.apple.iTunes:DURATIONMS" in tags:
                        try:
                            d_ms = int(bytes(tags["----:com.apple.iTunes:DURATIONMS"][0]))
                            item["duration_sec"] = int(d_ms / 1000)
                        except Exception:
                            pass
                elif isinstance(audio, FLAC):
                    tags = audio.tags or {}
                    if "title" in tags:
                        item["title"] = str(tags["title"][0])
                    if "artist" in tags:
                        item["artist"] = str(tags["artist"][0])
                    if "album" in tags:
                        item["album"] = str(tags["album"][0])
                    if "date" in tags:
                        item["year"] = str(tags["date"][0])
                elif isinstance(audio, MP3):
                    tags = audio.tags or {}
                    if "TIT2" in tags:
                        item["title"] = str(tags["TIT2"].text[0])
                    if "TPE1" in tags:
                        item["artist"] = str(tags["TPE1"].text[0])
                    if "TALB" in tags:
                        item["album"] = str(tags["TALB"].text[0])
                    if "TDRC" in tags:
                        item["year"] = str(tags["TDRC"].text[0])
                    item["is_lossless"] = False

                # Detect embedded cover art
                has_cover = False
                if hasattr(audio, "pictures") and audio.pictures:
                    has_cover = True
                elif hasattr(audio, "tags") and audio.tags:
                    if "covr" in audio.tags and audio.tags["covr"]:
                        has_cover = True
                    elif hasattr(audio.tags, "getall") and audio.tags.getall("APIC"):
                        has_cover = True

                if has_cover:
                    item["cover_url"] = f"/api/cover/{quote(rel_path)}"
        except Exception as e:
            logger.warning(f"Failed parsing tags for {file.name}: {e}")

        # Fallback cover from folder image if no embedded artwork
        if not item.get("cover_url") and file.parent != DOWNLOADS_DIR:
            for img_name in ("cover.jpg", "cover.png", "folder.jpg", "front.jpg"):
                cand = file.parent / img_name
                if cand.is_file():
                    img_rel = cand.relative_to(DOWNLOADS_DIR).as_posix()
                    item["cover_url"] = f"/api/cover/{quote(img_rel)}"
                    break

        tracks.append(item)
    return tracks

def is_track_in_library(title: str, artist: str, local_tracks: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Check if title and artist match any local file."""
    norm_title = normalize_text(title)
    norm_artist = normalize_text(artist)
    if not norm_title:
        return None

    for track in local_tracks:
        track_norm_title = normalize_text(track.get("title", ""))
        track_norm_artist = normalize_text(track.get("artist", ""))

        if norm_title == track_norm_title:
            if not norm_artist or not track_norm_artist or norm_artist in track_norm_artist or track_norm_artist in norm_artist:
                return track

        file_norm = normalize_text(track.get("file_name", ""))
        if norm_title in file_norm:
            if not norm_artist or norm_artist in file_norm:
                return track

    return None

async def download_worker_loop():
    """Background worker processing download queue items with multi-provider fallbacks and real verification."""
    global worker_running
    worker_running = True
    add_log("[Worker] Download worker started with multi-provider fallback engine.")

    while True:
        target_item = None
        async with queue_lock:
            for item_id in queue_order:
                item = download_queue.get(item_id)
                if item and item.status == "queued":
                    target_item = item
                    break

        if not target_item:
            await asyncio.sleep(1.0)
            continue

        item_id = target_item.id
        add_log(f"[Download] Starting download for: {target_item.title} — {target_item.artist}")
        
        async with queue_lock:
            download_queue[item_id].status = "downloading"
            download_queue[item_id].progress = 10
            download_queue[item_id].logs.append(f"Starting download for {target_item.title}")

        target_dest = DOWNLOADS_DIR
        if target_item.folder_name:
            safe_folder = sanitize_folder_name(target_item.folder_name)
            if safe_folder:
                target_dest = DOWNLOADS_DIR / safe_folder
                target_dest.mkdir(parents=True, exist_ok=True)

        try:
            env = os.environ.copy()
            env["SPOTIFLAC_REGISTRIES"] = REGISTRY_URL
            env["PATH"] = f"/opt/homebrew/bin:/usr/local/bin:{env.get('PATH', '')}"

            # Pass multi-provider fallbacks: Tidal -> Qobuz -> Amazon -> Deezer
            cmd = [
                sys.executable,
                "-m",
                "SpotiFLAC",
                "--verbose",
                "--service",
                "ext:tidal-web",
                "ext:qobuz-web",
                "ext:amazon",
                "ext:deezer",
                "--fallback",
                target_item.url,
                str(target_dest),
            ]

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )

            current_provider = "Resolving Providers..."
            downloaded_file = None
            is_successful = False
            failure_reason = None

            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                decoded = line.decode("utf-8", errors="replace").strip()
                if decoded:
                    # Clean ANSI terminal escape codes
                    clean_line = re.sub(r'\x1b\[[0-9;]*[mGKH]', '', decoded).strip()
                    if clean_line:
                        add_log(f"[{target_item.title[:15]}] {clean_line}")
                        async with queue_lock:
                            download_queue[item_id].logs.append(clean_line)
                            if len(download_queue[item_id].logs) > 200:
                                download_queue[item_id].logs.pop(0)

                    # Track provider attempts
                    if "EXT:TIDAL" in clean_line.upper():
                        current_provider = "TIDAL FLAC"
                    elif "EXT:QOBUZ" in clean_line.upper():
                        current_provider = "QOBUZ Hi-Res"
                    elif "EXT:AMAZON" in clean_line.upper():
                        current_provider = "Amazon Ultra HD"
                    elif "EXT:DEEZER" in clean_line.upper():
                        current_provider = "Deezer FLAC"

                    if "tags written:" in clean_line:
                        fname = clean_line.split("tags written:")[-1].strip()
                        downloaded_file = fname
                        is_successful = True
                        async with queue_lock:
                            download_queue[item_id].progress = 90
                            download_queue[item_id].status = "tagging"

                    if "Successful    : 1" in clean_line or "✓" in clean_line:
                        is_successful = True

                    if "All providers fail" in clean_line:
                        failure_reason = "All lossless providers failed (track may not be on Tidal, Qobuz, or Amazon)"
                    elif "Wrong track: different recording" in clean_line:
                        failure_reason = "Recording mismatch / ISRC restricted on streaming providers"
                    elif "FAILED" in clean_line.upper() and not is_successful:
                        failure_reason = clean_line

                    if "Progress:" in clean_line:
                        async with queue_lock:
                            download_queue[item_id].progress = min(85, download_queue[item_id].progress + 5)

            await proc.wait()

            # Double check disk for downloaded file
            local_tracks = scan_local_library()
            matched = is_track_in_library(target_item.title, target_item.artist, local_tracks)
            if matched:
                downloaded_file = matched.get("rel_path") or matched["file_name"]
                is_successful = True
            elif downloaded_file and target_item.folder_name:
                downloaded_file = f"{sanitize_folder_name(target_item.folder_name)}/{Path(downloaded_file).name}"

            if is_successful and downloaded_file:
                async with queue_lock:
                    download_queue[item_id].status = "completed"
                    download_queue[item_id].progress = 100
                    download_queue[item_id].provider = current_provider
                    download_queue[item_id].file_name = downloaded_file
                    download_queue[item_id].file_path = str(DOWNLOADS_DIR / downloaded_file)
                    download_queue[item_id].logs.append(f"✓ Saved: {downloaded_file}")
                add_log(f"[✓] Download completed: {downloaded_file}")
            else:
                reason = failure_reason or f"Track not found in lossless catalogs (exit code {proc.returncode})"
                async with queue_lock:
                    download_queue[item_id].status = "failed"
                    download_queue[item_id].error = reason
                    download_queue[item_id].logs.append(f"✗ Failed: {reason}")
                add_log(f"[✗] Download failed for {target_item.title}: {reason}")

        except Exception as exc:
            logger.exception(f"Error during download for {target_item.title}: {exc}")
            async with queue_lock:
                download_queue[item_id].status = "failed"
                download_queue[item_id].error = str(exc)

        await asyncio.sleep(0.5)

@app.on_event("startup")
async def on_startup():
    asyncio.create_task(download_worker_loop())

# --- API Endpoints ---

@app.get("/api/logs")
async def get_recent_logs():
    """Return recent global log lines."""
    return {"logs": list(global_logs)}

@app.get("/api/logs/{item_id}")
async def get_item_logs(item_id: str):
    """Return logs for a specific download item."""
    async with queue_lock:
        item = download_queue.get(item_id)
        if not item:
            raise HTTPException(status_code=404, detail="Item not found")
        return {"id": item_id, "title": item.title, "logs": item.logs}

@app.post("/api/logs/clear")
async def clear_system_logs():
    """Clear all stored terminal logs."""
    global_logs.clear()
    return {"status": "cleared"}

@app.get("/api/search")
async def search_tracks_and_albums(q: str = Query(..., min_length=1)):
    """Search Spotify for tracks and albums, and cross-reference with local downloads."""
    query = q.strip()
    local_tracks = scan_local_library()

    # Check if user entered a direct Spotify URL
    if "open.spotify.com" in query or "spotify:" in query:
        try:
            parsed = parse_spotify_url(query)
            entity_type = parsed.get("type")
            entity_id = parsed.get("id")

            if entity_type == "track":
                track_meta = await metadata_client.get_track_async(entity_id)
                if track_meta:
                    in_lib = is_track_in_library(track_meta.title, track_meta.artists, local_tracks)
                    return {
                        "is_direct_url": True,
                        "type": "track",
                        "tracks": [{
                            "id": track_meta.id,
                            "title": track_meta.title,
                            "artists": track_meta.artists,
                            "album": track_meta.album,
                            "duration_ms": track_meta.duration_ms,
                            "cover_url": track_meta.cover_url,
                            "external_url": track_meta.external_url or query,
                            "in_library": in_lib is not None,
                            "local_file": in_lib["file_name"] if in_lib else None,
                        }],
                        "albums": []
                    }
            elif entity_type in ("album", "playlist"):
                album_res = await metadata_client.get_album_tracks_async(entity_id)
                if isinstance(album_res, tuple) and len(album_res) == 2:
                    album_info, album_tracks = album_res
                else:
                    album_info = {}
                    album_tracks = album_res if isinstance(album_res, list) else []

                tracks_out = []
                for t in album_tracks:
                    title = getattr(t, "title", t.get("title") if isinstance(t, dict) else "")
                    artists = getattr(t, "artists", t.get("artists") if isinstance(t, dict) else "")
                    album = getattr(t, "album", t.get("album") if isinstance(t, dict) else "")
                    track_number = getattr(t, "track_number", t.get("track_number") if isinstance(t, dict) else 1)
                    duration_ms = getattr(t, "duration_ms", t.get("duration_ms") if isinstance(t, dict) else 0)
                    cover_url = getattr(t, "cover_url", t.get("cover_url") if isinstance(t, dict) else "")
                    external_url = getattr(t, "external_url", t.get("external_url") if isinstance(t, dict) else "")
                    t_id = getattr(t, "id", t.get("id") if isinstance(t, dict) else "")

                    in_lib = is_track_in_library(title, artists, local_tracks)
                    tracks_out.append({
                        "id": t_id,
                        "title": title,
                        "artists": artists,
                        "album": album,
                        "track_number": track_number,
                        "duration_ms": duration_ms,
                        "cover_url": cover_url,
                        "external_url": external_url,
                        "in_library": in_lib is not None,
                        "local_file": in_lib["file_name"] if in_lib else None,
                    })
                
                album_name = album_info.get("name") if isinstance(album_info, dict) else "Album"
                cover_url = album_info.get("cover_url") if isinstance(album_info, dict) else ""
                if not cover_url and tracks_out:
                    cover_url = tracks_out[0].get("cover_url", "")
                artist_name = album_info.get("artists") if isinstance(album_info, dict) else ""
                if not artist_name and tracks_out:
                    artist_name = tracks_out[0].get("artists", "")

                return {
                    "is_direct_url": True,
                    "type": "album",
                    "album_details": {
                        "id": entity_id,
                        "name": album_name,
                        "artists": artist_name,
                        "cover_url": cover_url,
                        "external_url": query,
                        "tracks": tracks_out
                    },
                    "tracks": tracks_out,
                    "albums": []
                }
        except Exception as e:
            logger.warning(f"Direct URL resolution failed for {query}: {e}")

    # Standard textual search
    try:
        results = await metadata_client.search_async(query, limit=12)
        tracks_data = []
        for t in results.get("tracks", []):
            title = getattr(t, "title", t.get("title") if isinstance(t, dict) else "")
            artists = getattr(t, "artists", t.get("artists") if isinstance(t, dict) else "")
            album = getattr(t, "album", t.get("album") if isinstance(t, dict) else "")
            duration_ms = getattr(t, "duration_ms", t.get("duration_ms") if isinstance(t, dict) else 0)
            cover_url = getattr(t, "cover_url", t.get("cover_url") if isinstance(t, dict) else "")
            external_url = getattr(t, "external_url", t.get("external_url") if isinstance(t, dict) else "")
            t_id = getattr(t, "id", t.get("id") if isinstance(t, dict) else "")

            in_lib = is_track_in_library(title, artists, local_tracks)
            tracks_data.append({
                "id": t_id,
                "title": title,
                "artists": artists,
                "album": album,
                "duration_ms": duration_ms,
                "cover_url": cover_url,
                "external_url": external_url,
                "in_library": in_lib is not None,
                "local_file": in_lib["file_name"] if in_lib else None,
            })

        albums_data = []
        for a in results.get("albums", []):
            albums_data.append({
                "id": getattr(a, "id", a.get("id") if isinstance(a, dict) else ""),
                "name": getattr(a, "name", a.get("name") if isinstance(a, dict) else ""),
                "artists": getattr(a, "artists", a.get("artists") if isinstance(a, dict) else ""),
                "release_date": getattr(a, "release_date", a.get("release_date") if isinstance(a, dict) else ""),
                "cover_url": getattr(a, "cover_url", a.get("cover_url") if isinstance(a, dict) else ""),
                "external_url": getattr(a, "external_url", a.get("external_url") if isinstance(a, dict) else ""),
            })

        return {
            "is_direct_url": False,
            "tracks": tracks_data,
            "albums": albums_data,
        }
    except Exception as e:
        logger.error(f"Search error for {query}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/album/{album_id}")
async def get_album_details(album_id: str):
    """Retrieve full album tracklist and check local library status."""
    try:
        album_res = await metadata_client.get_album_tracks_async(album_id)
        if not album_res:
            raise HTTPException(status_code=404, detail="Album not found")

        if isinstance(album_res, tuple) and len(album_res) == 2:
            album_info, album_tracks = album_res
        else:
            album_info = {}
            album_tracks = album_res if isinstance(album_res, list) else []

        if not album_tracks:
            raise HTTPException(status_code=404, detail="No tracks found for this album")

        local_tracks = scan_local_library()
        tracks_out = []
        downloaded_count = 0

        for idx, t in enumerate(album_tracks):
            title = getattr(t, "title", t.get("title") if isinstance(t, dict) else "")
            artists = getattr(t, "artists", t.get("artists") if isinstance(t, dict) else "")
            album = getattr(t, "album", t.get("album") if isinstance(t, dict) else "")
            track_num = getattr(t, "track_number", t.get("track_number") if isinstance(t, dict) else idx + 1)
            duration_ms = getattr(t, "duration_ms", t.get("duration_ms") if isinstance(t, dict) else 0)
            cover_url = getattr(t, "cover_url", t.get("cover_url") if isinstance(t, dict) else "")
            external_url = getattr(t, "external_url", t.get("external_url") if isinstance(t, dict) else "")
            t_id = getattr(t, "id", t.get("id") if isinstance(t, dict) else "")

            in_lib = is_track_in_library(title, artists, local_tracks)
            if in_lib:
                downloaded_count += 1

            tracks_out.append({
                "id": t_id,
                "title": title,
                "artists": artists,
                "album": album,
                "track_number": track_num,
                "duration_ms": duration_ms,
                "cover_url": cover_url,
                "external_url": external_url,
                "in_library": in_lib is not None,
                "local_file": in_lib["file_name"] if in_lib else None,
            })

        album_name = album_info.get("name") if isinstance(album_info, dict) else "Album"
        cover_url = album_info.get("cover_url") if isinstance(album_info, dict) else ""
        if not cover_url and tracks_out:
            cover_url = tracks_out[0].get("cover_url", "")
        artist_name = album_info.get("artists") if isinstance(album_info, dict) else ""
        if not artist_name and tracks_out:
            artist_name = tracks_out[0].get("artists", "")

        return {
            "id": album_id,
            "name": album_name,
            "artists": artist_name,
            "cover_url": cover_url,
            "external_url": f"https://open.spotify.com/album/{album_id}",
            "total_tracks": len(tracks_out),
            "downloaded_count": downloaded_count,
            "tracks": tracks_out,
        }
    except Exception as e:
        logger.error(f"Error fetching album {album_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/library")
async def get_library(q: Optional[str] = None):
    """Get all downloaded tracks in local library with optional search filter."""
    tracks = scan_local_library()
    if q and q.strip():
        query = normalize_text(q)
        tracks = [
            t for t in tracks
            if query in normalize_text(t["title"])
            or query in normalize_text(t["artist"])
            or query in normalize_text(t["album"])
            or query in normalize_text(t["file_name"])
        ]
    return {
        "count": len(tracks),
        "downloads_dir": str(DOWNLOADS_DIR),
        "tracks": tracks
    }

class DownloadRequest(BaseModel):
    url: str
    title: str
    artist: str
    album: Optional[str] = ""
    cover_url: Optional[str] = ""
    folder_name: Optional[str] = ""
    force: bool = False

@app.post("/api/download")
async def queue_download(req: DownloadRequest):
    """Queue a single track for download if not already in library."""
    local_tracks = scan_local_library()
    existing = is_track_in_library(req.title, req.artist, local_tracks)

    if existing and not req.force:
        return {
            "status": "already_exists",
            "message": "Track is already in your local library!",
            "local_file": existing["file_name"],
            "stream_url": existing["stream_url"]
        }

    item_id = f"item_{int(asyncio.get_event_loop().time() * 1000)}_{abs(hash(req.url)) % 10000}"
    item = DownloadItem(
        id=item_id,
        url=req.url,
        title=req.title,
        artist=req.artist,
        album=req.album or "",
        cover_url=req.cover_url or "",
        folder_name=sanitize_folder_name(req.folder_name) if req.folder_name else "",
        status="queued",
        progress=0,
        added_at=asyncio.get_event_loop().time(),
        logs=[f"Queued {req.title}"]
    )

    async with queue_lock:
        download_queue[item_id] = item
        queue_order.append(item_id)

    add_log(f"[Queue] Queued: {req.title} — {req.artist}")

    return {
        "status": "queued",
        "queue_id": item_id,
        "message": f"Queued {req.title} for download"
    }

class AlbumDownloadRequest(BaseModel):
    tracks: List[DownloadRequest]
    folder_name: Optional[str] = ""
    album_title: Optional[str] = ""
    artist_name: Optional[str] = ""
    force: bool = False

@app.post("/api/download-album")
@app.post("/api/download-batch")
async def queue_album_download(req: AlbumDownloadRequest):
    """Queue tracks of an album/playlist into a dedicated folder, skipping already downloaded songs unless forced."""
    local_tracks = scan_local_library()
    queued_count = 0
    skipped_count = 0

    # Auto-resolve folder name when ripping multiple tracks (>1 file)
    default_folder = req.folder_name or ""
    if not default_folder and len(req.tracks) > 1:
        if req.album_title:
            default_folder = f"{req.artist_name} - {req.album_title}" if req.artist_name else req.album_title
        elif req.tracks and req.tracks[0].album:
            t0 = req.tracks[0]
            default_folder = f"{t0.artist} - {t0.album}" if t0.artist and t0.album else (t0.album or "")

    for track in req.tracks:
        existing = is_track_in_library(track.title, track.artist, local_tracks)
        if existing and not req.force:
            skipped_count += 1
            continue

        track_folder = track.folder_name or default_folder
        if not track_folder and len(req.tracks) > 1 and track.album:
            track_folder = f"{track.artist} - {track.album}" if track.artist else track.album

        item_id = f"item_{int(asyncio.get_event_loop().time() * 1000)}_{abs(hash(track.url)) % 10000}"
        item = DownloadItem(
            id=item_id,
            url=track.url,
            title=track.title,
            artist=track.artist,
            album=track.album or "",
            cover_url=track.cover_url or "",
            folder_name=sanitize_folder_name(track_folder),
            status="queued",
            progress=0,
            added_at=asyncio.get_event_loop().time(),
            logs=[f"Queued track: {track.title}" + (f" -> [{track_folder}]" if track_folder else "")]
        )

        async with queue_lock:
            download_queue[item_id] = item
            queue_order.append(item_id)
        queued_count += 1

    add_log(f"[Queue] Queued rip batch: {queued_count} tracks ({skipped_count} skipped/already in library)")

    return {
        "status": "queued",
        "queued_count": queued_count,
        "skipped_count": skipped_count,
        "folder": default_folder,
        "message": f"Queued {queued_count} tracks ({skipped_count} already in library)"
    }

@app.get("/api/queue")
async def get_download_queue():
    """Retrieve current download queue and recent history."""
    async with queue_lock:
        items = [download_queue[item_id].dict() for item_id in reversed(queue_order)]
    return {
        "active": [i for i in items if i["status"] in ("queued", "downloading", "tagging")],
        "history": [i for i in items if i["status"] in ("completed", "failed", "skipped")],
        "all": items
    }

@app.post("/api/queue/clear")
async def clear_queue_history():
    """Clear completed/failed items from queue."""
    global queue_order
    async with queue_lock:
        new_order = []
        for item_id in queue_order:
            item = download_queue.get(item_id)
            if item and item.status in ("queued", "downloading", "tagging"):
                new_order.append(item_id)
            else:
                download_queue.pop(item_id, None)
        queue_order = new_order
    return {"status": "cleared"}

@app.get("/api/stream/{file_path:path}")
@app.head("/api/stream/{file_path:path}")
async def stream_audio_file(file_path: str, request: Request):
    """Stream audio file with HTTP Range support for seeking and preview."""
    rel_path = unquote(file_path).lstrip("/\\")
    target_path = (DOWNLOADS_DIR / rel_path).resolve()
    base_path = DOWNLOADS_DIR.resolve()
    if not str(target_path).startswith(str(base_path)) or not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    file_size = target_path.stat().st_size
    range_header = request.headers.get("Range")

    content_type = "audio/flac" if target_path.suffix.lower() == ".flac" else "audio/mp4"

    if range_header:
        byte_range = range_header.replace("bytes=", "").split("-")
        start = int(byte_range[0]) if byte_range[0] else 0
        end = int(byte_range[1]) if len(byte_range) > 1 and byte_range[1] else file_size - 1
        length = end - start + 1

        def iterfile():
            with open(target_path, "rb") as f:
                f.seek(start)
                bytes_left = length
                chunk_size = 64 * 1024
                while bytes_left > 0:
                    read_size = min(chunk_size, bytes_left)
                    data = f.read(read_size)
                    if not data:
                        break
                    bytes_left -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
            "Content-Type": content_type,
        }
        return StreamingResponse(iterfile(), status_code=206, headers=headers)
    else:
        return FileResponse(target_path, media_type=content_type, filename=target_path.name)

@app.get("/api/cover/{file_path:path}")
@app.head("/api/cover/{file_path:path}")
async def get_audio_cover(file_path: str):
    """Serve embedded album artwork directly from audio file or folder."""
    rel_path = unquote(file_path).lstrip("/\\")
    target_path = (DOWNLOADS_DIR / rel_path).resolve()
    base_path = DOWNLOADS_DIR.resolve()
    if not str(target_path).startswith(str(base_path)) or not target_path.exists() or not target_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    if target_path.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
        media_type = "image/png" if target_path.suffix.lower() == ".png" else "image/jpeg"
        return FileResponse(target_path, media_type=media_type)

    try:
        audio = mutagen.File(str(target_path))
        if audio:
            if hasattr(audio, "pictures") and audio.pictures:
                pic = audio.pictures[0]
                return Response(content=pic.data, media_type=pic.mime or "image/jpeg")
            elif hasattr(audio, "tags") and audio.tags:
                if "covr" in audio.tags and audio.tags["covr"]:
                    return Response(content=bytes(audio.tags["covr"][0]), media_type="image/jpeg")
                if hasattr(audio.tags, "getall"):
                    apics = audio.tags.getall("APIC")
                    if apics:
                        return Response(content=apics[0].data, media_type=apics[0].mime or "image/jpeg")
    except Exception as e:
        logger.warning(f"Error extracting cover from {file_path}: {e}")

    raise HTTPException(status_code=404, detail="Cover art not found")

# Mount static files
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=8484, log_level="info")
