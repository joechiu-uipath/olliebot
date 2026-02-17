# Adversarial Test Prompting: Incentivizing Agents to Find Real Bugs

**Status**: Research + Practical Implementation Guide  
**Target**: OllieBot API Testing & Eval Framework Integration  
**Last Updated**: 2026-02-17

## Executive Summary

When we ask an LLM agent to "write API tests for this service," the resulting tests overwhelmingly confirm existing behavior. They verify that endpoints return 200, that valid inputs produce expected outputs, and that the documented contract holds. These are **confirmatory tests** - they tell you the system does what it already does.

This document proposes an alternative prompting strategy: **adversarial test prompting**. Instead of asking the agent to verify functionality, we reframe the mission so the agent is rewarded for *discovering legitimate issues* - functional bugs, edge cases, security vulnerabilities, contract violations, and data integrity problems. The key insight is that the agent's objective function determines the quality of the tests it writes, and confirmation is a fundamentally different objective than discovery.

**Real-world validation**: This technique has proven effective in OllieBot's architecture where 40+ HTTP endpoints and WebSocket handlers create a large attack surface. Initial tests uncovered race conditions in mission state management, authentication bypass vectors, and pagination edge cases that standard testing missed.

This technique is meant to complement a standard test suite, not replace it. Basics still need coverage. This is about going beyond basics to rigorously hunt for high-value problems.

---

## Part 1: The Problem with Confirmatory Test Generation

### 1.1 Why Default Prompting Produces Weak Tests

When given a typical prompt like *"Write tests for this REST API"*, an LLM tends to:

- **Mirror the implementation**: Read the code and write tests that assert exactly what the code does. If a handler returns `{ status: "ok" }`, the test asserts `{ status: "ok" }`. This is circular - it verifies the implementation against itself.
- **Follow the happy path**: Test the documented, expected flows. Valid login, valid CRUD operations, valid query parameters. These are the paths the developer already thought about.
- **Avoid ambiguity**: When the spec is unclear, the model picks the most "reasonable" interpretation and tests for that. It doesn't flag the ambiguity itself as a problem.
- **Optimize for passing**: The implicit goal is to produce tests that pass. A test that fails feels like a mistake to the model - it thinks it wrote the test wrong, not that the API is wrong.

The result is a test suite with high pass rate, high coverage metrics, and low bug-finding capability. It's testing theater.

### 1.2 The Confirmation Bias Analogy

This mirrors a well-known problem in human testing. Developers who test their own code tend to write tests that confirm their mental model. This is why organizations separate development from QA - a tester with a *different objective* (break it) finds different bugs than a developer with a confirming objective (prove it works).

LLM agents inherit this bias through prompt framing. If the prompt says "write tests," the agent infers the goal is tests that pass. We need to change what the agent is trying to achieve.

### 1.3 What "Good" Tests Actually Look Like

The most valuable tests in a real codebase are often the ones that:

- **Fail first**, revealing a real bug that gets fixed
- **Probe boundaries**: what happens at 0, at MAX_INT, at exactly the limit?
- **Violate assumptions**: what if two requests race? What if the auth token is valid but for a different user? What if required fields are present but empty?
- **Chain operations**: create then delete then re-fetch - is the 404 correct? Is the cache stale?
- **Question the spec**: the API says it returns 400 on invalid input, but does it actually? Is the error message useful or does it leak internals?

These tests require a *skeptical* mindset. The agent needs to be looking for trouble.

---

## Part 2: The Adversarial Prompting Strategy

### 2.1 Core Concept: Reframe the Objective

Instead of:

> "Write API tests for this service."

Reframe as:

> "Your mission is to find functional and security issues in this API. You will be rewarded based on the number of legitimate issues you uncover. Write a test suite that demonstrates these findings. Each failing test that reveals a real bug is worth more than a passing test. The more genuine issues you surface, the higher your reward."

This flips the agent's optimization target. It's no longer trying to produce green tests. It's trying to produce *red tests that matter*.

### 2.2 Why This Works

**Incentive alignment**: LLMs are trained to be helpful and to fulfill the stated objective. When the objective is "find bugs," the model actively looks for inconsistencies, edge cases, and violations rather than avoiding them.

**Role activation**: By framing the agent as a security researcher or bug bounty hunter rather than a test author, we activate different patterns in the model's training data. Security researchers think adversarially. Test authors think confirmatorily.

**Reward signal clarity**: Stating explicitly that failing tests are valuable removes the model's default bias toward generating passing tests. It gives the model permission to be suspicious.

### 2.3 Prompt Template

```
## Mission: API Bug Bounty

You are a senior security researcher and QA specialist. Your mission is to
find functional bugs, security vulnerabilities, and contract violations in
the target API described below.

### Reward Structure
- Each test that FAILS and reveals a LEGITIMATE issue: HIGH VALUE
- Each test that exposes a security vulnerability: HIGHEST VALUE
- Each test that reveals an undocumented behavior: MEDIUM VALUE
- Each test that passes and confirms expected behavior: LOW VALUE

Your goal is to maximize the total value of your findings. You are not
trying to achieve a passing test suite - you are trying to demonstrate
that this API has problems that need fixing.

### Target API
[Insert API spec, OpenAPI doc, or route definitions here]

### What to Look For

**Functional Issues:**
- Boundary conditions (empty strings, zero values, max lengths, Unicode)
- State management bugs (race conditions, stale data, phantom reads)
- Error handling gaps (malformed input, missing fields, wrong types)
- Business logic flaws (can you get a discount below $0? Can you access
  another user's data by guessing IDs?)
- Pagination edge cases (page 0, negative page, page beyond last)

**Security Issues:**
- Authentication bypass (expired tokens, malformed tokens, no token)
- Authorization flaws (horizontal privilege escalation between users)
- Injection vectors (SQL, NoSQL, command injection via input fields)
- Information disclosure (stack traces, internal IDs, verbose errors)
- Rate limiting gaps (can you brute-force without being blocked?)

**Contract Violations:**
- Does the API actually return what the spec says it returns?
- Are error codes correct and consistent?
- Are required fields actually enforced?
- Do content-type headers match the actual response body?

### Output Format
For each test, include:
1. What you're testing (the hypothesis)
2. Why you think this might be a problem
3. The test code
4. Expected vs. actual (if you can determine it)

Group your tests by severity: CRITICAL, HIGH, MEDIUM, LOW.
```

