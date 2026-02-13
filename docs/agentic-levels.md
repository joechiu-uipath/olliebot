# Problem Levels & Agentic System Architecture Map

## Overview

Each level of problem complexity demands a qualitatively different agentic architecture — not just "more compute" but fundamentally different subsystems, coordination patterns, and evaluation mechanisms. The confidence in our architectural prescriptions decreases as we move up the levels: Levels 0–2 are well-validated in production systems today; Level 3 is emerging with early evidence; Level 4 is largely speculative projection.

**A note on subsystem necessity:** Every subsystem described at a given level could be *useful* at earlier levels. The claim is not that they appear for the first time, but that they become **necessary** — that attempting to operate at the given level without them leads to predictable, systematic failure. For each new subsystem, we argue: (1) what tier-defining characteristic demands it, (2) why earlier tiers can get by without it, and (3) what specific failure mode emerges from its absence.

Individually, each subsystem is necessary but not sufficient. The claim is that the full set of subsystems at each tier collectively crosses the sufficiency threshold for that tier's defining requirements.

---

## Level 0 — Factual Question & Answer

**Nature of the problem:** A bounded question with a retrievable or computable answer. The answer exists somewhere; the system just needs to surface it correctly.

**Examples:** "What's the capital of France?", "Summarize this contract clause", "Convert this CSV to JSON"

**Duration:** Seconds to low minutes

**Defining characteristic:** The answer is a single retrievable or derivable fact. Correctness is binary or near-binary.

### Required Subsystems

These are foundational and carry forward to all subsequent levels. We do not argue for their necessity here as it is self-evident.

| Subsystem | Role | Maturity |
|-----------|------|----------|
| **LLM Core** | Single inference pass, possibly with chain-of-thought | Production ✅ |
| **System Prompt / Persona Layer** | Controls tone, brevity, format, audience-level | Production ✅ |
| **Tool Router** | Decides whether to call a tool (calculator, search, DB lookup) vs. answer from parametric knowledge | Production ✅ |
| **Citation / Grounding Layer** | Post-hoc or inline attribution to sources | Production ✅ |

### Architectural Properties
- **Stateless or minimally stateful** — each query is largely independent
- **Single-turn or thin multi-turn** — conversation context is short
- **Evaluation is straightforward** — factual accuracy, format compliance, latency
- **Failure mode:** hallucination, stale information, wrong tool selection

---

## Level 1 — Research & Answer

**Nature of the problem:** The answer doesn't exist in a single source. The system must formulate sub-questions, gather evidence across multiple sources, assess relevance and credibility, and synthesize a coherent answer.

**Examples:** "What are the pros and cons of microservices vs. monolith for our 50-person team?", "How does Drug X interact with Condition Y across recent literature?"

**Duration:** Minutes to tens of minutes

**Defining characteristic:** The answer must be *constructed through multi-step evidence gathering and synthesis*. No single retrieval can produce it. The system must make iterative decisions about what to look for next based on what it's found so far.

### New Subsystems (Summary)

| Subsystem | Role | Maturity |
|-----------|------|----------|
| **Iterative Research Loop** | Decomposes questions into sub-queries; executes adaptive search cycles (act → observe → reason → act again) | Production ✅ |
| **Working Memory** | Accumulates and organizes findings across tool calls within a session | Production ✅ |
| **Evidence Assessor** | Evaluates source credibility, detects contradictions between sources, weighs evidence quality | Emerging 🟡 |
| **Sufficiency Check** | Determines whether enough evidence exists to answer, or whether to keep searching | Emerging 🟡 |

### Necessity Arguments

#### Iterative Research Loop

*Why earlier tiers get by without it:* At Level 0, a single well-formed query almost always suffices. Even when a Level 0 system chains two tool calls, the second is predictable from the first — there's no conditional reasoning between steps.

*Why it's essential at Level 1:* Level 1's defining characteristic is that the answer must be *constructed* from multiple pieces of evidence. "Pros and cons of microservices for a 50-person team" requires separate investigation of performance, team coordination, deployment complexity, hiring implications, etc. Moreover, research is inherently adaptive — what you search for second depends on what you found first. Without an iterative loop, the system must decide all its searches upfront, before seeing any results. It cannot follow leads, notice unexpected patterns, or recognize when a line of inquiry is fruitless.

*Consequence of absence:* The system makes one broad search and synthesizes from whatever comes back. The output is shallow, biased toward whatever framing the top results happen to use, and unable to systematically cover the dimensions of the question. This is the difference between "I searched and here's what I found" and "Here are the 5 dimensions of this question, investigated individually and adaptively."

#### Working Memory

*Why earlier tiers get by without it:* At Level 0, the context window handles this naturally — there's not enough intermediate content to manage.

*Why it's essential at Level 1:* A research session generates far more intermediate content than fits comfortably in unstructured context: search results, extracted facts, partial syntheses, emerging contradictions. Without explicit working memory, the system loses track of earlier findings as the context fills with later tool results. The system cannot *compare* findings across sources — it processes each sequentially and hopes the final synthesis is coherent.

