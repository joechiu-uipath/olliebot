/**
 * Post-hoc Citation Generator
 *
 * Generates citations by analyzing a completed response against available sources.
 * Uses fast LLM to identify claims and match them to supporting sources.
 */

import type { LLMService } from '../llm/service.js';
import type { CitationSource, CitationReference, StoredCitationData } from './types.js';
import {
  CITATION_SOURCE_SNIPPET_LIMIT,
  CITATION_BATCH_SIZE,
  CITATION_MAX_CONCURRENT_BATCHES,
  CITATION_MIN_RESPONSE_LENGTH,
  CITATION_FALLBACK_SUBSTRING_LENGTH,
  CITATION_CODE_THRESHOLD,
  CITATION_LLM_MAX_TOKENS,
} from '../constants.js';

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
  if (response.length < CITATION_MIN_RESPONSE_LENGTH || isCodeOnly(response)) {
    return {
      references: [],
      usedSources: [],
      allSources: sources,
      processingTimeMs: Date.now() - startTime,
    };
  }

  // Process sources in batches to handle large source sets
  const batches: CitationSource[][] = [];
  for (let i = 0; i < sources.length; i += CITATION_BATCH_SIZE) {
    batches.push(sources.slice(i, i + CITATION_BATCH_SIZE));
  }

  console.log(`[CitationGenerator] Processing ${sources.length} sources in ${batches.length} batch(es)`);

  // Collect all citations from all batches
  const allCitations: Array<{ claim: string; sourceIndex: number; confidence: string; batchIndex: number }> = [];

  // Process batches in parallel for speed
  for (let batchStart = 0; batchStart < batches.length; batchStart += CITATION_MAX_CONCURRENT_BATCHES) {
    const batchPromises = batches
      .slice(batchStart, batchStart + CITATION_MAX_CONCURRENT_BATCHES)
      .map(async (batch, localIdx) => {
        const batchIndex = batchStart + localIdx;
        const globalOffset = batchIndex * CITATION_BATCH_SIZE;

        try {
          const citations = await processBatch(llmService, response, batch, batchIndex, globalOffset);
          return citations;
        } catch (error) {
          console.warn(`[CitationGenerator] Batch ${batchIndex + 1} failed:`, error);
          return [];
        }
      });

    const batchResults = await Promise.all(batchPromises);
    for (const citations of batchResults) {
      allCitations.push(...citations);
    }
  }

  // Convert to CitationReference format
  const references: CitationReference[] = [];
  const usedSourceIds = new Set<string>();

  for (const citation of allCitations) {
    // Skip low confidence citations
    if (citation.confidence === 'none') continue;

    // Validate source index (already global from batch processing)
    const sourceIdx = citation.sourceIndex;
    if (sourceIdx < 0 || sourceIdx >= sources.length) continue;

    // Find the claim in the response
    const claimText = citation.claim;
    let startIndex = response.indexOf(claimText);

    // If exact match fails, try case-insensitive match
    if (startIndex === -1) {
      const lowerResponse = response.toLowerCase();
      const lowerClaim = claimText.toLowerCase();
      startIndex = lowerResponse.indexOf(lowerClaim);
    }

    // If still no match, try finding a significant substring
    if (startIndex === -1 && claimText.length > CITATION_FALLBACK_SUBSTRING_LENGTH) {
      const subClaim = claimText.slice(0, CITATION_FALLBACK_SUBSTRING_LENGTH);
      startIndex = response.indexOf(subClaim);
      if (startIndex === -1) {
        const lowerSubClaim = subClaim.toLowerCase();
        startIndex = response.toLowerCase().indexOf(lowerSubClaim);
      }
    }

    if (startIndex === -1) continue;

    // Skip if we already have a citation for this exact text position
    const existingRef = references.find(r => r.startIndex === startIndex && r.endIndex === startIndex + claimText.length);
    if (existingRef) continue;

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
}

/**
 * Process a single batch of sources for citation matching
 */
async function processBatch(
  llmService: LLMService,
  response: string,
  batch: CitationSource[],
  batchIndex: number,
  globalOffset: number
): Promise<Array<{ claim: string; sourceIndex: number; confidence: string; batchIndex: number }>> {
  // Format sources for the LLM
  const sourcesText = batch
    .map((source, index) => {
      const num = index + 1; // 1-based for LLM
      const title = source.title || source.uri || 'Unknown';
      const snippet = source.snippet
        ? `\n   Content: "${source.snippet.slice(0, CITATION_SOURCE_SNIPPET_LIMIT)}${source.snippet.length > CITATION_SOURCE_SNIPPET_LIMIT ? '...' : ''}"`
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
      "claim": "EXACT verbatim text copied from response",
      "sourceIndex": 1,
      "confidence": "full"
    }
  ]
}

If no claims can be attributed to sources, return: {"citations": []}`;

  const llmResponse = await llmService.quickGenerate(
    [{ role: 'user', content: prompt }],
    {
      maxTokens: CITATION_LLM_MAX_TOKENS,
      temperature: 0,
    },
    'Citations Generator'
  );

  // Parse LLM response
  const parsed = parseJsonResponse(llmResponse.content);
  if (!parsed || !Array.isArray(parsed.citations)) {
    console.warn(`[CitationGenerator] Batch ${batchIndex + 1} failed to parse`);
    return [];
  }

  // Convert local indices to global indices
  const citations = parsed.citations.map(c => ({
    claim: c.claim,
    sourceIndex: (c.sourceIndex - 1) + globalOffset, // Convert to 0-based global index
    confidence: c.confidence,
    batchIndex,
  }));

  console.log(`[CitationGenerator] Batch ${batchIndex + 1}: found ${citations.length} citation(s)`);
  return citations;
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

  // If more than threshold is code, skip citation
  return codeLength > text.length * CITATION_CODE_THRESHOLD;
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

  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (parseError) {
    // Try to extract JSON from the content
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // JSON is malformed, give up
      }
    }
    console.warn('[CitationGenerator] Parse error:', (parseError as Error).message?.slice(0, 100));
    return null;
  }
}