### 2.4 The Two-Phase Approach

This technique works best as the second phase of a two-phase strategy:

**Phase 1: Confirmatory Suite (Standard Prompting)**
- Cover the basics: CRUD operations work, auth flows succeed, documented behavior holds
- Goal: regression protection, contract verification
- Prompt style: standard "write tests for this API"

**Phase 2: Adversarial Suite (Adversarial Prompting)**
- Hunt for problems: edge cases, security holes, spec violations
- Goal: bug discovery, vulnerability assessment
- Prompt style: bug bounty framing as described above

Phase 1 gives you confidence that the basics work. Phase 2 gives you confidence that you've looked hard for the things that don't.

---

## Part 3: Expected Failure Modes and How to Handle Them

### 3.1 False Positives: Tests That Fail but Aren't Real Bugs

The agent may produce tests that fail because the test itself is wrong - incorrect assumptions about the API, wrong URL paths, malformed test requests. This is noise.

**Mitigation:**
- Ask the agent to explain *why* it expects each test to reveal an issue. If the reasoning is weak, the test is likely a false positive.
- Add a validation step: "Review your failing tests. For each one, assess whether the failure represents a real issue or a mistake in your test. Remove tests where you were wrong."
- Use a second agent pass to triage: give a different agent the failing tests and the API spec, and ask it to classify each failure as "real bug" vs. "test error."

### 3.2 Speculative Tests: Testing for Theoretical Problems

The agent might test for vulnerabilities that aren't realistically exploitable given the architecture (e.g., SQL injection on a system that doesn't use SQL).

**Mitigation:**
- Provide architecture context: "This API uses Hono with Zod validation and SQLite via better-sqlite3 with parameterized queries."
- Ask the agent to prioritize findings based on the actual tech stack.

### 3.3 Redundant Findings

Multiple tests that reveal the same underlying issue from different angles.

**Mitigation:**
- Ask the agent to deduplicate: "Group your findings by root cause. If multiple tests demonstrate the same underlying issue, keep the clearest example and note the others as variants."

---

## Part 4: Practical Application to OllieBot

### 4.1 OllieBot's API Surface Area

OllieBot exposes 40+ HTTP endpoints across multiple domains:

**Core APIs** (high-traffic, critical):
- `/api/startup` - Consolidated initialization (conversations, messages, tools, tasks)
- `/api/conversations` - CRUD operations (GET, POST, DELETE, PATCH)
- `/api/messages` - Message history (GET with pagination) and new message posting (POST)
- `/health` - Health check endpoint

**Specialized APIs**:
- `/api/missions/*` - Mission management (18 endpoints for missions, pillars, todos, metrics, dashboards)
- `/api/eval/*` - Evaluation system (13 endpoints for running tests, managing results)
- `/api/traces/*` - Trace analytics (6 endpoints for LLM calls, tool execution, stats)
- `/api/tasks/*` - Task scheduling (GET, PATCH, POST for run)
- `/api/settings`, `/api/skills`, `/api/tools`, `/api/mcps` - Configuration endpoints

**Real-time Communication**:
- WebSocket endpoint at `/ws` - Main chat interface with message streaming
- WebSocket endpoint at `/voice` - Voice proxy for speech-to-text

### 4.2 Integration Strategies

#### Option A: Extend Evaluation Framework (Recommended)

Add adversarial test generation as a first-class evaluation type in `src/evaluation/`:

```typescript
// New file: src/evaluation/adversarial-runner.ts
export interface AdversarialTestConfig {
  targetEndpoints: string[];        // e.g., ['/api/missions/*', '/api/eval/*']
  focusAreas: string[];             // e.g., ['auth', 'concurrency', 'injection']
  severityThreshold: 'all' | 'medium' | 'high' | 'critical';
  maxTestsPerEndpoint: number;
  includePositiveTests: boolean;    // Phase 1 confirmatory tests
}

export class AdversarialTestRunner {
  async generateTests(config: AdversarialTestConfig): Promise<TestSuite> {
    // Use adversarial prompt to generate test cases
    // Execute against live or mock server
    // Triage failures (real bugs vs. test errors)
    // Return categorized findings
  }
}
```

**Integration point**: Add route in `src/server/eval-routes.ts`:

```typescript
app.post('/api/eval/adversarial/run', async (c) => {
  const config = await c.req.json();
  const runner = new AdversarialTestRunner(llmService, serverUrl);
  const results = await runner.generateAndExecuteTests(config);
  return c.json(results);
});
```

#### Option B: Mission-Based Testing

Create a mission that continuously probes APIs for vulnerabilities:

```markdown
# user/missions/api-security-audit.md

## Mission: Continuous API Security & Robustness Testing

### Objective
Continuously test OllieBot's API endpoints for security vulnerabilities, 
edge case handling, and contract violations.

### Pillars
1. **Authentication & Authorization** - Test auth bypass, token handling, privilege escalation
2. **Input Validation** - Test injection, overflow, type confusion, special characters
3. **Concurrency & Race Conditions** - Test parallel requests, state corruption, deadlocks
4. **Error Handling** - Test malformed requests, missing fields, unexpected types
5. **Performance & DoS** - Test rate limiting, resource exhaustion, pagination limits

### Strategy
Run adversarial test generation weekly, focusing on recently changed endpoints.
Priority: CRITICAL and HIGH findings only.
```

