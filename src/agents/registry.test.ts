/**
 * Integration Tests for Agent Registry
 *
 * These tests verify that the actual SPECIALIST_TEMPLATES in registry.ts
 * have the correct configuration. This prevents regressions where agents
 * might accidentally get access to skills or tools they shouldn't have.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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

describe('AgentRegistry - Agent Management', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  function createMockAgent(id: string, name: string): any {
    return {
      identity: { id, name, emoji: '🤖', role: 'worker', description: 'Test agent' },
      state: { status: 'idle', lastActivity: new Date(), context: {} },
      capabilities: { canSpawnAgents: false, canAccessTools: ['*'], canUseChannels: [], maxConcurrentTasks: 1 },
      config: { identity: { id, name, emoji: '🤖', role: 'worker', description: 'Test agent' }, capabilities: { canSpawnAgents: false, canAccessTools: ['*'], canUseChannels: [], maxConcurrentTasks: 1 }, systemPrompt: '' },
      receiveFromAgent: vi.fn(),
      shutdown: vi.fn(),
      setRegistry: vi.fn(),
    };
  }

  it('registers and retrieves an agent by id', () => {
    const agent = createMockAgent('agent-1', 'Researcher');
    registry.registerAgent(agent);

    expect(registry.getAgent('agent-1')).toBe(agent);
    expect(agent.setRegistry).toHaveBeenCalledWith(registry);
  });

  it('retrieves an agent by name (case-insensitive)', () => {
    const agent = createMockAgent('agent-1', 'Researcher');
    registry.registerAgent(agent);

    expect(registry.getAgentByName('researcher')).toBe(agent);
    expect(registry.getAgentByName('RESEARCHER')).toBe(agent);
  });

  it('returns undefined for unknown agent id', () => {
    expect(registry.getAgent('nonexistent')).toBeUndefined();
  });

  it('returns undefined for unknown agent name', () => {
    expect(registry.getAgentByName('nonexistent')).toBeUndefined();
  });

  it('unregisters an agent', () => {
    const agent = createMockAgent('agent-1', 'Researcher');
    registry.registerAgent(agent);
    expect(registry.getAgent('agent-1')).toBe(agent);

    registry.unregisterAgent('agent-1');
    expect(registry.getAgent('agent-1')).toBeUndefined();
    expect(registry.getAgentByName('Researcher')).toBeUndefined();
  });

  it('unregisterAgent is a no-op for unknown agents', () => {
    // Should not throw
    registry.unregisterAgent('nonexistent');
  });

  it('getAllAgents returns all registered agents', () => {
    const a1 = createMockAgent('a-1', 'Agent One');
    const a2 = createMockAgent('a-2', 'Agent Two');
    registry.registerAgent(a1);
    registry.registerAgent(a2);

    const agents = registry.getAllAgents();
    expect(agents).toHaveLength(2);
  });

  it('getAgentIdentities returns identity objects', () => {
    const agent = createMockAgent('a-1', 'Researcher');
    registry.registerAgent(agent);

    const identities = registry.getAgentIdentities();
    expect(identities).toHaveLength(1);
    expect(identities[0].id).toBe('a-1');
    expect(identities[0].name).toBe('Researcher');
  });
});

describe('AgentRegistry - canDelegate', () => {
  let registry: AgentRegistry;

  beforeAll(() => {
    registry = getAgentRegistry();
  });

  it('allows coding-lead to delegate to coding-planner within self-coding workflow', () => {
    expect(registry.canDelegate('coding-lead', 'coding-planner', 'self-coding')).toBe(true);
  });

  it('throws when source cannot delegate', () => {
    // coding-worker has canDelegate: false
    expect(() => {
      registry.canDelegate('coding-worker', 'coding-planner', null);
    }).toThrow("cannot delegate");
  });

  it('throws when source is not allowed to delegate to target', () => {
    // coding-lead can only delegate to coding-planner and coding-fixer
    expect(() => {
      registry.canDelegate('coding-lead', 'researcher', null);
    }).toThrow("not allowed to delegate to");
  });

  it('throws when target has workflow restriction and workflow does not match', () => {
    // research-worker is restricted to deep-research workflow
    const template = registry.getSpecialistTemplate('research-worker');
    if (template?.delegation?.restrictedToWorkflow) {
      // deep-research-lead can delegate
      expect(() => {
        registry.canDelegate('deep-research-lead', 'research-worker', 'wrong-workflow');
      }).toThrow("can only be invoked within");
    }
  });

  it('allows delegation when workflow matches', () => {
    const template = registry.getSpecialistTemplate('research-worker');
    if (template?.delegation?.restrictedToWorkflow) {
      const result = registry.canDelegate(
        'deep-research-lead',
        'research-worker',
        template.delegation.restrictedToWorkflow
      );
      expect(result).toBe(true);
    }
  });
});

describe('AgentRegistry - getToolAccessForSpecialist', () => {
  let registry: AgentRegistry;

  beforeAll(() => {
    registry = getAgentRegistry();
  });

  it('returns specialist tools plus supervisor exclusions for known type', () => {
    const access = registry.getToolAccessForSpecialist('researcher');
    // Should contain the specialist's defined tools
    expect(access.length).toBeGreaterThan(0);
    // Should include supervisor-only exclusions (unless explicitly included)
    expect(access.some(t => t === '!delegate' || t === '!remember')).toBe(true);
  });

  it('does not exclude tools explicitly included in specialist template', () => {
    // coding-lead explicitly includes 'delegate'
    const access = registry.getToolAccessForSpecialist('coding-lead');
    expect(access).toContain('delegate');
    // Should not have !delegate since delegate is explicitly in canAccessTools
    expect(access).not.toContain('!delegate');
  });

  it('returns wildcard with exclusions for unknown agent type', () => {
    const access = registry.getToolAccessForSpecialist('unknown-type');
    expect(access).toContain('*');
    expect(access).toContain('!delegate');
    expect(access).toContain('!remember');
  });
});

describe('AgentRegistry - Specialist Template Lookups', () => {
  let registry: AgentRegistry;

  beforeAll(() => {
    registry = getAgentRegistry();
  });

  it('getSpecialistTypes returns all known types', () => {
    const types = registry.getSpecialistTypes();
    expect(types).toContain('researcher');
    expect(types).toContain('coder');
    expect(types).toContain('writer');
    expect(types.length).toBeGreaterThanOrEqual(10);
  });

  it('getSpecialistTemplates returns all templates', () => {
    const templates = registry.getSpecialistTemplates();
    expect(templates.length).toBe(registry.getSpecialistTypes().length);
  });

  it('findSpecialistTypeByName finds by identity name', () => {
    const template = registry.getSpecialistTemplate('researcher');
    if (template) {
      const type = registry.findSpecialistTypeByName(template.identity.name);
      expect(type).toBe('researcher');
    }
  });

  it('findSpecialistTypeByName returns undefined for unknown name', () => {
    const type = registry.findSpecialistTypeByName('Nonexistent Agent Name');
    expect(type).toBeUndefined();
  });

  it('canSupervisorInvoke returns true for standard agents', () => {
    expect(registry.canSupervisorInvoke('researcher')).toBe(true);
  });

  it('getCommandTriggers returns map of command -> type', () => {
    const triggers = registry.getCommandTriggers();
    expect(triggers instanceof Map).toBe(true);
    // Deep research lead has a command trigger
    for (const [command, type] of triggers) {
      expect(typeof command).toBe('string');
      expect(typeof type).toBe('string');
    }
  });

  it('getAutoDelegatableTypes excludes command-only agents', () => {
    const types = registry.getAutoDelegatableTypes();
    for (const type of types) {
      expect(registry.isCommandOnly(type)).toBe(false);
    }
  });
});

describe('AgentRegistry - Communication', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  function createMockAgent(id: string, name: string): any {
    return {
      identity: { id, name, emoji: '🤖', role: 'worker', description: 'Test' },
      state: { status: 'idle', lastActivity: new Date(), context: {} },
      capabilities: { canSpawnAgents: false, canAccessTools: ['*'], canUseChannels: [], maxConcurrentTasks: 1 },
      config: { identity: { id, name, emoji: '🤖', role: 'worker', description: 'Test' }, capabilities: { canSpawnAgents: false, canAccessTools: ['*'], canUseChannels: [], maxConcurrentTasks: 1 }, systemPrompt: '' },
      receiveFromAgent: vi.fn(),
      shutdown: vi.fn(),
    };
  }

  it('routeCommunication delivers message to target agent', async () => {
    const agent = createMockAgent('target-1', 'Target');
    registry.registerAgent(agent);

    const comm = {
      type: 'task_assignment' as const,
      fromAgent: 'supervisor',
      toAgent: 'target-1',
      payload: { task: 'do something' },
      timestamp: new Date(),
    };

    await registry.routeCommunication(comm, 'target-1');
    expect(agent.receiveFromAgent).toHaveBeenCalledWith(comm);
  });

  it('routeCommunication handles missing target gracefully', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const comm = {
      type: 'task_assignment' as const,
      fromAgent: 'supervisor',
      toAgent: 'missing-agent',
      payload: {},
      timestamp: new Date(),
    };

    await registry.routeCommunication(comm, 'missing-agent');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Target agent not found: missing-agent')
    );
    errorSpy.mockRestore();
  });

  it('broadcastToAll sends to all agents except excluded', async () => {
    const a1 = createMockAgent('a-1', 'Agent One');
    const a2 = createMockAgent('a-2', 'Agent Two');
    const a3 = createMockAgent('a-3', 'Agent Three');
    registry.registerAgent(a1);
    registry.registerAgent(a2);
    registry.registerAgent(a3);

    const comm = {
      type: 'status_update' as const,
      fromAgent: 'a-1',
      payload: { status: 'working' },
      timestamp: new Date(),
    };

    await registry.broadcastToAll(comm, 'a-2');

    // a-1 excluded as sender, a-2 excluded explicitly
    expect(a1.receiveFromAgent).not.toHaveBeenCalled();
    expect(a2.receiveFromAgent).not.toHaveBeenCalled();
    expect(a3.receiveFromAgent).toHaveBeenCalled();
  });

  it('shutdown calls shutdown on all agents and clears registry', async () => {
    const a1 = createMockAgent('a-1', 'Agent One');
    const a2 = createMockAgent('a-2', 'Agent Two');
    registry.registerAgent(a1);
    registry.registerAgent(a2);

    await registry.shutdown();

    expect(a1.shutdown).toHaveBeenCalled();
    expect(a2.shutdown).toHaveBeenCalled();
    expect(registry.getAllAgents()).toHaveLength(0);
  });
});
