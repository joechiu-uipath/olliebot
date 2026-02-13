// Base Agent implementation

import { v4 as uuid } from 'uuid';
import type {
  BaseAgent,
  AgentIdentity,
  AgentState,
  AgentCapabilities,
  AgentConfig,
  AgentCommunication,
  AgentMessage,
  AgentTurnUsage,
} from './types.js';
import type { Channel, Message } from '../channels/types.js';
import type { LLMService } from '../llm/service.js';
import type { ToolRunner, LLMTool } from '../tools/index.js';
import type { MemoryService } from '../memory/service.js';
import type { SkillManager } from '../skills/manager.js';
import type { RagDataManager } from '../rag-projects/data-manager.js';
import { generatePostHocCitations, toStoredCitationData } from '../citations/generator.js';
import type { CitationSource, StoredCitationData } from '../citations/types.js';
import { RAG_CACHE_TTL_MS } from '../constants.js';

export abstract class AbstractAgent implements BaseAgent {
  readonly identity: AgentIdentity;
  readonly capabilities: AgentCapabilities;
  readonly config: AgentConfig;

  protected _state: AgentState;
  protected llmService: LLMService;
  protected channel: Channel | null = null;
  protected conversationHistory: Message[] = [];
  protected agentRegistry: AgentRegistry | null = null;
  protected toolRunner: ToolRunner | null = null;
  protected memoryService: MemoryService | null = null;
  protected skillManager: SkillManager | null = null;
  protected ragDataManager: RagDataManager | null = null;
  private ragDataCache: string | null = null;
  private ragDataCacheTime = 0;
  private excludedSkillSources: Array<'builtin' | 'user'> = [];
  private allowedSkills: string[] | null = null; // Whitelist of skill IDs (takes precedence over excludedSkillSources)

  constructor(config: AgentConfig, llmService: LLMService) {
    this.config = config;
    this.identity = config.identity;
    this.capabilities = config.capabilities;
    this.llmService = llmService;

    this._state = {
      status: 'idle',
      lastActivity: new Date(),
      context: {},
    };
  }

  get state(): AgentState {
    return { ...this._state };
  }

  setRegistry(registry: AgentRegistry): void {
    this.agentRegistry = registry;
  }

  /**
   * Set the tool runner for this agent
   */
  setToolRunner(runner: ToolRunner): void {
    this.toolRunner = runner;
  }

  /**
   * Set the memory service for this agent
   */
  setMemoryService(service: MemoryService): void {
    this.memoryService = service;
  }

  /**
   * Set the skill manager for this agent
   * Skills are injected into the system prompt per Agent Skills spec
   */
  setSkillManager(manager: SkillManager): void {
    this.skillManager = manager;
  }

  /**
   * Set the RAG data manager for this agent
   * RAG data is injected into the system prompt if agent has query tool access
   */
  setRagDataManager(manager: RagDataManager): void {
    this.ragDataManager = manager;
  }

  /**
   * Set skill sources to exclude from this agent's system prompt
   * Used to prevent supervisor from accessing specialist-only skills
   */
  setExcludedSkillSources(sources: Array<'builtin' | 'user'>): void {
    this.excludedSkillSources = sources;
  }

  /**
   * Set allowed skills for this agent (whitelist by skill ID)
   * Takes precedence over excludedSkillSources
   * Used to restrict coding agents to only frontend-modifier skill
   */
  setAllowedSkills(skillIds: string[]): void {
    this.allowedSkills = skillIds;
  }

  /**
   * Get allowed skills for this agent
   */
  getAllowedSkills(): string[] | null {
    return this.allowedSkills;
  }

