// Agent Registry - manages all active agents and specialist templates

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  BaseAgent,
  AgentCommunication,
  AgentIdentity,
  AgentDelegationConfig,
} from './types.js';
import { DEFAULT_DELEGATION_CONFIG } from './types.js';

// Directory for agent config files (.md prompts and .json templates)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CONFIG_DIR = join(__dirname, 'config');

/**
 * Specialist agent template - defines identity and capabilities for a specialist type
 */
export interface SpecialistTemplate {
  type: string;
  identity: Omit<AgentIdentity, 'id'>;
  /** Tool access patterns (supports wildcards and !exclusions) */
  canAccessTools: string[];
  /** Delegation configuration for this agent type */
  delegation?: AgentDelegationConfig;
  /** Whether the agent's response should be collapsed by default in the UI */
  collapseResponseByDefault?: boolean;
  /** Whitelist of skill IDs this agent can use (if set, restricts to only these skills) */
  allowedSkills?: string[];
}

/** Default tool exclusions for all specialists (supervisor-only tools) */
const SUPERVISOR_ONLY_TOOLS = ['!delegate', '!remember'];

/**
 * Known agent types - loaded from JSON files in templates/ directory
 */
const KNOWN_AGENT_TYPES = [
  'researcher',
  'coder',
  'writer',
  'planner',
  'mission-lead',
  'pillar-owner',
  'deep-research-lead',
  'research-worker',
  'research-reviewer',
  'coding-lead',
  'coding-planner',
  'coding-worker',
  'coding-fixer',
];

/**
 * Load specialist templates from JSON files
 */
function loadSpecialistTemplates(): SpecialistTemplate[] {
  const templates: SpecialistTemplate[] = [];

  for (const agentType of KNOWN_AGENT_TYPES) {
    try {
      const filePath = join(CONFIG_DIR, `${agentType}.json`);
      const content = readFileSync(filePath, 'utf-8');
      const template = JSON.parse(content) as SpecialistTemplate;
      templates.push(template);
    } catch (error) {
      console.warn(`[AgentRegistry] Failed to load template for "${agentType}":`, error);
    }
  }

  return templates;
}

