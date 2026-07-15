import * as cheerio from 'cheerio';
import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { BrowserClient } from '../utils/BrowserClient';
import { inferFurnished, isColocation } from '../utils/text';

const SL_ORIGIN = 'https://www.seloger.com';
// Safety cap: 40 pages × 30 cards = 1200 ads, far above any filtered city search.
const SL_MAX_PAGES = parseInt(process.env['SL_MAX_PAGES'] ?? '40');

/**
 * SeLoger (seloger.com) — DataDome-walled, so every request goes through the
 * shared warmed BrowserClient (same approach as leboncoin: a headed patchright
 * session that warmed the homepage passes the wall; verified live 2026-07-12,
 * zero challenges across ~20 page loads).
 *
 * The SERP is server-rendered HTML (`/classified-search`), 30 cards per page,
 * parsed with cheerio. Empirical findings that drive the design:
 *  - URL filters that actually apply: `priceMax`, `spaceMin` (NOT `surfaceMin`),
 *    `page`. `roomsMin`, `furnishedTypes`, `amenities` are silently ignored, and
 *    `furnished=…` breaks the page (0 cards) — so rooms/furnished/colocation are
 *    filtered downstream by the pipeline, like Wymmo.
 *  - Geo is a place id (`AD08FR…`), resolved by loading the legacy URL
 *    `/immobilier/locations/immo-{city}-{dept}/` and reading the canonical link
 *    of the page it redirects to. No radius support → pipeline handles distance.
 *  - Cards carry no coordinates; city + zip are parsed from the address line
 *    ("Centre, Brest (29200)") and the pipeline's centroid fallback does the rest.
 *  - Total is in the H1 ("7 026 appartements à louer – Paris"); pagination is
 *    deep (Paris page 101 still serves), so no LBC-style price slicing needed —
 *    we still stop on no-new-ids as a dupe guard.
 */
export class SeLogerScraper implements BaseScraper {
  readonly sourceName = 'seloger';

  private placeIdCache = new Map<string, string>();

  async scrape(criteria: FilterCriteria, center?: GeoCenter): Promise<RawAd[]> {
    if (!center?.city || !center?.zipCode) {
      console.warn('[seloger] no center city/zip — skipping (cannot resolve place id)');
      return [];
    }

    const placeId = await this.resolvePlaceId(center.city, center.zipCode);
    if (!placeId) {
      console.warn(`[seloger] could not resolve place id for ${center.city} (${center.zipCode})`);
      return [];
    }
    console.log(`[seloger] place id for ${center.city}: ${placeId}`);

    const browser = BrowserClient.get();
    const byId = new Map<string, RawAd>();
    let total = Infinity;

    for (let page = 1; page <= SL_MAX_PAGES; page++) {
      if ((page - 1) * 30 >= total) break;

      const url = this.buildSearchUrl(criteria, placeId, page);
      const html = await browser.fetchPage(url, {
        waitForSelector: '[data-testid="serp-core-classified-card-testid"]',
      });

      if (page === 1) {
        total = this.parseTotal(html);
        console.log(`[seloger] total: ${total}`);
      }

      const ads = this.parseCards(html);
      if (!ads.length) break;

      const before = byId.size;
      for (const ad of ads) byId.set(ad.id, ad);
      // the SERP occasionally re-serves cards; a page with nothing new means
      // we've reached the end regardless of what `total` claims
      if (byId.size === before) break;

      if (ads.length < 30) break;
      await new Promise((r) => setTimeout(r, 1_500 + Math.random() * 2_000));
    }

    const all = [...byId.values()];
    console.log(`[seloger] raw ads: ${all.length}`);
    return all;
  }

  /**
   * SeLoger geo-searches by internal place id (AD08FR…). The legacy URL
   * `/immobilier/locations/immo-{citySlug}-{dept}/` 301s to the canonical
   * search page whose <link rel="canonical"> ends with the id.
   */
  private async resolvePlaceId(city: string, zipCode: string): Promise<string | null> {
    const key = `${city}|${zipCode}`;
    const cached = this.placeIdCache.get(key);
    if (cached) return cached;

    const slug = this.slugify(city);
    const dept = zipCode.slice(0, 2);
    const url = `${SL_ORIGIN}/immobilier/locations/immo-${slug}-${dept}/`;

    let html: string;
    try {
      html = await BrowserClient.get().fetchPage(url);
    } catch (err) {
      console.warn('[seloger] place resolution failed:', (err as Error).message);
      return null;
    }

    const canonical = html.match(/<link rel="canonical" href="[^"]*\/(ad08fr\d+)"/i);
    const placeId = canonical?.[1]?.toUpperCase() ?? null;
    if (placeId) this.placeIdCache.set(key, placeId);
    return placeId;
  }

