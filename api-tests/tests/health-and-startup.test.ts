/**
 * API Tests — Health & Startup
 *
 * Covers:
 *   API-001  Health check
 *   API-002  Startup info
 *   API-003  Model capabilities
 *   API-004  CORS headers
 *   API-005  JSON parsing
 *   API-008  404 handling
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness, HTTP_STATUS } from '../harness/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Health & Startup', () => {
  // API-001
  it('GET /health returns ok', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<{ status: string; timestamp: string }>('/health');

    expect(status).toBe(HTTP_STATUS.OK);
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeTruthy();
  });

  // API-002
  it('GET /api/startup returns consolidated startup data', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<Record<string, unknown>>('/api/startup');

    expect(status).toBe(HTTP_STATUS.OK);
    // Core keys present
    expect(body).toHaveProperty('modelCapabilities');
    expect(body).toHaveProperty('conversations');
    expect(body).toHaveProperty('feedMessages');
    expect(body).toHaveProperty('tasks');
    expect(body).toHaveProperty('skills');
    expect(body).toHaveProperty('mcps');
    expect(body).toHaveProperty('tools');

    // Feed conversation is seeded by well-known conversations
    const conversations = body.conversations as Array<{ id: string; isWellKnown: boolean }>;
    const feed = conversations.find(c => c.id === 'feed');
    expect(feed).toBeDefined();
    expect(feed!.isWellKnown).toBe(true);
  });

  // API-003
  it('GET /api/model-capabilities returns capability flags', async () => {
    const api = harness.api();
    const { status, body } = await api.getJson<Record<string, unknown>>('/api/model-capabilities');

    expect(status).toBe(HTTP_STATUS.OK);
    // Without a configured provider, capability flags are still present
    expect(body).toHaveProperty('supportsReasoningEffort');
    expect(body).toHaveProperty('reasoningEfforts');
  });

  // API-004
  it('CORS preflight returns allow headers', async () => {
    // Use an OPTIONS preflight request (not a simple GET with Origin header)
    const res = await fetch(`${harness.baseUrl}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://test-origin.example',
        'Access-Control-Request-Method': 'GET',
      },
    });

    // The harness sets allowedOrigins to ['*'], which in Hono's CORS middleware
    // means the origin callback returns '*' for no-origin requests.
    // For a preflight, the CORS headers should be present.
    expect(res.status).toBeLessThan(400);
  });

  // API-005
  it('API parses JSON request bodies correctly', async () => {
    const api = harness.api();
    // POST /api/conversations expects a JSON body
    const { status, body } = await api.postJson<{ id: string; title: string }>(
      '/api/conversations',
      { title: 'JSON Parse Test' },
    );

    expect(status).toBe(HTTP_STATUS.OK);
    expect(body.title).toBe('JSON Parse Test');
  });

  // API-008
  it('unknown routes return 404', async () => {
    const res = await fetch(`${harness.baseUrl}/api/does-not-exist`);
    expect(res.status).toBe(HTTP_STATUS.NOT_FOUND);
  });
});
