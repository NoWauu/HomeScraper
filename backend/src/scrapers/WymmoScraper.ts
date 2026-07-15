import axios from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { inferFurnished, isColocation } from '../utils/text';

const WYMMO_ORIGIN = 'https://wymmo.com';
const WYMMO_SEARCH = `${WYMMO_ORIGIN}/search`;

/**
 * Wymmo (wymmo.com) — a French real-estate aggregator with a natural-language
 * search (`/search?q=…`). Plain server-rendered HTML, no anti-bot wall, so a
 * direct HTTP client + cheerio is enough.
 *
 * Two quirks drive the design:
 *  1. The `?q=` free-text filters (price / surface / rooms) are unreliable — the
 *     parser silently ignores them, so we only scope the query by intent
 *     ("Location") + city + zip and let the pipeline apply price/surface/rooms/
 *     furnished downstream (same as the other sources).
 *  2. Results are a single page (~40 cards, no pagination) and carry no per-ad
 *     coordinates. City + zip come from the ad URL slug; the pipeline's centroid
 *     fallback handles distance from there.
 *
 * A plain city query returns *sale* listings, so we require the "Location"
 * intent word and keep only `/ad/rental/` hrefs.
 */
export class WymmoScraper implements BaseScraper {
  readonly sourceName = 'wymmo';

  async scrape(_criteria: FilterCriteria, center?: GeoCenter): Promise<RawAd[]> {
    if (!center?.city) {
      console.warn('[wymmo] no center city — skipping (cannot geo-scope, would return all France)');
      return [];
    }

    const http = axios.create({
      timeout: 20_000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9',
      },
    });

    const q = ['Location', center.city, center.zipCode].filter(Boolean).join(' ');
    const url = `${WYMMO_SEARCH}?q=${encodeURIComponent(q)}`;
    console.log('[wymmo] search url:', url);

    let html: string;
    try {
      const res = await http.get<string>(url, { responseType: 'text' });
      html = res.data;
    } catch (err) {
      console.warn('[wymmo] search request failed:', (err as Error).message);
      return [];
    }

    const ads = this.parseCards(html);
    console.log(`[wymmo] raw rental ads: ${ads.length}`);
    return ads;
  }

  private parseCards(html: string): RawAd[] {
    const $ = cheerio.load(html);
    const ads: RawAd[] = [];

    $('a.card').each((_, el) => {
      const $card = $(el);
      const href = $card.attr('href') ?? '';
      // /ad/rental/{propertyType}/{city}/{zip}/{slug}/{id1}/{id2}
      const m = href.match(/\/ad\/rental\/([^/]+)\/([^/]+)\/([^/]+)\/[^/]+\/([^/]+)\/([^/?#]+)/);
      if (!m) return; // skip sale listings / anything off-pattern

      const propertyType = m[1];
      const citySlug = m[2];
      const zipCode = /^\d{5}$/.test(m[3]) ? m[3] : '';
      const id = `${m[4]}-${m[5]}`;

      const title = $card.find('.card-title').first().text().replace(/\s+/g, ' ').trim();
      // "590 € - Location - Appartement Brest"
      const price = parseInt(title.replace(/\s/g, '').match(/(\d+)€/)?.[1] ?? '0', 10);
      if (!price) return;

      // features-list: one <li> is the type/rooms ("studio" | "N pièces"),
      // another is the surface ("28.00 m²")
      let rooms = 0;
      let surfaceArea = 0;
      $card.find('.features-list li').each((_, li) => {
        const t = $(li).text().replace(/\s+/g, ' ').trim().toLowerCase();
        if (/m²/.test(t)) {
          surfaceArea = Math.round(parseFloat(t.match(/([\d.]+)\s*m²/)?.[1] ?? '0'));
        } else if (/studio/.test(t)) {
          rooms = 1;
        } else {
          const p = t.match(/(\d+)\s*pi[èe]ce/);
          if (p) rooms = parseInt(p[1], 10);
        }
      });

      const neighborhood = $card.find('h2').first().text().replace(/\s+/g, ' ').trim();
      const description = $card.find('p').first().text().replace(/\s+/g, ' ').trim();
      const city = this.deslug(citySlug);

      const text = `${title} ${neighborhood} ${description}`;
      const isFurnished = inferFurnished(text);

      const img = $card.find('img.miniature-img').first().attr('src');

      ads.push({
        id: `wymmo-${id}`,
        source: this.sourceName,
        title: title || `${propertyType} ${surfaceArea || '?'}m² — ${city}`,
        url: href.startsWith('http') ? href : `${WYMMO_ORIGIN}${href}`,
        price,
        surfaceArea,
        rooms,
        isPro: false, // Wymmo aggregates without a reliable pro/particulier flag
        isFurnished,
        isColocation: isColocation(text),
        location: { city, zipCode },
        imageUrl: img,
      });
    });

    return ads;
  }

  /** "saint-martin-des-champs" → "Saint-Martin-Des-Champs" */
  private deslug(slug: string): string {
    return slug
      .split('-')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join('-');
  }
}
