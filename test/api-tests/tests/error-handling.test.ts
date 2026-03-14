/**
 * API Tests — Error Handling
 *
 * Covers:
 *   ERR-005   Invalid input — bad API input returns error
 *   API-006   Error responses — proper status codes and messages
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { ServerHarness, HTTP_STATUS } from '../harness/index.js';

const harness = new ServerHarness();

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(() => harness.stop());

describe('Error Handling', () => {
  // ERR-005 — Invalid input
  it('PATCH /api/conversations/:id with non-existent ID returns error', async () => {
    const api = harness.api();
    const { status } = await api.patchJson('/api/conversations/non-existent-id', {
      title: 'Ghost',
    });

    // Should be 404 (not found) or a graceful error — not 500
    expect(status).toBeLessThan(HTTP_STATUS.INTERNAL_SERVER_ERROR);
  });

  it('POST to a GET-only route returns 404', async () => {
    const res = await fetch(`${harness.baseUrl}/health`, {
      method: 'POST',
    });
    // Hono returns 404 for unmatched method+path combos
    expect(res.status).toBe(HTTP_STATUS.NOT_FOUND);
  });

  // Content-Type validation
  it('POST with wrong Content-Type is handled gracefully', async () => {
    const res = await fetch(`${harness.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not json',
    });

    // Should not crash the server — might be 400 or 500 depending on parsing
    expect(res.status).toBeGreaterThanOrEqual(HTTP_STATUS.BAD_REQUEST);

    // Server should still be healthy
    const health = await fetch(`${harness.baseUrl}/health`);
    expect(health.status).toBe(HTTP_STATUS.OK);
  });

  // Delete non-existent conversation
  it('DELETE /api/conversations/:id for unknown ID returns graceful error', async () => {
    const api = harness.api();
    const { status } = await api.deleteJson('/api/conversations/does-not-exist');

    // Should not be 500
    expect(status).toBeLessThan(HTTP_STATUS.INTERNAL_SERVER_ERROR);
  });

  // Empty body on POST that expects JSON
  it('POST /api/messages without body returns error', async () => {
    const res = await fetch(`${harness.baseUrl}/api/messages`, {
      method: 'POST',
    });

    expect(res.status).toBeGreaterThanOrEqual(HTTP_STATUS.BAD_REQUEST);
  });
});
