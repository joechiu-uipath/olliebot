/**
 * Turn TODO List Tool
 *
 * Lists TODO items for the current turn, optionally filtered by status.
 * Returns items ordered by priority and a status summary.
 */

import type { NativeTool, NativeToolResult, ToolExecutionContext } from './types.js';
import { TurnTodoRepository } from '../../todos/index.js';
import type { TurnTodoStatus } from '../../todos/types.js';

export class TurnTodoListTool implements NativeTool {
  readonly name = 'list_todo';
  readonly description = `List TODO items for the current task plan. By default returns pending and in-progress items (i.e., remaining work). Use status='all' to see everything including completed items.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed', 'cancelled', 'all'],
        description: 'Filter by status. Default: returns pending + in_progress items.',
      },
    },
  };

  private repository: TurnTodoRepository;

  constructor(repository: TurnTodoRepository) {
    this.repository = repository;
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<NativeToolResult> {
    const turnId = context?.turnId;
    if (!turnId) {
      return { success: false, error: 'Missing execution context (turnId)' };
    }

    const statusFilter = params.status as string | undefined;

    let filterStatuses: TurnTodoStatus[] | undefined;
    if (statusFilter && statusFilter !== 'all') {
      filterStatuses = [statusFilter as TurnTodoStatus];
    } else if (!statusFilter) {
      // Default: pending + in_progress
      filterStatuses = ['pending', 'in_progress'];
    }
    // statusFilter === 'all' → filterStatuses stays undefined → returns all

    const items = this.repository.findByTurn(turnId, filterStatuses);
    const counts = this.repository.countByStatus(turnId);
    const total = counts.pending + counts.in_progress + counts.completed + counts.cancelled;

    return {
      success: true,
      output: {
        items: items.map(t => ({
          id: t.id,
          title: t.title,
          context: t.context,
          completionCriteria: t.completionCriteria,
          agentType: t.agentType,
          status: t.status,
          priority: t.priority,
          outcome: t.outcome,
          createdAt: t.createdAt,
          startedAt: t.startedAt,
          completedAt: t.completedAt,
        })),
        summary: {
          total,
          pending: counts.pending,
          inProgress: counts.in_progress,
          completed: counts.completed,
          cancelled: counts.cancelled,
        },
      },
    };
  }
}
