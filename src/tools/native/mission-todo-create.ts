/**
 * Mission TODO Create Tool
 *
 * Allows Mission Lead and Pillar Owner agents to create TODO items within a
 * mission's pillar. Includes capacity enforcement (active + backlog limits).
 * Accepts pillar identification by slug and resolves to internal IDs.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MissionManager } from '../../missions/index.js';

export class MissionTodoCreateTool implements NativeTool {
  readonly name = 'mission_todo_create';
  readonly description = `Create a new TODO item within a mission pillar. Use this to turn conversation insights, user requests, or your own assessment into actionable work items.

The TODO will be created with the specified status (default: "pending"). If the active TODO limit is reached, the TODO is automatically placed in "backlog" instead.

Each TODO should have a clear justification (why this, why now) and measurable completion criteria (how to judge "done").`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      missionSlug: {
        type: 'string',
        description: 'The slug of the mission (e.g., "developer-experience")',
      },
      pillarSlug: {
        type: 'string',
        description: 'The slug of the pillar within the mission (e.g., "build-performance")',
      },
      title: {
        type: 'string',
        description: 'A concise, actionable title for the TODO (verb-first, e.g., "Profile webpack build to identify slow plugins")',
      },
      description: {
        type: 'string',
        description: 'Detailed description of what needs to be done',
      },
      justification: {
        type: 'string',
        description: 'Why this TODO, why now — link to metrics, strategy, or user request',
      },
      completionCriteria: {
        type: 'string',
        description: 'Measurable definition of "done" — how to judge if this TODO is complete',
      },
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Priority level. Use "critical" for regressions/outages, "high" for blocking issues, "medium" for improvements, "low" for nice-to-haves. Defaults to "medium".',
      },
      targetStatus: {
        type: 'string',
        enum: ['pending', 'backlog'],
        description: 'Desired initial status. Defaults to "pending". If active limit is reached, will be created as "backlog" instead.',
      },
    },
    required: ['missionSlug', 'pillarSlug', 'title'],
  };

  private missionManager: MissionManager;

  constructor(missionManager: MissionManager) {
    this.missionManager = missionManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const missionSlug = params.missionSlug as string;
    const pillarSlug = params.pillarSlug as string;
    const title = params.title as string;
    const description = (params.description as string) || '';
    const justification = (params.justification as string) || '';
    const completionCriteria = (params.completionCriteria as string) || '';
    const priority = (params.priority as string) || 'medium';
    const targetStatus = (params.targetStatus as string) || 'pending';

    // Validate required fields
    if (!missionSlug?.trim()) {
      return { success: false, error: 'missionSlug is required' };
    }
    if (!pillarSlug?.trim()) {
      return { success: false, error: 'pillarSlug is required' };
    }
    if (!title?.trim()) {
      return { success: false, error: 'title is required' };
    }

    // Validate priority
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    if (!validPriorities.includes(priority)) {
      return { success: false, error: `Invalid priority "${priority}". Must be one of: ${validPriorities.join(', ')}` };
    }

    // Validate targetStatus
    if (targetStatus !== 'pending' && targetStatus !== 'backlog') {
      return { success: false, error: `Invalid targetStatus "${targetStatus}". Must be "pending" or "backlog".` };
    }

    // Resolve mission
    const mission = this.missionManager.getMissionBySlug(missionSlug);
    if (!mission) {
      return { success: false, error: `Mission not found: "${missionSlug}"` };
    }

    // Resolve pillar
    const pillar = this.missionManager.getPillarBySlug(mission.id, pillarSlug);
    if (!pillar) {
      const pillars = this.missionManager.getPillarsByMission(mission.id);
      const available = pillars.map(p => p.slug).join(', ');
      return {
        success: false,
        error: `Pillar "${pillarSlug}" not found in mission "${missionSlug}". Available pillars: ${available || 'none'}`,
      };
    }

    // Capacity enforcement (limits are per-pillar)
    const limits = this.missionManager.getTodoLimits(mission.id);
    let finalStatus = targetStatus;
    let capacityWarning = '';

    if (targetStatus === 'pending') {
      const activeCount = this.missionManager.getActiveTodoCount(pillar.id);
      if (activeCount >= limits.activeTodoLimit) {
        // Overflow to backlog
        finalStatus = 'backlog';
        capacityWarning = ` (Active TODO limit of ${limits.activeTodoLimit} per pillar reached — created in backlog instead)`;
      }
    }

    if (finalStatus === 'backlog') {
      const backlogCount = this.missionManager.getBacklogTodoCount(pillar.id);
      if (backlogCount >= limits.backlogTodoLimit) {
        const activeCount = this.missionManager.getActiveTodoCount(pillar.id);
        return {
          success: false,
          error: `Backlog limit (${limits.backlogTodoLimit}) per pillar reached. Cancel or complete existing TODOs first. Active: ${activeCount}/${limits.activeTodoLimit}, Backlog: ${backlogCount}/${limits.backlogTodoLimit}`,
        };
      }
    }

    // Create the TODO
    try {
      const todo = this.missionManager.createTodo({
        pillarId: pillar.id,
        missionId: mission.id,
        title: title.trim(),
        description: description.trim(),
        justification: justification.trim(),
        completionCriteria: completionCriteria.trim(),
        status: finalStatus as 'pending' | 'backlog',
        priority: priority as 'critical' | 'high' | 'medium' | 'low',
        outcome: null,
      });

      return {
        success: true,
        output: {
          todoId: todo.id,
          title: todo.title,
          description: todo.description,
          justification: todo.justification,
          completionCriteria: todo.completionCriteria,
          priority: todo.priority,
          status: todo.status,
          pillar: pillar.name,
          mission: mission.name,
          message: `TODO created: "${todo.title}" in ${pillar.name} (${todo.priority} priority, status: ${todo.status})${capacityWarning}`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create TODO: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