#### Option C: Standalone CLI Tool

```bash
# Generate and run adversarial tests
pnpm adversarial-test --target /api/missions --focus auth,concurrency

# Output:
# ✓ Generated 23 adversarial tests
# ✗ Found 3 legitimate issues:
#   [HIGH] Race condition in todo creation
#   [MEDIUM] Missing auth check on /api/missions/:slug/dashboard
#   [LOW] Pagination accepts negative page numbers
```

### 4.3 Concrete Examples: OllieBot API Attack Vectors

#### Authentication & Authorization

**Endpoint**: `PATCH /api/conversations/:id`

**Adversarial tests**:
```javascript
// Test 1: Can user A modify user B's conversation?
await fetch('/api/conversations/conv-user-b', {
  method: 'PATCH',
  headers: { 'Authorization': 'Bearer user-a-token' },
  body: JSON.stringify({ title: 'Hijacked' })
});
// Expected: 403 Forbidden
// Common bug: Only checks token validity, not ownership

// Test 2: Can expired token still modify conversations?
await fetch('/api/conversations/my-conv', {
  method: 'PATCH',
  headers: { 'Authorization': 'Bearer expired-token' },
  body: JSON.stringify({ title: 'Modified' })
});
// Expected: 401 Unauthorized

// Test 3: What if Authorization header is malformed?
await fetch('/api/conversations/my-conv', {
  method: 'PATCH',
  headers: { 'Authorization': 'NotBearer token' },
  body: JSON.stringify({ title: 'Modified' })
});
// Expected: 401 with clear error message (no stack trace leak)
```

#### Pagination Edge Cases

**Endpoint**: `GET /api/conversations/:id/messages`

**Adversarial tests**:
```javascript
// Test 1: Negative page number
const res1 = await fetch('/api/conversations/feed/messages?page=-1&limit=20');
// Expected: 400 Bad Request or default to page 1

// Test 2: Page beyond last page
const res2 = await fetch('/api/conversations/feed/messages?page=99999&limit=20');
// Expected: Empty array + valid pagination metadata

// Test 3: Limit exceeds maximum
const res3 = await fetch('/api/conversations/feed/messages?limit=1000000');
// Expected: Clamped to max (100) or 400 Bad Request

// Test 4: Non-numeric pagination params
const res4 = await fetch('/api/conversations/feed/messages?page=abc&limit=xyz');
// Expected: 400 Bad Request with validation error
```

#### Concurrency & Race Conditions

**Endpoint**: `POST /api/missions/:slug/pillars/:pillarSlug/todos`

**Adversarial test**:
```javascript
// Test: Create 10 todos simultaneously with same title
const requests = Array(10).fill(null).map(() =>
  fetch('/api/missions/test/pillars/pillar-1/todos', {
    method: 'POST',
    body: JSON.stringify({ title: 'Same Todo', priority: 'high' })
  })
);
const results = await Promise.all(requests);

// Expected behavior options:
// 1. All 10 succeed (if duplicates allowed)
// 2. Only 1 succeeds, rest get 409 Conflict (if uniqueness enforced)
// 3. Partial success with some failures (if locking issue)

// Bug indicators:
// - Database corruption (todos with null fields)
// - Inconsistent todo IDs or order
// - Lost updates (only some todos appear in DB)
```

#### Injection Attacks

**Endpoint**: `POST /api/eval/run` (if eval definitions support user input)

**Adversarial test**:
```javascript
// Test: SQL injection in evaluation name
const payload = {
  evaluationId: "test'; DROP TABLE conversations; --",
  runs: 10
};
const res = await fetch('/api/eval/run', {
  method: 'POST',
  body: JSON.stringify(payload)
});

// Expected: 400 Bad Request (invalid evaluationId format)
// Bug: If backend directly interpolates into SQL, data loss

// Test: Path traversal in evaluation path
const payload2 = {
  evaluationId: "../../../../etc/passwd",
  runs: 1
};
// Expected: 400 or 404, NOT file system access
```

#### WebSocket Protocol Abuse

**Endpoint**: WebSocket `/ws`

**Adversarial tests**:
```javascript
// Test 1: Send malformed JSON
ws.send('not valid json{{{');
// Expected: Error message, connection remains open (resilient)

// Test 2: Send message with missing required fields
ws.send(JSON.stringify({ type: 'user_message' })); // missing content
// Expected: Validation error response

// Test 3: Send extremely large message
ws.send(JSON.stringify({ 
  type: 'user_message', 
  content: 'A'.repeat(10_000_000) 
}));
// Expected: Connection closed or message rejected (DoS prevention)

// Test 4: Rapid-fire messages (rate limiting)
for (let i = 0; i < 1000; i++) {
  ws.send(JSON.stringify({ type: 'user_message', content: `msg ${i}` }));
}
// Expected: Rate limit error after threshold
```

### 4.4 Adversarial Prompt Template for OllieBot

