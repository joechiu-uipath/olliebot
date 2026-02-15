/**
 * Unit tests for Document Loader
 *
 * Tests file type detection, MIME type lookup, and text chunking logic.
 * Does NOT test actual file loading (filesystem dependency) — only the pure functions.
 * Maps to e2e test plan: RAG-010 (supported extensions)
 */

import { describe, it, expect } from 'vitest';
import { isSupportedFile, getMimeType, SUPPORTED_EXTENSIONS } from './document-loader.js';

describe('SUPPORTED_EXTENSIONS', () => {
  it('includes expected file types', () => {
    expect(SUPPORTED_EXTENSIONS['.pdf']).toBe('application/pdf');
    expect(SUPPORTED_EXTENSIONS['.txt']).toBe('text/plain');
    expect(SUPPORTED_EXTENSIONS['.md']).toBe('text/markdown');
    expect(SUPPORTED_EXTENSIONS['.json']).toBe('application/json');
    expect(SUPPORTED_EXTENSIONS['.csv']).toBe('text/csv');
    expect(SUPPORTED_EXTENSIONS['.html']).toBe('text/html');
    expect(SUPPORTED_EXTENSIONS['.htm']).toBe('text/html');
  });

  it('does not include unsupported types', () => {
    expect(SUPPORTED_EXTENSIONS['.exe']).toBeUndefined();
    expect(SUPPORTED_EXTENSIONS['.zip']).toBeUndefined();
    expect(SUPPORTED_EXTENSIONS['.png']).toBeUndefined();
  });
});

describe('isSupportedFile', () => {
  it('returns true for supported extensions', () => {
    expect(isSupportedFile('document.pdf')).toBe(true);
    expect(isSupportedFile('notes.txt')).toBe(true);
    expect(isSupportedFile('readme.md')).toBe(true);
    expect(isSupportedFile('data.json')).toBe(true);
    expect(isSupportedFile('page.html')).toBe(true);
    expect(isSupportedFile('page.htm')).toBe(true);
    expect(isSupportedFile('data.csv')).toBe(true);
    expect(isSupportedFile('docs.markdown')).toBe(true);
  });

  it('returns false for unsupported extensions', () => {
    expect(isSupportedFile('image.png')).toBe(false);
    expect(isSupportedFile('archive.zip')).toBe(false);
    expect(isSupportedFile('program.exe')).toBe(false);
    expect(isSupportedFile('video.mp4')).toBe(false);
  });

  it('handles case-insensitive extensions', () => {
    expect(isSupportedFile('document.PDF')).toBe(true);
    expect(isSupportedFile('notes.TXT')).toBe(true);
    expect(isSupportedFile('data.JSON')).toBe(true);
  });

  it('handles files with path', () => {
    expect(isSupportedFile('/path/to/document.pdf')).toBe(true);
    expect(isSupportedFile('C:\\docs\\file.txt')).toBe(true);
  });

  it('handles files with no extension', () => {
    expect(isSupportedFile('Dockerfile')).toBe(false);
    expect(isSupportedFile('README')).toBe(false);
  });

  it('handles files with multiple dots', () => {
    expect(isSupportedFile('my.report.v2.pdf')).toBe(true);
    expect(isSupportedFile('archive.tar.gz')).toBe(false);
  });
});

describe('getMimeType', () => {
  it('returns correct MIME type for supported files', () => {
    expect(getMimeType('doc.pdf')).toBe('application/pdf');
    expect(getMimeType('file.txt')).toBe('text/plain');
    expect(getMimeType('page.html')).toBe('text/html');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
    expect(getMimeType('file.bin')).toBe('application/octet-stream');
  });

  it('handles case-insensitive lookup', () => {
    expect(getMimeType('doc.PDF')).toBe('application/pdf');
    expect(getMimeType('file.MD')).toBe('text/markdown');
  });
});
