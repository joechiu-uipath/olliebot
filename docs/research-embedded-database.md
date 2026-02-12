# Embedded Database Engine Research

**Date:** 2026-02-12
**Status:** Recommendation ready for review
**Context:** Replace AlaSQL with a more capable embedded database engine

---

## Current State: AlaSQL

OllieBot uses **AlaSQL v4.4** (`src/db/index.ts`, 667 lines) with JSON file persistence. The database stores 4 tables: `conversations`, `messages`, `tasks`, and `embeddings`. A separate **LanceDB** instance handles vector search for RAG projects (`src/rag-projects/lance-store.ts`).

### What works well
- SQL query interface (familiar, composable)
- JSON persistence enables offline human inspection
- No setup beyond `npm install`

### What doesn't work
- **Entire DB loaded into memory** at startup via `loadFromFile()` — reads full JSON, populates in-memory tables
- **No full-text search** — messages/conversations cannot be efficiently searched by content
- **No native JSON querying** — metadata fields are serialized to JSON strings before storage, deserialized on read
- **No indexing** — every query is a full table scan
- **Fragile persistence** — debounced 100ms saves, entire DB serialized on every write via `SELECT *` export
- **Two separate DB engines** — AlaSQL for relational data + LanceDB for vector search

### Current Query Patterns (from codebase analysis)

These patterns define the migration compatibility surface:

| Pattern | Example | Files |
|---|---|---|
| Find by ID | `SELECT * FROM conversations WHERE id = ?` | `db/index.ts:335` |
| Find all + ORDER BY + LIMIT | `SELECT * FROM conversations ORDER BY updatedAt DESC LIMIT ${limit}` | `db/index.ts:340` |
| Soft delete filter | `WHERE deletedAt IS NULL` | `db/index.ts:343` |
| Temporal range query | `WHERE updatedAt > ? AND deletedAt IS NULL` | `db/index.ts:349` |
| COUNT aggregation | `SELECT COUNT(*) as cnt FROM messages WHERE conversationId = ?` | `db/index.ts:491` |
| Cursor-based pagination | Compound `WHERE (createdAt < ? OR (createdAt = ? AND id < ?))` | `db/index.ts:436-451` |
| Filter by foreign key | `WHERE conversationId = ?`, `WHERE source = ?` | `db/index.ts:425, 609` |
| Filter by enum | `WHERE status = ?` | `db/index.ts:554` |
| Dynamic UPDATE | `UPDATE conversations SET ${setClauses.join(', ')} WHERE id = ?` | `db/index.ts:362` |
| Single record INSERT | `INSERT INTO messages VALUES ?` | `db/index.ts:517` |
| Bulk INSERT | `INSERT INTO conversations SELECT * FROM ?` | `db/index.ts:232` |
| DELETE by foreign key | `DELETE FROM messages WHERE conversationId = ?` | `db/index.ts:524` |
| Arbitrary read-only SQL | MCP `db_query` tool accepts user-provided SELECT | `mcp-server/tools/data.ts:49` |

**Additional patterns observed:**
- **Repository abstraction** — all DB access goes through typed repository interfaces (`ConversationRepository`, `MessageRepository`, `TaskRepository`, `EmbeddingRepository`)
- **JSON serialization/deserialization** — `metadata`, `jsonConfig`, and `embedding` fields are `JSON.stringify`'d before INSERT and `JSON.parse`'d after SELECT
- **No transactions** — operations are single-statement
- **No JOINs** — all queries target a single table
- **No GROUP BY** — aggregations are simple counts
- **No subqueries** — straightforward WHERE clauses
- **Cursor encoding** — base64url-encoded `{createdAt, id}` pairs for pagination

---

## Requirements

| # | Requirement | Priority |
|---|---|---|
| R1 | Local embedded engine — no cloud, no backend service, no local setup beyond npm install | Must |
| R2 | SQL query support — compatible with current query patterns | Must |
| R3 | Efficient memory management — NOT loading entire DB into memory | Must |
| R4 | Offline database inspection tooling (GUI/CLI) | Must |
| R5 | Fast full-text search | Must |
| R6 | Store and query JSON objects natively | Nice to have |
| R7 | Vector DB support (replace separate LanceDB) | Nice to have |

---

## Options

### Option 1: better-sqlite3

**Package:** `better-sqlite3` (~3M weekly downloads, ~6,900 GitHub stars, MIT)

