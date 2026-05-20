#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="$(cd "$(dirname "$0")" && pwd)/data"
mkdir -p "$DATA_DIR"

echo "==> Downloading Bretagne OSM extract from Geofabrik…"
curl -L --progress-bar \
  -o "$DATA_DIR/bretagne.osm.pbf" \
  "https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf"

echo "==> Downloading Bibus GTFS feed from transport.data.gouv.fr…"
curl -L --progress-bar \
  -o "$DATA_DIR/bibus_gtfs.zip" \
  "https://transport.data.gouv.fr/datasets/horaires-theoriques-et-temps-reel-des-bus-et-tramways-circulant-sur-le-territoire-de-brest-metropole/exports/gtfs"

echo "==> Generating Valhalla config…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  ghcr.io/valhalla/valhalla:latest \
  valhalla_build_config \
    --mjolnir-tile-dir /data/tiles \
    --mjolnir-timezone Europe/Paris \
    --mjolnir-admin /data/admins.sqlite \
  > "$DATA_DIR/valhalla.json"

echo "==> Building road graph tiles (this takes a few minutes)…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  ghcr.io/valhalla/valhalla:latest \
  valhalla_build_tiles -c /data/valhalla.json /data/bretagne.osm.pbf

echo "==> Ingesting Bibus GTFS transit schedule…"
docker run --rm \
  -v "$DATA_DIR:/data" \
  ghcr.io/valhalla/valhalla:latest \
  valhalla_build_transit -c /data/valhalla.json /data/bibus_gtfs.zip

echo ""
echo "Done. Run: docker compose up -d"
