# Agent Memory Research & Design for OllieBot

## Executive Summary

This document presents comprehensive research on agent memory systems from industry leaders (ChatGPT, Gemini, Claude) and academic literature, followed by a detailed design proposal for enhancing OllieBot's memory capabilities. The goal is to create a sophisticated memory system that goes beyond simple key-value storage to support memory accumulation, reorganization, prioritization, and attenuation.

---

## Part 1: Industry Analysis

### 1.1 ChatGPT Memory System (OpenAI)

**Architecture:** Two-tier memory system
- **Saved Memories**: Explicit facts the model is instructed to remember
- **Chat History Reference**: Implicit learning from conversation patterns

**Key Features (as of April 2025):**
- Memories stored via `bio` tool in Model Set Context section
- Timestamps attached to memories for temporal awareness
- User can view, edit, and delete memories through UI
- Incognito/Temporary Chat mode bypasses memory
- Sensitive information (health details) not proactively remembered

**Technical Details:**
- Memories injected into system prompt
- Memory retrieval appears to use semantic similarity + recency
- Memories evolve independently of conversations (deleting chat doesn't delete memory)
- Available to Plus, Pro, Team, Enterprise users

**Sources:**
- [OpenAI Memory Announcement](https://openai.com/index/memory-and-new-controls-for-chatgpt/)
- [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)

---

### 1.2 Google Gemini Memory System

**Architecture:** Schema-based hierarchical memory with Personal Intelligence

**Key Features (as of January 2026):**
- **Automatic Memory Learning**: No longer requires explicit "remember this"
- **Personal Intelligence**: Deep integration with Google ecosystem (Gmail, Photos, YouTube, Search)
- **1M token context window** with Gemini 3

**Memory Schema Structure:**
```
- Demographic information (name, age, location, education, work)
- Interests and preferences
- Relationships
- Dated events, projects, and plans (with timestamps)
```

**Architecture Pattern:**
- Compressed long-term memory (user_context - LLM-generated profile)
- Raw working memory (recent conversation turns)
- Periodic refresh of user profile from conversation history

**Privacy Controls:**
- App connections strictly opt-in
- Granular control over data sources
- Temporary chats (auto-deleted after 72 hours)
- Data referenced for replies but not used for training

**Sources:**
- [Google Personal Intelligence](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/)
- [Gemini Memory Upgrade](https://www.androidauthority.com/google-gemini-personal-intelligence-rollout-3632287/)

---

### 1.3 Claude Memory System (Anthropic)

**Architecture:** File-based transparent memory system

**Key Features (October 2025):**
- **CLAUDE.md Files**: Markdown-based memory storage
- **Project Isolation**: Separate memories for separate projects
- **Portability**: Can export and import to other AI systems
- **Transparency**: Users can view exact memory content

**Memory Hierarchy:**
- User-level memories (personal preferences)
- Project-level memories (project-specific context)
- Automatic memory extraction (proactive learning)

**Technical Approach:**
- Chose simplicity over complexity (no vector databases)
- Hierarchical file structure
- Human-readable format (markdown)

**Privacy Features:**
- Incognito chat mode (no memory, no history)
- Available to all users including free tier

**Sources:**
- [Anthropic Memory Announcement](https://www.anthropic.com/news/memory)
- [Claude Memory Deep Dive](https://siliconangle.com/2025/09/11/anthropic-lets-claude-remember-previous-interactions-streamline-work/)

---

## Part 2: Academic Research Analysis

### 2.1 Generative Agents: Interactive Simulacra of Human Behavior (Stanford, 2023)

**Citation:** Park, J.S., O'Brien, J.C., Cai, C.J., Morris, M.R., Liang, P., & Bernstein, M.S. (2023). UIST '23.

**Architecture Components:**

#### Memory Stream
- Complete record of agent's experiences in natural language
- Each memory object contains: description, creation timestamp, last access timestamp

#### Retrieval Function
Three-factor scoring system:
```
Score = α₁ × Recency + α₂ × Importance + α₃ × Relevance

- Recency: Exponential decay based on time since last access
- Importance: LLM-assigned score (1-10) based on significance
- Relevance: Cosine similarity to current query
```

#### Reflection Mechanism
- Triggered when sum of importance scores exceeds threshold
- LLM generates higher-level insights from recent memories
- Creates abstract "reflection" memories that link to source memories
- Example: "Klaus Mueller is deeply committed to his research" (synthesized from multiple observations)

#### Planning System
- Generates daily plans at start of each day
- Plans recursively decomposed into finer-grained actions
- Plans can be revised based on new observations

**Key Findings:**
- Reflection is critical for believable behavior
- Ablation studies showed each component (observation, planning, reflection) contributes significantly
- Agents exhibited emergent social behaviors (party planning, relationship formation)

**arxiv:** [2304.03442](https://arxiv.org/abs/2304.03442)

---

### 2.2 MemGPT: Towards LLMs as Operating Systems (UC Berkeley, 2023)

**Citation:** Packer, C., Wooders, S., Lin, K., Fang, V., Patil, S.G., & Gonzalez, J.E. (2023).

**Core Insight:** Treat LLM context management like virtual memory in operating systems

**Memory Hierarchy:**

```
┌─────────────────────────────────────┐
│        Main Context (Fast)          │
│  ┌─────────────┬─────────────────┐  │
│  │   System    │   Core Memory   │  │
│  │   Prompt    │  (Persona/User) │  │
│  ├─────────────┴─────────────────┤  │
│  │      Working Memory           │  │
│  │   (Recent Messages, FIFO)     │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
              ↕ Page In/Out
┌─────────────────────────────────────┐
│      Archival Memory (Slow)         │
│   - Vector database backed          │
│   - Unlimited capacity              │
│   - Semantic search retrieval       │
└─────────────────────────────────────┘
```

**Memory Management Functions:**
- `core_memory_append(field, content)` - Add to core memory
- `core_memory_replace(field, old, new)` - Update core memory
- `archival_memory_insert(content)` - Store in archival
- `archival_memory_search(query)` - Retrieve from archival
- `conversation_search(query)` - Search past conversations

**Self-Editing Memory:**
- LLM can modify its own persona and user information
- Changes persist across conversations
- Enables dynamic personality evolution

**Interrupt System:**
- Agent can yield control back to user
- Enables multi-step reasoning within single context window

**arxiv:** [2310.08560](https://arxiv.org/abs/2310.08560)

---

### 2.3 A-MEM: Agentic Memory for LLM Agents (2025, NeurIPS)

**Citation:** Xu, Y., Liang, W., et al. (2025). arXiv:2502.12110

**Core Innovation:** Zettelkasten-inspired dynamic memory organization

**Architecture:**

```
┌──────────────────────────────────────┐
│         Memory Note Structure        │
├──────────────────────────────────────┤
│  • Content: Original information     │
│  • Context: Situational description  │
│  • Keywords: Extracted key terms     │
│  • Tags: Categorical labels          │
│  • Links: Connections to other notes │
│  • Timestamp: Creation/update time   │
└──────────────────────────────────────┘
          ↓ Interconnected
┌──────────────────────────────────────┐
│     Knowledge Network (Graph)        │
│  Notes linked by semantic relations  │
│  Dynamic indexing and linking        │
└──────────────────────────────────────┘
```

**Zettelkasten Method Applied:**
1. **Atomic Notes**: Each memory captures one concept
2. **Bidirectional Links**: Notes reference each other
3. **Emergent Structure**: Organization emerges from connections
4. **Index System**: Keywords and tags enable efficient retrieval

**Dynamic Operations:**
- Auto-generates contextual descriptions
- Extracts and assigns keywords
- Discovers and creates links to related memories
- Reorganizes network based on new information

**Performance:**
- 2x+ improvement over MemGPT in multi-hop reasoning tasks
- Better at complex reasoning chains requiring memory traversal

**arxiv:** [2502.12110](https://arxiv.org/abs/2502.12110)

---

### 2.4 Mem0: Building Production-Ready AI Agents (2025)

**Citation:** Chhikara, P., Khant, P., et al. (2025). arXiv:2504.19413

**Two-Phase Architecture:**

#### Phase 1: Memory Extraction
```
Input Sources:
  - Latest exchange
  - Rolling summary
  - Recent messages (window)
           ↓
    LLM Extraction
           ↓
  Candidate Memories
```

#### Phase 2: Memory Update
```
Candidate Memories + Existing Memories
           ↓
    Conflict Detection
           ↓
    Update Resolution
    (ADD | MERGE | DELETE | SKIP)
           ↓
    Persisted Memory Store
```

**Graph Memory (Mem0ᵍ) Extension:**

```
Messages → Entity Extractor → Nodes (entities)
        → Relations Generator → Edges (relationships)
                    ↓
           Graph Database
         (Neo4j, Neptune, etc.)
```

**Memory Operations:**
- **ADD**: New unique memory
- **MERGE**: Combine with existing memory
- **DELETE**: Remove obsolete memory
- **SKIP**: Memory already exists

**Performance Results:**
- 26% accuracy improvement over baselines
- 91% lower latency than full-context approaches
- 90% token savings

**arxiv:** [2504.19413](https://arxiv.org/abs/2504.19413)

---

### 2.5 Additional Notable Research

#### H-MEM: Hierarchical Memory (2025)
Four-layer memory architecture:
1. **Domain Layer**: Highest abstraction (e.g., "Work", "Personal")
2. **Category Layer**: Topic clusters within domains
3. **Memory Trace Layer**: Individual memory instances
4. **Episode Layer**: Specific interaction contexts

#### ACT-R Inspired Memory (2024)
- Trigger word assignment for memory reactivation
- Ebbinghaus forgetting curve simulation
- Dynamic retrieval priority based on:
  - Lifespan (time since creation)
  - Access frequency
  - Recency of last access

#### MemoryBank (2024)
Exponential decay model:
```
Memory_Strength(t) = Initial_Strength × e^(-λt)
where λ = decay constant
```

---

## Part 3: Memory Lifecycle Framework

Based on survey research, agent memory operates through three phases:

### 3.1 Formation (Extraction)

**Methods:**
- **Explicit**: User instructs agent to remember
- **Implicit**: Agent detects important information
- **Derived**: Synthesized from multiple observations (reflection)

**Extraction Criteria:**
- Importance score (LLM-judged significance)
- Novelty (does this add new information?)
- User preference signals
- Task relevance

### 3.2 Evolution (Consolidation & Attenuation)

**Consolidation:**
- Merge similar memories
- Create abstractions from concrete instances
- Link related memories
- Update existing memories with new information

**Attenuation/Forgetting:**
- Time-based decay (Ebbinghaus curve)
- Access frequency weighting
- Importance threshold pruning
- Contradiction resolution (newer replaces older)

### 3.3 Retrieval

**Retrieval Signals:**
- Semantic similarity (embedding cosine distance)
- Recency (when was it last accessed?)
- Importance (how significant is it?)
- Relevance (how related to current query?)

**Retrieval Strategies:**
- Top-K nearest neighbors
- Hierarchical search (coarse to fine)
- Graph traversal (follow links)
- Hybrid (combine multiple signals)

---

## Part 4: OllieBot Memory System Design

### 4.1 Current State Analysis

**Existing Components:**
- `memory.md`: User-managed notes (human-readable)
- `memory.json`: Agent-managed memories (structured)
- `remember` tool: Single operation for adding memories
- Categories/tags for organization

**Limitations:**
1. No memory evolution (memories never change after creation)
2. No automatic extraction (requires explicit tool call)
3. No memory consolidation (duplicates can accumulate)
4. No forgetting/attenuation (memory grows unbounded)
5. No reflection (no synthesis of higher-level insights)
6. No relationship tracking (isolated memory entries)
7. Limited retrieval (all memories loaded into context)

### 4.2 Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OllieBot Memory System v2                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Memory Stores                         │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │    │
│  │  │ memory.md   │  │ memory.json │  │ memory-graph.json│  │    │
│  │  │ (User)      │  │ (Facts)     │  │ (Relations)     │  │    │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↑↓                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Memory Service                        │    │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐  │    │
│  │  │ Formation │ │ Evolution │ │ Retrieval │ │ Reflect │  │    │
│  │  └───────────┘ └───────────┘ └───────────┘ └─────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↑↓                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Memory Evolution Worker                     │    │
│  │       (Background process for maintenance)               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              ↑↓                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Agent Tools                           │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────┐ ┌──────┐  │    │
│  │  │remember│ │ forget │ │ recall │ │ reflect │ │ link │  │    │
│  │  └────────┘ └────────┘ └────────┘ └─────────┘ └──────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 Enhanced Memory Schema

#### memory.json (Enhanced)
```typescript
interface MemoryEntry {
  id: string;                    // Unique identifier
  c: string;                     // Content
  t?: string;                    // Tag/category
  importance: number;            // 1-10 scale (LLM-assigned)
  created: number;               // Timestamp
  lastAccessed: number;          // For recency tracking
  accessCount: number;           // For frequency tracking
  source: 'explicit' | 'implicit' | 'reflection';
  confidence: number;            // 0-1 certainty level
  supersedes?: string[];         // IDs of memories this replaces
  keywords: string[];            // Extracted keywords for search
}

interface AgentMemory {
  v: 2;                          // Schema version
  e: MemoryEntry[];              // Entries
  reflections: ReflectionEntry[];// Higher-level insights
  lastEvolution: number;         // Last maintenance run
}

interface ReflectionEntry {
  id: string;
  insight: string;               // The synthesized insight
  sourceMemories: string[];      // IDs of contributing memories
  created: number;
  importance: number;
}
```

#### memory-graph.json (New)
```typescript
interface MemoryGraph {
  v: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface GraphNode {
  id: string;
  type: 'person' | 'project' | 'concept' | 'preference' | 'event';
  label: string;
  memoryIds: string[];           // References to memory entries
}

interface GraphEdge {
  source: string;                // Node ID
  target: string;                // Node ID
  relationship: string;          // e.g., "works_on", "prefers", "knows"
  weight: number;                // Strength of relationship
}
```

### 4.4 Enhanced Agent Tools

#### 1. remember (Enhanced)
```typescript
interface RememberInput {
  content: string;
  category?: string;
  importance?: number;           // Optional override
  relatedTo?: string[];          // Link to existing memory IDs
}

// Behavior:
// 1. Check for existing similar memories (conflict detection)
// 2. If similar exists: MERGE (update existing) or SUPERSEDE (mark old as replaced)
// 3. If new: ADD with auto-extracted keywords
// 4. Auto-link to related memories based on semantic similarity
```

#### 2. forget (New)
```typescript
interface ForgetInput {
  memoryId?: string;             // Specific memory to forget
  query?: string;                // Semantic search to find memories to forget
  reason?: string;               // Why forgetting (for audit)
}

// Behavior:
// - Soft delete (mark as forgotten, keep for audit)
// - Update graph relationships
// - Can be undone within retention period
```

#### 3. recall (New)
```typescript
interface RecallInput {
  query: string;
  limit?: number;                // Max memories to return
  includeReflections?: boolean;  // Include synthesized insights
  timeRange?: {                  // Filter by time
    start?: number;
    end?: number;
  };
  categories?: string[];         // Filter by category
}

// Behavior:
// - Semantic search across memories
// - Score by: relevance × recency × importance × frequency
// - Update lastAccessed for retrieved memories
// - Return formatted memory context
```

#### 4. reflect (New)
```typescript
interface ReflectInput {
  topic?: string;                // Focus area for reflection
  depth?: 'shallow' | 'deep';    // How much to synthesize
}

// Behavior:
// - Gather related memories on topic
// - Generate higher-level insight using LLM
// - Store as ReflectionEntry
// - Link to source memories
// - Example: From "User likes Python" + "User dislikes Java" + "User uses VS Code"
//   → "User prefers Python development with VS Code as their IDE"
```

#### 5. link (New)
```typescript
interface LinkInput {
  memoryId: string;
  relatedMemoryId: string;
  relationship: string;
}

// Behavior:
// - Create bidirectional link between memories
// - Update knowledge graph
// - Enable graph-based retrieval
```

### 4.5 Memory Evolution Worker

A background process that runs periodically (e.g., end of session, daily) to maintain memory health:

```typescript
interface MemoryEvolutionWorker {
  // Scheduled tasks
  tasks: {
    consolidation: {
      // Merge similar memories
      // Identify and combine duplicates
      // Resolve contradictions
      interval: 'session_end';
    };

    attenuation: {
      // Apply decay function to memory importance
      // Formula: importance = base_importance × e^(-λ × days_since_access)
      // λ = 0.1 (configurable decay rate)
      // Memories below threshold moved to "archive"
      interval: 'daily';
    };

    reflection: {
      // Generate reflections when:
      // - Sum of new memory importance > threshold
      // - Significant new information in category
      // - User explicitly requests
      interval: 'session_end';
    };

    graphMaintenance: {
      // Discover new entity relationships
      // Prune weak connections
      // Update relationship weights
      interval: 'weekly';
    };

    cleanup: {
      // Archive very old, low-importance memories
      // Compress archived memories
      // Remove soft-deleted memories past retention
      interval: 'weekly';
    };
  };
}
```

### 4.6 Memory Retrieval Algorithm

```typescript
function retrieveMemories(query: string, options: RetrievalOptions): Memory[] {
  const candidates = getAllMemories();

  // Score each memory
  const scored = candidates.map(memory => {
    const relevance = cosineSimilarity(embed(query), embed(memory.content));
    const recency = exponentialDecay(memory.lastAccessed, DECAY_RATE);
    const importance = memory.importance / 10;
    const frequency = Math.log(memory.accessCount + 1) / Math.log(MAX_ACCESS);

    // Weighted combination
    const score =
      WEIGHT_RELEVANCE * relevance +
      WEIGHT_RECENCY * recency +
      WEIGHT_IMPORTANCE * importance +
      WEIGHT_FREQUENCY * frequency;

    return { memory, score };
  });

  // Sort and filter
  const topK = scored
    .filter(s => s.score > THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit || 10);

  // Graph expansion: include related memories
  if (options.expandGraph) {
    const expanded = expandViaGraph(topK.map(s => s.memory));
    return deduplicate([...topK.map(s => s.memory), ...expanded]);
  }

  return topK.map(s => s.memory);
}

// Configuration
const WEIGHTS = {
  RELEVANCE: 0.4,
  RECENCY: 0.2,
  IMPORTANCE: 0.3,
  FREQUENCY: 0.1
};
```

### 4.7 Automatic Memory Extraction

Run after each conversation turn to detect memorable information:

```typescript
interface AutoExtractionConfig {
  enabled: boolean;
  extractionPrompt: string;
  importanceThreshold: number;  // Only extract if importance >= threshold
  categories: {
    preference: string[];       // Signal words for preferences
    fact: string[];             // Signal words for facts
    decision: string[];         // Signal words for decisions
    relationship: string[];     // Signal words for people/relationships
  };
}

async function autoExtract(conversation: Message[]): Promise<MemoryCandidate[]> {
  const prompt = `
    Analyze this conversation turn and extract information worth remembering.
    Focus on:
    - User preferences and opinions
    - Important facts about user, projects, or context
    - Decisions made
    - New information about people or relationships

    For each piece of information, provide:
    - content: The fact to remember
    - category: One of [preference, fact, decision, relationship, project]
    - importance: 1-10 score
    - confidence: 0-1 how certain you are this is accurate

    Only extract information with importance >= 5.
    Return empty array if nothing significant to remember.
  `;

  const response = await llm.generate(prompt, conversation);
  return parseMemoryCandidates(response);
}
```

### 4.8 Implementation Phases

#### Phase 1: Enhanced Core (Week 1-2)
- Upgrade memory schema with new fields
- Implement enhanced `remember` tool with conflict detection
- Add `forget` and `recall` tools
- Update memory service for new schema

#### Phase 2: Memory Evolution (Week 3-4)
- Implement attenuation algorithm
- Build consolidation logic
- Create memory evolution worker
- Add scheduling system

#### Phase 3: Knowledge Graph (Week 5-6)
- Implement graph schema
- Add entity extraction
- Build relationship detection
- Create `link` tool
- Integrate graph into retrieval

#### Phase 4: Reflection System (Week 7-8)
- Implement `reflect` tool
- Build reflection triggers
- Integrate reflections into retrieval
- Test synthesis quality

#### Phase 5: Auto-Extraction (Week 9-10)
- Build extraction pipeline
- Tune extraction prompts
- Add importance scoring
- Test and refine

### 4.9 Configuration Options

```typescript
interface MemoryConfig {
  // Feature toggles
  features: {
    autoExtraction: boolean;      // Auto-detect memories from conversation
    attenuation: boolean;         // Apply decay to memories
    consolidation: boolean;       // Merge similar memories
    reflection: boolean;          // Generate insights
    graphMemory: boolean;         // Maintain relationship graph
  };

  // Thresholds
  thresholds: {
    importanceMinimum: number;    // Minimum importance to store (default: 3)
    extractionConfidence: number; // Minimum confidence for auto-extract (default: 0.7)
    reflectionTrigger: number;    // Sum of importance to trigger reflection (default: 30)
    attenuationFloor: number;     // Minimum importance after decay (default: 1)
    archiveAge: number;           // Days before archiving (default: 90)
  };

  // Weights for retrieval scoring
  retrievalWeights: {
    relevance: number;
    recency: number;
    importance: number;
    frequency: number;
  };

  // Decay configuration
  decay: {
    rate: number;                 // Lambda in exponential decay (default: 0.1)
    recencyHalfLife: number;      // Days for recency to halve (default: 7)
  };

  // Limits
  limits: {
    maxMemories: number;          // Maximum active memories (default: 1000)
    maxReflections: number;       // Maximum reflections (default: 100)
    maxGraphNodes: number;        // Maximum graph nodes (default: 500)
    archiveRetention: number;     // Days to keep archived (default: 365)
  };
}
```

---

## Part 5: Comparison with Industry Solutions

| Feature | ChatGPT | Gemini | Claude | OllieBot v2 |
|---------|---------|--------|--------|-------------|
| Saved Memories | ✅ | ✅ | ✅ | ✅ |
| Chat History Reference | ✅ | ✅ | ❌ | Planned |
| Auto-Extraction | ✅ | ✅ | ✅ | ✅ |
| Memory Decay | ? | ? | ❌ | ✅ |
| Reflection/Synthesis | ❌ | ❌ | ❌ | ✅ |
| Knowledge Graph | ❌ | ✅ | ❌ | ✅ |
| User Transparency | Limited | Limited | ✅ | ✅ |
| Memory Portability | ❌ | ❌ | ✅ | ✅ |
| Project Isolation | ❌ | ❌ | ✅ | Planned |
| Conflict Resolution | ? | ? | ? | ✅ |
| Importance Scoring | ? | ? | ❌ | ✅ |
| Semantic Retrieval | ✅ | ✅ | ? | ✅ |

---

## Part 6: Key Insights & Recommendations

### 6.1 From Industry Analysis

1. **Two-tier approach works**: All major providers separate explicit memories from implicit learning
2. **User control is essential**: All provide ways to view, edit, delete memories
3. **Privacy modes matter**: Incognito/temporary chat is a standard feature
4. **Transparency builds trust**: Claude's file-based approach is most transparent

### 6.2 From Academic Research

1. **Reflection is powerful**: Stanford's work shows synthesis dramatically improves behavior
2. **OS metaphor is useful**: MemGPT's hierarchical approach enables unbounded memory
3. **Zettelkasten works**: A-MEM's interconnected notes outperform simple storage
4. **Forgetting is necessary**: Memory systems need decay to remain useful
5. **Graph structure helps**: Relationships between memories enable complex reasoning

### 6.3 Design Principles for OllieBot

1. **Progressive Enhancement**: Each feature should be independently toggleable
2. **Transparency First**: All memory operations should be auditable
3. **User Control**: Users should be able to override any automatic behavior
4. **Graceful Degradation**: System should work even if advanced features fail
5. **Token Efficiency**: Memory should be compressed for context window efficiency
6. **Semantic Richness**: Leverage embeddings for intelligent retrieval
7. **Temporal Awareness**: Track when memories were formed and accessed
8. **Relationship Modeling**: Understand connections between pieces of information

---

## References

### Industry Sources
- [OpenAI Memory Announcement](https://openai.com/index/memory-and-new-controls-for-chatgpt/)
- [OpenAI Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
- [Google Personal Intelligence](https://blog.google/innovation-and-ai/products/gemini-app/personal-intelligence/)
- [Anthropic Memory Announcement](https://www.anthropic.com/news/memory)
- [Simon Willison on ChatGPT Memory](https://simonwillison.net/2025/May/21/chatgpt-new-memory/)

### Academic Papers
1. Park, J.S. et al. (2023). "Generative Agents: Interactive Simulacra of Human Behavior" - [arXiv:2304.03442](https://arxiv.org/abs/2304.03442)
2. Packer, C. et al. (2023). "MemGPT: Towards LLMs as Operating Systems" - [arXiv:2310.08560](https://arxiv.org/abs/2310.08560)
3. Xu, Y. et al. (2025). "A-MEM: Agentic Memory for LLM Agents" - [arXiv:2502.12110](https://arxiv.org/abs/2502.12110)
4. Chhikara, P. et al. (2025). "Mem0: Building Production-Ready AI Agents" - [arXiv:2504.19413](https://arxiv.org/abs/2504.19413)

### Surveys
- "A Survey on the Memory Mechanism of Large Language Model-based Agents" - ACM TOIS
- "Memory in the Age of AI Agents: A Survey" - [arXiv:2512.13564](https://arxiv.org/abs/2512.13564)
- [Agent Memory Paper List (GitHub)](https://github.com/Shichun-Liu/Agent-Memory-Paper-List)

---

*Document created: 2026-02-03*
*Author: OllieBot Development Team*
