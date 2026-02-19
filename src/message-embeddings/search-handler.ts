/**
 * Message Search Handler
 *
 * Handles message search requests with support for FTS, semantic, and hybrid modes.
 * Extracted from server/index.ts to improve code organization and testability.
 */

import type { Context } from 'hono';
import { getDb } from '../db/index.js';
import type { MessageEmbeddingService } from './service.js';
import type { MessageSearchResult, MessageSearchResultSource } from './types.js';
import { fuseResults, type StrategySearchResult } from '../rag-projects/fusion.js';
import { createSnippet } from './utils.js';
import {
  MESSAGE_SEARCH_OVERFETCH_MULTIPLIER,
  MESSAGE_SEARCH_FTS_WEIGHT,
  MESSAGE_SEARCH_SEMANTIC_WEIGHT,
  MESSAGE_SEARCH_SNIPPET_LENGTH,
  MESSAGE_DEFAULT_INDEXABLE_ROLES,
} from '../constants.js';

export type SearchMode = 'fts' | 'semantic' | 'hybrid';

export interface SearchParams {
  query: string;
  limit: number;
  before?: string;
  includeTotal: boolean;
  mode: SearchMode;
}

interface SearchResponse {
  items: MessageSearchResult[];
  pagination: {
    hasOlder: boolean;
    hasNewer: boolean;
    oldestCursor: string | null;
    newestCursor: string | null;
  };
}

/**
 * Empty search response with pagination info
 */
function emptyResponse(): SearchResponse {
  return {
    items: [],
    pagination: { hasOlder: false, hasNewer: false, oldestCursor: null, newestCursor: null },
  };
}

/**
 * Convert FTS database result to MessageSearchResult format
 */
function mapFtsResult(m: {
  id: string;
  conversationId: string;
  conversationTitle: string;
  role: string;
  snippet: string;
  createdAt: string;
  rank: number;
}): MessageSearchResult {
  return {
    messageId: m.id,
    conversationId: m.conversationId,
    conversationTitle: m.conversationTitle,
    role: m.role,
    text: m.snippet,
    snippet: m.snippet,
    createdAt: m.createdAt,
    score: m.rank,
    sources: [{ source: 'fts', score: m.rank }],
  };
}

/**
 * Handle FTS-only search mode
 */
function handleFtsSearch(params: SearchParams): SearchResponse {
  const db = getDb();
  const result = db.messages.search(params.query, {
    limit: params.limit,
    before: params.before || undefined,
    roles: [...MESSAGE_DEFAULT_INDEXABLE_ROLES],
    includeTotal: params.includeTotal,
  });

  return {
    items: result.items.map(mapFtsResult),
    pagination: result.pagination,
  };
}

/**
 * Handle semantic-only search mode
 */
async function handleSemanticSearch(
  params: SearchParams,
  embeddingService: MessageEmbeddingService
): Promise<SearchResponse> {
  const results = await embeddingService.search(params.query, params.limit);
  return {
    items: results,
    pagination: { hasOlder: false, hasNewer: false, oldestCursor: null, newestCursor: null },
  };
}

/**
 * Handle hybrid search mode (FTS + semantic fusion)
 */
