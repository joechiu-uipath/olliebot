# Context Management Research: Improving Chat History for OllieBot

> Research compiled February 2026. Covers academic literature, open source frameworks, and production systems.

## Current State

OllieBot uses a sliding window of the last 10 messages (`CONVERSATION_HISTORY_LIMIT` in `src/constants.ts:81`) for supervisor LLM calls and 5 messages (`WORKER_HISTORY_LIMIT`) for workers. Tool results are included inline at full fidelity. The system prompt is dynamically assembled from templates, memory, skills, and RAG context. An optional LLMLingua2-based token reduction service exists but only compresses user message text.

This document captures research on techniques that go meaningfully beyond the current approach.

---

## Table of Contents

1. [Your Ideas — Validation & Enhancement](#1-your-ideas--validation--enhancement)
2. [Observation Masking (JetBrains NeurIPS 2025)](#2-observation-masking-jetbrains-neurips-2025)
3. [Context Folding (RL-Based Sub-trajectories)](#3-context-folding-rl-based-sub-trajectories)
4. [Two-Phase Compaction (Claude Code Pattern)](#4-two-phase-compaction-claude-code-pattern)
5. [Virtual Context Management (MemGPT/Letta)](#5-virtual-context-management-memgptletta)
6. [Hierarchical Memory Systems](#6-hierarchical-memory-systems)
7. [Knowledge Graph Extraction](#7-knowledge-graph-extraction)
8. [Prompt Caching as Context Strategy](#8-prompt-caching-as-context-strategy)
9. [ACON: Adaptive Agent Context Optimization](#9-acon-adaptive-agent-context-optimization)
10. [Composable Transform Pipelines](#10-composable-transform-pipelines)
11. [Whiteboard Memory (Semantic Kernel)](#11-whiteboard-memory-semantic-kernel)
12. [Episodic Memory with Reflection](#12-episodic-memory-with-reflection)
13. [Evaluation & Metrics](#13-evaluation--metrics)
14. [Recommendations for OllieBot](#14-recommendations-for-olliebot)
15. [Sources](#15-sources)

---

## 1. Your Ideas — Validation & Enhancement

### Idea A: Discard Older Tool Results

**Validation: Strong — this is the single highest-impact, lowest-effort optimization.**

JetBrains Research (NeurIPS 2025) found that simple observation masking — omitting all but the M most recent tool outputs — matches or beats LLM-based summarization for code agents. Tool outputs typically dominate context token counts. Claude Code uses the same principle: micro-compaction discards old tool outputs before summarizing conversation text.

**Enhancement:** Rather than summarizing discarded tool results into a sentence, consider replacing them with a structured stub:

```
[Tool result discarded — tool: web_search, status: success, 3847 tokens removed.
 Key: found 12 results for "climate policy 2025"]
```

This preserves the action chain (which tool was called, whether it succeeded) while removing the bulk. The one-line summary is optional — JetBrains found that even without it, preserving the action/reasoning chain is sufficient.

### Idea B: Template-Aware Summarization of Supervisor Messages

**Validation: Novel — not found in literature but logically sound.**

No framework surveyed does this explicitly, but it aligns with two established principles:
1. **Prompt caching** — stable content (templates) should be factored out to a cacheable prefix, not repeated per message
2. **Extractive compression** — extracting the variable parts from a known template is cheaper and more reliable than abstractive summarization

**Enhancement:** Rather than summarizing, consider a diff-like approach:
- Store the template version/hash
- Extract only the variable bindings (tool names used, delegation targets, key decisions)
- Reconstruct from template + variables if full message is needed later

This is more deterministic than LLM-based summarization and preserves perfect fidelity for the variable parts.

### Idea C: Relevance-Based Past Message Retrieval (Beyond Window)

**Validation: Strong — this is the RAG-over-conversation-history pattern.**

Multiple frameworks implement this:
- **MemGPT/Letta**: `recall_memory_search` retrieves past messages by semantic similarity
- **CrewAI**: Short-term memory uses ChromaDB embeddings for semantic retrieval
- **LangGraph**: Supports combining trimmed recent history with semantically retrieved older messages

**Enhancement:** Consider a hybrid retrieval approach:
1. Last N messages at full fidelity (current sliding window)
2. Retrieve up to 2N older messages by relevance (embedding similarity to current query)
3. Include retrieved messages as **summarized context blocks** with metadata (timestamp, topic) rather than raw messages — this prevents the LLM from confusing temporal ordering

Also consider **recency-weighted retrieval**: boost relevance scores by recency so that messages from 5 minutes ago rank higher than equally-relevant messages from 2 hours ago.

### Idea D: Conversation-Scoped Memory

**Validation: Strong — directly supported by multiple frameworks.**

- **MemGPT/Letta**: Core memory blocks are editable by the agent within a session
- **Semantic Kernel Whiteboard**: Continuously-updated structured summary that survives truncation
- **Amazon Bedrock**: Session-scoped short-term memory with explicit save/retrieve
- **Claude Code**: CLAUDE.md can specify what compaction should preserve per session

**Enhancement:** Consider two tiers of conversation-scoped memory:
1. **Agent-managed scratchpad**: The agent writes structured notes (key decisions, current task state, user preferences expressed in this conversation). Automatically included in system prompt.
2. **User-managed pins**: User says "remember for this conversation: always use TypeScript" — pinned to system prompt and immune from any context reduction.

Both should be stored in SQLite keyed by conversationId and injected into the system prompt similarly to how `MemoryService.formatForSystemPrompt()` currently works.

---

## 2. Observation Masking (JetBrains NeurIPS 2025)

**The single most impactful finding for OllieBot's architecture.**

### How It Works

A typical agent turn has three components: reasoning (chain-of-thought), action (tool call), and observation (tool result). JetBrains found that observations dominate token counts — often 80%+ of a turn's tokens. Their approach:

1. Keep the full action and reasoning chain for ALL past turns
2. Keep full observations only for the M most recent tool-calling turns
3. Replace older observations with a minimal stub or nothing at all

### Results

- **7-11% cost reduction** over either pure truncation or pure LLM summarization
- Matches LLM summarization quality at a fraction of the cost (no summarization LLM calls needed)
- Preserving the action chain is critical — the LLM uses it to understand what has been tried and what worked

### Relevance to OllieBot

Directly applicable. The supervisor's tool execution loop (`supervisor.ts:472-625`) pushes full tool results as user messages into `llmMessages`. These accumulate across the agentic loop. Masking old observations within a single request's tool loop and across conversation history would yield immediate token savings.

### Implementation Sketch

In `supervisor.ts` where `llmMessages` is constructed (around line 431):
- When slicing conversation history, identify messages containing `tool_result` content blocks
- For all but the most recent tool-result-bearing message, replace tool result content with a stub
- Within the current request's agentic loop, keep full results only for the last iteration

**Source:** [JetBrains Research Blog](https://blog.jetbrains.com/research/2025/12/efficient-context-management/)

---

## 3. Context Folding (RL-Based Sub-trajectories)

**The most novel technique found in this research.**

### How It Works

Context Folding (Xu et al., October 2025) introduces two special actions for an agent:
- `branch(description, prompt)` — enters a sub-trajectory in a separate context
- `return(message)` — folds results back into the main context as a concise summary

The agent learns via reinforcement learning when to branch (e.g., before a complex multi-step research task) and how to summarize when returning. The FoldGRPO algorithm uses token-level process rewards including an Unfolded Token Penalty.

### Results

- Main trajectory compressed to ~8K tokens while processing over 100K total — **90%+ compression**
- pass@1 of 0.620 on BrowseComp-Plus (+20%) and 0.580 on SWE-Bench Verified (+8.8%)
- Performance comparable to agents with 100B+ parameter models

### Relevance to OllieBot

OllieBot already has a delegation pattern (supervisor delegates to workers). This is architecturally similar to context folding — the worker operates in a separate context and returns results. The insight is to make this more aggressive:

1. **Workers should return structured summaries**, not raw results
2. **The supervisor should be able to spawn lightweight sub-tasks** (not full worker delegations) for things like "search and summarize" or "read file and extract key info"
3. Worker results that re-enter the supervisor context should be compressed

### Caution

FoldAct (December 2025) identified stability challenges: summaries modify the agent's future observation space, creating non-stationary observation distributions. For OllieBot, this means worker result summaries should be deterministically formatted to avoid drift.

**Source:** [Context Folding Paper](https://arxiv.org/pdf/2510.11967), [FoldAct](https://arxiv.org/abs/2512.22733)

---

## 4. Two-Phase Compaction (Claude Code Pattern)

### How It Works

Claude Code uses a two-phase approach when context fills up:

1. **Phase 1 — Micro-compaction:** Selectively remove older tool call outputs while preserving recent messages and conversation structure. Lighter intervention with less information loss.
2. **Phase 2 — Full compaction:** Summarize the entire conversation into a condensed summary preserving: files being worked on, decisions made, current task state, next steps, user constraints. All prior messages replaced.

Triggers at ~80-95% of context capacity (configurable).

### Relevance to OllieBot

OllieBot could implement a similar two-phase approach:

1. When approaching token limits (measure with the existing token counting), first strip old tool results (Phase 1)
2. If still over budget, generate a conversation summary and replace older messages (Phase 2)
3. Store the full conversation in SQLite (already done) so nothing is truly lost

The key insight from Claude Code's community: **optimize for tokens per task, not tokens per request**. Aggressive compression that forces re-fetching of information costs more total tokens than moderate compression that retains enough context.

**Source:** [Anthropic Compaction Docs](https://platform.claude.com/docs/en/build-with-claude/compaction), [Claude Code Context Analysis](https://claudefa.st/blog/guide/mechanics/context-buffer-management)

---

## 5. Virtual Context Management (MemGPT/Letta)

### How It Works

MemGPT treats the context window like physical RAM in an operating system:

- **In-context memory** (RAM): What the LLM currently sees
- **Out-of-context memory** (disk): Archival storage (vector DB) and recall storage (conversation DB)
- The LLM itself acts as the memory manager, using tool calls to page data in/out:
  - `archival_memory_insert` / `archival_memory_search`
  - `recall_memory_search`
  - `core_memory_append` / `core_memory_replace`
- **Core memory**: A reserved, mutable section of the context window (like a writable system prompt)
- On context overflow: evict ~50% of messages, generate recursive summary, store evicted messages in recall storage

### Relevance to OllieBot

OllieBot's `MemoryService` already stores persistent key-value memories. The MemGPT extension would be:

1. **Make memory blocks mutable within the system prompt** — the agent can update its own context notes during a conversation (not just via the `remember` tool for persistent memory)
2. **Add recall search** — allow the agent to search past conversation messages in SQLite by keyword or embedding
3. **Proactive archival** — when the agent encounters important information (e.g., user states a constraint), it can store it in structured memory before it would be evicted by the sliding window

The core insight: **the agent should participate in its own memory management**, not just be a passive recipient of whatever the sliding window provides.

**Source:** [MemGPT Paper](https://arxiv.org/abs/2310.08560), [Letta Docs](https://docs.letta.com/concepts/memgpt/)

---

## 6. Hierarchical Memory Systems

### Cognitive Architecture Pattern

Multiple systems converge on a hierarchy inspired by human cognitive science:

| Layer | Analogy | Implementation | Persistence |
|-------|---------|----------------|-------------|
| Working Memory | Current thought | Context window (sliding window) | Request-scoped |
| Short-Term / Episodic | Recent experiences | Conversation DB + embeddings | Session-scoped |
| Long-Term / Semantic | General knowledge | Extracted facts, preferences | Cross-session |
| Procedural | Skills/habits | Compiled workflows, tool patterns | Permanent |

### Key Systems

- **H-MEM** (2025): Four-level hierarchy (Episode → Memory Trace → Category → Domain) where each level is a progressively refined index over the level below
- **Amazon Bedrock AgentCore**: Four parallel strategies (Summarization, Semantic, User Preference, Episodic) that process the same events independently
- **CrewAI**: Short-term (ChromaDB), Long-term (SQLite), Entity (RAG), Contextual (combined)
- **E-mem** (2025): Episodic-to-semantic consolidation achieving 54% F1 on long conversation benchmarks, surpassing prior SOTA by 7.75% while reducing token cost 70%

### Relevance to OllieBot

OllieBot currently has:
- Working memory: 10-message sliding window ✓
- Long-term memory: `memory.json` / `memory.md` ✓

Missing layers:
- **Session-scoped memory**: Conversation-scoped facts and decisions (your Idea D)
- **Episodic consolidation**: Automatic extraction of key facts from conversation history into structured memory
- **Entity memory**: Tracking entities (people, projects, tools) mentioned across conversations

Adding even just session-scoped memory would close the biggest gap.

---

## 7. Knowledge Graph Extraction

### How It Works

Rather than storing raw conversation text, extract structured relationships:
- **Entities**: People, projects, files, concepts mentioned in conversation
- **Relationships**: "user prefers TypeScript", "project uses React", "bug is in auth module"
- **Facts**: Timestamped assertions extracted from conversation

GraphRAG (Microsoft) and KGGen use LLMs to extract these structures. The graph enables multi-hop reasoning ("what files are related to the auth module that the user mentioned having a bug?") that flat text retrieval cannot do.

### Relevance to OllieBot

For conversation-scoped context, a lightweight entity-relationship extraction could:
1. After each exchange, extract new entities and relationships
2. Store as structured data keyed by conversationId
3. Include relevant entity context in the system prompt (more token-efficient than raw message history)
4. Enable the agent to reason about connections across the conversation

This is a longer-term investment. For immediate impact, the simpler approaches (observation masking, conversation-scoped memory) deliver more value.

**Source:** [Neo4j + LLMs Blog](https://neo4j.com/blog/developer/unstructured-text-to-knowledge-graph/), [KGGen Paper](https://arxiv.org/html/2502.09956v1)

---

## 8. Prompt Caching as Context Strategy

### The Key Insight

Prompt caching is not just a cost optimization — it's a **context architecture constraint**. How you structure your context determines cache hit rates, which dominate both cost and latency.

### Best Practices from "Don't Break the Cache" (Lumer et al., January 2026)

- Prompt caching reduces API costs by **41-80%** and improves TTFT by **13-31%**
- **Structure**: Stable content first (tools → system prompt → static context), dynamic content last (conversation history → current message)
- **Never put timestamps, request IDs, or session-specific data in the system prompt prefix**
- **Keep tool definitions fixed** — any change invalidates the cached prefix
- Strategic cache block placement (excluding dynamic tool results from cache scope) outperforms naive full-context caching

### Relevance to OllieBot

OllieBot's `buildSystemPrompt()` (`base-agent.ts:392-440`) assembles:
1. Base config (supervisor.md) — **stable, cacheable**
2. Mission context — **semi-stable** (changes per mission)
3. Memory context — **semi-stable** (changes when memories update)
4. Skills info — **stable per session**
5. RAG knowledge — **varies per request**

Reordering to put the most stable content first and marking cache breakpoints would improve hit rates. Conversation history (dynamic) should always be last.

**Source:** [Don't Break the Cache](https://arxiv.org/abs/2601.06007), [Anthropic Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

---

## 9. ACON: Adaptive Agent Context Optimization

### How It Works

ACON (Kang et al., October 2025) is a framework for learning optimal compression strategies for agent contexts:

1. Collect paired trajectories: full context (succeeds) vs. compressed context (fails)
2. A capable LLM analyzes failure causes and generates natural-language compression guidelines
3. Guidelines are iteratively refined through failure-driven learning
4. The resulting guidelines can be distilled into smaller models

### Results

- **26-54% peak token reduction** while maintaining task performance
- Improves performance by 32% on AppWorld, 20% on OfficeBench
- Distilled compressors retain 95% of teacher accuracy
- Gradient-free — works with closed-source models

### Relevance to OllieBot

The ACON approach could be adapted for OllieBot by:
1. Logging cases where context management leads to failures (agent forgets a user constraint, re-asks a question, etc.)
2. Using these failure cases to refine compression heuristics
3. Generating task-specific compression guidelines (e.g., "for coding tasks, always preserve file paths and error messages")

This is a medium-term investment requiring evaluation infrastructure.

**Source:** [ACON Paper](https://arxiv.org/abs/2510.00615)

---

## 10. Composable Transform Pipelines

### How It Works (AG2/AutoGen Pattern)

Rather than a single context management strategy, compose multiple transforms in a pipeline:

```
messages → MessageHistoryLimiter(20) → TextMessageCompressor(LLMLingua) → MessageTokenLimiter(max=8000) → LLM
```

Each transform operates independently:
- **MessageHistoryLimiter**: Cap message count
- **MessageTokenLimiter**: Cap total/per-message tokens
- **TextMessageCompressor**: Token-level compression via small model
- **Custom transforms**: PII redaction, tool result summarization, etc.

### Relevance to OllieBot

OllieBot already has the `TokenReductionService` but it's applied uniformly. A pipeline approach would allow:

1. **First pass**: Observation masking (strip old tool results)
2. **Second pass**: Template-aware compression (strip repeated template content from supervisor messages)
3. **Third pass**: Token budget enforcement (if still over limit, truncate oldest messages)
4. **Fourth pass**: Relevance injection (add semantically relevant older messages from outside the window)

Each step is independently testable and configurable.

**Source:** [AutoGen Transform Messages](https://microsoft.github.io/autogen/0.2/docs/topics/handling_long_contexts/intro_to_transform_messages/)

---

## 11. Whiteboard Memory (Semantic Kernel)

### How It Works

Each message is processed by a `WhiteboardProvider` that extracts:
- **Requirements** stated by the user
- **Proposals** made by the agent
- **Decisions** confirmed by either party
- **Actions** taken or pending

These are stored on a structured "whiteboard" and provided to the agent as additional context on every invocation. The whiteboard **survives chat history truncation** — even when raw messages are discarded, the structured decisions/requirements persist.

### Relevance to OllieBot

This is a more structured version of conversation-scoped memory (your Idea D). Instead of free-form "remember X", the agent maintains a structured record of:
- What the user asked for (requirements)
- What approaches were discussed (proposals)
- What was agreed upon (decisions)
- What's been done and what's pending (actions)

This could be implemented as a lightweight JSON structure stored per conversation and injected into the system prompt. The agent updates it via a tool call after significant exchanges.

**Source:** [Semantic Kernel Whiteboard Memory](https://devblogs.microsoft.com/semantic-kernel/managing-chat-history-for-large-language-models-llms/)

---

## 12. Episodic Memory with Reflection

### How It Works (Amazon Bedrock AgentCore)

Beyond storing facts, episodic memory captures structured episodes:
- **Context**: What situation triggered the episode
- **Reasoning**: What the agent considered
- **Actions**: What was done
- **Outcome**: What happened as a result

A reflection agent periodically analyzes episodes to extract **meta-level insights** — not just "user prefers TypeScript" but "when the user asks about code style, they care most about consistency with existing patterns."

### Relevance to OllieBot

This is a cross-session enhancement. OllieBot's `MemoryService` currently stores flat key-value memories. Adding structured episodes would enable:
1. Learning from past task execution patterns
2. Avoiding repeated mistakes across conversations
3. Improving tool selection based on what worked before

Lower priority than within-conversation improvements but valuable for long-term agent quality.

**Source:** [Amazon Bedrock Episodic Memory](https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/episodic-memory-strategy.html)

---

## 13. Evaluation & Metrics

### How to Measure Success

The right metrics for context management improvements:

| Metric | What It Measures | How to Collect |
|--------|-----------------|----------------|
| **Tokens per task** | Total tokens consumed to complete a user request | Sum input+output tokens across all LLM calls for a conversation turn |
| **Task success at context length** | Whether the agent maintains quality as conversations grow | Track task completion rate vs. message count |
| **Cache hit rate** | Fraction of input tokens served from cache | API response metadata |
| **Context utilization** | What proportion of context is system prompt vs. history vs. tool results | Log token counts by category |
| **Re-ask rate** | How often the agent asks for information already provided | Manual review or automated detection |
| **Information retention** | Can the agent recall key facts from earlier in conversation | Scripted test conversations with planted facts |

### Key Insight from Factory.ai

**Optimize for tokens per task, not compression ratio.** A 99% compression that loses critical details forces re-fetching, costing more total tokens than 70% compression that retains enough context. The right metric is end-to-end token cost for task completion.

### Benchmarks

- **Context-Bench** (Letta): Agent memory retrieval and multi-step reasoning
- **LoCoBench-Agent**: Long-context agent task performance (found Claude 3.5 Sonnet drops from 29% to 3% as context grows)
- **Context Rot** (Chroma): Model reliability at various context lengths — bigger windows don't help if content quality degrades

**Source:** [Factory.ai](https://factory.ai/news/evaluating-compression), [Context-Bench](https://www.letta.com/blog/context-bench), [Context Rot](https://research.trychroma.com/context-rot)

---

## 14. Recommendations for OllieBot

Ordered by impact-to-effort ratio:

### Tier 1: High Impact, Low Effort

**1. Observation Masking for Tool Results**
- Replace old tool results with stubs (keep only the last tool-calling message's results at full fidelity)
- Preserve the full action/reasoning chain
- Expected: 30-50% token reduction on conversations with heavy tool use
- Implementation: Modify `supervisor.ts` message construction (~50 lines)

**2. Prompt Structure for Cache Optimization**
- Reorder `buildSystemPrompt()` to put stable content first
- Add cache control breakpoints after tool definitions and base system prompt
- Expected: 40-80% cost reduction on the stable prefix
- Implementation: Modify `base-agent.ts:buildSystemPrompt()` ordering (~20 lines)

**3. Conversation-Scoped Memory (Scratchpad)**
- Add a per-conversation scratchpad the agent can read/write via tool
- Include in system prompt alongside existing memory
- Store in SQLite keyed by conversationId
- Expected: Prevents loss of key decisions/preferences when messages exit the window
- Implementation: Extend `MemoryService` + add a tool (~150 lines)

### Tier 2: Medium Impact, Medium Effort

**4. Template-Aware Compression**
- For supervisor messages based on templates, extract and store only the variable parts
- Reconstruct from template + variables when full message needed
- Expected: 20-40% reduction for repeated supervisor messages
- Implementation: Template diffing logic + message reconstruction (~200 lines)

**5. Relevance-Based Retrieval Beyond Window**
- Embed conversation messages and retrieve relevant older messages by similarity to current query
- Include as summarized context (not raw messages) to avoid temporal confusion
- Expected: Better retention of relevant context from early in long conversations
- Implementation: Embedding pipeline + retrieval logic + integration into message construction (~400 lines)

**6. Composable Transform Pipeline**
- Replace the current simple slice with a configurable pipeline: mask → compress → budget → retrieve
- Each step independently testable
- Expected: Flexible, tunable context management
- Implementation: Pipeline abstraction + individual transforms (~500 lines)

### Tier 3: High Impact, High Effort (Longer Term)

**7. Agent-Managed Memory (MemGPT Pattern)**
- Give the agent tools to search past conversation, archive important info, manage its own context
- The agent decides what to page in/out rather than relying on fixed policies
- Expected: Significant quality improvement for long conversations and complex tasks

**8. Whiteboard / Structured Decision Tracking**
- Automatically extract requirements, decisions, and actions from conversation
- Maintain as structured data that survives any context reduction
- Expected: Prevents the agent from contradicting or forgetting agreed-upon decisions

**9. Knowledge Graph for Conversation Entities**
- Extract entities and relationships from conversation
- Use graph queries to inject relevant structured context
- Expected: Better multi-hop reasoning ("what was the issue with the file the user mentioned earlier?")

---

## 15. Sources

### Academic Papers
- [ACON: Optimizing Context Compression for Long-horizon LLM Agents](https://arxiv.org/abs/2510.00615) (Kang et al., 2025)
- [Context Folding: Scaling Long-Horizon LLM Agents](https://arxiv.org/pdf/2510.11967) (Xu et al., 2025)
- [FoldAct: Stable Context Folding](https://arxiv.org/abs/2512.22733) (December 2025)
- [MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560) (Packer et al., 2023)
- [H-MEM: Hierarchical Memory for Long-Term Reasoning](https://arxiv.org/html/2507.22925v1) (2025)
- [E-mem: Episodic Context Reconstruction](https://arxiv.org/html/2601.21714) (2025)
- [Don't Break the Cache: Prompt Caching Evaluation](https://arxiv.org/abs/2601.06007) (Lumer et al., 2026)
- [AttentionRAG: Attention-Guided Context Pruning](https://arxiv.org/html/2503.10720v1)
- [KGGen: Knowledge Graph Extraction](https://arxiv.org/html/2502.09956v1)
- [LoCoBench-Agent: Long-Context Agent Benchmark](https://arxiv.org/pdf/2511.13998)

### Industry Research & Blog Posts
- [JetBrains Research: Efficient Context Management for Agents](https://blog.jetbrains.com/research/2025/12/efficient-context-management/) (NeurIPS 2025)
- [Factory.ai: Compressing Context](https://factory.ai/news/compressing-context)
- [Factory.ai: Evaluating Compression](https://factory.ai/news/evaluating-compression)
- [Chroma: Context Rot Research Report](https://research.trychroma.com/context-rot)
- [Letta: Guide to Context Engineering](https://www.letta.com/blog/guide-to-context-engineering)
- [Letta: Context-Bench](https://www.letta.com/blog/context-bench)
- [LangChain: Context Engineering for Agents](https://blog.langchain.com/context-engineering-for-agents/)

### Framework Documentation
- [Anthropic: Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic: Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)
- [Letta/MemGPT Docs](https://docs.letta.com/concepts/memgpt/)
- [LangGraph: Managing Conversation History](https://langchain-ai.github.io/langgraph/how-tos/create-react-agent-manage-message-history/)
- [AutoGen: Transform Messages](https://microsoft.github.io/autogen/0.2/docs/topics/handling_long_contexts/intro_to_transform_messages/)
- [Semantic Kernel: Managing Chat History](https://devblogs.microsoft.com/semantic-kernel/managing-chat-history-for-large-language-models-llms/)
- [Amazon Bedrock: Agent Memory](https://docs.aws.amazon.com/bedrock/latest/userguide/agents-memory.html)
- [OpenAI: Conversation State](https://platform.openai.com/docs/guides/conversation-state)
- [CrewAI: Memory](https://docs.crewai.com/en/concepts/memory)

### Open Source Repositories
- [Letta (MemGPT)](https://github.com/letta-ai/letta)
- [AG2 (AutoGen)](https://github.com/ag2ai/ag2)
- [Agent Memory Paper List](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)
- [Awesome KV-Cache Management](https://github.com/TreeAI-Lab/Awesome-KV-Cache-Management)