| Requirement | Rating | Notes |
|---|---|---|
| R1: Local embedded | ✅ | `npm install better-sqlite3` — prebuilt binaries for Node LTS. Requires native addon compilation as fallback. |
| R2: SQL support | ✅ | Full SQLite SQL — CTEs, window functions, subqueries, triggers. All current query patterns map 1:1. |
| R3: Memory mgmt | ✅ | File-based, page-level I/O. Handles multi-GB databases without loading into memory. |
| R4: Inspection tools | ✅ | Best ecosystem — DB Browser for SQLite, SQLiteStudio, DBeaver, Beekeeper Studio, TablePlus, `sqlite3` CLI. |
| R5: Full-text search | ✅ | FTS5 compiled in by default. BM25 ranking, boolean queries, phrase search, snippet/highlight generation. |
| R6: JSON support | ✅ | JSON1 built-in. `json_extract()`, `json_each()`, `json_tree()`, `->` / `->>` operators. |
| R7: Vector DB | ⚠️ | Via `sqlite-vec` or `sqlite-vss` extensions. Works, but requires loading a native extension — not as seamless as a built-in feature. |

**Strengths:**
- Most battle-tested option. Used by Strapi 5, Electron apps, thousands of production systems.
- Synchronous API — simple, no async/await ceremony. Matches current codebase style.
- WAL mode for concurrent readers with a single writer.
- User-defined functions and aggregates in JS.
- Prebuilt binaries mean most installs "just work."

**Weaknesses:**
- Synchronous/blocking — long queries block the event loop (mitigated via worker threads).
- Native addon — can fail on non-LTS Node versions or uncommon platforms.
- Vector search requires a separate extension load (sqlite-vec) — works but adds setup complexity.
- Node.js 22+ ships experimental built-in `node:sqlite` which may eventually compete, though it's slower and not production-ready.

---

### Option 2: sql.js

**Package:** `sql.js` (~200K weekly downloads, ~13,500 GitHub stars, MIT)

| Requirement | Rating | Notes |
|---|---|---|
| R1: Local embedded | ✅ | Pure Wasm — no native compilation. `npm install sql.js`. |
| R2: SQL support | ✅ | Full SQLite SQL (compiled from C source to Wasm). |
| R3: Memory mgmt | ❌ | **Entire database loaded into memory.** This is the same problem as AlaSQL. |
| R4: Inspection tools | ✅ | Export to `.db` file → use any SQLite GUI. |
| R5: Full-text search | ⚠️ | FTS5 NOT enabled by default. Requires `sql.js-fts5` fork or custom build. |
| R6: JSON support | ✅ | JSON1 in recent builds. |
| R7: Vector DB | ❌ | Cannot load native extensions in Wasm. No vector search possible. |

**Strengths:**
- Zero native dependencies — works everywhere JavaScript runs.
- Same SQL dialect as SQLite.

**Weaknesses:**
- **Entire DB must fit in memory** — directly contradicts R3. This is the same fundamental problem as AlaSQL.
- Slower than native bindings (Wasm overhead).
- No persistent file I/O — must explicitly export to save.
- FTS5 requires a separate fork.
- Cannot load native extensions (no vector search).
- The official docs recommend native bindings for Node.js server use.

**Verdict: Eliminated.** Fails the memory management requirement (R3), which is one of the primary motivations for this migration.

---

### Option 3: DuckDB

**Package:** `@duckdb/node-api` (~30,000 GitHub stars, MIT)

| Requirement | Rating | Notes |
|---|---|---|
| R1: Local embedded | ✅ | Prebuilt binaries, no compilation. Single-file database. |
| R2: SQL support | ✅✅ | PostgreSQL-like dialect — richest SQL of any option. PIVOT, QUALIFY, LATERAL, list comprehensions, regex functions. |
| R3: Memory mgmt | ✅✅ | Streaming execution engine with out-of-core spill-to-disk. Can sort 100GB on 16GB RAM. |
| R4: Inspection tools | ✅ | Official DuckDB Local UI (browser-based SQL notebook), DuckDB CLI, Beekeeper Studio, DBeaver. |
| R5: Full-text search | ✅ | `fts` extension — BM25 ranking, stemming, stopwords. Less mature than FTS5 but functional. |
| R6: JSON support | ✅✅ | Best-in-class. Native JSON type, `->` / `->>`, JSONPath, `read_json_auto()`, automatic schema detection. Can query JSON files directly as tables. |
| R7: Vector DB | ⚠️ | `vss` extension (experimental). HNSW indexes for ANN search. Index must fit in RAM, soft deletes only. |

