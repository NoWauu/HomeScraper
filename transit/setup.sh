#!/usr/bin/env bash
# One-time setup: downloads data and builds Valhalla routing graph.
# Run once, then: docker compose up -d
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$SCRIPT_DIR/data"
VALHALLA_DIR="$DATA_DIR/valhalla"
IMAGE="ghcr.io/valhalla/valhalla:latest"

mkdir -p "$VALHALLA_DIR/tiles" "$VALHALLA_DIR/transit" "$VALHALLA_DIR/gtfs/bibus"

# ── 1. Download data ──────────────────────────────────────────────────────────

if [[ ! -f "$DATA_DIR/bretagne.osm.pbf" ]]; then
  echo "==> Downloading Bretagne OSM extract (~100 MB)…"
  curl -L --progress-bar \
    -o "$DATA_DIR/bretagne.osm.pbf" \
    "https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf"
else
  echo "==> bretagne.osm.pbf already present, skipping download."
fi

if [[ ! -f "$DATA_DIR/bibus_gtfs.zip" ]]; then
  echo "==> Downloading Bibus GTFS feed…"
  curl -L --progress-bar \
    -o "$DATA_DIR/bibus_gtfs.zip" \
    "https://s3.eu-west-1.amazonaws.com/files.orchestra.ratpdev.com/networks/bibus/exports/medias.zip"
else
  echo "==> bibus_gtfs.zip already present, skipping download."
fi

echo "==> Extracting Bibus GTFS into transit directory…"
unzip -o "$DATA_DIR/bibus_gtfs.zip" -d "$VALHALLA_DIR/gtfs/bibus"

# ── 2. Generate Valhalla config ───────────────────────────────────────────────

echo "==> Generating valhalla.json config…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  valhalla_build_config \
    --mjolnir-tile-dir          /data/valhalla/tiles \
    --mjolnir-tile-extract      /data/valhalla/tiles.tar \
    --mjolnir-transit-dir       /data/valhalla/transit \
    --mjolnir-transit-feeds-dir /data/valhalla/gtfs \
    --mjolnir-admin             /data/valhalla/admins.sqlite \
    --mjolnir-timezone          /data/valhalla/timezones.sqlite \
  > "$DATA_DIR/valhalla.json"

# ── 3. Build road + pedestrian graph tiles ────────────────────────────────────

echo "==> Building tiles from OSM (5–15 min depending on machine)…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  valhalla_build_tiles -c /data/valhalla.json /data/bretagne.osm.pbf

# ── 4. Ingest GTFS transit schedule ──────────────────────────────────────────

echo "==> Ingesting Bibus GTFS (protobuf conversion)…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  valhalla_ingest_transit -c /data/valhalla.json

echo "==> Building Level 3 transit tiles…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  valhalla_convert_transit -c /data/valhalla.json

# ── 5. Pack tiles into a single tar for faster cold starts ───────────────────

echo "==> Packing tiles into tiles.tar…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  "$IMAGE" \
  valhalla_build_extract -c /data/valhalla.json -O

echo ""
echo "Setup complete. Starting Valhalla:"
echo "  cd $(dirname "$0") && docker compose up -d"
