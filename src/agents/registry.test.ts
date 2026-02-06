/**
 * Integration Tests for Agent Registry
 *
 * These tests verify that the actual SPECIALIST_TEMPLATES in registry.ts
 * have the correct configuration. This prevents regressions where agents
 * might accidentally get access to skills or tools they shouldn't have.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { AgentRegistry, getAgentRegistry } from './registry.js';
import { getAgentCapabilities } from './capabilities.js';

// Simulated skill IDs that would exist in a real system
const SAMPLE_SKILL_IDS = ['frontend-modifier', 'docx', 'pdf', 'pptx'];

describe('AgentRegistry - Self-Coding Agents', () => {
  let registry: AgentRegistry;

  beforeAll(() => {
    registry = getAgentRegistry();
  });

  describe('coding-lead', () => {
    it('should exist in the registry', () => {
      const template = registry.getSpecialistTemplate('coding-lead');
      expect(template).toBeDefined();
    });

    it('should have allowedSkills set to empty array (NO skills)', () => {
      const template = registry.getSpecialistTemplate('coding-lead');
      expect(template?.allowedSkills).toEqual([]);
    });

    it('should return 0 skills when filtered', () => {
      const template = registry.getSpecialistTemplate('coding-lead')!;
      const caps = getAgentCapabilities(template, SAMPLE_SKILL_IDS);
      expect(caps.skills.length).toBe(0);
    });

    it('should have delegate tool access', () => {
      const template = registry.getSpecialistTemplate('coding-lead');
      expect(template?.canAccessTools).toContain('delegate');
    });

    it('should have check_frontend_code tool access', () => {
      const template = registry.getSpecialistTemplate('coding-lead');
      expect(template?.canAccessTools).toContain('check_frontend_code');
    });

    it('should be able to delegate to coding-planner and coding-fixer', () => {
      const template = registry.getSpecialistTemplate('coding-lead');
      expect(template?.delegation?.allowedDelegates).toContain('coding-planner');
      expect(template?.delegation?.allowedDelegates).toContain('coding-fixer');
    });
  });

  describe('coding-planner', () => {
    it('should exist in the registry', () => {
      const template = registry.getSpecialistTemplate('coding-planner');
      expect(template).toBeDefined();
    });

    it('should have only frontend-modifier in allowedSkills', () => {
      const template = registry.getSpecialistTemplate('coding-planner');
      expect(template?.allowedSkills).toEqual(['frontend-modifier']);
    });

    it('should return only frontend-modifier when filtered', () => {
      const template = registry.getSpecialistTemplate('coding-planner')!;
      const caps = getAgentCapabilities(template, SAMPLE_SKILL_IDS);
      expect(caps.skills).toEqual(['frontend-modifier']);
    });

    it('should NOT have access to docx, pdf, or pptx skills', () => {
      const template = registry.getSpecialistTemplate('coding-planner')!;
      const caps = getAgentCapabilities(template, SAMPLE_SKILL_IDS);
      expect(caps.skills).not.toContain('docx');
      expect(caps.skills).not.toContain('pdf');
      expect(caps.skills).not.toContain('pptx');
    });

    it('should be able to delegate to coding-worker', () => {
      const template = registry.getSpecialistTemplate('coding-planner');
      expect(template?.delegation?.allowedDelegates).toContain('coding-worker');
    });
  });

  describe('coding-worker', () => {
    it('should exist in the registry', () => {
      const template = registry.getSpecialistTemplate('coding-worker');
      expect(template).toBeDefined();
    });

    it('should have only frontend-modifier in allowedSkills', () => {
      const template = registry.getSpecialistTemplate('coding-worker');
      expect(template?.allowedSkills).toEqual(['frontend-modifier']);
    });

    it('should return only frontend-modifier when filtered', () => {
      const template = registry.getSpecialistTemplate('coding-worker')!;
      const caps = getAgentCapabilities(template, SAMPLE_SKILL_IDS);
      expect(caps.skills).toEqual(['frontend-modifier']);
    });

    it('should have modify_frontend_code tool access', () => {
      const template = registry.getSpecialistTemplate('coding-worker');
      expect(template?.canAccessTools).toContain('modify_frontend_code');
    });

    it('should NOT be able to delegate', () => {
      const template = registry.getSpecialistTemplate('coding-worker');
      expect(template?.delegation?.canDelegate).toBe(false);
    });
  });

  describe('coding-fixer', () => {
    it('should exist in the registry', () => {
      const template = registry.getSpecialistTemplate('coding-fixer');
      expect(template).toBeDefined();
    });

    it('should have only frontend-modifier in allowedSkills', () => {
      const template = registry.getSpecialistTemplate('coding-fixer');
      expect(template?.allowedSkills).toEqual(['frontend-modifier']);
    });

    it('should return only frontend-modifier when filtered', () => {
      const template = registry.getSpecialistTemplate('coding-fixer')!;
      const caps = getAgentCapabilities(template, SAMPLE_SKILL_IDS);
      expect(caps.skills).toEqual(['frontend-modifier']);
    });

    it('should have check_frontend_code tool access', () => {
      const template = registry.getSpecialistTemplate('coding-fixer');
      expect(template?.canAccessTools).toContain('check_frontend_code');
    });
  });
});

describe('AgentRegistry - Research Agents', () => {
  let registry: AgentRegistry;

  beforeAll(() => {
    registry = getAgentRegistry();
  });

  describe('researcher', () => {
    it('should exist in the registry', () => {
      const template = registry.getSpecialistTemplate('researcher');
      expect(template).toBeDefined();
    });

    it('should NOT have allowedSkills restriction (can use all skills)', () => {
      const template = registry.getSpecialistTemplate('researcher');
      // No allowedSkills means agent can use all skills
      expect(template?.allowedSkills).toBeUndefined();
    });

    it('should return all skills when filtered (no restrictions)', () => {
      const template = registry.getSpecialistTemplate('researcher')!;
      const caps = getAgentCapabilities(template, SAMPLE_SKILL_IDS);
      expect(caps.skills).toEqual(SAMPLE_SKILL_IDS);
    });
  });

  describe('deep-research-lead', () => {
    it('should exist in the registry', () => {
      const template = registry.getSpecialistTemplate('deep-research-lead');
      expect(template).toBeDefined();
    });

    it('should have delegate tool access', () => {
      const template = registry.getSpecialistTemplate('deep-research-lead');
      expect(template?.canAccessTools).toContain('delegate');
    });
  });
});

describe('AgentRegistry - getAllowedSkillsForSpecialist', () => {
  let registry: AgentRegistry;

  beforeAll(() => {
    registry = getAgentRegistry();
  });

  it('returns empty array for coding-lead (no skills)', () => {
    const allowedSkills = registry.getAllowedSkillsForSpecialist('coding-lead');
    expect(allowedSkills).toEqual([]);
  });

  it('returns frontend-modifier array for coding-planner', () => {
    const allowedSkills = registry.getAllowedSkillsForSpecialist('coding-planner');
    expect(allowedSkills).toEqual(['frontend-modifier']);
  });

  it('returns null for researcher (all skills allowed)', () => {
    const allowedSkills = registry.getAllowedSkillsForSpecialist('researcher');
    expect(allowedSkills).toBeNull();
  });

  it('returns null for unknown agent type', () => {
    const allowedSkills = registry.getAllowedSkillsForSpecialist('non-existent-agent');
    expect(allowedSkills).toBeNull();
  });
});