**Strengths:**
- Exceptional analytical query performance (columnar engine).
- Can directly query Parquet, CSV, JSON files as virtual tables.
- JSON support is genuinely best-in-class — native type, not just text with functions.
- Out-of-core processing means effectively unbounded dataset sizes.
- Rich SQL dialect covers any future query need.

**Weaknesses:**
- **OLAP-optimized, not OLTP.** DuckDB is designed for analytical workloads (complex aggregations, large scans), not high-frequency single-row INSERT/UPDATE/DELETE. OllieBot's workload is OLTP — individual message inserts, single-row lookups by ID, cursor-based pagination.
- NPM package in transition — `duckdb` (deprecated) → `@duckdb/node-api` (new). The new package has fewer dependents (~80) and the ecosystem is still catching up.
- Larger binary size than SQLite-based options.
- VSS extension is experimental — HNSW indexes must fit in RAM.
- No WAL-mode concurrent readers/writers in the OLTP sense.

**Key concern:** The workload mismatch is significant. DuckDB excels at `SELECT SUM(amount) FROM orders GROUP BY region` but is overbuilt for `SELECT * FROM messages WHERE id = ?`. It would work, but it's like using a forklift to carry groceries.

---

### Option 4: LanceDB

**Package:** `@lancedb/lancedb` (~6,000-9,000 GitHub stars, Apache-2.0)

| Requirement | Rating | Notes |
|---|---|---|
| R1: Local embedded | ✅ | Prebuilt binaries, no compilation. No Alpine Linux support (musl). |
| R2: SQL support | ❌ | **Limited SQL.** Primary API is a builder pattern, not SQL. SQL support via DataFusion is incomplete. |
| R3: Memory mgmt | ✅ | File-based Lance columnar format. Zero-copy Arrow access. |
| R4: Inspection tools | ⚠️ | Lance Data Viewer (Docker-based, read-only). Can also query via DuckDB. Limited compared to SQLite ecosystem. |
| R5: Full-text search | ⚠️ | BM25 inverted index — in beta. Syntax may change. |
| R6: JSON support | ⚠️ | Arrow schemas support nested structs/lists but no SQL-style `json_extract()`. |
| R7: Vector DB | ✅✅ | **Primary strength.** IVF-PQ indexing, hybrid search (vector + FTS), multimodal support. Purpose-built for this. |

**Strengths:**
- Best vector search capabilities by far.
- Native hybrid search (vector + keyword) with configurable rerankers.
- Already used in the codebase for RAG (`src/rag-projects/lance-store.ts`).
- Automatic data versioning.

**Weaknesses:**
- **Not a general-purpose relational database.** Cannot replace AlaSQL for conversations/messages/tasks queries.
- Limited SQL support — the codebase relies heavily on SQL (including an MCP tool that accepts arbitrary SELECT queries).
- FTS is in beta.
- Pre-1.0 API (0.26.x) — breaking changes possible.
- Inspection tooling is limited (Docker-based viewer).

**Verdict: Not suitable as the primary database.** LanceDB is excellent for vector search but cannot serve as a general-purpose relational store. It should remain as the RAG vector store alongside whatever replaces AlaSQL, or be replaced if the new engine has strong enough vector capabilities.

---

### Option 5: libSQL (Turso local mode)

**Package:** `@libsql/client` (~350K weekly downloads, ~16,300 GitHub stars, MIT)

| Requirement | Rating | Notes |
|---|---|---|
| R1: Local embedded | ✅ | `createClient({ url: "file:local.db" })` — fully local, no cloud needed. |
| R2: SQL support | ✅ | Full SQLite compatibility (libSQL is a fork of SQLite) plus extensions. |
| R3: Memory mgmt | ✅ | Same as SQLite — file-based, page-level I/O. Async API doesn't block event loop. |
| R4: Inspection tools | ✅ | SQLite-compatible files — all SQLite GUIs work. Plus `libsql` CLI. |
| R5: Full-text search | ✅ | FTS5 (inherited from SQLite) + experimental Tantivy-based FTS engine (Postgres-style syntax). |
| R6: JSON support | ✅ | Full JSON1 support inherited from SQLite. |
| R7: Vector DB | ✅ | **Native VECTOR data type.** First-class similarity search (cosine, L2) without extensions. |

