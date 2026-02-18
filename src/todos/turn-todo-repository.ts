/**
 * Turn TODO Repository
 *
 * Data access layer for per-turn TODO items. Uses the shared SQLite
 * database instance from src/db/index.ts.
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import type { TurnTodo, TurnTodoCreate, TurnTodoStatus, TurnTodoStatusCounts } from './types.js';

interface TurnTodoRow {
  id: string;
  conversationId: string;
  turnId: string;
  title: string;
  context: string;
  completionCriteria: string;
  agentType: string | null;
  status: string;
  priority: number;
  outcome: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function rowToTurnTodo(row: TurnTodoRow): TurnTodo {
  return {
    id: row.id,
    conversationId: row.conversationId,
    turnId: row.turnId,
    title: row.title,
    context: row.context,
    completionCriteria: row.completionCriteria,
    agentType: row.agentType,
    status: row.status as TurnTodoStatus,
    priority: row.priority,
    outcome: row.outcome,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export class TurnTodoRepository {
  create(input: TurnTodoCreate): TurnTodo {
    const db = getDb();
    const todo: TurnTodo = {
      id: uuid(),
      conversationId: input.conversationId,
      turnId: input.turnId,
      title: input.title,
      context: input.context ?? '',
      completionCriteria: input.completionCriteria ?? '',
      agentType: input.agentType ?? null,
      status: 'pending',
      priority: input.priority ?? 0,
      outcome: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
    };

    db.rawRun(
      `INSERT INTO turn_todos (id, conversationId, turnId, title, context, completionCriteria, agentType, status, priority, outcome, createdAt, startedAt, completedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [todo.id, todo.conversationId, todo.turnId, todo.title, todo.context, todo.completionCriteria, todo.agentType, todo.status, todo.priority, todo.outcome, todo.createdAt, todo.startedAt, todo.completedAt]
    );

    return todo;
  }

  createBatch(inputs: TurnTodoCreate[]): TurnTodo[] {
    return inputs.map(input => this.create(input));
  }

  findByTurn(turnId: string, status?: TurnTodoStatus | TurnTodoStatus[]): TurnTodo[] {
    const db = getDb();

    if (!status) {
      const rows = db.rawQuery(
        'SELECT * FROM turn_todos WHERE turnId = ? ORDER BY priority ASC, createdAt ASC',
        [turnId]
      ) as TurnTodoRow[];
      return rows.map(rowToTurnTodo);
    }

    const statuses = Array.isArray(status) ? status : [status];
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = db.rawQuery(
      `SELECT * FROM turn_todos WHERE turnId = ? AND status IN (${placeholders}) ORDER BY priority ASC, createdAt ASC`,
      [turnId, ...statuses]
    ) as TurnTodoRow[];
    return rows.map(rowToTurnTodo);
  }

  findById(id: string): TurnTodo | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM turn_todos WHERE id = ?', [id]) as TurnTodoRow[];
    return rows.length > 0 ? rowToTurnTodo(rows[0]) : undefined;
  }

  update(id: string, updates: Partial<Pick<TurnTodo, 'status' | 'outcome' | 'startedAt' | 'completedAt'>>): TurnTodo | undefined {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }

    if (setClauses.length === 0) return this.findById(id);

    values.push(id);
    db.rawRun(`UPDATE turn_todos SET ${setClauses.join(', ')} WHERE id = ?`, values);
    return this.findById(id);
  }

  countByStatus(turnId: string): TurnTodoStatusCounts {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT status, COUNT(*) as cnt FROM turn_todos WHERE turnId = ? GROUP BY status',
      [turnId]
    ) as Array<{ status: string; cnt: number }>;

    const counts: TurnTodoStatusCounts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
    for (const row of rows) {
      if (row.status in counts) {
        counts[row.status as keyof TurnTodoStatusCounts] = row.cnt;
      }
    }
    return counts;
  }
}
