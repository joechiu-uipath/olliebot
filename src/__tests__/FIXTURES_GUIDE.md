# Test Fixtures - Complete Guide

This document provides an overview of all test fixtures available across the codebase to help developers write maintainable, DRY tests.

## Test Helpers (Global)

Location: `/src/test-helpers/`

### Builders (`builders.ts`)
- `buildToolResult()` - Create ToolResult with timing fields
- `buildSingleRunResult()` - Evaluation test results
- `buildLogEntry()` - Log buffer entries
- `buildCitationSource()` - Citation sources
- `buildWebSearchResult()` - Web search result objects
- `buildRagQueryResult()` - RAG query result objects
- `buildToolCall()` - Tool call records
- `repeatString()` - Generate repeated strings for truncation tests
- `buildDataUrl()` - Generate data URLs
- `buildBase64String()` - Generate base64-like strings

### Constants (`constants.ts`)
- Snippet/content truncation limits
- Buffer and collection limits
- Data size thresholds
- Test timing constants
- Statistical test constants
- Test identifier prefixes
- Common test strings

### Utilities (`utils.ts`)
- `testPattern()` - Test string/RegExp patterns
- `getPrivateMethod()` - Access private methods for testing
- `expectInRange()` - Range assertions
- `sleep()` - Async delays
- `createMockFunction()` - Mock function tracker
- `mockEnv()` - Mock environment variables
- `createIdGenerator()` - Sequential ID generator

## Module-Specific Fixtures

### ToolRunner Tests (`/src/tools/__tests__/`)

**Fixtures:**
- `createMockTool()` - Basic mock tool
- `createSlowMockTool()` - Tool with execution delay
- `createFailingMockTool()` - Tool that throws error
- `createErrorResultMockTool()` - Tool that returns error
- `createFileReturningMockTool()` - Tool that returns files
- `createDisplayOnlyMockTool()` - Tool with display-only output
- `createMockMcpClient()` - Mock MCP client
- `createMockContext()` - Tool execution context

**Constants:**
- `SLOW_TOOL_DELAY_MS` - Delay for slow tool execution (10ms)
- `TOOL_EXECUTION_DURATION_MS` - Standard duration (2000ms)
- `QUICK_TOOL_DURATION_MS` - Quick execution duration (500ms)
- `SCREENSHOT_FILE_SIZE_BYTES` - File size for screenshots (1024)
- `LARGE_RESULT_SIZE_CHARS` - Large result size (20000)
- `TRUNCATION_THRESHOLD_CHARS` - Truncation limit (15000)
- `MOCK_TOOL_NAMES` - Object with standardized tool names

### AgentRegistry Tests (`/src/agents/__tests__/`)

**Fixtures:**
- `createMockAgent()` - Create mock agent with identity/state/capabilities
- `SAMPLE_SKILL_IDS` - Array of sample skill IDs for filtering tests
- `createMockCommunication()` - Inter-agent communication payloads

### SkillParser Tests (`/src/skills/__tests__/`)

**Fixtures:**
- `BASIC_SKILL_MD` - Basic skill with required frontmatter
- `COMPREHENSIVE_SKILL_MD` - Skill with all frontmatter fields
- `ANONYMOUS_SKILL_MD` - Skill with no ID or name
- `CRLF_SKILL_MD` - Skill with Windows-style line endings
- `QUOTED_SKILL_MD` - Skill with quoted values
- `EMPTY_VALUE_SKILL_MD` - Skill with empty description
- `NO_FRONTMATTER` - Content without frontmatter
- `TOOL_RESTRICTED_SKILL_MD` - Skill with allowed-tools
- `MOCK_FS_RESPONSES` - Mock filesystem responses

### CitationGenerator Tests (`/src/citations/__tests__/`)

**Fixtures:**
- `SHORT_RESPONSE` - Response too short for citation
- `CODE_HEAVY_RESPONSE` - Response with >80% code blocks
- `MODERATE_CODE_RESPONSE` - Response with <80% code
- `STANDARD_RESPONSE` - Standard citable response
- `LONG_RESPONSE` - Long response for testing
- `createSampleSource()` - Create sample citation source
- Mock LLM responses (JSON, with fence, empty, invalid, etc.)
- `CITATION_THRESHOLDS` - Min response length and max code ratio

### MessageEventService Tests (`/src/services/__tests__/`)

**Fixtures:**
- `STANDARD_AGENT_INFO` - Standard agent info object
- `createBaseToolEvent()` - Base tool event with common fields
- `createAudioToolEvent()` - Tool event with audio result
- `createNestedAudioToolEvent()` - Tool event with nested audio
- `createLargeResultToolEvent()` - Tool event with large result
- `createMediaToolEvent()` - Tool event with media content
- `createProgressToolEvent()` - Progress event
- Standard data objects (delegation, task, error)
- `TEST_CONSTANTS` - IDs, size limits

## Best Practices

1. **Use fixtures for repeated patterns**: If a mock appears in 2+ tests, extract it
2. **Use constants for all magic numbers**: Replace raw numbers with named constants
3. **Use constants for hardcoded strings**: Use named constants for IDs and strings
4. **Keep fixtures simple**: Each fixture should do one thing well
5. **Document complex fixtures**: Add JSDoc comments for non-obvious behavior
6. **Prefer specific over generic**: Specific fixtures are more maintainable
7. **Co-locate fixtures**: Keep fixtures in `__tests__/` subdirectories

## Usage Example

```typescript
import { createMockTool } from './__tests__/fixtures.js';
import { MOCK_TOOL_NAMES } from './__tests__/constants.js';

const mockTool = createMockTool(MOCK_TOOL_NAMES.BASIC);
runner.registerNativeTool(mockTool);
```
