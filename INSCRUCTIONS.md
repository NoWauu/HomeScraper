# Specification: Real Estate Scraper & Multimodal Routing Alert System

## 1. Project Overview
The objective is to build a modular, automated backend application in Node.js (TypeScript) that aggregates apartment rental listings from French real estate platforms (e.g., Leboncoin, SeLoger, BienIci). The system filters listings based on custom criteria—including strict multimodal travel times (Car, Foot, Public Transit) to a target location—tracks seen ads in a database to prevent duplicate notifications, and dispatches rich embed alerts via a Discord Webhook.

---

## 2. Core Architecture & Pipeline Flow
The system executes on a cron/interval schedule following a linear pipeline:

[ScraperManager]
│ (Runs all registered scrapers concurrently/sequentially)
▼
[List of RawAd objects]
│
▼
[Deduplication Layer] ──(Checks SQLite DB by unique ID)──► [Skip if Seen]
│
▼ (New Ads Only)
[Travel Time Engine] ──(Queries OSRM & Navitia API)
│
▼
[Storage Layer] ──(Inserts ID into SQLite DB)
│
▼
[Notification Engine] ──(Dispatches structured Discord Embed)


---

## 3. Data Contracts (`types.ts`)

```typescript
export interface RawAd {
  id: string;          // Formatted as 'source-uniqueId' (e.g., 'lbc-123456')
  source: string;      // Platform identifier ('leboncoin', 'seloger', 'bienici')
  title: string;
  url: string;
  price: number;
  surfaceArea: number; // In square meters
  rooms: number;
  location: {
    city: string;
    zipCode: string;
    latitude?: number;  // Precise coordinates are ideal for travel matrices
    longitude?: number;
  };
  imageUrl?: string;
}

export interface CommuteTimes {
  drivingMinutes: number;
  walkingMinutes: number;
  transitMinutes: number;
}

export interface BaseScraper {
  sourceName: string;
  scrape(): Promise<RawAd[]>;
}
4. Component Implementation Specifications
Task 1: The Modular Scraper Layer
Factory Pattern: Implement a ScraperManager that contains a registry array of classes implementing BaseScraper.

Targeting Strategy: Avoid raw HTML DOM parsing where possible.

For Leboncoin, fetch the raw source text and isolate the <script id="__NEXT_DATA__" type="application/json"> injection block using cheerio. Parse it as standard JSON.

For BienIci, leverage their native internal JSON API endpoint directly.

Anti-Bot Resiliency: Ensure HTTP clients accept custom header sets (User-Agent strings, Accept-Language, TLS/HTTP2 mimicking). Design the request abstraction layer so that swapping a standard axios call for an unblocking residential proxy API endpoint (like Scrapfly or ZenRows) requires altering only a single configuration utility.

Task 2: Deduplication Storage (Database.ts)
Technology: SQLite (via better-sqlite3 or standard sqlite3 packages with a lightweight promise wrapper).

Schema Requirements: A single table processed_ads with columns: id (TEXT PRIMARY KEY), source (TEXT), scraped_at (DATETIME DEFAULT CURRENT_TIMESTAMP).

Methods Required:

isNewAd(id: string): Promise<boolean>

markAsSeen(id: string): Promise<void>

Task 3: Travel Time Engine (RoutingService.ts)
The system must calculate travel times from the apartment's coordinates (or fallback city center coordinates) to a predefined target coordinate.

Car & Foot Routing: Route coordinates to the OSRM (Open Source Routing Machine) public demo API profile endpoints (/route/v1/driving/... and /route/v1/foot/...). OSRM expects coordinates in longitude,latitude order.

Public Transit Routing: Integrate with the Navitia.io API or the SNCF Open Data API to compute routes via bus, metro, and train networks. Parse the returned transit duration from the payload journeys.

Optimization: Implement data validation filters prior to hitting the routing APIs. If a RawAd fails a basic criteria check (e.g., price is above max threshold), instantly discard it without wasting routing network quotas.

Task 4: Notification Dispatches (DiscordNotifier.ts)
Technology: Native HTTPS POST requests executing to a Discord Webhook URL.

Payload formatting: Construct an array containing a single embeds object. Map the properties cleanly using the following layout mapping:

title: Use an actionable status title incorporating the city name.

url: Directly link to the source property listing.

fields: Use inline formatting pairs for Price, Surface Area, and Rooms. Append full-width lines for Location details and a distinct row summarizing the Driving, Walking, and Transit travel times side-by-side.

5. Implementation Roadmap Checklist for Claude Code
[ ] Create project file tree structure initialized with a strict tsconfig.json.

[ ] Implement foundational contract interfaces inside types.ts.

[ ] Build the SQLite wrapper layout ensuring clean DB connection lifecycle management.

[ ] Implement the abstract base request configurations alongside an initial prototype scraper (e.g., target BienIci API or Leboncoin NextJS hydration blocks).

[ ] Set up the ScraperManager file processing orchestration engine loop.

[ ] Code the RoutingService to successfully bind OSRM and Navitia APIs, returning a typed CommuteTimes block.

[ ] Build out the final Discord Webhook posting client block utilizing rich formatting styles.

[ ] Wire up an entrypoint executable file (index.ts) that schedules the system tasks sequentially.
