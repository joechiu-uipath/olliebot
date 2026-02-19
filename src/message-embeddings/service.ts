/**
 * Message Embedding Service
 *
 * Background service that incrementally indexes chat messages
 * into a LanceDB vector store for semantic search.
 *
 * Reuses the existing RAG infrastructure:
 * - LanceStore for vector storage (multi-strategy tables)
 * - RetrievalStrategy for text transformation before embedding
 * - fuseResults() for combining multi-strategy results
 * - EmbeddingProvider for generating embeddings
 *
 * Lifecycle: init() → startIndexer() → ... → close()
 */

import { EventEmitter } from 'events';
import { LanceStore } from '../rag-projects/lance-store.js';
import { getDb } from '../db/index.js';
import type { EmbeddingProvider, VectorRecord, SearchResult } from '../rag-projects/types.js';
import {
  createStrategiesFromConfig,
  type RetrievalStrategy,
} from '../rag-projects/strategies/index.js';
import { fuseResults, type StrategySearchResult } from '../rag-projects/fusion.js';
import { chunkMessage, type MessageForChunking } from './message-chunker.js';
import { createSnippet } from './utils.js';
import {
  MESSAGE_SEARCH_DEFAULT_TOP_K,
  MESSAGE_SEARCH_SNIPPET_LENGTH,
  MESSAGE_SEARCH_OVERFETCH_MULTIPLIER,
} from '../constants.js';
import type {
  MessageEmbeddingConfig,
  MessageEmbeddingState,
  MessageSearchResult,
  MessageSearchResultSource,
  MessageEmbeddingStats,
  IndexingCompleteEvent,
  SemanticStrategyType,
} from './types.js';

const LOG_PREFIX = '[MessageEmbeddings]';

// ─── SQLite Row Types ────────────────────────────────────────

interface MessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

interface StateRow {
  lastIndexedAt: string;
  lastIndexedId: string;
  totalIndexed: number;
}

interface ConversationTitleRow {
  id: string;
  title: string;
}

/**
 * MessageEmbeddingService
 *
 * Indexes chat messages into LanceDB for semantic search.
 * Runs a background interval that picks up new messages
 * since the last watermark and embeds them.
 */
export class MessageEmbeddingService extends EventEmitter {
  private config: MessageEmbeddingConfig;
  private embeddingProvider: EmbeddingProvider;
  private store: LanceStore | null = null;
  private strategies: RetrievalStrategy[] = [];
  private state: MessageEmbeddingState = {
    lastIndexedAt: '1970-01-01T00:00:00.000Z',
    lastIndexedId: '',
    totalIndexed: 0,
  };
  private indexerTimer: NodeJS.Timeout | null = null;
  private indexingInProgress = false;

