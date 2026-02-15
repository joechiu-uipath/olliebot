/**
 * Test Constants for ToolRunner Tests
 *
 * Centralized constants to avoid magic numbers and improve maintainability.
 */

// Tool execution timing
export const SLOW_TOOL_DELAY_MS = 10;
export const TOOL_EXECUTION_DURATION_MS = 2000;
export const QUICK_TOOL_DURATION_MS = 500;

// File size limits
export const SCREENSHOT_FILE_SIZE_BYTES = 1024;

// Result truncation
export const LARGE_RESULT_SIZE_CHARS = 20000;
export const TRUNCATION_THRESHOLD_CHARS = 15000;

// Test IDs
export const TEST_REQUEST_ID = 'test-id';
export const TEST_CONVERSATION_ID = 'conv-123';
export const TEST_AGENT_ID = 'agent-1';

// Sample data
export const SAMPLE_QUERY = 'test query';
export const SAMPLE_TIMESTAMP = '2024-01-01T00:00:00Z';
export const SAMPLE_BASE64_IMAGE = 'data:image/png;base64,iVBORw0KGgo=';

// Agent info
export const DEFAULT_AGENT_INFO = {
  id: TEST_AGENT_ID,
  name: 'Researcher',
  emoji: '🔬',
  type: 'researcher' as const,
};

// Tool names
export const MOCK_TOOL_NAMES = {
  BASIC: 'mock_tool',
  SCREENSHOT: 'mock_screenshot',
  DISPLAY_ONLY: 'mock_display_only',
  FAILING: 'mock_failing',
  THROWING: 'mock_throwing',
  EVENTS: 'mock_events',
  PARALLEL_A: 'parallel_a',
  PARALLEL_B: 'parallel_b',
  USER_TOOL: 'my_user_tool',
  SHARED: 'shared_name',
};
