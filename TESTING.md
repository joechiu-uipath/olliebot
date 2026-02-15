# Testing Guide

This document provides comprehensive guidance on writing and organizing tests in the OllieBot codebase.

## Test Organization

### Test File Structure

Tests are colocated with source files using the `.test.ts` suffix:

```
src/
├── citations/
│   ├── extractors.ts
│   ├── extractors.test.ts       # Unit tests for extractors
│   ├── generator.ts
│   └── generator.test.ts        # Unit tests for generator
├── test-helpers/                # Shared test utilities
│   ├── constants.ts            # Magic number replacements
│   ├── builders.ts             # Test data factories
│   ├── utils.ts                # Common patterns
│   └── README.md               # Detailed helper documentation
```

### Test Categories

1. **Unit Tests** (`.test.ts`): Test pure functions and isolated logic
   - Fast, deterministic, no external dependencies
   - Focus on business logic, data transformations, algorithms
   - Use mocks for external services

2. **Integration Tests** (not yet implemented): Test component interactions
   - Test database operations, API integrations
   - May use test databases or sandboxed environments

3. **E2E Tests** (not yet implemented): Test complete workflows
   - User scenarios, multi-step processes
   - May require running servers, browsers

## Test Helpers

The `src/test-helpers/` directory provides shared utilities to improve test quality:

### Constants (`constants.ts`)

Replace magic numbers with named constants:

```typescript
// ❌ Bad: Magic numbers
expect(snippet.length).toBeLessThanOrEqual(203); // What is 203?

// ✅ Good: Named constants
expect(snippet.length).toBeLessThanOrEqual(
  WEB_SCRAPE_SNIPPET_MAX_LENGTH + 3 // 200 + '...'
);
```

**Available constants:**
- Truncation limits: `WEB_SCRAPE_SNIPPET_MAX_LENGTH`, `RAG_QUERY_SNIPPET_MAX_LENGTH`
- Buffer sizes: `SMALL_TEST_BUFFER_SIZE`, `LOG_BUFFER_MAX_QUERY_LIMIT`
- Score values: `PERFECT_SCORE`, `HALF_SCORE`, `ZERO_SCORE`
- Test data: `TEST_URL`, `TEST_DOMAIN`, `TEST_TIMESTAMP`
- Statistical: `STATISTICAL_SIGNIFICANCE_LEVEL`, `EFFECT_SIZE_MEDIUM_THRESHOLD`

### Builders (`builders.ts`)

Factory functions for creating test data with sensible defaults:

```typescript
// ❌ Bad: Inline object creation with all required fields
const result = {
  requestId: 'req-1',
  toolName: 'web_search',
  success: true,
  output: { results: [] },
  startTime: new Date(),
  endTime: new Date(),
  durationMs: 100,
};

// ✅ Good: Builder with defaults
const result = buildToolResult({
  requestId: 'req-1',
  toolName: 'web_search',
  success: true,
  output: { results: [] },
});
```

**Available builders:**
- `buildToolResult()`: Create ToolResult objects
- `buildSingleRunResult()`: Create evaluation run results
- `buildLogEntry()`: Create log buffer entries
- `buildCitationSource()`: Create citation sources
- `buildWebSearchResult()`, `buildRagQueryResult()`: Domain-specific results
- `buildToolCall()`: Create tool call records
- `repeatString()`, `buildDataUrl()`, `buildBase64String()`: Generate test data

### Utilities (`utils.ts`)

Common test patterns extracted as reusable functions:

```typescript
// ❌ Bad: Type assertion for accessing private methods
const result = (scorer as any).scoreParameters(actual, expected);

// ✅ Good: Helper function
const scoreParameters = getPrivateMethod(scorer, 'scoreParameters');
const result = scoreParameters(actual, expected);
```

**Available utilities:**
- `testPattern()`: Test string/RegExp patterns
- `getPrivateMethod()`: Access private methods for testing
- `mockEnv()`: Mock environment variables with cleanup
- `createIdGenerator()`: Generate sequential test IDs
- `expectEmptyForInvalidInputs()`: Reduce duplication in validation tests

## Writing Good Tests

### Test Structure (AAA Pattern)

```typescript
it('extracts citations from search results', () => {
  // Arrange: Set up test data
  const output = {
    query: 'test query',
    results: [buildWebSearchResult({ title: 'Result 1' })],
  };

  // Act: Execute the code under test
  const sources = webSearchExtractor.extract('req-1', 'web_search', {}, output);

  // Assert: Verify the outcome
  expect(sources).toHaveLength(1);
  expect(sources[0].title).toBe('Result 1');
});
```

### Test Naming

Use descriptive names that explain **what** and **why**:

```typescript
// ❌ Bad: Vague or technical
it('works', () => { /* ... */ });
it('test1', () => { /* ... */ });

// ✅ Good: Explains behavior and context
it('extracts citations from search results', () => { /* ... */ });
it('returns empty array for null/undefined output', () => { /* ... */ });
it('truncates long snippets to max length with ellipsis', () => { /* ... */ });
```

### Test Organization with `describe` Blocks

Group related tests logically:

```typescript
describe('webSearchExtractor', () => {
  describe('pattern matching', () => {
    it('matches only web_search tool name', () => { /* ... */ });
    it('does not match web_scrape', () => { /* ... */ });
  });

  describe('citation extraction', () => {
    it('extracts citations from search results', () => { /* ... */ });
    it('handles invalid URLs gracefully', () => { /* ... */ });
  });

  describe('error handling', () => {
    it('returns empty array for null/undefined output', () => { /* ... */ });
    it('returns empty array when results is not an array', () => { /* ... */ });
  });
});
```

