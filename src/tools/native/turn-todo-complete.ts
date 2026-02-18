/**
 * Turn TODO Complete Tool
 *
 * Marks a TODO item as completed or cancelled. The supervisor calls this
 * after finishing each step in the plan.
 */

import type { NativeTool, NativeToolResult, ToolExecutionContext } from './types.js';
import { TurnTodoRepository } from '../../todos/index.js';

export class TurnTodoCompleteTool implements NativeTool {
  readonly name = 'complete_todo';
  readonly description = `Mark a TODO item as completed or cancelled. Call this after finishing each task in the plan, providing a brief outcome summary.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      todoId: {
        type: 'string',
        description: 'The ID of the TODO item to complete',
      },
      outcome: {
        type: 'string',
        description: 'What was done, or why the item was cancelled',
      },
      status: {
        type: 'string',
        enum: ['completed', 'cancelled'],
        description: 'New status (default: completed)',
      },
    },
    required: ['todoId', 'outcome'],
  };

  private repository: TurnTodoRepository;

  constructor(repository: TurnTodoRepository) {
    this.repository = repository;
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<NativeToolResult> {
    const todoId = params.todoId as string;
    const outcome = params.outcome as string;
    const status = (params.status as string) || 'completed';

    if (!todoId) {
      return { success: false, error: 'todoId is required' };
    }
    if (!outcome) {
      return { success: false, error: 'outcome is required' };
    }
    if (status !== 'completed' && status !== 'cancelled') {
      return { success: false, error: 'status must be "completed" or "cancelled"' };
    }

    const existing = this.repository.findById(todoId);
    if (!existing) {
      return { success: false, error: `TODO item not found: ${todoId}` };
    }

    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return { success: false, error: `TODO item is already ${existing.status}` };
    }

    const now = new Date().toISOString();
    const updated = this.repository.update(todoId, {
      status: status as 'completed' | 'cancelled',
      outcome,
      completedAt: now,
      ...(existing.status !== 'in_progress' ? { startedAt: now } : {}),
    });

    if (!updated) {
      return { success: false, error: 'Failed to update TODO item' };
    }

    const counts = this.repository.countByStatus(existing.turnId);
    const remaining = counts.pending + counts.in_progress;

    return {
      success: true,
      output: {
        id: updated.id,
        title: updated.title,
        status: updated.status,
        outcome: updated.outcome,
        completedAt: updated.completedAt,
        remaining,
      },
    };
  }
}
