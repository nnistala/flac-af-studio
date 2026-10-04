// Flac AF · Hi-Res Lossless Studio
// Audiophile Web Engine & Client Logic (100% Dynamic - Cleaned & Focused)

const state = {
  activeTab: 'search-tab',
  library: [],
  queue: { active: [], history: [], all: [] },
  currentTrack: null,
  playlist: [],
  playlistIndex: -1,
  selectedTrackIds: new Set(),
  visibleTracks: [],
  pollTimer: null,
  logsTimer: null,
  currentAlbumModalData: null,
};

// DOM Elements - Navigation & Shell
const navItems = document.querySelectorAll('.nav-item');
const tabPanes = document.querySelectorAll('.tab-pane');
const queueActiveSpinner = document.getElementById('queueActiveSpinner');

// Search Elements
const mainSearchInput = document.getElementById('mainSearchInput');
const mainSearchBtn = document.getElementById('mainSearchBtn');
const mainSearchClearBtn = document.getElementById('mainSearchClearBtn');
const suggChips = document.querySelectorAll('.sugg-chip');
const streamHeading = document.getElementById('streamHeading');
const streamSub = document.getElementById('streamSub');
const streamMasterCount = document.getElementById('streamMasterCount');
const albumsSection = document.getElementById('albumsSection');
const albumsGrid = document.getElementById('albumsGrid');
const albumsMountedLabel = document.getElementById('albumsMountedLabel');
const tracksTableBody = document.getElementById('tracksTableBody');
const masterHeaderCheckbox = document.getElementById('masterHeaderCheckbox');
const selectAllTracksBtn = document.getElementById('selectAllTracksBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');

// Floating Selection Bar
const floatingSelectionBar = document.getElementById('floatingSelectionBar');
const selectedCountText = document.getElementById('selectedCountText');
const selectedSizeText = document.getElementById('selectedSizeText');
const floatingDeselectBtn = document.getElementById('floatingDeselectBtn');
const floatingDownloadBtn = document.getElementById('floatingDownloadBtn');

// Live Logs & Terminal
const openDaemonLogsBtn = document.getElementById('openDaemonLogsBtn');
const logsModal = document.getElementById('logsModal');
const closeLogsModalBtn = document.getElementById('closeLogsModalBtn');
const logsContainer = document.getElementById('logsContainer');
const clearLogsDisplayBtn = document.getElementById('clearLogsDisplayBtn');

// Library Elements
const vaultCountsLabel = document.getElementById('vaultCountsLabel');
const libraryFilterInput = document.getElementById('libraryFilterInput');
const libraryFilterClearBtn = document.getElementById('libraryFilterClearBtn');
const libraryAlbumsGrid = document.getElementById('libraryAlbumsGrid');
const libraryTableBody = document.getElementById('libraryTableBody');
const libTracksCount = document.getElementById('libTracksCount');
const exportAllFlacBtn = document.getElementById('exportAllFlacBtn');
const playAllShuffledBtn = document.getElementById('playAllShuffledBtn');

// Queue Elements
const queueActiveList = document.getElementById('queueActiveList');
const queueHistoryList = document.getElementById('queueHistoryList');
const clearQueueBtn = document.getElementById('clearQueueBtn');

// Album Modal
const albumModal = document.getElementById('albumModal');
const closeAlbumModalBtn = document.getElementById('closeAlbumModalBtn');
const modalAlbumCover = document.getElementById('modalAlbumCover');
const modalAlbumTitle = document.getElementById('modalAlbumTitle');
const modalAlbumArtist = document.getElementById('modalAlbumArtist');
const modalAlbumMeta = document.getElementById('modalAlbumMeta');
const modalTracklistBody = document.getElementById('modalTracklistBody');
const modalDownloadAlbumBtn = document.getElementById('modalDownloadAlbumBtn');
const modalHeaderCheckbox = document.getElementById('modalHeaderCheckbox');

