/**
 * Type-safe Database Layer with better-sqlite3
 *
 * Provides SQL query capabilities with SQLite file-based persistence.
 * Data is stored in a SQLite database file that can be inspected with
 * tools like DB Browser for SQLite, SQLiteStudio, or the sqlite3 CLI.
 *
 * Features over the previous AlaSQL implementation:
 * - File-based storage (not loading entire DB into memory)
 * - FTS5 full-text search on message content
 * - Proper indexes for query performance
 * - WAL mode for concurrent reads
 * - Immediate persistence (no debounced saves)
 * - JSON1 extension for native JSON querying
 */

import BetterSqlite3 from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import {
  DEFAULT_CONVERSATIONS_LIMIT,
  DEFAULT_MESSAGES_LIMIT,
  MAX_QUERY_LIMIT,
} from '../constants.js';

// ============================================================================
// Types
// ============================================================================

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  manuallyNamed?: boolean;
  metadata?: Record<string, unknown>;  // extensible JSON metadata (channel, missionId, etc.)
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  turnId?: string; // ID of the originating message (user message or task_run) for this turn
}

export interface Embedding {
  id: string;
  source: string;
  chunkIndex: number;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ============================================================================
// Pagination Types
// ============================================================================

export interface PaginationCursor {
  createdAt: string;
  id: string;
}

export interface PaginationMeta {
  hasOlder: boolean;
  hasNewer: boolean;
  oldestCursor: string | null;
  newestCursor: string | null;
  totalCount?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface MessageQueryOptions {
  limit?: number;        // Default 20, max 100
  before?: string;       // Cursor (encoded) - get older messages
  after?: string;        // Cursor (encoded) - get newer messages
  includeTotal?: boolean;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface ConversationRepository {
  findById(id: string): Conversation | undefined;
  findAll(options?: { limit?: number; includeDeleted?: boolean }): Conversation[];
  findRecent(withinMs: number): Conversation | undefined;
  create(conversation: Conversation): void;
  update(id: string, updates: Partial<Omit<Conversation, 'id'>>): void;
  softDelete(id: string): void;
}

export interface MessageRepository {
  findById(id: string): Message | undefined;
  findByConversationId(conversationId: string, options?: { limit?: number }): Message[];
  findByConversationIdPaginated(conversationId: string, options?: MessageQueryOptions): PaginatedResult<Message>;
  countByConversationId(conversationId: string): number;
  create(message: Message): void;
  deleteByConversationId(conversationId: string): number;
}

export interface EmbeddingRepository {
  findBySource(source: string): Embedding[];
  findAll(): Embedding[];
  create(embedding: Embedding): void;
  deleteBySource(source: string): void;
}

// ============================================================================
// Raw row types (as stored in SQLite — JSON fields are TEXT)
// ============================================================================

interface ConversationRow {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  manuallyNamed: number | null; // SQLite stores booleans as 0/1
  metadata: string | null;      // JSON TEXT
}

interface MessageRow {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  metadata: string; // JSON text
  createdAt: string;
  turnId: string | null;
}

interface EmbeddingRow {
  id: string;
  source: string;
  chunkIndex: number;
  content: string;
  embedding: string; // JSON text
  metadata: string;  // JSON text
  createdAt: string;
}

// ============================================================================
// Database Implementation
// ============================================================================

const SCHEMA_VERSION = 1;

class Database {
  private sqlite: BetterSqlite3.Database;
  private dbPath: string;

  conversations: ConversationRepository;
  messages: MessageRepository;
  embeddings: EmbeddingRepository;

  constructor(dbPath: string) {
    // Handle special SQLite paths (in-memory, temp)
    const isSpecialPath = dbPath === ':memory:' || dbPath === '';

    if (isSpecialPath) {
      this.dbPath = dbPath;
    } else {
      // Normalize path to .db extension
      this.dbPath = dbPath.replace(/\.[^.]+$/, '') + '.db';

      // Ensure directory exists
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    // Open SQLite database
    this.sqlite = new BetterSqlite3(this.dbPath);

    // Initialize repositories
    this.conversations = this.createConversationRepository();
    this.messages = this.createMessageRepository();
    this.embeddings = this.createEmbeddingRepository();
  }

  async init(): Promise<void> {
    // Enable WAL mode for better concurrent read performance
    this.sqlite.pragma('journal_mode = WAL');
    // Enable foreign keys
    this.sqlite.pragma('foreign_keys = ON');

    // Create tables
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        deletedAt TEXT,
        manuallyNamed INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    // Migration: add metadata column if missing (existing DBs)
    try {
      this.sqlite.exec(`ALTER TABLE conversations ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}'`);
    } catch {
      // Column already exists — expected on subsequent runs
    }

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversationId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        turnId TEXT
      )
    `);

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        chunkIndex INTEGER NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        embedding TEXT NOT NULL DEFAULT '[]',
        metadata TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL
      )
    `);

    // Create indexes for frequent query patterns
    this.sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_conversations_updatedAt
        ON conversations(updatedAt DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_not_deleted
        ON conversations(updatedAt DESC) WHERE deletedAt IS NULL;
      CREATE INDEX IF NOT EXISTS idx_conversations_channel
        ON conversations(updatedAt DESC) WHERE deletedAt IS NULL AND (metadata IS NULL OR json_extract(metadata, '$.channel') IS NULL OR json_extract(metadata, '$.channel') = 'chat');

      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversationId, createdAt, id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_desc
        ON messages(conversationId, createdAt DESC, id DESC);

      CREATE INDEX IF NOT EXISTS idx_embeddings_source
        ON embeddings(source, chunkIndex);
    `);

    // FTS5 virtual table for full-text search on message content
    this.sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content=messages,
        content_rowid=rowid,
        tokenize='porter unicode61'
      )
    `);

    // Triggers to keep FTS index in sync
    this.sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);

    // Set schema version
    this.sqlite.pragma(`user_version = ${SCHEMA_VERSION}`);

    // Auto-migrate from old AlaSQL JSON file if it exists and DB is empty
    this.autoMigrateFromJson();

    console.log(`[Database] Initialized SQLite at ${this.dbPath}`);
  }

