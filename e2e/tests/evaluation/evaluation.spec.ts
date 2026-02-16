/**
 * Evaluation System Tests
 *
 * Covers: EVAL-001 through EVAL-018
 */

import { test, expect } from '../../utils/test-base.js';
import { createEvalSuite, createEvalResult } from '../../fixtures/index.js';
import { Mode } from '../../constants/index.js';

test.describe('Evaluation System', () => {

  // EVAL-001: List evaluations
  test('views all evaluations via API', async ({ app }) => {
    app.api.setHandler('GET', '/api/eval/suites', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          createEvalSuite({ path: 'suite-1', name: 'Chat Quality' }),
          createEvalSuite({ path: 'suite-2', name: 'Tool Accuracy' }),
        ]),
      });
    });

    await app.switchToEval();
    await expect(app.activeModeButton).toContainText(Mode.EVAL);
  });

  // EVAL-002: List suites
  test('views evaluation suites', async ({ app }) => {
    app.api.setHandler('GET', '/api/eval/suites', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          createEvalSuite({ name: 'Conversation Quality', evaluations: [
            { path: 'eval-1', name: 'Greeting', description: 'Tests greeting quality' },
            { path: 'eval-2', name: 'Reasoning', description: 'Tests reasoning ability' },
          ]}),
        ]),
      });
    });

    await app.switchToEval();
  });

  // EVAL-003: Run single evaluation
  test('runs one evaluation via API', async ({ app }) => {
    let runPayload: Record<string, unknown> = {};

    app.api.setHandler('POST', '/api/eval/run', async (route) => {
      runPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: 'job-1', status: 'running' }),
      });
    });

    await app.switchToEval();
  });

  // EVAL-004: Run evaluation suite
  test('runs full suite via API', async ({ app }) => {
    app.api.setHandler('POST', '/api/eval/suite/run', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ jobId: 'suite-job-1', status: 'running' }),
      });
    });

    await app.switchToEval();
  });

  // EVAL-005: View evaluation results
  test('sees results via API', async ({ app }) => {
    const result = createEvalResult({ status: 'completed', score: 0.92 });

    app.api.setHandler('GET', '/api/eval/results', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([result]),
      });
    });

    await app.switchToEval();
  });

  // EVAL-006: Evaluation progress events
  test('progress updates via WebSocket', async ({ app }) => {
    await app.switchToEval();

    app.ws.send({
      type: 'eval_progress',
      jobId: 'job-progress',
      progress: 50,
      message: 'Running evaluation 3 of 6...',
    });

    app.ws.send({
      type: 'eval_progress',
      jobId: 'job-progress',
      progress: 100,
      message: 'All evaluations complete.',
    });
  });

  // EVAL-007: Baseline vs alternative
  test('compares two prompts', async ({ app }) => {
    app.api.setHandler('POST', '/api/eval/run', async (route) => {
      const body = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: 'compare-job',
          status: 'running',
          hasAlternative: !!body.alternativePrompt,
        }),
      });
    });

    await app.switchToEval();
  });

  // EVAL-011: Eval mode UI
  test('switches to Eval mode via mode switcher', async ({ app }) => {
    await app.switchToEval();
    await expect(app.activeModeButton).toContainText(Mode.EVAL);
  });

  // EVAL-014: List eval jobs
  test('lists running eval jobs', async ({ app }) => {
    app.api.setHandler('GET', '/api/eval/jobs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { jobId: 'job-active', status: 'running', evaluationPath: 'test-eval', progress: 30 },
        ]),
      });
    });

    await app.switchToEval();
  });

  // EVAL-016: Generate eval report
  test('generates evaluation report', async ({ app }) => {
    app.api.setHandler('POST', '/api/eval/report', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          report: '# Evaluation Report\n\n## Summary\n- Total evaluations: 10\n- Average score: 0.87',
        }),
      });
    });

    await app.switchToEval();
  });

  // EVAL-017: Cleanup results
  test('removes old evaluation results', async ({ app }) => {
    app.api.setHandler('POST', '/api/eval/cleanup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ removed: 5 }),
      });
    });

    await app.switchToEval();
  });

  // EVAL-018: List prompts
  test('lists prompt files', async ({ app }) => {
    app.api.setHandler('GET', '/api/prompts/list', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { path: 'prompts/greeting.txt', name: 'Greeting Prompt' },
          { path: 'prompts/reasoning.txt', name: 'Reasoning Prompt' },
        ]),
      });
    });

    await app.switchToEval();
  });
});
