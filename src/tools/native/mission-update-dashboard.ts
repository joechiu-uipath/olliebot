/**
 * Mission Update Dashboard Tool
 *
 * Allows agents to update a dashboard's spec and trigger re-rendering.
 * Finds or creates a dashboard snapshot for a mission, then renders it
 * with the provided spec.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MissionManager } from '../../missions/index.js';
import type { DashboardStore } from '../../dashboard/dashboard-store.js';
import type { RenderEngine } from '../../dashboard/render-engine.js';
import type { SnapshotEngine } from '../../dashboard/snapshot-engine.js';
import { validateRequired } from './mission-validation.js';

export interface MissionUpdateDashboardDeps {
  missionManager: MissionManager;
  dashboardStore: DashboardStore;
  renderEngine: RenderEngine;
  snapshotEngine: SnapshotEngine;
}

export class MissionUpdateDashboardTool implements NativeTool {
  readonly name = 'mission_update_dashboard';
  readonly description = `Update a mission dashboard's specification and re-render it. Creates or updates a dashboard snapshot for the specified mission, then renders it with the new spec using an LLM.

Use this when you want to customize how a mission dashboard displays data — change chart types, add/remove sections, adjust layout, or modify the visual presentation. The spec is a natural-language description of the desired dashboard layout and content.

After successful execution, the user can click the Refresh button in the Dashboard section to see the new version.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      missionSlug: {
        type: 'string',
        description: 'The slug of the mission (e.g., "developer-experience")',
      },
      pillarSlug: {
        type: 'string',
        description: 'Optional: filter to dashboards for a specific pillar within the mission',
      },
      spec: {
        type: 'string',
        description: 'The new dashboard specification — a natural-language description of charts, tables, KPIs, and layout. Example: "KPI row with trace count and error rate, bar chart of tool usage, timeline of recent activity"',
      },
    },
    required: ['missionSlug', 'spec'],
  };

  private missionManager: MissionManager;
  private dashboardStore: DashboardStore;
  private renderEngine: RenderEngine;
  private snapshotEngine: SnapshotEngine;

  constructor(deps: MissionUpdateDashboardDeps) {
    this.missionManager = deps.missionManager;
    this.dashboardStore = deps.dashboardStore;
    this.renderEngine = deps.renderEngine;
    this.snapshotEngine = deps.snapshotEngine;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const missionSlug = params.missionSlug as string;
    const pillarSlug = params.pillarSlug as string | undefined;
    const spec = params.spec as string;

    // Validate required fields using shared validation
    let error = validateRequired(missionSlug, 'missionSlug');
    if (error) return error;
    
    error = validateRequired(spec, 'spec');
    if (error) return error;

    // Resolve mission
    const mission = this.missionManager.getMissionBySlug(missionSlug);
    if (!mission) {
      return { success: false, error: `Mission not found: "${missionSlug}"` };
    }

    // Optionally resolve pillar
    let pillar = undefined;
    let targetConversationId = mission.conversationId;
    if (pillarSlug) {
      pillar = this.missionManager.getPillarBySlug(mission.id, pillarSlug);
      if (!pillar) {
        const pillars = this.missionManager.getPillarsByMission(mission.id);
        const available = pillars.map(p => p.slug).join(', ');
        return {
          success: false,
          error: `Pillar "${pillarSlug}" not found in mission "${missionSlug}". Available pillars: ${available || 'none'}`,
        };
      }
      targetConversationId = pillar.conversationId;
    }

    // Try to find an existing dashboard snapshot
    // Strategy: try missionId first, then conversationId
    let snapshots = this.dashboardStore.getSnapshots({
      missionId: mission.id,
      limit: 1,
    });

    if (snapshots.length === 0) {
      // Try by conversationId
      snapshots = this.dashboardStore.getSnapshots({
        conversationId: targetConversationId,
        limit: 1,
      });
    }

    let snapshotId: string;

    if (snapshots.length === 0) {
      // No existing snapshot — create a new one
      console.log(`[MissionUpdateDashboard] No existing snapshot found for mission "${mission.name}", creating new one`);

      // Capture metrics from the mission's conversation
      const metricsJson = JSON.stringify(this.snapshotEngine.captureMissionReport(targetConversationId));

      // Create snapshot
      snapshotId = this.dashboardStore.createSnapshot({
        title: pillar ? `${pillar.name} Dashboard` : `${mission.name} Dashboard`,
        snapshotType: 'mission_report',
        specText: spec.trim(),
        metricsJson,
        conversationId: targetConversationId,
        missionId: mission.id,
      });

      console.log(`[MissionUpdateDashboard] Created snapshot ${snapshotId}`);

      // Render the new snapshot
      try {
        await this.renderEngine.render(snapshotId);
        const newSnapshot = this.dashboardStore.getSnapshotById(snapshotId);

        return {
          success: true,
          output: {
            snapshotId,
            version: newSnapshot?.version || 1,
            lineageId: newSnapshot?.lineageId,
            missionId: mission.id,
            missionName: mission.name,
            pillarName: pillar?.name,
            status: newSnapshot?.status,
            renderModel: newSnapshot?.renderModel,
            renderDurationMs: newSnapshot?.renderDurationMs,
            created: true,
            message: `Dashboard created and rendered for "${mission.name}"${pillar ? ` (${pillar.name})` : ''}. Click the Refresh button in the Dashboard section to see it.`,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to render new dashboard: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    // Existing snapshot found — re-render with new spec
    const latestSnapshot = snapshots[0];
    console.log(`[MissionUpdateDashboard] Found existing snapshot ${latestSnapshot.id}, re-rendering with new spec`);

    try {
      const result = await this.renderEngine.rerender(latestSnapshot.id, spec.trim());
      const newSnapshot = this.dashboardStore.getSnapshotById(result.snapshotId);

      return {
        success: true,
        output: {
          snapshotId: result.snapshotId,
          version: newSnapshot?.version || 1,
          lineageId: newSnapshot?.lineageId,
          missionId: mission.id,
          missionName: mission.name,
          pillarName: pillar?.name,
          status: newSnapshot?.status,
          renderModel: newSnapshot?.renderModel,
          renderDurationMs: newSnapshot?.renderDurationMs,
          created: false,
          message: `Dashboard updated for "${mission.name}"${pillar ? ` (${pillar.name})` : ''}. Version ${newSnapshot?.version || 1} created and rendered. Click the Refresh button in the Dashboard section to see the new version.`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to re-render dashboard: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