**Strengths:**
- Full SQLite compatibility — all current query patterns work without modification.
- **Native vector search** — no extensions needed. Could potentially consolidate AlaSQL + LanceDB into one engine.
- Async API — queries don't block the event loop.
- Path to cloud sync if ever needed (embedded replicas).
- Experimental Tantivy-based FTS goes beyond FTS5.
- Active development backed by Turso.

**Weaknesses:**
- **Strategic uncertainty.** Turso announced they're rewriting SQLite in Rust ("Limbo" / "Turso Database"). libSQL (the C fork) will eventually be superseded. Migration path is unclear, though the SQL interface should remain compatible.
- Newer features (native FTS, vector search, concurrent writes) are experimental, not battle-tested at scale.
- Async-only API — different programming model from the current synchronous AlaSQL usage.
- Interactive transactions have a 5-second timeout.
- Smaller ecosystem than upstream SQLite (though growing).
- Vector search is newer and less proven than LanceDB's.

---

## Comparison Matrix

| | better-sqlite3 | sql.js | DuckDB | LanceDB | libSQL |
|---|:---:|:---:|:---:|:---:|:---:|
| **R1: Local embedded** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **R2: SQL support** | ✅ | ✅ | ✅✅ | ❌ | ✅ |
| **R3: Memory management** | ✅ | ❌ | ✅✅ | ✅ | ✅ |
| **R4: Inspection tools** | ✅✅ | ✅ | ✅ | ⚠️ | ✅ |
| **R5: Full-text search** | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| **R6: JSON support** | ✅ | ✅ | ✅✅ | ⚠️ | ✅ |
| **R7: Vector DB** | ⚠️ | ❌ | ⚠️ | ✅✅ | ✅ |
| **Workload fit (OLTP)** | ✅✅ | ✅ | ⚠️ | ❌ | ✅ |
| **NPM weekly downloads** | ~3M | ~200K | growing | lower | ~350K |
| **Maturity** | Very high | High | Very high | Pre-1.0 | High (core) |
| **API style** | Sync | Sync | Async | Async | Async |

---

## Recommendation

### Primary: **better-sqlite3** (recommended)

**Rationale:**

1. **Perfect workload fit.** OllieBot's query patterns are textbook OLTP — single-row lookups, cursor-based pagination, INSERT/UPDATE/DELETE of individual records. better-sqlite3 is the most battle-tested embedded OLTP engine in the Node.js ecosystem.

2. **All "must have" requirements satisfied with zero compromise.** FTS5 built-in, JSON1 built-in, file-based storage (no memory loading), unmatched inspection tooling, full SQL compatibility with every current query pattern.

3. **Lowest migration risk.** Current AlaSQL queries are standard SQL. They map 1:1 to SQLite syntax. The repository abstraction layer means the migration surface is contained to `src/db/index.ts`.

4. **Largest ecosystem.** ~3M weekly downloads. Any problem you hit, someone has solved it. Any SQLite GUI opens your database. Any tutorial applies.

5. **JSON querying eliminates serialization overhead.** Currently, metadata fields are `JSON.stringify`'d before INSERT and `JSON.parse`'d after SELECT. With JSON1, you can store JSON natively and query into it: `SELECT json_extract(metadata, '$.toolName') FROM messages WHERE json_extract(metadata, '$.type') = 'tool_execution_finished'`. This eliminates the serialize/deserialize dance.

6. **Full-text search unlocks new features.** FTS5 enables searching message content, conversation titles, and task names — something not possible with AlaSQL today. Example: `SELECT * FROM messages_fts WHERE messages_fts MATCH 'error handling' ORDER BY rank`.

**Vector search strategy:** Keep LanceDB for RAG vector search. LanceDB is purpose-built for this and already integrated. Adding `sqlite-vec` for basic vector operations is possible later if needed, but LanceDB's IVF-PQ indexing, hybrid search, and multimodal support are superior for the RAG use case. Two engines, each doing what it's best at.

### Runner-up: **libSQL**

libSQL is the most interesting alternative. It offers everything better-sqlite3 does (SQLite compatibility) plus native vector search and an async API. The ability to consolidate AlaSQL + LanceDB into a single engine is compelling.