  /**
   * Refresh the RAG data cache if the agent has query tool access.
   * Call this before generating responses to ensure fresh data.
   * Cache expires after RAG_CACHE_TTL_MS.
   */
  async refreshRagDataCache(): Promise<void> {
    if (!this.ragDataManager) {
      return;
    }

    // Check if cache is still valid
    const now = Date.now();
    if (this.ragDataCache !== null && now - this.ragDataCacheTime < RAG_CACHE_TTL_MS) {
      return;
    }

    // Check if this agent has access to the RAG query tool
    if (!this.ragDataManager.hasQueryToolAccess(this.capabilities.canAccessTools)) {
      this.ragDataCache = null;
      return;
    }

    try {
      this.ragDataCache = await this.ragDataManager.formatForSystemPrompt();
      this.ragDataCacheTime = now;
    } catch (error) {
      console.error(`[${this.identity.name}] Failed to refresh RAG data cache:`, error);
      this.ragDataCache = null;
    }
  }

  /**
   * Get tools available to this agent for LLM calls
   * Applies whitelist/blacklist filtering based on agent capabilities
   *
   * Patterns:
   * - '*' = all tools
   * - 'web_search' = specific native tool (no prefix)
   * - 'user.*' = all user tools
   * - 'mcp.*' = all MCP tools
   * - '!delegate' = exclude specific tool (blacklist)
   *
   * Private tools:
   * - Private tools are excluded from the '*' wildcard - they don't appear in the general tool list
   * - Agents only get private tools if explicitly included in their canAccessTools patterns
   * - This allows specialist agents to access private tools without supervisors needing '!' exclusions
   */
  /**
   * Get tools available to the LLM.
   * @param allowedTools - Optional whitelist of tool names. If provided, only these tools are returned.
   */
  protected getToolsForLLM(allowedTools?: string[]): LLMTool[] {
    if (!this.toolRunner) {
      return [];
    }

    const tools = this.toolRunner.getToolsForLLM();

    // If allowedTools whitelist is provided, filter to only those tools
    if (allowedTools && allowedTools.length > 0) {
      const normalizedAllowed = allowedTools.map(t => this.normalizeToolName(t));
      return tools.filter(tool => normalizedAllowed.includes(tool.name));
    }

    // Use agent's capability patterns
    const patterns = this.capabilities.canAccessTools;
    if (patterns.length === 0) {
      return [];
    }

    const inclusions = patterns.filter(p => !p.startsWith('!'));
    const exclusions = patterns.filter(p => p.startsWith('!')).map(p => p.slice(1));

    return tools.filter((tool) => {
      // Check exclusions first
      if (exclusions.some(p => this.matchesToolPattern(tool.name, p))) {
        return false;
      }
      // Private tools require explicit naming (not '*' wildcard)
      const isPrivate = this.toolRunner!.isPrivateTool(tool.name);
      if (isPrivate) {
        return inclusions.some(p => p !== '*' && this.matchesToolPattern(tool.name, p));
      }
      return inclusions.some(p => this.matchesToolPattern(tool.name, p));
    });
  }

  /** Normalize tool name: convert mcp.server.tool → mcp.server__tool */
  private normalizeToolName(name: string): string {
    if (!name.startsWith('mcp.') || name.includes('__')) {
      return name;
    }
    const parts = name.split('.');
    return parts.length >= 3
      ? `${parts[0]}.${parts[1]}__${parts.slice(2).join('.')}`
      : name;
  }