// Player Elements
const playerBar = document.getElementById('playerBar');
const audioElement = document.getElementById('audioElement');
const playerPlayBtn = document.getElementById('playerPlayBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const playerPrevBtn = document.getElementById('playerPrevBtn');
const playerNextBtn = document.getElementById('playerNextBtn');
const vinylSvg = document.getElementById('vinylSvg');
const playerCover = document.getElementById('playerCover');
const playerTitle = document.getElementById('playerTitle');
const playerArtist = document.getElementById('playerArtist');
const playerFormat = document.getElementById('playerFormat');
const playerCurrentTime = document.getElementById('playerCurrentTime');
const playerTotalTime = document.getElementById('playerTotalTime');
const playerProgressBarContainer = document.getElementById('playerProgressBarContainer');
const playerProgressFill = document.getElementById('playerProgressFill');
const playerVolumeSlider = document.getElementById('playerVolumeSlider');

// Helper Functions
function formatDurationMs(ms) {
  if (!ms) return '03:45';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min < 10 ? '0' : ''}${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function formatDurationSec(sec) {
  if (!sec) return '00:00';
  const min = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${min < 10 ? '0' : ''}${min}:${s < 10 ? '0' : ''}${s}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

function estimateTrackSizeMB(durationMs) {
  const durationSec = durationMs ? durationMs / 1000 : 210;
  return Math.max(12.5, (durationSec * 900) / (8 * 1024)).toFixed(1);
}

// Tab Switching
navItems.forEach(item => {
  item.addEventListener('click', () => {
    const tabId = item.getAttribute('data-tab');
    switchTab(tabId);
  });
});

function switchTab(tabId) {
  state.activeTab = tabId;
  navItems.forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.classList.add('active');

  tabPanes.forEach(p => p.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');

  const mainArea = document.querySelector('.main-content');
  if (mainArea) mainArea.scrollTop = 0;

  if (tabId === 'library-tab') {
    loadLibrary();
  } else if (tabId === 'queue-tab') {
    loadQueue();
  }
}

// Search Suggestions Chips
suggChips.forEach(chip => {
  chip.addEventListener('click', () => {
    suggChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const query = chip.getAttribute('data-query');
    if (query) {
      mainSearchInput.value = query;
      if (mainSearchClearBtn) mainSearchClearBtn.style.display = 'inline-flex';
      performSearch(query);
    }
  });
});

// Search Handlers
mainSearchBtn.addEventListener('click', () => {
  const q = mainSearchInput.value.trim();
  if (q) performSearch(q);
});

mainSearchInput.addEventListener('input', () => {
  if (mainSearchClearBtn) {
    mainSearchClearBtn.style.display = mainSearchInput.value ? 'inline-flex' : 'none';
  }
});

if (mainSearchClearBtn) {
  mainSearchClearBtn.addEventListener('click', () => {
    mainSearchInput.value = '';
    mainSearchClearBtn.style.display = 'none';
    mainSearchInput.focus();
  });
}

mainSearchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = mainSearchInput.value.trim();
    if (q) performSearch(q);
  }
});

// Keyboard Shortcut ⌘K / Ctrl+K
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    switchTab('search-tab');
    if (mainSearchInput) {
      mainSearchInput.focus();
      mainSearchInput.select();
    }
  }
});

// Perform Search (100% Dynamic API Call)
async function performSearch(query) {
  if (mainSearchInput && mainSearchInput.value !== query) {
    mainSearchInput.value = query;
  }
  if (mainSearchClearBtn) mainSearchClearBtn.style.display = query ? 'inline-flex' : 'none';

  streamHeading.textContent = `${query} Lossless Masters`;
  streamSub.textContent = `Streaming master index from verified bit-perfect sources`;
  streamMasterCount.textContent = `Scanning masters...`;
  tracksTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">
    <div style="display:inline-block; animation: spinDisk 1.2s linear infinite; font-size: 1.5rem; margin-bottom: 8px;">💿</div>
    <div>Indexing lossless master catalog for "${escapeHtml(query)}"...</div>
  </td></tr>`;

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();

    state.visibleTracks = data.tracks || [];
    streamMasterCount.textContent = `${state.visibleTracks.length} Studio Masters Found`;

    renderAlbumsGrid(data.albums || []);
    renderTracksTable(state.visibleTracks);
  } catch (err) {
    console.error('Search error:', err);
    tracksTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px; color: #ef4444;">
      Failed to search master catalogue: ${escapeHtml(err.message)}
    </td></tr>`;
  }
}

