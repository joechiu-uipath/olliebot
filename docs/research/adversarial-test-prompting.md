# Adversarial Test Prompting: Incentivizing Agents to Find Real Bugs

## Executive Summary

When we ask an LLM agent to "write API tests for this service," the resulting tests overwhelmingly confirm existing behavior. They verify that endpoints return 200, that valid inputs produce expected outputs, and that the documented contract holds. These are **confirmatory tests** - they tell you the system does what it already does.

This document proposes an alternative prompting strategy: **adversarial test prompting**. Instead of asking the agent to verify functionality, we reframe the mission so the agent is rewarded for *discovering legitimate issues* - functional bugs, edge cases, security vulnerabilities, contract violations, and data integrity problems. The key insight is that the agent's objective function determines the quality of the tests it writes, and confirmation is a fundamentally different objective than discovery.

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

## Part 4: Application to OllieBot

### 4.1 Where This Fits

OllieBot already has an evaluation framework in `src/evaluation/`. The adversarial test prompting strategy could be integrated as:

1. **A mission type**: A mission that takes an API spec (or discovered routes) and produces an adversarial test report.
2. **A skill**: A user-invocable skill that runs adversarial analysis against a specified API.
3. **Part of the eval framework**: Extend the existing eval system to include adversarial test generation as an evaluation strategy.

### 4.2 Workflow in OllieBot Context

```
User: "Run adversarial testing against /api/missions endpoints"

OllieBot (Supervisor):
  1. Reads route definitions from src/server/
  2. Delegates to Worker with adversarial prompt template
  3. Worker generates test suite targeting the API
  4. Worker executes tests against local dev server
  5. Collects results, triages failures
  6. Reports findings grouped by severity
```

### 4.3 Self-Testing Use Case

OllieBot could use this technique on its own API endpoints. The server exposes HTTP and WebSocket endpoints - an adversarial test suite could probe for:

- WebSocket message injection or malformed frame handling
- Authentication gaps in API routes
- Race conditions in concurrent mission execution
- Memory leaks from unclosed connections
- Input validation gaps in tool execution payloads

---

## Part 5: Broader Implications and Future Directions

### 5.1 Beyond APIs: Adversarial Prompting for Any Testing Domain

The same principle applies to:

- **UI testing**: "Find UI states that break, look wrong, or are unreachable" vs. "verify the UI works"
- **Data pipeline testing**: "Find cases where data gets corrupted, lost, or duplicated" vs. "verify the pipeline processes data"
- **Infrastructure testing**: "Find configurations that would cause an outage" vs. "verify the infrastructure is configured correctly"

The pattern is always the same: reframe from "confirm it works" to "find where it doesn't."

### 5.2 Agent-vs-Agent: Red Team / Blue Team

A natural extension is running two agents:

- **Blue team agent**: Writes the implementation and confirmatory tests
- **Red team agent**: Runs adversarial analysis against the blue team's work
- **Arbiter agent**: Triages the red team's findings and determines which are legitimate

This creates an adversarial dynamic that surfaces issues neither agent would find alone.

### 5.3 Calibrating the Reward Signal

The prompt template uses qualitative reward language ("HIGH VALUE", "HIGHEST VALUE"). Future iterations could experiment with:

- Quantitative scoring rubrics
- Example findings at each severity level to calibrate expectations
- Feedback loops where the agent sees which of its past findings were confirmed as real bugs

### 5.4 Prompt Sensitivity

The effectiveness likely varies across models and model versions. Key variables to experiment with:

- **Role framing**: "security researcher" vs. "QA engineer" vs. "bug bounty hunter" - do different roles activate different strategies?
- **Reward explicitness**: How much does explicitly stating the reward structure matter vs. just asking to find bugs?
- **Specificity**: Does pointing the agent at specific vulnerability categories improve signal, or does it narrow the search too much?

---

## Summary

| Aspect | Confirmatory (Default) | Adversarial (Proposed) |
|---|---|---|
| **Objective** | Verify the API works | Find where the API breaks |
| **Agent role** | Test author | Bug bounty hunter |
| **Success metric** | Tests pass | Tests fail with real issues |
| **Bias** | Confirms implementation | Challenges implementation |
| **Value** | Regression protection | Bug discovery |
| **When to use** | Phase 1 - baseline coverage | Phase 2 - going beyond basics |

The core insight is simple: **the way you ask determines what you get**. Ask an agent to write tests, and it writes tests that pass. Ask an agent to find bugs, and it finds bugs. Adversarial test prompting is just aligning the agent's incentive with what you actually want - not confirmation that everything is fine, but discovery of everything that isn't.
