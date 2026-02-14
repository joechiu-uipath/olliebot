/**
 * Mission TODO Update Tool
 *
 * Allows Mission Lead and Pillar Owner agents to update TODO lifecycle:
 * promote (backlog→pending), demote (pending→backlog), start (pending→in_progress),
 * cancel (backlog|pending→cancelled). Cannot cancel in_progress TODOs.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MissionManager } from '../../missions/index.js';

export class MissionTodoUpdateTool implements NativeTool {
  readonly name = 'mission_todo_update';
  readonly description = `Update a TODO's lifecycle status. Actions: promote (backlog→pending), demote (pending→backlog), start (pending→in_progress), cancel (backlog or pending→cancelled).

Cannot cancel an in_progress TODO — there is no reliable cancellation for a running agent turn. An in_progress TODO must be completed or left to finish.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      todoId: {
        type: 'string',
        description: 'The ID (GUID) of the TODO to update',
      },
      action: {
        type: 'string',
        enum: ['promote', 'demote', 'start', 'cancel'],
        description: 'The action to perform: promote (backlog→pending), demote (pending→backlog), start (pending→in_progress), cancel (backlog/pending→cancelled)',
      },
      reason: {
        type: 'string',
        description: 'Required: why this action is being taken',
      },
    },
    required: ['todoId', 'action', 'reason'],
  };

  private missionManager: MissionManager;

  constructor(missionManager: MissionManager) {
    this.missionManager = missionManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const todoId = params.todoId as string;
    const action = params.action as string;
    const reason = params.reason as string;

    if (!todoId?.trim()) return { success: false, error: 'todoId is required' };
    if (!action?.trim()) return { success: false, error: 'action is required' };
    if (!reason?.trim()) return { success: false, error: 'reason is required' };

    const validActions = ['promote', 'demote', 'start', 'cancel'];
    if (!validActions.includes(action)) {
      return { success: false, error: `Invalid action "${action}". Must be one of: ${validActions.join(', ')}` };
    }

    const todo = this.missionManager.getTodoById(todoId);
    if (!todo) {
      return { success: false, error: `TODO not found: "${todoId}"` };
    }

    const now = new Date().toISOString();

    switch (action) {
      case 'promote': {
        if (todo.status !== 'backlog') {
          return { success: false, error: `Cannot promote "${todo.title}": status is "${todo.status}", expected "backlog"` };
        }
        // Check active limit
        const limits = this.missionManager.getTodoLimits(todo.missionId);
        const activeCount = this.missionManager.getActiveTodoCount(todo.missionId);
        if (activeCount >= limits.activeTodoLimit) {
          return { success: false, error: `Cannot promote "${todo.title}": active TODO limit (${limits.activeTodoLimit}) reached. ${activeCount} active TODOs. Cancel or complete existing items first.` };
        }
        this.missionManager.updateTodo(todoId, { status: 'pending' });
        return {
          success: true,
          output: { todoId, title: todo.title, action, fromStatus: 'backlog', toStatus: 'pending', reason, message: `Promoted "${todo.title}" from backlog to pending` },
        };
      }

      case 'demote': {
        if (todo.status !== 'pending') {
          return { success: false, error: `Cannot demote "${todo.title}": status is "${todo.status}", expected "pending"` };
        }
        this.missionManager.updateTodo(todoId, { status: 'backlog' });
        return {
          success: true,
          output: { todoId, title: todo.title, action, fromStatus: 'pending', toStatus: 'backlog', reason, message: `Demoted "${todo.title}" from pending to backlog` },
        };
      }

      case 'start': {
        if (todo.status !== 'pending') {
          return { success: false, error: `Cannot start "${todo.title}": status is "${todo.status}", expected "pending"` };
        }
        this.missionManager.updateTodo(todoId, { status: 'in_progress', startedAt: now });
        return {
          success: true,
          output: { todoId, title: todo.title, action, fromStatus: 'pending', toStatus: 'in_progress', startedAt: now, reason, message: `Started "${todo.title}" — status: in_progress` },
        };
      }

      case 'cancel': {
        if (todo.status === 'in_progress') {
          return { success: false, error: `Cannot cancel "${todo.title}": in_progress TODOs cannot be cancelled. There is no reliable cancellation for a running agent turn. The TODO must be completed or left to finish.` };
        }
        if (todo.status === 'completed' || todo.status === 'cancelled') {
          return { success: false, error: `Cannot cancel "${todo.title}": TODO is already "${todo.status}"` };
        }
        this.missionManager.updateTodo(todoId, { status: 'cancelled', completedAt: now });
        return {
          success: true,
          output: { todoId, title: todo.title, action, fromStatus: todo.status, toStatus: 'cancelled', completedAt: now, reason, message: `Cancelled "${todo.title}"` },
        };
      }

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
}