// Render Search Albums Grid (Dynamic from API results only)
function renderAlbumsGrid(albums) {
  albumsGrid.innerHTML = '';
  if (!albums || albums.length === 0) {
    albumsSection.style.display = 'none';
    return;
  }

  albumsSection.style.display = 'block';
  albumsMountedLabel.textContent = `${albums.length} Album${albums.length > 1 ? 's' : ''} Available`;

  albums.forEach(album => {
    const card = document.createElement('div');
    card.className = 'album-tape-card';
    const year = album.release_date ? album.release_date.substring(0, 4) : '';

    card.innerHTML = `
      <div class="album-cover-wrap">
        <img class="album-cover-img" src="${album.cover_url || ''}" alt="${escapeHtml(album.name)}" onerror="this.src='https://placehold.co/300x300/1e293b/ffffff?text=${encodeURIComponent(album.name)}'">
        <span class="album-badge-flac">FLAC 24/192</span>
      </div>
      <div class="album-info-title" title="${escapeHtml(album.name)}">${escapeHtml(album.name)}</div>
      <div class="album-info-artist">${escapeHtml(album.artists)}${year ? ` • ${year}` : ''}</div>
      <div class="album-footer-row">
        <span class="album-stats-text">Lossless Master</span>
        <button class="rip-album-mini-btn" data-album-id="${album.id}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Rip Album</span>
        </button>
      </div>
    `;

    card.querySelector('.rip-album-mini-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openAlbumModal(album.id);
    });

    card.addEventListener('click', () => {
      openAlbumModal(album.id);
    });

    albumsGrid.appendChild(card);
  });
}

