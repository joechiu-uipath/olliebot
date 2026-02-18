/**
 * Turn TODO Create Tool
 *
 * Creates one or more TODO items for the current turn. Used by the supervisor
 * agent to plan multi-step tasks before executing them.
 */

import type { NativeTool, NativeToolResult, ToolExecutionContext } from './types.js';
import { TurnTodoRepository } from '../../todos/index.js';

export class TurnTodoCreateTool implements NativeTool {
  readonly name = 'create_todo';
  readonly description = `Create one or more TODO items for the current task plan. Use this to break a complex request into discrete steps before executing them. Each item should be a single, actionable task.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'List of TODO items to create',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Concise, actionable task name (verb-first)',
            },
            context: {
              type: 'string',
              description: 'Relevant background info for executing this task',
            },
            completionCriteria: {
              type: 'string',
              description: 'How to judge when this task is done',
            },
            agentType: {
              type: 'string',
              description: 'Specialist agent type to delegate to (researcher, coder, writer, planner), or omit to handle directly',
            },
            order: {
              type: 'number',
              description: '1-indexed position in the plan (default: append in order)',
            },
          },
          required: ['title'],
        },
        minItems: 1,
      },
    },
    required: ['items'],
  };

  private repository: TurnTodoRepository;

  constructor(repository: TurnTodoRepository) {
    this.repository = repository;
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<NativeToolResult> {
    const items = params.items as Array<{
      title: string;
      context?: string;
      completionCriteria?: string;
      agentType?: string;
      order?: number;
    }>;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return { success: false, error: 'items array is required and must not be empty' };
    }

    const conversationId = context?.conversationId;
    const turnId = context?.turnId;

    if (!conversationId || !turnId) {
      return { success: false, error: 'Missing execution context (conversationId/turnId)' };
    }

    const created = items.map((item, index) => {
      const priority = item.order != null ? item.order - 1 : index;
      return this.repository.create({
        conversationId,
        turnId,
        title: item.title.trim(),
        context: item.context?.trim(),
        completionCriteria: item.completionCriteria?.trim(),
        agentType: item.agentType?.trim(),
        priority,
      });
    });

    const counts = this.repository.countByStatus(turnId);

    return {
      success: true,
      output: {
        created: created.map(t => ({ id: t.id, title: t.title, order: t.priority + 1 })),
        totalPending: counts.pending,
      },
    };
  }
}