**Why it's not the primary recommendation:**
- The vector search and advanced FTS features are experimental — LanceDB is more proven for production vector workloads.
- Strategic uncertainty around the Rust rewrite (Limbo/Turso Database) creates long-term platform risk.
- The async-only API requires more extensive refactoring of the current synchronous DB layer.
- For the "boring infrastructure" category, proven and stable wins over novel and experimental.

**When to pick libSQL instead:** If consolidating into a single database engine is a high priority (eliminating LanceDB dependency entirely), and you're comfortable with experimental vector search capabilities that may not match LanceDB's quality yet.

---

## Migration Notes (for better-sqlite3)

### What changes

| Aspect | AlaSQL (current) | better-sqlite3 (new) |
|---|---|---|
| Persistence | JSON file, full export on every save | SQLite file, transactional writes |
| Memory model | Entire DB in memory | Page cache, disk-based |
| JSON fields | `JSON.stringify()` before INSERT, `JSON.parse()` after SELECT | Store as TEXT, query with `json_extract()` |
| Save strategy | Debounced 100ms, `SELECT *` export | Automatic (every write is persisted immediately) |
| API style | `alasql('SELECT...', params)` returns `unknown[]` | `db.prepare('SELECT...').all(params)` returns typed rows |
| FTS | Not available | FTS5 virtual table (create shadow tables for searchable content) |
| Inspection | Open `.json` file in text editor | Open `.db` file in DB Browser for SQLite |

### Query migration examples

```typescript
// AlaSQL (current)
alasql('SELECT * FROM conversations WHERE id = ?', [id])

// better-sqlite3 (new)
db.prepare('SELECT * FROM conversations WHERE id = ?').get(id)
```

```typescript
// AlaSQL (current) — JSON field serialization
const row = { ...message, metadata: JSON.stringify(message.metadata) };
alasql('INSERT INTO messages VALUES ?', [row]);

// better-sqlite3 (new) — store JSON as TEXT, query natively
db.prepare('INSERT INTO messages (id, conversationId, role, content, metadata, createdAt, turnId) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(message.id, message.conversationId, message.role, message.content, JSON.stringify(message.metadata), message.createdAt, message.turnId);

// And query into JSON without deserializing the whole object:
db.prepare("SELECT * FROM messages WHERE json_extract(metadata, '$.type') = ?").all('tool_execution_finished');
```

```typescript
// FTS5 setup (new capability)
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=rowid,
    tokenize='porter unicode61'
  );
`);

// Full-text search
db.prepare("SELECT m.* FROM messages m JOIN messages_fts fts ON m.rowid = fts.rowid WHERE messages_fts MATCH ? ORDER BY rank LIMIT ?")
  .all(searchQuery, limit);
```

### Additional features to consider based on codebase patterns

1. **Indexes.** AlaSQL has no indexes. Add indexes for the frequent query patterns:
   - `CREATE INDEX idx_messages_conversation ON messages(conversationId, createdAt)`
   - `CREATE INDEX idx_conversations_updated ON conversations(updatedAt DESC) WHERE deletedAt IS NULL`
   - `CREATE INDEX idx_tasks_status ON tasks(status, updatedAt DESC)`
   - `CREATE INDEX idx_embeddings_source ON embeddings(source, chunkIndex)`

2. **Transactions.** The current debounced save pattern is fragile — a crash loses all unsaved data. SQLite's WAL mode provides durability per write with minimal performance cost. Batch operations (like bulk message delete) can use explicit transactions for atomicity.

3. **Prepared statements.** better-sqlite3's prepared statement API (`db.prepare()`) caches compiled SQL, giving significant performance improvement over AlaSQL's per-query compilation.

4. **Migration system.** Add a `user_version` pragma-based migration system for schema evolution:
   ```sql
   PRAGMA user_version; -- returns current schema version
   PRAGMA user_version = 2; -- set after migration
   ```

5. **Data migration.** Write a one-time migration that reads the existing `olliebot.db.json` file and imports all data into the new SQLite database. The JSON format is well-structured and maps directly to the new schema.

6. **MCP `db_query` tool.** The current tool allows arbitrary SELECT queries and already validates against mutation keywords. This works identically with better-sqlite3 — the SQL dialect is compatible.
