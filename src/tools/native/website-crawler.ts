/**
 * Website Crawler Native Tool
 *
 * Accepts a starting URL and performs a breadth-first crawl within the same
 * domain, collecting de-duplicated unique URLs. Stops when:
 *   - All reachable same-domain pages have been visited, or
 *   - The configured maximum URL count is reached (default 10,000).
 *
 * This tool uses the "display only result" pattern: the full URL collection
 * is displayed to the user via the UI event broadcast, but only a short
 * summary is sent to the LLM to conserve context tokens.
 */

import type { NativeTool, NativeToolResult } from './types.js';

/** Hard ceiling – never collect more than this regardless of user input. */
const ABSOLUTE_MAX_URLS = 1_000;

/** Default max URLs when the caller does not specify one. */
const DEFAULT_MAX_URLS = 1_000;

/** Per-request timeout in ms. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Maximum concurrent fetches to avoid overwhelming the target. */
const CONCURRENCY_LIMIT = 10;

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

export class WebsiteCrawlerTool implements NativeTool {
  readonly name = 'website_crawler';
  readonly description =
    'Crawl a website starting from a given URL, collecting all unique same-domain URLs found via links. ' +
    'Returns a de-duplicated list of discovered URLs. Stops at a configurable maximum (default 1,000). ' +
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
    },
    required: ['url'],
  };

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const url = String(params.url || '').trim();
    const maxUrls = Math.min(
      Math.max(Number(params.maxUrls) || DEFAULT_MAX_URLS, 1),
      ABSOLUTE_MAX_URLS,
    );

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

    const allowedOrigin = startUrl.origin; // e.g. "https://example.com"

    // ── BFS state ───────────────────────────────────────────────────
    const visited = new Set<string>();   // canonical URLs we have fetched
    const discovered = new Set<string>(); // all unique URLs found (visited + queued)
    const queue: string[] = [];           // URLs still to fetch

    const canonicalStart = this.canonicalise(startUrl);
    discovered.add(canonicalStart);
    queue.push(canonicalStart);

    let pagesProcessed = 0;
    let errorCount = 0;

    // ── BFS loop ────────────────────────────────────────────────────
    while (queue.length > 0 && discovered.size < maxUrls) {
      // Take a batch from the front of the queue
      const batchSize = Math.min(CONCURRENCY_LIMIT, queue.length, maxUrls - discovered.size);
      const batch = queue.splice(0, batchSize);

      const batchPromises = batch.map(async (pageUrl) => {
        if (visited.has(pageUrl)) return;
        visited.add(pageUrl);

        try {
          const links = await this.fetchAndExtractLinks(pageUrl, allowedOrigin);
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
          // Silently skip unreachable pages – keep crawling.
        }
      });

      await Promise.all(batchPromises);

      // Small delay between batches to avoid hammering the server
      if (queue.length > 0 && discovered.size < maxUrls) {
        await this.sleep(BATCH_DELAY_MS);
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
        totalUrls: sortedUrls.length,
        pagesProcessed,
        errorCount,
        hitLimit,
        urls: sortedUrls,
      },
      // ── Display-only: full output goes to UI, summary goes to LLM ──
      displayOnly: true,
      displayOnlySummary:
        `Crawled ${startUrl.hostname} starting from ${canonicalStart}. ` +
        `Found ${sortedUrls.length} unique URL(s) (${pagesProcessed} pages fetched, ${errorCount} errors). ` +
        (hitLimit ? `Stopped at the ${maxUrls} URL limit. ` : 'All reachable pages visited. ') +
        'Full URL list displayed to user.',
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  /**
   * Fetch a page and extract all same-origin <a href> links.
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

      // Only parse HTML responses
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return [];
      }

      const html = await response.text();
      return this.extractLinks(html, pageUrl, allowedOrigin);
    } catch {
      clearTimeout(timeoutId);
      throw new Error(`Failed to fetch ${pageUrl}`);
    }
  }

  /**
   * Parse href attributes from <a> tags and return canonical same-origin URLs.
   */
  private extractLinks(html: string, baseUrl: string, allowedOrigin: string): string[] {
    const links: string[] = [];
    // Match href attributes in anchor tags.  This intentionally uses a simple
    // regex rather than a full DOM parser – it's lightweight and sufficient
    // for link discovery.
    const hrefRegex = /<a\s[^>]*href\s*=\s*["']([^"'#]+)/gi;
    let match: RegExpExecArray | null;

    while ((match = hrefRegex.exec(html)) !== null) {
      try {
        const resolved = new URL(match[1], baseUrl);

        // Same origin only
        if (resolved.origin !== allowedOrigin) continue;

        // Skip non-page extensions
        const ext = this.getExtension(resolved.pathname);
        if (ext && SKIP_EXTENSIONS.has(ext)) continue;

        const canonical = this.canonicalise(resolved);
        links.push(canonical);
      } catch {
        // Malformed URL – skip
      }
    }

    return links;
  }

  /**
   * Produce a canonical URL string: strip hash/fragment, normalise trailing
   * slashes, and lowercase the host.
   */
  private canonicalise(url: URL): string {
    const u = new URL(url.href);
    u.hash = '';
    // Normalise: remove default ports, lowercase host (URL constructor does this)
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
