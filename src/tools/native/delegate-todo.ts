/**
 * Delegate TODO Tool
 *
 * The ONLY way to move a turn TODO item from "pending" to "in_progress".
 * Requires the supervisor to spawn a worker agent to handle the work.
 *
 * This tool validates the todo item and returns delegation params.
 * The supervisor detects this tool in results (similar to the delegate tool)
 * and mechanically:
 *   1. Marks the todo as in_progress
 *   2. Spawns the worker agent
 *   3. On worker return, fills todo outcome from worker result (no LLM step)
 *   4. Marks the todo as completed
 */

import type { NativeTool, NativeToolResult, ToolExecutionContext } from './types.js';
import { TurnTodoRepository } from '../../todos/index.js';

export class DelegateTodoTool implements NativeTool {
  readonly name = 'delegate_todo';
  readonly description = `Delegate a TODO item to a specialist worker agent. This is the ONLY way to execute a TODO task. The worker agent will handle the work, and the result will automatically be recorded as the TODO's outcome.

You must specify the todoId of a pending TODO item. The agent type and mission context are derived from the TODO's metadata, but you can override them.

Available agent types: researcher, coder, writer, planner.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      todoId: {
        type: 'string',
        description: 'The ID of the pending TODO item to delegate',
      },
      agentType: {
        type: 'string',
        enum: ['researcher', 'coder', 'writer', 'planner'],
        description: 'Specialist agent type. Defaults to the agentType set on the TODO item, or "researcher" if none.',
      },
      mission: {
        type: 'string',
        description: 'Override the task description sent to the worker. Defaults to the TODO title + context + completionCriteria.',
      },
    },
    required: ['todoId'],
  };

  private repository: TurnTodoRepository;

  constructor(repository: TurnTodoRepository) {
    this.repository = repository;
  }

  async execute(params: Record<string, unknown>, context?: ToolExecutionContext): Promise<NativeToolResult> {
    const todoId = params.todoId as string;
    const agentTypeOverride = params.agentType as string | undefined;
    const missionOverride = params.mission as string | undefined;

    if (!todoId) {
      return { success: false, error: 'todoId is required' };
    }

    const todo = this.repository.findById(todoId);
    if (!todo) {
      return { success: false, error: `TODO item not found: ${todoId}` };
    }

    if (todo.status !== 'pending') {
      return { success: false, error: `TODO item is ${todo.status}, only pending items can be delegated` };
    }

    // Determine agent type
    const agentType = agentTypeOverride || todo.agentType || 'researcher';

    // Build mission from todo metadata if not overridden
    let mission: string;
    if (missionOverride) {
      mission = missionOverride;
    } else {
      const parts = [todo.title];
      if (todo.context) parts.push(`\nContext: ${todo.context}`);
      if (todo.completionCriteria) parts.push(`\nCompletion criteria: ${todo.completionCriteria}`);
      mission = parts.join('');
    }

    // Return delegation params — supervisor intercepts this and performs actual delegation
    return {
      success: true,
      output: {
        delegated: true,
        todoId: todo.id,
        todoTitle: todo.title,
        type: agentType,
        mission,
      },
    };
  }
}
