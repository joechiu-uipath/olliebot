/**
 * Unit tests for Model Capabilities
 *
 * Tests the lookup table and getModelCapabilities function that determines
 * which reasoning/thinking features a model supports.
 * Maps to e2e test plan: LLM-011 (extended thinking), LLM-012 (reasoning effort)
 */

import { describe, it, expect } from 'vitest';
import { getModelCapabilities, MODEL_CAPABILITIES } from './model-capabilities.js';

describe('getModelCapabilities', () => {
  it('returns capabilities for known OpenAI models', () => {
    const caps = getModelCapabilities('openai', 'o3');
    expect(caps.supportsReasoningEffort).toBe(true);
    expect(caps.reasoningEfforts).toContain('high');
    expect(caps.defaultEffort).toBe('medium');
  });

  it('returns capabilities for known Anthropic models', () => {
    const caps = getModelCapabilities('anthropic', 'claude-sonnet-4');
    expect(caps.supportsReasoningEffort).toBe(true);
    expect(caps.reasoningEfforts).toContain('high');
  });

  it('returns capabilities for known Google models', () => {
    const caps = getModelCapabilities('google', 'gemini-2.5-pro');
    expect(caps.supportsReasoningEffort).toBe(true);
    expect(caps.defaultEffort).toBe('medium');
  });

  it('returns default (no reasoning) for unknown models', () => {
    const caps = getModelCapabilities('openai', 'gpt-3.5-turbo');
    expect(caps.supportsReasoningEffort).toBe(false);
    expect(caps.reasoningEfforts).toEqual([]);
    expect(caps.defaultEffort).toBeUndefined();
  });

  it('returns default for completely unknown provider/model', () => {
    const caps = getModelCapabilities('unknown_provider', 'unknown_model');
    expect(caps.supportsReasoningEffort).toBe(false);
    expect(caps.reasoningEfforts).toEqual([]);
  });

  it('ignores provider parameter (lookup is model-only)', () => {
    const withCorrectProvider = getModelCapabilities('openai', 'o3');
    const withWrongProvider = getModelCapabilities('anthropic', 'o3');
    expect(withCorrectProvider).toEqual(withWrongProvider);
  });

  it('recognizes models with xhigh reasoning level', () => {
    const caps = getModelCapabilities('openai', 'gpt-5.2');
    expect(caps.reasoningEfforts).toContain('xhigh');
    expect(caps.reasoningEfforts).toContain('high');
  });

  it('recognizes gpt-5-pro as not supporting reasoning effort toggle', () => {
    const caps = getModelCapabilities('openai', 'gpt-5-pro');
    expect(caps.supportsReasoningEffort).toBe(false);
    expect(caps.defaultEffort).toBe('high');
  });
});

describe('MODEL_CAPABILITIES lookup table', () => {
  it('has entries for all major provider families', () => {
    const models = Object.keys(MODEL_CAPABILITIES);
    const hasOpenAI = models.some(m => m.startsWith('o') || m.startsWith('gpt'));
    const hasAnthropic = models.some(m => m.startsWith('claude'));
    const hasGoogle = models.some(m => m.startsWith('gemini'));
    expect(hasOpenAI).toBe(true);
    expect(hasAnthropic).toBe(true);
    expect(hasGoogle).toBe(true);
  });

  it('all entries have valid structure', () => {
    for (const [model, caps] of Object.entries(MODEL_CAPABILITIES)) {
      expect(typeof caps.supportsReasoningEffort).toBe('boolean');
      expect(Array.isArray(caps.reasoningEfforts)).toBe(true);
      for (const effort of caps.reasoningEfforts) {
        expect(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(effort);
      }
      if (caps.defaultEffort !== undefined) {
        expect(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(caps.defaultEffort);
      }
    }
  });
});
