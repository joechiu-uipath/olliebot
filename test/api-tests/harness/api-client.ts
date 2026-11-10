/**
 * Lightweight HTTP Client for API Tests
 *
 * Wraps fetch() with convenience methods for JSON-based REST APIs.
 * Every method returns the raw Response so tests can assert on
 * status codes, headers, and body independently.
 */

export class ApiClient {
  constructor(private baseUrl: string) {}

  // ---------------------------------------------------------------------------
  // Core request methods
  // ---------------------------------------------------------------------------

  async get(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`);
  }

  async post(path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch(path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async put(path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete(path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Convenience: parse JSON body
  // ---------------------------------------------------------------------------

  async getJson<T = unknown>(path: string): Promise<{ status: number; body: T }> {
    const res = await this.get(path);
    const body = await res.json() as T;
    return { status: res.status, body };
  }

  async postJson<T = unknown>(path: string, data?: unknown): Promise<{ status: number; body: T }> {
    const res = await this.post(path, data);
    const body = await res.json() as T;
    return { status: res.status, body };
  }

  async patchJson<T = unknown>(path: string, data?: unknown): Promise<{ status: number; body: T }> {
    const res = await this.patch(path, data);
    const body = await res.json() as T;
    return { status: res.status, body };
  }

  async deleteJson<T = unknown>(path: string): Promise<{ status: number; body: T }> {
    const res = await this.delete(path);
    const body = await res.json() as T;
    return { status: res.status, body };
  }
}
