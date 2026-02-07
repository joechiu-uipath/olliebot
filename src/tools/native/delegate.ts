/**
 * Delegate Tool
 *
 * Allows the supervisor to delegate tasks to specialist agents.
 * This tool validates the delegation parameters - actual delegation
 * is performed by the supervisor after detecting this tool was called.
 */

import type { NativeTool, NativeToolResult } from './types.js';

export interface DelegationParams {
  type: string;
  mission: string;
  rationale?: string;
  customName?: string;
  customEmoji?: string;
  /** ID of the agent making this delegation call (for tracking) */
  callerAgentId?: string;
}

export class DelegateTool implements NativeTool {
  readonly name = 'delegate';
  readonly description = `Delegate a task to a specialist agent. Use this when the task requires specialized expertise.

For supervisor agent - available types:
- researcher: For quick research, information gathering, learning about topics
- coder: For writing code, debugging, technical implementation
- writer: For writing documents, editing text, content creation
- planner: For planning, organizing, breaking down projects

NOTE: deep-research-lead and coding-lead require explicit user #commands and cannot be auto-delegated by supervisor.

For deep-research-lead agent:
- research-worker: For parallel subtopic exploration

For coding-lead agent:
- coding-planner: For planning code changes
- coding-fixer: For fixing build errors`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['researcher', 'coder', 'writer', 'planner', 'research-worker', 'research-reviewer', 'coding-planner', 'coding-worker', 'coding-fixer', 'custom'],
        description: 'The type of specialist agent to spawn. Which types are available depends on the calling agent.',
      },
      mission: {
        type: 'string',
        description: 'The specific task for the agent to complete',
      },
      rationale: {
        type: 'string',
        description: 'Brief explanation of why this agent type was chosen',
      },
      customName: {
        type: 'string',
        description: 'Optional custom name for the agent',
      },
      customEmoji: {
        type: 'string',
        description: 'Optional emoji for the agent',
      },
      callerAgentId: {
        type: 'string',
        description: 'ID of the calling agent (for tracking). Pass your agent ID here.',
      },
    },
    required: ['type', 'mission'],
  };

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const { type, mission, rationale, customName, customEmoji, callerAgentId } = params;

    // All valid agent types - the registry will validate who can delegate to whom
    const allValidTypes = [
      'researcher', 'coder', 'writer', 'planner', 'custom',
      'research-worker', 'research-reviewer',
      'coding-planner', 'coding-worker', 'coding-fixer',
    ];

    // Command-only agents that supervisor cannot auto-delegate to
    const commandOnlyTypes = ['deep-research-lead', 'coding-lead'];

    const typeStr = type as string;

    // Check if trying to delegate to command-only agent (only supervisor would try this)
    if (commandOnlyTypes.includes(typeStr)) {
      return {
        success: false,
        error: `Cannot auto-delegate to '${typeStr}'. This agent requires an explicit command from the user. Tell the user to use the #${typeStr === 'deep-research-lead' ? 'Deep Research' : 'Modify'} command.`,
      };
    }

    // Validate type is known (actual permission check happens in registry.canDelegate)
    if (!allValidTypes.includes(typeStr)) {
      return {
        success: false,
        error: `Invalid agent type: ${type}. Must be one of: ${allValidTypes.join(', ')}`,
      };
    }

    if (!mission || (mission as string).trim().length === 0) {
      return {
        success: false,
        error: 'Mission is required',
      };
    }

    // Return success with delegation params
    // Actual delegation and permission check is performed by the calling agent
    return {
      success: true,
      output: {
        delegated: true,
        type,
        mission,
        rationale,
        customName,
        customEmoji,
        callerAgentId: callerAgentId || 'unknown',
      },
    };
  }
}