// Render Master Tracks Table with Multi-Select Checkboxes
function renderTracksTable(tracks) {
  tracksTableBody.innerHTML = '';
  state.selectedTrackIds.clear();
  updateFloatingSelectionBar();
  masterHeaderCheckbox.checked = false;

  if (!tracks || tracks.length === 0) {
    tracksTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">
      No tracks found for this search. Try searching an artist, album, or track above.
    </td></tr>`;
    return;
  }

  tracks.forEach((track, idx) => {
    const tr = document.createElement('tr');
    tr.id = `track-row-${track.id}`;

    const sizeMB = estimateTrackSizeMB(track.duration_ms);
    const indexStr = (idx + 1) < 10 ? `0${idx + 1}` : `${idx + 1}`;
    const inLib = track.in_library;

    tr.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" class="custom-chk track-chk" data-track-id="${track.id}" data-size-mb="${sizeMB}">
      </td>
      <td class="track-index-col">${indexStr}</td>
      <td>
        <div class="track-title-cell">
          <img class="track-thumb" src="${track.cover_url || ''}" alt="" onerror="this.style.display='none'">
          <div class="track-meta-titles">
            <span class="track-name-bold" style="cursor:pointer;" title="Click to play or rip">${escapeHtml(track.title)}</span>
            <span class="track-artist-sub">${escapeHtml(track.artists)}</span>
          </div>
        </div>
      </td>
      <td class="album-name-cell">${escapeHtml(track.album || 'Lossless Master')}</td>
      <td><span class="res-pill-flac">FLAC 24/192</span></td>
      <td class="file-size-cell">
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:8px;">
          <span>${sizeMB} MB</span>
          <button class="download-track-icon-btn single-dl-btn" title="${inLib ? 'Already in Vault' : 'Download Lossless FLAC'}">
            ${inLib ?
              `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#10b981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>` :
              `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`
            }
          </button>
        </div>
      </td>
    `;

    // Row Checkbox Event
    const chk = tr.querySelector('.track-chk');
    chk.addEventListener('change', () => {
      if (chk.checked) {
        state.selectedTrackIds.add(track.id);
        tr.classList.add('row-selected');
      } else {
        state.selectedTrackIds.delete(track.id);
        tr.classList.remove('row-selected');
      }
      updateFloatingSelectionBar();
    });

    // Title Click -> Play if in library, or download
    tr.querySelector('.track-name-bold').addEventListener('click', () => {
      if (track.in_library && track.local_file) {
        playTrack({
          title: track.title,
          artist: track.artists,
          album: track.album,
          format: 'FLAC 24/192',
          stream_url: `/api/stream/${encodeURIComponent(track.local_file)}`,
          cover_url: track.cover_url
        });
      } else {
        queueSingleTrack(track);
      }
    });

    // Single Download Button
    tr.querySelector('.single-dl-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      queueSingleTrack(track);
    });

    tracksTableBody.appendChild(tr);
  });
}

// Master Header Checkbox
masterHeaderCheckbox.addEventListener('change', () => {
  const isChecked = masterHeaderCheckbox.checked;
  const checkboxes = document.querySelectorAll('.track-chk');
  checkboxes.forEach(c => {
    c.checked = isChecked;
    const tid = c.getAttribute('data-track-id');
    const row = document.getElementById(`track-row-${tid}`);
    if (isChecked) {
      state.selectedTrackIds.add(tid);
      row?.classList.add('row-selected');
    } else {
      state.selectedTrackIds.delete(tid);
      row?.classList.remove('row-selected');
    }
  });
  updateFloatingSelectionBar();
});

// Select All & Clear Buttons
selectAllTracksBtn.addEventListener('click', () => {
  masterHeaderCheckbox.checked = true;
  masterHeaderCheckbox.dispatchEvent(new Event('change'));
});

clearSelectionBtn.addEventListener('click', () => {
  masterHeaderCheckbox.checked = false;
  masterHeaderCheckbox.dispatchEvent(new Event('change'));
});

floatingDeselectBtn.addEventListener('click', () => {
  masterHeaderCheckbox.checked = false;
  masterHeaderCheckbox.dispatchEvent(new Event('change'));
});

// Update Floating Selection Bar
function updateFloatingSelectionBar() {
  const count = state.selectedTrackIds.size;
  if (count > 0) {
    floatingSelectionBar.style.display = 'block';
    selectedCountText.textContent = `${count} track${count > 1 ? 's' : ''} selected`;

    let totalMB = 0;
    document.querySelectorAll('.track-chk:checked').forEach(c => {
      totalMB += parseFloat(c.getAttribute('data-size-mb') || '0');
    });
    selectedSizeText.textContent = `• ${totalMB.toFixed(0)} MB`;
  } else {
    floatingSelectionBar.style.display = 'none';
  }
}

// Floating Download Button (Batch Download Selected)
floatingDownloadBtn.addEventListener('click', async () => {
  const selectedList = [];
  state.visibleTracks.forEach(t => {
    if (state.selectedTrackIds.has(t.id)) {
      selectedList.push({
        url: t.external_url || `https://open.spotify.com/track/${t.id}`,
        title: t.title,
        artist: t.artists,
        album: t.album || '',
        cover_url: t.cover_url || ''
      });
    }
  });

  if (selectedList.length === 0) return;

  const albums = new Set(selectedList.map(t => t.album).filter(Boolean));
  let folderName = '';
  if (selectedList.length > 1) {
    if (albums.size === 1) {
      const alb = selectedList[0].album;
      const art = selectedList[0].artist;
      folderName = art ? `${art} - ${alb}` : alb;
    }
  }

  try {
    floatingDownloadBtn.disabled = true;
    floatingDownloadBtn.innerHTML = `<span>Queueing ${selectedList.length} Tracks...</span>`;

    const res = await fetch('/api/download-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tracks: selectedList,
        folder_name: folderName,
        force: false
      })
    });
    await res.json();

    masterHeaderCheckbox.checked = false;
    masterHeaderCheckbox.dispatchEvent(new Event('change'));

    floatingDownloadBtn.disabled = false;
    floatingDownloadBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Download Selected (FLAC)</span>
    `;

    switchTab('queue-tab');
    startQueuePolling();
  } catch (err) {
    console.error('Batch download error:', err);
    alert(`Could not queue batch: ${err.message}`);
    floatingDownloadBtn.disabled = false;
  }
});

// Single Track Download
async function queueSingleTrack(track) {
  try {
    await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: track.external_url || `https://open.spotify.com/track/${track.id}`,
        title: track.title,
        artist: track.artists,
        album: track.album || '',
        cover_url: track.cover_url || ''
      })
    });
    switchTab('queue-tab');
    startQueuePolling();
  } catch (err) {
    console.error('Download queue error:', err);
  }
}