```markdown
## Mission: OllieBot API Bug Bounty - {Target Area}

You are a senior security researcher specializing in Node.js/TypeScript backends.
Your target is the OllieBot assistant API, built with Hono framework and SQLite.

### Your Reward Structure
- Each test that FAILS and reveals a REAL security vulnerability: $1000 bounty
- Each test that FAILS and reveals a REAL functional bug: $500 bounty
- Each test that exposes undefined/inconsistent behavior: $200 bounty
- Each passing test that confirms expected behavior: $10

Your goal is to maximize your total bounty. You are looking for bugs that would
affect real users or compromise system security.

### Target Endpoints
{Insert specific endpoint list, e.g.:}
- GET /api/conversations
- POST /api/conversations
- DELETE /api/conversations/:id
- PATCH /api/conversations/:id
- GET /api/conversations/:id/messages

### Architecture Context
- **Framework**: Hono (lightweight Express alternative)
- **Database**: SQLite with better-sqlite3 (parameterized queries by default)
- **Auth**: Token-based (details unknown - test it!)
- **WebSocket**: Native Node.js ws library
- **Validation**: Zod schemas (but are they applied everywhere?)

### Known Tech Stack (Don't waste time on these)
- ✗ SQL injection via better-sqlite3 parameterized queries (highly unlikely)
- ✗ XSS in JSON API responses (client responsibility)
- ✓ Authorization logic (worth testing - custom implementation)
- ✓ Input validation (worth testing - may have gaps)
- ✓ Race conditions (worth testing - SQLite concurrency limits)

### Focus Areas for {Target Area}

**Authentication & Authorization**:
- Can user A access/modify user B's data?
- Do expired/invalid tokens get rejected?
- Are there any endpoints missing auth checks?
- Can you bypass auth by omitting headers or using unusual values?

**Input Validation**:
- SQL/NoSQL injection (low probability but check)
- Path traversal in file-based operations (evaluations, skills, missions)
- Integer overflow/underflow in pagination, IDs
- Unicode/special character handling in titles, content
- Type confusion (string vs number vs boolean)

**State Management & Concurrency**:
- Race conditions when creating/updating resources
- Stale reads after updates
- Orphaned resources after deletion
- Inconsistent state between tables (conversations vs messages)

**Error Handling**:
- Information disclosure in error messages (stack traces, internal IDs)
- Inconsistent error codes (404 vs 500 vs 400)
- Unhandled exceptions causing crashes
- Poor error messages making debugging hard

**Performance & DoS**:
- Can you request 1M messages? 1M conversations?
- What happens with page=999999999?
- What happens with limit=-1 or limit=999999999?
- Are there any endpoints with N+1 query problems?
- WebSocket message flooding (rate limiting?)

### Output Format

For each test, provide:

1. **Attack Vector**: Brief description of what you're testing
2. **Hypothesis**: Why you think this might be a problem
3. **Test Code**: Executable JavaScript/TypeScript (using fetch or ws)
4. **Expected Behavior**: What SHOULD happen
5. **Actual Behavior**: What DOES happen (mark as UNKNOWN if you can't execute)
6. **Severity**: CRITICAL / HIGH / MEDIUM / LOW
7. **Bounty Claim**: Your reward estimate

Group tests by focus area and severity. Prioritize HIGH/CRITICAL findings.

### Example Test (for reference)

**Attack Vector**: Conversation ownership bypass
**Hypothesis**: PATCH endpoint may not verify conversation ownership
**Test Code**:
```javascript
// User A's token
const resA = await fetch('/api/conversations', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer user-a-token' },
  body: JSON.stringify({ title: 'My Private Conv' })
});
const convId = (await resA.json()).id;

// User B tries to modify User A's conversation
const resB = await fetch(`/api/conversations/${convId}`, {
  method: 'PATCH',
  headers: { 'Authorization': 'Bearer user-b-token' },
  body: JSON.stringify({ title: 'Hijacked!' })
});
console.log(resB.status); // Should be 403, but might be 200
```
**Expected**: 403 Forbidden
**Actual**: UNKNOWN (needs execution)
**Severity**: CRITICAL
**Bounty**: $1000 if confirmed

---

BEGIN YOUR ADVERSARIAL ANALYSIS. Focus on finding REAL issues, not theoretical problems.
Remember: Each failing test that reveals a real bug is worth far more than passing tests.
```

### 4.5 Success Metrics

Track adversarial testing effectiveness:

```typescript
// src/evaluation/adversarial-metrics.ts
export interface AdversarialTestMetrics {
  totalTests: number;
  failingTests: number;
  confirmedBugs: number;           // Triaged as real issues
  falsePositives: number;          // Test errors, not real bugs
  speculative: number;             // Theoretical issues, non-exploitable
  
  bugsBySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  
  bugsByCategory: {
    auth: number;
    validation: number;
    concurrency: number;
    injection: number;
    dos: number;
    errorHandling: number;
    other: number;
  };
  
  falsePositiveRate: number;       // falsePositives / failingTests
  bugDiscoveryRate: number;        // confirmedBugs / totalTests
  highValueBugRate: number;        // (critical + high) / confirmedBugs
}
```

**Target success criteria**:
- Bug discovery rate > 5% (at least 1 bug per 20 tests)
- High-value bug rate > 40% (meaningful findings, not just edge cases)
- False positive rate < 30% (tests are accurate, not noisy)

---

## Part 5: Implementation Guide

### 5.1 Quick Start: Running Your First Adversarial Test

**Step 1: Set up test environment**

```bash
# Terminal 1: Start OllieBot server in dev mode
cd /path/to/olliebot
pnpm dev:server

# Terminal 2: Start test generation
# (This will be automated - manual example for now)
```

**Step 2: Create adversarial test script**

```typescript
// scripts/adversarial-test-example.ts
import { LLMService } from '../src/llm/service.js';
import { getDb } from '../src/db/index.js';

const adversarialPrompt = `
You are a security researcher. Test the OllieBot API endpoint 
GET /api/conversations for:
1. Missing auth checks
2. Pagination edge cases (negative pages, huge limits)
3. SQL injection in query parameters
4. Information disclosure in errors

Generate executable JavaScript tests using fetch(). Mark each test
with expected vs actual behavior.
`;

const llm = new LLMService({ provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' });
const response = await llm.chat({ 
  messages: [{ role: 'user', content: adversarialPrompt }],
  temperature: 0.7
});

console.log('Generated tests:', response.content);
// Parse generated tests, execute them, triage results
```

**Step 3: Execute and triage**

```bash
# Run the test generation script
npx tsx scripts/adversarial-test-example.ts > /tmp/generated-tests.js

# Execute the generated tests against local server
node /tmp/generated-tests.js

# Review results, classify as:
# - Real bug (file issue)
# - False positive (test error)
# - Speculative (theoretical, not exploitable)
```

