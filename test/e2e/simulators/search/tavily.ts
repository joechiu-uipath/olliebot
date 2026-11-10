/**
 * Tavily Search API Simulator
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

interface SearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

export class TavilySimulator extends BaseSimulator {
  readonly prefix = 'tavily';
  readonly name = 'Tavily Search API';

  private results: SearchResult[] = [
    {
      title: 'Test Search Result 1',
      url: 'https://example.com/result-1',
      content: 'This is a simulated search result for E2E testing purposes.',
      score: 0.95,
    },
    {
      title: 'Test Search Result 2',
      url: 'https://example.com/result-2',
      content: 'Another simulated search result with relevant information.',
      score: 0.87,
    },
  ];

  private answer: string | null = null;

  constructor() {
    super();
    this.route('POST', '/search', (req) => this.handleSearch(req));
  }

  setResults(results: SearchResult[]): void {
    this.results = results;
  }

  /**
   * Set the AI-generated answer to include in responses.
   * Tavily provides this for "advanced" search depth.
   */
  setAnswer(answer: string | null): void {
    this.answer = answer;
  }

  private handleSearch(_req: SimulatorRequest): SimulatorResponse {
    const body: Record<string, unknown> = {
      results: this.results,
      query: (_req.body as Record<string, unknown>)?.query || 'test',
    };

    // Include answer if set (Tavily returns this for advanced search depth)
    if (this.answer) {
      body.answer = this.answer;
    }

    return {
      status: 200,
      body,
    };
  }
}
