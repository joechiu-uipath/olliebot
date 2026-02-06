# Citation System Design

## Overview

The citation system tracks sources of information used by agents and generates citations using **post-hoc analysis**. After an agent completes its response, a fast LLM analyzes the response against available sources to identify claims and their supporting evidence.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      PHASE 1: Response Generation                     │
│                                                                       │
│  Agent generates response WITHOUT citation markers                    │
│  - Clean, uninterrupted content                                       │
│  - Works for all content types (text, code, tables)                  │
│  - Sources collected from tool outputs during execution               │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      PHASE 2: Source Extraction                       │
│                                                                       │
│  During tool execution, CitationExtractors convert tool outputs       │
│  to CitationSource objects:                                           │
│                                                                       │
│  web_search output ──► webSearchExtractor ──► CitationSource[]        │
│  web_scrape output ──► webScrapeExtractor ──► CitationSource[]        │
│  query_rag output  ──► ragQueryExtractor  ──► CitationSource[]        │
│  mcp.* output      ──► mcpToolExtractor   ──► CitationSource[]        │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                   PHASE 3: Post-hoc Citation Generation               │
│                                                                       │
│  generatePostHocCitations(llmService, response, sources)              │
│                                                                       │
│  1. Skip if no sources or response is code-only                       │
│  2. Format sources with index, title, and content snippet             │
│  3. Call fast LLM to identify claims and match to sources             │
│  4. Parse LLM response to extract citation mappings                   │
│  5. Build CitationReference[] with text positions                     │
│                                                                       │
│  Fast LLM Prompt:                                                     │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Analyze the response and identify which claims are supported   │  │
│  │ by which sources. Return JSON:                                 │  │
│  │ {                                                              │  │
│  │   "citations": [                                               │  │
│  │     { "claim": "exact text", "sourceIndex": 1, "confidence": } │  │
│  │   ]                                                            │  │
│  │ }                                                              │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      PHASE 4: Delivery to Frontend                    │
│                                                                       │
│  StoredCitationData {                                                 │
│    sources: [{ id, type, uri, title, domain, snippet }]               │
│    references: [{ index, startIndex, endIndex, sourceIds }]           │
│  }                                                                    │
│                                                                       │
│  Frontend can display citations:                                      │
│  - Inline markers at text positions                                   │
│  - Hover tooltips with source preview                                 │
│  - Source panel/sidebar                                               │
│  - Footnotes at end of response                                       │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. Tool Execution Phase

When an agent executes tools, it uses `executeToolsWithCitations()`:

```typescript
const { results, citations } = await this.toolRunner.executeToolsWithCitations(toolRequests);

// Collect citations from this execution
if (citations.length > 0) {
  collectedSources.push(...citations);
}
```

### 2. Source Extraction Phase

Each extractor converts tool output to `CitationSource[]`:

```typescript
// Example: web_search output
{
  results: [
    { title: "React 19 Release", link: "https://...", snippet: "..." }
  ]
}
// Becomes:
CitationSource {
  id: "req-1-0",
  type: "web",
  uri: "https://...",
  title: "React 19 Release",
  domain: "react.dev",
  snippet: "..."
}
```

### 3. Post-hoc Citation Generation

After response completes, `buildCitationData()` calls the generator:

```typescript
// In base-agent.ts
protected async buildCitationData(
  fullResponse: string,
  collectedSources: CitationSource[]
): Promise<StoredCitationData | undefined> {
  const result = await generatePostHocCitations(
    this.llmService,
    fullResponse,
    collectedSources
  );
  return toStoredCitationData(result);
}
```

### 4. Fast LLM Analysis

The generator formats sources and prompts the fast LLM:

```typescript
const prompt = `Analyze the following response and identify which claims are supported by which sources.

## Available Sources
[1] React Documentation
   Content: "React 19 introduces the new Actions API..."

[2] Performance Benchmark
   Content: "Tests show 40% improvement in render times..."