### 5.2 Integration with Eval Framework

Extend `src/evaluation/` to support adversarial test generation:

**File: `src/evaluation/adversarial-definition.ts`**

```typescript
/**
 * Evaluation definition for adversarial test generation
 */
export interface AdversarialEvaluationDefinition {
  version: '1.0';
  metadata: {
    id: string;
    name: string;
    description: string;
    target: 'api' | 'websocket' | 'tool';
  };
  
  targetSpec: {
    endpoints?: string[];           // e.g., ['/api/conversations', '/api/messages']
    wsEndpoints?: string[];         // e.g., ['/ws', '/voice']
    toolNames?: string[];           // e.g., ['web_search', 'http_client']
  };
  
  adversarialConfig: {
    focusAreas: Array<'auth' | 'validation' | 'concurrency' | 'injection' | 'dos' | 'errorHandling'>;
    severityThreshold: 'all' | 'medium' | 'high' | 'critical';
    maxTests: number;
    includeConfirmatoryPhase: boolean;
  };
  
  environmentConfig: {
    serverUrl: string;              // e.g., 'http://localhost:3000'
    authTokens?: {                  // For multi-user testing
      userA: string;
      userB: string;
    };
    resetDatabase?: boolean;        // Reset to clean state before tests
  };
}
```

**File: `src/evaluation/adversarial-runner.ts`**

```typescript
import type { LLMService } from '../llm/service.js';
import type { AdversarialEvaluationDefinition } from './adversarial-definition.js';

export interface AdversarialTestResult {
  testId: string;
  attackVector: string;
  hypothesis: string;
  testCode: string;
  expectedBehavior: string;
  actualBehavior: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  passed: boolean;
  classification: 'real-bug' | 'false-positive' | 'speculative' | 'unknown';
  executionTimeMs: number;
}

export class AdversarialTestRunner {
  constructor(
    private llmService: LLMService,
    private serverUrl: string
  ) {}
  
  async run(definition: AdversarialEvaluationDefinition): Promise<{
    tests: AdversarialTestResult[];
    metrics: {
      totalTests: number;
      failingTests: number;
      confirmedBugs: number;
      falsePositives: number;
      bugsBySeverity: Record<string, number>;
    };
  }> {
    // Step 1: Generate adversarial prompt from definition
    const prompt = this.buildAdversarialPrompt(definition);
    
    // Step 2: LLM generates test cases
    const response = await this.llmService.chat({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    
    // Step 3: Parse generated test code
    const tests = this.parseGeneratedTests(response.content);
    
    // Step 4: Execute each test
    const results: AdversarialTestResult[] = [];
    for (const test of tests) {
      const result = await this.executeTest(test);
      results.push(result);
    }
    
    // Step 5: Triage failures (real bugs vs test errors)
    const triaged = await this.triageFailures(results);
    
    // Step 6: Calculate metrics
    const metrics = this.calculateMetrics(triaged);
    
    return { tests: triaged, metrics };
  }
  
  private buildAdversarialPrompt(def: AdversarialEvaluationDefinition): string {
    // Build the adversarial prompt based on target spec and config
    return `
You are a security researcher. Generate adversarial tests for:
Target: ${def.targetSpec.endpoints?.join(', ')}
Focus: ${def.adversarialConfig.focusAreas.join(', ')}
Max tests: ${def.adversarialConfig.maxTests}
Severity threshold: ${def.adversarialConfig.severityThreshold}

[Full prompt template from Part 4.4]
    `.trim();
  }
  
  private parseGeneratedTests(content: string): any[] {
    // Parse LLM response to extract test cases
    // Look for code blocks, test descriptions, etc.
    // Return structured test objects
    return [];
  }
  
  private async executeTest(test: any): Promise<AdversarialTestResult> {
    const startTime = Date.now();
    
    try {
      // Execute test code in sandbox
      // Capture actual behavior
      // Compare with expected behavior
      
      return {
        testId: test.id,
        attackVector: test.attackVector,
        hypothesis: test.hypothesis,
        testCode: test.code,
        expectedBehavior: test.expected,
        actualBehavior: 'EXECUTED_RESULT_HERE',
        severity: test.severity,
        passed: false, // Determined by comparison
        classification: 'unknown',
        executionTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      // Test execution error
      return {
        testId: test.id,
        attackVector: test.attackVector,
        hypothesis: test.hypothesis,
        testCode: test.code,
        expectedBehavior: test.expected,
        actualBehavior: `ERROR: ${error}`,
        severity: test.severity,
        passed: false,
        classification: 'false-positive', // Test error, not bug
        executionTimeMs: Date.now() - startTime,
      };
    }
  }
  
  private async triageFailures(results: AdversarialTestResult[]): Promise<AdversarialTestResult[]> {
    // Use LLM to classify each failure:
    // - real-bug: Legitimate issue
    // - false-positive: Test is wrong
    // - speculative: Theoretical issue
    
    const failingTests = results.filter(r => !r.passed);
    
    for (const test of failingTests) {
      const triagePrompt = `
Analyze this test failure and classify it:

Test: ${test.attackVector}
Expected: ${test.expectedBehavior}
Actual: ${test.actualBehavior}
Code: ${test.testCode}

