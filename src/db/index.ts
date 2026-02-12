/**
 * Type-safe Database Layer with AlaSQL + JSON Persistence
 *
 * Provides SQL query capabilities with human-readable JSON storage.
 * Data is persisted to a JSON file that can be viewed offline.
 */

import alasql from 'alasql';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import {
  DEFAULT_CONVERSATIONS_LIMIT,
  DEFAULT_MESSAGES_LIMIT,
  DEFAULT_TASKS_LIMIT,
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

export interface Task {
  id: string;
  name: string;
  mdFile: string;
  jsonConfig: Record<string, unknown>;
  status: 'active' | 'paused' | 'error';
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
  updatedAt: string;
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

interface DatabaseData {
  conversations: Conversation[];
  messages: Message[];
  tasks: Task[];
  embeddings: Embedding[];
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

export interface TaskRepository {
  findById(id: string): Task | undefined;
  findAll(options?: { limit?: number; status?: Task['status'] }): Task[];
  create(task: Task): void;
  update(id: string, updates: Partial<Omit<Task, 'id'>>): void;
}

export interface EmbeddingRepository {
  findBySource(source: string): Embedding[];
  findAll(): Embedding[];
  create(embedding: Embedding): void;
  deleteBySource(source: string): void;
}

// ============================================================================
// Database Implementation
// ============================================================================

class Database {
  private dbPath: string;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isDirty = false;
  private initialized = false;

  conversations: ConversationRepository;
  messages: MessageRepository;
  tasks: TaskRepository;
  embeddings: EmbeddingRepository;

  constructor(dbPath: string) {
    this.dbPath = dbPath.endsWith('.json') ? dbPath : dbPath.replace(/\.[^.]+$/, '') + '.json';

    // Initialize repositories
    this.conversations = this.createConversationRepository();
    this.messages = this.createMessageRepository();
    this.tasks = this.createTaskRepository();
    this.embeddings = this.createEmbeddingRepository();
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Create tables in AlaSQL
    alasql(`
      CREATE TABLE IF NOT EXISTS conversations (
        id STRING PRIMARY KEY,
        title STRING,
        channel STRING,
        createdAt STRING,
        updatedAt STRING,
        deletedAt STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS messages (
        id STRING PRIMARY KEY,
        conversationId STRING,
        channel STRING,
        role STRING,
        content STRING,
        metadata STRING,
        createdAt STRING,
        turnId STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS tasks (
        id STRING PRIMARY KEY,
        name STRING,
        mdFile STRING,
        jsonConfig STRING,
        status STRING,
        lastRun STRING,
        nextRun STRING,
        createdAt STRING,
        updatedAt STRING
      )
    `);

    alasql(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id STRING PRIMARY KEY,
        source STRING,
        chunkIndex INT,
        content STRING,
        embedding STRING,
        metadata STRING,
        createdAt STRING
      )
    `);

    // Load existing data from JSON file
    this.loadFromFile();
    this.initialized = true;
  }

  private loadFromFile(): void {
    try {
      if (existsSync(this.dbPath)) {
        const content = readFileSync(this.dbPath, 'utf-8');
        const data: DatabaseData = JSON.parse(content);

        // Clear existing data
        alasql('DELETE FROM conversations');
        alasql('DELETE FROM messages');
        alasql('DELETE FROM tasks');
        alasql('DELETE FROM embeddings');

        // Insert loaded data (serialize complex fields for AlaSQL storage)
        if (data.conversations?.length) {
          alasql('INSERT INTO conversations SELECT * FROM ?', [data.conversations]);
        }
        if (data.messages?.length) {
          const messages = data.messages.map(m => ({
            ...m,
            metadata: typeof m.metadata === 'object' ? JSON.stringify(m.metadata) : m.metadata,
          }));
          alasql('INSERT INTO messages SELECT * FROM ?', [messages]);
        }
        if (data.tasks?.length) {
          const tasks = data.tasks.map(t => ({
            ...t,
            jsonConfig: typeof t.jsonConfig === 'object' ? JSON.stringify(t.jsonConfig) : t.jsonConfig,
          }));
          alasql('INSERT INTO tasks SELECT * FROM ?', [tasks]);
        }
        if (data.embeddings?.length) {
          const embeddings = data.embeddings.map(e => ({
            ...e,
            embedding: typeof e.embedding === 'object' ? JSON.stringify(e.embedding) : e.embedding,
            metadata: typeof e.metadata === 'object' ? JSON.stringify(e.metadata) : e.metadata,
          }));
          alasql('INSERT INTO embeddings SELECT * FROM ?', [embeddings]);
        }

        console.log(`[Database] Loaded from ${this.dbPath}`);
      }
    } catch (error) {
      console.error('[Database] Failed to load from file:', error);
    }
  }

  private saveToFile(): void {
    try {
      const dir = dirname(this.dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Get raw data from AlaSQL
      const rawConversations = alasql('SELECT * FROM conversations ORDER BY updatedAt DESC') as Conversation[];
      const rawMessages = alasql('SELECT * FROM messages ORDER BY createdAt ASC') as Array<Record<string, unknown>>;
      const rawTasks = alasql('SELECT * FROM tasks ORDER BY updatedAt DESC') as Array<Record<string, unknown>>;
      const rawEmbeddings = alasql('SELECT * FROM embeddings ORDER BY source, chunkIndex') as Array<Record<string, unknown>>;

      // Deserialize JSON strings for human-readable output
      const data: DatabaseData = {
        conversations: rawConversations,
        messages: rawMessages.map(m => ({
          ...m,
          metadata: typeof m.metadata === 'string' ? JSON.parse(m.metadata as string) : m.metadata,
        })) as Message[],
        tasks: rawTasks.map(t => ({
          ...t,
          jsonConfig: typeof t.jsonConfig === 'string' ? JSON.parse(t.jsonConfig as string) : t.jsonConfig,
        })) as Task[],
        embeddings: rawEmbeddings.map(e => ({
          ...e,
          embedding: typeof e.embedding === 'string' ? JSON.parse(e.embedding as string) : e.embedding,
          metadata: typeof e.metadata === 'string' ? JSON.parse(e.metadata as string) : e.metadata,
        })) as Embedding[],
      };

      writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
      this.isDirty = false;
    } catch (error) {
      console.error('[Database] Failed to save to file:', error);
    }
  }

  private scheduleSave(): void {
    this.isDirty = true;
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    // Debounce saves for performance
    this.saveTimeout = setTimeout(() => {
      this.saveToFile();
      this.saveTimeout = null;
    }, 100);
  }

  flush(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
    if (this.isDirty) {
      this.saveToFile();
    }
  }

  close(): void {
    this.flush();
  }

  // ============================================================================
  // Repository Factories
  // ============================================================================

  private createConversationRepository(): ConversationRepository {
    return {
      findById: (id: string): Conversation | undefined => {
        const results = alasql('SELECT * FROM conversations WHERE id = ?', [id]) as Conversation[];
        return results[0];
      },

      findAll: (options?: { limit?: number; includeDeleted?: boolean }): Conversation[] => {
        const limit = options?.limit ?? DEFAULT_CONVERSATIONS_LIMIT;
        const includeDeleted = options?.includeDeleted ?? false;
        if (includeDeleted) {
          return alasql(`SELECT * FROM conversations ORDER BY updatedAt DESC LIMIT ${limit}`) as Conversation[];
        }
        return alasql(`SELECT * FROM conversations WHERE deletedAt IS NULL ORDER BY updatedAt DESC LIMIT ${limit}`) as Conversation[];
      },

      findRecent: (withinMs: number): Conversation | undefined => {
        const cutoff = new Date(Date.now() - withinMs).toISOString();
        const results = alasql(
          'SELECT * FROM conversations WHERE updatedAt > ? AND deletedAt IS NULL ORDER BY updatedAt DESC LIMIT 1',
          [cutoff]
        ) as Conversation[];
        return results[0];
      },

      create: (conversation: Conversation): void => {
        alasql('INSERT INTO conversations VALUES ?', [conversation]);
        this.scheduleSave();
      },

      update: (id: string, updates: Partial<Omit<Conversation, 'id'>>): void => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }

        if (setClauses.length > 0) {
          values.push(id);
          alasql(`UPDATE conversations SET ${setClauses.join(', ')} WHERE id = ?`, values);
          this.scheduleSave();
        }
      },

      softDelete: (id: string): void => {
        const now = new Date().toISOString();
        alasql('UPDATE conversations SET deletedAt = ? WHERE id = ?', [now, id]);
        this.scheduleSave();
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

    // Helper to deserialize a message row
    const deserializeRow = (row: Record<string, unknown>): Message => ({
      ...row,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata,
    }) as Message;

    return {
      findById: (id: string): Message | undefined => {
        const rows = alasql('SELECT * FROM messages WHERE id = ?', [id]) as Array<Record<string, unknown>>;
        if (rows.length === 0) return undefined;
        const row = rows[0];
        return deserializeRow(row);
      },

      findByConversationId: (conversationId: string, options?: { limit?: number }): Message[] => {
        const limit = options?.limit ?? DEFAULT_MESSAGES_LIMIT;
        const rows = alasql(
          `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC LIMIT ${limit}`,
          [conversationId]
        ) as Array<Record<string, unknown>>;
        return rows.map(deserializeRow);
      },

      findByConversationIdPaginated: (conversationId: string, options?: MessageQueryOptions): PaginatedResult<Message> => {
        const limit = Math.min(Math.max(options?.limit ?? DEFAULT_TASKS_LIMIT, 1), MAX_QUERY_LIMIT);
        const beforeCursor = options?.before ? decodeCursor(options.before) : null;
        const afterCursor = options?.after ? decodeCursor(options.after) : null;

        let rows: Array<Record<string, unknown>>;
        const fetchLimit = limit + 1; // Fetch one extra to determine hasOlder/hasNewer

        if (beforeCursor) {
          // Get older messages (before the cursor) - ordered newest first, then reversed
          rows = alasql(
            `SELECT * FROM messages WHERE conversationId = ? AND (createdAt < ? OR (createdAt = ? AND id < ?)) ORDER BY createdAt DESC, id DESC LIMIT ${fetchLimit}`,
            [conversationId, beforeCursor.createdAt, beforeCursor.createdAt, beforeCursor.id]
          ) as Array<Record<string, unknown>>;
        } else if (afterCursor) {
          // Get newer messages (after the cursor) - ordered oldest first
          rows = alasql(
            `SELECT * FROM messages WHERE conversationId = ? AND (createdAt > ? OR (createdAt = ? AND id > ?)) ORDER BY createdAt ASC, id ASC LIMIT ${fetchLimit}`,
            [conversationId, afterCursor.createdAt, afterCursor.createdAt, afterCursor.id]
          ) as Array<Record<string, unknown>>;
        } else {
          // Get most recent messages (default: newest first for chat UI)
          rows = alasql(
            `SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt DESC, id DESC LIMIT ${fetchLimit}`,
            [conversationId]
          ) as Array<Record<string, unknown>>;
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

        const items = rows.map(deserializeRow);

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
          const countResult = alasql('SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?', [conversationId]) as Array<{ cnt: number }>;
          totalCount = countResult[0]?.cnt ?? 0;
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
        const result = alasql('SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?', [conversationId]) as Array<{ cnt: number }>;
        return result[0]?.cnt ?? 0;
      },

      create: (message: Message): void => {
        const row = {
          ...message,
          metadata: JSON.stringify(message.metadata || {}),
        };
        alasql('INSERT INTO messages VALUES ?', [row]);
        this.scheduleSave();
      },

      deleteByConversationId: (conversationId: string): number => {
        const countResult = alasql('SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?', [conversationId]) as Array<{ cnt: number }>;
        const count = countResult[0]?.cnt ?? 0;
        alasql('DELETE FROM messages WHERE conversationId = ?', [conversationId]);
        this.scheduleSave();
        return count;
      },
    };
  }

  private createTaskRepository(): TaskRepository {
    const deserializeTask = (row: Record<string, unknown>): Task => ({
      id: row.id as string,
      name: row.name as string,
      mdFile: row.mdFile as string,
      jsonConfig: typeof row.jsonConfig === 'string' ? JSON.parse(row.jsonConfig as string) : row.jsonConfig as Record<string, unknown>,
      status: row.status as Task['status'],
      lastRun: row.lastRun as string | null,
      nextRun: row.nextRun as string | null,
      createdAt: row.createdAt as string,
      updatedAt: row.updatedAt as string,
    });

    return {
      findById: (id: string): Task | undefined => {
        const results = alasql('SELECT * FROM tasks WHERE id = ?', [id]) as Array<Record<string, unknown>>;
        return results[0] ? deserializeTask(results[0]) : undefined;
      },

      findAll: (options?: { limit?: number; status?: Task['status'] }): Task[] => {
        const limit = options?.limit ?? DEFAULT_TASKS_LIMIT;
        let rows: Array<Record<string, unknown>>;
        if (options?.status) {
          rows = alasql(
            `SELECT * FROM tasks WHERE status = ? ORDER BY updatedAt DESC LIMIT ${limit}`,
            [options.status]
          ) as Array<Record<string, unknown>>;
        } else {
          rows = alasql(`SELECT * FROM tasks ORDER BY updatedAt DESC LIMIT ${limit}`) as Array<Record<string, unknown>>;
        }
        return rows.map(deserializeTask);
      },

      create: (task: Task): void => {
        const row = {
          ...task,
          jsonConfig: JSON.stringify(task.jsonConfig || {}),
        };
        alasql('INSERT INTO tasks VALUES ?', [row]);
        this.scheduleSave();
      },

      update: (id: string, updates: Partial<Omit<Task, 'id'>>): void => {
        const setClauses: string[] = [];
        const values: unknown[] = [];

        for (const [key, value] of Object.entries(updates)) {
          setClauses.push(`${key} = ?`);
          // Serialize jsonConfig if present
          if (key === 'jsonConfig' && typeof value === 'object') {
            values.push(JSON.stringify(value));
          } else {
            values.push(value);
          }
        }

        if (setClauses.length > 0) {
          values.push(id);
          alasql(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`, values);
          this.scheduleSave();
        }
      },
    };
  }

  private createEmbeddingRepository(): EmbeddingRepository {
    const deserializeEmbedding = (row: Record<string, unknown>): Embedding => ({
      id: row.id as string,
      source: row.source as string,
      chunkIndex: row.chunkIndex as number,
      content: row.content as string,
      embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding as string) : row.embedding as number[],
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata as string) : row.metadata as Record<string, unknown>,
      createdAt: row.createdAt as string,
    });

    return {
      findBySource: (source: string): Embedding[] => {
        const rows = alasql(
          'SELECT * FROM embeddings WHERE source = ? ORDER BY chunkIndex ASC',
          [source]
        ) as Array<Record<string, unknown>>;
        return rows.map(deserializeEmbedding);
      },

      findAll: (): Embedding[] => {
        const rows = alasql('SELECT * FROM embeddings') as Array<Record<string, unknown>>;
        return rows.map(deserializeEmbedding);
      },

      create: (embedding: Embedding): void => {
        const row = {
          ...embedding,
          embedding: JSON.stringify(embedding.embedding),
          metadata: JSON.stringify(embedding.metadata || {}),
        };
        alasql('INSERT INTO embeddings VALUES ?', [row]);
        this.scheduleSave();
      },

      deleteBySource: (source: string): void => {
        alasql('DELETE FROM embeddings WHERE source = ?', [source]);
        this.scheduleSave();
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
    console.log(`[Database] Initialized with JSON persistence at ${dbPath.replace(/\.[^.]+$/, '')}.json`);
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