## Response to Analyze
React 19 brings significant performance improvements and a new Actions API.

## Output Format (JSON only)
{
  "citations": [
    { "claim": "exact text from response", "sourceIndex": 1, "confidence": "full" }
  ]
}`;
```

### 5. Reference Building

LLM response is parsed and converted to references:

```typescript
// LLM returns:
{
  "citations": [
    { "claim": "new Actions API", "sourceIndex": 1, "confidence": "full" },
    { "claim": "significant performance improvements", "sourceIndex": 2, "confidence": "full" }
  ]
}

// Becomes CitationReference[]:
[
  { id: "ref-0", index: 1, startIndex: 45, endIndex: 60, sourceIds: ["req-1-0"] },
  { id: "ref-1", index: 2, startIndex: 15, endIndex: 44, sourceIds: ["req-2-0"] }
]
```

## Core Types

### CitationSource

Represents a citable source extracted from tool output:

```typescript
interface CitationSource {
  id: string;                    // Unique identifier
  type: CitationSourceType;      // 'web' | 'file' | 'api' | 'mcp' | ...
  toolName: string;              // Tool that produced this source
  toolRequestId: string;         // Request ID for traceability
  uri?: string;                  // URL or file path
  title?: string;                // Page title or filename
  domain?: string;               // e.g., "example.com"
  snippet?: string;              // Content excerpt for matching
  fullContent?: string;          // Complete content
  pageNumber?: number;           // For PDF sources
}
```

### CitationReference

Links response text to sources:

```typescript
interface CitationReference {
  id: string;                    // Reference identifier
  index: number;                 // Display index (1, 2, 3...)
  startIndex: number;            // Text span start in response
  endIndex: number;              // Text span end in response
  citedText: string;             // The cited text
  sourceIds: string[];           // IDs of supporting sources
}
```

### StoredCitationData

Compact format for storage/transmission:

```typescript
interface StoredCitationData {
  sources: Array<{
    id: string;
    type: CitationSourceType;
    toolName: string;
    uri?: string;
    title?: string;
    domain?: string;
    snippet?: string;
    pageNumber?: number;
  }>;
  references: Array<{
    index: number;
    startIndex: number;
    endIndex: number;
    sourceIds: string[];
  }>;
}
```

## Default Extractors

| Extractor | Pattern | Source Type | Extracted From |
|-----------|---------|-------------|----------------|
| `webSearchExtractor` | `^web_search$` | web | Search results array |
| `webScrapeExtractor` | `^web_scrape$` | web | Scraped page content |
| `ragQueryExtractor` | `^query_rag_project$` | file | RAG query results |
| `wikipediaSearchExtractor` | `^wikipedia_search$` | web | Wikipedia search results |
| `httpClientExtractor` | `^http_client$` | api | HTTP response body |
| `mcpToolExtractor` | `^mcp\..+__.+$` | mcp | Generic MCP tool outputs |

## Why Post-hoc?

### Advantages over Inline Citation

1. **Clean separation** - Response generation isn't polluted with citation instructions
2. **Works for all content** - Code blocks, tables, structured output all work
3. **Flexibility** - Frontend decides how to display (inline, footnotes, sidebar)
4. **No hallucination** - LLM matches actual text to actual sources
5. **Opt-in** - Can skip for simple queries or when no tools were used

### Trade-offs

1. **Extra latency** - One additional LLM call after response
2. **Token cost** - Fast LLM call adds ~500-2000 tokens
3. **May miss context** - Post-hoc analysis doesn't see generation reasoning

## Extension Points

### Adding a New Extractor

```typescript
const myToolExtractor: CitationExtractor = {
  pattern: /^my_tool$/,
  extract(requestId, toolName, parameters, output): CitationSource[] {
    // Parse output and return citation sources
  }
};

// Register with service
citationService.registerExtractor(myToolExtractor);
```

### Customizing Citation Generation

The generator can be extended to:
- Use NLI models for verification
- Adjust confidence thresholds
- Handle domain-specific citation formats