### Edge Cases and Error Handling

Always test boundary conditions:

```typescript
describe('input validation', () => {
  it('handles null input', () => {
    expect(fn(null)).toEqual([]);
  });

  it('handles undefined input', () => {
    expect(fn(undefined)).toEqual([]);
  });

  it('handles empty string', () => {
    expect(fn('')).toEqual([]);
  });

  it('handles empty array', () => {
    expect(fn([])).toEqual([]);
  });
});
```

### Avoid Test Interdependence

Each test should be independent and isolated:

```typescript
// ❌ Bad: Tests depend on execution order
let sharedState;
it('test 1', () => { sharedState = {}; });
it('test 2', () => { sharedState.value = 42; }); // Depends on test 1

// ✅ Good: Each test sets up its own state
describe('MyClass', () => {
  let instance;
  
  beforeEach(() => {
    instance = new MyClass(); // Fresh state for each test
  });

  it('test 1', () => { /* ... */ });
  it('test 2', () => { /* ... */ });
});
```

## Common Patterns

### Testing Private Methods

Use `getPrivateMethod()` helper for focused unit testing:

```typescript
import { getPrivateMethod } from '../test-helpers/index.js';

const scorer = new Scorer(mockService);
const scoreParameters = getPrivateMethod(scorer, 'scoreParameters');

it('scores parameters correctly', () => {
  const result = scoreParameters(actual, expected);
  expect(result).toBe(PERFECT_SCORE);
});
```

### Testing with Constants

Replace all magic numbers with named constants:

```typescript
import { 
  PERFECT_SCORE, 
  HALF_SCORE,
  STATISTICAL_SIGNIFICANCE_LEVEL 
} from '../test-helpers/index.js';

it('returns perfect score when all match', () => {
  expect(score).toBe(PERFECT_SCORE); // Instead of 1.0
});

it('detects significant difference', () => {
  expect(result.pValue).toBeLessThan(STATISTICAL_SIGNIFICANCE_LEVEL); // Instead of 0.05
});
```

### Testing with Builders

Use builders for consistent test data:

```typescript
import { buildToolResult, buildLogEntry } from '../test-helpers/index.js';

it('formats tool result', () => {
  const result = buildToolResult({
    requestId: 'req-1',
    toolName: 'web_search',
    success: true,
    output: { query: 'test' },
  });
  
  const formatted = formatToolResult(result);
  expect(formatted.type).toBe('tool_result');
});
```

### Mocking Environment Variables

Use `mockEnv()` for clean environment testing:

```typescript
import { mockEnv } from '../test-helpers/index.js';

it('reads PORT from environment', () => {
  const restore = mockEnv({ PORT: '8080' });
  
  const config = loadConfig();
  expect(config.port).toBe(8080);
  
  restore(); // Clean up
});
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test src/citations/extractors.test.ts

# Run tests in directory
npm test src/citations/

# Run tests in watch mode
npm run test:watch

# Run with coverage (not yet configured)
npm run test:coverage
```

## Debugging Tests

### Using Console Output

```typescript
it('debugs a complex calculation', () => {
  const input = buildComplexInput();
  console.log('Input:', JSON.stringify(input, null, 2));
  
  const result = complexFunction(input);
  console.log('Result:', result);
  
  expect(result).toBe(expected);
});
```

### Using VSCode Debugger

1. Set breakpoints in test or source code
2. Run test file in debug mode
3. Inspect variables and step through code

## Best Practices

1. **One Assertion Per Test** (when practical): Focus each test on a single behavior
2. **Use Descriptive Names**: Test names should read like documentation
3. **Avoid Logic in Tests**: Tests should be simple and straightforward
4. **Test Behavior, Not Implementation**: Focus on what, not how
5. **Keep Tests Fast**: Unit tests should run in milliseconds
6. **Use Helpers**: Leverage test-helpers for consistency
7. **Document Complex Setup**: Add comments explaining non-obvious test setup
8. **Refactor Tests**: Keep test code clean and maintainable

## Anti-Patterns to Avoid

### ❌ Magic Numbers

```typescript
expect(result.length).toBeLessThanOrEqual(203);
```

### ❌ Inline Complex Objects

```typescript
const result = {
  requestId: 'req-1',
  toolName: 'test',
  success: true,
  startTime: new Date(),
  endTime: new Date(),
  durationMs: 100,
};
```

### ❌ Repeated Code

```typescript
it('test 1', () => {
  const obj = { /* complex setup */ };
  // test logic
});

it('test 2', () => {
  const obj = { /* same complex setup */ };
  // test logic
});
```

### ❌ Testing Implementation Details

```typescript
// Bad: Testing internal variable names
expect(instance._internalCache).toBeDefined();

// Good: Testing public behavior
expect(instance.getCachedValue()).toBe(expected);
```

## Contributing

When adding new tests:

1. Follow existing patterns in the test suite
2. Use test helpers for common operations
3. Add new builders/constants to test-helpers if needed
4. Update this guide with new patterns or conventions
5. Ensure all tests pass before committing

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Test Helpers README](src/test-helpers/README.md)
- [E2E Test Plan](docs/e2e-test-plan.md) (if exists)
