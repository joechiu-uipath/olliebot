/**
 * Website Crawler Native Tool
 *
 * Accepts a starting URL and performs a breadth-first crawl within the same
 * domain, collecting de-duplicated unique URLs. Stops when:
 *   - All reachable same-domain pages have been visited, or
 *   - The configured maximum URL count is reached (default 1,000).
 *
 * Supports two strategies:
 *   - "fast" (default): Plain HTTP fetch + regex link extraction. Very fast,
 *     but cannot see JS-rendered content.
 *   - "full": Uses a headless Playwright browser to render each page, then
 *     extracts links from the live DOM. Slower, but sees what the user sees
 *     (SPAs, client-side routing, lazy-loaded content).
 *
 * This tool uses the "display only result" pattern: the full URL collection
 * is displayed to the user via the UI event broadcast, but only a short
 * summary is sent to the LLM to conserve context tokens.
 */

import type { NativeTool, NativeToolResult, ToolExecutionContext } from './types.js';

/** Hard ceiling – never collect more than this regardless of user input. */
const ABSOLUTE_MAX_URLS = 1_000;

/** Default max URLs when the caller does not specify one. */
const DEFAULT_MAX_URLS = 1_000;

/** Per-request timeout in ms (fast strategy). */
const REQUEST_TIMEOUT_MS = 15_000;

/** Per-page navigation timeout in ms (full strategy). */
const PAGE_TIMEOUT_MS = 30_000;

/** Maximum concurrent fetches (fast) or pages (full) per batch. */
const CONCURRENCY_LIMIT_FAST = 10;
const CONCURRENCY_LIMIT_FULL = 3;

/** Delay between batches to be polite to the server (ms). */
const BATCH_DELAY_MS = 200;

/**
 * File extensions that are almost certainly not HTML pages.
 * We skip these to avoid wasting fetches on binary resources.
 */
const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.ogg', '.wav',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.css', '.js', '.mjs', '.map',
  '.xml', '.rss', '.atom',
  '.exe', '.dmg', '.apk', '.deb', '.rpm',
]);

type CrawlStrategy = 'fast' | 'full';

export class WebsiteCrawlerTool implements NativeTool {
  readonly name = 'website_crawler';
  readonly description =
    'Crawl a website starting from a given URL, collecting all unique same-domain URLs found via links. ' +
    'Returns a de-duplicated list of discovered URLs. Stops at a configurable maximum (default 1,000). ' +
    'Use strategy "fast" (default) for static HTML or "full" for JS-rendered/dynamic sites (uses headless browser). ' +
    'The full URL list is displayed to the user; only a summary is sent to the assistant.';