// Open Album Modal & Tracklist
async function openAlbumModal(albumId) {
  albumModal.style.display = 'flex';
  modalAlbumTitle.textContent = 'Loading Album...';
  modalAlbumArtist.textContent = 'Retrieving bit-perfect tracks';
  modalAlbumMeta.textContent = '...';
  modalTracklistBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 30px;">Loading tracklist...</td></tr>`;

  try {
    const res = await fetch(`/api/album/${albumId}`);
    if (!res.ok) throw new Error('Could not load album');
    const data = await res.json();
    state.currentAlbumModalData = data;

    modalAlbumTitle.textContent = data.album;
    modalAlbumArtist.textContent = data.artist;
    modalAlbumCover.src = data.cover_url || '';
    modalAlbumMeta.textContent = `${data.total_tracks} Tracks • Lossless Studio Master`;

    modalTracklistBody.innerHTML = '';
    data.tracks.forEach((t, i) => {
      const tr = document.createElement('tr');
      const idx = (t.track_number || i + 1) < 10 ? `0${t.track_number || i + 1}` : (t.track_number || i + 1);
      tr.innerHTML = `
        <td style="text-align: center;">
          <input type="checkbox" class="custom-chk modal-chk" checked data-track-id="${t.id}">
        </td>
        <td class="track-index-col">${idx}</td>
        <td>
          <span style="font-weight:600; color:var(--text-primary);">${escapeHtml(t.title)}</span>
        </td>
        <td style="font-family:var(--font-mono); font-size:0.78rem; color:var(--text-muted);">${formatDurationMs(t.duration_ms)}</td>
        <td><span class="res-pill-flac">FLAC 24/192</span></td>
        <td style="text-align: right;">
          <button class="rip-album-mini-btn modal-single-btn">Download</button>
        </td>
      `;

      tr.querySelector('.modal-single-btn').addEventListener('click', () => {
        queueSingleTrack(t);
        albumModal.style.display = 'none';
      });

      modalTracklistBody.appendChild(tr);
    });

    modalDownloadAlbumBtn.onclick = async () => {
      const selected = [];
      document.querySelectorAll('.modal-chk:checked').forEach(c => {
        const tid = c.getAttribute('data-track-id');
        const track = data.tracks.find(x => x.id === tid);
        if (track) {
          selected.push({
            url: track.external_url || `https://open.spotify.com/track/${track.id}`,
            title: track.title,
            artist: track.artists,
            album: data.album,
            cover_url: data.cover_url
          });
        }
      });

      if (selected.length > 0) {
        albumModal.style.display = 'none';
        const folderName = selected.length > 1 ? (data.artist ? `${data.artist} - ${data.album}` : data.album) : '';
        await fetch('/api/download-batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tracks: selected,
            folder_name: folderName,
            album_title: data.album,
            artist_name: data.artist
          })
        });
        switchTab('queue-tab');
        startQueuePolling();
      }
    };
  } catch (err) {
    modalTracklistBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color:#ef4444;">${escapeHtml(err.message)}</td></tr>`;
  }
}

closeAlbumModalBtn.addEventListener('click', () => {
  albumModal.style.display = 'none';
});

// Library (100% Dynamic from actual downloaded files)
async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error('Could not load library');
    const data = await res.json();
    state.library = data.tracks || [];

    // Group downloaded tracks by album
    const albumMap = new Map();
    let totalBytes = 0;

    state.library.forEach(t => {
      totalBytes += t.size_bytes || 0;
      const albumKey = t.album || t.folder || t.artist || 'Singles Vault';
      if (!albumMap.has(albumKey)) {
        albumMap.set(albumKey, {
          album: albumKey,
          artist: t.artist,
          folder: t.folder || '',
          cover_url: t.cover_url || '',
          format: t.format === 'FLAC' ? 'FLAC Lossless' : t.format,
          tracks: [],
          totalBytes: 0,
        });
      }
      const entry = albumMap.get(albumKey);
      if (!entry.cover_url && t.cover_url) {
        entry.cover_url = t.cover_url;
      }
      entry.tracks.push(t);
      entry.totalBytes += (t.size_bytes || 0);
    });

    const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
    const albumsCount = albumMap.size;
    const tracksCount = state.library.length;

    vaultCountsLabel.textContent = `✓ ${albumsCount} Album${albumsCount !== 1 ? 's' : ''} • ${tracksCount} Track${tracksCount !== 1 ? 's' : ''} • ${totalMB} MB in Vault`;
    libTracksCount.textContent = tracksCount;

    renderLibraryAlbums(Array.from(albumMap.values()));

    // CRITICAL: Respect active filter! Never clear user's search text!
    const activeQuery = libraryFilterInput ? libraryFilterInput.value.toLowerCase().trim() : '';
    if (activeQuery) {
      const filtered = state.library.filter(t =>
        (t.title && t.title.toLowerCase().includes(activeQuery)) ||
        (t.artist && t.artist.toLowerCase().includes(activeQuery)) ||
        (t.album && t.album.toLowerCase().includes(activeQuery))
      );
      renderLibraryTracks(filtered);
    } else {
      renderLibraryTracks(state.library);
    }
  } catch (err) {
    console.error('Error loading library:', err);
  }
}

