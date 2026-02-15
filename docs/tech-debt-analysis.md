# OllieBot Technical Debt Analysis

*Generated: February 2026*

This document catalogs technical debt, improvement opportunities, and architectural considerations for the OllieBot codebase.

---

## Table of Contents

1. [Security Issues](#1-security-issues)
2. [Error Handling & Observability](#2-error-handling--observability)
3. [Type Safety & Code Quality](#3-type-safety--code-quality)
4. [Architectural Issues](#4-architectural-issues)
5. [Performance & Efficiency](#5-performance--efficiency)
6. [Testing & Reliability](#6-testing--reliability)
7. [Dependencies & Packages](#7-dependencies--packages)
8. [Browser/Desktop Automation](#8-browserdesktop-automation)
9. [Frontend Issues](#9-frontend-issues)
10. [Tech Choices Review](#10-tech-choices-review)
11. [Quick Wins](#quick-wins)
12. [Roadmap](#roadmap)

---

## 1. Security Issues

### 1.1 Environment Variable Validation
**Severity: MEDIUM** | **Effort: Low**

- **Location**: `src/index.ts` lines 150-194
- **Issue**: Multiple `process.env` accesses with loose type casting:
  ```typescript
  webSearchProvider: (process.env.WEB_SEARCH_PROVIDER || 'tavily') as WebSearchProvider
  voiceProvider: (process.env.VOICE_PROVIDER || 'azure_openai') as 'openai' | 'azure_openai'
  ```
- **Impact**: Invalid config values bypass validation; runtime errors possible
- **Recommendation**: Use Zod to validate all env variables at startup:
  ```typescript
  const envSchema = z.object({
    WEB_SEARCH_PROVIDER: z.enum(['tavily', 'serper', 'brave']).default('tavily'),
    VOICE_PROVIDER: z.enum(['openai', 'azure_openai']).default('azure_openai'),
    // ...
  });
  const env = envSchema.parse(process.env);
  ```

### 1.2 PowerShell Command Construction
**Severity: MEDIUM** | **Effort: Low**

- **Location**: `src/desktop/manager.ts` line 133
- **Issue**: Shell command string construction:
  ```typescript
  const { stdout } = await execAsync(
    'powershell -NoProfile -Command "Get-Process WindowsSandbox..."'
  );
  ```
- **Impact**: If user input ever reaches these commands, injection is possible
- **Recommendation**: Use `spawn` with argument arrays instead of shell strings

### 1.3 Input Sanitization for AI Instructions
**Severity: MEDIUM** | **Effort: Medium**

- **Location**: `src/browser/strategies/computer-use/` (browser instructions)
- **Location**: `src/desktop/session.ts` (desktop actions)
- **Issue**: User instructions passed directly to AI models without sanitization
- **Recommendation**: Implement instruction sanitization and length limits

---

## 2. Error Handling & Observability

### 2.1 Silent Error Swallowing
**Severity: HIGH** | **Effort: Medium**

- **Location**: Multiple files with empty `.catch(() => {})` pattern:
  - `src/llm/service.ts` lines 93-98 (token reduction init)
  - `src/rag-projects/routes.ts` (RAG indexing)
  - `src/server/index.ts` (task message handling)
  - `src/agents/supervisor.ts` (auto-naming)
- **Issue**: Fire-and-forget promises swallow errors silently:
  ```typescript
  service.init().catch((error) => {
    console.error('[LLMService] Failed to initialize:', error);
    this.tokenReduction = null;
    // Error is logged but never surfaced to monitoring
  });
  ```
- **Impact**: Silent failures; critical features might be offline without awareness
- **Recommendation**:
  - Implement error event emission to notify monitoring
  - Add retry logic for critical services
  - Create centralized error tracking

### 2.2 Inconsistent Logging
**Severity: MEDIUM** | **Effort: High**

- **Finding**: 763 console.log/error/warn calls across 72 files
- **Issue**: No structured logging, no log levels, no timestamps, no correlation IDs
- **Impact**: Hard to debug in production; no request tracing
- **Recommendation**:
  - Implement structured logging (Pino recommended for performance)
  - Add correlation IDs for request tracing
  - Gate debug logs behind DEBUG environment variable

### 2.3 Missing Health Checks
**Severity: MEDIUM** | **Effort: Low**

- **Location**: No `/health` or `/ready` endpoints
- **Impact**: Container orchestration can't detect unhealthy instances
- **Recommendation**: Add health check endpoint with dependency status:
  ```typescript
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      db: db.isConnected(),
      llm: llmService.isReady(),
      uptime: process.uptime()
    });
  });
  ```

### 2.4 No Metrics/Monitoring
**Severity: MEDIUM** | **Effort: Medium**

- **Issue**: No Prometheus-style metrics exposed
- **Impact**: Can't monitor performance, token usage, error rates
- **Recommendation**: Add metrics for:
  - LLM token usage (input/output by model)
  - Tool execution times
  - Error rates by type
  - Active sessions count

---

## 3. Type Safety & Code Quality

### 3.1 `as any` Type Casts in Tests
**Severity: LOW** | **Effort: Low**

- **Location**: `src/agents/base-agent.test.ts` (14 occurrences)
- **Issue**:
  ```typescript
  agent = new TestAgent(createTestConfig(), mockLLMService as any);
  ```
- **Impact**: Bypasses type safety; tests may not catch type errors
- **Recommendation**: Use Vitest's proper mocking APIs

### 3.2 Non-null Assertion Overuse
**Severity: LOW** | **Effort: Low**

- **Location**: Multiple files with `!` operator
- **Issue**: Lines like `this.tokenReductionConfig!.provider` bypass null safety
- **Recommendation**: Add proper null guards or use optional chaining

---

## 4. Architectural Issues

### 4.1 Monolithic Initialization
**Severity: MEDIUM** | **Effort: High**

- **Location**: `src/index.ts` lines 258-500+
- **Issue**: Main function is 250+ lines with deeply nested initialization:
  - Creates many services sequentially
  - No dependency injection; tightly coupled
  - Hard to test; hard to understand initialization order
- **Recommendation**:
  - Extract into initialization modules
  - Implement dependency injection container
  - Create feature flags for optional services

### 4.2 Race Conditions in Shared State
**Severity: MEDIUM** | **Effort: Medium**

- **Location**: `src/agents/supervisor.ts` lines 92-98
  ```typescript
  private subAgents: Map<string, WorkerAgent> = new Map();
  private tasks: Map<string, TaskAssignment> = new Map();
  private processingMessages: Set<string> = new Set();
  ```
- **Issue**: Multiple concurrent operations on shared maps without locking
- **Impact**: Race conditions possible; task state corruption
- **Recommendation**: Use `async-mutex` (already in deps) to guard map access

### 4.3 Platform-Specific Paths
**Severity: MEDIUM** | **Effort: Medium**

- **Location**: `src/desktop/manager.ts` lines 61, 68
  ```typescript
  const SANDBOX_MAPPED_DIR = 'C:\\Users\\WDAGUtilityAccount\\Desktop\\OllieBot';
  ```
- **Issue**: Windows paths hard-coded; no cross-platform support
- **Impact**: Linux/Mac users can't use desktop features
- **Recommendation**: Implement platform abstraction layer

---

## 5. Performance & Efficiency

### 5.1 Missing Database Indexes
**Severity: MEDIUM** | **Effort: Low**

- **Location**: `src/db/index.ts`
- **Issue**: No indexes on frequently queried columns
- **Impact**: O(n) queries for large datasets
- **Recommendation**: Add indexes:
  ```sql
  CREATE INDEX idx_messages_conversation ON messages(conversationId, createdAt);
  CREATE INDEX idx_conversations_updated ON conversations(updatedAt);
  CREATE INDEX idx_traces_conversation ON traces(conversationId, startedAt);
  ```

### 5.2 Full History Loaded Per Turn
**Severity: MEDIUM** | **Effort: Medium**

- **Location**: `src/agents/supervisor.ts` line ~300
  ```typescript
  const allMessages = await getDb().getMessages(conversationId, MAX_MESSAGES_LIMIT);
  ```
- **Issue**: Loads up to 512 messages every agent turn
- **Impact**: Huge LLM context; slow on large conversations
- **Recommendation**: Implement smart context windowing (recent + summary)

### 5.3 Screenshot Interval Race
**Severity: LOW** | **Effort: Low**

- **Location**: `src/browser/session.ts` lines ~200
- **Issue**: If screenshot takes longer than interval, next one starts before previous finishes
- **Recommendation**: Use debouncing or await previous completion

### 5.4 No Rate Limiting
**Severity: MEDIUM** | **Effort: Low**

- **Location**: `src/server/index.ts`
- **Issue**: No rate limiting on API endpoints
- **Impact**: User can DOS the application
- **Recommendation**: Add `express-rate-limit` middleware

---

## 6. Testing & Reliability

### 6.1 Low Test Coverage
**Severity: MEDIUM** | **Effort: High**

- **Finding**: 8 test files across 183 TypeScript files (~4% coverage)
- **Covered**:
  - `src/agents/` (base-agent, capabilities, registry, supervisor, worker)
  - `src/db/well-known-conversations`
- **Missing**:
  - Tool execution
  - LLM providers
  - Browser/desktop automation
  - API routes
  - Integration tests
- **Recommendation**: Target 70%+ coverage; prioritize critical paths

---

## 7. Dependencies & Packages

### 7.1 Heavy Optional Dependencies
**Severity: LOW** | **Effort: Medium**

| Package | Size | Purpose | Recommendation |
|---------|------|---------|----------------|
| `@huggingface/transformers` | Large | Token reduction | Lazy-load |
| `@tensorflow/tfjs` | 20MB+ | ML operations | Make optional |
| `pyodide` | Very Large | Python runtime | Lazy-load |

- **Recommendation**: Make ML/Python features lazy-loaded or split into optional workspace

### 7.2 Potentially Unused Dependencies
**Severity: LOW** | **Effort: Low**

- `simple-git` - Git operations, unclear usage
- `unpdf` - PDF parsing, verify usage
- **Recommendation**: Audit with `depcheck` tool

---

## 8. Browser/Desktop Automation

### 8.1 Anthropic Computer Use Not Implemented
**Severity: MEDIUM** | **Effort: Medium**

- **Location**: `src/browser/strategies/computer-use/providers/index.ts` line 28
  ```typescript
  // TODO: Implement Anthropic provider
  ```
- **Impact**: Can't use Anthropic's Computer Use API
- **Recommendation**: Implement Anthropic provider

### 8.2 No Browser Session Pooling
**Severity: LOW** | **Effort: Medium**

- **Location**: `src/browser/manager.ts`
- **Issue**: Each session creates new Chromium instance
- **Recommendation**: Implement connection pooling

### 8.3 Desktop Session Cleanup
**Severity: MEDIUM** | **Effort: Low**

- **Location**: `src/desktop/manager.ts`
- **Issue**: Process crash leaves Windows Sandbox running
- **Recommendation**: Implement signal handlers for cleanup

---

## 9. Frontend Issues

### 9.1 No Frontend Logging
**Severity: LOW** | **Effort: Low**

- **Finding**: 0 console.log calls in web/src
- **Recommendation**: Add structured logging for debugging

### 9.2 Error Boundary Coverage
**Severity: MEDIUM** | **Effort: Low**

- **Location**: `web/src/components/ErrorBoundary.jsx`
- **Issue**: Unclear if all components are wrapped
- **Recommendation**: Add granular error boundaries

---

## 10. Tech Choices Review

### Current Stack Assessment

| Component | Choice | Status | Notes |
|-----------|--------|--------|-------|
| Runtime | Node.js + TypeScript | ✅ Good | ES2022 modules, modern |
| Database | SQLite (better-sqlite3) | ✅ Good | Appropriate for single-user |
| Web Framework | Express | ⚠️ Aging | Consider Fastify for perf |
| Frontend | React 19 + Vite | ✅ Good | Modern, React Compiler enabled |
| Testing | Vitest | ✅ Good | Fast, ESM-native |
| LLM SDK | @anthropic-ai/sdk | ✅ Current | v0.30.0 is recent |
| Browser Auto | Playwright | ✅ Good | Industry standard |

### Potential Upgrades

| Current | Alternative | Benefit | Effort |
|---------|-------------|---------|--------|
| Express | Fastify | 2-3x faster, better TypeScript | Medium |
| console.log | Pino | Structured logging, 5x faster | Medium |
| Manual DI | tsyringe/InversifyJS | Testability, loose coupling | High |
| No metrics | Prometheus client | Production observability | Low |

---

## Quick Wins

High impact, low effort improvements:

| Task | Effort | Impact | Priority |
|------|--------|--------|----------|
| Add Zod validation for env vars | 30 min | Security | HIGH |
| Add health check endpoint | 15 min | Operations | HIGH |
| Add database indexes | 30 min | Performance | MEDIUM |
| Add rate limiting middleware | 1 hour | Security | MEDIUM |
| Consolidate logging to single module | 2 hours | Debugging | MEDIUM |
| Add error event emissions | 1 hour | Reliability | MEDIUM |

---

## Roadmap

### Short-term (1-2 weeks)
- [ ] Environment variable validation with Zod
- [ ] Health check endpoint
- [ ] Database indexes
- [ ] Rate limiting
- [ ] Centralized logging module

### Medium-term (1-2 months)
- [ ] Increase test coverage to 50%+
- [ ] Implement dependency injection
- [ ] Add OpenTelemetry tracing
- [ ] Browser session pooling
- [ ] Context windowing for LLM

### Long-term (3-6 months)
- [ ] Message queue for async tasks
- [ ] Prometheus metrics
- [ ] Cross-platform desktop support
- [ ] Plugin architecture for providers
