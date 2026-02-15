/**
 * Unit tests for LogBuffer (circular buffer)
 *
 * Tests the circular buffer data structure, querying with filters,
 * and buffer overflow behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LogBuffer } from './log-buffer.js';
import type { LogEntry } from './log-buffer.js';

describe('LogBuffer', () => {
  let buffer: LogBuffer;

  beforeEach(() => {
    buffer = new LogBuffer(5); // Small buffer for testing
  });

  describe('basic operations', () => {
    it('starts empty', () => {
      expect(buffer.size()).toBe(0);
      expect(buffer.query()).toEqual([]);
    });

    it('pushes external entries and tracks size', () => {
      buffer.pushExternal({
        timestamp: '2024-01-01T00:00:00Z',
        level: 'log',
        message: 'test message',
        source: 'server',
      });

      expect(buffer.size()).toBe(1);
    });

    it('queries entries', () => {
      buffer.pushExternal({
        timestamp: '2024-01-01T00:00:00Z',
        level: 'log',
        message: 'hello world',
        source: 'server',
      });

      const results = buffer.query();
      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('hello world');
    });

    it('clears all entries', () => {
      buffer.pushExternal({
        timestamp: '2024-01-01T00:00:00Z',
        level: 'log',
        message: 'test',
        source: 'server',
      });

      buffer.clear();
      expect(buffer.size()).toBe(0);
      expect(buffer.query()).toEqual([]);
    });
  });

  describe('circular buffer behavior', () => {
    it('overwrites oldest entries when full', () => {
      for (let i = 0; i < 7; i++) {
        buffer.pushExternal({
          timestamp: `2024-01-01T00:00:0${i}Z`,
          level: 'log',
          message: `msg-${i}`,
          source: 'server',
        });
      }

      // Buffer size is 5, so only 5 entries should be kept
      expect(buffer.size()).toBe(5);

      const results = buffer.query({ limit: 10 });
      expect(results).toHaveLength(5);
      // Oldest entries (0, 1) should be gone, newest (2-6) should remain
      expect(results[0].message).toBe('msg-2');
      expect(results[4].message).toBe('msg-6');
    });
  });

  describe('query filtering', () => {
    beforeEach(() => {
      const entries: LogEntry[] = [
        { timestamp: '2024-01-01T00:00:01Z', level: 'log', message: 'info message', source: 'server' },
        { timestamp: '2024-01-01T00:00:02Z', level: 'warn', message: 'warning message', source: 'server' },
        { timestamp: '2024-01-01T00:00:03Z', level: 'error', message: 'error message', source: 'server' },
        { timestamp: '2024-01-01T00:00:04Z', level: 'log', message: 'web log entry', source: 'web' },
      ];
      for (const entry of entries) {
        buffer.pushExternal(entry);
      }
    });

    it('filters by level', () => {
      const results = buffer.query({ level: 'warn' });
      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('warning message');
    });

    it('filters by source', () => {
      const results = buffer.query({ source: 'web' });
      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('web log entry');
    });

    it('filters by grep (case-insensitive)', () => {
      const results = buffer.query({ grep: 'WARNING' });
      expect(results).toHaveLength(1);
      expect(results[0].level).toBe('warn');
    });

    it('filters by since timestamp', () => {
      const results = buffer.query({ since: '2024-01-01T00:00:02Z' });
      expect(results).toHaveLength(2); // entries at :03 and :04
    });

    it('limits results to last N entries', () => {
      const results = buffer.query({ limit: 2 });
      expect(results).toHaveLength(2);
      // Should be the most recent 2
      expect(results[0].message).toBe('error message');
      expect(results[1].message).toBe('web log entry');
    });

    it('enforces maximum query limit of 500', () => {
      const bigBuffer = new LogBuffer(1000);
      for (let i = 0; i < 600; i++) {
        bigBuffer.pushExternal({
          timestamp: new Date().toISOString(),
          level: 'log',
          message: `msg-${i}`,
          source: 'server',
        });
      }

      const results = bigBuffer.query({ limit: 999 });
      expect(results.length).toBeLessThanOrEqual(500);
    });

    it('enforces minimum query limit of 1', () => {
      const results = buffer.query({ limit: 0 });
      expect(results).toHaveLength(1); // Min limit is 1
    });

    it('combines multiple filters', () => {
      const results = buffer.query({ level: 'log', source: 'server' });
      expect(results).toHaveLength(1);
      expect(results[0].message).toBe('info message');
    });
  });

  describe('console interception', () => {
    it('install and uninstall are idempotent', () => {
      const buf = new LogBuffer(10);

      // Double install should not crash
      buf.install();
      buf.install();

      // Double uninstall should not crash
      buf.uninstall();
      buf.uninstall();
    });

    it('captures console.log when installed', () => {
      const buf = new LogBuffer(10);
      const originalLog = console.log;

      buf.install();
      console.log('captured message');
      buf.uninstall();

      expect(buf.size()).toBe(1);
      const results = buf.query();
      expect(results[0].message).toBe('captured message');
      expect(results[0].level).toBe('log');
      expect(results[0].source).toBe('server');

      // Verify console.log is restored
      expect(console.log).toBe(originalLog);
    });

    it('captures console.warn and console.error', () => {
      const buf = new LogBuffer(10);

      buf.install();
      console.warn('warning');
      console.error('error');
      buf.uninstall();

      expect(buf.size()).toBe(2);
      const results = buf.query();
      expect(results[0].level).toBe('warn');
      expect(results[1].level).toBe('error');
    });

    it('serializes non-string arguments', () => {
      const buf = new LogBuffer(10);

      buf.install();
      console.log('prefix', { key: 'value' }, 42);
      buf.uninstall();

      const results = buf.query();
      expect(results[0].message).toContain('prefix');
      expect(results[0].message).toContain('"key"');
      expect(results[0].message).toContain('42');
    });
  });
});
