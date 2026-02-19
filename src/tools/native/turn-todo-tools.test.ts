/**
 * Turn TODO Tools unit tests
 *
 * Tests create_todo, list_todo, and delegate_todo tools.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, closeDb } from '../../db/index.js';
import { TurnTodoRepository } from '../../todos/index.js';
import { TurnTodoCreateTool } from './turn-todo-create.js';
import { TurnTodoListTool } from './turn-todo-list.js';
import { DelegateTodoTool } from './delegate-todo.js';
import type { ToolExecutionContext } from './types.js';

describe('Turn TODO Tools', () => {
  let repo: TurnTodoRepository;
  let createTool: TurnTodoCreateTool;
  let listTool: TurnTodoListTool;
  let delegateTool: DelegateTodoTool;

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
    delegateTool = new DelegateTodoTool(repo);
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

      // Complete one via repo (simulating mechanical completion from worker)
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

  describe('DelegateTodoTool', () => {
    let todoId: string;

    beforeEach(async () => {
      const result = await createTool.execute({
        items: [
          { title: 'Research topic X', agentType: 'researcher', context: 'Background info', completionCriteria: 'Summary written' },
          { title: 'Write report' },
        ],
      }, context);
      const output = result.output as { created: Array<{ id: string }> };
      todoId = output.created[0].id;
    });

    it('has correct name', () => {
      expect(delegateTool.name).toBe('delegate_todo');
    });

    it('returns delegation params from todo metadata', async () => {
      const result = await delegateTool.execute({ todoId }, context);

      expect(result.success).toBe(true);
      const output = result.output as { delegated: boolean; todoId: string; todoTitle: string; type: string; mission: string };
      expect(output.delegated).toBe(true);
      expect(output.todoId).toBe(todoId);
      expect(output.todoTitle).toBe('Research topic X');
      expect(output.type).toBe('researcher');
      expect(output.mission).toContain('Research topic X');
      expect(output.mission).toContain('Background info');
      expect(output.mission).toContain('Summary written');
    });

    it('allows agent type override', async () => {
      const result = await delegateTool.execute({ todoId, agentType: 'coder' }, context);
      const output = result.output as { type: string };
      expect(output.type).toBe('coder');
    });

    it('allows mission override', async () => {
      const result = await delegateTool.execute({ todoId, mission: 'Custom mission text' }, context);
      const output = result.output as { mission: string };
      expect(output.mission).toBe('Custom mission text');
    });

    it('defaults to researcher when no agentType on todo', async () => {
      // Use second todo which has no agentType
      const all = repo.findByTurn('turn-test');
      const secondTodoId = all[1].id;
      const result = await delegateTool.execute({ todoId: secondTodoId }, context);
      const output = result.output as { type: string };
      expect(output.type).toBe('researcher');
    });

    it('fails for nonexistent todo', async () => {
      const result = await delegateTool.execute({ todoId: 'nonexistent' }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('fails for non-pending todo', async () => {
      // Mark as in_progress
      repo.update(todoId, { status: 'in_progress', startedAt: new Date().toISOString() });
      const result = await delegateTool.execute({ todoId }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('in_progress');
      expect(result.error).toContain('only pending');
    });

    it('fails for completed todo', async () => {
      repo.update(todoId, { status: 'completed', completedAt: new Date().toISOString(), outcome: 'done' });
      const result = await delegateTool.execute({ todoId }, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('completed');
    });

    it('fails without todoId', async () => {
      const result = await delegateTool.execute({}, context);
      expect(result.success).toBe(false);
      expect(result.error).toContain('todoId');
    });
  });
});
