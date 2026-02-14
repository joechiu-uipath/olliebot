/**
 * Mission Metric Record Tool
 *
 * Allows agents to record a metric reading for a mission pillar's metric.
 * Normalizes values (durations to seconds, rounding), computes status
 * (on_target/warning/off_target) and trend (improving/stable/degrading),
 * and persists to both current value and history.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MissionManager } from '../../missions/index.js';

export class MissionMetricRecordTool implements NativeTool {
  readonly name = 'mission_metric_record';
  readonly description = `Record a metric measurement for a mission pillar. The value is automatically normalized (durations converted to seconds), rounded, and persisted. Status (on_target/warning/off_target) and trend (improving/stable/degrading) are computed from the target definition and recent history.

Use this after collecting a metric value via the appropriate tool. Pass the raw value as collected — normalization is handled automatically.`;

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
      metricSlug: {
        type: 'string',
        description: 'The slug of the metric within the pillar (e.g., "local-build-time")',
      },
      value: {
        type: 'number',
        description: 'The collected metric value (raw — normalization is handled automatically)',
      },
      note: {
        type: 'string',
        description: 'Optional context for this reading (e.g., "collected after webpack 5.9 upgrade")',
      },
    },
    required: ['missionSlug', 'pillarSlug', 'metricSlug', 'value'],
  };

  private missionManager: MissionManager;

  constructor(missionManager: MissionManager) {
    this.missionManager = missionManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const missionSlug = params.missionSlug as string;
    const pillarSlug = params.pillarSlug as string;
    const metricSlug = params.metricSlug as string;
    const value = params.value as number;
    const note = (params.note as string) || undefined;

    // Validate required fields
    if (!missionSlug?.trim()) {
      return { success: false, error: 'missionSlug is required' };
    }
    if (!pillarSlug?.trim()) {
      return { success: false, error: 'pillarSlug is required' };
    }
    if (!metricSlug?.trim()) {
      return { success: false, error: 'metricSlug is required' };
    }
    if (typeof value !== 'number' || isNaN(value)) {
      return { success: false, error: 'value must be a valid number' };
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

    // Resolve metric
    const metric = this.missionManager.getMetricBySlug(pillar.id, metricSlug);
    if (!metric) {
      const metrics = this.missionManager.getMetricsByPillar(pillar.id);
      const available = metrics.map(m => m.slug).join(', ');
      return {
        success: false,
        error: `Metric "${metricSlug}" not found in pillar "${pillarSlug}". Available metrics: ${available || 'none'}`,
      };
    }

    // Record the metric (normalization, status/trend computation happens inside)
    try {
      const result = this.missionManager.recordMetric(metric.id, value, note);

      // Parse target for display
      let targetDisplay = '';
      try {
        const target = JSON.parse(metric.target);
        if (target.operator && target.value !== undefined) {
          targetDisplay = `${target.operator} ${target.value}`;
          if (metric.unit) targetDisplay += metric.unit === '%' ? '%' : ` ${metric.unit}`;
        }
      } catch { /* no target */ }

      const valueDisplay = metric.type === 'duration'
        ? `${result.normalizedValue}s`
        : metric.unit === '%'
          ? `${result.normalizedValue}%`
          : `${result.normalizedValue}${metric.unit ? ' ' + metric.unit : ''}`;

      return {
        success: true,
        output: {
          metricId: metric.id,
          metricSlug: metric.slug,
          metricName: metric.name,
          pillar: pillar.name,
          mission: mission.name,
          value: result.normalizedValue,
          status: result.status,
          trend: result.trend,
          target: targetDisplay,
          message: `Recorded ${metric.name}: ${valueDisplay} (target: ${targetDisplay || 'none'}) — status: ${result.status}, trend: ${result.trend}`,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to record metric: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