*Consequence of absence:* The synthesis is biased toward recency-within-the-session. The last few sources searched dominate the answer regardless of their relative importance, because earlier findings have been pushed out of effective attention.

#### Evidence Assessor

*Why earlier tiers get by without it:* At Level 0, tool selection (choosing a specific database vs. web search) handles most credibility concerns implicitly. And with a single source, there's nothing to compare.

*Why it's essential at Level 1:* When synthesizing across multiple sources, the system must *weigh* evidence — a peer-reviewed meta-analysis and a blog post should not contribute equally. It must also detect when sources contradict each other, because the value of Level 1 over Level 0 is precisely the ability to present a nuanced picture: "Evidence suggests X under conditions A, but Y under conditions B." Without evidence assessment, synthesis degrades to "majority of sources say X" regardless of source quality, and contradictions are silently hidden or produce incoherent output.

*Consequence of absence:* The system treats all sources as equally authoritative and silently resolves contradictions by picking whichever source it processed last. The user gets false certainty — a confident answer that hides disagreement and may be driven by SEO-optimized content rather than authoritative evidence.

#### Sufficiency Check

*Why earlier tiers get by without it:* At Level 0, the question is binary — you found the answer or you didn't. There's no gradient of "enough evidence."

*Why it's essential at Level 1:* This is Level 1's defining control mechanism — the thing that makes it a research process rather than a multi-step lookup. Unlike Level 0 (where completion is obvious) or Level 2 (where external criteria define completion), Level 1 relies entirely on self-assessment to decide when to stop. Without it, the system must use an arbitrary stopping rule ("do exactly 5 searches"), producing answers that are sometimes shallow (needed more searching) and sometimes wasteful (the answer was clear after 2 searches).

*Consequence of absence:* The system cannot distinguish between "I've covered this well" and "I've barely scratched the surface." It also cannot recognize when a question is unanswerable with available tools — it just searches until the budget runs out.

### How the Subsystems Collectively Satisfy Level 1

Level 1's defining requirement: *construct an answer through multi-step evidence gathering and synthesis.*

- **Iterative Research Loop** ensures systematic, adaptive coverage of the question
- **Working Memory** ensures all findings are available for synthesis, not just recent ones
- **Evidence Assessor** ensures findings are weighted and contradictions surfaced
- **Sufficiency Check** ensures the process terminates appropriately — neither too early nor too late

Remove any one, and the system degrades in a specific, predictable way. Remove two or three, and it collapses back to Level 0: a single-pass attempt that may use multiple tools but doesn't perform genuine research.

---

## Level 2 — Adversarially Validated Research

**Nature of the problem:** The output must survive scrutiny from an **external evaluation process the system does not control** — peer review, regulatory audit, legal discovery, security review. The quality bar is not self-assessed; it is imposed by an adversarial (but fair) process that actively looks for weaknesses, gaps, and unsupported claims. The system must *strategize* about how to meet this external standard, not merely follow an internal checklist.

**Examples:** "Produce a systematic literature review that would survive peer review", "Prepare due diligence documentation for regulatory approval", "Draft a legal brief that will withstand opposing counsel's scrutiny", "Write a security audit report that meets SOC 2 standards"

**Duration:** Hours to days

**Defining characteristic:** The system is accountable to an **external evaluator it does not control**, who assesses both the output AND the process that produced it. Quality criteria are imposed, not self-selected.

### The Critical Distinction from Level 1

The boundary between Level 1 and Level 2 is not about the *difficulty* of the research or even the *quality* of the output. It's about **what the system optimizes for and what it's accountable to**. The distinction operates along several reinforcing axes:

#### Axis 1: Output Optimization vs. Process + Output Optimization

A Level 1 system is judged purely on its output. If the final synthesis is accurate, well-sourced, and coherent, the job is done — nobody asks how it got there.

A Level 2 system is judged on its output AND the process that produced it. An academic peer reviewer checks your methodology. An auditor checks your procedures. A regulator checks your documentation. A good conclusion reached through a flawed process fails Level 2 evaluation, even if it would pass Level 1.

This means a Level 2 system must **document, justify, and expose its methodology** — not as a nice-to-have, but because the methodology is part of what's being evaluated. A Level 1 system's reasoning is internal scaffolding; a Level 2 system's reasoning is part of the deliverable.

#### Axis 2: Self-Assessment vs. Evaluator Modeling

A Level 1 system asks: *"Is this good?"* — applying its own quality heuristics.

A Level 2 system asks: *"Would Evaluator X accept this?"* — where Evaluator X has specific, knowable priorities that may differ from the system's own quality intuitions. The system must build a model of what the external evaluator cares about and optimize for *that*.

