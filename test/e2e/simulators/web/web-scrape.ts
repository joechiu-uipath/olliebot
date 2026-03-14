/**
 * Web Scraping Simulator
 *
 * Simulates web page fetching for web_scrape and website_crawler tools.
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

interface ScrapedPage {
  url: string;
  title: string;
  content: string;
}

export class WebScrapeSimulator extends BaseSimulator {
  readonly prefix = 'web_scrape';
  readonly name = 'Web Scrape Simulator';

  private pages: Map<string, ScrapedPage> = new Map();

  constructor() {
    super();
    this.route('POST', '/scrape', (req) => this.handleScrape(req));
    this.route('POST', '/crawl', (req) => this.handleCrawl(req));

    // Add default page
    this.pages.set('https://example.com', {
      url: 'https://example.com',
      title: 'Example Domain',
      content: 'This domain is for use in illustrative examples in documents.',
    });
  }

  /**
   * Register a simulated page.
   */
  addPage(page: ScrapedPage): void {
    this.pages.set(page.url, page);
  }

  private handleScrape(req: SimulatorRequest): SimulatorResponse {
    const body = req.body as Record<string, unknown>;
    const url = body?.url as string || 'https://example.com';
    const page = this.pages.get(url) || {
      url,
      title: 'Simulated Page',
      content: `Simulated content for ${url}`,
    };

    return {
      status: 200,
      body: {
        title: page.title,
        content: page.content,
        url: page.url,
      },
    };
  }

  private handleCrawl(req: SimulatorRequest): SimulatorResponse {
    const body = req.body as Record<string, unknown>;
    const url = body?.url as string || 'https://example.com';
    const pages = [this.pages.get(url) || { url, title: 'Page 1', content: 'Content 1' }];

    return {
      status: 200,
      body: { pages },
    };
  }
}
