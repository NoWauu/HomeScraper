import axios, { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { BaseScraper, RawAd, FilterCriteria, GeoCenter } from '../types';
import { haversineKm } from '../utils/geo';
import { inferFurnished, isColocation } from '../utils/text';

const LOKAVIZ_ORIGIN = 'https://www.lokaviz.fr';
const SEARCH_FORM = `${LOKAVIZ_ORIGIN}/rechercher-un-logement/n:39`;
const COMMUNE_LOOKUP = `${LOKAVIZ_ORIGIN}/commcomp.php`;
const SEARCH_BASE = `${LOKAVIZ_ORIGIN}/rechercher-un-logement/fiche-logement/affichage:liste`;

const LOKAVIZ_MAX_PAGES = 15;
// Lokaviz meublé filter values (reflogmeuble_id[])
const MEUBLE_FURNISHED = '5';
const MEUBLE_UNFURNISHED = '6';

/**
 * Lokaviz (national CROUS student-housing portal). Plain PHP site, no anti-bot,
 * so a direct HTTP client is enough. Geographic filtering is by commune: we
 * resolve the commune id via the site's own autocomplete endpoint, then run the
 * list search within a km radius. Server applies price + furnished + geo; we
 * apply surface + rooms + exact distance ourselves (Lokaviz has no surface or
 * room-count filter, only dwelling-type checkboxes which are too coarse).
 */
export class LokavizScraper implements BaseScraper {
  readonly sourceName = 'lokaviz';

  async scrape(criteria: FilterCriteria, center?: GeoCenter): Promise<RawAd[]> {
    if (!center?.city) {
      console.warn('[lokaviz] no center city — skipping (cannot geo-scope, would return all France)');
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

    // 1. bootstrap a session cookie (VT_USER) from the search form
    const cookie = await this.getSessionCookie(http);
    const withCookie: Record<string, string> = cookie ? { Cookie: cookie } : {};

    // 2. resolve the commune id for the target city
    const communeId = await this.lookupCommuneId(http, withCookie, center);
    if (!communeId) {
      console.warn(`[lokaviz] commune lookup failed for "${center.city}" — skipping`);
      return [];
    }
    console.log(`[lokaviz] commune id for ${center.city}: ${communeId}`);

    // 3. paginate the list search
    const all: RawAd[] = [];
    for (let page = 1; page <= LOKAVIZ_MAX_PAGES; page++) {
      const url = this.buildSearchUrl(criteria, center, communeId, page);
      if (page === 1) console.log('[lokaviz] search url:', url);

      const res = await http.get<string>(url, { headers: withCookie, responseType: 'text' });
      const ads = this.parseCards(res.data);
      if (!ads.length) break;
      all.push(...ads);
      if (ads.length < 6) break; // Lokaviz renders 6 cards/page
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 800));
    }

    console.log(`[lokaviz] raw ads: ${all.length}`);

    // 4. apply the filters Lokaviz can't do server-side
    const filtered = all.filter((ad) => {
      if (ad.price > criteria.maxPrice) return false;
      if (ad.surfaceArea > 0 && ad.surfaceArea < criteria.minSurfaceM2) return false;
      if (ad.rooms > 0 && ad.rooms < criteria.minRooms) return false;
      if (criteria.furnished !== 'any' && ad.isFurnished !== undefined) {
        if (ad.isFurnished !== (criteria.furnished === 'furnished')) return false;
      }
      const { latitude, longitude } = ad.location;
      if (latitude !== undefined && longitude !== undefined) {
        if (haversineKm(latitude, longitude, center.lat, center.lon) > criteria.maxDistanceKm) return false;
      }
      return true;
    });
    console.log(`[lokaviz] after filters: ${filtered.length}`);
    return filtered;
  }

  private async getSessionCookie(http: AxiosInstance): Promise<string> {
    try {
      const res = await http.get(SEARCH_FORM, { responseType: 'text' });
      const setCookie = res.headers['set-cookie'];
      if (Array.isArray(setCookie)) {
        return setCookie.map((c) => c.split(';')[0]).join('; ');
      }
    } catch (err) {
      console.warn('[lokaviz] session bootstrap failed:', (err as Error).message);
    }
    return '';
  }

  private async lookupCommuneId(
    http: AxiosInstance,
    headers: Record<string, string>,
    center: GeoCenter
  ): Promise<string | null> {
    try {
      const res = await http.post<string>(
        COMMUNE_LOOKUP,
        new URLSearchParams({ comm: center.city! }).toString(),
        { headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, responseType: 'text' }
      );
      const $ = cheerio.load(res.data);
      const wantDept = center.zipCode?.slice(0, 2);
      let fallback: string | null = null;

      let picked: string | null = null;
      $('li[id]').each((_, li) => {
        const $li = $(li);
        const id = $li.attr('id');
        if (!id) return;
        const label = $li.find('strong').first().text().trim();
        const deptMatch = $li.text().match(/\((\d{2,3})\)/);
        const dept = deptMatch?.[1];
        const nameMatches = label.toLowerCase() === center.city!.toLowerCase();
        if (fallback === null) fallback = id;
        if (nameMatches && (!wantDept || dept === wantDept)) {
          picked = id;
          return false; // break
        }
      });
      return picked ?? fallback;
    } catch (err) {
      console.warn('[lokaviz] commune lookup error:', (err as Error).message);
      return null;
    }
  }

  private buildSearchUrl(
    c: FilterCriteria,
    center: GeoCenter,
    communeId: string,
    page: number
  ): string {
    const params = new URLSearchParams({
      NE: '', SW: '', ZOOM: '', pres_de: '', etab_id: '', nbkm: '3',
      comm: center.city!, commune_id: communeId,
      nbkmc: String(Math.max(1, Math.round(c.maxDistanceKm))),
      agglo: '', agglomeration_id: '', departement_id: '', region_id: '',
      loyer: String(c.maxPrice), dispo: '', ref: '',
    });
    if (c.furnished === 'furnished') params.append('reflogmeuble_id[]', MEUBLE_FURNISHED);
    else if (c.furnished === 'unfurnished') params.append('reflogmeuble_id[]', MEUBLE_UNFURNISHED);
    params.set('data[resultpp][limit]', '20');

    const pageSeg = page > 1 ? `/page:${page}` : '';
    return `${SEARCH_BASE}${pageSeg}?${params.toString()}`;
  }

  private parseCards(html: string): RawAd[] {
    const $ = cheerio.load(html);
    const ads: RawAd[] = [];

    $('.liste_annonces_content').each((_, el) => {
      const $card = $(el);
      const href = $card.find('a[href*="logement_id:"]').first().attr('href') ?? '';
      const idMatch = href.match(/logement_id:(\d+)/);
      if (!idMatch) return;
      const id = idMatch[1];

      const fullLeft = $card.find('div.left').text().replace(/\s+/g, ' ').trim();
      const path = href.split('?')[0].replace(/^\//, '');
      // descriptive slug sits right before the logement_id segment,
      // e.g. "t4-79-m2-meuble-en-colocation-brest-29200"
      const segs = path.split('/');
      const idIdx = segs.findIndex((s) => s.startsWith('logement_id:'));
      const slug = (idIdx > 0 ? segs[idIdx - 1] : segs[segs.length - 1]) ?? '';

      const surfaceArea = parseInt(slug.match(/(\d+)-m2/)?.[1] ?? fullLeft.match(/(\d+)\s*m2/)?.[1] ?? '0', 10);
      const { rooms, typeLabel } = this.parseType(slug);

      // "Loyer : 430 €" (may be "par chambre")
      const loyerText = $card.find('span.loyer').first().text();
      const price = parseInt(loyerText.replace(/\s/g, '').match(/(\d+)/)?.[1] ?? '0', 10);
      if (!price) return;

      // address: "rue ... 29200 Brest"
      const addr = $card.find('p.adresse').last().text().replace(/\s+/g, ' ').trim();
      const zipCity = addr.match(/(\d{5})\s+(.+)$/);
      const zipCode = zipCity?.[1] ?? '';
      const city = (zipCity?.[2] ?? '').trim();

      // furnished: descriptor line ("Meublé, indépendant, ...") or slug ("...-meuble-...")
      const cardText = `${fullLeft} ${slug.replace(/-/g, ' ')}`;
      const isFurnished = inferFurnished(cardText);

      ads.push({
        id: `lokaviz-${id}`,
        source: this.sourceName,
        title: `${typeLabel} ${surfaceArea > 0 ? `${surfaceArea} m²` : ''}`.trim() + (city ? ` — ${city}` : ''),
        url: `${LOKAVIZ_ORIGIN}/${path}`,
        price,
        surfaceArea,
        rooms,
        isPro: false, // Lokaviz landlords are private / CROUS, no pro/particulier split
        isFurnished,
        isColocation: isColocation(cardText),
        location: { city, zipCode },
      });
    });

    return ads;
  }

  /** Derive room count + a display label from the listing slug. */
  private parseType(slug: string): { rooms: number; typeLabel: string } {
    const s = slug.toLowerCase();
    const t = s.match(/\bt(\d)/); // t1bis→1, t4→4, "…-dans-t4-…" not present in slug; slug starts with type
    if (t) {
      const n = parseInt(t[1], 10);
      return { rooms: n, typeLabel: /t\dbis/.test(s) ? `T${n}bis` : `T${n}` };
    }
    if (/studio|^t1\b/.test(s)) return { rooms: 1, typeLabel: 'Studio/T1' };
    if (/chambre/.test(s)) return { rooms: 1, typeLabel: 'Chambre' };
    return { rooms: 0, typeLabel: 'Logement' };
  }
}
