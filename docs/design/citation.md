# Citation System Design

## Overview

The citation system tracks and displays sources of information used by agents when processing tool outputs. It enables agents to cite their sources in responses (e.g., `[1]`, `[2]`) and provides users with clickable references to verify information provenance.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Agent Execution                             │
│                                                                       │
│  ┌────────────┐    ┌─────────────────┐    ┌─────────────────────┐    │
│  │ Tool Call  │───▶│   ToolRunner    │───▶│ executeToolsWith-   │    │
│  │ (web_search│    │                 │    │ Citations()         │    │
│  │  etc.)     │    │                 │    │                     │    │
│  └────────────┘    └─────────────────┘    └─────────────────────┘    │
│                                                    │                  │
│                                                    ▼                  │
│                           ┌─────────────────────────────────────┐    │
│                           │         CitationService             │    │
│                           │  ┌─────────────────────────────┐    │    │
│                           │  │   Registered Extractors     │    │    │
│                           │  │  - webSearchExtractor       │    │    │
│                           │  │  - webScrapeExtractor       │    │    │
│                           │  │  - ragQueryExtractor        │    │    │
│                           │  │  - wikipediaSearchExtractor │    │    │
│                           │  │  - httpClientExtractor      │    │    │
│                           │  │  - mcpToolExtractor         │    │    │
│                           │  └─────────────────────────────┘    │    │
│                           └─────────────────────────────────────┘    │
│                                           │                          │
│                                           ▼                          │
│                           ┌─────────────────────────────────────┐    │
│                           │       CitationSource[]              │    │
│                           │  (extracted from tool outputs)      │    │
│                           └─────────────────────────────────────┘    │
│                                           │                          │
│                                           ▼                          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Agent (Worker/Supervisor)                   │  │
│  │                                                                │  │
│  │  1. Collects CitationSources during agentic loop              │  │
│  │  2. Aggregates sub-agent citations (worker only)              │  │
│  │  3. Calls buildCitationData() to parse [n] references         │  │
│  │  4. Calls endStreamWithCitations() to send to frontend        │  │
│  │  5. Saves citations in message metadata                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                           │                          │
└───────────────────────────────────────────│──────────────────────────┘
                                            │
                                            ▼
                            ┌─────────────────────────────────────┐
                            │              Frontend               │
                            │                                     │
                            │  - Displays [n] inline citations    │
                            │  - Shows source panel with links    │
                            │  - Tooltips on hover                │
                            └─────────────────────────────────────┘
```

## Data Flow

### 1. Tool Execution Phase

When an agent executes tools, it uses `executeToolsWithCitations()` instead of plain `executeTools()`:

```typescript
const { results, citations } = await this.toolRunner!.executeToolsWithCitations(toolRequests);
```

This method:
1. Executes all requested tools
2. Passes successful tool results through registered extractors
3. Returns both tool results and extracted citation sources

### 2. Citation Extraction Phase

The `CitationService` maintains a registry of extractors. Each extractor:
- Has a `pattern` (string or RegExp) that matches tool names
- Has an `extract()` function that converts tool output to `CitationSource[]`

Example extractor flow:
```
Tool: web_search
Output: { results: [{ title: "React 19", link: "...", snippet: "..." }, ...] }
                    │
                    ▼
          webSearchExtractor.extract()
                    │
                    ▼
CitationSource[]: [
  { id: "req-1-0", type: "web", uri: "https://...", title: "React 19", domain: "react.dev", ... },
  { id: "req-1-1", type: "web", uri: "https://...", title: "...", ... }
]
```

### 3. Source Collection Phase

During the agentic loop, agents accumulate citation sources:

```typescript
const collectedSources: CitationSource[] = [];

// After each tool execution
if (citations.length > 0) {
  collectedSources.push(...citations);
}
```

For worker agents with sub-agents, citations are also aggregated from delegated tasks:

```typescript
// Worker receives TASK_COMPLETE from sub-agent
if (payload.citations?.sources) {
  this.subAgentCitations.push(...payload.citations.sources.map(src => ({
    ...src,
    subAgentId: comm.fromAgent
  })));
}

