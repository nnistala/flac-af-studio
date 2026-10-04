FROM python:3.11-slim-bullseye

# Install runtime dependencies (ffmpeg, nodejs for headless bridges, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    npm \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency definition
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Set default environment variables
ENV SPOTIFLAC_REGISTRIES="https://raw.githubusercontent.com/spotiflacapp/spotiflac-extension/main/registry.json"
ENV FLAC_DOWNLOADS_DIR="/app/downloads"
ENV PYTHONUNBUFFERED=1

EXPOSE 8484

VOLUME ["/app/downloads"]

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8484"]
