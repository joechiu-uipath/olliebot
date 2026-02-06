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

## Part 7: Conversation Search System Design

This section details the design for a `conversation_search` tool, inspired by MemGPT's archival memory search, that enables semantic search across past conversations. The system reuses OllieBot's existing RAG infrastructure (LanceDB + embedding providers).

### 7.1 Overview & Motivation

**Problem**: Agents have no way to search past conversations. When context windows fill up or conversations are archived, valuable context is lost. Users may reference past discussions that the agent cannot recall.

**Solution**: Index conversation messages in a vector database, enabling semantic search across chat history. This complements the memory system (which stores facts) by providing access to the raw conversation context.

**Key Distinction:**
| Memory System | Conversation Search |
|---------------|---------------------|
| Stores extracted facts | Stores raw messages |
| Compact, curated | Complete history |
| Always in context | Retrieved on-demand |
| Agent-curated | Automatic indexing |

### 7.2 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Conversation Search System                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────┐         ┌─────────────────────────────────┐     │
│  │  Chat Messages │────────→│   Conversation Indexer Service   │     │
│  │  (AlaSQL DB)   │         │   - Message batching             │     │
│  └────────────────┘         │   - Chunking strategy            │     │
│         ↑                   │   - Embedding generation         │     │
│         │                   └─────────────────────────────────┘     │
│         │ sync                              │                        │
│         │                                   ↓                        │
│  ┌────────────────┐         ┌─────────────────────────────────┐     │
│  │  Sync Manager  │←────────│      LanceDB Vector Store        │     │
│  │  - Deletions   │         │   Table: "conversation_vectors"  │     │
│  │  - Updates     │         │   - Reuses RAG embedding provider│     │
│  │  - Consistency │         └─────────────────────────────────┘     │
│  └────────────────┘                         ↑                        │
│                                             │ search                 │
│                             ┌─────────────────────────────────┐     │
│                             │   conversation_search Tool       │     │
│                             │   - Semantic query              │     │
│                             │   - Filters (time, conversation)│     │
│                             │   - Result formatting           │     │
│                             └─────────────────────────────────┘     │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.3 Vector Schema

Reusing LanceDB infrastructure, create a dedicated table for conversation vectors:

```typescript
// Location: src/conversation-search/types.ts

interface ConversationVector {
  // Primary identifier
  id: string;                      // Format: "{conversationId}:{messageId}:{chunkIndex}"

  // Source references
  conversationId: string;          // FK to conversations table
  messageId: string;               // FK to messages table
  chunkIndex: number;              // Position within message (for long messages)

  // Content
  text: string;                    // Actual chunk content
  vector: number[];                // Embedding vector (dimension matches provider)

  // Metadata for filtering & ranking
  role: 'user' | 'assistant' | 'system' | 'tool';
  channel: string;                 // 'web', 'console', 'teams'
  createdAt: string;               // ISO timestamp from message
  conversationTitle: string;       // For context in results

  // Sync tracking
  indexedAt: string;               // When this was indexed
  messageHash: string;             // Hash of content for change detection
}

interface ConversationSearchIndex {
  // Metadata about the index
  version: number;
  lastSyncAt: string;              // Last full sync timestamp
  totalVectors: number;
  embeddingProvider: string;       // Provider used (for re-index detection)
  embeddingDimensions: number;
}
```

### 7.4 Indexing Strategy

#### 7.4.1 Message Chunking

Unlike documents, messages are typically shorter. The chunking strategy differs:

