/**
 * Turn TODO Tools unit tests
 *
 * Tests create_todo, list_todo, and complete_todo tools.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, closeDb } from '../../db/index.js';
import { TurnTodoRepository } from '../../todos/index.js';
import { TurnTodoCreateTool } from './turn-todo-create.js';
import { TurnTodoListTool } from './turn-todo-list.js';
import { TurnTodoCompleteTool } from './turn-todo-complete.js';
import type { ToolExecutionContext } from './types.js';

describe('Turn TODO Tools', () => {
  let repo: TurnTodoRepository;
  let createTool: TurnTodoCreateTool;
  let listTool: TurnTodoListTool;
  let completeTool: TurnTodoCompleteTool;

  const context: ToolExecutionContext = {
    conversationId: 'conv-test',
    turnId: 'turn-test',
    agentId: 'supervisor-main',
  };

  beforeEach(async () => {
    await closeDb();
    await initDb(':memory:');
    repo = new TurnTodoRepository();
    createTool = new TurnTodoCreateTool(repo);
    listTool = new TurnTodoListTool(repo);
    completeTool = new TurnTodoCompleteTool(repo);
  });

  describe('TurnTodoCreateTool', () => {
    it('has correct name and schema', () => {
      expect(createTool.name).toBe('create_todo');
      expect(createTool.inputSchema.required).toContain('items');
    });

    it('creates multiple todos', async () => {
      const result = await createTool.execute({
        items: [
          { title: 'Step 1', context: 'ctx1' },
          { title: 'Step 2', agentType: 'researcher' },
          { title: 'Step 3', completionCriteria: 'done when X' },
        ],
      }, context);

      expect(result.success).toBe(true);
      const output = result.output as { created: Array<{ id: string; title: string; order: number }>; totalPending: number };
      expect(output.created).toHaveLength(3);
      expect(output.created[0].title).toBe('Step 1');
      expect(output.created[0].order).toBe(1); // 0-indexed priority + 1
      expect(output.totalPending).toBe(3);
    });

    it('respects custom order', async () => {
      const result = await createTool.execute({
        items: [
          { title: 'Last', order: 3 },
          { title: 'First', order: 1 },
          { title: 'Middle', order: 2 },
        ],
      }, context);

      expect(result.success).toBe(true);
      const output = result.output as { created: Array<{ order: number }> };
      expect(output.created[0].order).toBe(3); // order 3 → priority 2 → display 3
      expect(output.created[1].order).toBe(1); // order 1 → priority 0 → display 1
      expect(output.created[2].order).toBe(2); // order 2 → priority 1 → display 2
    });

    it('fails without items', async () => {
      const result = await createTool.execute({ items: [] }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('items');
    });

    it('fails without execution context', async () => {
      const result = await createTool.execute({
        items: [{ title: 'Test' }],
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing execution context');
    });
  });

  describe('TurnTodoListTool', () => {
    beforeEach(async () => {
      // Create some todos
      await createTool.execute({
        items: [
          { title: 'Pending 1' },
          { title: 'Pending 2' },
        ],
      }, context);

      // Complete one
      const all = repo.findByTurn('turn-test');
      repo.update(all[0].id, {
        status: 'completed',
        outcome: 'Done',
        completedAt: new Date().toISOString(),
      });
    });

    it('has correct name', () => {
      expect(listTool.name).toBe('list_todo');
    });

    it('returns pending+in_progress by default', async () => {
      const result = await listTool.execute({}, context);
      expect(result.success).toBe(true);

      const output = result.output as { items: Array<{ status: string }>; summary: Record<string, number> };
      expect(output.items).toHaveLength(1); // only the pending one
      expect(output.items[0].status).toBe('pending');
      expect(output.summary.total).toBe(2);
      expect(output.summary.pending).toBe(1);
      expect(output.summary.completed).toBe(1);
    });

    it('returns all when status=all', async () => {
      const result = await listTool.execute({ status: 'all' }, context);
      const output = result.output as { items: Array<{ status: string }> };
      expect(output.items).toHaveLength(2);
    });

    it('filters by specific status', async () => {
      const result = await listTool.execute({ status: 'completed' }, context);
      const output = result.output as { items: Array<{ status: string }> };
      expect(output.items).toHaveLength(1);
      expect(output.items[0].status).toBe('completed');
    });

    it('fails without turnId context', async () => {
      const result = await listTool.execute({});
      expect(result.success).toBe(false);
    });
  });

  describe('TurnTodoCompleteTool', () => {
    let todoId: string;

    beforeEach(async () => {
      const result = await createTool.execute({
        items: [{ title: 'Complete me' }, { title: 'Other task' }],
      }, context);
      const output = result.output as { created: Array<{ id: string }> };
      todoId = output.created[0].id;
    });

    it('has correct name', () => {
      expect(completeTool.name).toBe('complete_todo');
    });

    it('marks a todo as completed', async () => {
      const result = await completeTool.execute({
        todoId,
        outcome: 'Found the answer',
      }, context);

      expect(result.success).toBe(true);
      const output = result.output as { id: string; status: string; outcome: string; remaining: number };
      expect(output.id).toBe(todoId);
      expect(output.status).toBe('completed');
      expect(output.outcome).toBe('Found the answer');
      expect(output.remaining).toBe(1); // one task still pending
    });

    it('marks a todo as cancelled', async () => {
      const result = await completeTool.execute({
        todoId,
        outcome: 'No longer needed',
        status: 'cancelled',
      }, context);

      expect(result.success).toBe(true);
      const output = result.output as { status: string };
      expect(output.status).toBe('cancelled');
    });

    it('fails for nonexistent todo', async () => {
      const result = await completeTool.execute({
        todoId: 'nonexistent',
        outcome: 'test',
      }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails for already completed todo', async () => {
      // Complete it first
      await completeTool.execute({ todoId, outcome: 'Done' }, context);
      // Try to complete again
      const result = await completeTool.execute({ todoId, outcome: 'Again' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already completed');
    });

    it('fails without todoId', async () => {
      const result = await completeTool.execute({ outcome: 'test' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('todoId');
    });

    it('fails without outcome', async () => {
      const result = await completeTool.execute({ todoId }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('outcome');
    });
  });
});