  /**
   * If the old AlaSQL JSON file exists alongside the new SQLite DB,
   * and the SQLite DB has no conversations, auto-import the JSON data.
   */
  private autoMigrateFromJson(): void {
    const jsonPath = this.dbPath.replace(/\.db$/, '.db.json');
    if (!existsSync(jsonPath)) return;

    // Only migrate if DB is empty
    const count = (this.sqlite.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as { cnt: number }).cnt;
    if (count > 0) return;

    console.log(`[Database] Found legacy JSON file at ${jsonPath} — auto-migrating...`);

    try {
      const content = readFileSync(jsonPath, 'utf-8');
      const data = JSON.parse(content) as {
        conversations?: Array<Record<string, unknown>>;
        messages?: Array<Record<string, unknown>>;
        embeddings?: Array<Record<string, unknown>>;
      };

      const insertConv = this.sqlite.prepare(
        'INSERT OR IGNORE INTO conversations (id, title, createdAt, updatedAt, deletedAt, manuallyNamed) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const insertMsg = this.sqlite.prepare(
        'INSERT OR IGNORE INTO messages (id, conversationId, role, content, metadata, createdAt, turnId) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const insertEmb = this.sqlite.prepare(
        'INSERT OR IGNORE INTO embeddings (id, source, chunkIndex, content, embedding, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );

      const migrateAll = this.sqlite.transaction(() => {
        for (const c of data.conversations ?? []) {
          insertConv.run(c.id, c.title, c.createdAt, c.updatedAt, c.deletedAt ?? null, c.manuallyNamed ? 1 : null);
        }
        for (const m of data.messages ?? []) {
          const metadata = typeof m.metadata === 'object' ? JSON.stringify(m.metadata) : (m.metadata ?? '{}');
          insertMsg.run(m.id, m.conversationId, m.role, m.content ?? '', metadata, m.createdAt, m.turnId ?? null);
        }
        for (const e of data.embeddings ?? []) {
          const embedding = typeof e.embedding === 'object' ? JSON.stringify(e.embedding) : (e.embedding ?? '[]');
          const metadata = typeof e.metadata === 'object' ? JSON.stringify(e.metadata) : (e.metadata ?? '{}');
          insertEmb.run(e.id, e.source, e.chunkIndex, e.content ?? '', embedding, metadata, e.createdAt);
        }
      });

      migrateAll();

      const convCount = (this.sqlite.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as { cnt: number }).cnt;
      const msgCount = (this.sqlite.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt;
      console.log(`[Database] Auto-migration complete: ${convCount} conversations, ${msgCount} messages imported.`);
    } catch (error) {
      console.error('[Database] Auto-migration failed (non-fatal):', error);
    }
  }

  /**
   * Execute a raw SQL SELECT query. Returns rows.
   */
  rawQuery(sql: string, params?: unknown[]): unknown[] {
    const stmt = this.sqlite.prepare(sql);
    return params ? stmt.all(...params) : stmt.all();
  }

  /**
   * Execute a raw SQL mutation (INSERT/UPDATE/DELETE). Returns affected row count.
   */
  rawRun(sql: string, params?: unknown[]): number {
    const stmt = this.sqlite.prepare(sql);
    const result = params ? stmt.run(...params) : stmt.run();
    return result.changes;
  }

  /**
   * Execute raw SQL with multiple statements (for DDL like CREATE TABLE, CREATE INDEX).
   * Does not return results — use for schema setup only.
   */
  rawExec(sql: string): void {
    this.sqlite.exec(sql);
  }

  flush(): void {
    // SQLite persists immediately via WAL — nothing to flush.
    // Checkpoint WAL to main database file for clean state.
    this.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  }

  close(): void {
    this.flush();
    this.sqlite.close();
  }

  // ============================================================================
  // Row deserialization helpers
  // ============================================================================

  private deserializeConversation(row: ConversationRow): Conversation {
    let metadata: Record<string, unknown> | undefined;
    if (row.metadata && row.metadata !== '{}') {
      try { metadata = JSON.parse(row.metadata); } catch { /* ignore */ }
    }
    return {
      id: row.id,
      title: row.title,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      ...(row.manuallyNamed ? { manuallyNamed: true } : {}),
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  }

  private deserializeMessage(row: MessageRow): Message {
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role as Message['role'],
      content: row.content,
      metadata: JSON.parse(row.metadata),
      createdAt: row.createdAt,
      ...(row.turnId ? { turnId: row.turnId } : {}),
    };
  }

  private deserializeEmbedding(row: EmbeddingRow): Embedding {
    return {
      id: row.id,
      source: row.source,
      chunkIndex: row.chunkIndex,
      content: row.content,
      embedding: JSON.parse(row.embedding),
      metadata: JSON.parse(row.metadata),
      createdAt: row.createdAt,
    };
  }

  // ============================================================================
  // Repository Factories
  // ============================================================================

  private createConversationRepository(): ConversationRepository {
    return {
      findById: (id: string): Conversation | undefined => {
        const row = this.sqlite.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as ConversationRow | undefined;
        return row ? this.deserializeConversation(row) : undefined;
      },

      findAll: (options?: { limit?: number; includeDeleted?: boolean; channel?: string }): Conversation[] => {
        const limit = options?.limit ?? DEFAULT_CONVERSATIONS_LIMIT;
        const includeDeleted = options?.includeDeleted ?? false;
        const channel = options?.channel;

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (!includeDeleted) {
          conditions.push('deletedAt IS NULL');
        }

        if (channel) {
          // Filter to a specific channel (e.g., 'mission', 'pillar')
          conditions.push("json_extract(metadata, '$.channel') = ?");
          params.push(channel);
        } else {
          // Default: exclude non-chat conversations (mission, pillar, etc.)
          conditions.push("(metadata IS NULL OR json_extract(metadata, '$.channel') IS NULL OR json_extract(metadata, '$.channel') = 'chat')");
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        params.push(limit);

        const rows = this.sqlite.prepare(
          `SELECT * FROM conversations ${whereClause} ORDER BY updatedAt DESC LIMIT ?`
        ).all(...params) as ConversationRow[];

        return rows.map(r => this.deserializeConversation(r));
      },

      findRecent: (withinMs: number): Conversation | undefined => {
        const cutoff = new Date(Date.now() - withinMs).toISOString();
        const row = this.sqlite.prepare(
          "SELECT * FROM conversations WHERE updatedAt > ? AND deletedAt IS NULL AND (metadata IS NULL OR json_extract(metadata, '$.channel') IS NULL OR json_extract(metadata, '$.channel') = 'chat') ORDER BY updatedAt DESC LIMIT 1"
        ).get(cutoff) as ConversationRow | undefined;
        return row ? this.deserializeConversation(row) : undefined;
      },

      create: (conversation: Conversation): void => {
        this.sqlite.prepare(
          'INSERT INTO conversations (id, title, createdAt, updatedAt, deletedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          conversation.id,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt,
          conversation.deletedAt,
          conversation.manuallyNamed ? 1 : null,
          conversation.metadata ? JSON.stringify(conversation.metadata) : '{}',
        );
      },

      update: (id: string, updates: Partial<Omit<Conversation, 'id'>>): void => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = ?`);
          if (key === 'manuallyNamed') {
            values.push(value ? 1 : null);
          } else {
            values.push(value);
          }
        }

        if (setClauses.length > 0) {
          values.push(id);
          this.sqlite.prepare(`UPDATE conversations SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
        }
      },

      softDelete: (id: string): void => {
        const now = new Date().toISOString();
        this.sqlite.prepare('UPDATE conversations SET deletedAt = ? WHERE id = ?').run(now, id);
      },
    };
  }

  private createMessageRepository(): MessageRepository {
    // Helper to encode cursor
    const encodeCursor = (cursor: PaginationCursor): string => {
      return Buffer.from(JSON.stringify(cursor)).toString('base64url');
    };

    // Helper to decode cursor
    const decodeCursor = (encoded: string): PaginationCursor | null => {
      try {
        return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as PaginationCursor;
      } catch {
        return null;
      }
    };

    return {
      findById: (id: string): Message | undefined => {
        const row = this.sqlite.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
        return row ? this.deserializeMessage(row) : undefined;
      },

      findByConversationId: (conversationId: string, options?: { limit?: number }): Message[] => {
        const limit = options?.limit ?? DEFAULT_MESSAGES_LIMIT;
        const rows = this.sqlite.prepare(
          'SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC LIMIT ?'
        ).all(conversationId, limit) as MessageRow[];
        return rows.map(r => this.deserializeMessage(r));
      },

      findByConversationIdPaginated: (conversationId: string, options?: MessageQueryOptions): PaginatedResult<Message> => {
        const limit = Math.min(Math.max(options?.limit ?? DEFAULT_MESSAGES_LIMIT, 1), MAX_QUERY_LIMIT);
        const beforeCursor = options?.before ? decodeCursor(options.before) : null;
        const afterCursor = options?.after ? decodeCursor(options.after) : null;

        let rows: MessageRow[];
        const fetchLimit = limit + 1; // Fetch one extra to determine hasOlder/hasNewer

        if (beforeCursor) {
          // Get older messages (before the cursor) - ordered newest first, then reversed
          rows = this.sqlite.prepare(
            'SELECT * FROM messages WHERE conversationId = ? AND (createdAt < ? OR (createdAt = ? AND id < ?)) ORDER BY createdAt DESC, id DESC LIMIT ?'
          ).all(conversationId, beforeCursor.createdAt, beforeCursor.createdAt, beforeCursor.id, fetchLimit) as MessageRow[];
        } else if (afterCursor) {
          // Get newer messages (after the cursor) - ordered oldest first
          rows = this.sqlite.prepare(
            'SELECT * FROM messages WHERE conversationId = ? AND (createdAt > ? OR (createdAt = ? AND id > ?)) ORDER BY createdAt ASC, id ASC LIMIT ?'
          ).all(conversationId, afterCursor.createdAt, afterCursor.createdAt, afterCursor.id, fetchLimit) as MessageRow[];
        } else {
          // Get most recent messages (default: newest first for chat UI)
          rows = this.sqlite.prepare(
            'SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt DESC, id DESC LIMIT ?'
          ).all(conversationId, fetchLimit) as MessageRow[];
        }

        // Determine if there are more items in the direction we fetched
        const hasMore = rows.length > limit;
        if (hasMore) {
          rows = rows.slice(0, limit);
        }

        // For "before" cursor or default (no cursor), reverse to get chronological order
        if (beforeCursor || (!beforeCursor && !afterCursor)) {
          rows.reverse();
        }

        const items = rows.map(r => this.deserializeMessage(r));

        // Calculate pagination metadata
        let hasOlder: boolean;
        let hasNewer: boolean;

        if (beforeCursor) {
          // We fetched older messages
          hasOlder = hasMore;
          hasNewer = true; // There's at least the cursor position ahead
        } else if (afterCursor) {
          // We fetched newer messages
          hasOlder = true; // There's at least the cursor position behind
          hasNewer = hasMore;
        } else {
          // Default fetch (most recent messages)
          hasNewer = false; // We got the newest
          hasOlder = hasMore;
        }

        // Generate cursors for the items we're returning
        const oldestCursor = items.length > 0 ? encodeCursor({ createdAt: items[0].createdAt, id: items[0].id }) : null;
        const newestCursor = items.length > 0 ? encodeCursor({ createdAt: items[items.length - 1].createdAt, id: items[items.length - 1].id }) : null;

        // Optionally include total count
        let totalCount: number | undefined;
        if (options?.includeTotal) {
          const countResult = this.sqlite.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?').get(conversationId) as { cnt: number };
          totalCount = countResult.cnt;
        }

        return {
          items,
          pagination: {
            hasOlder,
            hasNewer,
            oldestCursor,
            newestCursor,
            totalCount,
          },
        };
      },

      countByConversationId: (conversationId: string): number => {
        const result = this.sqlite.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?').get(conversationId) as { cnt: number };
        return result.cnt;
      },

      create: (message: Message): void => {
        this.sqlite.prepare(
          'INSERT INTO messages (id, conversationId, role, content, metadata, createdAt, turnId) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          message.id,
          message.conversationId,
          message.role,
          message.content,
          JSON.stringify(message.metadata || {}),
          message.createdAt,
          message.turnId ?? null,
        );
      },

      deleteByConversationId: (conversationId: string): number => {
        const countResult = this.sqlite.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?').get(conversationId) as { cnt: number };
        const count = countResult.cnt;
        this.sqlite.prepare('DELETE FROM messages WHERE conversationId = ?').run(conversationId);
        return count;
      },
    };
  }

  private createEmbeddingRepository(): EmbeddingRepository {
    return {
      findBySource: (source: string): Embedding[] => {
        const rows = this.sqlite.prepare(
          'SELECT * FROM embeddings WHERE source = ? ORDER BY chunkIndex ASC'
        ).all(source) as EmbeddingRow[];
        return rows.map(r => this.deserializeEmbedding(r));
      },

      findAll: (): Embedding[] => {
        const rows = this.sqlite.prepare('SELECT * FROM embeddings').all() as EmbeddingRow[];
        return rows.map(r => this.deserializeEmbedding(r));
      },

      create: (embedding: Embedding): void => {
        this.sqlite.prepare(
          'INSERT INTO embeddings (id, source, chunkIndex, content, embedding, metadata, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
        ).run(
          embedding.id,
          embedding.source,
          embedding.chunkIndex,
          embedding.content,
          JSON.stringify(embedding.embedding),
          JSON.stringify(embedding.metadata || {}),
          embedding.createdAt,
        );
      },

      deleteBySource: (source: string): void => {
        this.sqlite.prepare('DELETE FROM embeddings WHERE source = ?').run(source);
      },
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let db: Database | null = null;

export async function initDb(dbPath: string): Promise<Database> {
  if (!db) {
    db = new Database(dbPath);
    await db.init();
  }
  return db;
}

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