```typescript
interface ConversationChunkingConfig {
  // Chunk settings
  maxChunkSize: number;            // 500 chars (smaller than RAG's 1000)
  chunkOverlap: number;            // 50 chars

  // Message handling
  combineShortMessages: boolean;   // Combine adjacent short messages
  shortMessageThreshold: number;   // Messages under this are combined (100 chars)
  maxCombinedMessages: number;     // Max messages to combine (5)

  // Role handling
  includeRoles: ('user' | 'assistant' | 'system' | 'tool')[];
  excludeToolResults: boolean;     // Tool outputs can be verbose

  // Context enrichment
  includeConversationTitle: boolean;
  includeTimestamp: boolean;
  includePrecedingContext: boolean; // Add previous message for context
}

// Default configuration
const DEFAULT_CONFIG: ConversationChunkingConfig = {
  maxChunkSize: 500,
  chunkOverlap: 50,
  combineShortMessages: true,
  shortMessageThreshold: 100,
  maxCombinedMessages: 5,
  includeRoles: ['user', 'assistant'],
  excludeToolResults: true,
  includeConversationTitle: true,
  includeTimestamp: true,
  includePrecedingContext: true
};
```

#### 7.4.2 Indexing Pipeline

```typescript
// Location: src/conversation-search/indexer.ts

class ConversationIndexer {
  private lanceStore: LanceStore;
  private embeddingProvider: EmbeddingProvider;
  private db: Database;  // AlaSQL reference

  /**
   * Index a single message (called on new messages)
   */
  async indexMessage(message: Message, conversation: Conversation): Promise<void> {
    // Skip if role excluded
    if (!this.config.includeRoles.includes(message.role)) return;

    // Skip tool results if configured
    if (this.config.excludeToolResults && message.role === 'tool') return;

    // Get preceding message for context
    const precedingMessage = this.config.includePrecedingContext
      ? await this.db.getMessageBefore(message.conversationId, message.createdAt)
      : null;

    // Chunk the message
    const chunks = this.chunkMessage(message, precedingMessage, conversation);

    // Generate embeddings
    const embeddings = await this.embeddingProvider.embedBatch(
      chunks.map(c => c.text)
    );

    // Create vectors
    const vectors: ConversationVector[] = chunks.map((chunk, i) => ({
      id: `${conversation.id}:${message.id}:${i}`,
      conversationId: conversation.id,
      messageId: message.id,
      chunkIndex: i,
      text: chunk.text,
      vector: embeddings[i],
      role: message.role,
      channel: message.channel,
      createdAt: message.createdAt,
      conversationTitle: conversation.title,
      indexedAt: new Date().toISOString(),
      messageHash: this.hashContent(message.content)
    }));

    // Upsert to LanceDB
    await this.lanceStore.upsert('conversation_vectors', vectors);
  }

  /**
   * Batch index all unindexed messages
   */
  async indexPendingMessages(): Promise<IndexingResult> {
    const lastSync = await this.getLastSyncTimestamp();

    // Get messages created after last sync
    const pendingMessages = await this.db.query(`
      SELECT m.*, c.title as conversationTitle
      FROM messages m
      JOIN conversations c ON m.conversationId = c.id
      WHERE m.createdAt > ?
        AND c.deletedAt IS NULL
      ORDER BY m.createdAt ASC
    `, [lastSync]);

    let indexed = 0;
    let skipped = 0;

    // Process in batches for efficiency
    const batches = this.batchMessages(pendingMessages, 50);

    for (const batch of batches) {
      const chunks: ConversationVector[] = [];

      for (const msg of batch) {
        const messageChunks = await this.prepareMessageChunks(msg);
        chunks.push(...messageChunks);
      }

      if (chunks.length > 0) {
        const embeddings = await this.embeddingProvider.embedBatch(
          chunks.map(c => c.text)
        );

        chunks.forEach((chunk, i) => {
          chunk.vector = embeddings[i];
        });

        await this.lanceStore.upsert('conversation_vectors', chunks);
        indexed += batch.length;
      }
    }

    await this.updateLastSyncTimestamp();

    return { indexed, skipped, total: pendingMessages.length };
  }

  /**
   * Chunk a message with context
   */
  private chunkMessage(
    message: Message,
    precedingMessage: Message | null,
    conversation: Conversation
  ): ChunkResult[] {
    const chunks: ChunkResult[] = [];
    let content = message.content;

    // Add context prefix
    let prefix = '';
    if (this.config.includeConversationTitle) {
      prefix += `[Conversation: ${conversation.title}] `;
    }
    if (this.config.includeTimestamp) {
      prefix += `[${new Date(message.createdAt).toLocaleDateString()}] `;
    }
    prefix += `[${message.role}]: `;

    // Add preceding context for better semantic understanding
    if (precedingMessage && this.config.includePrecedingContext) {
      const precedingSnippet = precedingMessage.content.slice(0, 100);
      prefix = `Context: "${precedingSnippet}..." → ${prefix}`;
    }

    content = prefix + content;

    // Chunk if too long
    if (content.length <= this.config.maxChunkSize) {
      chunks.push({ text: content, index: 0 });
    } else {
      // Sliding window chunking
      let start = 0;
      let index = 0;
      while (start < content.length) {
        const end = Math.min(start + this.config.maxChunkSize, content.length);
        chunks.push({
          text: content.slice(start, end),
          index: index++
        });
        start = end - this.config.chunkOverlap;
      }
    }

    return chunks;
  }
}
```