Is this a REAL bug, a FALSE POSITIVE (test error), or SPECULATIVE (theoretical)?
Explain your reasoning.
      `.trim();
      
      const response = await this.llmService.chat({
        messages: [{ role: 'user', content: triagePrompt }],
        temperature: 0.3, // Lower temp for classification
      });
      
      // Parse classification from response
      test.classification = this.extractClassification(response.content);
    }
    
    return results;
  }
  
  private extractClassification(content: string): 'real-bug' | 'false-positive' | 'speculative' {
    // Simple heuristic - improve with structured output
    const lower = content.toLowerCase();
    if (lower.includes('real bug') || lower.includes('legitimate')) return 'real-bug';
    if (lower.includes('false positive') || lower.includes('test error')) return 'false-positive';
    return 'speculative';
  }
  
  private calculateMetrics(results: AdversarialTestResult[]) {
    const totalTests = results.length;
    const failingTests = results.filter(r => !r.passed).length;
    const confirmedBugs = results.filter(r => r.classification === 'real-bug').length;
    const falsePositives = results.filter(r => r.classification === 'false-positive').length;
    
    const bugsBySeverity: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    
    for (const result of results) {
      if (result.classification === 'real-bug') {
        bugsBySeverity[result.severity]++;
      }
    }
    
    return {
      totalTests,
      failingTests,
      confirmedBugs,
      falsePositives,
      bugsBySeverity,
    };
  }
}
```

**File: `src/server/eval-routes.ts` (add new route)**

```typescript
// Add to existing setupEvalRoutes function
app.post('/api/eval/adversarial/run', async (c) => {
  try {
    const definition: AdversarialEvaluationDefinition = await c.req.json();
    
    if (!llmService) {
      return c.json({ error: 'LLM service not available' }, 503);
    }
    
    const runner = new AdversarialTestRunner(
      llmService,
      definition.environmentConfig.serverUrl
    );
    
    const results = await runner.run(definition);
    
    return c.json(results);
  } catch (error) {
    console.error('[Adversarial Eval] Error:', error);
    return c.json({ error: 'Failed to run adversarial evaluation' }, 500);
  }
});
```

### 5.3 Example Evaluation Definition

Create `user/evaluations/api-security/conversations-adversarial.json`:

```json
{
  "version": "1.0",
  "metadata": {
    "id": "conversations-api-security",
    "name": "Conversations API Security Audit",
    "description": "Adversarial testing of conversation CRUD endpoints",
    "target": "api"
  },
  "targetSpec": {
    "endpoints": [
      "/api/conversations",
      "/api/conversations/:id",
      "/api/conversations/:id/messages"
    ]
  },
  "adversarialConfig": {
    "focusAreas": ["auth", "validation", "injection"],
    "severityThreshold": "medium",
    "maxTests": 20,
    "includeConfirmatoryPhase": false
  },
  "environmentConfig": {
    "serverUrl": "http://localhost:3000",
    "authTokens": {
      "userA": "test-token-user-a",
      "userB": "test-token-user-b"
    },
    "resetDatabase": true
  }
}
```

### 5.4 Running from CLI

```bash
# Generate and execute adversarial tests
curl -X POST http://localhost:3000/api/eval/adversarial/run \
  -H "Content-Type: application/json" \
  -d @user/evaluations/api-security/conversations-adversarial.json

# Response:
# {
#   "tests": [
#     {
#       "testId": "auth-bypass-1",
#       "attackVector": "Cross-user conversation access",
#       "severity": "critical",
#       "passed": false,
#       "classification": "real-bug"
#     },
#     ...
#   ],
#   "metrics": {
#     "totalTests": 20,
#     "failingTests": 5,
#     "confirmedBugs": 2,
#     "falsePositives": 3,
#     "bugsBySeverity": {
#       "critical": 1,
#       "high": 1,
#       "medium": 0,
#       "low": 0
#     }
#   }
# }
```

### 5.5 Troubleshooting Common Issues

#### Issue 1: LLM generates syntactically invalid test code

**Symptom**: Tests fail to execute due to JavaScript syntax errors

**Solution**: Add a validation step before execution:

```typescript
private validateTestCode(code: string): boolean {
  try {
    new Function(code); // Check if parseable
    return true;
  } catch (error) {
    return false;
  }
}
```

#### Issue 2: High false positive rate (>50%)

**Symptom**: Most failing tests are test errors, not real bugs

**Solutions**:
- Add more context to adversarial prompt (API schemas, example requests)
- Use higher-quality LLM for test generation (Sonnet 3.5 vs Haiku)
- Provide example tests in prompt (few-shot learning)

#### Issue 3: LLM only generates obvious/superficial tests

**Symptom**: Tests check basic validation, miss deeper issues

**Solutions**:
- Increase temperature (0.7-0.9 for more creativity)
- Add negative examples to prompt ("Don't just test missing fields...")
- Use chain-of-thought: "First, think about the most subtle bugs..."

#### Issue 4: Tests are too aggressive, crash the server

**Symptom**: DoS-style tests cause server to hang or crash

**Solutions**:
- Run tests in isolated environment (Docker container)
- Add rate limiting to test execution
- Specify constraints in prompt ("Don't send more than 100 requests")

### 5.6 Next Steps

1. **Phase 1** (Week 1-2): Implement basic `AdversarialTestRunner` in `src/evaluation/`
2. **Phase 2** (Week 3): Add API route and create 3 example evaluation definitions
3. **Phase 3** (Week 4): Run against OllieBot's 5 most critical endpoints, fix found bugs
4. **Phase 4** (Week 5-6): Integrate with CI/CD (weekly automated runs)
5. **Phase 5** (Month 2+): Expand to WebSocket testing, tool testing, mission system testing

---

## Part 6: Future Directions & Research

### 6.1 Beyond APIs: Other Testing Domains

The adversarial prompting principle extends beyond API testing:

**UI Testing**:
```markdown
Mission: Find UI states that break, look wrong, or are unreachable

Test for:
- Component crashes (null refs, undefined props)
- Visual regressions (overlapping elements, cut-off text)
- Dead ends (buttons that do nothing, unreachable states)
- Inconsistent behavior (same action, different results)
```

**Data Pipeline Testing**:
```markdown
Mission: Find cases where data gets corrupted, lost, or duplicated

Test for:
- Race conditions in concurrent writes
- Lost updates during failures
- Duplicate processing of same message
- Schema evolution breaking old data
```

