/**
 * Circular Log Buffer with Console Interception
 *
 * Captures console.log/warn/error output into a fixed-size circular buffer.
 * The original console methods still work — output appears in the terminal as usual.
 * MCP tools query this buffer to expose server logs to external clients.
 */

export interface LogEntry {
  timestamp: string;
  level: 'log' | 'warn' | 'error';
  message: string;
  source: 'server' | 'web';
}

export interface LogQueryOptions {
  level?: 'log' | 'warn' | 'error';
  grep?: string;
  limit?: number;
  since?: string;
  source?: 'server' | 'web';
}

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_QUERY_LIMIT = 50;
const MAX_QUERY_LIMIT = 500;

export class LogBuffer {
  private buffer: (LogEntry | null)[];
  private head = 0;
  private count = 0;
  private maxSize: number;
  private installed = false;

  private originalLog: typeof console.log;
  private originalWarn: typeof console.warn;
  private originalError: typeof console.error;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.buffer = new Array(maxSize).fill(null);
    this.originalLog = console.log;
    this.originalWarn = console.warn;
    this.originalError = console.error;
  }

  /**
   * Install console interception.
   * After this call, all console.log/warn/error output is captured.
   * Original output still goes to the terminal.
   */
  install(): void {
    if (this.installed) return;

    console.log = (...args: unknown[]) => {
      this.push('log', args);
      this.originalLog.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      this.push('warn', args);
      this.originalWarn.apply(console, args);
    };

    console.error = (...args: unknown[]) => {
      this.push('error', args);
      this.originalError.apply(console, args);
    };

    this.installed = true;
  }

  /**
   * Uninstall console interception and restore original methods.
   */
  uninstall(): void {
    if (!this.installed) return;

    console.log = this.originalLog;
    console.warn = this.originalWarn;
    console.error = this.originalError;
    this.installed = false;
  }

  /**
   * Push a log entry from an external source (e.g., web_log via WebSocket).
   */
  pushExternal(entry: LogEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }

  /**
   * Query the buffer with optional filters.
   */
  query(options: LogQueryOptions = {}): LogEntry[] {
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);
    const sinceTime = options.since ? new Date(options.since).getTime() : 0;
    const grepLower = options.grep?.toLowerCase();

    // Iterate from oldest to newest
    const results: LogEntry[] = [];
    const start = this.count < this.maxSize ? 0 : this.head;

    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.maxSize;
      const entry = this.buffer[idx];
      if (!entry) continue;

      // Apply filters
      if (options.level && entry.level !== options.level) continue;
      if (options.source && entry.source !== options.source) continue;
      if (sinceTime && new Date(entry.timestamp).getTime() <= sinceTime) continue;
      if (grepLower && !entry.message.toLowerCase().includes(grepLower)) continue;

      results.push(entry);
    }

    // Return the last `limit` entries (most recent)
    return results.slice(-limit);
  }

  /**
   * Get total entry count in the buffer.
   */
  size(): number {
    return this.count;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.buffer = new Array(this.maxSize).fill(null);
    this.head = 0;
    this.count = 0;
  }

  private push(level: LogEntry['level'], args: unknown[]): void {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(' ');

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      source: 'server',
    };

    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.maxSize;
    if (this.count < this.maxSize) this.count++;
  }
}