// Before building final response
if (this.subAgentCitations.length > 0) {
  collectedSources.push(...convertedCitations);
}
```

### 4. Response Parsing Phase

After the agent completes its response, `buildCitationData()` parses inline references:

```typescript
const citationData = this.buildCitationData(streamId, fullResponse, collectedSources);
```

This method:
1. Uses regex to find `[1]`, `[2, 3]`, `[1][2]` patterns in response text
2. Maps each reference to corresponding sources by index
3. Returns a `StoredCitationData` structure with sources and references

### 5. Delivery Phase

Citations are delivered to the frontend via:

```typescript
this.endStreamWithCitations(channel, streamId, conversationId, citationData);
```

And persisted with the message:

```typescript
if (citations && citations.sources.length > 0) {
  metadata.citations = citations;
}
```

## Core Types

### CitationSource

Represents a single citable source extracted from tool output:

```typescript
interface CitationSource {
  id: string;                    // Unique identifier (requestId-index)
  type: CitationSourceType;      // 'web' | 'file' | 'api' | 'database' | 'memory' | 'skill' | 'mcp'
  toolName: string;              // Tool that produced this source
  toolRequestId: string;         // Request ID for traceability

  // Source identification
  uri?: string;                  // URL or file path
  title?: string;                // Page title or filename
  domain?: string;               // e.g., "example.com"
  favicon?: string;              // Favicon URL for web sources

  // Content
  snippet?: string;              // Brief excerpt (for previews)
  fullContent?: string;          // Complete content (for RAG)

  // Metadata
  timestamp?: string;            // When source was accessed
  author?: string;               // Content author if known
  publishedDate?: string;        // Publication date if known

  // Location within document
  pageNumber?: number;           // For PDF sources
  lineStart?: number;            // For text files
  lineEnd?: number;
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
  citedText: string;             // The [n] text itself
  sourceIds: string[];           // IDs of cited sources
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

## LLM Integration

The citation system provides guidelines to inject into agent system prompts:

```typescript
getCitationGuidelines(): string {
  // Returns markdown with:
  // - Citation format rules ([1], [2, 3], etc.)
  // - Examples of proper citation usage
  // - Instructions to only cite supporting sources
}

formatSourcesForPrompt(sources: CitationSource[]): string {
  // Returns numbered list:
  // [1] example.com: Page Title - "snippet preview..."
  // [2] file.pdf: Document (page 5) - "content..."
}
```

## Configuration

```typescript
interface CitationConfig {
  enabled: boolean;                    // Enable/disable citations
  format: 'brackets' | 'superscript' | 'inline-links';
  expandSourcesByDefault: boolean;     // Show source panel by default
  maxSourcesDisplayed: number;         // Max sources in panel
  enabledTools: string[];              // Glob patterns for enabled tools
  enableTooltips: boolean;             // Show hover tooltips
}
```

## Extension Points

### Adding a New Extractor

1. Create extractor implementing `CitationExtractor` interface:

```typescript
const myToolExtractor: CitationExtractor = {
  pattern: /^my_tool$/,
  extract(requestId, toolName, parameters, output): CitationSource[] {
    // Parse output and return citation sources
  }
};
```

2. Register with service:

```typescript
citationService.registerExtractor(myToolExtractor);
```

3. Or add to default extractors in `extractors.ts`:

```typescript
export function getDefaultExtractors(): CitationExtractor[] {
  return [
    // ... existing extractors
    myToolExtractor,
  ];
}
```

## Multi-Agent Citation Aggregation

When workers delegate to sub-agents:

1. Sub-agent completes task with its own citations
2. Sub-agent sends `TASK_COMPLETE` with `citations` in payload
3. Parent worker collects citations in `subAgentCitations` array
4. Before building final response, parent merges sub-agent citations
5. Final response includes all cited sources from entire execution tree

This enables proper attribution even when information flows through multiple agent hops.
