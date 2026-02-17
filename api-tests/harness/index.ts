/**
 * API Test Harness — barrel exports
 */

export { ServerHarness } from './server-harness.js';
export { seedMission, seedPillar, seedMetric, seedTodo } from './server-harness.js';
export type { SeedMissionData, SeedPillarData, SeedMetricData, SeedTodoData } from './server-harness.js';
export { ApiClient } from './api-client.js';
export { WsClient } from './ws-client.js';
export type { WsEvent } from './ws-client.js';
export { SimulatorLLMProvider } from './simulator-llm-provider.js';

// Re-export simulator server for tests that need direct simulator access
export { SimulatorServer } from '../../e2e/simulators/server.js';

// Test utilities and constants
export { HTTP_STATUS, TIMEOUTS, LIMITS, TEST_SIZES } from './test-constants.js';
export {
  seedConversation,
  seedMessage,
  seedConversationWithMessages,
  expectValidResponse,
  waitFor,
} from './test-utils.js';
export type { SeedConversationOptions, SeedMessageOptions } from './test-utils.js';
