# OllieBot Test Strategy

This document outlines the three-tier testing strategy for OllieBot, analyzing technology choices, trade-offs, and coverage approaches for the functional surface area defined in `e2e-test-plan.md`.

---

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Three-Tier Test Architecture](#three-tier-test-architecture)
3. [Technology Comparison](#technology-comparison)
4. [Recommended Approach](#recommended-approach)
5. [Test Coverage Mapping](#test-coverage-mapping)
6. [Untestable Areas](#untestable-areas)
7. [Implementation Roadmap](#implementation-roadmap)

---

## Testing Philosophy

### Goals

1. **Fast feedback** - Tests should complete in minutes, not hours
2. **Low cost** - No real LLM API calls, no external network dependencies
3. **High confidence** - Tests should catch real bugs that would affect users
4. **Maintainable** - Tests should be easy to write and update

### Constraints

- Real LLM calls are too slow (2-10s per call) and expensive ($0.01-0.10 per call)
- Real network calls introduce flakiness and external dependencies
- Full browser tests are slower than DOM-only tests
- Some features (voice input, sandbox VNC) require real system resources

---

## Three-Tier Test Architecture

### Tier 1: Unit Tests (Vitest)

**Purpose**: Test individual functions, classes, and modules in isolation.

**Characteristics**:
- Fast execution (~1ms per test)
- Mock all external dependencies
- Run in Node.js (no browser)
- Focus on business logic, data transformations, edge cases

**Current Coverage**: 8 test files covering agents, tools, services, database.

**Technology**: Vitest (already in place)

**Run command**: `pnpm test`

### Tier 2: API Tests (Vitest + real server)

**Purpose**: Test REST API endpoints, WebSocket lifecycle, and database persistence through the full server stack with simulated external dependencies.

**Characteristics**:
- Fast execution (~5ms per test)
- Real Hono server, real SQLite (in-memory), real WebSocket
- No outbound network — `SimulatorServer` absorbs all external calls
- No mocks of service responses or DB data — everything through CRUD API
- Parallel-safe — dynamic port allocation per test file
- Fast reset — `DELETE FROM` + re-seed between tests (no server restart)

**Current Coverage**: 20 test files, 218 tests covering server routes, agents pipeline, tools, tracing, dashboard, missions, evaluations, conversations, messages, settings, WebSocket.

**Technology**: Vitest with custom test harnesses (`ServerHarness`, `FullServerHarness`, `AgentPipelineHarness`)

**Run command**: `pnpm test:api` / `pnpm test:api:coverage`

### Tier 3: E2E UI Tests (Playwright)

**Purpose**: Test user-facing workflows through the UI with simulated backend.

**Characteristics**:
- Slower execution (~100ms-2s per test)
- Real browser (Chromium, headless)
- Simulated network layer (no external calls)
- Real SQLite database (test instance)
- Focus on user workflows, UI interactions, data flow

**Technology**: Playwright. See comparison below.

---

## Technology Comparison

### Option A: Playwright + Network Simulation

Full browser automation with all network dependencies mocked.

```
┌─────────────────────────────────────────────────────────┐
│                    Test Environment                      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐     ┌─────────────────────────────┐   │
│  │  Playwright │────▶│   Real Chrome/Chromium      │   │
│  │  Test Code  │     │   (headless)                │   │
│  └─────────────┘     └──────────────┬──────────────┘   │
│                                      │                  │
│                      ┌───────────────▼───────────────┐  │
│                      │     React Frontend (Vite)     │  │
│                      └───────────────┬───────────────┘  │
│                                      │                  │
│  ┌─────────────┐     ┌───────────────▼───────────────┐  │
│  │ MSW / Route │◀───▶│   WebSocket + HTTP Requests   │  │
│  │  Handlers   │     └───────────────────────────────┘  │
│  └──────┬──────┘                                        │
│         │                                               │
│  ┌──────▼──────┐     ┌───────────────────────────────┐  │
│  │  Express    │────▶│   SQLite (test.db)            │  │
│  │  Server     │     │   (fresh per test suite)      │  │
│  └─────────────┘     └───────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Simulated Services                  │   │
│  │  • LLM responses (pre-recorded fixtures)        │   │
│  │  • Web search results (fixtures)                │   │
│  │  • Image generation (placeholder images)        │   │
│  │  • Voice transcription (fixture responses)      │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### Pros

| Aspect | Details |
|--------|---------|
| **Real Browser Behavior** | CSS, layout, scroll, focus, keyboard all work exactly as in production |
| **WebSocket Support** | Native `page.routeWebSocket()` for full WS simulation |
| **Cross-Browser** | Test on Chromium, Firefox, WebKit (Safari) |
| **Network Mocking** | `page.route()` intercepts all HTTP; MSW for unified API |
| **Debugging** | Trace viewer, screenshot on failure, video recording |
| **Parallelism** | Native parallel execution (free, built-in) |
| **Maturity** | Battle-tested, extensive documentation, active development |

#### Cons

| Aspect | Details |
|--------|---------|
| **Speed** | ~500ms-2s per test (browser startup overhead) |
| **Setup Complexity** | More configuration than jsdom tests |
| **Resource Usage** | Requires ~200MB RAM per browser instance |
| **CI Cost** | Heavier CI runners needed |

#### WebSocket Mocking with Playwright

```typescript
// Example: Mock WebSocket for chat streaming
await page.routeWebSocket('ws://localhost:3000/ws', ws => {
  ws.onMessage(message => {
    const data = JSON.parse(message);

    if (data.type === 'message') {
      // Simulate streaming response
      ws.send(JSON.stringify({ type: 'stream_start', turnId: 'turn-1' }));
      ws.send(JSON.stringify({ type: 'stream_chunk', content: 'Hello' }));
      ws.send(JSON.stringify({ type: 'stream_chunk', content: ' world!' }));
      ws.send(JSON.stringify({ type: 'stream_end' }));
    }
  });
});
```

#### LLM Response Simulation

```typescript
// Fixture-based LLM responses
const llmFixtures = {
  'simple-greeting': {
    content: 'Hello! How can I help you today?',
    toolCalls: [],
  },
  'web-search-query': {
    content: '',
    toolCalls: [{ name: 'web_search', parameters: { query: 'test' } }],
  },
};

// Mock LLM endpoint
await page.route('**/api/llm/**', route => {
  const fixture = determineFixture(route.request());
  route.fulfill({ json: llmFixtures[fixture] });
});
```

---

### Option B: Vitest Browser Mode + Testing Library

Real DOM rendering via Playwright provider, but lighter than full e2e.

```
┌─────────────────────────────────────────────────────────┐
│                    Test Environment                      │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐     ┌─────────────────────────────┐   │
│  │   Vitest    │────▶│   Playwright Provider       │   │
│  │  Test Code  │     │   (real browser, 1 page)    │   │
│  └─────────────┘     └──────────────┬──────────────┘   │
│                                      │                  │
│                      ┌───────────────▼───────────────┐  │
│                      │  React Component Under Test   │  │
│                      │  (rendered in isolation)      │  │
│                      └───────────────┬───────────────┘  │
│                                      │                  │
│  ┌─────────────┐     ┌───────────────▼───────────────┐  │
│  │    MSW      │◀───▶│   Mocked Context Providers    │  │
│  │  Handlers   │     │   (WebSocket, API, etc.)      │  │
│  └─────────────┘     └───────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  No real server - all dependencies mocked        │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### Pros

| Aspect | Details |
|--------|---------|
| **Speed** | ~100-500ms per test (shared browser context) |
| **Unified Tooling** | Same test runner (Vitest) for unit and integration |
| **Real DOM** | Uses Playwright under the hood, so real browser behavior |
| **Vite Integration** | Native HMR, fast rebuilds during development |
| **Component Focus** | Great for testing components in isolation |

#### Cons

| Aspect | Details |
|--------|---------|
| **No Full App** | Tests components, not complete user flows |
| **WebSocket Complexity** | MSW WebSocket support newer, less documented |
| **Limited Navigation** | Single page per test file (no multi-page flows) |
| **Backend Not Tested** | Server logic requires separate tests |

#### Example: Component Test with Vitest Browser Mode

```typescript
// ChatInput.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from './ChatInput';

test('sends message on Enter', async () => {
  const onSend = vi.fn();
  render(<ChatInput onSend={onSend} />);

  const input = screen.getByPlaceholderText('Type a message...');
  await userEvent.type(input, 'Hello world{Enter}');

  expect(onSend).toHaveBeenCalledWith('Hello world');
});
```

---

### Option C: Cypress (For Comparison)

Included for completeness, but **not recommended** for OllieBot.

#### Why Not Cypress

| Issue | Impact |
|-------|--------|
| **No WebKit** | Cannot test Safari - significant for cross-browser |
| **Serial Execution** | Parallel requires paid Dashboard or hacks |
| **Limited WebSocket** | `cy.intercept()` doesn't natively support WS |
| **Scale Cost** | Becomes expensive at enterprise scale |

---

### Comparison Matrix

| Criteria | Playwright | Vitest Browser | Testing Library + jsdom |
|----------|------------|----------------|-------------------------|
| **Setup Time** | 2-4 hours | 1-2 hours | 30 min |
| **Test Speed** | ~1s/test | ~200ms/test | ~10ms/test |
| **Real Browser** | Yes | Yes (via provider) | No |
| **WebSocket Mock** | Excellent | Good (MSW) | Poor |
| **Full App Testing** | Yes | No (components) | No (components) |
| **Backend Integration** | Yes | No | No |
| **Cross-Browser** | 3 browsers | 3 browsers | N/A |
| **Debugging** | Excellent | Good | Limited |
| **CI Resource Cost** | High | Medium | Low |
| **Maintenance** | Medium | Low | Low |

---

## Recommended Approach

### Three-Tier Strategy

Use Vitest for unit and API tests, and Playwright for E2E UI tests:

```
┌─────────────────────────────────────────────────────────┐
│                    Test Pyramid                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                      ┌─────────┐                        │
│                      │ E2E UI  │  Playwright            │
│                      │ (~50)   │  Full user flows       │
│                      └────┬────┘                        │
│                           │                             │
│               ┌───────────┴───────────┐                 │
│               │    API Tests         │  Vitest + real   │
│               │    (~200+)           │  server + in-mem │
│               │                      │  SQLite          │
│               └───────────┬───────────┘                 │
│                           │                             │
│        ┌──────────────────┴──────────────────┐          │
│        │           Unit Tests                │  Vitest  │
│        │           (~500+)                   │  Node.js │
│        └─────────────────────────────────────┘          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

#### Unit Tests (Vitest, Node.js)
- Agent logic (delegation, tool filtering, context building)
- Tool execution (parameter validation, result transformation)
- Database queries (CRUD operations)
- Utility functions (parsing, formatting, validation)
- Service methods (event emission, state management)

#### API Tests (Vitest + real server)
- REST endpoints (health, conversations, messages, settings, agents, traces, dashboards, tools)
- WebSocket lifecycle (connect, stream, broadcast, disconnect)
- Full agent pipeline (supervisor → LLM → streamed response via real SupervisorAgentImpl)
- Database persistence through the API layer (CRUD, pagination, cursors)
- Request validation and error responses (malformed JSON, 404s, 400s)
- Tool registration, execution, and trace integration
- Dashboard snapshot CRUD, LLM rendering, lineage versioning
- Trace query endpoints (traces, LLM calls, tool calls, stats)
- Mission/pillar management and evaluation lifecycle
- Well-known conversation protection (delete/rename guards)

See [`api-tests/`](../../api-tests/) for the implementation. Key properties:
- **No mocks**: Real Hono server, real SQLite (in-memory), real WebSocket
- **No outbound network**: `SimulatorServer` from `e2e/simulators/` absorbs all external calls
- **Real agent pipeline**: `AgentPipelineHarness` uses real `SupervisorAgentImpl` backed by `SimulatorLLMProvider`
- **Parallel-safe**: Dynamic port allocation (port 0) per test file
- **Fast reset**: `DELETE FROM` + re-seed between tests (no server restart)
- **Run command**: `pnpm test:api` / `pnpm test:api:coverage`

#### E2E UI Tests (Playwright)
- Complete user workflows (send message → see response → persist)
- Cross-component interactions (sidebar → chat → tool results)
- WebSocket streaming (real-time updates, reconnection)
- Multi-page flows (mode switching, conversation switching)
- Visual regression (optional, with snapshots)

---

## Test Coverage Mapping

### E2E Test Plan → Test Tier Mapping

#### Chat & Conversations (25 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| CHAT-001 | Send simple message | E2E UI | Full flow with simulated LLM |
| CHAT-002 | Streaming response | E2E UI | WebSocket streaming simulation |
| CHAT-003 | Image attachment | E2E UI | File upload + display |
| CHAT-004 | Conversation persistence | API | REST + DB persistence |
| CHAT-005 | Create new conversation | API | Conversation CRUD |
| CHAT-006 | Switch conversations | E2E UI | Multi-component state |
| CHAT-007 | Delete conversation | API | REST API + well-known guard |
| CHAT-008 | Rename conversation | API | REST API + validation |
| CHAT-009 | Auto-naming | E2E UI | LLM-triggered naming |
| CHAT-010 | Clear messages | API | REST API + list clear |
| CHAT-011 | History pagination | API | Cursor-based pagination |
| CHAT-012 | Feed conversation | E2E UI | Task run integration |
| CHAT-013 | Delegation display | E2E UI | WebSocket event rendering |
| CHAT-014 | Tool execution display | E2E UI | Tool event lifecycle |
| CHAT-015 | Error display | E2E UI | Error component |
| CHAT-016 | Citations display | E2E UI | Citation extraction + render |
| CHAT-017 | Think mode toggle | E2E UI | Input component state |
| CHAT-018 | Think+ mode toggle | E2E UI | Input component state |
| CHAT-019 | Deep Research toggle | E2E UI | Input component state |
| CHAT-020 | Inline rename | E2E UI | Sidebar component |
| CHAT-021 | Hashtag menu | E2E UI | Input + menu component |
| CHAT-022 | Agent command chip | E2E UI | Input component |
| CHAT-023 | Scroll-to-bottom | E2E UI | Chat area component |
| CHAT-024 | Streaming cursor | E2E UI | Message component |
| CHAT-025 | Token usage | E2E UI | Full response cycle |

#### Agent Delegation (12 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| AGENT-001 to 004 | Delegate to specialist | API + E2E UI | Agent pipeline + UI display |
| AGENT-005, 006 | Command triggers | API + E2E UI | Input parsing + delegation |
| AGENT-007 | No re-delegation | Unit | Supervisor logic |
| AGENT-008 | Delegation notification | E2E UI | WebSocket event + UI |
| AGENT-009 | Response attribution | API | Agent metadata in response |
| AGENT-010 | Parallel delegation | E2E UI | Multiple workers |
| AGENT-011 | Sub-agent delegation | Unit | Worker delegation logic |
| AGENT-012 | Delegation chain | E2E UI | Multi-level delegation |

#### Browser Automation (17 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| BROWSER-001 | Create session | API | Tool call + session state |
| BROWSER-002 to 006 | Browser actions | **Not testable** | Requires real Playwright |
| BROWSER-007 | Close session | API | API call + cleanup |
| BROWSER-008 | List sessions | API | REST endpoint |
| BROWSER-009, 010 | Strategy selection | Unit | Strategy factory logic |
| BROWSER-011 | Session timeout | Unit | Timer logic |
| BROWSER-012 | Multiple sessions | API | Session manager state |
| BROWSER-013 to 017 | UI preview features | E2E UI | Component rendering |

#### Desktop Automation (15 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| DESKTOP-001 to 010 | VNC/Sandbox operations | **Not testable** | Requires real Windows Sandbox |
| DESKTOP-011 to 015 | UI display features | E2E UI | Component rendering with mock data |

#### Tools (all suites)

| Suite | Tier | Notes |
|-------|------|-------|
| Web & Search | Unit + API | Unit: parsing; API: tool registration + execution |
| Code Execution | Unit | Pyodide/Monty execution with fixtures |
| Media & Output | Unit + E2E UI | Unit: generation logic; E2E UI: display |
| Memory | Unit + API | Unit: storage; API: retrieval in context |
| System | API | Full delegation flow via agent pipeline |
| User-Defined | Unit + API | Tool generation, registration, prefix handling |

#### MCP Integration (9 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| MCP-001 to 003 | Connection + execution | Unit | Mock MCP server responses |
| MCP-004 to 006 | Enable/disable + reconnect | API + E2E UI | Settings + state management |
| MCP-007 to 009 | UI features | E2E UI | Sidebar components |

#### Missions, RAG, Skills, Deep Research, Evaluation

All these suites follow similar patterns:
- **Logic**: Unit tests with mocked dependencies
- **API operations**: API tests with real server + in-memory DB
- **UI display**: E2E UI tests with simulated backend
- **Full workflows**: E2E UI tests with fixture responses

#### TUI (29 tests)

| Tier | Notes |
|------|-------|
| Unit | Use Ink testing utilities for terminal rendering |
| Separate test environment | Not browser-based; use `ink-testing-library` |

---

## Untestable Areas

### Cannot Be Tested in Simulated Environment

| Feature | Reason | Mitigation |
|---------|--------|------------|
| **Real LLM responses** | Cost, latency, non-determinism | Fixture-based simulation |
| **Browser automation (actual)** | Needs real Playwright session | Manual testing, limited smoke tests |
| **Desktop/VNC automation** | Needs real Windows Sandbox | Manual testing only |
| **Voice input/output** | Requires real audio hardware | Mock audio APIs, manual testing |
| **Real web search/scrape** | External network dependency | Fixture responses |
| **Image generation (real)** | API cost, latency | Placeholder images |
| **Cross-browser quirks** | Some only appear in real conditions | Periodic real browser testing |

### Partial Coverage Possible

| Feature | What's Testable | What's Not |
|---------|-----------------|------------|
| **Browser sessions** | Session state, UI display | Actual page interaction |
| **Desktop sessions** | Session state, UI display | VNC interaction, sandbox behavior |
| **Voice mode** | UI state, recording indicator | Actual transcription |
| **Streaming** | WebSocket events, UI updates | Real LLM streaming timing |

### Recommended Manual Testing

1. **Browser automation workflows** - Test with real websites monthly
2. **Desktop automation** - Test sandbox launch/interaction weekly
3. **Voice input** - Test with real microphone before releases
4. **Cross-browser** - Run E2E suite on all browsers before releases
5. **Performance** - Profile with real LLM calls quarterly

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1-2) ✅

1. **Configure Playwright for E2E UI**
   ```bash
   pnpm add -D @playwright/test
   npx playwright install
   ```

2. **Create test infrastructure**
   - `e2e/` directory for Playwright E2E UI tests + simulators
   - `api-tests/` directory for API tests with harnesses + clients
   - Simulator server for absorbing all outbound network calls

3. **Implement core test harnesses**
   - `ServerHarness` — basic Hono server with in-memory SQLite
   - `FullServerHarness` — adds LLMService, ToolRunner, MissionManager, TraceStore
   - `AgentPipelineHarness` — real SupervisorAgentImpl with SimulatorLLMProvider
   - `SimulatorLLMProvider` — test-only LLM provider routing to simulator

4. **Database isolation**
   - In-memory SQLite (`:memory:`) per test harness
   - Seed data utilities (`seedMission`, `seedPillar`, `seedMetric`, `seedTodo`, `seedSnapshot`, etc.)
   - Fast reset via `DELETE FROM` between tests (no server restart)

### Phase 2: Core API Tests (Week 3-4) ✅

1. **Server route tests** (50+ tests)
   - Conversations, messages, settings CRUD
   - Health, startup, model capabilities
   - WebSocket lifecycle and streaming

2. **Agent pipeline tests** (10+ tests)
   - Real supervisor message handling
   - LLM call tracing and recording
   - Conversation persistence through agent pipeline

3. **Domain route tests** (50+ tests)
   - Dashboard snapshots (CRUD, render, lineage)
   - Trace queries (traces, LLM calls, tool calls, stats)
   - Mission/pillar management, evaluation lifecycle
   - Tool registration, execution, event emission

### Phase 3: E2E UI Tests (Week 5-6)

1. **Chat flow tests** (10 tests)
   - Send message, see streaming response
   - Conversation switching and management
   - Tool execution display

2. **Agent delegation tests** (5 tests)
   - Delegation notification in UI
   - Worker response attribution

3. **Remaining E2E UI tests** (30 tests)
   - Missions mode
   - Evaluation mode
   - Logs mode
   - RAG projects

### Phase 4: Expand Coverage (Week 7-8)

1. **TUI tests** (20 tests)
   - Separate test setup for Ink
   - Focus navigation
   - Slash commands

### Phase 5: CI/CD Integration (Week 9-10)

1. **GitHub Actions workflow**
   - Unit tests (fast, every PR)
   - API tests (fast, every PR)
   - E2E UI tests (slower, daily or pre-release)

2. **Test reporting**
   - Coverage reports (`pnpm test:api:coverage`)
   - Failure screenshots (Playwright)
   - Trace artifacts

---

## Appendix: Technology Versions

Based on current OllieBot setup:

| Technology | Version | Purpose |
|------------|---------|---------|
| Vitest | 4.0.18 | Unit + API tests |
| Playwright | 1.58.1 | E2E UI tests |
| React | 18.x | Frontend framework |
| Vite | 5.x | Build tool |

---

## Appendix: Test File Structure

```
olliebot/
├── src/
│   └── **/*.test.ts             # Unit tests (colocated with source)
├── api-tests/
│   ├── harness/
│   │   ├── server-harness.ts    # ServerHarness, FullServerHarness
│   │   ├── api-client.ts        # REST helper (getJson, postJson, etc.)
│   │   ├── ws-client.ts         # WebSocket test client
│   │   ├── simulator-llm-provider.ts  # Test-only LLM provider
│   │   └── index.ts             # Barrel exports
│   ├── tests/
│   │   ├── health-and-startup.test.ts
│   │   ├── conversations.test.ts
│   │   ├── messages.test.ts
│   │   ├── settings.test.ts
│   │   ├── websocket.test.ts
│   │   ├── trace-routes.test.ts
│   │   ├── dashboard-routes.test.ts
│   │   ├── mission-routes.test.ts
│   │   ├── eval-routes.test.ts
│   │   ├── server-routes.test.ts
│   │   ├── agent-pipeline.test.ts
│   │   ├── tools-and-services.test.ts
│   │   └── ...
│   └── vitest.config.ts         # API test Vitest config
├── e2e/
│   ├── simulators/
│   │   └── server.ts            # SimulatorServer (absorbs outbound calls)
│   ├── tests/
│   │   ├── chat.spec.ts         # Playwright E2E UI
│   │   └── ...
│   └── playwright.config.ts
└── vitest.config.ts             # Root Vitest config (unit tests)
```

---

## Summary

| Tier | Technology | Test Count | Speed | Coverage Focus |
|------|------------|------------|-------|----------------|
| Unit | Vitest (Node.js) | ~500 | ~10ms/test | Logic, transformations |
| **API** | **Vitest + real server** | **~218** | **~5ms/test** | **REST API, WebSocket, agents, tools, DB** |
| E2E UI | Playwright | ~50 | ~1s/test | User workflows |

**Total estimated tests**: ~770+
**Total estimated runtime**: ~5 minutes (parallel)

### API Test Coverage

The API tests measure coverage across the full `src/` directory. Current results (218 tests):

| Module | Statements | Key Files |
|--------|-----------|-----------|
| `src/server` | 60% | index.ts, eval-routes.ts, mission-routes.ts |
| `src/tracing` | 86% | trace-store.ts |
| `src/dashboard` | 68% | dashboard-routes.ts, dashboard-store.ts, snapshot-engine.ts |
| `src/tools` | 55% | runner.ts |
| `src/agents` | 24% | supervisor.ts, base-agent.ts, registry.ts |
| `src/llm` | 8% | service.ts (24%), model-capabilities.ts (100%) |
| `src/db` | 52% | index.ts |
| `src/missions` | 33% | manager.ts, schema.ts |
| `src/settings` | 38% | service.ts |
| `src/channels` | 17% | websocket.ts |
| `src/server/voice-proxy.ts` | — | Out of scope (needs voice provider) |

Run coverage: `pnpm test:api:coverage` (reports to `coverage-api/`)

The recommended approach balances test confidence with execution speed and cost, while clearly identifying areas that require manual testing due to external dependencies.