async function handleHybridSearch(
  params: SearchParams,
  embeddingService: MessageEmbeddingService
): Promise<SearchResponse> {
  const db = getDb();
  const overFetchLimit = params.limit * MESSAGE_SEARCH_OVERFETCH_MULTIPLIER;

  // Run FTS and semantic search in parallel
  const [ftsResult, semanticResults] = await Promise.all([
    Promise.resolve(
      db.messages.search(params.query, {
        limit: overFetchLimit,
        roles: [...MESSAGE_DEFAULT_INDEXABLE_ROLES],
      })
    ),
    embeddingService.search(params.query, overFetchLimit),
  ]);

  // Map FTS results to StrategySearchResult format for fusion
  const ftsForFusion: StrategySearchResult = {
    strategyId: 'fts',
    results: ftsResult.items.map((m, idx) => ({
      id: m.id,
      documentPath: m.conversationId,
      text: m.snippet,
      score: 1.0 / (idx + 1), // Normalize BM25 rank to a 0-1 score
      chunkIndex: 0,
      contentType: 'text' as const,
      metadata: {
        conversationId: m.conversationId,
        conversationTitle: m.conversationTitle,
        role: m.role,
        createdAt: m.createdAt,
        snippet: m.snippet,
        ftsRank: m.rank,
      },
    })),
  };

  // Map semantic results to StrategySearchResult format
  const semanticForFusion: StrategySearchResult = {
    strategyId: 'semantic',
    results: semanticResults.map((m) => ({
      id: m.messageId,
      documentPath: m.conversationId,
      text: m.text,
      score: m.score,
      chunkIndex: 0,
      contentType: 'text' as const,
      metadata: {
        conversationId: m.conversationId,
        conversationTitle: m.conversationTitle,
        role: m.role,
        createdAt: m.createdAt,
        snippet: m.snippet,
        semanticSources: m.sources,
      },
    })),
  };

  // Fuse results with configured weights
  const fused = fuseResults(
    [ftsForFusion, semanticForFusion],
    [
      { type: 'fts' as never, weight: MESSAGE_SEARCH_FTS_WEIGHT, enabled: true },
      { type: 'semantic' as never, weight: MESSAGE_SEARCH_SEMANTIC_WEIGHT, enabled: true },
    ],
    'rrf',
    params.limit
  );

  // Build final results with merged sources
  const hybridItems: MessageSearchResult[] = fused.map((r) => {
    const meta = r.metadata as Record<string, unknown>;
    const sources: MessageSearchResultSource[] = [];

    // Collect provenance from each strategy that contributed
    for (const ss of r.strategyScores) {
      if (ss.strategyId === 'fts') {
        sources.push({
          source: 'fts',
          score: (meta?.ftsRank as number) ?? ss.score,
        });
      } else if (ss.strategyId === 'semantic') {
        // Propagate per-strategy semantic sources if available
        const semanticSources = meta?.semanticSources as MessageSearchResultSource[] | undefined;
        if (semanticSources && semanticSources.length > 0) {
          sources.push(...semanticSources);
        } else {
          sources.push({ source: 'semantic', score: ss.score });
        }
      }
    }

    return {
      messageId: r.id,
      conversationId: (meta?.conversationId as string) || r.documentPath,
      conversationTitle: (meta?.conversationTitle as string) || '',
      role: (meta?.role as string) || '',
      text: r.text,
      snippet: (meta?.snippet as string) || createSnippet(r.text, MESSAGE_SEARCH_SNIPPET_LENGTH),
      createdAt: (meta?.createdAt as string) || '',
      score: r.fusedScore,
      sources,
    };
  });

  return {
    items: hybridItems,
    pagination: { hasOlder: false, hasNewer: false, oldestCursor: null, newestCursor: null },
  };
}

/**
 * Main search handler - routes to appropriate search mode
 */
export async function handleMessageSearch(
  c: Context,
  embeddingService: MessageEmbeddingService | null
): Promise<Response> {
  try {
    const query = c.req.query('q') || '';
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '20'), 1), 100);
    const before = c.req.query('before');
    const includeTotal = c.req.query('includeTotal') === 'true';
    const mode = (c.req.query('mode') || 'fts') as SearchMode;

    // Empty query returns empty results
    if (!query.trim()) {
      return c.json(emptyResponse());
    }

    const params: SearchParams = { query, limit, before, includeTotal, mode };

    // FTS-only mode (default, backward compatible)
    if (mode === 'fts') {
      return c.json(handleFtsSearch(params));
    }

    // Semantic-only mode
    if (mode === 'semantic') {
      if (!embeddingService) {
        return c.json(
          { error: 'Semantic search not available (no embedding provider configured)' },
          503
        );
      }
      const response = await handleSemanticSearch(params, embeddingService);
      return c.json(response);
    }

    // Hybrid mode: FTS + semantic fusion
    if (!embeddingService) {
      // Fall back to FTS-only if no embedding service
      return c.json(handleFtsSearch(params));
    }

    const response = await handleHybridSearch(params, embeddingService);
    return c.json(response);
  } catch (error) {
    console.error('[MessageSearch] Search failed:', error);
    return c.json({ error: 'Search failed' }, 500);
  }
}