  readonly inputSchema = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The starting URL to begin crawling from (must be http or https).',
      },
      maxUrls: {
        type: 'number',
        description:
          'Maximum number of unique URLs to collect before stopping. ' +
          `Defaults to ${DEFAULT_MAX_URLS}. Hard limit is ${ABSOLUTE_MAX_URLS}.`,
      },
      strategy: {
        type: 'string',
        enum: ['fast', 'full'],
        description:
          'Crawl strategy. "fast" (default) uses plain HTTP fetch — very fast but cannot see ' +
          'JS-rendered content. "full" uses a headless browser (Playwright) to render each page — ' +
          'slower but sees dynamic/SPA content as the user would.',
      },
    },
    required: ['url'],
  };

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<NativeToolResult> {
    const url = String(params.url || '').trim();
    const maxUrls = Math.min(
      Math.max(Number(params.maxUrls) || DEFAULT_MAX_URLS, 1),
      ABSOLUTE_MAX_URLS,
    );
    const strategy: CrawlStrategy =
      params.strategy === 'full' ? 'full' : 'fast';

    // ── Validate URL ────────────────────────────────────────────────
    let startUrl: URL;
    try {
      startUrl = new URL(url);
      if (!['http:', 'https:'].includes(startUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return {
        success: false,
        error: 'Invalid URL. Must be a valid http or https URL.',
      };
    }

    const allowedOrigin = startUrl.origin;
    const concurrencyLimit = strategy === 'full'
      ? CONCURRENCY_LIMIT_FULL
      : CONCURRENCY_LIMIT_FAST;

    // ── BFS state ───────────────────────────────────────────────────
    const visited = new Set<string>();
    const discovered = new Set<string>();
    const queue: string[] = [];

    const canonicalStart = this.canonicalise(startUrl);
    discovered.add(canonicalStart);
    queue.push(canonicalStart);

    let pagesProcessed = 0;
    let errorCount = 0;

    // ── Full strategy: launch browser ───────────────────────────────
    let browser: import('playwright').Browser | null = null;
    let browserContext: import('playwright').BrowserContext | null = null;

    if (strategy === 'full') {
      try {
        const { chromium } = await import('playwright');
        browser = await chromium.launch({ headless: true });
        browserContext = await browser.newContext({
          userAgent: 'OllieBot-Crawler/1.0 (compatible)',
        });
      } catch (err) {
        return {
          success: false,
          error: `Failed to launch headless browser: ${err instanceof Error ? err.message : String(err)}. ` +
            'Ensure Playwright browsers are installed (npx playwright install chromium).',
        };
      }
    }

    // ── BFS loop ────────────────────────────────────────────────────
    try {
      while (queue.length > 0 && discovered.size < maxUrls) {
        const batchSize = Math.min(concurrencyLimit, queue.length, maxUrls - discovered.size);
        const batch = queue.splice(0, batchSize);

        const batchPromises = batch.map(async (pageUrl) => {
          if (visited.has(pageUrl)) return;
          visited.add(pageUrl);

          try {
            const links = strategy === 'full'
              ? await this.renderAndExtractLinks(browserContext!, pageUrl, allowedOrigin)
              : await this.fetchAndExtractLinks(pageUrl, allowedOrigin);
            pagesProcessed++;

            for (const link of links) {
              if (discovered.size >= maxUrls) break;
              if (!discovered.has(link)) {
                discovered.add(link);
                queue.push(link);
              }
            }
          } catch {
            errorCount++;
          }
        });

        await Promise.all(batchPromises);

        context?.onProgress?.({
          current: discovered.size,
          total: maxUrls,
          message: `[${strategy}] Discovered ${discovered.size} URL(s), fetched ${pagesProcessed} pages (${queue.length} queued)`,
        });

        if (queue.length > 0 && discovered.size < maxUrls) {
          await this.sleep(BATCH_DELAY_MS);
        }
      }
    } finally {
      // ── Clean up browser if we launched one ──────────────────────
      if (browserContext) {
        await browserContext.close().catch(() => {});
      }
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    // ── Build result ────────────────────────────────────────────────
    const sortedUrls = Array.from(discovered).sort();
    const hitLimit = discovered.size >= maxUrls;

    return {
      success: true,
      output: {
        startUrl: canonicalStart,
        domain: startUrl.hostname,
        strategy,
        totalUrls: sortedUrls.length,
        pagesProcessed,
        errorCount,
        hitLimit,
        urls: sortedUrls,
      },
      displayOnly: true,
      displayOnlySummary:
        `Crawled ${startUrl.hostname} starting from ${canonicalStart} (strategy: ${strategy}). ` +
        `Found ${sortedUrls.length} unique URL(s) (${pagesProcessed} pages fetched, ${errorCount} errors). ` +
        (hitLimit ? `Stopped at the ${maxUrls} URL limit. ` : 'All reachable pages visited. ') +
        'Full URL list displayed to user.',
    };
  }

  // ── Fast strategy helpers ───────────────────────────────────────────

  /**
   * Fetch a page via HTTP and extract same-origin <a href> links using regex.
   */
  private async fetchAndExtractLinks(pageUrl: string, allowedOrigin: string): Promise<string[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(pageUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'OllieBot-Crawler/1.0 (compatible)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      if (!response.ok) return [];

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return [];
      }

      const html = await response.text();
      return this.extractLinksFromHtml(html, pageUrl, allowedOrigin);
    } catch {
      clearTimeout(timeoutId);
      throw new Error(`Failed to fetch ${pageUrl}`);
    }
  }

  /**
   * Parse href attributes from <a> tags in raw HTML.
   */
  private extractLinksFromHtml(html: string, baseUrl: string, allowedOrigin: string): string[] {
    const links: string[] = [];
    const hrefRegex = /<a\s[^>]*href\s*=\s*["']([^"'#]+)/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html)) !== null) {
      const resolved = this.resolveAndFilter(match[1], baseUrl, allowedOrigin);
      if (resolved) links.push(resolved);
    }

    return links;
  }

  // ── Full strategy helpers ───────────────────────────────────────────

  /**
   * Render a page in a headless browser and extract same-origin links from
   * the live DOM. This sees JS-rendered content, client-side routing, etc.
   */
  private async renderAndExtractLinks(
    browserContext: import('playwright').BrowserContext,
    pageUrl: string,
    allowedOrigin: string,
  ): Promise<string[]> {
    const page = await browserContext.newPage();

    try {
      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT_MS,
      });

      // Wait a short moment for any immediate JS rendering
      await page.waitForTimeout(1000);

      // Extract all href values from the live DOM
      const hrefs: string[] = await page.$$eval('a[href]', (anchors: Element[]) =>
        anchors.map((a: Element) => a.getAttribute('href')).filter((h: string | null): h is string => !!h)
      );

      const links: string[] = [];
      const resolvedPageUrl = page.url(); // may differ after redirects

      for (const href of hrefs) {
        const resolved = this.resolveAndFilter(href, resolvedPageUrl, allowedOrigin);
        if (resolved) links.push(resolved);
      }

      return links;
    } catch {
      throw new Error(`Failed to render ${pageUrl}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  // ── Shared helpers ──────────────────────────────────────────────────

  /**
   * Resolve an href against a base URL, filter to same-origin, skip
   * non-page extensions, and canonicalise. Returns null if filtered out.
   */
  private resolveAndFilter(href: string, baseUrl: string, allowedOrigin: string): string | null {
    try {
      // Skip fragment-only links
      if (href.startsWith('#')) return null;

      const resolved = new URL(href, baseUrl);

      if (resolved.origin !== allowedOrigin) return null;

      const ext = this.getExtension(resolved.pathname);
      if (ext && SKIP_EXTENSIONS.has(ext)) return null;

      return this.canonicalise(resolved);
    } catch {
      return null;
    }
  }

  /**
   * Produce a canonical URL string: strip hash/fragment, normalise host.
   */
  private canonicalise(url: URL): string {
    const u = new URL(url.href);
    u.hash = '';
    return u.href;
  }

  /**
   * Get the file extension from a pathname (lowercase, including dot).
   */
  private getExtension(pathname: string): string | null {
    const lastDot = pathname.lastIndexOf('.');
    if (lastDot === -1 || lastDot < pathname.lastIndexOf('/')) return null;
    return pathname.slice(lastDot).toLowerCase().split('?')[0];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
