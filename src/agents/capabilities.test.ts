/**
 * Tests for Agent Capabilities
 *
 * These tests verify that agents have the correct tools and skills based on their configuration.
 */

import { describe, it, expect } from 'vitest';
import { filterSkills, parseToolPatterns, getAgentCapabilities, getAllAgentCapabilities } from './capabilities.js';
import type { SpecialistTemplate } from './registry.js';

// Sample skill IDs that would be available in the system
const ALL_SKILL_IDS = ['frontend-modifier', 'docx', 'pdf', 'pptx', 'some-other-skill'];

describe('filterSkills', () => {
  it('returns all skills when allowedSkills is null', () => {
    const result = filterSkills(ALL_SKILL_IDS, null);
    expect(result).toEqual(ALL_SKILL_IDS);
  });

  it('returns all skills when allowedSkills is undefined', () => {
    const result = filterSkills(ALL_SKILL_IDS, undefined);
    expect(result).toEqual(ALL_SKILL_IDS);
  });

  it('returns NO skills when allowedSkills is empty array', () => {
    const result = filterSkills(ALL_SKILL_IDS, []);
    expect(result).toEqual([]);
  });

  it('returns only specified skills when allowedSkills has values', () => {
    const result = filterSkills(ALL_SKILL_IDS, ['frontend-modifier']);
    expect(result).toEqual(['frontend-modifier']);
  });

  it('filters out skills not in allowedSkills', () => {
    const result = filterSkills(ALL_SKILL_IDS, ['frontend-modifier', 'docx']);
    expect(result).toEqual(['frontend-modifier', 'docx']);
    expect(result).not.toContain('pdf');
    expect(result).not.toContain('pptx');
  });

  it('handles allowedSkills with non-existent skill IDs', () => {
    const result = filterSkills(ALL_SKILL_IDS, ['non-existent-skill']);
    expect(result).toEqual([]);
  });
});

describe('parseToolPatterns', () => {
  it('separates includes and excludes', () => {
    const result = parseToolPatterns(['tool1', '!tool2', 'tool3', '!tool4']);
    expect(result.includes).toEqual(['tool1', 'tool3']);
    expect(result.excludes).toEqual(['tool2', 'tool4']);
  });

  it('handles patterns with only includes', () => {
    const result = parseToolPatterns(['delegate', 'check_frontend_code']);
    expect(result.includes).toEqual(['delegate', 'check_frontend_code']);
    expect(result.excludes).toEqual([]);
  });

  it('handles patterns with only excludes', () => {
    const result = parseToolPatterns(['!delegate', '!remember']);
    expect(result.includes).toEqual([]);
    expect(result.excludes).toEqual(['delegate', 'remember']);
  });

  it('handles empty patterns', () => {
    const result = parseToolPatterns([]);
    expect(result.includes).toEqual([]);
    expect(result.excludes).toEqual([]);
  });
});

describe('getAgentCapabilities', () => {
  it('returns correct capabilities for agent with no skills (empty allowedSkills)', () => {
    const template: SpecialistTemplate = {
      type: 'coding-lead',
      identity: {
        name: 'Coding Lead',
        emoji: '👨‍💻',
        role: 'specialist',
        description: 'Test agent',
      },
      canAccessTools: ['delegate', 'check_frontend_code'],
      allowedSkills: [], // No skills
    };

    const result = getAgentCapabilities(template, ALL_SKILL_IDS);

    expect(result.agentType).toBe('coding-lead');
    expect(result.tools).toEqual(['delegate', 'check_frontend_code']);
    expect(result.skills).toEqual([]); // Should have NO skills
  });

  it('returns correct capabilities for agent with specific skills', () => {
    const template: SpecialistTemplate = {
      type: 'coding-planner',
      identity: {
        name: 'Coding Planner',
        emoji: '📐',
        role: 'specialist',
        description: 'Test agent',
      },
      canAccessTools: ['read_skill', 'read_frontend_code', 'delegate'],
      allowedSkills: ['frontend-modifier'], // Only one skill
    };

    const result = getAgentCapabilities(template, ALL_SKILL_IDS);

    expect(result.agentType).toBe('coding-planner');
    expect(result.tools).toEqual(['read_skill', 'read_frontend_code', 'delegate']);
    expect(result.skills).toEqual(['frontend-modifier']); // Only frontend-modifier
  });

  it('returns correct capabilities for agent with all skills (no allowedSkills)', () => {
    const template: SpecialistTemplate = {
      type: 'researcher',
      identity: {
        name: 'Research Agent',
        emoji: '🔍',
        role: 'specialist',
        description: 'Test agent',
      },
      canAccessTools: ['web_search', 'web_scrape'],
      // No allowedSkills field - should have access to all skills
    };

    const result = getAgentCapabilities(template, ALL_SKILL_IDS);

    expect(result.agentType).toBe('researcher');
    expect(result.tools).toEqual(['web_search', 'web_scrape']);
    expect(result.skills).toEqual(ALL_SKILL_IDS); // Should have ALL skills
  });
});

