/**
 * Base class for all dependency simulators.
 *
 * Provides common patterns:
 * - Request/response logging for debugging
 * - Dynamic fixture injection per-test
 * - Latency simulation for realistic timing
 */

export interface SimulatorRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface SimulatorResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export type RouteHandler = (req: SimulatorRequest) => SimulatorResponse | Promise<SimulatorResponse>;

export interface Route {
  method: string;
  pattern: RegExp;
  handler: RouteHandler;
}

export abstract class BaseSimulator {
  abstract readonly prefix: string;
  abstract readonly name: string;

  protected routes: Route[] = [];
  protected requestLog: SimulatorRequest[] = [];
  private _latencyMs = 0;

  /**
   * Register a route handler for this simulator.
   */
  protected route(method: string, pathPattern: string | RegExp, handler: RouteHandler): void {
    const pattern = typeof pathPattern === 'string'
      ? new RegExp(`^${pathPattern.replace(/:[^/]+/g, '([^/]+)')}$`)
      : pathPattern;
    this.routes.push({ method: method.toUpperCase(), pattern, handler });
  }

  /**
   * Set simulated latency for all responses.
   */
  setLatency(ms: number): void {
    this._latencyMs = ms;
  }

  /**
   * Get all logged requests (for assertions).
   */
  getRequestLog(): SimulatorRequest[] {
    return [...this.requestLog];
  }

  /**
   * Clear request log.
   */
  clearRequestLog(): void {
    this.requestLog = [];
  }

  /**
   * Try to match and handle a request.
   * Returns null if no route matches.
   */
  async handle(req: SimulatorRequest): Promise<SimulatorResponse | null> {
    // Strip the prefix from the URL for route matching
    const path = req.url.replace(new RegExp(`^/${this.prefix}`), '') || '/';

    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      if (route.pattern.test(path)) {
        this.requestLog.push(req);
        if (this._latencyMs > 0) {
          await new Promise(r => setTimeout(r, this._latencyMs));
        }
        return route.handler({ ...req, url: path });
      }
    }
    return null;
  }
}