### 7.5 The `conversation_search` Tool

```typescript
// Location: src/tools/native/conversation-search.ts

import { NativeTool, ToolInput, ToolResult } from '../types';
import { ConversationSearchService } from '../../conversation-search/service';

export class ConversationSearchTool implements NativeTool {
  name = 'conversation_search';

  description = `Search through past conversation history using semantic search.
Use this tool to:
- Find previous discussions on a topic
- Recall what the user said about something
- Look up decisions or conclusions from past conversations
- Find context from earlier in a long conversation

Returns relevant message snippets with conversation context.`;

  inputSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Natural language search query describing what you want to find'
      },
      limit: {
        type: 'number',
        description: 'Maximum results to return (default: 5, max: 20)',
        default: 5
      },
      conversationId: {
        type: 'string',
        description: 'Optional: limit search to a specific conversation'
      },
      timeRange: {
        type: 'object',
        description: 'Optional: filter by time range',
        properties: {
          start: { type: 'string', description: 'ISO date string' },
          end: { type: 'string', description: 'ISO date string' }
        }
      },
      roles: {
        type: 'array',
        items: { type: 'string', enum: ['user', 'assistant'] },
        description: 'Optional: filter by message role (default: both)'
      },
      minScore: {
        type: 'number',
        description: 'Minimum similarity score 0-1 (default: 0.5)',
        default: 0.5
      }
    },
    required: ['query']
  };

  constructor(private searchService: ConversationSearchService) {}

  async execute(input: ConversationSearchInput): Promise<ToolResult> {
    // Validate input
    if (!input.query || input.query.trim().length === 0) {
      return {
        success: false,
        error: 'Query is required'
      };
    }

    const limit = Math.min(input.limit || 5, 20);
    const minScore = input.minScore ?? 0.5;

    // Perform search
    const results = await this.searchService.search({
      query: input.query,
      limit,
      minScore,
      filters: {
        conversationId: input.conversationId,
        timeRange: input.timeRange,
        roles: input.roles || ['user', 'assistant']
      }
    });

    if (results.length === 0) {
      return {
        success: true,
        data: {
          message: 'No relevant conversations found for this query.',
          results: []
        }
      };
    }

    // Format results for agent consumption
    const formatted = results.map((r, i) => ({
      rank: i + 1,
      score: r.score.toFixed(3),
      conversation: r.conversationTitle,
      date: new Date(r.createdAt).toLocaleDateString(),
      role: r.role,
      content: r.text,
      conversationId: r.conversationId,
      messageId: r.messageId
    }));

    return {
      success: true,
      data: {
        query: input.query,
        totalResults: results.length,
        results: formatted
      }
    };
  }
}

interface ConversationSearchInput {
  query: string;
  limit?: number;
  conversationId?: string;
  timeRange?: {
    start?: string;
    end?: string;
  };
  roles?: ('user' | 'assistant')[];
  minScore?: number;
}
```

