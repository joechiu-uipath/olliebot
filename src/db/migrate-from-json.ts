/**
 * Data Migration: AlaSQL JSON → SQLite
 *
 * Migrates data from the old AlaSQL JSON persistence format to the new
 * better-sqlite3 SQLite database. Run this once during upgrade.
 *
 * Usage:
 *   npx tsx src/db/migrate-from-json.ts [json-path] [sqlite-path]
 *
 * Defaults:
 *   json-path:   user/data/olliebot.db.json
 *   sqlite-path:  user/data/olliebot.db
 *
 * The script is idempotent — it skips rows that already exist (by primary key).
 * The original JSON file is NOT deleted; you can remove it manually after verifying.
 */

import BetterSqlite3 from 'better-sqlite3';
import { existsSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  manuallyNamed?: boolean;
}

interface Message {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  metadata: Record<string, unknown> | string;
  createdAt: string;
  turnId?: string;
}

interface Task {
  id: string;
  name: string;
  mdFile: string;
  jsonConfig: Record<string, unknown> | string;
  status: string;
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Embedding {
  id: string;
  source: string;
  chunkIndex: number;
  content: string;
  embedding: number[] | string;
  metadata: Record<string, unknown> | string;
  createdAt: string;
}

interface DatabaseData {
  conversations: Conversation[];
  messages: Message[];
  tasks: Task[];
  embeddings: Embedding[];
}

function migrate(jsonPath: string, sqlitePath: string): void {
  // Validate JSON file exists
  if (!existsSync(jsonPath)) {
    console.log(`[Migration] No JSON file found at ${jsonPath} — nothing to migrate.`);
    return;
  }

  // Validate SQLite path doesn't already have data (optional safety check)
  console.log(`[Migration] Reading JSON data from ${jsonPath}...`);
  const content = readFileSync(jsonPath, 'utf-8');
  const data: DatabaseData = JSON.parse(content);

  const convCount = data.conversations?.length ?? 0;
  const msgCount = data.messages?.length ?? 0;
  const taskCount = data.tasks?.length ?? 0;
  const embCount = data.embeddings?.length ?? 0;

  console.log(`[Migration] Found: ${convCount} conversations, ${msgCount} messages, ${taskCount} tasks, ${embCount} embeddings`);

  if (convCount === 0 && msgCount === 0 && taskCount === 0 && embCount === 0) {
    console.log(`[Migration] JSON file is empty — nothing to migrate.`);
    return;
  }

  // Ensure target directory exists
  const dir = dirname(sqlitePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Open SQLite database
  const db = new BetterSqlite3(sqlitePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables (same schema as db/index.ts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      manuallyNamed INTEGER
    )
  `);

  db.exec(`
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mdFile TEXT NOT NULL,
      jsonConfig TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'active',
      lastRun TEXT,
      nextRun TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.exec(`
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

  // Use INSERT OR IGNORE for idempotent migration
  const insertConversation = db.prepare(`
    INSERT OR IGNORE INTO conversations (id, title, createdAt, updatedAt, deletedAt, manuallyNamed)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMessage = db.prepare(`
    INSERT OR IGNORE INTO messages (id, conversationId, role, content, metadata, createdAt, turnId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertTask = db.prepare(`
    INSERT OR IGNORE INTO tasks (id, name, mdFile, jsonConfig, status, lastRun, nextRun, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertEmbedding = db.prepare(`
    INSERT OR IGNORE INTO embeddings (id, source, chunkIndex, content, embedding, metadata, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  // Run all inserts in a single transaction for performance
  const migrateAll = db.transaction(() => {
    let inserted = { conversations: 0, messages: 0, tasks: 0, embeddings: 0 };

    // Conversations
    for (const c of data.conversations ?? []) {
      const result = insertConversation.run(
        c.id,
        c.title,
        c.createdAt,
        c.updatedAt,
        c.deletedAt,
        c.manuallyNamed ? 1 : null,
      );
      if (result.changes > 0) inserted.conversations++;
    }

    // Messages
    for (const m of data.messages ?? []) {
      const metadata = typeof m.metadata === 'object' ? JSON.stringify(m.metadata) : m.metadata;
      const result = insertMessage.run(
        m.id,
        m.conversationId,
        m.role,
        m.content ?? '',
        metadata ?? '{}',
        m.createdAt,
        m.turnId ?? null,
      );
      if (result.changes > 0) inserted.messages++;
    }

    // Tasks
    for (const t of data.tasks ?? []) {
      const jsonConfig = typeof t.jsonConfig === 'object' ? JSON.stringify(t.jsonConfig) : t.jsonConfig;
      const result = insertTask.run(
        t.id,
        t.name,
        t.mdFile,
        jsonConfig ?? '{}',
        t.status,
        t.lastRun,
        t.nextRun,
        t.createdAt,
        t.updatedAt,
      );
      if (result.changes > 0) inserted.tasks++;
    }

    // Embeddings
    for (const e of data.embeddings ?? []) {
      const embedding =
        e.embedding == null
          ? '[]'
          : typeof e.embedding === 'object'
            ? JSON.stringify(e.embedding)
            : e.embedding;
      const metadata =
        e.metadata == null
          ? '{}'
          : typeof e.metadata === 'object'
            ? JSON.stringify(e.metadata)
            : e.metadata;
      const result = insertEmbedding.run(
        e.id,
        e.source,
        e.chunkIndex,
        e.content ?? '',
        embedding,
        metadata,
        e.createdAt,
      );
      if (result.changes > 0) inserted.embeddings++;
    }

    return inserted;
  });

  console.log(`[Migration] Inserting data into SQLite...`);
  const inserted = migrateAll();

  console.log(`[Migration] Inserted: ${inserted.conversations} conversations, ${inserted.messages} messages, ${inserted.tasks} tasks, ${inserted.embeddings} embeddings`);

  // Verify counts
  const dbConvCount = (db.prepare('SELECT COUNT(*) as cnt FROM conversations').get() as { cnt: number }).cnt;
  const dbMsgCount = (db.prepare('SELECT COUNT(*) as cnt FROM messages').get() as { cnt: number }).cnt;
  const dbTaskCount = (db.prepare('SELECT COUNT(*) as cnt FROM tasks').get() as { cnt: number }).cnt;
  const dbEmbCount = (db.prepare('SELECT COUNT(*) as cnt FROM embeddings').get() as { cnt: number }).cnt;

  console.log(`[Migration] Verification — SQLite now has: ${dbConvCount} conversations, ${dbMsgCount} messages, ${dbTaskCount} tasks, ${dbEmbCount} embeddings`);

  db.close();
  console.log(`[Migration] Complete! SQLite database saved to ${sqlitePath}`);
  console.log(`[Migration] The original JSON file at ${jsonPath} has NOT been deleted.`);
  console.log(`[Migration] You can remove it manually after verifying the migration.`);
}

// CLI entry point
const args = process.argv.slice(2);
const cwd = process.cwd();
const jsonPath = args[0] || join(cwd, 'user', 'data', 'olliebot.db.json');
const sqlitePath = args[1] || join(cwd, 'user', 'data', 'olliebot.db');

migrate(jsonPath, sqlitePath);
