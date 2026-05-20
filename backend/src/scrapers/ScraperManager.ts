import { BaseScraper, RawAd, FilterCriteria } from '../types';

export class ScraperManager {
  private registry: BaseScraper[] = [];

  register(scraper: BaseScraper): void {
    this.registry.push(scraper);
  }

  async runAll(criteria: FilterCriteria): Promise<RawAd[]> {
    const results = await Promise.allSettled(
      this.registry.map((s) => s.scrape(criteria))
    );

    const ads: RawAd[] = [];

    for (const [i, result] of results.entries()) {
      const name = this.registry[i]?.sourceName ?? 'unknown';
      if (result.status === 'fulfilled') {
        console.log(`[${name}] scraped ${result.value.length} ads`);
        ads.push(...result.value);
      } else {
        console.error(`[${name}] scrape failed:`, result.reason);
      }
    }

    return ads;
  }
}
