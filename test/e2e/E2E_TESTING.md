# E2E Testing Guidelines

This document captures the design principles and requirements for OllieBot's E2E test suite.

## Architecture Overview

```
e2e/
├── tests/          # Test specifications (test layer)
├── pages/          # Page objects (page layer)
├── fixtures/       # Test data factories AND shared assertion helpers
├── constants/      # Enums and constants
└── utils/          # Test infrastructure (API mock, WS mock, test-base)
```

## Core Principles

### 1. No DOM Knowledge in Test Layer

**All DOM-level knowledge (CSS selectors, component IDs, class names) must be encapsulated in the page layer (`/e2e/pages`).** Test files should never contain raw selectors.

**Bad - DOM selector in test:**
```typescript
// test file - BAD
test('shows error message', async ({ app }) => {
  await app.page.locator('.error-message').click();  // DOM knowledge leaked to test
  await expect(app.page.locator('.error-content')).toBeVisible();
});
```

**Good - Using page object methods:**
```typescript
// test file - GOOD
test('shows error message', async ({ app }) => {
  await app.chat.clickErrorMessage();
  await expect(app.chat.errorContent).toBeVisible();
});
```

**Rationale:** When UI changes (class names, structure), only page objects need updating. Tests remain stable and readable.

---

### 2. Page Methods Must Return in Stable State

**Every page helper method must return only when the UI is in a stable, interaction-ready state.** Callers should never need to add waits after calling a page method.

**Bad - Caller must wait after method:**
```typescript
// page object - BAD design
async reload(): Promise<void> {
  await this.page.reload();
}

// test file - forced to add wait
await app.reload();
await app.waitForAppReady();  // Test shouldn't need to know this
await app.sidebar.selectConversation('Test');
```

**Good - Method handles its own stability:**
```typescript
// page object - GOOD design
async reload(): Promise<void> {
  await this.page.reload();
  await this.waitForAppReady();  // Internally ensures stable state
}

// test file - clean usage
await app.reload();
await app.sidebar.selectConversation('Test');  // Works immediately
```

**Rationale:** If `app.reload()` doesn't work reliably without `waitForAppReady()`, that's broken abstraction. The page layer knows what "ready" means; tests shouldn't need to.

---

### 3. No Assert Methods in Page Layer

**The page layer is a model of the application, not a test framework.** It should expose queryable state but never perform assertions. Assertions are the responsibility of tests.

**Bad - Assert methods in page object:**
```typescript
// page object - BAD
async assertModeActive(mode: Mode): Promise<void> {
  await expect(this.page.locator('.mode-btn.active')).toContainText(mode);
}

async assertChatModeActive(): Promise<void> {
  await this.assertModeActive(Mode.CHAT);
}
```

**Good - Expose state for tests to query:**
```typescript
// page object - GOOD
get activeMode(): Locator {
  return this.page.locator('.mode-btn.active');
}

async getActiveModeName(): Promise<string> {
  return (await this.activeMode.textContent()) || '';
}

// test file - assertion belongs here
await app.switchToChat();
await expect(app.activeMode).toContainText(Mode.CHAT);
```

**Rationale:**
- Page objects model the app's structure and behavior
- Tests define what correct behavior means (assertions)
- Mixing these concerns makes page objects opinionated and harder to reuse
- Tests become more readable when assertions are explicit

---

### 4. No Explicit Timeout Values in Tests

**Tests should not specify explicit timeout values.** Our test framework is designed so that all operations complete within the global 3-second timeout. Explicit timeouts scattered through test code indicate either:
- A page method that doesn't return in stable state (violates principle #2)
- An infrastructure issue that should be fixed at the framework level

**Bad - Explicit timeout in test:**
```typescript
// test file - BAD
await expect(app.chat.delegationCard).toBeVisible({ timeout: 5000 });
await expect(app.chat.hashtagMenu).toBeVisible({ timeout: 3000 });
```

**Good - Rely on global timeout:**
```typescript
// test file - GOOD
await expect(app.chat.delegationCard).toBeVisible();
await expect(app.chat.hashtagMenu).toBeVisible();
```

