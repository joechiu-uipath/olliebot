/**
 * Agent Capabilities - Utilities for determining effective tools and skills for agents
 *
 * This module provides pure functions for computing what tools and skills
 * an agent has access to, making the logic easy to test.
 */

import type { SpecialistTemplate } from './registry.js';

/**
 * Result of computing effective capabilities for an agent
 */
export interface AgentCapabilities {
  /** Agent type (e.g., 'coding-lead', 'coding-planner') */
  agentType: string;
  /** Tool names the agent can access */
  tools: string[];
  /** Skill IDs the agent can access */
  skills: string[];
}

/**
 * Filter skills based on allowedSkills configuration
 *
 * @param allSkillIds - All available skill IDs in the system
 * @param allowedSkills - Whitelist from agent template (null = all skills, [] = no skills)
 * @returns Filtered array of skill IDs the agent can access
 *
 * Note: allowedSkills=[] means NO skills, allowedSkills=null means ALL skills
 */
export function filterSkills(allSkillIds: string[], allowedSkills: string[] | null | undefined): string[] {
  // null or undefined means no restrictions - agent can use all skills
  if (allowedSkills === null || allowedSkills === undefined) {
    return [...allSkillIds];
  }

  // Empty array or populated array - filter to only allowed skills
  // This correctly handles [] (no skills) and ['skill-a', 'skill-b'] (specific skills)
  return allSkillIds.filter(id => allowedSkills.includes(id));
}

/**
 * Extract tool names from tool access patterns
 * Handles wildcards and exclusions (e.g., 'mcp.*', '!delegate')
 *
 * @param patterns - Tool access patterns from agent template
 * @returns Array of included tool patterns (exclusions removed but noted)
 */
export function parseToolPatterns(patterns: string[]): { includes: string[], excludes: string[] } {
  const includes: string[] = [];
  const excludes: string[] = [];

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      excludes.push(pattern.slice(1));
    } else {
      includes.push(pattern);
    }
  }

  return { includes, excludes };
}

/**
 * Get effective capabilities for an agent type
 *
 * @param template - The specialist template for the agent type
 * @param allSkillIds - All available skill IDs in the system
 * @returns AgentCapabilities with tools and skills the agent can access
 */
export function getAgentCapabilities(
  template: SpecialistTemplate,
  allSkillIds: string[]
): AgentCapabilities {
  // Parse tool patterns
  const { includes: toolIncludes } = parseToolPatterns(template.canAccessTools);

  // Filter skills based on allowedSkills
  const effectiveSkills = filterSkills(allSkillIds, template.allowedSkills);

  return {
    agentType: template.type,
    tools: toolIncludes,
    skills: effectiveSkills,
  };
}

/**
 * Get capabilities for all agent types
 *
 * @param templates - All specialist templates
 * @param allSkillIds - All available skill IDs in the system
 * @returns Map of agent type to capabilities
 */
export function getAllAgentCapabilities(
  templates: SpecialistTemplate[],
  allSkillIds: string[]
): Map<string, AgentCapabilities> {
  const capabilities = new Map<string, AgentCapabilities>();

  for (const template of templates) {
    capabilities.set(template.type, getAgentCapabilities(template, allSkillIds));
  }

  return capabilities;
}
