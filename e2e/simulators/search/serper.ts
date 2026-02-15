/**
 * Serper (Google Search) API Simulator
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

export class SerperSimulator extends BaseSimulator {
  readonly prefix = 'serper';
  readonly name = 'Serper Search API';

  private organic = [
    {
      title: 'Test Result 1',
      link: 'https://example.com/1',
      snippet: 'A simulated Google search result.',
      position: 1,
    },
    {
      title: 'Test Result 2',
      link: 'https://example.com/2',
      snippet: 'Another simulated search result.',
      position: 2,
    },
  ];

  constructor() {
    super();
    this.route('POST', '/search', (_req) => this.handleSearch());
  }

  setOrganic(results: typeof this.organic): void {
    this.organic = results;
  }

  private handleSearch(): SimulatorResponse {
    return {
      status: 200,
      body: { organic: this.organic },
    };
  }
}
