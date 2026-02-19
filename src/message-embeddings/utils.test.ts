/**
 * Unit tests for Message Embedding Utilities
 *
 * Tests snippet creation logic.
 */

import { describe, it, expect } from 'vitest';
import { createSnippet } from './utils.js';

describe('createSnippet', () => {
  it('returns text as-is when shorter than maxLength', () => {
    const text = 'Short message';
    expect(createSnippet(text, 50)).toBe(text);
    expect(createSnippet(text, text.length)).toBe(text);
  });

  it('truncates at word boundary when possible', () => {
    const text = 'This is a very long message that needs to be truncated';
    const result = createSnippet(text, 30);
    
    expect(result.length).toBeLessThanOrEqual(34); // 30 + '...'
    expect(result).toMatch(/\.\.\.$/);
    expect(result).not.toContain('verylongmess'); // Should not split words
  });

  it('truncates at maxLength if no good word boundary exists', () => {
    const text = 'Thisisaverylongwordwithoutanyspaces';
    const result = createSnippet(text, 20);
    
    expect(result).toHaveLength(23); // 20 + '...'
    expect(result).toMatch(/\.\.\.$/);
  });

  it('only truncates at word boundary if space is beyond halfway point', () => {
    // If the last space is too far back (before maxLength/2), truncate at maxLength
    const text = 'Short word' + 'x'.repeat(50);
    const result = createSnippet(text, 40);
    
    expect(result).toHaveLength(43); // 40 + '...'
    expect(result).toMatch(/\.\.\.$/);
  });

  it('handles empty strings', () => {
    expect(createSnippet('', 50)).toBe('');
  });

  it('handles strings exactly at maxLength', () => {
    const text = 'x'.repeat(30);
    expect(createSnippet(text, 30)).toBe(text);
  });

  it('preserves leading spaces', () => {
    const text = '   Leading spaces and more text here';
    const result = createSnippet(text, 20);
    expect(result).toMatch(/^   /);
  });
});
