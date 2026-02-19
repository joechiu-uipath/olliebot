/**
 * Cancel TODO Tool
 *
 * Allows the supervisor to cancel a TODO item that should not be executed.
 * This is the only way for the LLM to change a todo's status — actual completion
 * is handled mechanically when a worker agent returns from delegate_todo.
 */

import type { NativeTool, NativeToolResult, ToolExecutionContext } from './types.js';
import { TurnTodoRepository } from '../../todos/index.js';

export class CancelTodoTool implements NativeTool {
  readonly name = 'cancel_todo';
  readonly description = `Cancel a TODO item that should not be executed. Provide a reason for cancellation. Use this when a task is no longer relevant or was superseded by earlier results.

NOTE: You cannot mark a TODO as "completed" with this tool. Completion happens automatically when a worker agent finishes via delegate_todo.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      todoId: {
        type: 'string',
        description: 'The ID of the TODO item to cancel',
      },
      reason: {
        type: 'string',
        description: 'Why this item is being cancelled',
      },
    },
    required: ['todoId', 'reason'],
  };

  private repository: TurnTodoRepository;

  constructor(repository: TurnTodoRepository) {
    this.repository = repository;
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<NativeToolResult> {
    const todoId = params.todoId as string;
    const reason = params.reason as string;

    if (!todoId) {
      return { success: false, error: 'todoId is required' };
    }
    if (!reason) {
      return { success: false, error: 'reason is required' };
    }

    const existing = this.repository.findById(todoId);
    if (!existing) {
      return { success: false, error: `TODO item not found: ${todoId}` };
    }

    if (existing.status === 'completed' || existing.status === 'cancelled') {
      return { success: false, error: `TODO item is already ${existing.status}` };
    }

    if (existing.status === 'in_progress') {
      return { success: false, error: 'Cannot cancel an in-progress item (a worker is currently executing it)' };
    }

    const now = new Date().toISOString();
    const updated = this.repository.update(todoId, {
      status: 'cancelled',
      outcome: reason,
      completedAt: now,
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
        status: 'cancelled',
        reason,
        remaining,
      },
    };
  }
}
