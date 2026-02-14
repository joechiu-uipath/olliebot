/**
 * Mission TODO Complete Tool
 *
 * Allows Mission Lead agent to mark an in_progress TODO as completed.
 * This is separate from mission_todo_update because completion requires
 * review authority — the executing agent cannot self-certify completion.
 *
 * Only available to Mission Lead agent (not Pillar Owner).
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MissionManager } from '../../missions/index.js';
import { validateRequired } from './mission-validation.js';

export class MissionTodoCompleteTool implements NativeTool {
  readonly name = 'mission_todo_complete';
  readonly description = `Mark an in_progress TODO as completed. Only use this after reviewing the execution result and confirming the completion criteria have been met. Requires the TODO to be in "in_progress" status.

This tool is restricted to Mission Lead agents — Pillar Owners cannot self-certify completion.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      todoId: {
        type: 'string',
        description: 'The ID (GUID) of the TODO to complete',
      },
      outcome: {
        type: 'string',
        description: 'Required: summary of what was accomplished and the result',
      },
    },
    required: ['todoId', 'outcome'],
  };

  private missionManager: MissionManager;

  constructor(missionManager: MissionManager) {
    this.missionManager = missionManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const todoId = params.todoId as string;
    const outcome = params.outcome as string;

    // Validate required fields using shared validation
    let error = validateRequired(todoId, 'todoId');
    if (error) return error;
    
    error = validateRequired(outcome, 'outcome', 'outcome is required — provide a summary of what was accomplished');
    if (error) return error;

    const todo = this.missionManager.getTodoById(todoId);
    if (!todo) {
      return { success: false, error: `TODO not found: "${todoId}"` };
    }

    if (todo.status !== 'in_progress') {
      return { success: false, error: `Cannot complete "${todo.title}": status is "${todo.status}", expected "in_progress". Only in_progress TODOs can be completed.` };
    }

    const now = new Date().toISOString();
    this.missionManager.updateTodo(todoId, {
      status: 'completed',
      outcome,
      completedAt: now,
    });

    return {
      success: true,
      output: {
        todoId,
        title: todo.title,
        outcome,
        completedAt: now,
        message: `Completed "${todo.title}". Outcome: ${outcome}`,
      },
    };
  }
}
