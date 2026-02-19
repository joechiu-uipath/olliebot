/**
 * Mission Metric Record Tool
 *
 * Allows agents to record a metric reading for a mission pillar's metric.
 * Metrics are referenced by their GUID ID (not slugs — only missions and
 * pillars have slugs). Normalizes values (durations to seconds, rounding),
 * computes status and trend, and persists to both current value and history.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { MissionManager } from '../../missions/index.js';
import { validateRequired, validateNumber } from './mission-validation.js';

export class MissionMetricRecordTool implements NativeTool {
  readonly name = 'mission_metric_record';
  readonly description = `Record a metric measurement for a mission pillar. The value is automatically normalized (durations converted to seconds), rounded, and persisted. Status (on_target/warning/off_target) and trend (improving/stable/degrading) are computed from the target definition and recent history.

Use this after collecting a metric value via the appropriate tool. Pass the raw value as collected — normalization is handled automatically. Reference the metric by its ID (GUID).`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      metricId: {
        type: 'string',
        description: 'The ID (GUID) of the metric to record a value for',
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
    required: ['metricId', 'value'],
  };

  readonly private = true;
  private missionManager: MissionManager;

  constructor(missionManager: MissionManager) {
    this.missionManager = missionManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const metricId = params.metricId as string;
    const value = params.value as number;
    const note = (params.note as string) || undefined;

    // Validate required fields using shared validation
    let error = validateRequired(metricId, 'metricId');
    if (error) return error;
    
    error = validateNumber(value, 'value');
    if (error) return error;

    // Resolve metric by ID
    const metric = this.missionManager.getMetricById(metricId);
    if (!metric) {
      return { success: false, error: `Metric not found: "${metricId}"` };
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
          metricName: metric.name,
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