### 7.6 Search Service Implementation

```typescript
// Location: src/conversation-search/service.ts

import { LanceStore } from '../rag-projects/lance-store';
import { EmbeddingProvider } from '../rag-projects/embedding-providers';

export class ConversationSearchService {
  private lanceStore: LanceStore;
  private embeddingProvider: EmbeddingProvider;
  private indexer: ConversationIndexer;

  constructor(
    dataDir: string,
    embeddingProvider: EmbeddingProvider
  ) {
    // Use dedicated LanceDB for conversations
    this.lanceStore = new LanceStore(
      path.join(dataDir, '.olliebot', 'conversations.lance')
    );
    this.embeddingProvider = embeddingProvider;
    this.indexer = new ConversationIndexer(
      this.lanceStore,
      embeddingProvider
    );
  }

  async init(): Promise<void> {
    await this.lanceStore.init();

    // Ensure table exists with schema
    await this.lanceStore.createTableIfNotExists('conversation_vectors', {
      id: 'string',
      conversationId: 'string',
      messageId: 'string',
      chunkIndex: 'int',
      text: 'string',
      vector: `vector[${this.embeddingProvider.dimensions}]`,
      role: 'string',
      channel: 'string',
      createdAt: 'string',
      conversationTitle: 'string',
      indexedAt: 'string',
      messageHash: 'string'
    });
  }

  /**
   * Semantic search across conversations
   */
  async search(options: SearchOptions): Promise<SearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await this.embeddingProvider.embed(options.query);

    // Build filter conditions
    const filters: FilterCondition[] = [];

    if (options.filters?.conversationId) {
      filters.push({
        field: 'conversationId',
        op: '=',
        value: options.filters.conversationId
      });
    }

    if (options.filters?.roles && options.filters.roles.length > 0) {
      filters.push({
        field: 'role',
        op: 'IN',
        value: options.filters.roles
      });
    }

    if (options.filters?.timeRange?.start) {
      filters.push({
        field: 'createdAt',
        op: '>=',
        value: options.filters.timeRange.start
      });
    }

    if (options.filters?.timeRange?.end) {
      filters.push({
        field: 'createdAt',
        op: '<=',
        value: options.filters.timeRange.end
      });
    }

    // Execute vector search
    const rawResults = await this.lanceStore.search('conversation_vectors', {
      vector: queryEmbedding,
      limit: options.limit * 2,  // Over-fetch for deduplication
      filters
    });

    // Convert L2 distance to similarity score
    const scored = rawResults.map(r => ({
      ...r,
      score: 1 / (1 + r._distance)  // Convert distance to 0-1 similarity
    }));

    // Filter by minimum score
    const filtered = scored.filter(r => r.score >= options.minScore);

    // Deduplicate by messageId (keep highest scoring chunk)
    const deduped = this.deduplicateByMessage(filtered);

    // Return top results
    return deduped.slice(0, options.limit);
  }

  /**
   * Get search service stats
   */
  async getStats(): Promise<ConversationSearchStats> {
    const vectorCount = await this.lanceStore.count('conversation_vectors');
    const indexMeta = await this.getIndexMetadata();

    return {
      totalVectors: vectorCount,
      lastSyncAt: indexMeta.lastSyncAt,
      embeddingProvider: indexMeta.embeddingProvider,
      status: 'ready'
    };
  }

  private deduplicateByMessage(results: SearchResult[]): SearchResult[] {
    const seen = new Map<string, SearchResult>();

    for (const result of results) {
      const existing = seen.get(result.messageId);
      if (!existing || result.score > existing.score) {
        seen.set(result.messageId, result);
      }
    }

    return Array.from(seen.values())
      .sort((a, b) => b.score - a.score);
  }
}
```

