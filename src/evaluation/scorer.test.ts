/**
 * Unit tests for Evaluation Scorer (non-LLM methods)
 *
 * Tests the pure scoring logic: tool selection scoring, parameter matching,
 * constraint checking, delegation scoring, element scoring.
 * Does NOT test semantic matching (requires LLM) — that's integration-level.
 * Maps to e2e test plan: EVAL-009 (tool expectations), EVAL-010 (response expectations)
 */

import { describe, it, expect } from 'vitest';
import { Scorer } from './scorer.js';
import { 
  getPrivateMethod, 
  buildToolCall,
  PERFECT_SCORE,
  HALF_SCORE,
  ZERO_SCORE,
} from '../test-helpers/index.js';
import type { EvaluationDefinition } from './types.js';

// Create scorer with a mock LLM service (not used in these tests)
const mockLLMService = {} as any;
const scorer = new Scorer(mockLLMService);

// Access private methods for focused unit testing
const scoreToolSelection = getPrivateMethod(scorer, 'scoreToolSelection');
const scoreParameters = getPrivateMethod(scorer, 'scoreParameters');
const matchParameterValue = getPrivateMethod(scorer, 'matchParameterValue');
const checkConstraints = getPrivateMethod(scorer, 'checkConstraints');
const scoreDelegation = getPrivateMethod(scorer, 'scoreDelegation');
const calculateElementScore = getPrivateMethod(scorer, 'calculateElementScore');

describe('Scorer - matchParameterValue', () => {
  it('exact match succeeds', () => {
    expect(matchParameterValue('hello', { matchType: 'exact', expected: 'hello' })).toBe(true);
  });

  it('exact match fails on mismatch', () => {
    expect(matchParameterValue('hello', { matchType: 'exact', expected: 'world' })).toBe(false);
  });

  it('contains match is case-insensitive', () => {
    expect(matchParameterValue('Hello World', { matchType: 'contains', expected: 'hello' })).toBe(true);
  });

  it('contains match fails when not present', () => {
    expect(matchParameterValue('Hello', { matchType: 'contains', expected: 'xyz' })).toBe(false);
  });

  it('regex match works', () => {
    expect(matchParameterValue('test-123', { matchType: 'regex', pattern: 'test-\\d+' })).toBe(true);
    expect(matchParameterValue('abc', { matchType: 'regex', pattern: '\\d+' })).toBe(false);
  });

  it('regex match returns false without pattern', () => {
    expect(matchParameterValue('test', { matchType: 'regex' })).toBe(false);
  });

  it('semantic match falls back to contains', () => {
    expect(matchParameterValue('weather in Paris', { matchType: 'semantic', expected: 'paris' })).toBe(true);
  });

  it('range matching for numbers', () => {
    expect(matchParameterValue(5, { min: 1, max: 10 })).toBe(true);
    expect(matchParameterValue(15, { min: 1, max: 10 })).toBe(false);
    expect(matchParameterValue(0, { min: 1 })).toBe(false);
  });
});

describe('Scorer - scoreParameters', () => {
  it('returns perfect score for empty expectations', () => {
    expect(scoreParameters({ a: 1 }, {})).toBe(PERFECT_SCORE);
  });

  it('returns perfect score when all parameters match', () => {
    const actual = { query: 'test search', limit: 10 };
    const expected = {
      query: { matchType: 'contains', expected: 'test' },
      limit: { matchType: 'exact', expected: 10 },
    };
    expect(scoreParameters(actual, expected)).toBe(PERFECT_SCORE);
  });

  it('returns half score when half parameters match', () => {
    const actual = { query: 'test', limit: 5 };
    const expected = {
      query: { matchType: 'exact', expected: 'test' },
      limit: { matchType: 'exact', expected: 10 },
    };
    expect(scoreParameters(actual, expected)).toBe(HALF_SCORE);
  });

  it('returns zero score when parameter is missing', () => {
    const actual = {};
    const expected = { query: { matchType: 'exact', expected: 'test' } };
    expect(scoreParameters(actual, expected)).toBe(ZERO_SCORE);
  });
});

