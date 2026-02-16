/**
 * API Tests — Evaluation Routes
 *
 * Covers the evaluation REST API using the FullServerHarness
 * (real LLMService + ToolRunner backed by simulator).
 *
 * Tests exercise:
 *   - List evaluations (empty state)
 *   - List suites (empty state)
 *   - Job lifecycle: submit, poll status, cleanup
 *   - Validation: missing required fields return 400
 *   - Recent results (empty state)
 *   - Report generation
 *   - Eval save/load (PUT/GET)
 *   - 404 for unknown resources
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import { FullServerHarness } from '../harness/index.js';
import { unlinkSync, existsSync } from 'fs';
import { join } from 'path';

const harness = new FullServerHarness();

// Track eval files created during tests so we can clean up
const createdEvalFiles: string[] = [];

beforeAll(() => harness.start());
afterEach(() => harness.reset());
afterAll(async () => {
  // Clean up any eval files written to disk during testing
  for (const filePath of createdEvalFiles) {
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch { /* ignore */ }
  }
  await harness.stop();
});

describe('Evaluation Routes', () => {
  describe('listing', () => {
    it('GET /api/eval/list returns evaluations array', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ evaluations: Array<{ id: string; name: string; path: string }> }>(
        '/api/eval/list',
      );

      expect(status).toBe(200);
      expect(Array.isArray(body.evaluations)).toBe(true);
      // Each evaluation should have expected shape
      if (body.evaluations.length > 0) {
        expect(body.evaluations[0]).toHaveProperty('id');
        expect(body.evaluations[0]).toHaveProperty('name');
        expect(body.evaluations[0]).toHaveProperty('path');
      }
    });

    it('GET /api/eval/list supports target filter', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ evaluations: Array<{ target: string }> }>(
        '/api/eval/list?target=supervisor',
      );

      expect(status).toBe(200);
      expect(Array.isArray(body.evaluations)).toBe(true);
      // All returned evals should match the target filter
      for (const ev of body.evaluations) {
        expect(ev.target).toBe('supervisor');
      }
    });

    it('GET /api/eval/list supports tags filter', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ evaluations: Array<{ tags: string[] }> }>(
        '/api/eval/list?tags=web-search',
      );

      expect(status).toBe(200);
      expect(Array.isArray(body.evaluations)).toBe(true);
      // All returned evals should include the filtered tag
      for (const ev of body.evaluations) {
        expect(ev.tags).toContain('web-search');
      }
    });

    it('GET /api/eval/suites returns suites array', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ suites: Array<{ id: string; name: string }> }>(
        '/api/eval/suites',
      );

      expect(status).toBe(200);
      expect(Array.isArray(body.suites)).toBe(true);
      if (body.suites.length > 0) {
        expect(body.suites[0]).toHaveProperty('id');
        expect(body.suites[0]).toHaveProperty('name');
      }
    });
  });

  describe('job lifecycle', () => {
    it('GET /api/eval/jobs returns empty jobs list initially', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ jobs: unknown[] }>(
        '/api/eval/jobs',
      );

      expect(status).toBe(200);
      expect(body.jobs).toEqual([]);
    });

    it('POST /api/eval/run without evaluationPath returns 400', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/eval/run',
        {},
      );

      expect(status).toBe(400);
      expect(body.error).toContain('evaluationPath');
    });

    it('POST /api/eval/run with evaluationPath returns jobId', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ jobId: string; status: string }>(
        '/api/eval/run',
        { evaluationPath: 'nonexistent-eval.json', runs: 1 },
      );

      expect(status).toBe(200);
      expect(body.jobId).toBeTruthy();
      expect(body.status).toBe('started');
    });

    it('POST /api/eval/run creates a trackable job', async () => {
      const api = harness.api();

      // Submit an eval job
      const { body: submitted } = await api.postJson<{ jobId: string }>(
        '/api/eval/run',
        { evaluationPath: 'test-eval.json', runs: 1 },
      );

      // Allow async job processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Poll job status
      const { status, body } = await api.getJson<{
        jobId: string;
        status: string;
        startedAt: string;
      }>(`/api/eval/results/${submitted.jobId}`);

      expect(status).toBe(200);
      expect(body.jobId).toBe(submitted.jobId);
      // Job may have already failed (no eval file exists) or still be running
      expect(['running', 'completed', 'failed']).toContain(body.status);
      expect(body.startedAt).toBeTruthy();
    });

    it('GET /api/eval/results/:jobId returns 404 for unknown job', async () => {
      const api = harness.api();
      const { status } = await api.getJson('/api/eval/results/unknown-job-id');
      expect(status).toBe(404);
    });

    it('POST /api/eval/suite/run without suitePath returns 400', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/eval/suite/run',
        {},
      );

      expect(status).toBe(400);
      expect(body.error).toContain('suitePath');
    });

    it('POST /api/eval/suite/run with suitePath returns jobId', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ jobId: string; status: string }>(
        '/api/eval/suite/run',
        { suitePath: 'nonexistent-suite.json' },
      );

      expect(status).toBe(200);
      expect(body.jobId).toBeTruthy();
      expect(body.status).toBe('started');
    });
  });

  describe('results', () => {
    it('GET /api/eval/results returns empty results array', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ results: unknown[] }>(
        '/api/eval/results',
      );

      expect(status).toBe(200);
      expect(body.results).toEqual([]);
    });

    it('GET /api/eval/results supports limit parameter', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ results: unknown[] }>(
        '/api/eval/results?limit=5',
      );

      expect(status).toBe(200);
      expect(body.results).toEqual([]);
    });

    it('GET /api/eval/history/:evaluationId returns empty for unknown eval', async () => {
      const api = harness.api();
      const { status, body } = await api.getJson<{ results: unknown[] }>(
        '/api/eval/history/unknown-eval',
      );

      expect(status).toBe(200);
      expect(body.results).toEqual([]);
    });
  });

  describe('eval definition CRUD', () => {
    it('GET /api/eval/:path returns 404 for nonexistent eval', async () => {
      const api = harness.api();
      const { status } = await api.getJson('/api/eval/nonexistent-eval.json');
      expect(status).toBe(404);
    });

    it('PUT /api/eval/:path validates required fields', async () => {
      const res = await fetch(`${harness.baseUrl}/api/eval/test-eval.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incomplete: true }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('metadata');
    });

    it('PUT /api/eval/:path saves and GET retrieves a valid eval', async () => {
      const evalDef = {
        version: '1.0',
        metadata: {
          id: 'test-eval-001',
          name: 'Test Evaluation',
          description: 'A test evaluation for API testing',
          target: 'supervisor',
          tags: ['test'],
        },
        target: {
          source: 'file',
          prompt: 'supervisor.md',
        },
        testCase: {
          userPrompt: 'Hello, is this working?',
          history: [],
        },
        toolExpectations: { expectedTools: [], forbiddenTools: [] },
        responseExpectations: {
          requiredElements: [],
          optionalElements: [],
          constraints: {},
        },
        scoring: {
          responseQuality: { weight: 1.0, criteria: { required_elements: 1.0 } },
        },
      };

      // Track for cleanup
      const savedPath = join(process.cwd(), 'user', 'evaluations', 'test-eval-save.eval.json');
      createdEvalFiles.push(savedPath);

      // Save
      const saveRes = await fetch(`${harness.baseUrl}/api/eval/test-eval-save.eval.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evalDef),
      });

      expect(saveRes.status).toBe(200);
      const saveBody = await saveRes.json();
      expect(saveBody.success).toBe(true);

      // Retrieve
      const api = harness.api();
      const { status, body } = await api.getJson<{
        evaluation: { metadata: { id: string; name: string } };
      }>('/api/eval/test-eval-save.eval.json');

      expect(status).toBe(200);
      expect(body.evaluation.metadata.id).toBe('test-eval-001');
      expect(body.evaluation.metadata.name).toBe('Test Evaluation');
    });
  });

  describe('cleanup', () => {
    it('POST /api/eval/cleanup cleans up old completed jobs', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ cleaned: number; remaining: number }>(
        '/api/eval/cleanup',
      );

      expect(status).toBe(200);
      expect(typeof body.cleaned).toBe('number');
      expect(typeof body.remaining).toBe('number');
    });
  });

  describe('report generation', () => {
    it('POST /api/eval/report without results returns 400', async () => {
      const api = harness.api();
      const { status, body } = await api.postJson<{ error: string }>(
        '/api/eval/report',
        {},
      );

      expect(status).toBe(400);
      expect(body.error).toContain('results');
    });

    it('POST /api/eval/report with results returns markdown report', async () => {
      const api = harness.api();
      const emptySummary = {
        mean: 0, median: 0, stdDev: 0, min: 0, max: 0, count: 0,
        confidenceInterval: [0, 0] as [number, number],
      };
      const { status, body } = await api.postJson<{ report: string; format: string }>(
        '/api/eval/report',
        {
          results: {
            evaluationId: 'test',
            evaluationName: 'Test Eval',
            timestamp: new Date().toISOString(),
            baseline: {
              runs: [],
              totalRuns: 0,
              passRate: 0,
              avgLatencyMs: 0,
              toolSelectionScore: emptySummary,
              responseQualityScore: emptySummary,
              overallScore: emptySummary,
              elementPassRates: {},
            },
          },
        },
      );

      expect(status).toBe(200);
      expect(typeof body.report).toBe('string');
      expect(body.report).toContain('# Evaluation Report');
      expect(body.format).toBe('markdown');
    });
  });
});