### 7.7 Sync Manager: Handling Deletions & Consistency

The critical challenge is keeping the vector index in sync with the source database, especially for deletions.

```typescript
// Location: src/conversation-search/sync-manager.ts

export class ConversationSyncManager {
  private lanceStore: LanceStore;
  private db: Database;
  private indexer: ConversationIndexer;

  /**
   * Sync strategies for different scenarios
   */
  readonly strategies = {
    // Real-time: Index as messages arrive
    REALTIME: 'realtime',

    // Batch: Periodic bulk sync
    BATCH: 'batch',

    // Hybrid: Real-time for new, batch for cleanup
    HYBRID: 'hybrid'
  };

  constructor(
    lanceStore: LanceStore,
    db: Database,
    indexer: ConversationIndexer
  ) {
    this.lanceStore = lanceStore;
    this.db = db;
    this.indexer = indexer;
  }

  /**
   * Handle conversation deletion
   * Called when user deletes a conversation
   */
  async onConversationDeleted(conversationId: string): Promise<void> {
    console.log(`[ConversationSync] Removing vectors for conversation: ${conversationId}`);

    // Delete all vectors for this conversation
    await this.lanceStore.delete('conversation_vectors', {
      field: 'conversationId',
      op: '=',
      value: conversationId
    });

    // Log for audit
    await this.logSyncEvent({
      type: 'conversation_deleted',
      conversationId,
      vectorsRemoved: 'all',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle message deletion
   * Called when individual messages are deleted
   */
  async onMessageDeleted(messageId: string): Promise<void> {
    console.log(`[ConversationSync] Removing vectors for message: ${messageId}`);

    await this.lanceStore.delete('conversation_vectors', {
      field: 'messageId',
      op: '=',
      value: messageId
    });
  }

  /**
   * Handle message edit
   * Re-index the edited message
   */
  async onMessageEdited(messageId: string): Promise<void> {
    // First, remove old vectors
    await this.onMessageDeleted(messageId);

    // Fetch updated message
    const message = await this.db.findMessageById(messageId);
    if (!message) return;

    const conversation = await this.db.findConversationById(message.conversationId);
    if (!conversation || conversation.deletedAt) return;

    // Re-index
    await this.indexer.indexMessage(message, conversation);
  }

  /**
   * Full consistency check
   * Run periodically (e.g., daily) to catch any sync issues
   */
  async fullConsistencyCheck(): Promise<ConsistencyReport> {
    const report: ConsistencyReport = {
      startedAt: new Date().toISOString(),
      orphanedVectors: 0,
      missingVectors: 0,
      staleVectors: 0,
      actionsRequired: []
    };

    // 1. Find orphaned vectors (conversation deleted but vectors remain)
    const deletedConversations = await this.db.query(`
      SELECT id FROM conversations WHERE deletedAt IS NOT NULL
    `);

    for (const conv of deletedConversations) {
      const orphanCount = await this.lanceStore.count('conversation_vectors', {
        field: 'conversationId',
        op: '=',
        value: conv.id
      });

      if (orphanCount > 0) {
        report.orphanedVectors += orphanCount;
        report.actionsRequired.push({
          action: 'delete_orphaned',
          conversationId: conv.id,
          count: orphanCount
        });
      }
    }

    // 2. Find missing vectors (messages exist but not indexed)
    const unindexedMessages = await this.db.query(`
      SELECT m.id, m.conversationId
      FROM messages m
      JOIN conversations c ON m.conversationId = c.id
      WHERE c.deletedAt IS NULL
        AND m.role IN ('user', 'assistant')
        AND NOT EXISTS (
          SELECT 1 FROM conversation_vector_index cvi
          WHERE cvi.messageId = m.id
        )
    `);

    report.missingVectors = unindexedMessages.length;
    if (unindexedMessages.length > 0) {
      report.actionsRequired.push({
        action: 'index_missing',
        count: unindexedMessages.length
      });
    }

    // 3. Find stale vectors (content changed since indexing)
    const staleVectors = await this.findStaleVectors();
    report.staleVectors = staleVectors.length;

    report.completedAt = new Date().toISOString();
    return report;
  }

  /**
   * Repair sync issues found in consistency check
   */
  async repairSync(report: ConsistencyReport): Promise<RepairResult> {
    const result: RepairResult = {
      orphanedDeleted: 0,
      missingIndexed: 0,
      staleReindexed: 0
    };

    for (const action of report.actionsRequired) {
      switch (action.action) {
        case 'delete_orphaned':
          await this.lanceStore.delete('conversation_vectors', {
            field: 'conversationId',
            op: '=',
            value: action.conversationId!
          });
          result.orphanedDeleted += action.count!;
          break;

        case 'index_missing':
          await this.indexer.indexPendingMessages();
          result.missingIndexed = action.count!;
          break;

        case 'reindex_stale':
          // Re-index stale messages
          for (const messageId of action.messageIds!) {
            await this.onMessageEdited(messageId);
            result.staleReindexed++;
          }
          break;
      }
    }

    return result;
  }

  /**
   * Listen for database events
   * Set up real-time sync hooks
   */
  setupEventListeners(): void {
    // Hook into database events
    this.db.on('message:created', async (message: Message) => {
      const conversation = await this.db.findConversationById(message.conversationId);
      if (conversation && !conversation.deletedAt) {
        await this.indexer.indexMessage(message, conversation);
      }
    });

    this.db.on('message:deleted', async (messageId: string) => {
      await this.onMessageDeleted(messageId);
    });

    this.db.on('message:updated', async (message: Message) => {
      await this.onMessageEdited(message.id);
    });

    this.db.on('conversation:deleted', async (conversationId: string) => {
      await this.onConversationDeleted(conversationId);
    });

    // Also handle soft deletes
    this.db.on('conversation:soft-deleted', async (conversationId: string) => {
      await this.onConversationDeleted(conversationId);
    });
  }
}

interface ConsistencyReport {
  startedAt: string;
  completedAt?: string;
  orphanedVectors: number;
  missingVectors: number;
  staleVectors: number;
  actionsRequired: SyncAction[];
}

interface SyncAction {
  action: 'delete_orphaned' | 'index_missing' | 'reindex_stale';
  conversationId?: string;
  messageIds?: string[];
  count?: number;
}
```