  /** Check if tool name matches a pattern (* = all, prefix* = prefix match) */
  private matchesToolPattern(toolName: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('*')) return toolName.startsWith(pattern.slice(0, -1));
    return toolName === pattern || toolName.includes(pattern);
  }

  registerChannel(channel: Channel): void {
    this.channel = channel;
  }

  async init(): Promise<void> {
    // Initialization complete - no log needed, task start will log
  }

  async shutdown(): Promise<void> {
    this._state.status = 'completed';
    console.log(`[${this.identity.name}] Shutting down`);
  }

  abstract handleMessage(message: Message): Promise<void>;

  async sendMessage(content: string, options?: {
    citations?: StoredCitationData;
    reasoningMode?: string;
    conversationId?: string;
  }): Promise<void> {
    if (!this.channel) {
      console.error(`[${this.identity.name}] Cannot send message: no channel registered`);
      return;
    }

    // Send with agent metadata and conversation context
    await this.channel.send(content, {
      markdown: true,
      agent: {
        agentId: this.identity.id,
        agentName: this.identity.name,
        agentEmoji: this.identity.emoji,
      },
      conversationId: options?.conversationId,
    });

    // Save to conversation history and database
    this.saveAssistantMessage(content, options);

    this._state.lastActivity = new Date();
  }

  /**
   * Save an assistant message to conversation history and database.
   * Called automatically by sendMessage(). Can be called directly for streaming
   * cases where content was already sent chunk by chunk.
   * Subclasses should override to add agent-specific metadata.
   */
  protected saveAssistantMessage(content: string, options?: { citations?: StoredCitationData; usage?: AgentTurnUsage }): void {
    // Default implementation just adds to conversation history
    // Subclasses override to persist to database with agent-specific metadata
    const message: Message = {
      id: uuid(),
      role: 'assistant',
      content,
      metadata: {
        agentId: this.identity.id,
        agentName: this.identity.name,
        agentEmoji: this.identity.emoji,
        ...(options?.citations && { citations: options.citations }),
        ...(options?.usage && { usage: options.usage }),
      },
      createdAt: new Date(),
    };
    this.conversationHistory.push(message);
  }

  async sendError(error: string, details?: string, conversationId?: string): Promise<void> {
    if (!this.channel) {
      console.error(`[${this.identity.name}] Cannot send error: no channel registered`);
      return;
    }
    await this.channel.sendError(error, details, conversationId);
  }

  async receiveFromAgent(comm: AgentCommunication): Promise<void> {
    await this.handleAgentCommunication(comm);
  }

  protected abstract handleAgentCommunication(comm: AgentCommunication): Promise<void>;

  async sendToAgent(
    toAgentId: string,
    comm: Omit<AgentCommunication, 'fromAgent' | 'timestamp'>
  ): Promise<void> {
    if (!this.agentRegistry) {
      console.error(`[${this.identity.name}] No agent registry available`);
      return;
    }

    const fullComm: AgentCommunication = {
      ...comm,
      fromAgent: this.identity.id,
      timestamp: new Date(),
    };

    await this.agentRegistry.routeCommunication(fullComm, toAgentId);
  }

  getState(): AgentState {
    return { ...this._state };
  }

  updateState(updates: Partial<AgentState>): void {
    this._state = { ...this._state, ...updates, lastActivity: new Date() };
  }

  protected async generateResponse(
    messages: Message[],
    additionalContext?: string
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(additionalContext);

    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const response = await this.llmService.generate(llmMessages);
    return response.content;
  }

  protected buildSystemPrompt(additionalContext?: string, allowedTools?: string[]): string {
    let prompt = this.config.systemPrompt;

    if (this.config.mission) {
      prompt += `\n\nYour current mission: ${this.config.mission}`;
    }

    if (additionalContext) {
      prompt += `\n\n${additionalContext}`;
    }

    // Helper to check if a tool is in the allowed tools list
    const hasToolAccess = (toolName: string): boolean => {
      if (!allowedTools) return true; // No filter = full access
      return allowedTools.some(t => t === toolName || t.includes(toolName));
    };

    if (this.memoryService) {
      if (hasToolAccess('remember')) {
        // Skip if allowedTools is provided and doesn't include remember
        prompt += this.memoryService.getMemoryToolInstructions();
      }
      // Inject memory context if available, even without access to remember tool
      const memoryContext = this.memoryService.formatForSystemPrompt();
      if (memoryContext) {
        prompt += memoryContext;
      }
    }

    // Note: Citations are generated post-hoc after response completes
    // No citation guidelines needed in system prompt

    // Add skill information per Agent Skills spec (progressive disclosure)
    // Skip if allowedTools is provided and doesn't include read_agent_skill
    if (this.skillManager && hasToolAccess('read_agent_skill')) {
      // Determine filtering: allowedSkills (whitelist) takes precedence over excludedSkillSources
      const excludeSources = this.excludedSkillSources.length > 0 ? this.excludedSkillSources : undefined;
      const allowedIds = this.allowedSkills;

      const skillInstructions = this.skillManager.getSkillUsageInstructions(excludeSources, allowedIds || undefined);
      const skillsXml = this.skillManager.getSkillsForSystemPrompt(excludeSources, allowedIds || undefined);

      if (skillInstructions && skillsXml) {
        prompt += `\n\n${skillInstructions}\n\n${skillsXml}`;
      }
    }

    // Add RAG knowledge base information (if cached and agent has access)
    // Skip if allowedTools is provided and doesn't include query_rag_project
    if (this.ragDataCache && hasToolAccess('query_rag_project')) {
      prompt += `\n\n${this.ragDataCache}`;
    }

    return prompt;
  }

  /**
   * Generate citations using post-hoc analysis
   * Analyzes the completed response against available sources using fast LLM
   *
   * @param fullResponse - The complete response text
   * @param collectedSources - Citation sources collected during tool execution
   * @returns The stored citation data (only includes cited sources)
   */
  protected async buildCitationData(
    fullResponse: string,
    collectedSources: CitationSource[]
  ): Promise<StoredCitationData | undefined> {
    if (collectedSources.length === 0) {
      return undefined;
    }

    try {
      const result = await generatePostHocCitations(
        this.llmService,
        fullResponse,
        collectedSources
      );

      if (result.references.length === 0) {
        console.log(`[${this.identity.name}] No citations generated for ${collectedSources.length} source(s)`);
        return undefined;
      }

      const storedData = toStoredCitationData(result);
      console.log(
        `[${this.identity.name}] Citations: ${storedData.sources.length} sources cited, ${storedData.references.length} refs (${result.processingTimeMs}ms)`
      );

      return storedData;
    } catch (error) {
      console.error(`[${this.identity.name}] Citation generation failed:`, error);
      return undefined;
    }
  }

  /**
   * End a stream with citation data and optional usage metrics
   */
  protected endStreamWithCitations(
    channel: Channel,
    streamId: string,
    conversationId: string | undefined,
    citationData: StoredCitationData | undefined,
    usage?: AgentTurnUsage
  ): void {
    channel.endStream(streamId, {
      conversationId,
      citations: citationData,
      usage,
    });
  }
}


