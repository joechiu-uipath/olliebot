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
 * After crawling, the tool can optionally download each page's content,
 * extract human-readable text (preserving meta tags), and save to a RAG
 * project folder for later indexing.
 *
 * This tool uses the "display only result" pattern: the full URL collection
 * is displayed to the user via the UI event broadcast, but only a short
 * summary is sent to the LLM to conserve context tokens.
 */

import type { NativeTool, NativeToolResult, ToolExecutionContext } from './types.js';
import type { RAGProjectService } from '../../rag-projects/service.js';
import { convert as htmlToText } from 'html-to-text';
import { existsSync, mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';

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
    'Downloads each page, extracts human-readable text (preserving meta tags), and saves to a RAG project folder. ' +
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

  private ragService: RAGProjectService | null;
  private ragDir: string;

  constructor(options?: { ragService?: RAGProjectService; ragDir?: string }) {
    this.ragService = options?.ragService || null;
    this.ragDir = options?.ragDir || join(process.cwd(), 'user', 'rag');
  }

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

    // ── Create RAG project folder ───────────────────────────────────
    const projectId = this.urlToFolderName(startUrl);
    const projectPath = join(this.ragDir, projectId);
    const documentsPath = join(projectPath, 'documents');

    // Create directories
    if (!existsSync(documentsPath)) {
      mkdirSync(documentsPath, { recursive: true });
    }

    // ── BFS state ───────────────────────────────────────────────────
    const visited = new Set<string>();
    const discovered = new Set<string>();
    const queue: string[] = [];
    // Store HTML content for later processing
    const pageContents = new Map<string, string>();

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
    // Note: maxUrls controls how many pages we actually FETCH (not just discover)
    try {
      while (queue.length > 0 && pagesProcessed < maxUrls) {
        const batchSize = Math.min(concurrencyLimit, queue.length, maxUrls - pagesProcessed);
        const batch = queue.splice(0, batchSize);

        const batchPromises = batch.map(async (pageUrl) => {
          if (visited.has(pageUrl)) return;
          visited.add(pageUrl);

          // Check if we've hit the limit (another concurrent request may have incremented)
          if (pagesProcessed >= maxUrls) return;

          try {
            const result = strategy === 'full'
              ? await this.renderAndExtractLinksWithContent(browserContext!, pageUrl, allowedOrigin)
              : await this.fetchAndExtractLinksWithContent(pageUrl, allowedOrigin);
            pagesProcessed++;

            // Store page content for later saving
            if (result.html) {
              pageContents.set(pageUrl, result.html);
            }

            // Keep discovering links (for queue) but don't let discovered count limit us
            for (const link of result.links) {
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
          current: pagesProcessed,
          total: maxUrls,
          message: `[${strategy}] Fetched ${pagesProcessed}/${maxUrls} pages (${discovered.size} URLs discovered, ${queue.length} queued)`,
        });

        if (queue.length > 0 && pagesProcessed < maxUrls) {
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

    // ── Extract text and save files ─────────────────────────────────
    context?.onProgress?.({
      current: 0,
      total: pageContents.size,
      message: `Extracting and saving ${pageContents.size} page(s) to RAG project "${projectId}"...`,
    });

    let savedCount = 0;
    let saveErrors = 0;

    for (const [pageUrl, html] of pageContents) {
      try {
        const textContent = this.extractTextWithMeta(html, pageUrl);
        const filename = this.urlToFilename(pageUrl);
        const filePath = join(documentsPath, filename);
        await writeFile(filePath, textContent, 'utf-8');
        savedCount++;

        context?.onProgress?.({
          current: savedCount,
          total: pageContents.size,
          message: `Saved ${savedCount}/${pageContents.size} pages`,
        });
      } catch {
        saveErrors++;
      }
    }

    // ── Emit projects_changed to refresh UI ─────────────────────────
    if (this.ragService) {
      this.ragService.emit('projects_changed');
    }

    // ── Build result ────────────────────────────────────────────────
    const sortedUrls = Array.from(discovered).sort();
    const hitLimit = pagesProcessed >= maxUrls;

    return {
      success: true,
      output: {
        startUrl: canonicalStart,
        domain: startUrl.hostname,
        strategy,
        urlsDiscovered: sortedUrls.length,
        pagesFetched: pagesProcessed,
        errorCount,
        hitLimit,
        ragProject: projectId,
        savedPages: savedCount,
        saveErrors,
        urls: sortedUrls,
      },
      displayOnly: true,
      displayOnlySummary:
        `Crawled ${startUrl.hostname} starting from ${canonicalStart} (strategy: ${strategy}). ` +
        `Fetched ${pagesProcessed} pages (discovered ${sortedUrls.length} URLs, ${errorCount} errors). ` +
        (hitLimit ? `Stopped at the ${maxUrls} page limit. ` : 'All reachable pages visited. ') +
        `Saved ${savedCount} pages to RAG project "${projectId}" (${saveErrors} save errors). ` +
        'Full URL list displayed to user.',
    };
  }

  // ── Fast strategy helpers ───────────────────────────────────────────

  /**
   * Fetch a page via HTTP and extract same-origin <a href> links using regex.
   * Also returns the raw HTML for later text extraction.
   */
  private async fetchAndExtractLinksWithContent(
    pageUrl: string,
    allowedOrigin: string
  ): Promise<{ links: string[]; html: string | null }> {
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

      if (!response.ok) return { links: [], html: null };

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        return { links: [], html: null };
      }

      const html = await response.text();
      const links = this.extractLinksFromHtml(html, pageUrl, allowedOrigin);
      return { links, html };
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
   * Also returns the raw HTML for later text extraction.
   */
  private async renderAndExtractLinksWithContent(
    browserContext: import('playwright').BrowserContext,
    pageUrl: string,
    allowedOrigin: string,
  ): Promise<{ links: string[]; html: string | null }> {
    const page = await browserContext.newPage();

    try {
      await page.goto(pageUrl, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT_MS,
      });

      // Wait a short moment for any immediate JS rendering
      await page.waitForTimeout(1000);

      // Get the full HTML content
      const html = await page.content();

      // Extract all href values from the live DOM
      const hrefs: string[] = await page.$$eval('a[href]', (anchors) =>
        anchors.map((a) => a.getAttribute('href')).filter((h): h is string => !!h)
      );

      const links: string[] = [];
      const resolvedPageUrl = page.url(); // may differ after redirects

      for (const href of hrefs) {
        const resolved = this.resolveAndFilter(href, resolvedPageUrl, allowedOrigin);
        if (resolved) links.push(resolved);
      }

      return { links, html };
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
   * Produce a canonical URL string: strip hash/fragment, normalise host,
   * remove default ports, and normalize trailing slashes.
   */
  private canonicalise(url: URL): string {
    const u = new URL(url.href);

    // Strip fragment/hash
    u.hash = '';

    // Lowercase hostname for case-insensitive comparison
    u.hostname = u.hostname.toLowerCase();

    // Remove default ports (80 for http, 443 for https)
    if ((u.protocol === 'http:' && u.port === '80') ||
        (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }

    // Normalize trailing slash: add one if pathname is empty or just '/'
    // For paths with actual content, preserve as-is (don't enforce trailing slash)
    if (u.pathname === '' || u.pathname === '/') {
      u.pathname = '/';
    }

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

  // ── Text extraction helpers ────────────────────────────────────────

  /**
   * Extract meta tags and human-readable text from HTML.
   * Meta tags are placed at the top of the output.
   */
  private extractTextWithMeta(html: string, sourceUrl: string): string {
    const lines: string[] = [];

    // Add source URL at the top
    lines.push(`Source: ${sourceUrl}`);
    lines.push('');

    // Extract meta tags
    const metaTags = this.extractMetaTags(html);
    if (metaTags.length > 0) {
      lines.push('--- Meta Tags ---');
      for (const meta of metaTags) {
        lines.push(`${meta.name}: ${meta.content}`);
      }
      lines.push('');
    }

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch && titleMatch[1].trim()) {
      lines.push(`Title: ${titleMatch[1].trim()}`);
      lines.push('');
    }

    lines.push('--- Content ---');
    lines.push('');

    // Convert HTML to text using html-to-text
    const text = htmlToText(html, {
      wordwrap: false,
      preserveNewlines: true,
      selectors: [
        // Skip script and style elements
        { selector: 'script', format: 'skip' },
        { selector: 'style', format: 'skip' },
        { selector: 'noscript', format: 'skip' },
        { selector: 'nav', format: 'skip' },
        { selector: 'footer', format: 'skip' },
        { selector: 'header', format: 'skip' },
        // Format headings
        { selector: 'h1', format: 'heading', options: { uppercase: false } },
        { selector: 'h2', format: 'heading', options: { uppercase: false } },
        { selector: 'h3', format: 'heading', options: { uppercase: false } },
        { selector: 'h4', format: 'heading', options: { uppercase: false } },
        // Format links to show text without URL
        { selector: 'a', format: 'anchor', options: { ignoreHref: true } },
        // Format images as [image] placeholder
        { selector: 'img', format: 'skip' },
      ],
    });

    // Clean up excessive whitespace while preserving paragraph breaks
    const cleanedText = text
      .replace(/\n{3,}/g, '\n\n')  // Reduce multiple newlines to max 2
      .replace(/[ \t]+/g, ' ')     // Collapse horizontal whitespace
      .trim();

    lines.push(cleanedText);

    return lines.join('\n');
  }

  /**
   * Extract meta tags from HTML.
   */
  private extractMetaTags(html: string): Array<{ name: string; content: string }> {
    const tags: Array<{ name: string; content: string }> = [];
    const metaRegex = /<meta\s+([^>]+)>/gi;
    let match: RegExpExecArray | null;

    while ((match = metaRegex.exec(html)) !== null) {
      const attributes = match[1];

      // Extract name/property and content attributes
      const nameMatch = attributes.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i);
      const contentMatch = attributes.match(/content\s*=\s*["']([^"']+)["']/i);

      if (nameMatch && contentMatch) {
        const name = nameMatch[1].trim();
        const content = contentMatch[1].trim();

        // Only include useful meta tags
        if (this.isUsefulMetaTag(name) && content) {
          tags.push({ name, content });
        }
      }
    }

    return tags;
  }

  /**
   * Check if a meta tag is useful for RAG purposes.
   */
  private isUsefulMetaTag(name: string): boolean {
    const usefulTags = new Set([
      'description',
      'keywords',
      'author',
      'og:title',
      'og:description',
      'og:type',
      'og:site_name',
      'twitter:title',
      'twitter:description',
      'article:author',
      'article:published_time',
      'article:modified_time',
      'article:section',
      'article:tag',
    ]);
    return usefulTags.has(name.toLowerCase());
  }

  // ── Filename/folder helpers ────────────────────────────────────────

  /**
   * Convert a URL to a valid folder name for the RAG project.
   * Uses the hostname as the base, sanitized for filesystem compatibility.
   */
  private urlToFolderName(url: URL): string {
    // Use hostname as base (e.g., "docs.example.com")
    let name = url.hostname;

    // Remove www. prefix if present
    name = name.replace(/^www\./, '');

    // Replace invalid characters with underscores
    name = name.replace(/[^a-zA-Z0-9.-]/g, '_');

    // Collapse multiple underscores
    name = name.replace(/_+/g, '_');

    // Trim underscores from ends
    name = name.replace(/^_+|_+$/g, '');

    // Ensure it's not empty
    if (!name) {
      name = 'website';
    }

    return name;
  }

  /**
   * Convert a URL to a valid filename for saving text content.
   * The filename encodes the full path to preserve uniqueness.
   */
  private urlToFilename(urlString: string): string {
    const url = new URL(urlString);

    // Start with pathname
    let path = url.pathname;

    // Remove leading slash
    path = path.replace(/^\//, '');

    // Include query string if present (important for dynamic pages)
    if (url.search) {
      path += url.search;
    }

    // If path is empty (root), use 'index'
    if (!path) {
      path = 'index';
    }

    // Replace path separators and invalid chars with underscores
    let filename = path.replace(/[\/\\?%*:|"<>]/g, '_');

    // Collapse multiple underscores
    filename = filename.replace(/_+/g, '_');

    // Trim underscores from ends
    filename = filename.replace(/^_+|_+$/g, '');

    // Remove any existing extension
    filename = filename.replace(/\.[^.]+$/, '');

    // Truncate if too long (max 200 chars for filename without extension)
    if (filename.length > 200) {
      filename = filename.substring(0, 200);
    }

    // Ensure it's not empty
    if (!filename) {
      filename = 'page';
    }

    // Add .txt extension
    return `${filename}.txt`;
  }
}