// Render Real Downloaded Albums in Library
function renderLibraryAlbums(albums) {
  libraryAlbumsGrid.innerHTML = '';
  if (!albums || albums.length === 0) {
    libraryAlbumsGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 24px; text-align: center; color: var(--text-muted); background: #ffffff; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
      No offline albums yet. Search and download music to populate your vault.
    </div>`;
    return;
  }

  albums.forEach(item => {
    const card = document.createElement('div');
    card.className = 'album-tape-card';
    const mb = (item.totalBytes / (1024 * 1024)).toFixed(1);

    const coverHtml = item.cover_url ?
      `<img class="album-cover-img" src="${item.cover_url}" alt="${escapeHtml(item.album)}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div class="album-cover-fallback" style="display:none; width:100%; height:100%; align-items:center; justify-content:center; background: linear-gradient(135deg, #1e293b, #0f172a); color:#ffffff; font-size:2.5rem;">💿</div>` :
      `<div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; background: linear-gradient(135deg, #1e293b, #0f172a); color:#ffffff; font-size:2.5rem;">💿</div>`;

    card.innerHTML = `
      <div class="album-cover-wrap">
        ${coverHtml}
        <span class="album-badge-flac">${item.format}</span>
      </div>
      <div class="album-info-title" title="${escapeHtml(item.album)}">${escapeHtml(item.album)}</div>
      <div class="album-info-artist">${escapeHtml(item.artist)}</div>
      <div class="album-footer-row">
        <span class="album-stats-text">${item.tracks.length} track${item.tracks.length > 1 ? 's' : ''} • ${mb} MB</span>
      </div>
    `;

    card.addEventListener('click', () => {
      // Filter library tracks table to this album
      renderLibraryTracks(item.tracks);
    });

    libraryAlbumsGrid.appendChild(card);
  });
}