This divergence matters most when the evaluator's priorities differ from what would make the output most useful to the end user. A peer reviewer may demand methodological detail the user doesn't care about. An auditor may require documentation the user finds tedious. A Level 2 system must serve both audiences — or recognize when it can't.

#### Axis 3: Confirmation Tolerance vs. Anti-Cherry-Picking Discipline

Consider the task: *"Research whether remote work improves productivity, concluding that it does."*

A Level 1 system could do this well. There is genuine evidence supporting remote work productivity gains. The system would search, find supporting sources, synthesize them coherently, and pass its own quality check: "Is this well-supported? Are my sources credible? Is the reasoning sound?" The answer to all three is yes. The output looks rigorous and the user is satisfied.

A Level 2 system targeting peer review would confront a deeper problem: the external standard requires that conclusions *emerge from* evidence, not that evidence be *selected for* conclusions. The process must include systematic search strategies, explicit inclusion/exclusion criteria, engagement with contradicting evidence, and documentation of how conflicting findings were weighed. A predetermined conclusion isn't necessarily wrong — but it's incompatible with the *process* the external standard demands.

This is a subtler form of infeasibility than "the Earth is flat." The evidence might genuinely support the conclusion, but the *method* of starting with the conclusion and working backward is what the external evaluator would reject. Level 1 doesn't see this as a problem because it only evaluates the output. Level 2 sees it because it models the evaluator's process expectations.

#### Axis 4: Positive Reporting vs. Comprehensive Reporting

A Level 1 system reports what it found. If a search comes up empty, it typically moves on — the absence of evidence isn't useful to the user.

A Level 2 system must report **what it looked for and didn't find**, because the external evaluator checks for completeness. "We searched databases X, Y, and Z using terms A, B, and C. Database Z returned no relevant results." This negative reporting is demanded by the external process as evidence of thoroughness.

#### Axis 5: Task Completion vs. Feasibility Assessment

Both Level 1 and Level 2 systems can recognize obviously infeasible tasks (the "flat Earth" case). But they diverge on subtler infeasibility — where the conflict is between the *requested framing* and the *process requirements of the external standard*, not between the hypothesis and the evidence.

A Level 2 system must continuously assess: "Given what I'm finding, can the output I'm building meet the external standard? If not, what would I need to change — the approach, the scope, or the conclusion — to make it viable?" And it must surface this assessment to the user rather than silently producing the best output it can.

#### Summary Table

