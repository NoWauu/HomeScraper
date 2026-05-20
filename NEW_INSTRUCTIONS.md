Using **transport.data.gouv.fr** directly means you are handling raw data instead of hitting a ready-made HTTP endpoint. The platform provides the raw structural ingredients (the static GTFS feed containing stop coordinates, line schedules, and geometry shapes) but does **not** host a routing engine for you.

To compute travel times from Point A to Point B with this raw data, you run a lightweight multi-modal routing engine locally. Because Brest’s transit data is quite compact (~66 lines, ~1000 stops), a local engine will calculate routes across the city in **under 2 milliseconds** right on your machine.

---

## The Workflow Archetype

To compute a transit journey locally, you need to combine two data layers:

1. **The Pedestrian Layer (OpenStreetMap):** For walking to the bus stop and the final destination.
2. **The Transit Layer (GTFS from transport.data.gouv.fr):** For riding the Bibus lines.

```
[OSM Brest PBF File] ---\
                         +---> [ Local Routing Engine ] ---> Instantly Computes Route
[Bibus GTFS Zip File] ---/       (Valhalla or Motis)            & Travel Duration

```

The two cleanest open-source tools to pull this off quickly are **Valhalla** and **Motis**.

---

## Setup Option 1: Valhalla (C++ Backend, High Performance)

Valhalla is a highly efficient routing engine used heavily in modern transit stacks. It treats transit schedules as an integrated extension of its map graph.

### 1. Download the Data

You pull the latest Brest map file from Geofabrik and the live stable Bibus GTFS feed URL from `transport.data.gouv.fr`.

```bash
# 1. Grab Brest/Finistère map cuts
curl -o brest.osm.pbf https://download.geofabrik.de/europe/france/bretagne-latest.osm.pbf

# 2. Grab the live Bibus GTFS feed zip from transport.data.gouv.fr
curl -o bibus_gtfs.zip https://transport.data.gouv.fr/datasets/horaires-theoriques-et-temps-reel-des-bus-et-tramways-circulant-sur-le-territoire-de-brest-metropole/exports/gtfs

```

### 2. Build the Routing Graph

Run Valhalla's build tile commands inside Docker to binarize the data layers into an actionable routing graph.

```bash
# Create directory for graph tiles
mkdir custom_tiles

# Build the tile index including transit
docker run --rm -v $(pwd):/data valhalla/valhalla:latest \
  valhalla_build_config --mjolnir-tile-dir /data/custom_tiles --mjolnir-timezone Europe/Paris > valhalla.json

docker run --rm -v $(pwd):/data valhalla/valhalla:latest \
  valhalla_build_tiles -c /data/valhalla.json /data/brest.osm.pbf

# Ingest the transit schedule
docker run --rm -v $(pwd):/data valhalla/valhalla:latest \
  valhalla_build_transit -c /data/valhalla.json /data/bibus_gtfs.zip

```

### 3. Spin up the Local API Server

```bash
docker run -d --name valhalla_brest -p 8002:8002 -v $(pwd):/data valhalla/valhalla:latest \
  valhalla_service /data/valhalla.json 1

```

### 4. Compute Travel Time (The Query)

Now you can fire HTTP POST requests to your localhost. Setting the costing to `"multimodal"` tells the engine to walk to the nearest stop, calculate schedule times, transition at transfer zones, and walk to the finish.

```bash
curl -X POST "http://localhost:8002/route" -d '{
  "locations": [
    {"lon": -4.4860, "lat": 48.3900, "type": "break"},
    {"lon": -4.4958, "lat": 48.4066, "type": "break"}
  ],
  "costing": "multimodal",
  "costing_options": {
    "transit": {
      "use_bus": true,
      "use_rail": true
    }
  },
  "date_time": {
    "type": 1,
    "value": "2026-05-21T08:00"
  }
}'

```

The resulting JSON provides an immediate `summary.time` block detailing the total duration in seconds.

---

## Setup Option 2: MOTIS (Designed for Strict Transit Interoperability)

If you do not want to mess around with compiling complex multi-layer tiles, **MOTIS** is a fantastic multi-modal routing server written in C++ that builds its schedule maps purely in-memory at startup.

### 1. Create a `config.ini` file

```ini
[modules]
routing=true
intermodal=true

[dataset]
path=data/brest.osm.pbf
schedule=bibus:data/bibus_gtfs.zip

```

### 2. Run with Docker

```bash
docker run -d -p 8080:8080 -v $(pwd)/data:/data motis/motis --config config.ini

```

MOTIS will automatically unpack the GTFS files, construct a time-expanded route graph in RAM, and open a lightning-fast JSON-RPC/REST endpoint at `localhost:8080` to query point-to-point connections.

---

## 🛠️ The Local Advantage

* **Zero Token Management:** You aren't bound to SNCF token limits, expirations, or third-party down times.
* **Low Latency:** Perfect if you need to calculate an entire distance matrix (e.g., travel times from 50 different points in Brest to a single hub).
* **Seamless Real-Time:** `transport.data.gouv.fr` also exposes standard `gtfs-rt` endpoint links for Bibus. You can feed those live protobuf links straight into Valhalla's transit engine to account for live delays without modifying your core request architecture.