export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private agentsByName: Map<string, string> = new Map(); // name -> id
  private specialists: Map<string, SpecialistTemplate> = new Map();

  constructor() {
    // Load and register specialist templates from JSON files
    const templates = loadSpecialistTemplates();
    for (const template of templates) {
      this.specialists.set(template.type, template);
    }
    console.log(`[AgentRegistry] Loaded ${templates.length} specialist templates`);
  }

  // ============================================================================
  // Agent Management
  // ============================================================================

  registerAgent(agent: BaseAgent): void {
    this.agents.set(agent.identity.id, agent);
    this.agentsByName.set(agent.identity.name.toLowerCase(), agent.identity.id);

    // Give the agent a reference to the registry
    if ('setRegistry' in agent && typeof agent.setRegistry === 'function') {
      (agent as { setRegistry: (r: AgentRegistry) => void }).setRegistry(this);
    }
  }

  unregisterAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      this.agentsByName.delete(agent.identity.name.toLowerCase());
      this.agents.delete(agentId);
    }
  }

  getAgent(agentId: string): BaseAgent | undefined {
    return this.agents.get(agentId);
  }

  getAgentByName(name: string): BaseAgent | undefined {
    const agentId = this.agentsByName.get(name.toLowerCase());
    return agentId ? this.agents.get(agentId) : undefined;
  }

  getAllAgents(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  getAgentIdentities(): AgentIdentity[] {
    return this.getAllAgents().map((a) => a.identity);
  }

  // ============================================================================
  // Specialist Templates
  // ============================================================================

  /**
   * Get all available specialist types
   */
  getSpecialistTypes(): string[] {
    return Array.from(this.specialists.keys());
  }

  /**
   * Get all specialist templates
   */
  getSpecialistTemplates(): SpecialistTemplate[] {
    return Array.from(this.specialists.values());
  }

  /**
   * Get a specialist template by type
   */
  getSpecialistTemplate(type: string): SpecialistTemplate | undefined {
    return this.specialists.get(type);
  }

  /**
   * Find specialist type by identity name
   */
  findSpecialistTypeByName(name: string): string | undefined {
    for (const [type, template] of this.specialists) {
      if (template.identity.name === name) {
        return type;
      }
    }
    return undefined;
  }

  /**
   * Load the system prompt for an agent type from its .md file
   */
  loadAgentPrompt(type: string): string {
    const promptPath = join(CONFIG_DIR, `${type}.md`);
    return readFileSync(promptPath, 'utf-8').trim();
  }

  /**
   * Load agent config from its .json file
   * Returns identity, capabilities, and other config fields
   */
  loadAgentConfig(type: string): Record<string, unknown> | null {
    try {
      const configPath = join(CONFIG_DIR, `${type}.json`);
      const content = readFileSync(configPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get tool access patterns for a specialist type
   * Combines the specialist's allowed tools with supervisor-only exclusions
   * (but doesn't exclude tools that are explicitly included in the template)
   */
  getToolAccessForSpecialist(type: string): string[] {
    const template = this.specialists.get(type);
    if (template) {
      // Get explicit tool includes from template (without ! prefix)
      const explicitIncludes = new Set(
        template.canAccessTools
          .filter(t => !t.startsWith('!'))
      );

      // Filter out exclusions for tools that are explicitly included
      const filteredExclusions = SUPERVISOR_ONLY_TOOLS.filter(exclusion => {
        if (exclusion.startsWith('!')) {
          const toolName = exclusion.slice(1);
          // Don't add exclusion if the tool is explicitly included
          return !explicitIncludes.has(toolName);
        }
        return true;
      });

      // Combine specialist's tools with filtered exclusions
      return [...template.canAccessTools, ...filteredExclusions];
    }
    // Default for custom/unknown types: all tools except supervisor-only
    return ['*', ...SUPERVISOR_ONLY_TOOLS];
  }

  /**
   * Get delegation configuration for a specialist type
   */
  getDelegationConfigForSpecialist(type: string): AgentDelegationConfig {
    const template = this.specialists.get(type);
    return template?.delegation || DEFAULT_DELEGATION_CONFIG;
  }

  /**
   * Get allowed skills for a specialist type (whitelist)
   * Returns null if no restrictions (agent can use all skills)
   */
  getAllowedSkillsForSpecialist(type: string): string[] | null {
    const template = this.specialists.get(type);
    return template?.allowedSkills || null;
  }

  /**
   * Check if an agent can delegate to another agent
   * @throws Error if delegation is not allowed
   */
  canDelegate(
    sourceAgentType: string,
    targetAgentType: string,
    currentWorkflowId: string | null
  ): boolean {
    const sourceConfig = this.getDelegationConfigForSpecialist(sourceAgentType);
    const targetConfig = this.getDelegationConfigForSpecialist(targetAgentType);

    // Check if source can delegate at all
    if (!sourceConfig.canDelegate) {
      throw new Error(`Agent type '${sourceAgentType}' cannot delegate to other agents`);
    }

    // Check if source is allowed to delegate to target
    if (
      sourceConfig.allowedDelegates.length > 0 &&
      !sourceConfig.allowedDelegates.includes(targetAgentType)
    ) {
      throw new Error(
        `Agent type '${sourceAgentType}' is not allowed to delegate to '${targetAgentType}'`
      );
    }

    // Check if target has workflow restrictions
    if (targetConfig.restrictedToWorkflow) {
      if (currentWorkflowId !== targetConfig.restrictedToWorkflow) {
        throw new Error(
          `Agent type '${targetAgentType}' can only be invoked within ` +
          `'${targetConfig.restrictedToWorkflow}' workflow, ` +
          `current workflow: '${currentWorkflowId || 'none'}'`
        );
      }
    }

    return true;
  }

  /**
   * Check if supervisor can invoke an agent type directly
   */
  canSupervisorInvoke(agentType: string): boolean {
    const config = this.getDelegationConfigForSpecialist(agentType);
    return config.supervisorCanInvoke;
  }

  /**
   * Get all command triggers and their associated agent types
   * Returns a map of command (lowercase) -> agent type
   */
  getCommandTriggers(): Map<string, string> {
    const triggers = new Map<string, string>();
    for (const [type, template] of this.specialists) {
      if (template.delegation?.commandTrigger) {
        triggers.set(template.delegation.commandTrigger.toLowerCase(), type);
      }
    }
    return triggers;
  }

  /**
   * Check if an agent type is command-only (cannot be auto-delegated)
   */
  isCommandOnly(agentType: string): boolean {
    const config = this.getDelegationConfigForSpecialist(agentType);
    return config.commandOnly === true;
  }

  /**
   * Get agent types that are NOT command-only (available for LLM auto-delegation)
   */
  getAutoDelegatableTypes(): string[] {
    return Array.from(this.specialists.entries())
      .filter(([_, template]) => {
        const config = template.delegation || DEFAULT_DELEGATION_CONFIG;
        return config.supervisorCanInvoke && !config.commandOnly;
      })
      .map(([type]) => type);
  }

  // ============================================================================
  // Communication
  // ============================================================================

  async routeCommunication(comm: AgentCommunication, toAgentId: string): Promise<void> {
    const targetAgent = this.agents.get(toAgentId);
    if (!targetAgent) {
      console.error(`[AgentRegistry] Target agent not found: ${toAgentId}`);
      return;
    }

    await targetAgent.receiveFromAgent(comm);
  }

  async broadcastToAll(
    comm: Omit<AgentCommunication, 'toAgent'>,
    excludeAgentId?: string
  ): Promise<void> {
    for (const [agentId, agent] of this.agents) {
      if (agentId !== excludeAgentId && agentId !== comm.fromAgent) {
        await agent.receiveFromAgent({ ...comm, toAgent: agentId });
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const agent of this.agents.values()) {
      await agent.shutdown();
    }
    this.agents.clear();
    this.agentsByName.clear();
  }
}

// Singleton instance
let registryInstance: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!registryInstance) {
    registryInstance = new AgentRegistry();
  }
  return registryInstance;
}
