/**
 * Mission TODO Create Tool
 *
 * Allows Mission Lead and Pillar Owner agents to conversationally create
 * TODO items within a mission's pillar. Accepts pillar identification by
 * slug (human-friendly) and resolves to the internal IDs.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MissionManager } from '../../missions/index.js';

export class MissionTodoCreateTool implements NativeTool {
  readonly name = 'mission_todo_create';
  readonly description = `Create a new TODO item within a mission pillar. Use this to turn conversation insights, user requests, or your own assessment into actionable work items.

The TODO will be created with status "pending" and can later be picked up for execution by a worker agent.

You must specify the mission and pillar by their slug (URL-safe identifier). If you don't know the slugs, ask the user or check the current mission context.`;

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
        description: 'A concise, actionable title for the TODO (e.g., "Profile webpack build to identify slow plugins")',
      },
      description: {
        type: 'string',
        description: 'Detailed description with acceptance criteria, context, and any constraints. Include what "done" looks like.',
      },
      priority: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low'],
        description: 'Priority level. Use "critical" for regressions/outages, "high" for blocking issues, "medium" for improvements, "low" for nice-to-haves. Defaults to "medium".',
      },
      assignedAgent: {
        type: 'string',
        description: 'Optional: the agent type to assign (e.g., "researcher", "coder", "writer", "pillar-owner"). Leave empty for unassigned.',
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
    const priority = (params.priority as string) || 'medium';
    const assignedAgent = (params.assignedAgent as string) || null;

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

    // Create the TODO
    try {
      const todo = this.missionManager.createTodo({
        pillarId: pillar.id,
        missionId: mission.id,
        title: title.trim(),
        description: description.trim(),
        status: 'pending',
        priority: priority as 'critical' | 'high' | 'medium' | 'low',
        assignedAgent,
        conversationId: null,
        outcome: null,
      });

      return {
        success: true,
        output: {
          todoId: todo.id,
          title: todo.title,
          description: todo.description,
          priority: todo.priority,
          status: todo.status,
          pillar: pillar.name,
          mission: mission.name,
          assignedAgent: todo.assignedAgent,
          message: `TODO created: "${todo.title}" in ${pillar.name} (${todo.priority} priority)`,
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