**Rationale:**
- Timeouts peppered through tests become noise and hide real issues
- If something takes >3s, we should fix the root cause, not mask it with a longer timeout
- Consistent timeout behavior makes test failures more predictable
- Page methods handle their own stability (principle #2), so tests don't need defensive timeouts

**Exception:** Only use explicit timeout in exceptional circumstances where:
1. External dependencies genuinely require longer wait times (rare)
2. The timeout is documented with a clear reason why it's necessary
3. There's no way to improve the underlying infrastructure

---

### 5. Shared Assertion Helpers in Fixtures (Use Sparingly)

**When multiple tests need to verify the same complex state, extract shared assertion logic into fixtures.** This provides code reuse while keeping assertions out of the page layer.

**However, use this pattern sparingly.** Only create shared assertion helpers when a concept is highly prevalent and reused across many tests.

**Why the restraint?** Moving assertion details into a helper creates another layer of abstraction. Human readers may not navigate into the fixture layer to study the implementation, and understanding of what the test actually verifies can be lost. Inline assertions, while more verbose, are immediately visible and self-documenting.

**Guidelines:**
- **DO** create helpers for concepts verified in 5+ tests (e.g., "app ready state", "session fully connected")
- **DON'T** create helpers for one-off or 2-3 time assertions - keep them inline
- **PREFER** readable inline assertions over clever abstractions

**Example - Complex state verification used by multiple tests:**
```typescript
// fixtures/assertions.ts
import { expect } from '@playwright/test';
import type { OllieBotApp } from '../pages/app.page.js';
import { Mode, SessionStatus } from '../constants/index.js';

/**
 * Verify app is in expected initial state after login.
 */
export async function assertAppInitialState(app: OllieBotApp): Promise<void> {
  await expect(app.activeMode).toContainText(Mode.CHAT);
  await expect(app.sidebar.container).toBeVisible();
  await expect(app.chat.input).toBeEnabled();
  await expect(app.connectionStatus).toContainText('Connected');
}

/**
 * Verify browser session is fully active and ready.
 */
export async function assertSessionReady(
  app: OllieBotApp,
  sessionName: string
): Promise<void> {
  await expect(app.sidebar.sessionByName(sessionName)).toBeVisible();
  const status = await app.sidebar.getSessionStatus(sessionName);
  expect(status).toBe(SessionStatus.ACTIVE);
}
```

**Usage in tests:**
```typescript
// test file
import { assertAppInitialState, assertSessionReady } from '../../fixtures/assertions.js';

test('user can create browser session', async ({ app }) => {
  await assertAppInitialState(app);

  // ... create session ...

  await assertSessionReady(app, 'My Session');
});
```

**What goes where:**

| Type | Location | Example |
|------|----------|---------|
| Test data factories | `fixtures/` | `createConversation()`, `createMessage()` |
| Shared assertion helpers | `fixtures/` | `assertAppInitialState()`, `assertSessionReady()` |
| Page state queries | `pages/` | `app.getActiveModeName()`, `sidebar.getSessionStatus()` |
| Test infrastructure | `utils/` | `ApiMock`, `WebSocketMock`, `test-base` |

---

## Summary Table

| Concern | Belongs In | NOT In |
|---------|------------|--------|
| CSS selectors, class names | Page layer | Test layer |
| Wait-for-ready logic | Page layer | Test layer |
| State queries (get current value) | Page layer | - |
| Simple assertions | Test layer (inline) | Page layer |
| Shared assertions (5+ uses) | Fixtures | Page layer |
| Test data factories | Fixtures | - |
| Enums, constants | Constants | Hardcoded strings |
| Test infrastructure (mocks) | Utils | - |

---

## Quick Reference

### Test Layer Should:
- Use page object methods exclusively
- Contain assertions (`expect()`) or call shared assertion helpers
- Use enums from `constants/index.ts`
- Be readable without DOM knowledge

### Page Layer Should:
- Encapsulate all DOM selectors
- Return in stable, ready state
- Expose locators and state getters
- Handle internal waits/retries
- **NOT** contain assertions

### Fixtures Should:
- Provide test data factories (`createConversation()`, etc.)
- Provide shared assertion helpers **only for highly reused concepts** (5+ tests)
- Prefer inline assertions for one-off or rarely repeated verifications