### 7.8 Database Event Integration

Modify the existing database to emit events for sync:

```typescript
// Location: src/db/index.ts (modifications)

import { EventEmitter } from 'events';

class Database extends EventEmitter {
  // ... existing code ...

  /**
   * Soft delete a conversation
   */
  async deleteConversation(id: string): Promise<void> {
    const now = new Date().toISOString();

    await this.query(
      `UPDATE conversations SET deletedAt = ? WHERE id = ?`,
      [now, id]
    );

    // Emit event for sync manager
    this.emit('conversation:deleted', id);
    this.emit('conversation:soft-deleted', id);
  }

  /**
   * Hard delete a conversation (permanent)
   */
  async hardDeleteConversation(id: string): Promise<void> {
    // Delete messages first
    const messages = await this.findMessagesByConversationId(id);
    for (const msg of messages) {
      this.emit('message:deleted', msg.id);
    }

    await this.query(`DELETE FROM messages WHERE conversationId = ?`, [id]);
    await this.query(`DELETE FROM conversations WHERE id = ?`, [id]);

    this.emit('conversation:deleted', id);
  }

  /**
   * Create a message with event emission
   */
  async createMessage(message: Message): Promise<Message> {
    // ... existing insert code ...

    // Emit event for real-time indexing
    this.emit('message:created', message);

    return message;
  }
}
```

### 7.9 Initialization & Integration

