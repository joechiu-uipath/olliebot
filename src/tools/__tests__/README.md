# Test Fixtures and Constants

This directory contains shared test fixtures and constants to reduce code duplication and improve test maintainability across the test suite.

## Purpose

Test fixtures provide:
- **Reusable mock objects** with sensible defaults
- **Factory functions** for common test data
- **Named constants** instead of magic numbers
- **Consistent test patterns** across test files

## Files

### `fixtures.ts`
Factory functions for creating test objects:
- `createMockTool()` - Create NativeTool mocks with defaults
- `createSlowMockTool()` - Tools with async delays
- `createFailingMockTool()` - Tools that throw errors
- `createFileReturningMockTool()` - Tools that return file results
- `createMockMcpClient()` - Mock MCP client for testing

### `constants.ts`
Named constants to replace magic numbers:
- Timing values (delays, durations)
- Size thresholds (file sizes, truncation limits)
- Test IDs and identifiers
- Sample data (queries, timestamps, URLs)

## Usage

```typescript
import { createMockTool, createSlowMockTool } from './__tests__/fixtures.js';
import { TEST_REQUEST_ID, SLOW_TOOL_DELAY_MS } from './__tests__/constants.js';

// Before: inline mock with magic numbers
const mockTool: NativeTool = {
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: { type: 'object', properties: {} },
  execute: vi.fn().mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 10)); // magic number!
    return { success: true, output: 'ok' };
  }),
};

// After: using fixtures and constants
const mockTool = createSlowMockTool('test_tool', SLOW_TOOL_DELAY_MS);
```

## Benefits

1. **Reduced Duplication**: Mock objects defined once, used everywhere
2. **Better Maintainability**: Change defaults in one place
3. **Improved Readability**: Named constants are self-documenting
4. **Consistency**: All tests use the same mock patterns
5. **Easier Refactoring**: Update fixture once, all tests benefit

## Guidelines

- Use fixtures for any mock that appears in 2+ tests
- Use constants for any magic number or hardcoded string
- Keep fixtures simple and focused
- Document complex fixtures with JSDoc comments
- Prefer specific fixture functions over generic ones with many options