// Specialist template type
export interface SpecialistTemplate {
  type: string;
  identity: Omit<AgentIdentity, 'id'>;
  canAccessTools: string[];
  delegation?: import('./types.js').AgentDelegationConfig;
  collapseResponseByDefault?: boolean;
}

// Forward declaration - will be implemented in registry.ts
export interface AgentRegistry {
  routeCommunication(comm: AgentCommunication, toAgentId: string): Promise<void>;
  getAgent(agentId: string): BaseAgent | undefined;
  registerAgent(agent: BaseAgent): void;
  unregisterAgent(agentId: string): void;
  // Specialist template methods
  getSpecialistTypes(): string[];
  getSpecialistTemplates(): SpecialistTemplate[];
  getSpecialistTemplate(type: string): SpecialistTemplate | undefined;
  findSpecialistTypeByName(name: string): string | undefined;
  loadAgentPrompt(type: string): string;
  getToolAccessForSpecialist(type: string): string[];
  getAllowedSkillsForSpecialist(type: string): string[] | null;
  // Delegation methods
  getDelegationConfigForSpecialist(type: string): import('./types.js').AgentDelegationConfig;
  canDelegate(sourceAgentType: string, targetAgentType: string, currentWorkflowId: string | null): boolean;
  // Command trigger methods
  getCommandTriggers(): Map<string, string>;
  isCommandOnly(agentType: string): boolean;
  getAutoDelegatableTypes(): string[];
}