// Render Real Downloaded Tracks
function renderLibraryTracks(tracks) {
  libraryTableBody.innerHTML = '';
  if (!tracks || tracks.length === 0) {
    libraryTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color:var(--text-muted);">
      ${libraryFilterInput && libraryFilterInput.value ? 'No tracks matching your search filter.' : 'Your local vault is empty. Search for artists, albums, or tracks above to download bit-perfect FLACs.'}
    </td></tr>`;
    return;
  }

  tracks.forEach((track, idx) => {
    const tr = document.createElement('tr');
    const isCurrentlyPlaying = state.currentTrack && state.currentTrack.title === track.title;
    const indexStr = (idx + 1) < 10 ? `0${idx + 1}` : `${idx + 1}`;
    const formatTag = track.format === 'FLAC' ? 'FLAC 16/44' : track.format;

    const thumbHtml = track.cover_url ?
      `<img src="${track.cover_url}" class="track-thumb" alt="" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
       <div class="track-thumb-fallback" style="display:none;">🎵</div>` :
      `<div class="track-thumb-fallback">🎵</div>`;

    tr.innerHTML = `
      <td class="track-index-col">
        ${isCurrentlyPlaying ?
          `<div class="sound-wave-bars"><span class="wave-bar"></span><span class="wave-bar"></span><span class="wave-bar"></span></div>` :
          indexStr
        }
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:12px;">
          ${thumbHtml}
          <button class="player-icon-btn play-row-btn" style="color:var(--primary); padding:4px;" title="Play Track">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>
          </button>
          <div>
            <div style="font-weight:600; color:var(--text-primary); cursor:pointer;" class="lib-track-title">${escapeHtml(track.title)}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(track.artist)}</div>
          </div>
        </div>
      </td>
      <td class="album-name-cell">${escapeHtml(track.album || 'Master Vault')}</td>
      <td><span class="res-pill-flac">${formatTag}</span></td>
      <td style="text-align: right; font-family: var(--font-mono); font-size: 0.78rem;">${formatDurationSec(track.duration_sec)}</td>
      <td style="text-align: right;">
        <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px;">
          <button class="player-icon-btn play-btn-action" title="Play Now">▶</button>
        </div>
      </td>
    `;

    const playHandler = () => {
      state.playlist = tracks;
      state.playlistIndex = idx;
      playTrack(track);
    };

    tr.querySelector('.play-row-btn').addEventListener('click', playHandler);
    tr.querySelector('.lib-track-title').addEventListener('click', playHandler);
    tr.querySelector('.play-btn-action').addEventListener('click', playHandler);

    libraryTableBody.appendChild(tr);
  });
}

// Library Search Filter Event
libraryFilterInput.addEventListener('input', () => {
  const query = libraryFilterInput.value.toLowerCase().trim();
  if (libraryFilterClearBtn) {
    libraryFilterClearBtn.style.display = libraryFilterInput.value ? 'inline-flex' : 'none';
  }
  if (!query) {
    renderLibraryTracks(state.library);
    return;
  }
  const filtered = state.library.filter(t =>
    (t.title && t.title.toLowerCase().includes(query)) ||
    (t.artist && t.artist.toLowerCase().includes(query)) ||
    (t.album && t.album.toLowerCase().includes(query))
  );
  renderLibraryTracks(filtered);
});

if (libraryFilterClearBtn) {
  libraryFilterClearBtn.addEventListener('click', () => {
    libraryFilterInput.value = '';
    libraryFilterClearBtn.style.display = 'none';
    libraryFilterInput.focus();
    renderLibraryTracks(state.library);
  });
}

playAllShuffledBtn.addEventListener('click', () => {
  if (state.library.length > 0) {
    const shuffled = [...state.library].sort(() => Math.random() - 0.5);
    state.playlist = shuffled;
    state.playlistIndex = 0;
    playTrack(shuffled[0]);
  }
});

exportAllFlacBtn.addEventListener('click', () => {
  alert('Lossless vault audio files are stored locally in:\n~/Music/hi-res-rip/downloads\n\nAll bit-perfect master FLAC files are accessible with full metadata tags.');
});

// Lossless Player Controls
function playTrack(track) {
  state.currentTrack = track;
  playerTitle.textContent = track.title || 'Echoes of Porcelain';
  playerArtist.textContent = track.artist || 'Acoustic Fidelity Ensemble';
  playerFormat.textContent = track.format === 'FLAC' ? 'FLAC 16/44' : (track.format || 'FLAC 24/192');

  if (track.cover_url) {
    playerCover.src = track.cover_url;
    playerCover.style.display = 'block';
    vinylSvg.style.display = 'none';
  } else {
    playerCover.style.display = 'none';
    vinylSvg.style.display = 'block';
  }

  vinylSvg.classList.add('vinyl-spin');
  playIcon.style.display = 'none';
  pauseIcon.style.display = 'block';

  if (track.stream_url) {
    audioElement.src = track.stream_url;
    audioElement.play().catch(e => console.log('Audio autoplay prevented:', e));
  }

  if (state.activeTab === 'library-tab') {
    const activeQuery = libraryFilterInput ? libraryFilterInput.value.toLowerCase().trim() : '';
    if (activeQuery) {
      const filtered = state.library.filter(t =>
        (t.title && t.title.toLowerCase().includes(activeQuery)) ||
        (t.artist && t.artist.toLowerCase().includes(activeQuery)) ||
        (t.album && t.album.toLowerCase().includes(activeQuery))
      );
      renderLibraryTracks(filtered);
    } else {
      renderLibraryTracks(state.library);
    }
  }
}

playerPlayBtn.addEventListener('click', () => {
  if (audioElement.paused) {
    if (!audioElement.src && state.library.length > 0) {
      playTrack(state.library[0]);
    } else {
      audioElement.play();
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      vinylSvg.classList.add('vinyl-spin');
    }
  } else {
    audioElement.pause();
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    vinylSvg.classList.remove('vinyl-spin');
  }
});

playerPrevBtn.addEventListener('click', () => {
  if (state.playlist.length > 0 && state.playlistIndex > 0) {
    state.playlistIndex--;
    playTrack(state.playlist[state.playlistIndex]);
  }
});

playerNextBtn.addEventListener('click', () => {
  if (state.playlist.length > 0 && state.playlistIndex < state.playlist.length - 1) {
    state.playlistIndex++;
    playTrack(state.playlist[state.playlistIndex]);
  }
});

audioElement.addEventListener('timeupdate', () => {
  if (audioElement.duration) {
    const cur = audioElement.currentTime;
    const dur = audioElement.duration;
    playerCurrentTime.textContent = formatDurationSec(cur);
    playerTotalTime.textContent = formatDurationSec(dur);
    const pct = (cur / dur) * 100;
    playerProgressFill.style.width = `${pct}%`;
  }
});

playerProgressBarContainer.addEventListener('click', (e) => {
  if (audioElement.duration) {
    const rect = playerProgressBarContainer.getBoundingClientRect();
    const pos = (e.clientX - rect.left) / rect.width;
    audioElement.currentTime = pos * audioElement.duration;
  }
});

playerVolumeSlider.addEventListener('input', () => {
  audioElement.volume = parseFloat(playerVolumeSlider.value);
});

audioElement.addEventListener('ended', () => {
  if (state.playlist.length > 0 && state.playlistIndex < state.playlist.length - 1) {
    state.playlistIndex++;
    playTrack(state.playlist[state.playlistIndex]);
  } else {
    playIcon.style.display = 'block';
    pauseIcon.style.display = 'none';
    vinylSvg.classList.remove('vinyl-spin');
  }
});

// Download Queue Handling
async function loadQueue() {
  try {
    const res = await fetch('/api/queue');
    if (!res.ok) throw new Error('Failed to load queue');
    const data = await res.json();
    state.queue = data;

    // Show spinner if active downloads exist, otherwise hide
    if (data.active && data.active.length > 0) {
      queueActiveSpinner.style.display = 'inline-block';
    } else {
      queueActiveSpinner.style.display = 'none';
    }

    renderQueueList(data.active, queueActiveList, true);
    renderQueueList(data.history, queueHistoryList, false);
  } catch (err) {
    console.error('Queue load error:', err);
  }
}

function renderQueueList(items, container, isActive) {
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = `<div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.84rem;">
      ${isActive ? 'No active downloads in pipeline.' : 'No completed rips in history.'}
    </div>`;
    return;
  }

  items.forEach(item => {
    const card = document.createElement('div');
    card.style.cssText = `
      background: #ffffff;
      border: 1px solid var(--border-card);
      border-radius: var(--radius-md);
      padding: 14px 18px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: var(--shadow-sm);
    `;

    const statusColor = item.status === 'completed' ? '#10b981' : (item.status === 'failed' ? '#ef4444' : 'var(--primary)');

    card.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px;">
        <span class="res-pill-flac">${item.status.toUpperCase()}</span>
        <div>
          <div style="font-weight:600; color:var(--text-primary); font-size:0.88rem;">${escapeHtml(item.title)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escapeHtml(item.artist)} • ${item.album || 'Lossless FLAC'}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:16px;">
        <span style="font-size:0.76rem; font-family:var(--font-mono); color:${statusColor}; font-weight:600;">
          ${item.status === 'downloading' ? `${item.progress}%` : item.status}
        </span>
      </div>
    `;

    container.appendChild(card);
  });
}

