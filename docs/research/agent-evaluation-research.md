# Agentic Loop Evaluation: Landscape Research

> **Date**: March 2026
> **Context**: OllieBot has a built-in eval system (`src/evaluation/`) for learning purposes. This document surveys industrial-strength evaluation — the tools, science, and practices used by teams shipping production agentic systems — to inform decisions about adopting or integrating a serious eval workflow.

---

## Table of Contents

1. [Science & State of the Art](#1-science--state-of-the-art)
   - [1.1 Can You Trust LLM-as-Judge?](#11-can-you-trust-llm-as-judge)
   - [1.2 Evaluation Methodologies](#12-evaluation-methodologies-beyond-llm-as-judge)
   - [1.3 Eval Dataset Formats](#13-eval-dataset-formats--schemas)
   - [1.4 Prompt Externalization vs Whole-Agent Evaluation](#14-prompt-externalization-vs-whole-agent-evaluation)
   - [1.5 Eval-Driven Development](#15-eval-driven-development-the-emerging-workflow)
2. [Evaluation Platforms & Services](#2-evaluation-platforms--services)
   - [2.1 Platform Comparison Matrix](#21-platform-comparison-matrix)
   - [2.2 Deep Dives](#22-deep-dives-on-key-platforms)
   - [2.3 Integration Effort](#23-integration-effort--code-bending)
3. [Evaluation as Integral Agent-Building Function](#3-evaluation-as-integral-agent-building-function)
   - [3.1 How Major Players Handle It](#31-how-major-players-handle-evaluation)
   - [3.2 Least Common Denominator](#32-least-common-denominator)
   - [3.3 Differentiators That Actually Matter](#33-differentiators-that-actually-matter)
   - [3.4 Relationship to OllieBot's Eval System](#34-relationship-to-olliebots-eval-system)
4. [Sources & References](#4-sources--references)

---

## 1. Science & State of the Art

### 1.1 Can You Trust LLM-as-Judge?

The short answer: **conditionally yes, but never blindly**. LLM-as-judge is not a random number generator, but it is not a neutral arbiter either. The research paints a nuanced picture.

#### Agreement with Humans

| Context | Metric | Value | Source |
|---------|--------|-------|--------|
| General preferences | Agreement rate | >80% | [Survey on LLM-as-a-Judge](https://arxiv.org/abs/2411.15594) |
| Bloom behavioral eval | Spearman correlation (Opus 4.1) | 0.86 | [Anthropic Bloom](https://alignment.anthropic.com/2025/bloom-auto-evals/) |
| Bloom behavioral eval | Spearman correlation (Sonnet 4.5) | 0.75 | [Anthropic Bloom](https://alignment.anthropic.com/2025/bloom-auto-evals/) |
| Expert domains (dietetics, mental health) | Agreement rate | 60-68% | [Can You Trust LLM Judgments?](https://arxiv.org/html/2412.12509v2) |
| Extractive QA | Pearson correlation | 0.85 | [Can You Trust LLM Judgments?](https://arxiv.org/html/2412.12509v2) |
| High inter-human agreement domains | Scott's Pi (GPT-4, Llama-3 70B) | 0.88 | [Judge's Verdict benchmark](https://openreview.net/forum?id=jVyUlri4Rw) |

**Key insight**: In well-specified tasks with clear criteria, LLM judges are genuinely useful. In expert domains requiring specialized knowledge, they fall short substantially. The gap is not about LLM capability but about how well the evaluation criteria can be specified.

#### Known Biases (The Real Problem)

LLM-as-judge does NOT return random numbers. It returns **systematically biased** numbers. That is both better and worse than random — better because the bias is predictable and correctable, worse because uncorrected bias creates false confidence.

| Bias | What Happens | Severity | Key Finding |
|------|-------------|----------|-------------|
| **Position Bias** | Judges favor responses based on presentation order. Swapping order shifts scores by >10%. Bias *increases* with more candidates. | High | GPT-4-0613 shows stronger positional preferences than GPT-3.5, which is fairer but less consistent ([NeurIPS 2023](https://neurips.cc/virtual/2023/poster/73434)) |
| **Verbosity Bias** | Judges prefer longer outputs regardless of quality. Human experts preferred concise summaries; LLMs rated long walkthroughs highly. | High | May partly be a manifestation of position bias after controlling for quality gap ([Justice or Prejudice?](https://arxiv.org/html/2410.02736v1)) |
| **Self-Enhancement** | LLMs assign higher scores to outputs with lower perplexity — i.e., text that "feels familiar" regardless of whether it was self-generated. | Medium | The bias is fundamentally about familiarity (perplexity), not self-generation ([arxiv:2410.21819](https://arxiv.org/html/2410.21819v2)) |
| **Authority Bias** | Fake authorities (quotes, book references) interfere with judgment. | Medium | URL citations showed least interference |
| **Rich Content Bias** | Preference for scholarly-appearing responses regardless of validity. | Medium | Part of 12 bias types cataloged by [CALM framework](https://llm-judge-bias.github.io/) |
| **Fallacy Oversight** | Judges may ignore logical errors in reasoning. | Medium | Documented but less studied |

#### Mitigation Strategies (Ranked by Effectiveness)

1. **Multi-model ensemble / majority voting**: Use judges from different model families (Claude + GPT-4 + Gemini). Most effective single mitigation. Majority voting across diverse families can eliminate familial biases.

2. **Position randomization/swapping**: Swap positions of responses A and B, average scores. Wang et al. (2024) proposed a calibration framework specifically for this. Essential for any pairwise comparison.

3. **Chain-of-thought judging**: Instruct judges to explain reasoning step-by-step before outputting a score. Significantly improves alignment with human judgments vs. bare numeric output.

4. **Calibration with anchor examples**: Pre-graded samples in the judge prompt anchor the scoring scale and improve consistency.

5. **Uncertainty quantification**: Analyze log token probabilities to get per-instance reliability indicators. Judgments marked "low uncertainty" achieve up to 100% accuracy in some benchmarks ([Wagner et al., 2024](https://arxiv.org/html/2412.12509v2)).

6. **Weighted ensemble for self-preference**: When a model exhibits low perplexity on a sample, decrease that model's evaluation weight for that sample.

7. **Separate generator and judge models**: Using distinct models for generation and judgment eliminates the self-enhancement feedback loop.

8. **PAIRS (Pairwise-Preference Search)**: Combines multiple evidence calibration, balanced position calibration, and human-in-the-loop calibration.

**Bottom line**: A well-calibrated LLM judge using strategies 1-4 is a viable complement to human evaluation for well-specified tasks. For expert domains, human-in-the-loop hybrid workflows remain essential. CMU's 2025 [perspectivist framework](https://blog.ml.cmu.edu/2025/12/09/validating-llm-as-a-judge-systems-under-rating-indeterminacy/) argues that forced-choice ratings are fundamentally flawed — rater disagreement is signal to preserve, not noise to eliminate.

---

### 1.2 Evaluation Methodologies Beyond LLM-as-Judge

The field has developed several complementary methodologies. No single approach is sufficient for agentic systems.

#### Outcome-Based Evaluation

Evaluates only the final result. Simplest to implement.

- **The critical distinction**: Check the *environment state*, not what the agent *says* it did. Did the reservation actually appear in the database, or did the agent only claim it was booked? Anthropic's guidance: "Grade outcomes rather than the path agents take."
- **Limitation**: Misses process failures entirely. An agent that gets the right answer through a lucky combination of wrong steps will score identically to one that reasons correctly.

#### Trajectory / Process-Based Evaluation

Examines the agent's plan, tool-call sequence, intermediate outputs, state transitions, and error recovery.

- **Why it matters**: Many real failures are process failures — bad plans, redundant tool use, infinite loops, skipped diagnostic steps.
- **Langfuse's three-level framework**:
  - **Final Response (Black-Box)**: Tells you *what* went wrong
  - **Trajectory (Glass-Box)**: Tells you *where* in the reasoning it went wrong
  - **Single Step (White-Box)**: Tells you *why* — unit tests for individual decisions
- **[TRAJECT-Bench](https://www.emergentmind.com/topics/traject-bench)**: Evaluates multi-step tool-call trajectories in JSON format. Each predicted tool call is executed against real APIs and compared to gold-standard trajectories.
- **Progress Rate (T-Eval & AgentBoard)**: Measures how effectively the agent advances toward its goal at each step — finer-grained than binary success/failure.

#### Agent-as-a-Judge

Uses an agent (with tools) to evaluate another agent's entire chain of actions, not just the final output. [Zhuge et al., 2024](https://arxiv.org/html/2508.02994v1) introduced this paradigm. Addresses the fundamental gap where traditional evaluation ignores tool use, reasoning, and intermediate steps.

Variants:
- **Multi-Agent-as-Judge**: MATEval and MAJ-EVAL use debate frameworks where agent personas represent different stakeholder perspectives.
- **AgentPro (EMNLP 2025)**: Uses Monte Carlo Tree Search to simulate multiple decision paths per step, determining step-level correctness based on whether simulated paths reach correct final answers.

#### Beyond Task Completion (Dec 2025)

The [Beyond Task Completion framework](https://arxiv.org/abs/2512.12791) evaluates across four pillars:

| Pillar | What It Measures | Key Finding |
|--------|-----------------|-------------|
| **LLM** | Reasoning quality, instruction following | Baseline competency |
| **Memory** | Context retention, retrieval accuracy | Failures increase with scenario complexity |
| **Tools** | Orchestration, parameter correctness | **Highest failure rate** in complex scenarios (skipping diagnostic steps) |
| **Environment** | State management, constraint compliance | Violations appear only in multi-agent scenarios |

Both static analysis (pre-execution) and dynamic analysis (runtime judge evaluation) are used.

---

### 1.3 Eval Dataset Formats & Schemas

The industry has converged on **JSONL** (JSON Lines) as the file format, but there is **no universal schema**. Common patterns:

| Platform | Key Fields | Notes |
|----------|-----------|-------|
| **OpenAI Evals API** | `item` (custom schema), `input` (chat format), `ideal` | Template syntax: `{{ item.correct_label }}` |
| **Azure AI Eval SDK** | `query`, `context`, `response`, `ground_truth` | RAG-oriented |
| **NVIDIA/Ragas Agentic** | `user_input` (messages with `content`, `type`, `tool_calls`), `reference_tool_calls` | Tool-call focused |
| **Promptfoo** | YAML config: `prompts`, `providers`, `tests` (variables + assertions) | Declarative |
| **DeepEval** | Python test cases via Pytest; synthetic dataset generation | Code-first |
| **Inspect AI** | `Sample(input=..., target=...)` in Python; JSON/CSV/HuggingFace datasets | Composable |

**Common patterns across all**: An input/query field (usually chat message format), an expected/ideal/ground_truth field, an optional context field for RAG, and tool call references for agentic evals.

---

### 1.4 Prompt Externalization vs Whole-Agent Evaluation

This is one of the most important architectural questions for evaluation. Two approaches, with the industry trending toward the second.

#### Externalized Prompts (Growing Trend)

Platforms like Langfuse (considered "heads and shoulders above everyone else" for prompt management as of Oct 2025), OpenAI Dashboard, and Braintrust support managing prompts outside application code. Benefits: iterate without code changes, non-technical team members can contribute, version control for prompts separate from code.

#### Whole-Agent Evaluation (Strong 2025-2026 Consensus)

**Evaluating prompts in isolation is insufficient for agentic systems.** The industry moves toward whole-system evaluation where prompts are tested in context with tools, retrieval systems, and multi-step workflows. This means:

- You run the **entire agent** — procedural logic, prompt, tools, memory — against test scenarios
- The eval harness needs to simulate (or provide real) tool environments
- This requires a **common interface** for agent construction: a way to instantiate an agent, feed it input, capture its tool calls and output

Frameworks addressing this:
- **Inspect AI**: Task-Solver-Scorer architecture — `use_tools([bash(), python()])` gives the agent real tools during eval
- **Bloom**: Rollout Agent dynamically simulates user AND tool responses to elicit target behaviors
- **OpenAI Agents SDK**: Tracing built in, making whole-agent eval a natural extension
- **MCP**: Standardizes tool connections, enabling reproducible evaluation of tool use

**Emerging standards enabling this**:
- **Agentic AI Foundation (AAIF)**: Formed Dec 2025 under Linux Foundation by Anthropic, OpenAI, and Block. Consolidates MCP, Goose, and AGENTS.md into neutral, interoperable agent standards.
- **OpenTelemetry / OpenInference**: De facto standard for agent tracing. Used by Arize Phoenix and Langfuse.
- **Model Context Protocol (MCP)**: Standardizes tool/data source connections for reproducible evaluation.

---

### 1.5 Eval-Driven Development: The Emerging Workflow

The [EDDOps framework](https://arxiv.org/html/2411.13768v3) (Evaluation-Driven Development and Operations) proposes evaluation as a continuous governing function, not a terminal checkpoint.

#### Why TDD Falls Short for LLMs

Traditional TDD assumes deterministic input-output. LLMs produce valid but varied outputs for the same input — ask an AI to draft an email and there are thousands of correct answers. The challenge is not just infinite input surface area but the vast space of valid, subjective, unpredictable outputs.

#### The Core Workflow

**Prompt → Captured Run (trace + artifacts) → Checks/Assertions → Score you can compare over time**

Key practices observed across top companies:

1. **Regression suites in CI**: Every model or prompt update risks regressions. Teams maintain regression suites and run them in CI, using canary deployments and staged rollouts.
2. **Before/after comparison on PRs**: Tools like Promptfoo and Braintrust run "before vs. after" evaluations on every PR, posting score breakdowns directly on the PR.
3. **Small but real datasets**: Anthropic recommends 20-50 simple tasks drawn from real failures — early changes have large effect sizes and small sample sizes suffice. OpenAI says 10-20 prompts per skill is enough to surface regressions.
4. **Production failures become test cases**: With Braintrust, when an AI interaction fails in production, it automatically becomes a test case. This closes the loop between production monitoring and evaluation.
5. **BDD-like specification**: Specify how the system should behave before implementing, then iterate until the agent performs well.

From [Anthropic's engineering guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents): *"Teams without evals get stuck in reactive loops — catching issues only in production, where fixing one failure creates others."*

#### CI/CD Integration Patterns

**Pattern 1: Golden Dataset (Every Commit)**
Loop through curated dataset, run queries through agent, assert outputs. Mirrors unit testing but with fuzzy matching or LLM-as-judge. Cheap, prevents regressions.

**Pattern 2: LLM-as-Judge in Pipeline (Nightly)**
Model-graded evaluation for subjective quality. More expensive but handles open-ended outputs.

**Pattern 3: Multi-Level Agent Evals (Per Release)**
Combine black-box (final result), glass-box (trajectory), and white-box (individual step) evaluation.

**Pattern 4: Regression Detection (CI Gate)**
Set metric thresholds, fail builds when scores drop. Tools: Braintrust GitHub Action, LangSmith pytest/Vitest integration, DeepEval `deepeval test run`.

---

## 2. Evaluation Platforms & Services

### 2.1 Platform Comparison Matrix

| Platform | Type | OSS | Self-Host | CI/CD | Tracing | Language | Key Differentiator |
|----------|------|-----|-----------|-------|---------|----------|-------------------|
| **[Promptfoo](https://github.com/promptfoo/promptfoo)** | CLI tool | Yes (100%) | Local-only | Native (GH Action, GitLab, Jenkins) | No | YAML/JS | Declarative config; Anthropic uses internally; zero lock-in |
| **[Inspect AI](https://inspect.aisi.org.uk/)** | Framework | Yes | Self-run | DIY | No | Python | Elegant Task-Solver-Scorer; 100+ pre-built evals; UK gov backed |
| **[Braintrust](https://www.braintrust.dev)** | Platform | No | Enterprise | Best-in-class GH Action | Yes | Py/TS/Go/Ruby/C# | Prod failures → test cases; strongest CI/CD; autoevals library |
| **[LangSmith](https://smith.langchain.com)** | Platform | No | Enterprise | pytest/Vitest | Yes (deep) | Python | LangChain/LangGraph integration; multi-turn evals; Insights Agent |
| **[Arize Phoenix](https://github.com/Arize-ai/phoenix)** | Observ. + eval | Yes (no gates) | Docker/K8s | Custom | Yes (OTel) | Python | OpenTelemetry-native; best root cause visualization |
| **[Langfuse](https://langfuse.com)** | Platform | Yes (MIT) | Docker/K8s | Via API | Yes (OTel) | Py/JS | Best prompt management; generous pricing; ClickHouse backend |
| **[DeepEval](https://github.com/confident-ai/deepeval)** | Framework + cloud | Yes (framework) | Cloud | Native Pytest | Via cloud | Python | 50+ metrics; Pytest-native; red teaming; 3M monthly downloads |
| **[W&B Weave](https://github.com/wandb/weave)** | Platform | Yes | Self-host/cloud | Via API | Yes | Python | Auto-versioning code/datasets/scorers; ML experiment heritage |
| **[Humanloop](https://humanloop.com)** | Platform | No | No | Yes | Yes | Py/TS | Collaborative editing for technical + non-technical teams |
| **[Patronus AI](https://www.patronus.ai)** | Platform | No (Lynx model) | No | API | Limited | Python | Best hallucination detection via fine-tuned Lynx evaluator |
| **[Galileo](https://galileo.ai)** | Platform | No | No | Limited | Yes | Python | Real-time guardrails; modular RAG/agentic eval |
| **[RAGAS](https://docs.ragas.io)** | Framework | Yes | Local | Via scripts | No | Python | Best specialized RAG metrics (faithfulness, context precision/recall) |

### 2.2 Deep Dives on Key Platforms

#### Inspect AI (UK AI Security Institute)

The most architecturally significant evaluation framework for agent evaluation. Task-Solver-Scorer is genuinely elegant:

```python
from inspect_ai import Task, task
from inspect_ai.dataset import Sample
from inspect_ai.scorer import exact, model_graded_fact
from inspect_ai.solver import generate, chain_of_thought, use_tools, system_message
from inspect_ai.tool import bash, python

# Simple eval
@task
def hello_world():
    return Task(
        dataset=[Sample(input="Just reply with Hello World", target="Hello World")],
        solver=[generate()],
        scorer=exact(),
    )

# Agentic eval with real tools
@task
def coding_challenge():
    return Task(
        dataset=json_dataset("challenges.jsonl"),
        solver=[
            system_message("system.txt"),
            use_tools([bash(), python()]),
            generate(),
        ],
        scorer=model_graded_fact(),
    )

# Composable solvers
@task
def theory_of_mind():
    return Task(
        dataset=json_dataset("theory_of_mind.jsonl"),
        solver=[
            system_message("system.txt"),
            prompt_template("prompt.txt"),
            generate(),
            self_critique()
        ],
        scorer=model_graded_fact(),
    )
```

**Why it matters for OllieBot**: Inspect AI's solver concept maps naturally to OllieBot's agent architecture. A solver is `async (state: TaskState, generate: Generate) => TaskState` — an async transform on conversation state. OllieBot's worker agent loop is essentially the same pattern.

- 100+ community-contributed benchmarks ([Inspect Evals](https://inspect.aisi.org.uk/evals/)): GAIA, SWE-Bench, GDM CTF, Cybench
- Production-grade sandboxing: Docker built-in, Kubernetes/Proxmox adapters
- Used by US CAISI, METR, Apollo Research
- **Limitation**: Python-only, no TypeScript SDK. No cloud platform — you run everything yourself.

#### Braintrust

Best-in-class for eval-driven CI/CD:

```python
from braintrust import Eval
from autoevals import LevenshteinScorer, Factuality

# Basic eval
Eval(
    "Say Hi Bot",
    data=lambda: [
        {"input": "Foo", "expected": "Hi Foo"},
        {"input": "Bar", "expected": "Hello Bar"},
    ],
    task=lambda input: "Hi " + input,
    scores=[LevenshteinScorer],
)

# LLM-as-judge with autoevals
from autoevals.llm import Factuality
evaluator = Factuality()
result = evaluator(output=output, expected=expected, input=input)
```

```typescript
// TypeScript SDK
import { Factuality } from "autoevals";
const result = await Factuality({ output, expected, input });
```

- **Production → eval feedback loop**: Failed production interactions automatically become test cases
- **CI/CD**: `braintrustdata/eval-action` GitHub Action posts experiment comparisons on PRs
- File convention: `*.eval.ts` / `eval_*.py`
- Free tier: 1M trace spans, 10K scores, unlimited users
- Integrations: Vercel AI SDK, OpenAI Agents SDK, LangChain, Google ADK, Pydantic AI
- SOC 2 Type II, GDPR, HIPAA compliant
- **Limitation**: Proprietary. Your data lives on their servers. Pricing beyond free tier is opaque.

#### DeepEval

The "Pytest for LLMs" — most natural for teams already using Python testing:

```python
import pytest
from deepeval import assert_test
from deepeval.metrics import AnswerRelevancyMetric, HallucinationMetric
from deepeval.test_case import LLMTestCase

def test_agent_response():
    test_case = LLMTestCase(
        input="What's the weather in NYC?",
        actual_output=agent.run("What's the weather in NYC?"),
        retrieval_context=["NYC weather data..."]
    )
    relevancy = AnswerRelevancyMetric(threshold=0.7)
    hallucination = HallucinationMetric(threshold=0.5)
    assert_test(test_case, [relevancy, hallucination])
```

- 50+ built-in metrics (G-Eval, answer relevancy, hallucination, task completion)
- Synthetic data generation for expanded coverage
- 40+ red team attack patterns
- `deepeval test run test_example.py` in CI
- Cloud platform (Confident AI) for sharable reports
- **Limitation**: Python-only. Cloud dependency for advanced features. No tracing.

#### Arize Phoenix

Best for observability-first evaluation:

```python
from phoenix.evals import create_classifier, create_evaluator
from phoenix.evals.llm import LLM

# LLM-as-judge evaluator
llm = LLM(provider="openai", model="gpt-4o")
relevance_evaluator = create_classifier(
    name="relevance",
    prompt_template="Is the response relevant?\n\nQuery: {input}\nResponse: {output}",
    llm=llm,
    choices={"relevant": 1.0, "irrelevant": 0.0},
)

# Code-based evaluator
@create_evaluator(name="contains_link", kind="CODE")
def contains_link(output):
    import re
    return bool(re.search(r"https?://[^\s]+", output))
```

- Fully open-source, no feature gates
- OpenTelemetry-native — prevents vendor lock-in
- Deploy: local, Jupyter, Docker, Kubernetes, or hosted
- Supports LlamaIndex, LangChain, Haystack, DSPy, smolagents
- **Limitation**: Evaluation is secondary to observability. Less eval-specific depth than DeepEval or Inspect.

#### OpenAI Evals API

Mature hosted platform with flexible grader system:

```python
# Score Model Grader (LLM-as-Judge)
logs_eval = client.evals.create(
    name="Code QA Eval",
    data_source_config={
        "type": "custom",
        "item_schema": {
            "type": "object",
            "properties": {"input": {"type": "string"}},
        },
        "include_sample_schema": True,
    },
    testing_criteria=[{
        "type": "score_model",
        "name": "General Evaluator",
        "model": "o3",
        "input": [
            {"role": "system", "content": grader_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "range": [1, 7],
        "pass_threshold": 5.5,
    }],
)
```

Grader types: string_check, python (sandboxed, 256kB, 2GB RAM, 2min timeout), text_similarity (BLEU, cosine, ROUGE), score_model (LLM-as-judge), label_model, multi_grader.

- Template syntax: `{{ item.correct_label }}`, `{{ sample.output_text }}`
- Can test non-OpenAI models via custom endpoints
- **Limitation**: Tightly coupled to OpenAI platform. No agent trajectory evaluation. Python sandbox is limited.

### 2.3 Integration Effort & Code Bending

How much do you need to bend your code to use each platform?

#### Minimal (< 1 hour)

| Platform | What You Do |
|----------|------------|
| **Promptfoo** | Create a YAML config file. Point at your prompts. No code changes. |
| **DeepEval** | `pip install deepeval`. Write pytest tests. Your agent is the "task" function. |
| **Arize Phoenix** | `docker run -p 6006:6006 arizephoenix/phoenix`. Add OTel decorator. |

#### Low (hours)

| Platform | What You Do |
|----------|------------|
| **Langfuse** | Install SDK. Add `@observe()` decorators or OTel integration. |
| **W&B Weave** | Install SDK. Add `@weave.op` decorator to functions you want to trace. |
| **LangSmith** (for LangChain users) | Already integrated. Set env vars. |

#### Moderate (days)

| Platform | What You Do |
|----------|------------|
| **Braintrust** | Install SDK. Wrap agent as `task` function. Set up CI GitHub Action. Migrate dataset format. |
| **Inspect AI** | Wrap agent as a solver. Define datasets as Samples. Create scorer functions. |
| **LangSmith** (non-LangChain) | Install SDK. Instrument manually. Fight ecosystem coupling. |

#### The Key Architectural Requirement

All platforms need one thing from your code: **a callable that takes input and returns output**. The minimal interface:

```typescript
// What every eval platform ultimately needs
type AgentUnderTest = (input: string | Message[]) => Promise<{
  output: string;
  tool_calls?: ToolCall[];
  trace?: TraceEvent[];
}>;
```

If your agent already exposes this (or can be wrapped to), integration with any platform is straightforward. OllieBot's worker agent (`src/agents/worker.ts`) already has this shape.

---

## 3. Evaluation as Integral Agent-Building Function

### 3.1 How Major Players Handle Evaluation

#### Anthropic

**Philosophy**: Eval-driven development as core practice.

- **Promptfoo** used internally for evaluation
- **[Bloom](https://github.com/safety-research/bloom)** (Dec 2025): Open-source agentic behavioral evaluation. Four-stage pipeline:
  1. **Understanding Agent**: Reads behavior descriptions, builds structured summaries
  2. **Ideation Agent**: Generates candidate evaluation scenarios
  3. **Rollout Agent**: Runs scenarios in parallel, simulates user AND tool responses
  4. **Judgment Agent**: Scores transcripts 0-10, meta-judge produces suite-level reports
- **Statistical rigor**: [Published research](https://www.anthropic.com/research/statistical-approach-to-model-evals) on reporting Standard Error of the Mean alongside eval scores — the real object of interest is the theoretical average across all possible questions, not the observed sample average
- **Cross-lab evaluation**: [Joint alignment evaluation with OpenAI](https://alignment.anthropic.com/2025/openai-findings/) (Summer 2025) — each lab ran internal safety evals on the other's public models
- **Harbor**: Containerized agent evaluation at scale
- **Co-founded AAIF** (Agentic AI Foundation) with OpenAI and Block for interoperable standards

#### OpenAI

**Philosophy**: Measure → Improve → Ship loop.

- **[Evals API](https://platform.openai.com/docs/guides/evals)**: Hosted platform with JSONL datasets and graders
- **[Agent Evals Guide](https://platform.openai.com/docs/guides/agent-evals)**: Dedicated documentation for evaluating agents
- **[Skill-based testing](https://developers.openai.com/blog/eval-skills/)**: 10-20 prompts per skill, testing both explicit invocation ("call the weather API") and implicit activation ("what should I wear tomorrow?")
- **Prompt Optimizer**: Automated prompt improvement in eval-improve-re-eval cycles
- **Open-source [Agents SDK](https://github.com/openai/openai-agents-python)** with tracing built in
- **HealthBench**: 262 physicians from 60 countries developing specialized healthcare evaluation
- **Warning about "grader hacking"**: Models being trained learn to exploit weaknesses in model graders — scoring highly on model-graded evals but poorly on human evals

#### Google (Vertex AI)

- **Agent evaluation in Preview** via Gen AI Evaluation Service
- **[User Simulator](https://cloud.google.com/blog/products/ai-machine-learning/more-ways-to-build-and-scale-ai-agents-with-vertex-ai-agent-builder)** for pre-deployment testing: simulates multi-turn conversations
- **Agent Engine** with observability dashboard
- **ADK** downloaded 7M+ times

#### LangChain / LangSmith

- Evaluation handled via LangSmith (proprietary), not built into LangChain/LangGraph
- LangGraph's graph-based construction enables clear trajectory capture
- **Multi-turn evals**: Threads as first-class concept. Measures semantic intent, outcomes, and trajectory.
- **Insights Agent**: Auto-analyzes production traces for failure patterns (Plus/Enterprise only)
- **[langsmith-fetch CLI](https://blog.langchain.com/debugging-deep-agents-with-langsmith/)**: Equips coding agents (Claude Code, etc.) with debugging capabilities
- **Lock-in concern**: Deep ecosystem coupling makes migration expensive

#### DSPy (Stanford)

Unique approach — **programmatic prompt optimization where eval is integral to the compilation loop** rather than bolted on. You define metrics, DSPy optimizes prompts to maximize them. The eval IS the development process.

#### Amazon

Enterprise framework measuring: inappropriate planning, invalid tool invocations, malformed parameters, unexpected response formats, authentication failures, memory retrieval errors. Published [real-world lessons](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/) from building agentic systems at scale.

### 3.2 Least Common Denominator

Every product that takes evaluation seriously supports, at minimum:

1. **JSONL-based test datasets** with input/expected-output pairs
2. **LLM-as-judge scoring** (built-in or via API)
3. **Trace/trajectory capture** of execution steps
4. **Metric aggregation** (pass/fail rates, scores over time)
5. **Deterministic assertions** (string match, JSON schema validation, regex)
6. **Before/after comparison** of some kind (experiment comparison, version diff)

### 3.3 Differentiators That Actually Matter

These are the features that move the needle on agent quality, ranked by impact:

#### Tier 1: Game-Changers

1. **Production-to-eval feedback loop** (Braintrust, LangSmith)
   Failed production interactions automatically become test cases. The single most impactful feature because it ensures eval suites reflect real-world failures, not hypothetical ones.

2. **Eval-as-CI-gate** (Promptfoo, Braintrust, DeepEval)
   Running evals automatically on every PR and blocking merges when quality degrades. Makes eval-driven development happen in practice rather than in theory.

3. **Environment state evaluation** (Anthropic's outcome vs. transcript distinction)
   Did the thing actually happen, or did the agent just say it happened? Evaluating real environment state catches confabulated successes.

#### Tier 2: Significant

4. **Trajectory/process evaluation** (Inspect AI, LangSmith, Agent-as-a-Judge)
   Evaluating tool selection, argument correctness, and multi-turn coherence catches failures that outcome-only evaluation misses entirely.

5. **Bias-aware judging protocols** (CALM framework, multi-model ensemble)
   Position randomization, chain-of-thought forcing, and multi-judge consensus demonstrably improve reliability. Without these, your LLM judge's scores are systematically skewed.

6. **Specialized fine-tuned evaluator models** (Patronus Lynx)
   Purpose-built hallucination detectors outperform general-purpose LLM-as-judge for specific quality dimensions by 15-20%.

#### Tier 3: Valuable

7. **Synthetic dataset generation** (DeepEval, Bloom)
   Programmatic generation of diverse test scenarios scales coverage beyond manual curation. Bloom's agentic generation is particularly novel.

8. **Composable evaluation architecture** (Inspect AI Task-Solver-Scorer)
   Package custom solvers/scorers as reusable Python packages. True composability enables sharing evaluations across teams and projects.

### 3.4 Relationship to OllieBot's Eval System

OllieBot's built-in eval system (`src/evaluation/`) implements several of these concepts:

| Feature | OllieBot Has It | Industrial Grade |
|---------|----------------|-----------------|
| LLM-as-judge scoring | Yes | Needs bias mitigation (multi-model, position swap) |
| Statistical comparison (Welch's t-test) | Yes | Ahead of most platforms |
| Mock tool execution | Yes | Inspect AI's sandboxed real tools is the next level |
| Eval web UI | Yes | Dedicated platforms have richer visualization |
| CI/CD integration | No | Critical gap |
| Production → test case pipeline | No | Critical gap |
| Trajectory evaluation | No | Important for debugging |
| Bias-aware judging | No | Needed for trustworthy results |

**The analogy holds**: Just as OllieBot's self-modify agent teaches you agent construction while Claude Code does the heavy lifting, OllieBot's eval system teaches you evaluation mechanics while an industrial platform (Promptfoo + Inspect AI, or Braintrust) should handle the serious eval workload.

**Recommended path**: Keep OllieBot's eval system for learning and experimentation. Adopt Promptfoo (free, local, YAML-driven, Anthropic uses it) for CI-gated prompt regression testing. Consider Inspect AI for deep agent evaluation when you need trajectory-level analysis.

---

## 4. Appendix: Promptfoo Integration Architecture for OllieBot

This section documents how Promptfoo integrates with OllieBot's agentic loop — specifically addressing the concern that OllieBot's system prompt is an internal runtime artifact, not a static file.

### The Core Insight: Promptfoo Does Not Need Your Prompt

Promptfoo's **custom provider** mechanism treats your agent as a black box. You implement a single interface:

```typescript
import type { ApiProvider, ProviderOptions, ProviderResponse, CallApiContextParams } from 'promptfoo';

class OllieBotProvider implements ApiProvider {
  constructor(options: ProviderOptions) { /* config from promptfoo.config.ts */ }

  id(): string { return 'olliebot'; }

  async callApi(prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    // prompt = the user message text (from test case vars)
    // YOUR agent builds its own system prompt internally
    // YOUR agent runs its own tool loop internally
    // Promptfoo only sees the final output
    return {
      output: agentResponse,            // string — the agent's final text
      cost: totalCost,                   // optional — for cost assertions
      tokenUsage: { total, prompt: inputTokens, completion: outputTokens },
      metadata: { toolCalls, steps },    // optional — for trajectory assertions
    };
  }
}
```

The `prompt` parameter is just the user message. OllieBot's `buildSystemPrompt()` (in `src/agents/base-agent.ts`) — which dynamically assembles the base `.md` file, mission context, memory, skills, RAG knowledge, and conditional sections — runs entirely inside `callApi()`. Promptfoo never sees or controls the system prompt.

### Config Format: TypeScript, Not YAML

Promptfoo auto-detects `promptfooconfig.ts` and supports `export default config` with the `UnifiedConfig` type:

```typescript
import type { UnifiedConfig } from 'promptfoo';

const config: UnifiedConfig = {
  prompts: ['{{message}}'],  // passthrough — the agent builds its own system prompt
  providers: ['file://src/evaluation/promptfoo-provider.ts'],
  tests: [
    {
      vars: { message: 'What is 2 + 2?' },
      assert: [
        { type: 'contains', value: '4' },
        { type: 'cost', threshold: 0.10 },
      ],
    },
    {
      vars: { message: 'Search the web for the latest TypeScript release' },
      assert: [
        { type: 'llm-rubric', value: 'Response mentions a specific TypeScript version number' },
        { type: 'javascript', value: '(output) => output.length > 100' },
      ],
    },
  ],
};

export default config;
```

### Alternative: Programmatic API (For Vitest Integration)

Since OllieBot uses Vitest, you can call `promptfoo.evaluate()` directly from test files:

```typescript
import promptfoo from 'promptfoo';

const results = await promptfoo.evaluate({
  prompts: ['{{message}}'],
  providers: [async (prompt) => {
    const response = await runOllieBotAgent(prompt);
    return { output: response.text };
  }],
  tests: [...],
});
```

### How It Reuses Existing OllieBot Code

The Promptfoo provider reuses `EvaluationRunner.executeWithTools()` (from `src/evaluation/runner.ts`), which already:
- Initializes `LLMService` with the configured provider
- Loads the system prompt via `PromptLoader`
- Runs the full tool call loop (up to `maxToolIterations`)
- Tracks token usage

No modification to OllieBot's agent code is required. The provider is a thin adapter.

### Assertion Types Available

| Type | What It Checks | Example |
|------|---------------|---------|
| `contains` | Substring match | `{ type: 'contains', value: '4' }` |
| `icontains` | Case-insensitive substring | `{ type: 'icontains', value: 'hello' }` |
| `regex` | Regex pattern | `{ type: 'regex', value: '\\d+\\.\\d+' }` |
| `is-json` | Valid JSON output | `{ type: 'is-json' }` |
| `javascript` | Custom JS assertion | `{ type: 'javascript', value: '(output) => output.length > 50' }` |
| `llm-rubric` | LLM-as-judge scoring | `{ type: 'llm-rubric', value: 'Response is helpful and accurate' }` |
| `cost` | Token cost threshold | `{ type: 'cost', threshold: 0.10 }` |
| `latency` | Response time | `{ type: 'latency', threshold: 5000 }` |
| `similar` | Semantic similarity | `{ type: 'similar', value: 'expected response', threshold: 0.8 }` |

---

## 5. Sources & References

### Research Papers

- [A Survey on LLM-as-a-Judge](https://arxiv.org/abs/2411.15594) — Gu et al., updated Mar 2025
- [When AIs Judge AIs: Agent-as-a-Judge](https://arxiv.org/html/2508.02994v1) — Aug 2025
- [Design Choices Impacting LLM-as-Judge Reliability](https://arxiv.org/abs/2506.13639) — Jun 2025
- [Beyond Task Completion: Agentic AI Assessment Framework](https://arxiv.org/abs/2512.12791) — Dec 2025
- [Evaluation and Benchmarking of LLM Agents (KDD 2025)](https://arxiv.org/html/2507.21504v1)
- [Justice or Prejudice? Quantifying Biases](https://arxiv.org/html/2410.02736v1)
- [Self-Preference Bias in LLM-as-a-Judge](https://arxiv.org/html/2410.21819v2)
- [Position Bias Systematic Study](https://aclanthology.org/2025.ijcnlp-long.18.pdf)
- [Can You Trust LLM Judgments?](https://arxiv.org/html/2412.12509v2)
- [Judging the Judges: Position Bias](https://arxiv.org/html/2406.07791v1)
- [EDDOps: Evaluation-Driven Development and Operations](https://arxiv.org/html/2411.13768v3)
- [Validating LLM-as-a-Judge under Rating Indeterminacy (CMU)](https://blog.ml.cmu.edu/2025/12/09/validating-llm-as-a-judge-systems-under-rating-indeterminacy/)

### Industry Guides

- [Anthropic: Demystifying Evals for AI Agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [Anthropic: Bloom Auto-Evals](https://alignment.anthropic.com/2025/bloom-auto-evals/)
- [Anthropic: A Statistical Approach to Model Evaluations](https://www.anthropic.com/research/statistical-approach-to-model-evals)
- [Anthropic-OpenAI Joint Alignment Evaluation](https://alignment.anthropic.com/2025/openai-findings/)
- [OpenAI: Agent Evals Guide](https://platform.openai.com/docs/guides/agent-evals)
- [OpenAI: Testing Agent Skills with Evals](https://developers.openai.com/blog/eval-skills/)
- [OpenAI: Evaluation Best Practices](https://platform.openai.com/docs/guides/evaluation-best-practices)
- [Amazon: Evaluating AI Agents — Real-World Lessons](https://aws.amazon.com/blogs/machine-learning/evaluating-ai-agents-real-world-lessons-from-building-agentic-systems-at-amazon/)
- [QuantumBlack/McKinsey: Evaluations for the Agentic World](https://medium.com/quantumblack/evaluations-for-the-agentic-world-c3c150f0dd5a) — Jan 2026

### Expert Analysis

- [Hamel Husain: Selecting the Right AI Evals Tool](https://hamel.dev/blog/posts/eval-tools/) — Oct 2025
- [Hamel Husain: LLM Evals FAQ](https://hamel.dev/blog/posts/evals-faq/)
- [Hamel Husain: Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/)
- [A Pragmatic Guide to LLM Evals (Pragmatic Engineer)](https://newsletter.pragmaticengineer.com/p/evals)
- [LLM-as-a-Judge Done Right (Kinde)](https://kinde.com/learn/ai-for-software-engineering/best-practice/llm-as-a-judge-done-right-calibrating-guarding-debiasing-your-evaluators/)

### Platform Documentation

- [Promptfoo](https://github.com/promptfoo/promptfoo) — [CI/CD Docs](https://www.promptfoo.dev/docs/integrations/ci-cd/) — [Configuration](https://www.promptfoo.dev/docs/configuration/parameters/)
- [Inspect AI](https://inspect.aisi.org.uk/) — [Tutorial](https://inspect.aisi.org.uk/tutorial.html) — [Evals Catalog](https://inspect.aisi.org.uk/evals/) — [Sandboxing](https://www.aisi.gov.uk/blog/the-inspect-sandboxing-toolkit-scalable-and-secure-ai-agent-evaluations)
- [Braintrust](https://www.braintrust.dev) — [Eval SDK](https://www.braintrust.dev/docs/start/eval-sdk) — [Autoevals](https://github.com/braintrustdata/autoevals)
- [LangSmith](https://docs.langchain.com/langsmith/evaluation) — [Concepts](https://docs.langchain.com/langsmith/evaluation-concepts) — [Trajectory Evals](https://docs.langchain.com/langsmith/trajectory-evals)
- [Arize Phoenix](https://github.com/Arize-ai/phoenix) — [Docs](https://arize.com/docs/phoenix)
- [Langfuse](https://langfuse.com) — [Eval Overview](https://langfuse.com/docs/evaluation/overview)
- [DeepEval](https://github.com/confident-ai/deepeval) — [Docs](https://deepeval.com/docs/getting-started)
- [W&B Weave](https://github.com/wandb/weave) — [Docs](https://docs.wandb.ai/weave)
- [OpenAI Evals API](https://platform.openai.com/docs/api-reference/evals)
- [Bloom](https://github.com/safety-research/bloom)
- [Agentic AI Foundation (AAIF)](https://intuitionlabs.ai/articles/agentic-ai-foundation-open-standards)
