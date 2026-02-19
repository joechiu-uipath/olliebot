/**
 * Evaluation API Routes
 *
 * REST endpoints for the prompt evaluation system.
 */

import { Hono } from 'hono';
import { join } from 'path';
import type { LLMService } from '../llm/service.js';
import type { ToolRunner } from '../tools/runner.js';
import { EvaluationManager } from '../evaluation/index.js';
import type { Channel } from '../channels/types.js';

export interface EvalRoutesConfig {
  llmService: LLMService;
  toolRunner: ToolRunner;
  channel?: Channel;
  /** Custom evaluations directory (defaults to user/evaluations) */
  evaluationsDir?: string;
  /** Custom results directory (defaults to user/evaluations/results) */
  resultsDir?: string;
}

// Store for active evaluation jobs
const activeJobs = new Map<string, {
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  results?: unknown;
  error?: string;
}>();

export function setupEvalRoutes(app: Hono, config: EvalRoutesConfig): EvaluationManager {
  const evaluationsDir = config.evaluationsDir ?? join(process.cwd(), 'user', 'evaluations');
  const resultsDir = config.resultsDir ?? join(process.cwd(), 'user', 'evaluations', 'results');

  const manager = new EvaluationManager({
    evaluationsDir,
    resultsDir,
    llmService: config.llmService,
    toolRunner: config.toolRunner,
  });

  // Subscribe to evaluation events and broadcast via WebSocket
  if (config.channel) {
    manager.onEvent((event) => {
      console.log('[EvalAPI] Broadcasting event:', event.type, 'jobId:', event.jobId);
      config.channel!.broadcast(event);

      // Update job status
      if (event.type === 'eval_complete') {
        const job = activeJobs.get(event.jobId);
        if (job) {
          job.status = 'completed';
          job.results = event.results;
        }
      }
    });
  } else {
    console.warn('[EvalAPI] No webChannel configured - WebSocket events will not be broadcast');
  }

  // List all evaluations
  app.get('/api/eval/list', (c) => {
    try {
      const target = c.req.query('target');
      const tagsStr = c.req.query('tags');
      const tags = tagsStr ? tagsStr.split(',') : undefined;

      const evaluations = manager.listEvaluations({ target, tags });
      return c.json({ evaluations });
    } catch (error) {
      console.error('[EvalAPI] Failed to list evaluations:', error);
      return c.json({ error: 'Failed to list evaluations' }, 500);
    }
  });

  // List all suites with their evaluations (tree structure)
  app.get('/api/eval/suites', (c) => {
    try {
      const suites = manager.listSuitesWithEvaluations();
      return c.json({ suites });
    } catch (error) {
      console.error('[EvalAPI] Failed to list suites:', error);
      return c.json({ error: 'Failed to list suites' }, 500);
    }
  });

  // Run an evaluation
  app.post('/api/eval/run', async (c) => {
    try {
      const body = await c.req.json();
      const { evaluationPath, runs, alternativePrompt } = body;

      if (!evaluationPath) {
        return c.json({ error: 'evaluationPath is required' }, 400);
      }

      const jobId = `eval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Store job status
      activeJobs.set(jobId, {
        status: 'running',
        startedAt: new Date(),
      });

      // Return immediately with job ID
      const response = c.json({ jobId, status: 'started' });

      // Run evaluation asynchronously
      manager.runEvaluation(evaluationPath, {
        runs: runs || 5,
        alternativePrompt,
        jobId,
      }).then((results) => {
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.results = results;
        }
      }).catch((error) => {
        console.error('[EvalAPI] Evaluation failed:', error);
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = String(error);
        }
        // Broadcast error event
        if (config.channel) {
          config.channel.broadcast({
            type: 'eval_error',
            jobId,
            error: String(error),
          });
        }
      });

      return response;
    } catch (error) {
      console.error('[EvalAPI] Failed to start evaluation:', error);
      return c.json({ error: 'Failed to start evaluation' }, 500);
    }
  });

  // Run a suite
  app.post('/api/eval/suite/run', async (c) => {
    try {
      const body = await c.req.json();
      const { suitePath } = body;

      if (!suitePath) {
        return c.json({ error: 'suitePath is required' }, 400);
      }

      const jobId = `suite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Store job status
      activeJobs.set(jobId, {
        status: 'running',
        startedAt: new Date(),
      });

      // Return immediately with job ID
      const response = c.json({ jobId, status: 'started' });

      // Run suite asynchronously
      manager.runSuite(suitePath, { jobId }).then((results) => {
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'completed';
          job.results = results;
        }
      }).catch((error) => {
        console.error('[EvalAPI] Suite run failed:', error);
        const job = activeJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = String(error);
        }
        // Broadcast error event
        if (config.channel) {
          config.channel.broadcast({
            type: 'eval_error',
            jobId,
            error: String(error),
          });
        }
      });

      return response;
    } catch (error) {
      console.error('[EvalAPI] Failed to start suite:', error);
      return c.json({ error: 'Failed to start suite' }, 500);
    }
  });

  // List active jobs (for UI recovery on page load)
  app.get('/api/eval/jobs', (c) => {
    try {
      const jobs = Array.from(activeJobs.entries()).map(([jobId, job]) => ({
        jobId,
        status: job.status,
        startedAt: job.startedAt,
      }));
      return c.json({ jobs });
    } catch (error) {
      console.error('[EvalAPI] Failed to list jobs:', error);
      return c.json({ error: 'Failed to list jobs' }, 500);
    }
  });

  // Get job status/results
  app.get('/api/eval/results/:jobId', (c) => {
    try {
      const jobId = c.req.param('jobId');
      const job = activeJobs.get(jobId);

      if (!job) {
        return c.json({ error: 'Job not found' }, 404);
      }

      return c.json({
        jobId,
        status: job.status,
        startedAt: job.startedAt,
        results: job.results,
        error: job.error,
      });
    } catch (error) {
      console.error('[EvalAPI] Failed to get job status:', error);
      return c.json({ error: 'Failed to get job status' }, 500);
    }
  });

  // List all recent results (for sidebar)
  app.get('/api/eval/results', (c) => {
    try {
      const limit = parseInt(c.req.query('limit') || '10');
      const results = manager.loadRecentResults(limit);
      return c.json({ results });
    } catch (error) {
      console.error('[EvalAPI] Failed to load recent results:', error);
      return c.json({ error: 'Failed to load recent results' }, 500);
    }
  });

  // Get historical results for an evaluation
  app.get('/api/eval/history/:evaluationId', (c) => {
    try {
      const evaluationId = c.req.param('evaluationId');
      const limit = parseInt(c.req.query('limit') || '10');
      const results = manager.loadResults(evaluationId, limit);
      return c.json({ results });
    } catch (error) {
      console.error('[EvalAPI] Failed to load history:', error);
      return c.json({ error: 'Failed to load history' }, 500);
    }
  });

  // Load a specific result file by path (e.g., "2026-02-01/researcher-web-search-001-123.json")
  app.get('/api/eval/result/:path{.+}', (c) => {
    try {
      const path = c.req.param('path');
      const result = manager.loadResultByPath(path);
      return c.json({ result });
    } catch (error) {
      console.error('[EvalAPI] Failed to load result:', error);
      return c.json({ error: 'Result not found' }, 404);
    }
  });

  // Delete a result file by path
  app.delete('/api/eval/result/:path{.+}', (c) => {
    try {
      const path = c.req.param('path');
      manager.deleteResult(path);
      return c.json({ success: true, deleted: path });
    } catch (error) {
      console.error('[EvalAPI] Failed to delete result:', error);
      return c.json({ error: 'Failed to delete result' }, 404);
    }
  });

  // Save evaluation (PUT - must be before GET catch-all)
  app.put('/api/eval/:path{.+}', async (c) => {
    try {
      const path = c.req.param('path');
      const content = await c.req.json();

      if (!content) {
        return c.json({ error: 'Request body is required' }, 400);
      }

      // Validate JSON structure before saving
      if (!content.metadata?.id || !content.metadata?.name) {
        return c.json({ error: 'Invalid evaluation: missing metadata.id or metadata.name' }, 400);
      }

      manager.saveEvaluation(path, content);
      return c.json({ success: true, path });
    } catch (error) {
      console.error('[EvalAPI] Failed to save evaluation:', error);
      return c.json({ error: String(error) }, 500);
    }
  });

  // Get evaluation details (catch-all - must be after all specific /api/eval/* routes)
  app.get('/api/eval/:path{.+}', (c) => {
    try {
      const path = c.req.param('path');
      const evaluation = manager.loadEvaluation(path);
      return c.json({ evaluation });
    } catch (error) {
      console.error('[EvalAPI] Failed to load evaluation:', error);
      return c.json({ error: 'Evaluation not found' }, 404);
    }
  });

  // List available prompts
  app.get('/api/prompts/list', (c) => {
    try {
      const promptLoader = manager.getRunner().getPromptLoader();
      const prompts = promptLoader.listAvailablePrompts();
      return c.json({ prompts });
    } catch (error) {
      console.error('[EvalAPI] Failed to list prompts:', error);
      return c.json({ error: 'Failed to list prompts' }, 500);
    }
  });

  // Get prompt content
  app.get('/api/prompts/:path{.+}', (c) => {
    try {
      const path = c.req.param('path');
      const promptLoader = manager.getRunner().getPromptLoader();
      const content = promptLoader.loadFromFile(path);
      return c.json({ path, content });
    } catch (error) {
      console.error('[EvalAPI] Failed to load prompt:', error);
      return c.json({ error: 'Prompt not found' }, 404);
    }
  });

  // Generate report for a result
  app.post('/api/eval/report', async (c) => {
    try {
      const body = await c.req.json();
      const { results, format } = body;

      if (!results) {
        return c.json({ error: 'results is required' }, 400);
      }

      const report = manager.generateReport(results);
      return c.json({ report, format: format || 'markdown' });
    } catch (error) {
      console.error('[EvalAPI] Failed to generate report:', error);
      return c.json({ error: 'Failed to generate report' }, 500);
    }
  });

  // Clean up old jobs (called periodically or on demand)
  app.post('/api/eval/cleanup', (c) => {
    try {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      let cleaned = 0;

      for (const [jobId, job] of activeJobs.entries()) {
        if (job.startedAt.getTime() < oneHourAgo && job.status !== 'running') {
          activeJobs.delete(jobId);
          cleaned++;
        }
      }

      return c.json({ cleaned, remaining: activeJobs.size });
    } catch (error) {
      console.error('[EvalAPI] Failed to cleanup jobs:', error);
      return c.json({ error: 'Failed to cleanup jobs' }, 500);
    }
  });

  return manager;
}