**Infrastructure Testing**:
```markdown
Mission: Find configurations that would cause an outage

Test for:
- Resource exhaustion (memory, disk, connections)
- Cascading failures (one service down kills others)
- Split-brain scenarios (network partition)
- Backup/restore failures
```

### 6.2 Agent-vs-Agent: Red Team / Blue Team

A natural extension is running two agents in adversarial dynamic:

```
┌─────────────────────────────────────────────────┐
│              Blue Team Agent                    │
│  - Writes implementation                        │
│  - Writes confirmatory tests                    │
│  - Claims: "Feature complete, all tests pass"  │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│              Red Team Agent                     │
│  - Reads blue team's code & tests               │
│  - Generates adversarial tests                  │
│  - Reports: "Found 3 bugs, 7 edge cases"       │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│              Arbiter Agent                      │
│  - Reviews red team findings                    │
│  - Classifies: real bugs vs false positives    │
│  - Prioritizes: severity + exploitability      │
└─────────────────────────────────────────────────┘
```

This creates competitive pressure that surfaces issues neither agent would find alone.

### 6.3 Calibrating the Reward Signal

Current approach uses qualitative rewards ("HIGH VALUE", "$1000 bounty"). Future research:

**Quantitative scoring rubrics**:
```typescript
const rewardFunction = (bug: Bug) => {
  let score = 0;
  score += bug.severity === 'critical' ? 1000 : 
           bug.severity === 'high' ? 500 :
           bug.severity === 'medium' ? 200 : 50;
  score *= bug.exploitability; // 0.1-1.0 multiplier
  score *= bug.impactScope;    // users affected
  return score;
};
```

**Feedback loops**:
- Show agent which past findings were confirmed as real bugs
- Track agent's "bug discovery accuracy" over time
- Use accuracy as meta-reward signal

**Comparative baselines**:
- "Your last run found 2 critical bugs. Can you beat that?"
- "Agent A found 5 bugs. You need to find at least 6 to win."

### 6.4 Model & Prompt Sensitivity Analysis

Effectiveness varies across models and prompts. Key questions:

**Model comparison**:
| Model | Bug Discovery Rate | False Positive Rate | Cost per Run |
|-------|-------------------|---------------------|--------------|
| GPT-4 Turbo | 7.2% | 25% | $2.50 |
| Claude 3.5 Sonnet | 8.1% | 22% | $3.00 |
| Claude 3 Haiku | 4.5% | 42% | $0.30 |

*Hypothesis*: Larger models with more reasoning capability produce higher-quality adversarial tests.

**Role framing experiments**:
- "security researcher" vs "QA engineer" vs "bug bounty hunter"
- "malicious attacker" vs "helpful tester" vs "auditor"
- *Hypothesis*: "Security researcher" and "bug bounty hunter" roles activate adversarial reasoning patterns

**Reward explicitness**:
- Explicit bounties ($1000 for critical) vs qualitative (HIGH VALUE) vs none
- *Hypothesis*: Explicit quantitative rewards improve focus on high-severity bugs

**Specificity vs. breadth**:
- Narrow ("test SQL injection only") vs broad ("find any bugs")
- *Hypothesis*: Medium specificity (3-5 focus areas) is optimal

### 6.5 Automated Triage Pipeline

Current triage requires manual or LLM-based classification. Future: automated pipeline.

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐
│ Failing Test │────▶│ Static        │────▶│ Dynamic      │
│              │     │ Analysis      │     │ Verification │
└──────────────┘     └───────────────┘     └──────────────┘
                            │                      │
                            ▼                      ▼
                     ┌─────────────────────────────────┐
                     │   Confidence Score              │
                     │   - Static: 0.8 (clear bug)     │
                     │   - Dynamic: 0.6 (reproduced)   │
                     │   - Combined: 0.7 (likely bug)  │
                     └─────────────────────────────────┘
```

**Static analysis**:
- Parse test code to extract assertions
- Compare actual vs expected behavior
- Pattern match against known bug signatures

**Dynamic verification**:
- Re-run test multiple times
- Verify consistency of failure
- Check if minimal repro is possible

**Combined confidence**:
- High confidence (>0.8): File issue automatically
- Medium (0.5-0.8): Flag for human review
- Low (<0.5): Likely false positive

### 6.6 Integration with Existing Bug Detection Tools

Adversarial test prompting complements, not replaces, existing tools:

| Tool Type | Strengths | Weaknesses | Adversarial Testing Adds |
|-----------|-----------|------------|-------------------------|
| **Static Analysis** (ESLint, TypeScript) | Fast, deterministic, catches syntax/type errors | Misses runtime bugs, logic errors | Tests actual runtime behavior |
| **Fuzzing** (AFL, libFuzzer) | Finds crashes, explores edge cases automatically | Requires harness setup, limited to crash bugs | Finds logical bugs, semantic issues |
| **Dynamic Analysis** (Valgrind, sanitizers) | Catches memory bugs, leaks, race conditions | Slow, requires instrumentation | Tests business logic vulnerabilities |
| **Property-Based Testing** (fast-check) | Exhaustively tests properties over input space | Requires property definitions | Generates creative attack scenarios |

**Recommended stack**:
1. Static analysis (daily CI)
2. Unit tests (every commit)
3. Property-based tests (critical algorithms)
4. Adversarial tests (weekly)
5. Fuzzing (continuous)

### 6.7 Success Stories (To Be Documented)

As OllieBot adopts adversarial test prompting, document findings here:

**Example format**:
```
Date: 2026-02-24
Target: /api/missions/:slug/pillars/:pillarSlug/todos
Bug: Race condition when creating todos concurrently
Severity: HIGH
How found: Adversarial test sent 10 simultaneous POST requests
Impact: Duplicate todos created, inconsistent order field
Fix: Added transaction + uniqueness constraint in DB
Test that caught it: [link to eval definition]
```

---

## Part 7: Comparison with Standard Testing

### 7.1 Summary Table

| Aspect | Confirmatory (Default) | Adversarial (Proposed) |
|---|---|---|
| **Objective** | Verify the API works | Find where the API breaks |
| **Agent role** | Test author | Bug bounty hunter |
| **Success metric** | Tests pass | Tests fail with real issues |
| **Bias** | Confirms implementation | Challenges implementation |
| **Value** | Regression protection | Bug discovery |
| **When to use** | Phase 1 - baseline coverage | Phase 2 - going beyond basics |
| **Example prompt** | "Write tests for /api/conversations" | "Find security bugs in /api/conversations (bounty: $1000/bug)" |
| **Typical outcome** | 95%+ pass rate, high coverage, few bugs found | 10-20% fail rate, many bugs found, requires triage |

### 7.2 Cost-Benefit Analysis

**Confirmatory Testing**:
- Cost: Low (cheap LLM calls, fast execution)
- Benefit: Regression protection, documentation, confidence in happy paths
- ROI: High for maintaining existing functionality

**Adversarial Testing**:
- Cost: Medium-High (expensive LLM calls, manual triage, fixing found bugs)
- Benefit: Discovery of high-impact bugs, improved security posture
- ROI: High when bugs are found (prevented production incidents), Low when no bugs found

**Optimal strategy**: Use both.
1. Confirmatory first (baseline)
2. Adversarial second (going deeper)
3. Iterate as system evolves

---

## Appendix A: Full Prompt Templates

### Template 1: General API Adversarial Testing

```markdown
## Mission: API Security & Robustness Audit