describe('Scorer - scoreToolSelection', () => {
  it('returns perfect score when no tool expectations', () => {
    const def = { toolExpectations: undefined } as any;
    const { score } = scoreToolSelection(def, []);
    expect(score).toBe(PERFECT_SCORE);
  });

  it('scores correct tools called', () => {
    const def = {
      toolExpectations: {
        expectedTools: [
          { name: 'web_search', required: true },
          { name: 'web_scrape', required: true },
        ],
        forbiddenTools: ['delete_file'],
      },
    } as any;

    const calls = [
      buildToolCall({ toolName: 'web_search', order: 0 }),
      buildToolCall({ toolName: 'web_scrape', order: 1 }),
    ];

    const { score, toolCallResults } = scoreToolSelection(def, calls);
    expect(score).toBeGreaterThan(HALF_SCORE);
    expect(toolCallResults).toHaveLength(2);
    expect(toolCallResults[0].wasExpected).toBe(true);
    expect(toolCallResults[0].wasForbidden).toBe(false);
  });

  it('penalizes missing required tools', () => {
    const def = {
      toolExpectations: {
        expectedTools: [
          { name: 'web_search', required: true },
          { name: 'web_scrape', required: true },
        ],
      },
    } as any;

    // Only called one of two required tools
    const calls = [buildToolCall({ toolName: 'web_search', order: 0 })];

    const { score } = scoreToolSelection(def, calls);
    // Score should be less than if all tools were called
    expect(score).toBeLessThan(PERFECT_SCORE);
  });

  it('penalizes forbidden tools', () => {
    const def = {
      toolExpectations: {
        expectedTools: [],
        forbiddenTools: ['dangerous_tool'],
      },
    } as any;

    const calls = [buildToolCall({ toolName: 'dangerous_tool', order: 0 })];

    const { toolCallResults } = scoreToolSelection(def, calls);
    expect(toolCallResults[0].wasForbidden).toBe(true);
  });
});

describe('Scorer - checkConstraints', () => {
  it('returns empty violations when no constraints', () => {
    expect(checkConstraints(undefined, 'response')).toEqual([]);
    expect(checkConstraints(null, 'response')).toEqual([]);
  });

  it('detects maxLength violation', () => {
    const violations = checkConstraints({ maxLength: 10 }, 'a very long response text');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('exceeds max length');
  });

  it('detects minLength violation', () => {
    const violations = checkConstraints({ minLength: 100 }, 'short');
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('below min length');
  });

  it('detects forbidden pattern violations', () => {
    const violations = checkConstraints(
      { forbiddenPatterns: ['TODO', 'FIXME'] },
      'This response contains a TODO item'
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('TODO');
  });

  it('returns no violations when all constraints met', () => {
    const violations = checkConstraints(
      { maxLength: 1000, minLength: 5, forbiddenPatterns: ['ERROR'] },
      'This is a valid response.'
    );
    expect(violations).toEqual([]);
  });
});

describe('Scorer - scoreDelegation', () => {
  it('scores correct delegation decision', () => {
    const score = scoreDelegation(
      { shouldDelegate: true, expectedAgentType: 'researcher' },
      { delegated: true, agentType: 'researcher' }
    );
    expect(score).toBeGreaterThan(0.8);
  });

  it('scores incorrect delegation decision', () => {
    const score = scoreDelegation(
      { shouldDelegate: true },
      { delegated: false }
    );
    expect(score).toBeLessThan(0.5);
  });

  it('scores correct non-delegation', () => {
    const score = scoreDelegation(
      { shouldDelegate: false },
      { delegated: false }
    );
    expect(score).toBeGreaterThan(0.8);
  });

  it('scores wrong agent type', () => {
    const correctType = scoreDelegation(
      { shouldDelegate: true, expectedAgentType: 'researcher' },
      { delegated: true, agentType: 'researcher' }
    );
    const wrongType = scoreDelegation(
      { shouldDelegate: true, expectedAgentType: 'researcher' },
      { delegated: true, agentType: 'coder' }
    );
    expect(correctType).toBeGreaterThan(wrongType);
  });

  it('scores rationale keyword mentions', () => {
    const withKeywords = scoreDelegation(
      { shouldDelegate: true, delegationRationaleShouldMention: ['research', 'web'] },
      { delegated: true, agentType: 'researcher', rationale: 'Needs research on the web for answers' }
    );
    const withoutKeywords = scoreDelegation(
      { shouldDelegate: true, delegationRationaleShouldMention: ['research', 'web'] },
      { delegated: true, agentType: 'researcher', rationale: 'Task completed' }
    );
    expect(withKeywords).toBeGreaterThan(withoutKeywords);
  });
});

describe('Scorer - calculateElementScore', () => {
  it('returns 0 for empty elements', () => {
    expect(calculateElementScore([], [])).toBe(0);
  });

  it('computes weighted score correctly', () => {
    const elements = [
      { id: 'e1', weight: 1.0 },
      { id: 'e2', weight: 1.0 },
    ];
    const results = [
      { elementId: 'e1', confidence: 1.0 },
      { elementId: 'e2', confidence: 0.5 },
    ];
    expect(calculateElementScore(elements, results)).toBe(0.75);
  });

  it('respects different weights', () => {
    const elements = [
      { id: 'e1', weight: 3.0 },
      { id: 'e2', weight: 1.0 },
    ];
    const results = [
      { elementId: 'e1', confidence: 1.0 },
      { elementId: 'e2', confidence: 0.0 },
    ];
    // Weighted: (1.0*3 + 0.0*1) / (3+1) = 0.75
    expect(calculateElementScore(elements, results)).toBe(0.75);
  });
});
