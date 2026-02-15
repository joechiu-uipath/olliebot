/**
 * Test Fixtures for CitationGenerator Tests
 *
 * Sample responses and sources for citation testing.
 */

import { buildCitationSource, TEST_REQUEST_ID_PREFIX, TEST_URL } from '../../test-helpers/index.js';

/**
 * Short response that should skip citation (< 50 chars).
 */
export const SHORT_RESPONSE = 'Short';

/**
 * Code-heavy response (>80% code blocks) that should skip citation.
 */
export const CODE_HEAVY_RESPONSE = (() => {
  const codeBlock = '```javascript\nconst x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);\n```';
  return `Here is the code:\n${codeBlock}\n${codeBlock}\n${codeBlock}\n${codeBlock}\n${codeBlock}`;
})();

/**
 * Response with moderate code (<80%) that should NOT skip citation.
 */
export const MODERATE_CODE_RESPONSE = 
  'This is a long explanation about how the system works. '.repeat(5)
  + '```js\nconst x = 1;\n```';

/**
 * Standard response with enough content for citation processing.
 */
export const STANDARD_RESPONSE = 
  'According to sources, the capital of France is Paris. This is a well-known fact.';

/**
 * Long response for testing citation extraction.
 */
export const LONG_RESPONSE = 
  'A response with enough content to be processed for citation generation purposes. '.repeat(3);

/**
 * Sample citation source.
 */
export function createSampleSource(id: string = 'src-1') {
  return buildCitationSource({
    id,
    title: 'Test Source',
    snippet: 'The capital of France is Paris.',
    uri: TEST_URL,
  });
}

/**
 * Mock LLM response with citations in JSON format.
 */
export const MOCK_LLM_CITATION_JSON = JSON.stringify({
  citations: [
    {
      claim: 'the capital of France is Paris',
      sourceIndex: 1,
      confidence: 'full',
    },
  ],
});

/**
 * Mock LLM response with citations wrapped in markdown code fence.
 */
export const MOCK_LLM_CITATION_WITH_FENCE = 
  '```json\n' + MOCK_LLM_CITATION_JSON + '\n```';

/**
 * Mock LLM response with empty citations.
 */
export const MOCK_EMPTY_CITATIONS = JSON.stringify({
  citations: [],
});

/**
 * Mock LLM response with invalid JSON.
 */
export const MOCK_INVALID_JSON = 'This is not valid JSON at all!';

/**
 * Mock LLM response with "none" confidence citation (should be filtered).
 */
export const MOCK_NONE_CONFIDENCE_CITATION = JSON.stringify({
  citations: [
    {
      claim: 'Some long response',
      sourceIndex: 1,
      confidence: 'none',
    },
  ],
});

/**
 * Mock LLM response with out-of-bounds source index.
 */
export const MOCK_OUT_OF_BOUNDS_CITATION = JSON.stringify({
  citations: [
    {
      claim: 'Some long response',
      sourceIndex: 99,
      confidence: 'full',
    },
  ],
});

/**
 * Citation thresholds.
 */
export const CITATION_THRESHOLDS = {
  MIN_RESPONSE_LENGTH: 50,
  MAX_CODE_RATIO: 0.8,
};
