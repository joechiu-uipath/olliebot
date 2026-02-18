/**
 * Turn TODO Types
 *
 * Per-turn TODO items used by the supervisor agent for task planning and execution.
 * Scoped to a single turn — not reused across turns.
 */

export type TurnTodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface TurnTodo {
  id: string;
  conversationId: string;
  turnId: string;
  title: string;
  context: string;
  completionCriteria: string;
  agentType: string | null;
  status: TurnTodoStatus;
  priority: number;
  outcome: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface TurnTodoCreate {
  conversationId: string;
  turnId: string;
  title: string;
  context?: string;
  completionCriteria?: string;
  agentType?: string;
  priority?: number;
}

export interface TurnTodoStatusCounts {
  pending: number;
  in_progress: number;
  completed: number;
  cancelled: number;
}
