/**
 * Test Utilities
 *
 * Helper functions and patterns used across multiple test files.
 */

/**
 * Helper to test a CitationExtractor.pattern (may be string or RegExp) against a value.
 * Used by citation extractor tests.
 */
export function testPattern(pattern: string | RegExp, value: string): boolean {
  return pattern instanceof RegExp ? pattern.test(value) : pattern === value;
}

/**
 * Helper to access private methods on an object for focused unit testing.
 * Use with caution - only for testing internal logic without exposing public APIs.
 *
 * @example
 * const scorer = new Scorer(mockService);
 * const privateMethod = getPrivateMethod(scorer, 'scoreParameters');
 * const result = privateMethod(actual, expected);
 */
export function getPrivateMethod<T, K extends string>(
  instance: T,
  methodName: K
): any {
  return (instance as any)[methodName].bind(instance);
}

/**
 * Assertion helper for checking if a number is within a range.
 */
export function expectInRange(
  value: number,
  min: number,
  max: number,
  message?: string
): void {
  if (value < min || value > max) {
    throw new Error(
      message || `Expected ${value} to be between ${min} and ${max}`
    );
  }
}

/**
 * Assertion helper for checking if a value matches a regex pattern.
 */
export function expectToMatch(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

/**
 * Sleep for a specified number of milliseconds (for timing-dependent tests).
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a mock function that tracks calls.
 */
export function createMockFunction<T extends (...args: any[]) => any>(): {
  fn: T;
  calls: Array<Parameters<T>>;
  results: Array<ReturnType<T>>;
} {
  const calls: Array<Parameters<T>> = [];
  const results: Array<ReturnType<T>> = [];

  const fn = ((...args: Parameters<T>): ReturnType<T> => {
    calls.push(args);
    const result = undefined as ReturnType<T>;
    results.push(result);
    return result;
  }) as T;

  return { fn, calls, results };
}

/**
 * Helper to clean up process.env in tests.
 * Returns a function to restore original env.
 */
export function mockEnv(overrides: Record<string, string | undefined>): () => void {
  const original = { ...process.env };
  
  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  // Return cleanup function
  return () => {
    process.env = original;
  };
}

/**
 * Helper to generate sequential IDs for tests.
 */
export function createIdGenerator(prefix: string = 'test-') {
  let counter = 0;
  return () => `${prefix}${++counter}`;
}

/**
 * Common pattern: Test that a function returns empty array for invalid inputs.
 * Reduces duplication across extractor tests.
 */
export function expectEmptyForInvalidInputs(
  fn: (...args: any[]) => any[],
  ...argSets: any[][]
): void {
  for (const args of argSets) {
    const result = fn(...args);
    if (!Array.isArray(result) || result.length !== 0) {
      throw new Error(
        `Expected empty array for args ${JSON.stringify(args)}, got ${JSON.stringify(result)}`
      );
    }
  }
}
