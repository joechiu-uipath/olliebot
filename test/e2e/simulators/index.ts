/**
 * Dependency Simulator - Entry point
 *
 * A self-contained HTTP server that simulates all of OllieBot's external
 * dependencies (LLM providers, search APIs, etc.) for E2E testing.
 *
 * Architecture:
 *   simulators/
 *     index.ts          - Server bootstrap + route registration
 *     base.ts           - Base simulator class with shared patterns
 *     llm/              - LLM provider simulators (Anthropic, OpenAI, Google)
 *     search/           - Web search simulators (Tavily, Serper)
 *     media/            - Image gen, voice/TTS simulators
 *     embedding/        - Embedding provider simulators
 *
 * Each simulator registers its routes and can be configured with fixtures
 * or dynamic response logic per-test.
 */

export { SimulatorServer } from './server.js';
export { BaseSimulator } from './base.js';
export type { SimulatorRequest, SimulatorResponse } from './base.js';
