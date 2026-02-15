/**
 * Unit tests for strip-binary utility
 *
 * Tests the pure function that strips base64/binary data from tool outputs.
 * Ensures LLM doesn't receive large binary blobs that waste context tokens.
 */

import { describe, it, expect } from 'vitest';
import { stripBinaryDataForLLM } from './strip-binary.js';

describe('stripBinaryDataForLLM', () => {
  it('returns null and undefined unchanged', () => {
    expect(stripBinaryDataForLLM(null)).toBeNull();
    expect(stripBinaryDataForLLM(undefined)).toBeUndefined();
  });

  it('returns primitives unchanged', () => {
    expect(stripBinaryDataForLLM(42)).toBe(42);
    expect(stripBinaryDataForLLM(true)).toBe(true);
    expect(stripBinaryDataForLLM('hello')).toBe('hello');
  });

  it('replaces data URL strings with placeholder', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...';
    const result = stripBinaryDataForLLM(dataUrl) as string;
    expect(result).toMatch(/^\[Binary data: \d+KB - displayed to user\]$/);
  });

  it('replaces long base64-looking strings with placeholder', () => {
    const base64 = 'A'.repeat(2000); // Long alphanumeric string
    const result = stripBinaryDataForLLM(base64) as string;
    expect(result).toMatch(/^\[Base64 data: \d+KB - displayed to user\]$/);
  });

  it('does not replace short strings', () => {
    expect(stripBinaryDataForLLM('short string')).toBe('short string');
    expect(stripBinaryDataForLLM('A'.repeat(500))).toBe('A'.repeat(500));
  });

  it('does not replace strings that are not base64', () => {
    const normalText = 'This is a normal paragraph with spaces and punctuation! ' +
      'It contains many characters but is not base64. '.repeat(30);
    expect(stripBinaryDataForLLM(normalText)).toBe(normalText);
  });

  it('strips binary data from known field names in objects', () => {
    const obj = {
      screenshot: 'data:image/png;base64,iVBORw0KGgo...',
      description: 'A screenshot of the page',
    };

    const result = stripBinaryDataForLLM(obj) as Record<string, unknown>;
    expect(result.screenshot).toMatch(/\[Image data: \d+KB - displayed to user\]/);
    expect(result.description).toBe('A screenshot of the page');
  });

  it('recognizes all known binary field names', () => {
    const binaryFields = ['dataUrl', 'screenshot', 'image', 'imageData', 'base64', 'b64_json'];
    for (const field of binaryFields) {
      const obj = { [field]: 'data:image/png;base64,abc123' };
      const result = stripBinaryDataForLLM(obj) as Record<string, unknown>;
      expect(result[field]).toMatch(/\[Image data:/);
    }
  });

  it('recursively processes nested objects', () => {
    const nested = {
      level1: {
        level2: {
          screenshot: 'data:image/jpeg;base64,/9j/4AAQSkZJRg...',
          text: 'Nested text',
        },
      },
    };

    const result = stripBinaryDataForLLM(nested) as Record<string, unknown>;
    const level2 = (result.level1 as Record<string, unknown>).level2 as Record<string, unknown>;
    expect(level2.screenshot).toMatch(/\[Image data:/);
    expect(level2.text).toBe('Nested text');
  });

  it('recursively processes arrays', () => {
    const arr = [
      'data:image/png;base64,iVBORw0KGgo...',
      'normal text',
      { image: 'data:image/png;base64,abc' },
    ];

    const result = stripBinaryDataForLLM(arr) as unknown[];
    expect(result[0]).toMatch(/\[Binary data:/);
    expect(result[1]).toBe('normal text');
    expect((result[2] as Record<string, unknown>).image).toMatch(/\[Image data:/);
  });

  it('correctly calculates size in KB', () => {
    const data = 'data:image/png;base64,' + 'A'.repeat(10240); // ~10KB
    const result = stripBinaryDataForLLM(data) as string;
    expect(result).toContain('10KB');
  });
});
