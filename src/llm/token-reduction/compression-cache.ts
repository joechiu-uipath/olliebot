/**
 * Token Reduction Compression Cache
 *
 * Fixed-size in-memory LRU cache that maps input text to compressed output.
 * Avoids redundant compression for repeated prompts (system prompts, common
 * preambles, etc.).
 *
 * Cache entries are keyed by a hash of (input text + compression rate + provider)
 * so that different settings produce different cache entries.
 *
 * The cache is persisted to SQLite and loaded on startup asynchronously
 * (non-blocking) so the service is available immediately.
 */

import { createHash } from 'crypto';
import type { CompressionResult, TokenReductionProviderType, CompressionLevel } from './types.js';

export interface CacheEntry {
  key: string;
  inputText: string;
  result: CompressionResult;
  createdAt: string;
}

/**
 * Simple LRU cache backed by a Map (which preserves insertion order).
 * Eviction: when capacity is exceeded, the oldest (least-recently-used) entry
 * is removed.
 */
export class CompressionCache {
  private cache: Map<string, CacheEntry>;
  private readonly maxSize: number;
  private dbPersist: ((entry: CacheEntry) => void) | null = null;
  private dbRemove: ((key: string) => void) | null = null;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.cache = new Map();
  }

  /**
   * Build a deterministic cache key from input parameters.
   * Uses SHA-256 of (provider + level + text) to keep keys short.
   */
  static buildKey(text: string, level: CompressionLevel, provider: TokenReductionProviderType): string {
    const hash = createHash('sha256');
    hash.update(`${provider}:${level}:${text}`);
    return hash.digest('hex');
  }

  /**
   * Look up a cached compression result.
   * On hit, moves the entry to the most-recently-used position.
   */
  get(key: string): CompressionResult | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Move to end (most recently used) by deleting and re-inserting
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.result;
  }

  /**
   * Store a compression result in the cache.
   * Evicts the least-recently-used entry if at capacity.
   */
  set(key: string, inputText: string, result: CompressionResult): void {
    // If key already exists, delete to refresh insertion order
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict LRU entry if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value as string;
      this.cache.delete(oldestKey);
      if (this.dbRemove) {
        try {
          this.dbRemove(oldestKey);
        } catch (err) {
          console.warn('[CompressionCache] DB remove failed (non-fatal):', err);
        }
      }
    }

    const entry: CacheEntry = {
      key,
      inputText: inputText.substring(0, 200), // Store truncated for debugging
      result,
      createdAt: new Date().toISOString(),
    };

    this.cache.set(key, entry);

    // Persist to DB asynchronously
    if (this.dbPersist) {
      try {
        this.dbPersist(entry);
      } catch (err) {
        console.warn('[CompressionCache] DB persist failed (non-fatal):', err);
      }
    }
  }

  /**
   * Register DB persistence callbacks (called after TraceStore is ready).
   */
  setPersistence(
    persist: (entry: CacheEntry) => void,
    remove: (key: string) => void
  ): void {
    this.dbPersist = persist;
    this.dbRemove = remove;
  }

  /**
   * Bulk-load entries (from DB on startup). Does not trigger DB writes.
   * Entries are loaded in the order provided; later entries are more recent.
   */
  loadEntries(entries: CacheEntry[]): void {
    for (const entry of entries) {
      // If over capacity, skip oldest entries
      if (this.cache.size >= this.maxSize && !this.cache.has(entry.key)) {
        // Evict oldest to make room
        const oldestKey = this.cache.keys().next().value as string;
        this.cache.delete(oldestKey);
      }
      this.cache.set(entry.key, entry);
    }
  }

  /** Current number of cached entries */
  get size(): number {
    return this.cache.size;
  }

  /** Clear the entire cache (in-memory only) */
  clear(): void {
    this.cache.clear();
  }
}
