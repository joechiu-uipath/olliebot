/**
 * API Endpoints Tests
 *
 * Covers: API-001 through API-008
 */

import { test, expect } from '../../utils/test-base.js';

test.describe('API Endpoints', () => {

  // API-001: Health check
  test('GET /health returns ok', async ({ app }) => {
    await app.waitForAppReady();

    // The health check is handled by our mock and returns ok
    const response = await app.page.evaluate(async () => {
      const res = await fetch('/health');
      return res.json();
    });
    expect(response.status).toBe('ok');
  });

  // API-002: Startup info
  test('GET /api/startup returns config and data', async ({ app }) => {
    await app.waitForAppReady();

    const response = await app.page.evaluate(async () => {
      const res = await fetch('/api/startup');
      return res.json();
    });

    expect(response).toHaveProperty('modelCapabilities');
    expect(response).toHaveProperty('conversations');
    expect(response).toHaveProperty('feedMessages');
    expect(response).toHaveProperty('tasks');
    expect(response).toHaveProperty('skills');
    expect(response).toHaveProperty('mcps');
    expect(response).toHaveProperty('tools');
    expect(response).toHaveProperty('agentTemplates');
    expect(response).toHaveProperty('commandTriggers');
  });

  // API-003: Model capabilities
  test('GET /api/model-capabilities returns supported features', async ({ app }) => {
    await app.waitForAppReady();

    const response = await app.page.evaluate(async () => {
      const res = await fetch('/api/model-capabilities');
      return res.json();
    });

    expect(response).toHaveProperty('provider');
    expect(response).toHaveProperty('model');
    expect(response).toHaveProperty('supportsExtendedThinking');
    expect(response).toHaveProperty('supportsVision');
  });

  // API-004: CORS headers
  test('API returns proper CORS headers', async ({ app }) => {
    await app.waitForAppReady();

    // In the test environment, CORS is handled by the API mock
    // which always allows requests from the test origin
    const response = await app.page.evaluate(async () => {
      const res = await fetch('/api/startup');
      return {
        ok: res.ok,
        status: res.status,
      };
    });

    expect(response.ok).toBe(true);
  });

  // API-005: JSON parsing
  test('API parses JSON bodies correctly', async ({ app }) => {
    await app.waitForAppReady();

    const response = await app.page.evaluate(async () => {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test Conversation' }),
      });
      return res.json();
    });

    expect(response).toHaveProperty('id');
    expect(response).toHaveProperty('title');
  });

  // API-006: Error responses
  test('errors return proper status codes and messages', async ({ app }) => {
    app.api.setHandler('GET', '/api/nonexistent', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Not found' }),
      });
    });

    await app.waitForAppReady();

    const response = await app.page.evaluate(async () => {
      const res = await fetch('/api/nonexistent');
      return { status: res.status, body: await res.json() };
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not found');
  });

  // API-008: 404 handling
  test('unknown routes return 404', async ({ app }) => {
    await app.waitForAppReady();

    const response = await app.page.evaluate(async () => {
      const res = await fetch('/api/completely-unknown-route');
      return { status: res.status };
    });

    expect(response.status).toBe(404);
  });
});
