import path from 'path';
import { chromium, BrowserContext, Page } from 'patchright';

/**
 * Shared stealth browser for all scrapers that face anti-bot walls (DataDome, etc.).
 *
 * - patchright = stealth-patched Playwright (no CDP leaks, clean fingerprint)
 * - persistent profile keeps anti-bot cookies (e.g. datadome) between runs,
 *   so challenges are rare after the first successful visit
 * - single config point: swapping to a proxy/unblocker only touches this file
 *
 * Runs HEADED by default: DataDome 403s new-headless Chromium on the API
 * endpoint, but a real headed browser passes. On a server with no physical
 * display, run under a virtual one (xvfb-run) — the `npm start`/`dev` scripts
 * already do this, so it stays fully automated.
 *
 * Env:
 *   BROWSER_HEADLESS=true   → force headless (will likely be DataDome-blocked)
 *   BROWSER_PROFILE_DIR     → override profile location (default backend/.browser-profile)
 */

const PROFILE_DIR =
  process.env['BROWSER_PROFILE_DIR'] ??
  path.resolve(__dirname, '..', '..', '.browser-profile');

const HEADLESS = process.env['BROWSER_HEADLESS'] === 'true';

function isChallengePage(html: string): boolean {
  // DataDome interstitial embeds its captcha iframe from geo.captcha-delivery.com.
  // Don't match on 'datadome' alone — normal pages load the DataDome JS tag too.
  return html.includes('geo.captcha-delivery.com') || html.includes('interstitial-delivery.com');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class BrowserClient {
  private static instance: BrowserClient | null = null;
  private context: BrowserContext | null = null;
  /** one long-lived tab per origin, warmed via the homepage */
  private pages = new Map<string, Page>();

  static get(): BrowserClient {
    if (!BrowserClient.instance) BrowserClient.instance = new BrowserClient();
    return BrowserClient.instance;
  }

  private async getContext(): Promise<BrowserContext> {
    // reuse only if the browser is still alive — a crashed/killed Chromium
    // leaves a dead reference that would fail every later run
    if (this.context && this.context.browser()?.isConnected()) return this.context;
    if (this.context) await this.resetContext();

    this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: 'chromium', // full Chromium in new-headless mode, not the detectable headless shell
      headless: HEADLESS,
      viewport: { width: 1366, height: 768 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      // no custom user-agent or flags: patchright ships a consistent real-Chrome fingerprint
    });

    this.context.setDefaultTimeout(30_000);
    // if Chromium dies for any reason, drop the stale refs so the next call relaunches
    this.context.on('close', () => {
      this.context = null;
      this.pages.clear();
    });
    return this.context;
  }

  private async resetContext(): Promise<void> {
    const ctx = this.context;
    this.context = null;
    this.pages.clear();
    await ctx?.close().catch(() => {});
  }

  /**
   * DataDome hard-blocks cold deep-links (straight to /recherche) with
   * "Accès temporairement restreint". Real users land on the homepage first,
   * accept the cookie banner, then click through — so we keep one long-lived
   * tab per origin that starts on the homepage, and reuse it for every fetch.
   * Subsequent navigations then carry a real Referer / same-origin signal.
   */
  private async warmedPage(origin: string): Promise<Page> {
    const existing = this.pages.get(origin);
    if (existing && !existing.isClosed()) return existing;

    let context = await this.getContext();
    let page: Page;
    try {
      page = await context.newPage();
    } catch {
      // context died between the liveness check and newPage — relaunch once
      await this.resetContext();
      context = await this.getContext();
      page = await context.newPage();
    }
    await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(2_000 + Math.random() * 1_500);

    // Didomi cookie consent — accept so the session looks like a normal visit
    const consent = page.locator('#didomi-notice-agree-button');
    if (await consent.count().catch(() => 0)) {
      await consent.first().click({ timeout: 5_000 }).catch(() => {});
      await sleep(1_000 + Math.random() * 1_000);
    }
    // small human-like scroll to feed behavioral scripts
    await page.mouse.wheel(0, 600 + Math.random() * 800).catch(() => {});
    await sleep(1_200 + Math.random() * 1_200);

    this.pages.set(origin, page);
    return page;
  }

  /**
   * Navigate the warmed tab to `url` and return its HTML. Passes a same-origin
   * Referer so the request reads as an in-site click, not a cold deep-link.
   * Detects the DataDome challenge and retries after a wait.
   *
   * `waitForSelector`: for pages that render their content client-side after
   * hydration, wait until this selector exists before snapshotting the HTML
   * (best-effort — a page with zero results never matches, so we time-box it).
   */
  async fetchPage(url: string, opts?: { maxRetries?: number; waitForSelector?: string }): Promise<string> {
    const maxRetries = opts?.maxRetries ?? 2;
    const origin = new URL(url).origin;
    const page = await this.warmedPage(origin);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = 4_000 * attempt + Math.random() * 2_000;
        console.warn(`[browser] challenge detected, retry ${attempt}/${maxRetries} in ${Math.round(backoff / 1000)}s`);
        await sleep(backoff);
      }

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000, referer: `${origin}/` });
      await sleep(1_500 + Math.random() * 1_000);
      if (opts?.waitForSelector) {
        await page.waitForSelector(opts.waitForSelector, { timeout: 8_000 }).catch(() => {});
      }

      const html = await page.content();
      if (!isChallengePage(html)) return html;
    }

    if (process.env['BROWSER_DEBUG_SHOT']) {
      await page.screenshot({ path: process.env['BROWSER_DEBUG_SHOT'], fullPage: true }).catch(() => {});
    }
    throw new Error(`Anti-bot challenge not cleared after ${maxRetries} retries: ${url}`);
  }

  /**
   * Call a JSON API from inside a warmed browser tab. The `fetch` runs in the
   * page's own context, so it carries the site's real cookies (incl. DataDome)
   * and a trusted origin — the same request the site's own SPA makes. This is
   * how we reach DataDome-walled endpoints (e.g. leboncoin's finder/search)
   * without ever hitting the interstitial. Re-warms and retries on 403.
   */
  async apiFetch<T>(opts: {
    siteOrigin: string; // page to warm and run the fetch from, e.g. https://www.leboncoin.fr
    url: string; // API endpoint (may be a different subdomain — CORS is allowed by the site)
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
    maxRetries?: number;
  }): Promise<T> {
    const { siteOrigin, url, method = 'POST', headers = {}, body } = opts;
    const maxRetries = opts.maxRetries ?? 2;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const backoff = 4_000 * attempt + Math.random() * 2_000;
        console.warn(`[browser] api blocked, retry ${attempt}/${maxRetries} in ${Math.round(backoff / 1000)}s`);
        await sleep(backoff);
        // drop the tab so warm-up mints a fresh DataDome cookie
        const stale = this.pages.get(siteOrigin);
        if (stale && !stale.isClosed()) await stale.close().catch(() => {});
        this.pages.delete(siteOrigin);
      }

      const page = await this.warmedPage(siteOrigin);
      const result = await page.evaluate(
        async (a: { url: string; method: string; headers: Record<string, string>; body: string | null }) => {
          const res = await fetch(a.url, {
            method: a.method,
            headers: a.headers,
            body: a.body,
            credentials: 'include',
          });
          const text = await res.text();
          return { status: res.status, text };
        },
        {
          url,
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: body === undefined ? null : JSON.stringify(body),
        }
      );

      if (result.status >= 200 && result.status < 300) {
        return JSON.parse(result.text) as T;
      }
      console.warn(`[browser] api ${url} → ${result.status}`);
    }

    throw new Error(`API call blocked after ${maxRetries} retries: ${url}`);
  }

  async close(): Promise<void> {
    this.pages.clear();
    await this.context?.close();
    this.context = null;
  }
}
