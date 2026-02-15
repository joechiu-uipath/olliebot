/**
 * Token Reduction Service
 *
 * Central service that orchestrates prompt compression using
 * a configurable provider. Integrates with the tracing system
 * to record compression metrics per LLM call.
 *
 * Multi-provider architecture: new providers can be added by
 * implementing TokenReductionProvider and registering here.
 */

import type { LLMMessage, LLMContentBlock } from '../types.js';
import type {
  TokenReductionConfig,
  TokenReductionProvider,
  CompressionResult,
  TokenReductionProviderType,
  CompressionLevel,
} from './types.js';
import { LLMLingua2Provider } from './llmlingua2-provider.js';
import { CompressionCache } from './compression-cache.js';
import { getDb } from '../../db/index.js';

export class TokenReductionService {
  private provider: TokenReductionProvider | null = null;
  private config: TokenReductionConfig;
  private initialized = false;
  private cache: CompressionCache;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(config: TokenReductionConfig, cacheMaxSize = 100) {
    this.config = config;
    this.cache = new CompressionCache(cacheMaxSize);
  }

  /**
   * Initialize the service: create and init the configured provider,
   * set up the cache DB table, and load cached entries.
   */
  async init(): Promise<void> {
    if (!this.config.enabled) {
      console.log('[TokenReduction] Disabled via configuration');
      return;
    }

    this.provider = this.createProvider(this.config.provider);
    await this.provider.init();
    this.initialized = true;
    console.log(`[TokenReduction] Service initialized (provider: ${this.config.provider}, level: ${this.config.compressionLevel})`);

    // Set up cache persistence
    this.initCachePersistence();
  }

  /**
   * Whether the service is enabled and ready to compress.
   */
  isEnabled(): boolean {
    return this.config.enabled && this.initialized && this.provider !== null;
  }

  /**
   * Get the current configuration.
   */
  getConfig(): TokenReductionConfig {
    return { ...this.config };
  }

  /**
   * Compress a set of LLM messages before sending to the provider.
   * Only compresses text content in user messages (preserves assistant/system messages,
   * tool results, and image content blocks).
   *
   * Returns the compressed messages and aggregated compression stats.
   */
  async compressMessages(
    messages: LLMMessage[],
    systemPrompt?: string
  ): Promise<{
    messages: LLMMessage[];
    systemPrompt?: string;
    results: CompressionResult[];
  }> {
    if (!this.isEnabled()) {
      return { messages, systemPrompt, results: [] };
    }

    const results: CompressionResult[] = [];
    const compressedMessages: LLMMessage[] = [];

    // Compress system prompt if present
    let compressedSystemPrompt = systemPrompt;
    if (systemPrompt && systemPrompt.length >= 100) {
      const result = await this.compressText(systemPrompt);
      results.push(result);
      compressedSystemPrompt = result.compressedText;
    }

    for (const msg of messages) {
      if (msg.role === 'user') {
        // Compress user messages
        if (typeof msg.content === 'string') {
          const result = await this.compressText(msg.content);
          results.push(result);
          compressedMessages.push({
            ...msg,
            content: result.compressedText,
          });
        } else if (Array.isArray(msg.content)) {
          // Handle multimodal content blocks
          const compressedBlocks: LLMContentBlock[] = [];
          for (const block of msg.content) {
            if (block.type === 'text' && block.text && block.text.length >= 100) {
              const result = await this.compressText(block.text);
              results.push(result);
              compressedBlocks.push({ ...block, text: result.compressedText });
            } else {
              // Preserve non-text blocks (images, tool_results) as-is
              compressedBlocks.push(block);
            }
          }
          compressedMessages.push({ ...msg, content: compressedBlocks });
        } else {
          compressedMessages.push(msg);
        }
      } else {
        // Preserve assistant and system messages as-is
        compressedMessages.push(msg);
      }
    }

    return {
      messages: compressedMessages,
      systemPrompt: compressedSystemPrompt,
      results,
    };
  }

  /**
   * Get cache hit/miss stats.
   */
  getCacheStats(): { hits: number; misses: number; size: number } {
    return { hits: this.cacheHits, misses: this.cacheMisses, size: this.cache.size };
  }

  /**
   * Compress a single text string.
   * Checks the LRU cache first; on miss, compresses and caches the result.
   */
  async compressText(text: string): Promise<CompressionResult> {
    if (!this.provider) {
      throw new Error('Token reduction provider not initialized');
    }

    const level = this.config.compressionLevel;

    // Build cache key from input + level + provider
    const cacheKey = CompressionCache.buildKey(text, level, this.config.provider);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      // Return cached result with 0ms compression time (it was free)
      return { ...cached, compressionTimeMs: 0 };
    }

    this.cacheMisses++;

    const result = await this.provider.compress(text, level);

    // Store in cache
    this.cache.set(cacheKey, text, result);

    return result;
  }

  // ============================================================
  // Cache DB persistence
  // ============================================================

  /**
   * Ensure the cache table exists, wire up persistence callbacks,
   * and load any existing entries from DB.
   */
  private initCachePersistence(): void {
    try {
      const db = getDb();

      // Create table if missing
      db.rawRun(`
        CREATE TABLE IF NOT EXISTS token_reduction_cache (
          key TEXT PRIMARY KEY,
          inputTextPreview TEXT,
          resultJson TEXT NOT NULL,
          createdAt TEXT NOT NULL
        )
      `);
      db.rawRun(
        'CREATE INDEX IF NOT EXISTS idx_token_reduction_cache_created ON token_reduction_cache(createdAt ASC)'
      );

      // Wire callbacks so the in-memory LRU cache persists to DB
      this.cache.setPersistence(
        (entry) => {
          try {
            getDb().rawRun(
              `INSERT OR REPLACE INTO token_reduction_cache (key, inputTextPreview, resultJson, createdAt)
               VALUES (?, ?, ?, ?)`,
              [entry.key, entry.inputText, JSON.stringify(entry.result), entry.createdAt]
            );
          } catch { /* non-fatal */ }
        },
        (key) => {
          try {
            getDb().rawRun('DELETE FROM token_reduction_cache WHERE key = ?', [key]);
          } catch { /* non-fatal */ }
        }
      );

      // Load cached entries from DB (non-blocking)
      const rows = db.rawQuery(
        'SELECT key, inputTextPreview, resultJson, createdAt FROM token_reduction_cache ORDER BY createdAt ASC'
      ) as Array<{ key: string; inputTextPreview: string; resultJson: string; createdAt: string }>;

      if (rows.length > 0) {
        const entries = rows.map(row => ({
          key: row.key,
          inputText: row.inputTextPreview,
          result: JSON.parse(row.resultJson),
          createdAt: row.createdAt,
        }));
        this.cache.loadEntries(entries);
        console.log(`[TokenReduction] Cache: loaded ${entries.length} entries from DB`);
      }
    } catch (err) {
      console.warn('[TokenReduction] Failed to init cache persistence (non-fatal):', err);
    }
  }

  /**
   * Factory: create a provider instance by type.
   * Add new providers here as they are implemented.
   */
  private createProvider(type: TokenReductionProviderType): TokenReductionProvider {
    switch (type) {
      case 'llmlingua2':
        return new LLMLingua2Provider();
      default:
        throw new Error(`Unknown token reduction provider: ${type}`);
    }
  }
}