// Clear Completed Queue Action
clearQueueBtn.addEventListener('click', async () => {
  try {
    clearQueueBtn.disabled = true;
    await fetch('/api/queue/clear', { method: 'POST' });
    await loadQueue();
    clearQueueBtn.disabled = false;
  } catch (err) {
    console.error('Clear queue error:', err);
    clearQueueBtn.disabled = false;
  }
});

function startQueuePolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    const hadActive = state.queue.active && state.queue.active.length > 0;
    loadQueue().then(() => {
      const hasActive = state.queue.active && state.queue.active.length > 0;
      // Only refresh library when an active download exists or completes
      if ((hadActive || hasActive) && state.activeTab === 'library-tab') {
        loadLibrary();
      }
    });
  }, 2500);
}

// Live Logs Modal Trigger
function openLogsModal() {
  logsModal.style.display = 'flex';
  fetchLogs();
  if (state.logsTimer) clearInterval(state.logsTimer);
  state.logsTimer = setInterval(fetchLogs, 2000);
}

function closeLogsModal() {
  logsModal.style.display = 'none';
  if (state.logsTimer) {
    clearInterval(state.logsTimer);
    state.logsTimer = null;
  }
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    if (!res.ok) return;
    const data = await res.json();
    logsContainer.textContent = (data.logs || []).join('\n') || 'Awaiting live stream pipeline events...';
    logsContainer.scrollTop = logsContainer.scrollHeight;
  } catch (e) {
    console.error('Error fetching logs:', e);
  }
}

if (openDaemonLogsBtn) openDaemonLogsBtn.addEventListener('click', openLogsModal);
closeLogsModalBtn.addEventListener('click', closeLogsModal);
clearLogsDisplayBtn.addEventListener('click', async () => {
  logsContainer.textContent = 'Logs cleared.';
  try {
    await fetch('/api/logs/clear', { method: 'POST' });
  } catch (err) {
    console.error('Failed to clear logs on server:', err);
  }
});

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const requestedTab = urlParams.get('tab');
  if (requestedTab) {
    switchTab(requestedTab);
  }
  const queryParam = urlParams.get('q') || 'A.R. Rahman';
  if (mainSearchInput) mainSearchInput.value = queryParam;
  performSearch(queryParam);
  loadLibrary();
  loadQueue();
  startQueuePolling();
});

