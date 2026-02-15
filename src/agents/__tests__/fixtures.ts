/**
 * Test Fixtures for AgentRegistry Tests
 *
 * Shared mock objects to reduce duplication.
 */

import { vi } from 'vitest';
import type { BaseAgent } from '../types.js';

/**
 * Create a mock agent with required properties.
 */
export function createMockAgent(id: string, name: string, role: 'supervisor' | 'worker' = 'worker'): BaseAgent {
  return {
    identity: {
      id,
      name,
      emoji: '🤖',
      role,
      description: `Test agent: ${name}`,
    },
    state: {
      status: 'idle' as const,
      lastActivity: new Date(),
      context: {},
    },
    capabilities: {
      canSpawnAgents: false,
      canAccessTools: ['*'],
      canUseChannels: [],
      maxConcurrentTasks: 1,
    },
    config: {
      identity: {
        id,
        name,
        emoji: '🤖',
        role,
        description: `Test agent: ${name}`,
      },
      capabilities: {
        canSpawnAgents: false,
        canAccessTools: ['*'],
        canUseChannels: [],
        maxConcurrentTasks: 1,
      },
      systemPrompt: '',
    },
    init: vi.fn(),
    handleMessage: vi.fn(),
    sendMessage: vi.fn(),
    sendError: vi.fn(),
    receiveFromAgent: vi.fn(),
    sendToAgent: vi.fn(),
    shutdown: vi.fn(),
    getState: vi.fn().mockReturnValue({ status: 'idle', lastActivity: new Date(), context: {} }),
    updateState: vi.fn(),
    setRegistry: vi.fn(),
  } as unknown as BaseAgent;
}

/**
 * Sample skill IDs for testing skill filtering.
 */
export const SAMPLE_SKILL_IDS = [
  'frontend-modifier',
  'docx',
  'pdf',
  'pptx',
];

/**
 * Communication payload for testing inter-agent communication.
 */
export function createMockCommunication(
  type: 'task_assignment' | 'status_update',
  fromAgent: string,
  toAgent: string = '',
  payload: any = {}
) {
  return {
    type,
    fromAgent,
    toAgent,
    payload,
    timestamp: new Date(),
  };
}
