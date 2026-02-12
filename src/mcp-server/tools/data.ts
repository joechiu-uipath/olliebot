/**
 * MCP Tool Handlers: Data Inspection
 *
 * Tools: db_query, list_conversations, list_messages
 */

import { getDb } from '../../db/index.js';
import type { RegisteredTool, MCPToolCallResult } from '../types.js';

function textResult(text: string): MCPToolCallResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): MCPToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const DEFAULT_DB_QUERY_LIMIT = 100;
const MAX_DB_QUERY_LIMIT = 1000;

/**
 * Validate that a SQL query is read-only.
 * Throws if the query contains mutation keywords.
 */
function validateReadOnlyQuery(sql: string): void {
  const normalized = sql.trim().toUpperCase();

  if (!normalized.startsWith('SELECT')) {
    throw new Error('Only SELECT queries are allowed.');
  }

  const blocked = [
    'DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE',
    'EXEC', 'EXECUTE', 'GRANT', 'REVOKE',
  ];
  for (const keyword of blocked) {
    // Match as whole word to avoid false positives in column names
    const regex = new RegExp(`\\b${keyword}\\b`);
    if (regex.test(normalized)) {
      throw new Error(`Query contains blocked keyword: ${keyword}`);
    }
  }
}

export function createDataTools(): RegisteredTool[] {
  return [
    // ── db_query ────────────────────────────────────────────────────────
    {
      definition: {
        name: 'db_query',
        description:
          'Execute a read-only SQL query against the OllieBot database (SQLite). Only SELECT statements allowed. Tables: conversations, messages, tasks, embeddings. JSON fields (metadata, jsonConfig) can be queried with json_extract(). Full-text search available via messages_fts table.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'SQL SELECT query to execute.',
            },
            limit: {
              type: 'number',
              description: `Max rows to return. Default ${DEFAULT_DB_QUERY_LIMIT}, max ${MAX_DB_QUERY_LIMIT}.`,
            },
          },
          required: ['query'],
        },
      },
      handler: async (args) => {
        const sql = args.query as string;
        const limit = Math.min(
          Math.max((args.limit as number) || DEFAULT_DB_QUERY_LIMIT, 1),
          MAX_DB_QUERY_LIMIT
        );

        try {
          validateReadOnlyQuery(sql);

          const db = getDb();
          const rows = db.rawQuery(sql);
          const truncated = rows.slice(0, limit);

          // Deserialize JSON string fields for readability
          const results = truncated.map((row) => {
            if (typeof row !== 'object' || row === null) return row;
            const obj = row as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(obj)) {
              if (typeof value === 'string') {
                try {
                  const parsed = JSON.parse(value);
                  if (typeof parsed === 'object') {
                    out[key] = parsed;
                    continue;
                  }
                } catch { /* not JSON, use as-is */ }
              }
              out[key] = value;
            }
            return out;
          });

          return textResult(
            `${results.length} rows${rows.length > limit ? ` (truncated from ${rows.length})` : ''}:\n\n${JSON.stringify(results, null, 2)}`
          );
        } catch (err) {
          return errorResult(`Query failed: ${err}`);
        }
      },
    },

    // ── list_conversations ──────────────────────────────────────────────
    {
      definition: {
        name: 'list_conversations',
        description:
          'List conversations with id, title, timestamps, and message count.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max conversations to return. Default 20, max 50.',
            },
          },
        },
      },
      handler: async (args) => {
        try {
          const db = getDb();
          const limit = Math.min(Math.max((args.limit as number) || 20, 1), 50);
          const conversations = db.conversations.findAll({ limit });

          const results = conversations.map((c) => ({
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            messageCount: db.messages.countByConversationId(c.id),
          }));

          return textResult(
            `${results.length} conversations:\n\n${JSON.stringify(results, null, 2)}`
          );
        } catch (err) {
          return errorResult(`Failed to list conversations: ${err}`);
        }
      },
    },

    // ── list_messages ───────────────────────────────────────────────────
    {
      definition: {
        name: 'list_messages',
        description:
          'Get paginated messages for a conversation. Returns messages in chronological order with metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            conversation_id: {
              type: 'string',
              description: 'The conversation ID to get messages for.',
            },
            limit: {
              type: 'number',
              description: 'Max messages to return. Default 20, max 100.',
            },
            before: {
              type: 'string',
              description: 'Pagination cursor — get messages older than this cursor.',
            },
            after: {
              type: 'string',
              description: 'Pagination cursor — get messages newer than this cursor.',
            },
          },
          required: ['conversation_id'],
        },
      },
      handler: async (args) => {
        try {
          const db = getDb();
          const conversationId = args.conversation_id as string;
          const limit = Math.min(Math.max((args.limit as number) || 20, 1), 100);

          const result = db.messages.findByConversationIdPaginated(conversationId, {
            limit,
            before: args.before as string | undefined,
            after: args.after as string | undefined,
            includeTotal: true,
          });

          const messages = result.items.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content,
            createdAt: m.createdAt,
            metadata: {
              type: m.metadata?.type,
              agentName: m.metadata?.agentName,
              toolName: m.metadata?.toolName,
              success: m.metadata?.success,
            },
          }));

          return textResult(JSON.stringify({
            messages,
            pagination: result.pagination,
          }, null, 2));
        } catch (err) {
          return errorResult(`Failed to list messages: ${err}`);
        }
      },
    },
  ];
}
