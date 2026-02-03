/**
 * Citation Service
 *
 * Central service for managing citations in tool outputs and responses.
 * Handles extraction, formatting, and parsing of citation data.
 */

import type {
  CitationSource,
  CitationReference,
  CitationContext,
  CitationExtractor,
  StoredCitationData,
} from './types.js';
import type { ToolResult } from '../tools/types.js';

export class CitationService {
  private extractors: CitationExtractor[] = [];
  private currentSources: Map<string, CitationSource[]> = new Map();

  /**
   * Register a citation extractor for a tool pattern
   */
  registerExtractor(extractor: CitationExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Get all registered extractors
   */
  getExtractors(): CitationExtractor[] {
    return [...this.extractors];
  }

  /**
   * Check if a tool name matches an extractor pattern
   */
  private matchesPattern(
    toolName: string,
    pattern: string | RegExp
  ): boolean {
    if (typeof pattern === 'string') {
      return new RegExp(`^${pattern}$`).test(toolName);
    }
    return pattern.test(toolName);
  }

  /**
   * Extract citation sources from a single tool result
   */
  extractFromResult(result: ToolResult): CitationSource[] {
    if (!result.success || result.output === undefined) {
      return [];
    }

    for (const extractor of this.extractors) {
      if (this.matchesPattern(result.toolName, extractor.pattern)) {
        try {
          return extractor.extract(
            result.requestId,
            result.toolName,
            {}, // Parameters would need to be passed separately
            result.output
          );
        } catch (error) {
          console.error(
            `Citation extraction failed for ${result.toolName}:`,
            error
          );
          return [];
        }
      }
    }

    return [];
  }

  /**
   * Extract citation sources from multiple tool results
   */
  extractSources(results: ToolResult[]): CitationSource[] {
    const sources: CitationSource[] = [];

    for (const result of results) {
      const extracted = this.extractFromResult(result);
      sources.push(...extracted);
    }

    return sources;
  }

  /**
   * Store sources for a conversation turn (to be used when formatting prompts)
   */
  setSourcesForTurn(turnId: string, sources: CitationSource[]): void {
    this.currentSources.set(turnId, sources);
  }

  /**
   * Get sources for a conversation turn
   */
  getSourcesForTurn(turnId: string): CitationSource[] {
    return this.currentSources.get(turnId) || [];
  }

  /**
   * Clear sources for a conversation turn
   */
  clearSourcesForTurn(turnId: string): void {
    this.currentSources.delete(turnId);
  }

  /**
   * Format sources for LLM system prompt
   * Creates a numbered list of available sources the LLM can cite
   */
  formatSourcesForPrompt(sources: CitationSource[]): string {
    if (sources.length === 0) {
      return '';
    }

    const lines = sources.map((source, index) => {
      const num = index + 1;
      const domain = source.domain || 'local';
      const title = source.title || source.uri || 'Unknown';
      const snippetText = source.snippet
        ? ` - "${source.snippet.slice(0, 100)}${source.snippet.length > 100 ? '...' : ''}"`
        : '';
      const pageInfo = source.pageNumber ? ` (page ${source.pageNumber})` : '';

      return `[${num}] ${domain}: ${title}${pageInfo}${snippetText}`;
    });

    return `\n### Available Sources\n${lines.join('\n')}`;
  }

  /**
   * Get citation guidelines to inject into system prompt
   */
  getCitationGuidelines(): string {
    return `
## Citation Guidelines

When you use information from tool outputs, you MUST cite your sources using inline references.

### Citation Format
- Use bracketed numbers: [1], [2], [3]
- Place citations immediately after the claim they support
- Multiple sources for one claim: [1][2] or [1, 2]
- Don't cite common knowledge or your own analysis

### Examples
- "React 19 introduces the Actions API [1]"
- "Performance improved by 40% [2][3]"
- "This approach is widely recommended [1, 4, 5]"

### Important
- Only cite sources that directly support your claims
- If no source supports a claim, state it's your analysis
- Don't fabricate or hallucinate source numbers
`;
  }

  /**
   * Parse citation references from response text
   * Finds [1], [2, 3], [1][2] patterns and maps them to sources
   */
  parseReferences(
    text: string,
    sources: CitationSource[]
  ): CitationReference[] {
    const references: CitationReference[] = [];

    // Match patterns like [1], [2, 3], [1][2]
    const citationPattern = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
    let match;
    let refCount = 0;

    while ((match = citationPattern.exec(text)) !== null) {
      const indices = match[1].split(',').map((n) => parseInt(n.trim(), 10));
      const sourceIds = indices
        .filter((i) => i > 0 && i <= sources.length)
        .map((i) => sources[i - 1].id);

      if (sourceIds.length > 0) {
        references.push({
          id: `ref-${refCount}`,
          index: refCount + 1,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
          citedText: match[0],
          sourceIds,
        });
        refCount++;
      }
    }

    return references;
  }

  /**
   * Build complete citation context for a response
   */
  buildContext(
    messageId: string,
    response: string,
    sources: CitationSource[],
    modelUsed?: string
  ): CitationContext {
    const references = this.parseReferences(response, sources);

    return {
      messageId,
      sources,
      references,
      generatedAt: new Date().toISOString(),
      modelUsed,
    };
  }

  /**
   * Convert citation context to storage format
   */
  toStoredFormat(context: CitationContext): StoredCitationData {
    return {
      sources: context.sources.map((s) => ({
        id: s.id,
        type: s.type,
        toolName: s.toolName,
        uri: s.uri,
        title: s.title,
        domain: s.domain,
        snippet: s.snippet,
        pageNumber: s.pageNumber,
      })),
      references: context.references.map((r) => ({
        index: r.index,
        startIndex: r.startIndex,
        endIndex: r.endIndex,
        sourceIds: r.sourceIds,
      })),
    };
  }

  /**
   * Get the number of unique sources actually cited in references
   */
  getUsedSourceCount(context: CitationContext): number {
    const usedIds = new Set<string>();
    for (const ref of context.references) {
      for (const id of ref.sourceIds) {
        usedIds.add(id);
      }
    }
    return usedIds.size;
  }

  /**
   * Get sources that were actually cited in the response
   */
  getUsedSources(context: CitationContext): CitationSource[] {
    const usedIds = new Set<string>();
    for (const ref of context.references) {
      for (const id of ref.sourceIds) {
        usedIds.add(id);
      }
    }
    return context.sources.filter((s) => usedIds.has(s.id));
  }
}

// Singleton instance
let citationServiceInstance: CitationService | null = null;

/**
 * Get the citation service singleton
 * Automatically initializes with default extractors on first call
 */
export function getCitationService(): CitationService {
  if (!citationServiceInstance) {
    citationServiceInstance = new CitationService();
  }
  return citationServiceInstance;
}

/**
 * Initialize the citation service with default extractors
 * Call this during application startup
 */
export async function initializeCitationService(): Promise<CitationService> {
  const service = getCitationService();

  // Only register if no extractors yet
  if (service.getExtractors().length === 0) {
    const { getDefaultExtractors } = await import('./extractors.js');
    const extractors = getDefaultExtractors();
    for (const extractor of extractors) {
      service.registerExtractor(extractor);
    }
    console.log(`[CitationService] Initialized with ${extractors.length} extractors`);
  }

  return service;
}

/**
 * Synchronously initialize the citation service with default extractors
 */
export function initializeCitationServiceSync(extractors: CitationExtractor[]): CitationService {
  const service = getCitationService();

  if (service.getExtractors().length === 0) {
    for (const extractor of extractors) {
      service.registerExtractor(extractor);
    }
    console.log(`[CitationService] Initialized with ${extractors.length} extractors`);
  }

  return service;
}

export function resetCitationService(): void {
  citationServiceInstance = null;
}