| Dimension | Level 1 (Self-Assessed) | Level 2 (Adversarially Validated) |
|-----------|------------------------|----------------------------------|
| **What is evaluated?** | The output | The output AND the process |
| **Who sets the bar?** | The system's own quality heuristics | An external evaluator with specific, knowable standards |
| **Whose priorities govern?** | The end user's | The external evaluator's (which may differ from the user's) |
| **Handling of methodology** | Internal scaffolding (invisible) | Part of the deliverable (must be documented and defensible) |
| **Contradicting evidence** | Noted if relevant to the answer | Systematically engaged with, because the evaluator checks |
| **Negative findings** | Typically omitted | Required as evidence of thoroughness |
| **Predetermined conclusions** | Acceptable if well-supported | May conflict with process requirements regardless of evidence |

### New Subsystems (Summary)

*Inherits all of Level 1.*

| Subsystem | Role | Maturity |
|-----------|------|----------|
| **External Standard Model** | Represents what the external evaluator checks, prioritizes, and challenges; identifies gaps between current output and required standard | Emerging 🟡 |
| **Adversarial Self-Review** | Models the external evaluator to attack own work; detects when the task as framed cannot meet the standard | Emerging 🟡 |
| **Process & Compliance Auditor** | Verifies research process against external requirements; maintains full provenance chain and enforces required output structure | Emerging 🟡 |
| **Human-in-the-Loop Checkpoints** | Scheduled governance points for scope approval, methodology approval, infeasibility acknowledgment | Emerging 🟡 |

### Necessity Arguments

*Inherits all of Level 1.* The following are new or fundamentally transformed at Level 2.

#### External Standard Model

*Why earlier tiers get by without it:* At Level 1, the system's own quality intuitions are sufficient — it doesn't need to model a separate evaluator because it IS the evaluator. "Good enough" is whatever the system judges it to be.

*Why it's essential at Level 2:* Level 2's defining characteristic is accountability to an external evaluator. Without a model of what that evaluator cares about, the system is optimizing blind. It might produce excellent work by its own standards that fails the external evaluation on points it never considered. An SOC 2 auditor cares about specific control categories that wouldn't naturally emerge from a general "be thorough" heuristic. A peer reviewer in machine learning expects ablation studies. Without the External Standard Model, the system treats external evaluation as Level 1 self-assessment with a higher bar — "just be more thorough" — which misses the *specific, idiosyncratic* requirements of the standard.

*Consequence of absence:* The output may be excellent research that fails peer review because it omits a limitations section, or a thorough audit that fails regulatory review because it doesn't follow the prescribed reporting format. The failure is not in quality but in *alignment with what the evaluator actually checks*.

#### Adversarial Self-Review

*Why earlier tiers get by without it:* Level 1's Sufficiency Check is cooperative — "have I done enough?" This improves quality but doesn't simulate hostile scrutiny.

*Why it's essential at Level 2:* The external evaluator is not trying to help the system improve — they are testing whether the work meets a standard. The system must adopt this adversarial stance toward its own work: "Where would a peer reviewer push back? What would opposing counsel challenge? Are all my citations from the same research group? Does a key claim rest on a single small-N study?" This includes the crucial capability of detecting when the task *as framed* cannot meet the external standard — not because the evidence doesn't exist (Level 1 can catch that), but because the requested framing conflicts with the process the standard requires (the "remote work with predetermined conclusion" case).

*Consequence of absence:* The system has blind spots it cannot discover through cooperative self-review. A system that asks "is this well-supported?" finds that yes, every claim has a citation. A system that asks "would a hostile reviewer accept this?" notices that the citations are cherry-picked, the methodology is undocumented, or the framing is incompatible with the standard's process requirements. Without adversarial review, these vulnerabilities survive to external evaluation.

#### Process & Compliance Auditor

*Why earlier tiers get by without it:* At Level 1, the research process is internal scaffolding — it matters only insofar as it produces a good output. No one checks whether you searched three databases or five.

*Why it's essential at Level 2:* At Level 2, the process IS part of the deliverable (Axis 1). The external evaluator checks whether the prescribed process was followed: Did you search the required databases? Are inclusion/exclusion criteria stated and consistently applied? Is every claim traceable from claim → evidence → source → search methodology? A systematic review without a PRISMA flow diagram is incomplete regardless of content quality. A regulatory filing missing a required section is rejected on form. This subsystem exists because the external evaluator may check structural and process compliance *before even reading the content*.

*Consequence of absence:* The system may do excellent research through an undocumented, ad hoc process that the external evaluator cannot verify. If probed on provenance — "You cite Smith 2023, but your methodology says you only searched databases X and Y; Smith 2023 is in database Z" — the system cannot explain the discrepancy. The work may be legitimate but cannot *prove* its legitimacy, which is what external evaluation demands.

#### Human-in-the-Loop Checkpoints

*Why earlier tiers get by without it:* At Level 1, the system can reasonably proceed autonomously — the stakes of a wrong turn are low (just more searching).

*Why it's essential at Level 2:* Level 2 tasks are high-stakes and externally accountable. A wrong strategic choice — wrong scope, wrong methodology, wrong interpretation of the external standard — can waste hours of work. Some decisions require *human authority*: approving methodology before execution, acknowledging an infeasibility finding, deciding whether to revise scope or abandon the task. These are governance decisions — the human isn't helping the system do better work; they are authorizing the system's direction in a context where the output carries reputational consequences.

*Consequence of absence:* The system makes irreversible strategic commitments without oversight. If it misinterprets the external standard, it discovers this only at the end. The human discovers bad decisions at final review, when correction cost is maximal.

### How the Subsystems Collectively Satisfy Level 2

Level 2's defining requirement: *produce output that survives scrutiny from an external evaluation process, assessed on both process and output.*

The inherited **Iterative Research Loop** from Level 1 already provides multi-round research and revision capability. What Level 2 adds is the subsystems that make that loop *externally accountable*:

- **External Standard Model** tells the system what it's being evaluated on — the loop now optimizes against external criteria, not self-assessed quality
- **Adversarial Self-Review** identifies where the current output would fail external evaluation — the loop now targets its weakest points rather than improving uniformly
- **Process & Compliance Auditor** ensures the methodology is documented, traceable, and structurally compliant — the loop's process becomes part of the deliverable
- **Human-in-the-Loop Checkpoints** provide governance for high-stakes decisions

Remove External Standard Model, and the inherited research loop doesn't know what it's optimizing for — it collapses to Level 1 self-assessment. Remove Adversarial Self-Review, and the loop has no way to anticipate external criticism — it submits work with unknown vulnerabilities. Remove Process & Compliance Auditor, and the methodology can't survive scrutiny regardless of output quality. Remove any two, and the system can still produce good research (Level 1) but cannot reliably pass external scrutiny (Level 2).

---

## Level 3 — Problem Solving (Complex Artifact Construction)

**Nature of the problem:** The output is not a document but a **complex, multi-part, internally-consistent system** — a codebase, an engineering design, a business plan with financial models, a policy package. The parts must cohere with each other, and the whole must function.

**Examples:** "Build a full-stack SaaS application", "Design a supply chain for this product", "Develop a clinical trial protocol with all supporting documents"

**Duration:** Days to weeks

**Defining characteristic:** The output is a **system of interdependent parts** that must be internally consistent and functionally correct. Parts are built incrementally, and changes to one part may require changes to others. The task outlives any single context window.

### New Subsystems (Summary)

*Inherits relevant parts of Levels 1–2.*

| Subsystem | Role | Maturity |
|-----------|------|----------|
| **Planner / Architect** | Decomposes problem into work breakdown structure; defines interfaces and constraints between components; sequences work | Early 🟠 |
| **Multi-Agent Coordination** | Specialist agents for different domains; orchestration layer managing task breakdown, assignment, status tracking, dependencies, sequencing, and parallelism | Early 🟠 |
| **Long-Term Memory & Shared State** | Tiered memory (hot/warm/cold) managing information across sessions; single source of truth for artifact state, decisions, and interface contracts between components | Early 🟠 |
| **Integration & Recovery** | Verifies parts work together through execution; enables rollback of specific components without losing unaffected progress | Early 🟠 |

### Necessity Arguments

*Inherits relevant parts of Levels 1–2.* The following are new or fundamentally transformed at Level 3.

#### Planner / Architect

*Why earlier tiers get by without it:* Level 1 benefits from query planning, and Level 2 from methodology design. But at these levels, "planning" means choosing a sequence of largely independent research steps — a wrong step wastes time but doesn't corrupt other steps.

*Why it's essential at Level 3:* Level 3's defining characteristic is interdependency between parts. A database schema decision constrains the API design, which constrains the frontend, which constrains the deployment architecture. Without upfront architectural planning, these constraints are discovered only when parts fail to integrate — at which point the rework cost is proportional to how many dependent components were already built. The Planner exists because **in a system of interdependent parts, local decisions have non-local consequences**, and someone must reason about these consequences before committing.

*Consequence of absence:* Each component is built in isolation, making locally reasonable decisions. Integration reveals fundamental incompatibilities: the frontend assumes REST but the backend exposes GraphQL; the data model doesn't support a workflow the business logic requires. These aren't bugs — they're architectural mismatches requiring redesign of multiple components. The system discovers its architecture empirically through integration failures, which is the most expensive way to learn it.

#### Multi-Agent Coordination

*Why earlier tiers get by without it:* Level 2 uses multiple "roles" (researcher, reviewer), but these are sequential and the work is uniform in type — it's all research. A single generalist agent can handle all Level 2 activities.

*Why it's essential at Level 3:* Complex artifact construction requires genuinely different *types* of work — writing frontend code is categorically different from database design or security testing. A single agent attempting all of these produces mediocre work across the board because the context, patterns, and quality criteria differ radically. But having specialists creates a coordination problem that operates at two layers. First, **task management**: the architectural plan must be decomposed into discrete tasks with clear definitions of done, assigned to appropriate agents, and tracked through to completion — the system needs a persistent view of what's been done, what's in progress, what's blocked, and what's remaining. Second, **orchestration**: tasks have dependencies and sequencing constraints, some can run in parallel, and outputs from one must be routed as inputs to another. Without explicit coordination at both layers, agents duplicate work, build against stale interfaces, or block each other indefinitely.

*Consequence of absence:* Either a single agent context-switches between radically different work (losing domain context at each switch, producing quality degraded by attention fragmentation), or multiple agents operate without coordination — tasks fall through cracks because no one tracks them, two agents unknowingly work on the same problem, or one agent waits indefinitely for output another doesn't know it should produce. The system has no answer to basic questions like "what's left to do?" or "what's blocking progress?"

#### Long-Term Memory & Shared State

*Why earlier tiers get by without it:* Below Level 3, everything can plausibly fit in a context window. Level 1's Working Memory tracks findings within a session. Level 2's Process Auditor tracks methodology. But at these levels, the "state" is accumulated notes within a single agent's session — there's no structural integrity requirement between parts, and no need for multiple agents to share a consensus view.

*Why it's essential at Level 3:* Level 3 introduces two memory challenges simultaneously. First, **temporal**: tasks take days or weeks, involving thousands of intermediate steps. **No context window, however large, will ever be sufficient** — the system must make active decisions about what to remember, summarize, and forget. This is analogous to the shift from CPU registers to a full memory hierarchy in computer architecture. Second, **spatial**: multiple agents must work from the same understanding of what exists. If Agent A believes the user model has fields X, Y, Z and Agent B believes it has X, Y, W, they build incompatible components. The memory system must serve as the **consensus reality** — the single source of truth for artifact state, all decisions made (with rationale), and the explicit interface contracts between components. These contracts (API specs, schemas, shared types) make inter-component promises enforceable; without them, every interface is an undocumented assumption, and with N components there are O(N²) potential mismatches.

*Consequence of absence:* **Decision amnesia:** the system re-litigates settled architectural choices because it's lost the context for why they were made — and different agents at different times may reach different conclusions, introducing inconsistencies. **Architectural drift:** each agent maintains its own divergent understanding of the artifact state; errors manifest only at integration, by which point extensive rework is needed. Drift is the most insidious Level 3 failure mode because each agent's work looks correct in isolation. **Context rot:** compressed summaries lose critical details, leading to decisions based on incomplete understanding of prior work.

```
┌─────────────────────────────────────────────┐
│           MEMORY ARCHITECTURE               │
├─────────────────────────────────────────────┤
│                                             │
│  HOT CONTEXT (in active window)             │
│  ├─ Current task/subtask description        │
│  ├─ Relevant interface contracts            │
│  ├─ Recent decisions & rationale            │
│  └─ Immediate dependencies                  │
│                                             │
│  WARM STORAGE (retrievable, summarized)     │
│  ├─ Completed component summaries           │
│  ├─ Decision log (what & why)               │
│  ├─ Known constraints & requirements        │
│  └─ Error history & lessons learned         │
│                                             │
│  COLD STORAGE (full fidelity, indexed)      │
│  ├─ Complete source artifacts               │
│  ├─ Full conversation/reasoning traces      │
│  ├─ All tool call results                   │
│  └─ Discarded alternatives & reasons        │
│                                             │
└─────────────────────────────────────────────┘
```

#### Integration & Recovery

*Why earlier tiers get by without it:* Level 2 checks document consistency — "does the paper contradict itself?" But this is a semantic check within a single artifact, verifiable by reading.

*Why it's essential at Level 3:* Level 3 parts must *functionally interoperate*, not just semantically cohere. Code must compile. APIs must accept the data formats other components send. This requires *execution*, not just inspection — human review cannot reliably detect functional incompatibility across hundreds of interacting components. Equally important is recovery: in a system of interdependent parts, some decisions prove wrong after dependent work has been built on them. Without rollback, a wrong decision either becomes permanent technical debt or triggers cascading rework. Recovery enables a third option: surgical reversion without catastrophic cost.

*Consequence of absence:* Integration failures are discovered late — when someone tries to run the complete system. Each failure requires diagnosing which components are incompatible and fixing one or both. Without continuous integration, failures accumulate and interact (fixing one may reveal or create others). Without rollback, accumulated technical debt degrades quality while the system becomes increasingly afraid to change anything because recovery cost is unknown.

### How the Subsystems Collectively Satisfy Level 3

Level 3's defining requirement: *produce a system of interdependent parts that is internally consistent and functionally correct.*

Level 3 also inherits and extends **Human-in-the-Loop Checkpoints** from Level 2. At Level 2, these are scheduled (approve scope, approve methodology). At Level 3, the same mechanism must additionally handle *unpredictable* escalation — conflicting requirements discovered mid-construction, architectural decisions that exceed the system's judgment, irreversible choices with non-local consequences. This isn't a new subsystem; it's the same governance capability operating in a more dynamic context.

The new subsystems address the core challenge through two complementary mechanisms:

**Prevention of inconsistency:**
- **Planner / Architect** makes non-local consequences visible before committing
- **Long-Term Memory & Shared State** keeps agents working from the same reality with explicit interface contracts
- **Multi-Agent Coordination** ensures agents work in compatible order with current information

**Detection and recovery from inconsistency:**
- **Integration & Recovery** catches incompatibilities through execution and enables surgical reversion
- **Long-Term Memory & Shared State** prevents decision amnesia that would reintroduce resolved inconsistencies

Neither mechanism alone is sufficient. Prevention without detection means the first unpreventable inconsistency is catastrophic. Detection without prevention means the system spends most of its time fixing avoidable failures. Together, they make iterative construction of complex artifacts viable.

---

## Level 4 — Continuous System (Open-Ended Direction Optimization)

**Nature of the problem:** There is no terminal state. The "goal" is a direction, not a destination. The system must continuously monitor, assess, prioritize, act, and adapt — indefinitely. The environment changes, the system changes, and what "progress" means may itself evolve.

**Examples:** "Optimize for world peace", "Maintain system reliability at 99.99%", "Continuously improve customer satisfaction", "Manage this investment portfolio"

**Duration:** Indefinite (months, years, ongoing)

**Defining characteristic:** The system operates over an **indefinite time horizon** in a **non-stationary environment**, pursuing a **directional goal** with no terminal state. It must persist, adapt, and maintain coherence across timescales far exceeding any single task.

### New Subsystems (Summary)

*Inherits relevant parts of Levels 1–3.*

| Subsystem | Role | Maturity |
|-----------|------|----------|
| **Environment Sensing & World Model** | Continuously ingests real-world signals; maintains updated model of relevant world state with uncertainty estimates and causal relationships | Speculative 🔴 |
| **Strategy & Resource Allocation** | Identifies highest-leverage opportunities and risks; maintains medium-term strategy; manages portfolio of concurrent initiatives; allocates finite resources | Speculative 🔴 |
| **Learning & Institutional Memory** | Measures impact of past actions; accumulates organizational-scale knowledge, relationships, and lessons across indefinite time horizons | Speculative 🔴 |
| **Self-Modification Engine** | Adapts own processes, monitoring, and strategies within governance-approved bounds as environment evolves | Speculative 🔴 |

### Necessity Arguments

*Inherits relevant parts of Levels 1–3.* The following are new or fundamentally transformed at Level 4.

#### Environment Sensing & World Model

*Why earlier tiers get by without it:* Level 3's Shared State tracks the state of the artifact being built. The environment is relatively stable for the duration of a week-long project — requirements may evolve, but the world doesn't fundamentally shift.

*Why it's essential at Level 4:* Level 4's defining characteristic of a non-stationary environment means the system's context is constantly shifting. A strategy that was optimal yesterday may be counterproductive today because of an external event. Raw signals alone are insufficient — the system needs a *model* of how signals relate and what they imply for the future, because Level 4 requires *anticipatory* action (responding to emerging trends, not just reacting to events). Without environment sensing, the system optimizes for the world as it was, not as it is. Without a world model, it's purely reactive — always behind.

*Consequence of absence:* The system becomes increasingly misaligned with reality over time. Every decision is made against an outdated understanding. For fast-moving domains (financial markets, geopolitics), this divergence becomes critical within hours. For slower domains (institutional optimization), the eventual correction is more disruptive because more has been built on false assumptions. The system is an open-loop controller in a domain that requires closed-loop control.

#### Strategy & Resource Allocation

*Why earlier tiers get by without it:* Level 3's Planner allocates effort across components of a bounded project. Strategy is set once (with human input) and followed, with adjustments for obstacles. Resources are allocated at planning time.

*Why it's essential at Level 4:* Level 4's directional goal and indefinite time horizon create two problems that don't exist at Level 3. First, the system must *choose what to work on* from an effectively unbounded action space — "What is the single most effective thing we could do right now toward world peace?" is fundamentally different from "What component should we build next?" Second, the system must be *sustainable* — it cannot burn through resources on early initiatives and have nothing left. This requires reasoning about marginal returns, opportunity costs, and portfolio diversification across concurrent initiatives. Without strategy, the system either thrashes (constantly changing direction without accumulating progress) or ossifies (following an initial approach regardless of changed conditions). Without resource management, it exhausts itself early.

*Consequence of absence:* The system exhibits one of three pathologies. Thrashing: every new signal triggers a direction change. Rigidity: it locks into an initial approach as conditions change around it. Exhaustion: it over-invests early and cannot sustain operations. All are fatal for indefinite-horizon goals.

#### Learning & Institutional Memory

*Why earlier tiers get by without it:* Level 3's Long-Term Memory manages project-scoped memory that can be discarded when the project completes. Level 3's Integration & Recovery provides immediate feedback (code runs or doesn't).

*Why it's essential at Level 4:* Level 4 actions have delayed, probabilistic, and often ambiguous effects — did that policy reduce conflict, or would conflict have declined anyway? Without impact measurement, the system cannot learn from its own actions, making Strategy & Resource Allocation uncalibrated and essentially arbitrary. Furthermore, Level 4 operates indefinitely: knowledge from Year 1 must be available in Year 3. Past strategies, past failures, relationships with external entities — all persist and compound. Without institutional memory, the system is perpetually a novice: it repeats past mistakes, re-derives settled knowledge, and cannot build cumulative understanding.

*Consequence of absence:* The system operates in open loop — it takes actions but never learns whether they worked. Resource allocation becomes guesswork. Over time, it accumulates strategies of unknown effectiveness. It also repeats past mistakes because it has no record of them, and re-evaluates settled questions from scratch, wasting resources on re-derivation. This is the difference between a person with amnesia and a seasoned professional.

#### Self-Modification Engine

*Why earlier tiers get by without it:* Level 3 tasks are bounded — there's limited time for self-modification benefits to accumulate. The system's processes don't have time to become obsolete.

*Why it's essential at Level 4:* Over an indefinite time horizon in a non-stationary environment, the system's initial design will become increasingly mismatched to operating conditions. Processes efficient in Year 1 may be bottlenecks in Year 3. The optimal system design is itself non-stationary — it must co-evolve with the environment. Without self-modification, the system ossifies, becoming rigid and increasingly ineffective as the gap between its fixed processes and the evolving environment grows.

*Consequence of absence:* The system operates with fixed processes in a changing world. Its effectiveness degrades over time — not from mistakes, but from obsolescence. It becomes the organizational equivalent of a legacy codebase: still running, but increasingly fragile and inefficient. Human intervention can update it, but this requires awareness of the specific deficiency, which is hard when the system operates across many domains.

### Level 4 Memory Architecture

Level 4's memory challenge is qualitatively different from Level 3. Where Level 3 needs project memory organized by recency and relevance, Level 4 needs something closer to human cognitive architecture:

```
┌───────────────────────────────────────────────────────┐
│         LEVEL 4 MEMORY ARCHITECTURE                   │
├───────────────────────────────────────────────────────┤
│                                                       │
│  EPISODIC MEMORY                                      │
│  "What happened?"                                     │
│  ├─ Event log with timestamps                         │
│  ├─ Action-outcome pairs                              │
│  └─ Decay/summarization over time                     │
│                                                       │
│  SEMANTIC MEMORY                                      │
│  "What do we know?"                                   │
│  ├─ Domain knowledge (updated from experience)        │
│  ├─ Entity models (people, orgs, systems)             │
│  └─ Confidence levels that update with evidence       │
│                                                       │
│  STRATEGIC MEMORY                                     │
│  "What are we trying to do and why?"                  │
│  ├─ Current strategy and rationale                    │
│  ├─ Goal interpretation history                       │
│  └─ Active initiatives and their status               │
│                                                       │
│  PROCEDURAL MEMORY                                    │
│  "How do we do things?"                               │
│  ├─ Learned playbooks and workflows                   │
│  └─ Self-modified processes                           │
│                                                       │
└───────────────────────────────────────────────────────┘
```

### How the Subsystems Collectively Satisfy Level 4

Level 4's defining requirement: *pursue a directional goal over an indefinite time horizon in a non-stationary environment, while maintaining coherence and alignment.*

The subsystems form a continuous loop:

1. **Sense:** Environment Sensing & World Model → understand what's happening
2. **Orient & Decide:** Strategy & Resource Allocation → prioritize and commit resources
3. **Act:** (inherited Level 3 execution capabilities)
4. **Learn:** Learning & Institutional Memory → understand what worked
5. **Adapt:** Self-Modification Engine → evolve the system itself

Alignment and governance — ensuring the system's direction still matches its operators' intent — is a critical concern for Level 4, but it is imposed *on* the system by external oversight, not provided *by* the system to itself. Just as a corporation doesn't self-govern (it has a board, regulators, and markets), a Level 4 system operates within externally-imposed governance structures.

The loop itself is recognizably an OODA cycle (Observe-Orient-Decide-Act) extended with learning and adaptation. Each subsystem enables a specific phase. Remove Sensing, and the system is blind. Remove Strategy, and it thrashes. Remove Learning, and it doesn't improve. Remove Self-Modification, and it ossifies. Each failure mode is distinct and characteristic — confirming that each subsystem addresses a genuinely separate concern.

---

## Cross-Cutting Concerns Across Levels

### How Subsystem Importance Scales

| Subsystem | L0 | L1 | L2 | L3 | L4 |
|-----------|----|----|----|----|-----|
| Single LLM inference | ●●● | ●● | ●● | ●● | ●● |
| Tool use | ● | ●●● | ●●● | ●● | ●● |
| Working / long-term memory | — | ●● | ●● | ●●● | ●●● |
| Multi-agent coordination | — | — | ● | ●●● | ●●● |
| Quality evaluation | ● | ●● | ●●● | ●●● | ●●● |
| Process auditing | — | — | ●●● | ●● | ●●● |
| Human governance | — | — | ●● | ●● | ●●● (external) |
| Self-modification | — | — | — | ● | ●●● |
| Environment monitoring | — | — | — | — | ●●● |
| Strategy / planning | — | ● | ●● | ●●● | ●●● |

### The Memory Wall

The single biggest architectural inflection point is between Level 2 and Level 3. Below Level 3, everything can plausibly fit in a context window (perhaps a very large one). At Level 3 and above, **no context window will ever be large enough** — the system must have explicit memory management with retrieval, summarization, forgetting, and consolidation. This is analogous to the shift from registers to RAM to disk in computer architecture — each tier trades latency for capacity and requires an explicit management policy.

### The Evaluation Wall

The second major inflection is between Level 3 and Level 4. Below Level 4, there is a definable "done" state, even if it's hard to reach. At Level 4, **evaluation itself is continuous, contested, and evolving**. The system must reason about whether its own evaluation criteria are still correct — a level of meta-cognition that no current system reliably achieves.

### Confidence Gradient

| Level | Architectural Confidence | Evidence Base |
|-------|------------------------|---------------|
| 0 | Very High | Millions of production deployments |
| 1 | High | Established patterns (ReAct, tool-use agents) in production |
| 2 | Moderate | Some "deep research" products approach this; true adversarial validation patterns are emerging but not standardized |
| 3 | Low-Moderate | Pioneering systems (Devin, Claude Code, SWE-bench work); lots of active research |
| 4 | Speculative | Theoretical frameworks; no validated autonomous systems at this level; closest analogues are human organizations |

---

## A Note on the Boundary Between Levels

These levels are not strictly discrete — they form a spectrum. A given task might straddle two levels (e.g., a research task that also requires building a small tool to process data is Level 1–3 hybrid). The framework is most useful for identifying **which subsystems you need to invest in** based on the kinds of problems you're trying to solve.

The most common mistake in building agentic systems is **under-investing in the subsystems required by your actual problem level** — trying to solve a Level 3 problem with a Level 1 architecture, relying on a big context window instead of building proper memory management, or skipping the evaluation and governance infrastructure that Level 2+ demands.
