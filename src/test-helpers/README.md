# Test Helpers

This directory contains shared utilities, builders, and constants used across the test suite to improve organization, reduce duplication, and enhance maintainability.

## Structure

- **`constants.ts`**: Centralized numeric and string constants to avoid magic numbers in tests
- **`builders.ts`**: Factory functions for creating common test objects with sensible defaults
- **`utils.ts`**: Helper functions and common test patterns
- **`index.ts`**: Barrel export for convenient imports

## Usage

### Importing Test Helpers

```typescript
import { 
  buildToolResult, 
  buildSingleRunResult,
  WEB_SCRAPE_SNIPPET_MAX_LENGTH,
  testPattern 
} from '../test-helpers/index.js';
```

### Using Builders

Builders provide a convenient way to create test objects with required fields and sensible defaults:

```typescript
// Create a ToolResult with minimal config
const result = buildToolResult({
  requestId: 'req-1',
  toolName: 'web_search',
  success: true,
  output: { results: [] }
});

// Create a SingleRunResult for evaluation tests
const runResult = buildSingleRunResult({
  toolSelectionScore: 0.8,
  overallScore: 0.75
});
```

### Using Constants

Replace magic numbers with named constants for clarity:

```typescript
// Instead of:
expect(sources[0].snippet!.length).toBeLessThanOrEqual(203); // 200 + '...'

// Use:
expect(sources[0].snippet!.length).toBeLessThanOrEqual(
  WEB_SCRAPE_SNIPPET_MAX_LENGTH + 3 // 3 for '...'
);
```

### Using Utilities

Common patterns extracted as reusable functions:

```typescript
// Test citation pattern matching
expect(testPattern(extractor.pattern, 'web_search')).toBe(true);

// Access private methods for unit testing
const privateMethod = getPrivateMethod(scorer, 'scoreParameters');
const result = privateMethod(actual, expected);

// Mock environment variables
const restore = mockEnv({ PORT: '8080' });
// ... test code ...
restore(); // Clean up
```

## Best Practices

1. **Avoid Magic Numbers**: Always use named constants from `constants.ts` instead of hardcoded numbers
2. **Use Builders**: Prefer builders over inline object creation for complex test data
3. **DRY Principle**: Extract repeated test patterns into utilities
4. **Documentation**: Add JSDoc comments explaining the purpose of builders and utilities
5. **Type Safety**: Leverage TypeScript to ensure test data matches production types

## Adding New Helpers

When adding new shared test utilities:

1. Place them in the appropriate file (`constants.ts`, `builders.ts`, or `utils.ts`)
2. Add JSDoc documentation explaining purpose and usage
3. Export from `index.ts`
4. Update this README with examples
5. Consider if existing tests could benefit from the new helper

## Testing Conventions

### Test File Organization

```typescript
describe('ComponentName', () => {
  describe('methodName', () => {
    it('describes expected behavior in specific scenario', () => {
      // Arrange: Set up test data using builders
      // Act: Execute the code under test
      // Assert: Verify the outcome
    });
  });
});
```

### Test Naming

- Use descriptive test names that explain **what** is being tested and **why**
- Start with a verb: "returns", "handles", "validates", "throws"
- Include context: "when input is invalid", "for authenticated users"

### Test Data

- Use builders for complex objects
- Use constants for numeric thresholds and limits
- Make test data realistic but minimal

## Examples

### Before Refactoring

```typescript
it('truncates long snippets', () => {
  const longDesc = 'A'.repeat(300);
  const output = {
    url: 'https://example.com',
    metaDescription: longDesc,
    // ... more fields
  };
  const sources = webScrapeExtractor.extract('req-4', 'web_scrape', {}, output);
  expect(sources[0].snippet!.length).toBeLessThanOrEqual(203);
  expect(sources[0].snippet!.endsWith('...')).toBe(true);
});
```

### After Refactoring

```typescript
it('truncates long snippets to max length with ellipsis', () => {
  const longDesc = repeatString('A', LONG_STRING_LENGTH_300);
  const output = {
    url: TEST_URL,
    metaDescription: longDesc,
    contentType: 'text/html',
    outputMode: 'markdown',
    contentLength: LONG_STRING_LENGTH_300,
  };
  
  const sources = webScrapeExtractor.extract(
    `${TEST_REQUEST_ID_PREFIX}4`, 
    'web_scrape', 
    {}, 
    output
  );
  
  expect(sources[0].snippet!.length).toBeLessThanOrEqual(
    WEB_SCRAPE_SNIPPET_MAX_LENGTH + 3 // 3 for '...'
  );
  expect(sources[0].snippet!.endsWith('...')).toBe(true);
});
```

## Maintenance

- Review and update constants when business logic changes
- Refactor builders when new required fields are added to types
- Extract new patterns when you notice duplication in 2+ test files
- Keep this README up to date with examples and conventions
