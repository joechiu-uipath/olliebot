/**
 * Serper (Google Search) API Simulator
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

interface OrganicResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
}

interface AnswerBox {
  title?: string;
  answer?: string;
  snippet?: string;
}

interface KnowledgeGraph {
  title?: string;
  description?: string;
}

export class SerperSimulator extends BaseSimulator {
  readonly prefix = 'serper';
  readonly name = 'Serper Search API';

  private organic: OrganicResult[] = [
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

  private answerBox: AnswerBox | null = null;
  private knowledgeGraph: KnowledgeGraph | null = null;

  constructor() {
    super();
    this.route('POST', '/search', (_req) => this.handleSearch());
  }

  setOrganic(results: OrganicResult[]): void {
    this.organic = results;
  }

  /**
   * Set answer box data (featured snippet from Google).
   */
  setAnswerBox(answerBox: AnswerBox | null): void {
    this.answerBox = answerBox;
  }

  /**
   * Set knowledge graph data (entity info panel from Google).
   */
  setKnowledgeGraph(knowledgeGraph: KnowledgeGraph | null): void {
    this.knowledgeGraph = knowledgeGraph;
  }

  private handleSearch(): SimulatorResponse {
    const body: Record<string, unknown> = { organic: this.organic };

    if (this.answerBox) {
      body.answerBox = this.answerBox;
    }

    if (this.knowledgeGraph) {
      body.knowledgeGraph = this.knowledgeGraph;
    }

    return {
      status: 200,
      body,
    };
  }
}