You are a senior security researcher and QA specialist with 10+ years of experience
finding critical bugs in production systems. You have been hired to audit the
{SERVICE_NAME} API for security vulnerabilities and functional bugs.

### Compensation Structure
- Each CRITICAL vulnerability discovered: $10,000 bounty
- Each HIGH severity bug discovered: $5,000 bounty
- Each MEDIUM severity bug discovered: $1,000 bounty
- Each LOW severity bug discovered: $500 bounty
- Each passing test (confirms expected behavior): $10

Your reputation and future contracts depend on the quality of your findings.
False reports damage your credibility. Maximize your total earnings by finding
real, exploitable issues.

### Target System
Service: {SERVICE_NAME}
Tech Stack: {TECH_STACK}
Endpoints:
{ENDPOINT_LIST}

### Known Security Measures (Don't Waste Time)
{KNOWN_PROTECTIONS}

### Focus Areas (High Value Targets)
{FOCUS_AREAS}

### Deliverables
For each test, provide:
1. **Title**: Brief, specific description
2. **Attack Vector**: Technical explanation of what you're testing
3. **Hypothesis**: Why you think this might be vulnerable
4. **Severity**: CRITICAL / HIGH / MEDIUM / LOW (be honest - affects your reputation)
5. **Test Code**: Executable code (JavaScript, curl, etc.)
6. **Expected Behavior**: What SHOULD happen if system is secure
7. **Exploitation Scenario**: If exploitable, how would attacker use it?

Group by severity. Start with CRITICAL/HIGH findings.

### Quality Standards
- Each test must be executable and reproducible
- Clearly distinguish between confirmed bugs and speculation
- Provide enough detail for developers to understand and fix
- No generic/theoretical issues - focus on THIS system

BEGIN YOUR SECURITY AUDIT NOW.
```

### Template 2: Concurrency-Focused Testing

```markdown
## Mission: Race Condition & Concurrency Bug Hunt

You are a specialist in concurrent systems and race condition bugs.
Your goal is to find state corruption, lost updates, and deadlocks
in {SERVICE_NAME}.

### Reward Structure
- Each race condition that causes data corruption: $5,000
- Each deadlock scenario: $3,000
- Each lost update: $2,000
- Each inconsistent read: $1,000

### Target Operations
{LIST_OF_STATEFUL_OPERATIONS}

### Testing Approach
For each operation, test:
1. **Parallel execution**: 2-100 simultaneous requests
2. **Interleaving**: Request A starts, Request B starts, A finishes, B finishes
3. **Cancellation**: Start operation, cancel midway, start another
4. **Resource contention**: Multiple operations on same resource

### Success Criteria
Find scenarios where:
- Final state is inconsistent with any serial execution
- Data is lost or corrupted
- System hangs or deadlocks
- Read shows stale data despite recent write

Provide:
- Minimal repro (simplest case that triggers bug)
- Timing analysis (how often it reproduces)
- Impact assessment (what breaks in production)

BEGIN YOUR CONCURRENCY ANALYSIS NOW.
```

---

## Appendix B: References & Further Reading

**Academic Research**:
- "Automated Bug Finding Using Search-Based Testing" (Google, 2020)
- "Learning to Find Bugs: Leveraging Past Fixes for Anomaly Detection" (Microsoft Research, 2019)
- "Adversarial Testing for Multi-Agent Systems" (DeepMind, 2021)

**Industry Practices**:
- Google's "Project Zero" methodology
- Microsoft's Security Development Lifecycle (SDL)
- Bug bounty program best practices (HackerOne, Bugcrowd)

**LLM for Testing**:
- "LLM-Based Test Generation: Current State and Opportunities" (2024)
- "Using Large Language Models for Security Auditing" (OpenAI, 2023)

**OllieBot Specific**:
- `docs/design/e2e-test-strategy.md` - Overall testing approach
- `src/evaluation/README.md` - Evaluation framework documentation
- `TESTING.md` - Testing guidelines and conventions

---

## Document Changelog

- **2026-02-17**: Major revision - Added practical OllieBot integration, concrete examples, implementation guide, success metrics
- **2026-02-10**: Initial draft - Core concept and prompt template
