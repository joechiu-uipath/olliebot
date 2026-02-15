/**
 * LanceDB Vector Store Wrapper
 * Handles per-project vector storage using LanceDB.
 *
 * Supports multiple named tables for multi-strategy indexing.
 * Each retrieval strategy stores its vectors in a separate table
 * (e.g., 'vectors_direct', 'vectors_keyword') within the same database.
 */

import { connect, type Connection, type Table } from '@lancedb/lancedb';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { VectorRecord, SearchResult, EmbeddingProvider } from './types.js';
import { RAG_DEFAULT_TOP_K } from '../constants.js';

const DEFAULT_TABLE_NAME = 'vectors';

/**
 * Get the table name for a strategy. Legacy (no strategy) uses 'vectors'.
 */
function strategyTableName(strategyId?: string): string {
  if (!strategyId) return DEFAULT_TABLE_NAME;
  return `vectors_${strategyId}`;
}

/**
 * Convert LanceDB row to SearchResult.
 */
function rowToSearchResult(row: Record<string, unknown>): SearchResult {
  const distance = row._distance as number;
  const score = Math.max(0, 1 - distance / 2);

  return {
    id: row.id as string,
    documentPath: row.documentPath as string,
    text: row.text as string,
    score,
    chunkIndex: row.chunkIndex as number,
    contentType: row.contentType as 'text' | 'image',
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}

/**
 * LanceDB store for a single RAG project.
 * Each project has its own LanceDB database in .olliebot/index.lance/
 *
 * Supports multiple named tables for multi-strategy RAG:
 * - 'vectors' (legacy default)
 * - 'vectors_direct', 'vectors_keyword', 'vectors_summary', etc.
 */
export class LanceStore {
  private dbPath: string;
  private connection: Connection | null = null;
  /** Legacy single-table reference for backward compatibility */
  private table: Table | null = null;
  /** Named table cache for multi-strategy access */
  private tables: Map<string, Table> = new Map();
  private dimensions: number;
  private embeddingProvider: EmbeddingProvider;

  constructor(dbPath: string, embeddingProvider: EmbeddingProvider) {
    this.dbPath = dbPath;
    this.embeddingProvider = embeddingProvider;
    this.dimensions = embeddingProvider.getDimensions();
  }

  /**
   * Initialize the LanceDB connection and load existing tables.
   */
  async init(): Promise<void> {
    // Ensure the directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Connect to LanceDB
    this.connection = await connect(this.dbPath);

    // Load all existing vector tables
    const tableNames = await this.connection.tableNames();

    for (const name of tableNames) {
      if (name === DEFAULT_TABLE_NAME || name.startsWith('vectors_')) {
        const table = await this.connection.openTable(name);
        this.tables.set(name, table);
      }
    }

    // Set legacy table reference
    this.table = this.tables.get(DEFAULT_TABLE_NAME) ?? null;
  }

  // ─── Multi-Strategy Table Operations ─────────────────────────────

  /**
   * Add vectors to a named strategy table.
   * Creates the table if it doesn't exist yet.
   */
  async addVectorsToTable(records: VectorRecord[], strategyId: string): Promise<void> {
    if (records.length === 0) return;

    if (!this.connection) {
      throw new Error('LanceStore not initialized. Call init() first.');
    }

    const tableName = strategyTableName(strategyId);

    // Transform records to LanceDB format
    const data = records.map((record) => ({
      id: record.id,
      documentPath: record.documentPath,
      text: record.text,
      vector: record.vector,
      chunkIndex: record.chunkIndex,
      contentType: record.contentType,
      metadata: record.metadata ? JSON.stringify(record.metadata) : null,
    }));

    const existingTable = this.tables.get(tableName);
    if (existingTable) {
      await existingTable.add(data);
    } else {
      const newTable = await this.connection.createTable(tableName, data);
      this.tables.set(tableName, newTable);
    }
  }

  /**
   * Search a specific strategy table by pre-computed vector.
   * Use this for multi-strategy queries where each strategy
   * transforms the query text differently before embedding.
   */
  async searchByVector(
    queryVector: number[],
    strategyId: string,
    topK: number = RAG_DEFAULT_TOP_K,
    minScore: number = 0,
    contentType?: 'text' | 'image' | 'all'
  ): Promise<SearchResult[]> {
    const tableName = strategyTableName(strategyId);
    const table = this.tables.get(tableName);

    if (!table) {
      return [];
    }

    let query = table.search(queryVector).limit(topK);

    if (contentType && contentType !== 'all') {
      query = query.where(`contentType = '${contentType}'`);
    }

    const results = await query.toArray();

    return results
      .map((row: Record<string, unknown>) => rowToSearchResult(row))
      .filter((result: SearchResult) => result.score >= minScore);
  }

  /**
   * Delete all vectors for a document from a specific strategy table.
   */
  async deleteByDocumentFromTable(documentPath: string, strategyId: string): Promise<number> {
    const tableName = strategyTableName(strategyId);
    const table = this.tables.get(tableName);

    if (!table) {
      return 0;
    }

    const beforeCount = await table.countRows();
    await table.delete(`documentPath = '${documentPath.replace(/'/g, "''")}'`);
    const afterCount = await table.countRows();

    return beforeCount - afterCount;
  }

  /**
   * Clear a specific strategy table.
   */
  async clearTable(strategyId: string): Promise<void> {
    if (!this.connection) return;

    const tableName = strategyTableName(strategyId);
    const tableNames = await this.connection.tableNames();

    if (tableNames.includes(tableName)) {
      await this.connection.dropTable(tableName);
      this.tables.delete(tableName);
    }
  }

  /**
   * Clear all strategy tables (for full re-index).
   */
  async clearAllTables(): Promise<void> {
    if (!this.connection) return;

    const tableNames = await this.connection.tableNames();
    for (const name of tableNames) {
      if (name === DEFAULT_TABLE_NAME || name.startsWith('vectors_')) {
        await this.connection.dropTable(name);
        this.tables.delete(name);
      }
    }
    this.table = null;
  }

  /**
   * Get vector count for a specific strategy table.
   */
  async getVectorCountForTable(strategyId: string): Promise<number> {
    const tableName = strategyTableName(strategyId);
    const table = this.tables.get(tableName);
    if (!table) return 0;
    return table.countRows();
  }

  /**
   * Get total vector count across all strategy tables.
   */
  async getTotalVectorCount(): Promise<number> {
    let total = 0;
    for (const table of this.tables.values()) {
      total += await table.countRows();
    }
    return total;
  }

  /**
   * Get the list of strategy table names currently in the store.
   */
  getStrategyTableNames(): string[] {
    return Array.from(this.tables.keys())
      .filter((name) => name.startsWith('vectors_'))
      .map((name) => name.replace('vectors_', ''));
  }

  // ─── Legacy Single-Table Operations (backward compat) ───────────

  /**
   * Add vectors to the default table.
   */
  async addVectors(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) return;

    if (!this.connection) {
      throw new Error('LanceStore not initialized. Call init() first.');
    }

    // Transform records to LanceDB format
    const data = records.map((record) => ({
      id: record.id,
      documentPath: record.documentPath,
      text: record.text,
      vector: record.vector,
      chunkIndex: record.chunkIndex,
      contentType: record.contentType,
      metadata: record.metadata ? JSON.stringify(record.metadata) : null,
    }));

    if (!this.table) {
      // Create table with first batch of data
      this.table = await this.connection.createTable(DEFAULT_TABLE_NAME, data);
      this.tables.set(DEFAULT_TABLE_NAME, this.table);
    } else {
      // Add to existing table
      await this.table.add(data);
    }
  }

  /**
   * Search the default table by text (embeds internally).
   */
  async search(
    queryText: string,
    topK: number = RAG_DEFAULT_TOP_K,
    minScore: number = 0,
    contentType?: 'text' | 'image' | 'all'
  ): Promise<SearchResult[]> {
    if (!this.table) {
      return [];
    }

    // Generate query embedding
    const queryVector = await this.embeddingProvider.embed(queryText);

    // Build the search query
    let query = this.table.search(queryVector).limit(topK);

    // Apply content type filter if specified
    if (contentType && contentType !== 'all') {
      query = query.where(`contentType = '${contentType}'`);
    }

    // Execute search
    const results = await query.toArray();

    // Transform results
    return results
      .map((row: Record<string, unknown>) => rowToSearchResult(row))
      .filter((result: SearchResult) => result.score >= minScore);
  }

  /**
   * Delete all vectors for a specific document from the default table.
   */
  async deleteByDocument(documentPath: string): Promise<number> {
    if (!this.table) {
      return 0;
    }

    // Count before deletion
    const beforeCount = await this.getVectorCount();

    // Delete matching rows
    await this.table.delete(`documentPath = '${documentPath.replace(/'/g, "''")}'`);

    // Count after deletion
    const afterCount = await this.getVectorCount();

    return beforeCount - afterCount;
  }

  /**
   * Delete all vectors in the default table.
   */
  async clear(): Promise<void> {
    if (!this.connection) return;

    const tableNames = await this.connection.tableNames();
    if (tableNames.includes(DEFAULT_TABLE_NAME)) {
      await this.connection.dropTable(DEFAULT_TABLE_NAME);
      this.table = null;
      this.tables.delete(DEFAULT_TABLE_NAME);
    }
  }

  /**
   * Get the total number of vectors in the default table.
   */
  async getVectorCount(): Promise<number> {
    if (!this.table) {
      return 0;
    }

    const count = await this.table.countRows();
    return count;
  }

  /**
   * Get statistics about the default table.
   */
  async getStats(): Promise<{
    vectorCount: number;
    documentCount: number;
  }> {
    if (!this.table) {
      return { vectorCount: 0, documentCount: 0 };
    }

    const vectorCount = await this.table.countRows();

    // Get unique document count
    const allRows = await this.table.query().select(['documentPath']).toArray();
    const uniqueDocs = new Set(allRows.map((row: Record<string, unknown>) => row.documentPath as string));

    return {
      vectorCount,
      documentCount: uniqueDocs.size,
    };
  }

  /**
   * Close the database connection.
   */
  async close(): Promise<void> {
    this.connection = null;
    this.table = null;
    this.tables.clear();
  }
}

/**
 * Create a LanceStore for a project.
 */
export async function createLanceStore(
  projectPath: string,
  embeddingProvider: EmbeddingProvider
): Promise<LanceStore> {
  const dbPath = join(projectPath, '.olliebot', 'index.lance');
  const store = new LanceStore(dbPath, embeddingProvider);
  await store.init();
  return store;
}
