/**
 * TurnTodoRepository unit tests
 *
 * Tests the per-turn TODO data access layer against an in-memory SQLite database.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, closeDb } from '../db/index.js';
import { TurnTodoRepository } from './turn-todo-repository.js';

describe('TurnTodoRepository', () => {
  let repo: TurnTodoRepository;
  const conversationId = 'conv-1';
  const turnId = 'turn-1';

  beforeEach(async () => {
    await closeDb();
    await initDb(':memory:');
    repo = new TurnTodoRepository();
  });

  describe('create', () => {
    it('creates a todo with defaults', () => {
      const todo = repo.create({ conversationId, turnId, title: 'Do something' });

      expect(todo.id).toBeTruthy();
      expect(todo.conversationId).toBe(conversationId);
      expect(todo.turnId).toBe(turnId);
      expect(todo.title).toBe('Do something');
      expect(todo.context).toBe('');
      expect(todo.completionCriteria).toBe('');
      expect(todo.agentType).toBeNull();
      expect(todo.status).toBe('pending');
      expect(todo.priority).toBe(0);
      expect(todo.outcome).toBeNull();
      expect(todo.createdAt).toBeTruthy();
      expect(todo.startedAt).toBeNull();
      expect(todo.completedAt).toBeNull();
    });

    it('creates a todo with all fields', () => {
      const todo = repo.create({
        conversationId,
        turnId,
        title: 'Research topic',
        context: 'Background info',
        completionCriteria: 'Summary written',
        agentType: 'researcher',
        priority: 2,
      });

      expect(todo.title).toBe('Research topic');
      expect(todo.context).toBe('Background info');
      expect(todo.completionCriteria).toBe('Summary written');
      expect(todo.agentType).toBe('researcher');
      expect(todo.priority).toBe(2);
    });
  });

  describe('createBatch', () => {
    it('creates multiple todos', () => {
      const todos = repo.createBatch([
        { conversationId, turnId, title: 'Step 1' },
        { conversationId, turnId, title: 'Step 2' },
        { conversationId, turnId, title: 'Step 3' },
      ]);

      expect(todos).toHaveLength(3);
      expect(todos[0].title).toBe('Step 1');
      expect(todos[1].title).toBe('Step 2');
      expect(todos[2].title).toBe('Step 3');
      // Each has a unique ID
      const ids = new Set(todos.map(t => t.id));
      expect(ids.size).toBe(3);
    });
  });

  describe('findByTurn', () => {
    beforeEach(() => {
      repo.create({ conversationId, turnId, title: 'Pending 1', priority: 1 });
      repo.create({ conversationId, turnId, title: 'Pending 2', priority: 0 });
      const todo = repo.create({ conversationId, turnId, title: 'Completed 1', priority: 2 });
      repo.update(todo.id, { status: 'completed', completedAt: new Date().toISOString() });
    });

    it('returns all todos for a turn when no status filter', () => {
      const todos = repo.findByTurn(turnId);
      expect(todos).toHaveLength(3);
    });

    it('returns todos ordered by priority then createdAt', () => {
      const todos = repo.findByTurn(turnId);
      expect(todos[0].title).toBe('Pending 2'); // priority 0
      expect(todos[1].title).toBe('Pending 1'); // priority 1
      expect(todos[2].title).toBe('Completed 1'); // priority 2
    });

    it('filters by single status', () => {
      const pending = repo.findByTurn(turnId, 'pending');
      expect(pending).toHaveLength(2);

      const completed = repo.findByTurn(turnId, 'completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].title).toBe('Completed 1');
    });

    it('filters by multiple statuses', () => {
      const active = repo.findByTurn(turnId, ['pending', 'in_progress']);
      expect(active).toHaveLength(2);
    });

    it('returns empty for unknown turn', () => {
      const todos = repo.findByTurn('unknown-turn');
      expect(todos).toHaveLength(0);
    });
  });

  describe('findById', () => {
    it('returns todo by ID', () => {
      const created = repo.create({ conversationId, turnId, title: 'Find me' });
      const found = repo.findById(created.id);
      expect(found).toBeDefined();
      expect(found!.title).toBe('Find me');
    });

    it('returns undefined for unknown ID', () => {
      expect(repo.findById('nonexistent')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates status and outcome', () => {
      const todo = repo.create({ conversationId, turnId, title: 'Update me' });
      const now = new Date().toISOString();

      const updated = repo.update(todo.id, {
        status: 'completed',
        outcome: 'Done successfully',
        completedAt: now,
      });

      expect(updated).toBeDefined();
      expect(updated!.status).toBe('completed');
      expect(updated!.outcome).toBe('Done successfully');
      expect(updated!.completedAt).toBe(now);
    });

    it('returns undefined for nonexistent ID', () => {
      expect(repo.update('nonexistent', { status: 'completed' })).toBeUndefined();
    });

    it('returns unchanged todo when no updates provided', () => {
      const todo = repo.create({ conversationId, turnId, title: 'No change' });
      const result = repo.update(todo.id, {});
      expect(result).toBeDefined();
      expect(result!.title).toBe('No change');
    });
  });

  describe('countByStatus', () => {
    it('returns zero counts for empty turn', () => {
      const counts = repo.countByStatus('empty-turn');
      expect(counts).toEqual({ pending: 0, in_progress: 0, completed: 0, cancelled: 0 });
    });

    it('counts todos by status', () => {
      repo.create({ conversationId, turnId, title: 'P1' });
      repo.create({ conversationId, turnId, title: 'P2' });
      const todo3 = repo.create({ conversationId, turnId, title: 'C1' });
      repo.update(todo3.id, { status: 'completed', completedAt: new Date().toISOString() });
      const todo4 = repo.create({ conversationId, turnId, title: 'X1' });
      repo.update(todo4.id, { status: 'cancelled', completedAt: new Date().toISOString() });

      const counts = repo.countByStatus(turnId);
      expect(counts.pending).toBe(2);
      expect(counts.in_progress).toBe(0);
      expect(counts.completed).toBe(1);
      expect(counts.cancelled).toBe(1);
    });
  });
});