```typescript
// Location: src/index.ts (additions)

import { ConversationSearchService } from './conversation-search/service';
import { ConversationSyncManager } from './conversation-search/sync-manager';
import { ConversationSearchTool } from './tools/native/conversation-search';

// In initialization section:

// Initialize conversation search (reuse embedding provider from RAG)
console.log('[Init] Initializing conversation search service...');
const conversationSearchService = new ConversationSearchService(
  process.cwd(),
  embeddingProvider  // Same provider used for RAG
);
await conversationSearchService.init();

// Set up sync manager
const conversationSyncManager = new ConversationSyncManager(
  conversationSearchService.getLanceStore(),
  db,
  conversationSearchService.getIndexer()
);
conversationSyncManager.setupEventListeners();

// Index any pending messages from before sync was set up
console.log('[Init] Indexing pending conversation messages...');
const indexResult = await conversationSearchService.indexPendingMessages();
console.log(`[Init] Indexed ${indexResult.indexed} messages`);

// Register the search tool
toolRunner.registerNativeTool(new ConversationSearchTool(conversationSearchService));

// Schedule periodic consistency check (optional)
if (config.conversationSearch?.periodicSync) {
  setInterval(async () => {
    const report = await conversationSyncManager.fullConsistencyCheck();
    if (report.actionsRequired.length > 0) {
      console.log('[ConversationSync] Repairing sync issues:', report);
      await conversationSyncManager.repairSync(report);
    }
  }, 24 * 60 * 60 * 1000); // Daily
}
```

### 7.10 Configuration Options

```typescript
// Location: src/conversation-search/config.ts

export interface ConversationSearchConfig {
  // Feature toggle
  enabled: boolean;

  // Indexing settings
  indexing: {
    // Which roles to index
    roles: ('user' | 'assistant' | 'system' | 'tool')[];

    // Chunking
    maxChunkSize: number;
    chunkOverlap: number;

    // Context enrichment
    includeConversationTitle: boolean;
    includeTimestamp: boolean;
    includePrecedingContext: boolean;

    // Batch settings
    batchSize: number;

    // Exclude patterns (regex)
    excludePatterns: string[];
  };

  // Search settings
  search: {
    defaultLimit: number;
    maxLimit: number;
    defaultMinScore: number;

    // Result formatting
    maxSnippetLength: number;
    highlightMatches: boolean;
  };

  // Sync settings
  sync: {
    strategy: 'realtime' | 'batch' | 'hybrid';
    batchInterval: number;        // ms, for batch strategy
    consistencyCheckInterval: number;  // ms, 0 to disable
    autoRepair: boolean;
  };

  // Storage
  storage: {
    // Separate from RAG to avoid conflicts
    lanceDbPath: string;
  };
}

export const DEFAULT_CONFIG: ConversationSearchConfig = {
  enabled: true,

  indexing: {
    roles: ['user', 'assistant'],
    maxChunkSize: 500,
    chunkOverlap: 50,
    includeConversationTitle: true,
    includeTimestamp: true,
    includePrecedingContext: true,
    batchSize: 50,
    excludePatterns: []
  },

  search: {
    defaultLimit: 5,
    maxLimit: 20,
    defaultMinScore: 0.5,
    maxSnippetLength: 500,
    highlightMatches: false
  },

  sync: {
    strategy: 'hybrid',
    batchInterval: 5 * 60 * 1000,     // 5 minutes
    consistencyCheckInterval: 24 * 60 * 60 * 1000,  // Daily
    autoRepair: true
  },

  storage: {
    lanceDbPath: '.olliebot/conversations.lance'
  }
};
```

### 7.11 API Endpoints (Optional Web Interface)