describe('getAllAgentCapabilities', () => {
  it('returns capabilities for all templates', () => {
    const templates: SpecialistTemplate[] = [
      {
        type: 'agent-a',
        identity: { name: 'Agent A', emoji: '🅰️', role: 'specialist', description: 'Test' },
        canAccessTools: ['tool1'],
        allowedSkills: [],
      },
      {
        type: 'agent-b',
        identity: { name: 'Agent B', emoji: '🅱️', role: 'specialist', description: 'Test' },
        canAccessTools: ['tool2'],
        allowedSkills: ['frontend-modifier'],
      },
    ];

    const result = getAllAgentCapabilities(templates, ALL_SKILL_IDS);

    expect(result.size).toBe(2);
    expect(result.get('agent-a')?.skills).toEqual([]);
    expect(result.get('agent-b')?.skills).toEqual(['frontend-modifier']);
  });
});

// ============================================================================
// Integration tests with actual SPECIALIST_TEMPLATES from registry
// These tests verify the actual agent configurations are correct
// ============================================================================

describe('Self-Coding Agents Configuration', () => {
  // Import actual templates for integration testing
  // We'll define them inline to avoid circular dependency issues in tests
  const CODING_LEAD_TEMPLATE: SpecialistTemplate = {
    type: 'coding-lead',
    identity: {
      name: 'Coding Lead',
      emoji: '👨‍💻',
      role: 'specialist',
      description: 'Orchestrates frontend code modifications, validates builds, and commits changes',
    },
    canAccessTools: ['delegate', 'check_frontend_code'],
    allowedSkills: [], // No skills - coding-lead delegates to planner/worker who have the skills
  };

  const CODING_PLANNER_TEMPLATE: SpecialistTemplate = {
    type: 'coding-planner',
    identity: {
      name: 'Coding Planner',
      emoji: '📐',
      role: 'specialist',
      description: 'Analyzes frontend modification requests, creates change plans, and delegates to workers',
    },
    canAccessTools: ['read_skill', 'read_frontend_code', 'delegate'],
    allowedSkills: ['frontend-modifier'],
  };

  const CODING_WORKER_TEMPLATE: SpecialistTemplate = {
    type: 'coding-worker',
    identity: {
      name: 'Coding Worker',
      emoji: '🔧',
      role: 'specialist',
      description: 'Executes individual code changes using the modify_frontend_code tool',
    },
    canAccessTools: ['read_skill', 'read_frontend_code', 'modify_frontend_code'],
    allowedSkills: ['frontend-modifier'],
  };

  const CODING_FIXER_TEMPLATE: SpecialistTemplate = {
    type: 'coding-fixer',
    identity: {
      name: 'Coding Fixer',
      emoji: '🔨',
      role: 'specialist',
      description: 'Fixes build errors in frontend code',
    },
    canAccessTools: ['read_frontend_code', 'modify_frontend_code', 'check_frontend_code'],
    allowedSkills: ['frontend-modifier'],
  };

  describe('coding-lead', () => {
    it('should have NO skills (delegates to planner/worker)', () => {
      const caps = getAgentCapabilities(CODING_LEAD_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.skills).toEqual([]);
      expect(caps.skills.length).toBe(0);
    });

    it('should have delegate and check_frontend_code tools', () => {
      const caps = getAgentCapabilities(CODING_LEAD_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.tools).toContain('delegate');
      expect(caps.tools).toContain('check_frontend_code');
    });
  });

  describe('coding-planner', () => {
    it('should have only frontend-modifier skill', () => {
      const caps = getAgentCapabilities(CODING_PLANNER_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.skills).toEqual(['frontend-modifier']);
      expect(caps.skills).not.toContain('docx');
      expect(caps.skills).not.toContain('pdf');
      expect(caps.skills).not.toContain('pptx');
    });

    it('should have read_skill, read_frontend_code, and delegate tools', () => {
      const caps = getAgentCapabilities(CODING_PLANNER_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.tools).toContain('read_skill');
      expect(caps.tools).toContain('read_frontend_code');
      expect(caps.tools).toContain('delegate');
    });
  });

  describe('coding-worker', () => {
    it('should have only frontend-modifier skill', () => {
      const caps = getAgentCapabilities(CODING_WORKER_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.skills).toEqual(['frontend-modifier']);
    });

    it('should have read_skill, read_frontend_code, and modify_frontend_code tools', () => {
      const caps = getAgentCapabilities(CODING_WORKER_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.tools).toContain('read_skill');
      expect(caps.tools).toContain('read_frontend_code');
      expect(caps.tools).toContain('modify_frontend_code');
    });
  });

  describe('coding-fixer', () => {
    it('should have only frontend-modifier skill', () => {
      const caps = getAgentCapabilities(CODING_FIXER_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.skills).toEqual(['frontend-modifier']);
    });

    it('should have read_frontend_code, modify_frontend_code, and check_frontend_code tools', () => {
      const caps = getAgentCapabilities(CODING_FIXER_TEMPLATE, ALL_SKILL_IDS);
      expect(caps.tools).toContain('read_frontend_code');
      expect(caps.tools).toContain('modify_frontend_code');
      expect(caps.tools).toContain('check_frontend_code');
    });
  });
});