  constructor(config: MessageEmbeddingConfig, embeddingProvider: EmbeddingProvider) {
    super();
    this.config = config;
    this.embeddingProvider = embeddingProvider;
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  /**
   * Initialize the service: create watermark table, LanceStore, strategies.
   */
  async init(): Promise<void> {
    const db = getDb();

    // Create watermark table (single-row, enforced by CHECK constraint)
    db.rawExec(`
      CREATE TABLE IF NOT EXISTS message_embedding_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lastIndexedAt TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
        lastIndexedId TEXT NOT NULL DEFAULT '',
        totalIndexed INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Load existing state or insert initial row
    const rows = db.rawQuery(
      'SELECT lastIndexedAt, lastIndexedId, totalIndexed FROM message_embedding_state WHERE id = 1'
    ) as StateRow[];

    if (rows.length > 0) {
      this.state = rows[0];
    } else {
      db.rawRun(
        'INSERT INTO message_embedding_state (id, lastIndexedAt, lastIndexedId, totalIndexed) VALUES (1, ?, ?, ?)',
        [this.state.lastIndexedAt, this.state.lastIndexedId, this.state.totalIndexed]
      );
    }

    // Initialize LanceStore
    this.store = new LanceStore(this.config.dbPath, this.embeddingProvider);
    await this.store.init();

    // Create strategy instances
    this.strategies = createStrategiesFromConfig(this.config.strategies);

    if (this.strategies.length === 0) {
      console.warn(`${LOG_PREFIX} No strategies enabled — indexing will be skipped`);
    }

    console.log(
      `${LOG_PREFIX} Initialized (strategies: ${this.strategies.map((s) => s.id).join(', ')}, ` +
        `watermark: ${this.state.lastIndexedAt}, totalIndexed: ${this.state.totalIndexed})`
    );
  }

  /**
   * Start the background indexer. Runs an immediate pass, then on interval.
   */
  startIndexer(): void {
    if (this.indexerTimer) return;

    // Run immediately (async, errors are logged)
    this.runIndexerSafe();

    // Schedule recurring runs
    this.indexerTimer = setInterval(() => {
      this.runIndexerSafe();
    }, this.config.indexInterval);

    console.log(`${LOG_PREFIX} Background indexer started (interval: ${this.config.indexInterval}ms)`);
  }

  /**
   * Stop the indexer and release resources.
   */
  async close(): Promise<void> {
    if (this.indexerTimer) {
      clearInterval(this.indexerTimer);
      this.indexerTimer = null;
    }

    if (this.store) {
      await this.store.close();
      this.store = null;
    }

    console.log(`${LOG_PREFIX} Closed`);
  }

  // ─── Background Indexing ───────────────────────────────────

  /**
   * Run indexNewMessages with error handling (for use in setInterval).
   */
  private runIndexerSafe(): void {
    this.indexNewMessages().catch((err) => {
      console.error(`${LOG_PREFIX} Indexing error:`, err);
    });
  }

  /**
   * Index new messages since the watermark.
   * Processes up to maxMessagesPerRun messages per invocation.
   */
  private async indexNewMessages(): Promise<void> {
    if (this.indexingInProgress) return;
    if (!this.store || this.strategies.length === 0) return;

    this.indexingInProgress = true;
    const startTime = Date.now();

    try {
      const db = getDb();
      const { indexableRoles, minContentLength, maxMessagesPerRun, embeddingBatchSize } = this.config;

      // Build role placeholders for SQL
      const rolePlaceholders = indexableRoles.map(() => '?').join(',');

      // Fetch unindexed messages using the watermark as cursor
      const messages = db.rawQuery(
        `SELECT m.id, m.conversationId, m.role, m.content, m.createdAt
         FROM messages m
         JOIN conversations c ON c.id = m.conversationId
         WHERE (m.createdAt > ? OR (m.createdAt = ? AND m.id > ?))
           AND m.role IN (${rolePlaceholders})
           AND LENGTH(m.content) >= ?
           AND c.deletedAt IS NULL
         ORDER BY m.createdAt ASC, m.id ASC
         LIMIT ?`,
        [
          this.state.lastIndexedAt,
          this.state.lastIndexedAt,
          this.state.lastIndexedId,
          ...indexableRoles,
          minContentLength,
          maxMessagesPerRun,
        ]
      ) as MessageRow[];

      if (messages.length === 0) return;

      // Chunk all messages
      const allChunks = messages.flatMap((msg) => chunkMessage(msg));

      if (allChunks.length === 0) return;

      // Process each strategy
      for (const strategy of this.strategies) {
        // Prepare chunk texts for this strategy
        const preparedTexts: string[] = [];
        for (const chunk of allChunks) {
          const text = await strategy.prepareChunkText(chunk);
          preparedTexts.push(text);
        }

        // Embed in batches
        const allVectors: number[][] = [];
        for (let i = 0; i < preparedTexts.length; i += embeddingBatchSize) {
          const batch = preparedTexts.slice(i, i + embeddingBatchSize);
          const vectors = this.embeddingProvider.embedBatch
            ? await this.embeddingProvider.embedBatch(batch)
            : await Promise.all(batch.map((t) => this.embeddingProvider.embed(t)));
          allVectors.push(...vectors);
        }

        // Build VectorRecords and store
        const records: VectorRecord[] = allChunks.map((chunk, idx) => ({
          id: `msg:${chunk.metadata!.messageId}:${chunk.chunkIndex}`,
          documentPath: chunk.documentPath,
          text: chunk.text,
          vector: allVectors[idx],
          chunkIndex: chunk.chunkIndex,
          contentType: chunk.contentType,
          metadata: chunk.metadata,
        }));

        await this.store.addVectorsToTable(records, strategy.id);
      }

      // Update watermark to the last message in this batch
      const lastMsg = messages[messages.length - 1];
      this.state = {
        lastIndexedAt: lastMsg.createdAt,
        lastIndexedId: lastMsg.id,
        totalIndexed: this.state.totalIndexed + messages.length,
      };

      db.rawRun(
        `INSERT INTO message_embedding_state (id, lastIndexedAt, lastIndexedId, totalIndexed)
         VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           lastIndexedAt = excluded.lastIndexedAt,
           lastIndexedId = excluded.lastIndexedId,
           totalIndexed = excluded.totalIndexed`,
        [this.state.lastIndexedAt, this.state.lastIndexedId, this.state.totalIndexed]
      );

      const event: IndexingCompleteEvent = {
        messagesIndexed: messages.length,
        chunksCreated: allChunks.length,
        durationMs: Date.now() - startTime,
        hasMore: messages.length >= maxMessagesPerRun,
      };

      this.emit('indexing:complete', event);

      console.log(
        `${LOG_PREFIX} Indexed ${messages.length} messages (${allChunks.length} chunks) in ${event.durationMs}ms` +
          (event.hasMore ? ' (more pending)' : '')
      );
    } finally {
      this.indexingInProgress = false;
    }
  }

  // ─── Search ────────────────────────────────────────────────

  /**
   * Search messages using semantic embedding search.
   * Returns results with provenance (strategy info) attached.
   */
  async search(
    query: string,
    topK: number = MESSAGE_SEARCH_DEFAULT_TOP_K,
    minScore: number = 0
  ): Promise<MessageSearchResult[]> {
    if (!this.store || this.strategies.length === 0) return [];

    const strategyResults: StrategySearchResult[] = [];

    // Search each strategy
    for (const strategy of this.strategies) {
      const preparedQuery = await strategy.prepareQueryText(query);
      const queryVector = await this.embeddingProvider.embed(preparedQuery);
      // Request extra results to allow for deduplication and filtering
      const results = await this.store.searchByVector(
        queryVector,
        strategy.id,
        topK * MESSAGE_SEARCH_OVERFETCH_MULTIPLIER,
        minScore
      );
      strategyResults.push({ strategyId: strategy.id, results });
    }

    // Fuse if multiple strategies, otherwise pass through
    const fused = fuseResults(
      strategyResults,
      this.config.strategies,
      this.config.fusionMethod,
      topK * MESSAGE_SEARCH_OVERFETCH_MULTIPLIER // Over-fetch before dedup
    );

    // Deduplicate by messageId (multiple chunks from same message → keep best)
    const seenMessages = new Map<string, {
      result: typeof fused[0];
      sources: MessageSearchResultSource[];
    }>();

    for (const result of fused) {
      const messageId = (result.metadata as Record<string, unknown>)?.messageId as string;
      if (!messageId) continue;

      // Build sources from strategyScores
      const sources: MessageSearchResultSource[] = result.strategyScores.map((ss) => ({
        source: 'semantic' as const,
        strategy: ss.strategyId as SemanticStrategyType,
        score: ss.score,
      }));

      const existing = seenMessages.get(messageId);
      if (existing) {
        // Merge sources from this chunk into the existing entry
        for (const src of sources) {
          const alreadyHas = existing.sources.some(
            (s) => s.source === src.source && s.strategy === src.strategy
          );
          if (!alreadyHas) {
            existing.sources.push(src);
          }
        }
        // Keep the higher-scoring result
        if (result.fusedScore > existing.result.fusedScore) {
          existing.result = result;
        }
      } else {
        seenMessages.set(messageId, { result, sources });
      }
    }

    // Take topK after dedup
    const deduped = Array.from(seenMessages.values())
      .sort((a, b) => b.result.fusedScore - a.result.fusedScore)
      .slice(0, topK);

    // Enrich with conversation titles
    const db = getDb();
    const conversationIds = [...new Set(deduped.map((d) =>
      (d.result.metadata as Record<string, unknown>)?.conversationId as string
    ))];

    const titleMap = new Map<string, string>();
    if (conversationIds.length > 0) {
      const placeholders = conversationIds.map(() => '?').join(',');
      const titleRows = db.rawQuery(
        `SELECT id, title FROM conversations WHERE id IN (${placeholders}) AND deletedAt IS NULL`,
        conversationIds
      ) as ConversationTitleRow[];

      for (const row of titleRows) {
        titleMap.set(row.id, row.title);
      }
    }

    // Build final results, filtering out deleted conversations
    const results: MessageSearchResult[] = [];
    for (const { result, sources } of deduped) {
      const meta = result.metadata as Record<string, unknown>;
      const conversationId = meta?.conversationId as string;
      const title = titleMap.get(conversationId);

      // Skip if conversation was deleted (not in titleMap)
      if (!title) continue;

      results.push({
        messageId: meta?.messageId as string,
        conversationId,
        conversationTitle: title,
        role: (meta?.role as string) || 'unknown',
        text: result.text,
        snippet: createSnippet(result.text, MESSAGE_SEARCH_SNIPPET_LENGTH),
        createdAt: (meta?.createdAt as string) || '',
        score: result.fusedScore,
        sources,
      });
    }

    return results;
  }

  // ─── Maintenance ───────────────────────────────────────────

  /**
   * Delete all vectors for a conversation (called when conversation is deleted).
   */
  async deleteByConversationId(conversationId: string): Promise<void> {
    if (!this.store) return;

    for (const strategy of this.strategies) {
      await this.store.deleteByDocumentFromTable(conversationId, strategy.id);
    }
  }

  /**
   * Clear all vectors and re-index from scratch.
   */
  async reindexAll(): Promise<void> {
    if (!this.store) return;

    await this.store.clearAllTables();

    // Reset watermark
    this.state = {
      lastIndexedAt: '1970-01-01T00:00:00.000Z',
      lastIndexedId: '',
      totalIndexed: 0,
    };

    const db = getDb();
    db.rawRun(
      `UPDATE message_embedding_state SET lastIndexedAt = ?, lastIndexedId = ?, totalIndexed = ? WHERE id = 1`,
      [this.state.lastIndexedAt, this.state.lastIndexedId, this.state.totalIndexed]
    );

    console.log(`${LOG_PREFIX} Cleared all vectors and reset watermark — next run will re-index`);

    // Trigger an immediate indexing pass
    this.runIndexerSafe();
  }

  /**
   * Get indexing statistics.
   */
  async getStats(): Promise<MessageEmbeddingStats> {
    const vectorCounts: Record<string, number> = {};
    let totalVectors = 0;

    if (this.store) {
      for (const strategy of this.strategies) {
        const count = await this.store.getVectorCountForTable(strategy.id);
        vectorCounts[strategy.id] = count;
        totalVectors += count;
      }
    }

    return {
      state: { ...this.state },
      vectorCounts,
      totalVectors,
    };
  }
}
