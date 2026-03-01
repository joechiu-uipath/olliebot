/**
 * Evaluation System
 *
 * A comprehensive system for evaluating prompt quality.
 * Supports testing supervisor, sub-agent, and tool-generator prompts
 * with mocked or real tool execution and statistical comparison.
 */

// Core types
export * from './types.js';

// Components
export { PromptLoader } from './prompt-loader.js';
export { MockedToolRunner } from './mocked-tool-runner.js';
export { RecordingToolExecutor } from './recording-tool-executor.js';
export type { RecordedToolCall } from './recording-tool-executor.js';
export { Scorer } from './scorer.js';
export type { ScoringResult } from './scorer.js';
export { StatisticsEngine } from './statistics.js';
export { EvaluationRunner } from './runner.js';
export type { EvaluationRunnerConfig } from './runner.js';
export { EvaluationManager } from './manager.js';
export type { EvaluationManagerConfig, EvalEventCallback } from './manager.js';
