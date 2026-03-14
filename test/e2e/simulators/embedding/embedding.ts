/**
 * Embedding Provider Simulator
 *
 * Simulates embedding APIs for RAG functionality.
 */

import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from '../base.js';

export class EmbeddingSimulator extends BaseSimulator {
  readonly prefix = 'embedding';
  readonly name = 'Embedding API';

  private dimensions = 768;

  constructor() {
    super();
    // OpenAI-style embedding endpoint
    this.route('POST', '/v1/embeddings', (req) => this.handleEmbedding(req));
    // Google-style embedding endpoint
    this.route('POST', /^\/v1beta\/models\/[^/]+:embedContent$/, (req) => this.handleGoogleEmbedding(req));
  }

  private generateFakeEmbedding(): number[] {
    return Array.from({ length: this.dimensions }, () => Math.random() * 2 - 1);
  }

  private handleEmbedding(req: SimulatorRequest): SimulatorResponse {
    const body = req.body as Record<string, unknown>;
    const input = Array.isArray(body?.input) ? body.input : [body?.input || ''];

    return {
      status: 200,
      body: {
        object: 'list',
        data: input.map((_: unknown, i: number) => ({
          object: 'embedding',
          index: i,
          embedding: this.generateFakeEmbedding(),
        })),
        usage: { prompt_tokens: 10, total_tokens: 10 },
      },
    };
  }

  private handleGoogleEmbedding(_req: SimulatorRequest): SimulatorResponse {
    return {
      status: 200,
      body: {
        embedding: { values: this.generateFakeEmbedding() },
      },
    };
  }
}