  private buildSearchUrl(c: FilterCriteria, placeId: string, page: number): string {
    const params = new URLSearchParams({
      distributionTypes: 'Rent',
      estateTypes: 'Apartment',
      locations: placeId,
      priceMax: String(c.maxPrice),
    });
    if (c.minSurfaceM2 > 0) params.set('spaceMin', String(c.minSurfaceM2));
    if (page > 1) params.set('page', String(page));
    return `${SL_ORIGIN}/classified-search?${params.toString()}`;
  }

  private parseTotal(html: string): number {
    const $ = cheerio.load(html);
    // H1: "7 026 appartements à louer – Paris"
    const h1 = $('[data-testid="serp-title-variant-a-testid"]').text();
    const m = h1.replace(/[\s  ]/g, '').match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  private parseCards(html: string): RawAd[] {
    const $ = cheerio.load(html);
    const ads: RawAd[] = [];

    $('[data-testid="serp-core-classified-card-testid"]').each((_, el) => {
      const $card = $(el);

      const href = $card.find('a[href*="/annonces/"]').first().attr('href') ?? '';
      const id = href.match(/\/([A-Za-z0-9]+)\.htm/)?.[1];
      if (!id) return; // partner/external card without a classified link

      const priceText = $card.find('[data-testid="cardmfe-price-testid"]').text();
      const price = parseInt(priceText.replace(/[\s  ]/g, '').match(/(\d+)€/)?.[1] ?? '0', 10);
      if (!price) return;

      // "5 pièces·3 chambres·116,1 m²·2ème étage"
      const facts = $card.find('[data-testid="cardmfe-keyfacts-testid"]').text();
      const rooms = parseInt(facts.match(/(\d+)\s*pi[èe]ce/)?.[1] ?? '0', 10);
      const surfaceArea = Math.round(
        parseFloat(facts.match(/([\d,.]+)\s*m²/)?.[1]?.replace(',', '.') ?? '0')
      );

      // "Centre, Brest (29200)" or "Brest (29200)"
      const addr = $card.find('[data-testid="cardmfe-description-box-address"]').text().trim();
      const addrMatch = addr.match(/([^,(]+)\s*\((\d{5})\)\s*$/);
      const city = addrMatch?.[1]?.trim() ?? '';
      const zipCode = addrMatch?.[2] ?? '';

      const description = $card
        .find('[data-testid="cardmfe-description-text-test-id"]')
        .text()
        .replace(/\s+/g, ' ')
        .trim();

      // Two img alts per card: the agency logo (agency name) and the photo
      // ("Appartement à louer 630 € 2 pièces … Brest 29200")
      let agencyName = '';
      let photoAlt = '';
      $card.find('img[alt]').each((_, img) => {
        const alt = ($(img).attr('alt') ?? '').trim();
        if (!alt) return;
        if (/à louer/i.test(alt)) {
          if (!photoAlt) photoAlt = alt;
        } else if (!agencyName) {
          agencyName = alt;
        }
      });

      const title = photoAlt
        ? photoAlt.replace(/\s+/g, ' ').slice(0, 120)
        : `Appartement ${rooms ? `${rooms} pièces ` : ''}${surfaceArea ? `${surfaceArea} m² ` : ''}— ${city}`;

      const text = `${title} ${description}`;

      ads.push({
        id: `sl-${id}`,
        source: this.sourceName,
        title,
        url: `${SL_ORIGIN}/annonces/${href.split('/annonces/')[1]?.split('?')[0] ?? `${id}.htm`}`,
        price,
        surfaceArea,
        rooms,
        // SeLoger listings are near-universally agency-published; only an
        // explicit "particulier" mention marks a private landlord
        isPro: agencyName !== '' && !/particulier/i.test(agencyName),
        isFurnished: inferFurnished(text),
        isColocation: /^colocation/i.test(photoAlt) || isColocation(text),
        location: { city, zipCode },
        imageUrl: $card.find('img[src*="mms.seloger.com"]').first().attr('src'),
      });
    });

    return ads;
  }

  /** "Saint-Martin-des-Champs" → "saint-martin-des-champs" */
  private slugify(city: string): string {
    return city
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
