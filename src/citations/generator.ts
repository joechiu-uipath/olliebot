/**
 * Post-hoc Citation Generator
 *
 * Generates citations by analyzing a completed response against available sources.
 * Uses fast LLM to identify claims and match them to supporting sources.
 */

import type { LLMService } from '../llm/service.js';
import type { CitationSource, CitationReference, StoredCitationData } from './types.js';

/**
 * Result of post-hoc citation generation
 */
export interface PostHocCitationResult {
  /** References linking response text to sources */
  references: CitationReference[];
  /** Sources that were actually cited */
  usedSources: CitationSource[];
  /** All available sources */
  allSources: CitationSource[];
  /** Processing time in ms */
  processingTimeMs: number;
}

/**
 * LLM response format for citation generation
 */
interface LLMCitationResponse {
  citations: Array<{
    /** The exact text from the response being cited */
    claim: string;
    /** 1-based index of the source that supports this claim */
    sourceIndex: number;
    /** Confidence: "full" (directly supports), "partial" (related), "none" */
    confidence: 'full' | 'partial' | 'none';
  }>;
}

/**
 * Generate citations for a response using post-hoc analysis
 *
 * @param llmService - LLM service for generating citations
 * @param response - The completed response text
 * @param sources - Available citation sources from tool outputs
 * @returns Citation data with references and used sources
 */
export async function generatePostHocCitations(
  llmService: LLMService,
  response: string,
  sources: CitationSource[]
): Promise<PostHocCitationResult> {
  const startTime = Date.now();

  // No sources = no citations
  if (sources.length === 0) {
    return {
      references: [],
      usedSources: [],
      allSources: [],
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Skip citation for very short responses or code-only responses
  if (response.length < 50 || isCodeOnly(response)) {
    return {
      references: [],
      usedSources: [],
      allSources: sources,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Format sources for the LLM
  const sourcesText = sources
    .map((source, index) => {
      const num = index + 1;
      const title = source.title || source.uri || 'Unknown';
      const snippet = source.snippet
        ? `\n   Content: "${source.snippet.slice(0, 300)}${source.snippet.length > 300 ? '...' : ''}"`
        : '';
      return `[${num}] ${title}${snippet}`;
    })
    .join('\n\n');

  const prompt = `Analyze the following response and identify which claims are supported by which sources.

## Available Sources
${sourcesText}

## Response to Analyze
${response}

## Instructions
1. Identify factual claims in the response (skip opinions, code blocks, greetings)
2. For each claim, find the source that best supports it
3. Only cite when a source DIRECTLY supports the claim
4. Return JSON array of citations

## Output Format (JSON only, no markdown)
{
  "citations": [
    {
      "claim": "exact text from response",
      "sourceIndex": 1,
      "confidence": "full"
    }
  ]
}

If no claims can be attributed to sources, return: {"citations": []}`;

  try {
    const llmResponse = await llmService.quickGenerate(
      [{ role: 'user', content: prompt }],
      {
        maxTokens: 2000,
        temperature: 0,
      }
    );

    // Parse LLM response
    const parsed = parseJsonResponse(llmResponse.content);
    if (!parsed || !Array.isArray(parsed.citations)) {
      console.warn('[CitationGenerator] Failed to parse LLM response');
      return {
        references: [],
        usedSources: [],
        allSources: sources,
        processingTimeMs: Date.now() - startTime,
      };
    }

    // Convert to CitationReference format
    const references: CitationReference[] = [];
    const usedSourceIds = new Set<string>();

    for (const citation of parsed.citations) {
      // Skip low confidence citations
      if (citation.confidence === 'none') continue;

      // Validate source index
      const sourceIdx = citation.sourceIndex - 1;
      if (sourceIdx < 0 || sourceIdx >= sources.length) continue;

      // Find the claim in the response
      const claimText = citation.claim;
      const startIndex = response.indexOf(claimText);
      if (startIndex === -1) continue;

      const source = sources[sourceIdx];
      usedSourceIds.add(source.id);

      references.push({
        id: `ref-${references.length}`,
        index: references.length + 1,
        startIndex,
        endIndex: startIndex + claimText.length,
        citedText: claimText,
        sourceIds: [source.id],
      });
    }

    const usedSources = sources.filter((s) => usedSourceIds.has(s.id));
    const processingTimeMs = Date.now() - startTime;

    console.log(
      `[CitationGenerator] Generated ${references.length} citation(s) from ${usedSources.length} source(s) in ${processingTimeMs}ms`
    );

    return {
      references,
      usedSources,
      allSources: sources,
      processingTimeMs,
    };
  } catch (error) {
    console.error('[CitationGenerator] Error generating citations:', error);
    return {
      references: [],
      usedSources: [],
      allSources: sources,
      processingTimeMs: Date.now() - startTime,
    };
  }
}

/**
 * Convert PostHocCitationResult to StoredCitationData format
 */
export function toStoredCitationData(
  result: PostHocCitationResult
): StoredCitationData {
  return {
    sources: result.usedSources.map((s) => ({
      id: s.id,
      type: s.type,
      toolName: s.toolName,
      uri: s.uri,
      title: s.title,
      domain: s.domain,
      snippet: s.snippet,
      pageNumber: s.pageNumber,
      projectId: s.projectId,
    })),
    references: result.references.map((r) => ({
      index: r.index,
      startIndex: r.startIndex,
      endIndex: r.endIndex,
      sourceIds: r.sourceIds,
    })),
  };
}

/**
 * Check if response is primarily code (skip citation for code)
 */
function isCodeOnly(text: string): boolean {
  // Count code block characters
  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = text.match(codeBlockRegex) || [];
  const codeLength = codeBlocks.reduce((sum, block) => sum + block.length, 0);

  // If more than 80% is code, skip citation
  return codeLength > text.length * 0.8;
}

/**
 * Parse JSON from LLM response (handles markdown code blocks)
 */
function parseJsonResponse(content: string): LLMCitationResponse | null {
  let jsonStr = content.trim();

  // Remove markdown code blocks if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }

  try {
    return JSON.parse(jsonStr.trim());
  } catch {
    // Try to extract JSON from the content
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
