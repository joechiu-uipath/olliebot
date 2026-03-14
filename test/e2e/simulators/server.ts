/**
 * Simulator HTTP Server
 *
 * Lightweight HTTP server that hosts all dependency simulators.
 * Routes are dispatched based on URL prefix to the appropriate simulator.
 */

import http from 'node:http';
import { BaseSimulator, type SimulatorRequest, type SimulatorResponse } from './base.js';
import { AnthropicSimulator } from './llm/anthropic.js';
import { OpenAISimulator } from './llm/openai.js';
import { GoogleSimulator } from './llm/google.js';
import { TavilySimulator } from './search/tavily.js';
import { SerperSimulator } from './search/serper.js';
import { EmbeddingSimulator } from './embedding/embedding.js';
import { ImageGenSimulator } from './media/image-gen.js';
import { VoiceSimulator } from './media/voice.js';
import { WebScrapeSimulator } from './web/web-scrape.js';

export class SimulatorServer {
  private server: http.Server | null = null;
  private simulators: Map<string, BaseSimulator> = new Map();

  readonly anthropic: AnthropicSimulator;
  readonly openai: OpenAISimulator;
  readonly google: GoogleSimulator;
  readonly tavily: TavilySimulator;
  readonly serper: SerperSimulator;
  readonly embedding: EmbeddingSimulator;
  readonly imageGen: ImageGenSimulator;
  readonly voice: VoiceSimulator;
  readonly webScrape: WebScrapeSimulator;

  constructor() {
    this.anthropic = new AnthropicSimulator();
    this.openai = new OpenAISimulator();
    this.google = new GoogleSimulator();
    this.tavily = new TavilySimulator();
    this.serper = new SerperSimulator();
    this.embedding = new EmbeddingSimulator();
    this.imageGen = new ImageGenSimulator();
    this.voice = new VoiceSimulator();
    this.webScrape = new WebScrapeSimulator();

    this.register(this.anthropic);
    this.register(this.openai);
    this.register(this.google);
    this.register(this.tavily);
    this.register(this.serper);
    this.register(this.embedding);
    this.register(this.imageGen);
    this.register(this.voice);
    this.register(this.webScrape);
  }

  private register(simulator: BaseSimulator): void {
    this.simulators.set(simulator.prefix, simulator);
  }

  /**
   * Start the simulator server.
   */
  async start(port = 4100): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Simulator internal error', details: String(err) }));
        }
      });

      this.server.listen(port, () => {
        console.log(`[Simulator] Dependency simulator running on http://localhost:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the simulator server.
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  /**
   * Reset all simulators (clear logs, reset state).
   */
  reset(): void {
    for (const sim of this.simulators.values()) {
      sim.clearRequestLog();
    }
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const url = req.url || '/';

    // Health check
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', simulators: [...this.simulators.keys()] }));
      return;
    }

    // Route to appropriate simulator based on URL prefix
    // URL format: /{simulatorPrefix}/...
    const parts = url.split('/').filter(Boolean);
    const prefix = parts[0];

    if (prefix) {
      const simulator = this.simulators.get(prefix);
      if (simulator) {
        const simReq: SimulatorRequest = {
          method: req.method || 'GET',
          url,
          headers: req.headers as Record<string, string>,
          body: this.parseBody(body),
        };

        const simRes = await simulator.handle(simReq);
        if (simRes) {
          const headers = { 'Content-Type': 'application/json', ...simRes.headers };
          res.writeHead(simRes.status, headers);
          if (typeof simRes.body === 'string') {
            res.end(simRes.body);
          } else {
            res.end(JSON.stringify(simRes.body));
          }
          return;
        }
      }
    }

    // No matching route
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No simulator route matched', url, method: req.method }));
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    });
  }

  private parseBody(raw: string): unknown {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}