```typescript
// Location: src/conversation-search/routes.ts

import { Router } from 'express';

export function createConversationSearchRoutes(
  searchService: ConversationSearchService,
  syncManager: ConversationSyncManager
): Router {
  const router = Router();

  // Search endpoint
  router.post('/search', async (req, res) => {
    try {
      const { query, limit, conversationId, timeRange, roles, minScore } = req.body;

      const results = await searchService.search({
        query,
        limit: limit || 5,
        minScore: minScore || 0.5,
        filters: { conversationId, timeRange, roles }
      });

      res.json({ success: true, results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get index stats
  router.get('/stats', async (req, res) => {
    const stats = await searchService.getStats();
    res.json(stats);
  });

  // Trigger re-index
  router.post('/reindex', async (req, res) => {
    const { force } = req.body;

    if (force) {
      // Clear and rebuild entire index
      await searchService.clearIndex();
    }

    const result = await searchService.indexPendingMessages();
    res.json({ success: true, ...result });
  });

  // Run consistency check
  router.post('/consistency-check', async (req, res) => {
    const report = await syncManager.fullConsistencyCheck();
    res.json(report);
  });

  // Repair sync issues
  router.post('/repair', async (req, res) => {
    const report = await syncManager.fullConsistencyCheck();
    const result = await syncManager.repairSync(report);
    res.json({ report, result });
  });

  return router;
}
```

### 7.12 Implementation Phases

| Phase | Tasks | Duration |
|-------|-------|----------|
| **Phase 1: Core Infrastructure** | Create LanceDB table schema, implement basic indexer, create ConversationSearchService | 1 week |
| **Phase 2: Search Tool** | Implement conversation_search tool, integrate with tool runner, test basic search | 1 week |
| **Phase 3: Sync Manager** | Implement deletion handling, add database event hooks, create consistency checker | 1 week |
| **Phase 4: Polish** | Add API endpoints, configuration options, monitoring, documentation | 1 week |

### 7.13 Key Design Decisions

1. **Separate LanceDB Instance**: Conversations use their own LanceDB (`.olliebot/conversations.lance`) separate from RAG projects to avoid conflicts and allow independent scaling.

2. **Same Embedding Provider**: Reuse the RAG embedding provider for consistency and to avoid multiple API costs.

3. **Real-time + Batch Hybrid**: Index messages in real-time as they arrive, but run periodic consistency checks to catch any edge cases.

4. **Soft Delete Awareness**: The system watches for both soft deletes (`deletedAt` set) and hard deletes to maintain sync.

5. **Context Enrichment**: Include conversation title and preceding message context in embeddings to improve semantic search quality.

6. **Deduplication**: When a message is chunked, only return the highest-scoring chunk to avoid duplicate results.

### 7.14 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Message Lifecycle                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User Message → Database.createMessage() → emit('message:created')          │
│                         ↓                              ↓                     │
│                 [Stored in AlaSQL]          [SyncManager listens]            │
│                                                        ↓                     │
│                                              ConversationIndexer             │
│                                                        ↓                     │
│                                              EmbeddingProvider.embed()       │
│                                                        ↓                     │
│                                              LanceDB.upsert()                │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         Deletion Lifecycle                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User deletes conversation → Database.deleteConversation()                   │
│                                       ↓                                      │
│                              emit('conversation:deleted')                    │
│                                       ↓                                      │
│                              SyncManager.onConversationDeleted()             │
│                                       ↓                                      │
│                              LanceDB.delete(conversationId)                  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         Search Flow                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Agent calls conversation_search(query)                                      │
│           ↓                                                                  │
│  ConversationSearchService.search()                                          │
│           ↓                                                                  │
│  EmbeddingProvider.embed(query)                                              │
│           ↓                                                                  │
│  LanceDB.search(vector, filters)                                             │
│           ↓                                                                  │
│  Score conversion (L2 → cosine similarity)                                   │
│           ↓                                                                  │
│  Deduplicate by messageId                                                    │
│           ↓                                                                  │
│  Format results for agent                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

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
*Updated: 2026-02-06 - Added Part 7: Conversation Search System Design*
*Author: OllieBot Development Team*
