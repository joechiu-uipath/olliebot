# OllieBot E2E Test Strategy

This document outlines a two-tier testing strategy for OllieBot, analyzing technology choices, trade-offs, and coverage approaches for the functional surface area defined in `e2e-test-plan.md`.

---

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Two-Tier Test Architecture](#two-tier-test-architecture)
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

## Two-Tier Test Architecture

### Tier 1: Unit Tests (Vitest)

**Purpose**: Test individual functions, classes, and modules in isolation.

**Characteristics**:
- Fast execution (~1ms per test)
- Mock all external dependencies
- Run in Node.js (no browser)
- Focus on business logic, data transformations, edge cases

**Current Coverage**: 8 test files covering agents, tools, services, database.

**Technology**: Vitest (already in place)

### Tier 2: E2E Tests

**Purpose**: Test user-facing workflows through the UI with simulated backend.

**Characteristics**:
- Slower execution (~100ms-2s per test)
- Real or simulated DOM rendering
- Simulated network layer (no external calls)
- Real SQLite database (test instance)
- Focus on user workflows, UI interactions, data flow

**Technology Options**: See comparison below.

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

### Hybrid Strategy

Use Playwright, API integration tests, and Vitest for different test types:

```
┌─────────────────────────────────────────────────────────┐
│                    Test Pyramid                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                      ┌─────────┐                        │
│                      │ E2E     │  Playwright            │
│                      │ (~50)   │  Full user flows       │
│                      └────┬────┘                        │
│                           │                             │
│               ┌───────────┴───────────┐                 │
│               │   API Integration    │  Vitest + real   │
│               │   (~50+)             │  server + in-mem │
│               │                      │  SQLite          │
│               └───────────┬───────────┘                 │
│                           │                             │
│                 ┌─────────┴─────────┐                   │
│                 │   Integration     │  Vitest Browser   │
│                 │   (~150)          │  Component combos │
│                 └─────────┬─────────┘                   │
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

#### API Integration Tests (Vitest + real server)
- REST endpoints (health, conversations, messages, settings, agents, traces)
- WebSocket lifecycle (connect, stream, broadcast, disconnect)
- Database persistence through the API layer (CRUD, pagination, cursors)
- Request validation and error responses (malformed JSON, 404s, 400s)
- Concurrent access (parallel writes, connection management)
- Well-known conversation protection (delete/rename guards)

See [`api-tests/`](../../api-tests/) for the implementation. Key properties:
- **No mocks**: Real Hono server, real SQLite (in-memory), real WebSocket
- **No outbound network**: `SimulatorServer` from `e2e/simulators/` absorbs all external calls
- **Parallel-safe**: Dynamic port allocation (port 0) per test file
- **Fast reset**: `DELETE FROM` + re-seed between tests (no server restart)
- **Run command**: `pnpm test:api` / `pnpm test:api:coverage`

#### Integration Tests (Vitest Browser Mode)
- React components (rendering, interactions, state)
- Context providers (WebSocket context, settings context)
- Hooks (useConversation, useMessages, useWebSocket)
- UI state machines (sidebar, modals, accordions)

#### E2E Tests (Playwright)
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
| CHAT-001 | Send simple message | E2E | Full flow with simulated LLM |
| CHAT-002 | Streaming response | E2E | WebSocket streaming simulation |
| CHAT-003 | Image attachment | E2E | File upload + display |
| CHAT-004 | Conversation persistence | E2E | Refresh + data reload |
| CHAT-005 | Create new conversation | Integration | Sidebar + API mock |
| CHAT-006 | Switch conversations | E2E | Multi-component state |
| CHAT-007 | Delete conversation | Integration | API mock + UI update |
| CHAT-008 | Rename conversation | Integration | Inline edit component |
| CHAT-009 | Auto-naming | E2E | LLM-triggered naming |
| CHAT-010 | Clear messages | Integration | API mock + list clear |
| CHAT-011 | History pagination | E2E | Scroll + API pagination |
| CHAT-012 | Feed conversation | E2E | Task run integration |
| CHAT-013 | Delegation display | E2E | WebSocket event rendering |
| CHAT-014 | Tool execution display | E2E | Tool event lifecycle |
| CHAT-015 | Error display | Integration | Error component |
| CHAT-016 | Citations display | E2E | Citation extraction + render |
| CHAT-017 | Think mode toggle | Integration | Input component state |
| CHAT-018 | Think+ mode toggle | Integration | Input component state |
| CHAT-019 | Deep Research toggle | Integration | Input component state |
| CHAT-020 | Inline rename | Integration | Sidebar component |
| CHAT-021 | Hashtag menu | Integration | Input + menu component |
| CHAT-022 | Agent command chip | Integration | Input component |
| CHAT-023 | Scroll-to-bottom | Integration | Chat area component |
| CHAT-024 | Streaming cursor | Integration | Message component |
| CHAT-025 | Token usage | E2E | Full response cycle |

#### Agent Delegation (12 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| AGENT-001 to 004 | Delegate to specialist | E2E | LLM decision + worker spawn |
| AGENT-005, 006 | Command triggers | E2E | Input parsing + delegation |
| AGENT-007 | No re-delegation | Unit | Supervisor logic |
| AGENT-008 | Delegation notification | E2E | WebSocket event + UI |
| AGENT-009 | Response attribution | E2E | Agent metadata in response |
| AGENT-010 | Parallel delegation | E2E | Multiple workers |
| AGENT-011 | Sub-agent delegation | Unit | Worker delegation logic |
| AGENT-012 | Delegation chain | E2E | Multi-level delegation |

#### Browser Automation (17 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| BROWSER-001 | Create session | E2E | Tool call + session state |
| BROWSER-002 to 006 | Browser actions | **Not testable** | Requires real Playwright |
| BROWSER-007 | Close session | E2E | API call + cleanup |
| BROWSER-008 | List sessions | Integration | API mock + list render |
| BROWSER-009, 010 | Strategy selection | Unit | Strategy factory logic |
| BROWSER-011 | Session timeout | Unit | Timer logic |
| BROWSER-012 | Multiple sessions | E2E | Session manager state |
| BROWSER-013 to 017 | UI preview features | Integration | Component rendering |

#### Desktop Automation (15 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| DESKTOP-001 to 010 | VNC/Sandbox operations | **Not testable** | Requires real Windows Sandbox |
| DESKTOP-011 to 015 | UI display features | Integration | Component rendering with mock data |

#### Tools (all suites)

| Suite | Tier | Notes |
|-------|------|-------|
| Web & Search | Unit + E2E | Unit: parsing; E2E: tool call flow with fixtures |
| Code Execution | Unit | Pyodide/Monty execution with fixtures |
| Media & Output | Unit + E2E | Unit: generation logic; E2E: display |
| Memory | Unit + E2E | Unit: storage; E2E: retrieval in context |
| System | E2E | Full delegation flow |
| User-Defined | Unit | Tool generation and execution |

#### MCP Integration (9 tests)

| ID | Test Case | Tier | Notes |
|----|-----------|------|-------|
| MCP-001 to 003 | Connection + execution | Unit | Mock MCP server responses |
| MCP-004 to 006 | Enable/disable + reconnect | E2E | Settings + state management |
| MCP-007 to 009 | UI features | Integration | Sidebar components |

#### Missions, RAG, Skills, Deep Research, Evaluation

All these suites follow similar patterns:
- **API operations**: Unit tests with mocked DB
- **UI display**: Integration tests with mock data
- **Full workflows**: E2E tests with fixture responses

#### TUI (29 tests)

| Tier | Notes |
|------|-------|
| Integration | Use Ink testing utilities for terminal rendering |
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

### Phase 1: Foundation (Week 1-2)

1. **Configure Playwright for E2E**
   ```bash
   pnpm add -D @playwright/test
   npx playwright install
   ```

2. **Create test infrastructure**
   - `tests/e2e/` directory for Playwright tests
   - `tests/fixtures/` for LLM response fixtures
   - `tests/utils/` for shared test utilities

3. **Implement core mocks**
   - WebSocket simulator
   - LLM response fixtures
   - API route handlers

4. **Database isolation**
   - Per-suite test database
   - Seed data utilities
   - Cleanup hooks

### Phase 2: Core Flows (Week 3-4)

1. **Chat flow tests** (10 tests)
   - Send message, receive response
   - Streaming display
   - Conversation management

2. **Tool execution tests** (10 tests)
   - Tool call display
   - Result rendering
   - Error handling

3. **Agent delegation tests** (5 tests)
   - Delegation notification
   - Worker response attribution

### Phase 3: Integration Tests (Week 5-6)

1. **Configure Vitest Browser Mode**
   ```bash
   pnpm add -D @vitest/browser @testing-library/react
   ```

2. **Component tests** (50 tests)
   - Chat input component
   - Message list component
   - Sidebar components
   - Modal components

### Phase 4: Expand Coverage (Week 7-8)

1. **Remaining E2E tests** (30 tests)
   - Missions mode
   - Evaluation mode
   - Logs mode
   - RAG projects

2. **TUI tests** (20 tests)
   - Separate test setup for Ink
   - Focus navigation
   - Slash commands

### Phase 5: CI/CD Integration (Week 9-10)

1. **GitHub Actions workflow**
   - Unit tests (fast, every PR)
   - Integration tests (medium, every PR)
   - E2E tests (slower, daily or pre-release)

2. **Test reporting**
   - Coverage reports
   - Failure screenshots
   - Trace artifacts

---

## Appendix: Technology Versions

Based on current OllieBot setup:

| Technology | Version | Purpose |
|------------|---------|---------|
| Vitest | 4.0.18 | Unit + Integration tests |
| Playwright | 1.58.1 | E2E tests (installed, needs config) |
| React | 18.x | Frontend framework |
| Vite | 5.x | Build tool |
| MSW | 2.x | API mocking (to add) |
| Testing Library | 14.x | Component testing (to add) |

---

## Appendix: Sample Test File Structure

```
olliebot/
├── src/
│   └── **/*.test.ts          # Unit tests (existing)
├── tests/
│   ├── e2e/
│   │   ├── chat.spec.ts      # Playwright E2E
│   │   ├── delegation.spec.ts
│   │   ├── tasks.spec.ts
│   │   └── ...
│   ├── integration/
│   │   ├── components/
│   │   │   ├── ChatInput.test.tsx
│   │   │   ├── MessageList.test.tsx
│   │   │   └── ...
│   │   └── hooks/
│   │       ├── useWebSocket.test.ts
│   │       └── ...
│   ├── fixtures/
│   │   ├── llm-responses/
│   │   │   ├── simple-greeting.json
│   │   │   ├── tool-call-web-search.json
│   │   │   └── ...
│   │   └── api-responses/
│   │       ├── conversations.json
│   │       └── ...
│   └── utils/
│       ├── websocket-simulator.ts
│       ├── test-database.ts
│       └── mock-handlers.ts
├── playwright.config.ts
├── vitest.config.ts          # Updated for browser mode
└── vitest.workspace.ts       # Workspace config for multiple projects
```

---

## Summary

| Tier | Technology | Test Count | Speed | Coverage Focus |
|------|------------|------------|-------|----------------|
| Unit | Vitest (Node.js) | ~500 | ~10ms/test | Logic, transformations |
| **API Integration** | **Vitest + real server** | **~50+** | **~5ms/test** | **REST API, WebSocket, DB persistence** |
| Integration | Vitest Browser | ~150 | ~200ms/test | Components, hooks |
| E2E | Playwright | ~50 | ~1s/test | User workflows |

**Total estimated tests**: ~750+
**Total estimated runtime**: ~5 minutes (parallel)

### API Integration Test Coverage Target

The API integration tests specifically measure coverage of the server-side API surface:

| File | Description | Coverage Target |
|------|-------------|-----------------|
| `src/server/index.ts` | Main REST routes + WebSocket setup | Primary |
| `src/server/eval-routes.ts` | Evaluation REST API | Future |
| `src/server/mission-routes.ts` | Mission/pillar REST API | Future |
| `src/server/voice-proxy.ts` | Voice WebSocket proxy | Out of scope (needs voice provider) |
| `src/channels/websocket.ts` | WebSocket channel implementation | Primary |
| `src/db/index.ts` | Database layer (repositories, pagination) | Primary |
| `src/db/well-known-conversations.ts` | Well-known conversation seeding | Primary |
| `src/settings/service.ts` | User settings persistence | Primary |

Run coverage: `pnpm test:api:coverage` (reports to `coverage-api/`)

The recommended approach balances test confidence with execution speed and cost, while clearly identifying areas that require manual testing due to external dependencies.
