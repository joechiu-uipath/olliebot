/**
 * Unit Tests for AbstractAgent base class
 *
 * Tests the getToolsForLLM logic including:
 * - allowedTools whitelist filtering
 * - capability pattern matching (inclusions, exclusions, wildcards)
 * - private tool handling
 * - MCP tool name normalization
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../db/index.js', () => ({
  getDb: () => ({
    messages: { create: vi.fn() },
  }),
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));

// Create a concrete test class since AbstractAgent is abstract
import { AbstractAgent } from './base-agent.js';
import type { AgentConfig, AgentCommunication } from './types.js';
import type { Message } from '../channels/types.js';

class TestAgent extends AbstractAgent {
  async handleMessage(_message: Message): Promise<void> {
    // No-op for testing
  }

  protected async handleAgentCommunication(_comm: AgentCommunication): Promise<void> {
    // No-op for testing
  }

  // Expose protected methods for testing
  public testGetToolsForLLM(allowedTools?: string[]) {
    return this.getToolsForLLM(allowedTools);
  }

  public testNormalizeToolName(name: string) {
    return (this as any).normalizeToolName(name);
  }

  public testMatchesToolPattern(toolName: string, pattern: string) {
    return (this as any).matchesToolPattern(toolName, pattern);
  }
}

// Mock LLM service
const mockLLMService = {
  generate: vi.fn(),
  supportsStreaming: vi.fn(() => true),
};

// Mock tool runner
const createMockToolRunner = (tools: { name: string; isPrivate?: boolean }[]) => ({
  getToolsForLLM: vi.fn(() => tools.map(t => ({ name: t.name, description: 'Test tool' }))),
  isPrivateTool: vi.fn((name: string) => tools.find(t => t.name === name)?.isPrivate ?? false),
});

const createTestConfig = (canAccessTools: string[] = ['*']): AgentConfig => ({
  identity: {
    id: 'test-agent',
    name: 'Test Agent',
    emoji: '🧪',
    role: 'worker',
    description: 'Test agent',
  },
  capabilities: {
    canSpawnAgents: false,
    canAccessTools,
    canUseChannels: ['*'],
    maxConcurrentTasks: 1,
  },
  systemPrompt: 'Test prompt',
});

describe('AbstractAgent', () => {
  describe('normalizeToolName', () => {
    let agent: TestAgent;

    beforeEach(() => {
      agent = new TestAgent(createTestConfig(), mockLLMService as any);
    });

    it('returns non-MCP tool names unchanged', () => {
      expect(agent.testNormalizeToolName('web_search')).toBe('web_search');
      expect(agent.testNormalizeToolName('user.lottery')).toBe('user.lottery');
      expect(agent.testNormalizeToolName('remember')).toBe('remember');
    });

    it('converts mcp.server.tool to mcp.server__tool format', () => {
      expect(agent.testNormalizeToolName('mcp.github.list_repos')).toBe('mcp.github__list_repos');
      expect(agent.testNormalizeToolName('mcp.slack.send_message')).toBe('mcp.slack__send_message');
    });

    it('handles MCP tools with multiple dots in tool name', () => {
      expect(agent.testNormalizeToolName('mcp.server.tool.name')).toBe('mcp.server__tool.name');
    });

    it('returns already normalized MCP names unchanged', () => {
      expect(agent.testNormalizeToolName('mcp.github__list_repos')).toBe('mcp.github__list_repos');
    });

    it('returns short MCP paths unchanged', () => {
      expect(agent.testNormalizeToolName('mcp.github')).toBe('mcp.github');
    });
  });

  describe('matchesToolPattern', () => {
    let agent: TestAgent;

    beforeEach(() => {
      agent = new TestAgent(createTestConfig(), mockLLMService as any);
    });

    it('matches wildcard (*) against any tool', () => {
      expect(agent.testMatchesToolPattern('web_search', '*')).toBe(true);
      expect(agent.testMatchesToolPattern('mcp.github__list_repos', '*')).toBe(true);
    });

    it('matches prefix wildcard (prefix*)', () => {
      expect(agent.testMatchesToolPattern('mcp.github__list_repos', 'mcp.*')).toBe(true);
      expect(agent.testMatchesToolPattern('mcp.slack__send', 'mcp.*')).toBe(true);
      expect(agent.testMatchesToolPattern('web_search', 'mcp.*')).toBe(false);
    });

    it('matches exact tool names', () => {
      expect(agent.testMatchesToolPattern('web_search', 'web_search')).toBe(true);
      expect(agent.testMatchesToolPattern('web_search', 'web_browse')).toBe(false);
    });

    it('matches partial (includes) patterns', () => {
      expect(agent.testMatchesToolPattern('mcp.github__list_repos', 'github')).toBe(true);
      expect(agent.testMatchesToolPattern('user.lottery', 'lottery')).toBe(true);
      expect(agent.testMatchesToolPattern('web_search', 'github')).toBe(false);
    });
  });

  describe('getToolsForLLM', () => {
    describe('with no tool runner', () => {
      it('returns empty array when toolRunner is not set', () => {
        const agent = new TestAgent(createTestConfig(), mockLLMService as any);
        expect(agent.testGetToolsForLLM()).toEqual([]);
      });
    });

    describe('with allowedTools whitelist', () => {
      let agent: TestAgent;
      const mockTools = [
        { name: 'web_search' },
        { name: 'user.lottery' },
        { name: 'mcp.github__list_repos' },
        { name: 'remember' },
      ];

      beforeEach(() => {
        agent = new TestAgent(createTestConfig(), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);
      });

      it('filters to only allowed tools', () => {
        const tools = agent.testGetToolsForLLM(['web_search', 'remember']);
        expect(tools.map(t => t.name)).toEqual(['web_search', 'remember']);
      });

      it('returns empty when no tools match', () => {
        const tools = agent.testGetToolsForLLM(['nonexistent']);
        expect(tools).toEqual([]);
      });

      it('normalizes MCP tool names in whitelist', () => {
        const tools = agent.testGetToolsForLLM(['mcp.github.list_repos']);
        expect(tools.map(t => t.name)).toEqual(['mcp.github__list_repos']);
      });

      it('handles mixed tool formats', () => {
        const tools = agent.testGetToolsForLLM(['user.lottery', 'mcp.github.list_repos']);
        expect(tools.map(t => t.name)).toEqual(['user.lottery', 'mcp.github__list_repos']);
      });
    });

    describe('with capability patterns', () => {
      it('returns all tools with * wildcard', () => {
        const mockTools = [
          { name: 'web_search' },
          { name: 'user.lottery' },
        ];
        const agent = new TestAgent(createTestConfig(['*']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['web_search', 'user.lottery']);
      });

      it('returns empty array with no patterns', () => {
        const mockTools = [{ name: 'web_search' }];
        const agent = new TestAgent(createTestConfig([]), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools).toEqual([]);
      });

      it('filters with prefix wildcard', () => {
        const mockTools = [
          { name: 'mcp.github__list_repos' },
          { name: 'mcp.slack__send' },
          { name: 'web_search' },
        ];
        const agent = new TestAgent(createTestConfig(['mcp.*']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['mcp.github__list_repos', 'mcp.slack__send']);
      });

      it('filters with exact tool name', () => {
        const mockTools = [
          { name: 'web_search' },
          { name: 'user.lottery' },
        ];
        const agent = new TestAgent(createTestConfig(['web_search']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['web_search']);
      });

      it('supports multiple inclusion patterns', () => {
        const mockTools = [
          { name: 'web_search' },
          { name: 'user.lottery' },
          { name: 'remember' },
        ];
        const agent = new TestAgent(createTestConfig(['web_search', 'remember']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['web_search', 'remember']);
      });
    });

    describe('with exclusion patterns', () => {
      it('excludes tools matching ! pattern', () => {
        const mockTools = [
          { name: 'web_search' },
          { name: 'delegate' },
          { name: 'remember' },
        ];
        const agent = new TestAgent(createTestConfig(['*', '!delegate']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['web_search', 'remember']);
      });

      it('excludes multiple tools', () => {
        const mockTools = [
          { name: 'web_search' },
          { name: 'delegate' },
          { name: 'spawn_agent' },
          { name: 'remember' },
        ];
        const agent = new TestAgent(createTestConfig(['*', '!delegate', '!spawn_agent']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['web_search', 'remember']);
      });

      it('exclusions take precedence over inclusions', () => {
        const mockTools = [
          { name: 'delegate' },
        ];
        const agent = new TestAgent(createTestConfig(['delegate', '!delegate']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools).toEqual([]);
      });
    });

    describe('with private tools', () => {
      it('excludes private tools from * wildcard', () => {
        const mockTools = [
          { name: 'web_search', isPrivate: false },
          { name: 'delegate', isPrivate: true },
        ];
        const agent = new TestAgent(createTestConfig(['*']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['web_search']);
      });

      it('includes private tools when explicitly named', () => {
        const mockTools = [
          { name: 'web_search', isPrivate: false },
          { name: 'delegate', isPrivate: true },
        ];
        const agent = new TestAgent(createTestConfig(['*', 'delegate']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['web_search', 'delegate']);
      });

      it('includes private tools with prefix pattern', () => {
        const mockTools = [
          { name: 'private.secret_tool', isPrivate: true },
          { name: 'web_search', isPrivate: false },
        ];
        const agent = new TestAgent(createTestConfig(['*', 'private.*']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        const tools = agent.testGetToolsForLLM();
        expect(tools.map(t => t.name)).toEqual(['private.secret_tool', 'web_search']);
      });
    });

    describe('allowedTools takes precedence over patterns', () => {
      it('ignores capability patterns when allowedTools is provided', () => {
        const mockTools = [
          { name: 'web_search' },
          { name: 'user.lottery' },
          { name: 'delegate', isPrivate: true },
        ];
        // Agent has broad access via patterns
        const agent = new TestAgent(createTestConfig(['*', 'delegate']), mockLLMService as any);
        agent.setToolRunner(createMockToolRunner(mockTools) as any);

        // But allowedTools restricts to just one tool
        const tools = agent.testGetToolsForLLM(['user.lottery']);
        expect(tools.map(t => t.name)).toEqual(['user.lottery']);
      });
    });
  });
});
