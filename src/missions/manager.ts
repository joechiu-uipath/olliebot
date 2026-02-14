/**
 * Mission Manager - Loads and manages continuous missions from .md files
 *
 * Watches the /user/missions/ directory for .md files, parses them into
 * schematized .json runtime configs, and manages mission lifecycle.
 * Follows the same ConfigWatcher pattern as TaskManager.
 */

import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import { CronExpressionParser } from 'cron-parser';
import { ConfigWatcher, type ConfigFile } from '../config/watcher.js';
import { getDb } from '../db/index.js';
import type { LLMService } from '../llm/service.js';
import type {
  Mission,
  MissionRow,
  Pillar,
  PillarRow,
  PillarMetric,
  PillarMetricRow,
  PillarStrategy,
  PillarStrategyRow,
  MissionTodo,
  MissionTodoRow,
  PillarMetricHistory,
  PillarMetricHistoryRow,
  MetricTarget,
  MetricStatus,
  MetricTrend,
} from './types.js';
import {
  DEFAULT_ACTIVE_TODO_LIMIT,
  DEFAULT_BACKLOG_TODO_LIMIT,
  DEFAULT_METRIC_HISTORY_LIMIT,
  TREND_HISTORY_COUNT,
  TREND_MIN_READINGS,
  TREND_STABILITY_THRESHOLD,
  METRIC_PRECISION,
  metricConversationId,
  pillarTodoConversationId,
} from './constants.js';

export interface MissionManagerConfig {
  missionsDir: string;
  llmService: LLMService;
  schedulerInterval?: number;
}

export class MissionManager extends EventEmitter {
  private configWatcher: ConfigWatcher;
  private llmService: LLMService;
  private missionsDir: string;
  private schedulerInterval: number;
  private schedulerTimer: NodeJS.Timeout | null = null;

  constructor(config: MissionManagerConfig) {
    super();
    this.missionsDir = config.missionsDir;
    this.llmService = config.llmService;
    this.schedulerInterval = config.schedulerInterval ?? 60000; // Check every minute
    this.configWatcher = new ConfigWatcher(config.missionsDir);
  }

  async init(): Promise<void> {
    await this.configWatcher.init();

    this.configWatcher.on('config:added', (config: ConfigFile) => {
      this.loadMission(config);
    });

    this.configWatcher.on('config:changed', (config: ConfigFile) => {
      this.loadMission(config);
    });

    this.configWatcher.on('config:removed', (filePath: string) => {
      this.handleConfigRemoved(filePath);
    });

    this.configWatcher.on('config:error', (error: Error) => {
      console.error(`[MissionManager] ConfigWatcher error:`, error);
    });

    // Load existing configs
    const configs = this.configWatcher.getConfigs();
    for (const [, config] of configs) {
      await this.loadMission(config);
    }

    console.log(`[MissionManager] Initialized with ${configs.size} missions from ${this.missionsDir}`);
  }

  startScheduler(): void {
    if (this.schedulerTimer) return;
    console.log(`[MissionManager] Starting scheduler (interval: ${this.schedulerInterval}ms)`);
    this.schedulerTimer = setInterval(() => {
      this.checkDueCycles();
    }, this.schedulerInterval);
  }

  private stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private checkDueCycles(): void {
    const db = getDb();
    const now = new Date();
    const missions = db.rawQuery(
      'SELECT * FROM missions WHERE status = ? AND nextCycleAt IS NOT NULL',
      ['active']
    ) as MissionRow[];

    for (const row of missions) {
      if (row.nextCycleAt) {
        const nextDate = new Date(row.nextCycleAt);
        if (nextDate <= now) {
          console.log(`[MissionManager] Mission "${row.name}" cycle is due`);
          this.emit('mission:cycle:due', { mission: this.deserializeMission(row) });
        }
      }
    }
  }

  markCycleExecuted(missionId: string): void {
    const db = getDb();
    const row = db.rawQuery('SELECT * FROM missions WHERE id = ?', [missionId]) as MissionRow[];
    if (!row[0]) return;

    const now = new Date().toISOString();
    const nextCycleAt = this.calculateNextCycle(row[0].cadence);

    db.rawRun(
      'UPDATE missions SET lastCycleAt = ?, nextCycleAt = ?, updatedAt = ? WHERE id = ?',
      [now, nextCycleAt, now, missionId]
    );

    this.emit('mission:updated', { missionSlug: row[0].slug, field: 'cycle', value: { lastCycleAt: now, nextCycleAt } });
  }

  // ========================================================================
  // Mission CRUD
  // ========================================================================

  /**
   * Get all missions, ordered by most recently updated.
   * @returns Array of all missions
   */
  getMissions(): Mission[] {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM missions ORDER BY updatedAt DESC') as MissionRow[];
    return rows.map(r => this.deserializeMission(r));
  }

  /**
   * Get a mission by its slug.
   * @param slug - Mission slug (unique identifier)
   * @returns Mission if found, undefined otherwise
   */
  getMissionBySlug(slug: string): Mission | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM missions WHERE slug = ?', [slug]) as MissionRow[];
    return rows[0] ? this.deserializeMission(rows[0]) : undefined;
  }

  private static MISSION_UPDATABLE_FIELDS = new Set(['name', 'description', 'status', 'cadence', 'jsonConfig']);

  /**
   * Update mission fields (name, description, status, cadence, or jsonConfig).
   * @param slug - Mission slug
   * @param updates - Partial mission updates (only whitelisted fields are applied)
   * @returns Updated mission if successful, undefined if mission not found
   */
  updateMission(slug: string, updates: Partial<Pick<Mission, 'name' | 'description' | 'status' | 'cadence' | 'jsonConfig'>>): Mission | undefined {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!MissionManager.MISSION_UPDATABLE_FIELDS.has(key)) continue;
      setClauses.push(`${key} = ?`);
      values.push(key === 'jsonConfig' && typeof value === 'object' ? JSON.stringify(value) : value);
    }

    if (setClauses.length > 0) {
      setClauses.push('updatedAt = ?');
      values.push(new Date().toISOString());
      values.push(slug);
      db.rawRun(`UPDATE missions SET ${setClauses.join(', ')} WHERE slug = ?`, values);
    }

    return this.getMissionBySlug(slug);
  }

  // ========================================================================
  // Pillar CRUD
  // ========================================================================

  /**
   * Get all pillars for a mission, ordered by creation date.
   * @param missionId - Mission GUID
   * @returns Array of pillars belonging to the mission
   */
  getPillarsByMission(missionId: string): Pillar[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillars WHERE missionId = ? ORDER BY createdAt ASC',
      [missionId]
    ) as PillarRow[];
    return rows.map(r => this.deserializePillar(r));
  }

  /**
   * Get a pillar by its slug within a mission.
   * @param missionId - Mission GUID
   * @param pillarSlug - Pillar slug (unique within mission)
   * @returns Pillar if found, undefined otherwise
   */
  getPillarBySlug(missionId: string, pillarSlug: string): Pillar | undefined {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillars WHERE missionId = ? AND slug = ?',
      [missionId, pillarSlug]
    ) as PillarRow[];
    return rows[0] ? this.deserializePillar(rows[0]) : undefined;
  }

  /**
   * Get a pillar by its ID.
   * @param pillarId - Pillar GUID
   * @returns Pillar if found, undefined otherwise
   */
  getPillarById(pillarId: string): Pillar | undefined {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillars WHERE id = ?',
      [pillarId]
    ) as PillarRow[];
    return rows[0] ? this.deserializePillar(rows[0]) : undefined;
  }

  // ========================================================================
  // Metrics CRUD
  // ========================================================================

  /**
   * Get all metrics for a pillar, ordered by name.
   * @param pillarId - Pillar GUID
   * @returns Array of metrics belonging to the pillar
   */
  getMetricsByPillar(pillarId: string): PillarMetric[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillar_metrics WHERE pillarId = ? ORDER BY name ASC',
      [pillarId]
    ) as PillarMetricRow[];
    return rows.map(r => this.deserializeMetric(r));
  }

  /**
   * Get a metric by its slug within a pillar.
   * @param pillarId - Pillar GUID
   * @param metricSlug - Metric slug (unique within pillar)
   * @returns Metric if found, undefined otherwise
   */
  getMetricBySlug(pillarId: string, metricSlug: string): PillarMetric | undefined {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillar_metrics WHERE pillarId = ? AND slug = ?',
      [pillarId, metricSlug]
    ) as PillarMetricRow[];
    return rows[0] ? this.deserializeMetric(rows[0]) : undefined;
  }

  /**
   * Get a metric by its ID.
   * @param metricId - Metric GUID
   * @returns Metric if found, undefined otherwise
   */
  getMetricById(metricId: string): PillarMetric | undefined {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillar_metrics WHERE id = ?',
      [metricId]
    ) as PillarMetricRow[];
    return rows[0] ? this.deserializeMetric(rows[0]) : undefined;
  }

  /**
   * Get metric history (time-series readings).
   * @param metricId - Metric GUID
   * @param limit - Maximum number of history points to return (default: 30)
   * @returns Array of history points, oldest first
   */
  getMetricHistory(metricId: string, limit = DEFAULT_METRIC_HISTORY_LIMIT): PillarMetricHistory[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillar_metric_history WHERE metricId = ? ORDER BY timestamp DESC LIMIT ?',
      [metricId, limit]
    ) as PillarMetricHistoryRow[];
    return rows.reverse().map(r => ({
      ...r,
      value: typeof r.value === 'string' ? parseFloat(r.value) : r.value,
      note: r.note || null,
    }));
  }

  /**
   * Get a comprehensive pillar summary with all related data.
   * Consolidates metrics, strategies, todos, and statistics.
   * Used by API routes and agents to avoid duplicating this query pattern.
   * @param pillarId - Pillar GUID
   * @returns Object containing metrics, strategies, todos, and todo counts by status
   */
  getPillarSummary(pillarId: string) {
    const metrics = this.getMetricsByPillar(pillarId);
    const strategies = this.getStrategiesByPillar(pillarId);
    const todos = this.getTodosByPillar(pillarId);
    
    const todosByStatus = {
      backlog: todos.filter(t => t.status === 'backlog').length,
      pending: todos.filter(t => t.status === 'pending').length,
      in_progress: todos.filter(t => t.status === 'in_progress').length,
      completed: todos.filter(t => t.status === 'completed').length,
      cancelled: todos.filter(t => t.status === 'cancelled').length,
    };

    return {
      metrics,
      strategies,
      todos,
      todosByStatus,
    };
  }

  /**
   * Record a new metric value. Normalizes durations to seconds, rounds values,
   * computes status and trend, and persists to both current and history.
   * @param metricId - Metric GUID
   * @param rawValue - Raw metric value (will be normalized)
   * @param note - Optional context note for this reading
   * @returns Object containing computed status, trend, and normalized value
   * @throws Error if metric not found
   */
  recordMetric(metricId: string, rawValue: number, note?: string): {
    status: MetricStatus;
    trend: MetricTrend;
    normalizedValue: number;
  } {
    const db = getDb();
    const metric = this.getMetricById(metricId);
    if (!metric) throw new Error(`Metric not found: ${metricId}`);

    const now = new Date().toISOString();

    // Normalize value (duration → seconds, round to 2 decimal places)
    const normalizedValue = this.normalizeMetricValue(rawValue, metric.type, metric.unit);

    // Persist to history
    db.rawRun(
      'INSERT INTO pillar_metric_history (id, metricId, value, note, timestamp) VALUES (?, ?, ?, ?, ?)',
      [uuid(), metricId, normalizedValue, note || null, now]
    );

    // Compute status from target (normalize target to same units as stored value)
    let target: MetricTarget | null = null;
    try { target = JSON.parse(metric.target) as MetricTarget; } catch { /* invalid JSON */ }
    const status = this.computeStatus(normalizedValue, target, metric.type, metric.unit);

    // Compute trend from recent readings
    const history = this.getMetricHistory(metricId, TREND_HISTORY_COUNT);
    const trend = this.computeTrend(history, target?.desiredDirection);

    // Update current value, status, trend, lastCollectedAt
    db.rawRun(
      'UPDATE pillar_metrics SET current = ?, status = ?, trend = ?, lastCollectedAt = ?, updatedAt = ? WHERE id = ?',
      [normalizedValue, status, trend, now, now, metricId]
    );

    this.emit('metric:recorded', {
      metricId,
      value: normalizedValue,
      status,
      trend,
    });

    return { status, trend, normalizedValue };
  }

  /**
   * Normalize a metric value: convert durations to seconds, round to 2 decimal places.
   */
  private normalizeMetricValue(value: number, type: string, unit: string): number {
    let normalized = value;

    if (type === 'duration') {
      const u = unit.toLowerCase().trim();
      if (u === 'ms') normalized = value / 1000;
      else if (u === 'min' || u === 'minutes') normalized = value * 60;
      else if (u === 'hours' || u === 'h') normalized = value * 3600;
      else if (u === 'days' || u === 'd') normalized = value * 86400;
      // 's', 'sec', 'seconds' → already in seconds
    }

    const factor = 10 ** METRIC_PRECISION;
    return Math.round(normalized * factor) / factor;
  }

  /**
   * Compute metric status from current value and target.
   * For duration metrics, target values are normalized to seconds to match stored values.
   */
  computeStatus(current: number, target: MetricTarget | null, metricType?: string, metricUnit?: string): MetricStatus {
    if (!target || target.value === undefined) return 'unknown';

    // Normalize target value to match stored units (duration metrics stored in seconds)
    const normalizedTargetValue = metricType === 'duration'
      ? this.normalizeMetricValue(target.value, metricType, metricUnit || '')
      : target.value;

    const onTarget = this.evaluateTarget(current, target.operator, normalizedTargetValue);
    if (onTarget) return 'on_target';

    // Check warning threshold (also normalize if duration)
    if (target.warningThreshold !== undefined) {
      const normalizedWarning = metricType === 'duration'
        ? this.normalizeMetricValue(target.warningThreshold, metricType, metricUnit || '')
        : target.warningThreshold;
      const betterThanWarning = this.evaluateTarget(current, target.operator, normalizedWarning);
      if (betterThanWarning) return 'warning';
    }

    return 'off_target';
  }

  private evaluateTarget(current: number, operator: string, targetValue: number): boolean {
    switch (operator) {
      case '<': return current < targetValue;
      case '<=': return current <= targetValue;
      case '>': return current > targetValue;
      case '>=': return current >= targetValue;
      case '=': return current === targetValue;
      case '!=': return current !== targetValue;
      default: return false;
    }
  }

  /**
   * Compute trend from the last N readings (N=10).
   * Uses simple linear regression slope direction.
   */
  computeTrend(history: PillarMetricHistory[], desiredDirection?: string): MetricTrend {
    if (history.length < TREND_MIN_READINGS) return 'unknown';

    // Compare mean of first half vs second half
    const mid = Math.floor(history.length / 2);
    const firstHalf = history.slice(0, mid);
    const secondHalf = history.slice(mid);

    const firstMean = firstHalf.reduce((sum, h) => sum + h.value, 0) / firstHalf.length;
    const secondMean = secondHalf.reduce((sum, h) => sum + h.value, 0) / secondHalf.length;

    const delta = secondMean - firstMean;
    const threshold = Math.abs(firstMean) * TREND_STABILITY_THRESHOLD;

    if (Math.abs(delta) <= threshold) return 'stable';

    const isIncreasing = delta > 0;

    // Map direction to improving/degrading based on desired direction
    if (desiredDirection === 'up') return isIncreasing ? 'improving' : 'degrading';
    if (desiredDirection === 'down') return isIncreasing ? 'degrading' : 'improving';

    // Default: increasing = improving (most metrics want to go up)
    return isIncreasing ? 'improving' : 'degrading';
  }

  private deserializeMetric(row: PillarMetricRow): PillarMetric {
    // Parse target from JSON string to object
    let target = row.target;
    if (typeof target === 'string') {
      try {
        target = JSON.parse(target);
      } catch {
        // Keep as string if parsing fails
      }
    }

    return {
      ...row,
      type: row.type as PillarMetric['type'],
      status: row.status as PillarMetric['status'],
      trend: row.trend as PillarMetric['trend'],
      target,
      current: row.current !== null && row.current !== undefined
        ? (typeof row.current === 'string' ? parseFloat(row.current) : row.current as number)
        : null,
    };
  }

  // ========================================================================
  // Strategy CRUD
  // ========================================================================

  getStrategiesByPillar(pillarId: string): PillarStrategy[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillar_strategies WHERE pillarId = ? ORDER BY createdAt ASC',
      [pillarId]
    ) as PillarStrategyRow[];
    return rows as PillarStrategy[];
  }

  // ========================================================================
  // TODO CRUD
  // ========================================================================

  /**
   * Get all TODOs for a pillar, ordered by priority then creation date.
   * @param pillarId - Pillar GUID
   * @returns Array of TODOs for the pillar
   */
  getTodosByPillar(pillarId: string): MissionTodo[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM mission_todos WHERE pillarId = ? ORDER BY CASE priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, createdAt ASC',
      [pillarId]
    ) as MissionTodoRow[];
    return rows as MissionTodo[];
  }

  /**
   * Get all TODOs for a mission, ordered by creation date (newest first).
   * @param missionId - Mission GUID
   * @returns Array of TODOs for the mission
   */
  getTodosByMission(missionId: string): MissionTodo[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM mission_todos WHERE missionId = ? ORDER BY createdAt DESC',
      [missionId]
    ) as MissionTodoRow[];
    return rows as MissionTodo[];
  }

  /**
   * Get a TODO by its ID.
   * @param todoId - TODO GUID
   * @returns TODO if found, undefined otherwise
   */
  getTodoById(todoId: string): MissionTodo | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM mission_todos WHERE id = ?', [todoId]) as MissionTodoRow[];
    return rows[0] as MissionTodo | undefined;
  }

  /**
   * Count active TODOs (pending + in_progress) for a pillar.
   * Used for capacity enforcement (limits are per-pillar).
   * @param pillarId - Pillar GUID
   * @returns Number of active TODOs
   */
  getActiveTodoCount(pillarId: string): number {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT COUNT(*) as count FROM mission_todos WHERE pillarId = ? AND status IN (?, ?)',
      [pillarId, 'pending', 'in_progress']
    ) as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  }

  /**
   * Count backlog TODOs for a pillar.
   * Used for capacity enforcement (limits are per-pillar).
   * @param pillarId - Pillar GUID
   * @returns Number of backlog TODOs
   */
  getBacklogTodoCount(pillarId: string): number {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT COUNT(*) as count FROM mission_todos WHERE pillarId = ? AND status = ?',
      [pillarId, 'backlog']
    ) as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  }

  /**
   * Get TODO capacity limits from mission config.
   * Limits are enforced per-pillar but configured at mission level.
   * @param missionId - Mission GUID
   * @returns Object with activeTodoLimit and backlogTodoLimit
   */
  getTodoLimits(missionId: string): { activeTodoLimit: number; backlogTodoLimit: number } {
    const db = getDb();
    const rows = db.rawQuery('SELECT jsonConfig FROM missions WHERE id = ?', [missionId]) as Array<{ jsonConfig: string }>;
    const defaults = { activeTodoLimit: DEFAULT_ACTIVE_TODO_LIMIT, backlogTodoLimit: DEFAULT_BACKLOG_TODO_LIMIT };
    if (!rows[0]) return defaults;

    try {
      const config = JSON.parse(rows[0].jsonConfig);
      return {
        activeTodoLimit: config.todo?.activeTodoLimit ?? DEFAULT_ACTIVE_TODO_LIMIT,
        backlogTodoLimit: config.todo?.backlogTodoLimit ?? DEFAULT_BACKLOG_TODO_LIMIT,
      };
    } catch {
      return defaults;
    }
  }

  /**
   * Create a new TODO item.
   * @param todo - TODO data (id, timestamps generated automatically)
   * @returns The created TODO with generated id and timestamps
   */
  createTodo(todo: Omit<MissionTodo, 'id' | 'createdAt' | 'startedAt' | 'completedAt'>): MissionTodo {
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();

    db.rawRun(
      'INSERT INTO mission_todos (id, pillarId, missionId, title, description, justification, completionCriteria, status, priority, outcome, createdAt, startedAt, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, todo.pillarId, todo.missionId, todo.title, todo.description, todo.justification, todo.completionCriteria, todo.status, todo.priority, todo.outcome, now, null, null]
    );

    const created = this.getTodoById(id)!;
    this.emit('todo:created', { missionId: todo.missionId, pillarId: todo.pillarId, todo: created });
    return created;
  }

  private static TODO_UPDATABLE_FIELDS = new Set(['title', 'description', 'justification', 'completionCriteria', 'status', 'priority', 'outcome', 'startedAt', 'completedAt']);

  /**
   * Update TODO fields (whitelisted fields only).
   * @param todoId - TODO GUID
   * @param updates - Partial TODO updates
   * @returns Updated TODO if successful, undefined if not found
   */
  updateTodo(todoId: string, updates: Partial<Pick<MissionTodo, 'title' | 'description' | 'justification' | 'completionCriteria' | 'status' | 'priority' | 'outcome' | 'startedAt' | 'completedAt'>>): MissionTodo | undefined {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      if (!MissionManager.TODO_UPDATABLE_FIELDS.has(key)) continue;
      setClauses.push(`${key} = ?`);
      values.push(value);
    }

    if (setClauses.length > 0) {
      values.push(todoId);
      db.rawRun(`UPDATE mission_todos SET ${setClauses.join(', ')} WHERE id = ?`, values);
    }

    const updated = this.getTodoById(todoId);
    if (updated) {
      this.emit('todo:updated', { missionId: updated.missionId, pillarId: updated.pillarId, todoId, updates });
    }
    return updated;
  }

  // ========================================================================
  // Dashboard paths
  // ========================================================================

  getMissionDashboardPath(slug: string): string {
    return `${this.missionsDir}/dashboards/${slug}/mission.html`;
  }

  getPillarDashboardPath(missionSlug: string, pillarSlug: string): string {
    return `${this.missionsDir}/dashboards/${missionSlug}/${pillarSlug}.html`;
  }

  // ========================================================================
  // Config loading
  // ========================================================================

  private async loadMission(config: ConfigFile): Promise<void> {
    try {
      let jsonConfig: Record<string, unknown> = {};

      if (config.jsonContent) {
        jsonConfig = JSON.parse(config.jsonContent);
      } else {
        // Use LLM to parse markdown to JSON
        try {
          const jsonStr = await this.llmService.parseMissionConfig(config.mdContent);
          jsonConfig = JSON.parse(jsonStr);
          await this.configWatcher.updateJsonConfig(config.name, JSON.stringify(jsonConfig, null, 2));
        } catch (parseError) {
          console.warn(`[MissionManager] Could not parse config for ${config.name}:`, parseError);
          jsonConfig = this.createBasicConfig(config);
          try {
            await this.configWatcher.updateJsonConfig(config.name, JSON.stringify(jsonConfig, null, 2));
          } catch {
            // ignore save error
          }
        }
      }

      this.syncMissionToDb(config, jsonConfig);
    } catch (error) {
      console.error(`[MissionManager] Error loading mission ${config.name}:`, error);
    }
  }

  private syncMissionToDb(config: ConfigFile, jsonConfig: Record<string, unknown>): void {
    const db = getDb();
    const slug = config.name;
    const now = new Date().toISOString();

    // Check if mission exists
    const existing = db.rawQuery('SELECT * FROM missions WHERE slug = ?', [slug]) as MissionRow[];

    const missionName = (jsonConfig.name as string) || config.name;
    const description = (jsonConfig.description as string) || '';
    const cadence = (jsonConfig.cadence as string) || null;

    if (existing.length > 0) {
      // Update
      db.rawRun(
        'UPDATE missions SET name = ?, description = ?, mdFile = ?, jsonConfig = ?, cadence = ?, nextCycleAt = ?, updatedAt = ? WHERE slug = ?',
        [missionName, description, config.mdPath, JSON.stringify(jsonConfig), cadence, this.calculateNextCycle(cadence), now, slug]
      );
    } else {
      // Create new mission with a conversation
      const missionId = uuid();
      const conversationId = uuid();

      // Create conversation for mission-level chat
      db.rawRun(
        'INSERT INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [conversationId, `Mission: ${missionName}`, now, now, 1, JSON.stringify({ channel: 'mission', missionId, missionSlug: slug })]
      );

      db.rawRun(
        'INSERT INTO missions (id, slug, name, description, status, mdFile, jsonConfig, conversationId, cadence, lastCycleAt, nextCycleAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [missionId, slug, missionName, description, 'active', config.mdPath, JSON.stringify(jsonConfig), conversationId, cadence, null, this.calculateNextCycle(cadence), now, now]
      );

      // Create well-known metric collection conversation for this mission
      const metricConvId = metricConversationId(slug);
      db.rawRun(
        'INSERT OR IGNORE INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [metricConvId, `[Metric Collection] ${missionName}`, now, now, 1, JSON.stringify({ channel: 'metric-collection', missionId, missionSlug: slug })]
      );

      // Sync pillars from config
      this.syncPillars(missionId, jsonConfig, slug);
    }

    console.log(`[MissionManager] ${existing.length > 0 ? 'Updated' : 'Created'} mission: ${slug}`);
  }

  private syncPillars(missionId: string, jsonConfig: Record<string, unknown>, missionSlug: string): void {
    const db = getDb();
    const now = new Date().toISOString();
    const pillarsConfig = (jsonConfig.pillars as Array<Record<string, unknown>>) || [];

    for (const pillarConfig of pillarsConfig) {
      const pillarId = uuid();
      const pillarSlug = (pillarConfig.slug as string) || this.slugify(pillarConfig.name as string || 'unnamed');
      const conversationId = uuid();

      // Create conversation for pillar chat
      db.rawRun(
        'INSERT INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [conversationId, `Pillar: ${pillarConfig.name}`, now, now, 1, JSON.stringify({ channel: 'pillar', missionId, missionSlug, pillarId, pillarSlug })]
      );

      db.rawRun(
        'INSERT INTO pillars (id, missionId, slug, name, description, status, conversationId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [pillarId, missionId, pillarSlug, pillarConfig.name || '', pillarConfig.description || '', 'active', conversationId, now, now]
      );

      // Create well-known pillar TODO chat
      const todoConvId = pillarTodoConversationId(missionSlug, pillarSlug);
      db.rawRun(
        'INSERT OR IGNORE INTO conversations (id, title, createdAt, updatedAt, manuallyNamed, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        [todoConvId, `[TODOs] ${pillarConfig.name}`, now, now, 1, JSON.stringify({ channel: 'pillar-todo', missionId, missionSlug, pillarId, pillarSlug })]
      );

      // Sync metrics (enhanced schema)
      const metrics = (pillarConfig.metrics as Array<Record<string, unknown>>) || [];
      for (const metric of metrics) {
        const metricSlug = (metric.slug as string) || this.slugify((metric.name as string) || 'unnamed');
        const metricType = (metric.type as string) || 'numeric';
        const target = typeof metric.target === 'object' ? JSON.stringify(metric.target) : (metric.target as string || '{}');
        const current = typeof metric.current === 'number' ? metric.current : null;
        const collection = typeof metric.collection === 'object' ? JSON.stringify(metric.collection) : '{}';

        db.rawRun(
          'INSERT INTO pillar_metrics (id, pillarId, slug, name, type, unit, target, current, status, trend, collection, lastCollectedAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), pillarId, metricSlug, metric.name || '', metricType, metric.unit || '', target, current, 'unknown', 'unknown', collection, null, now]
        );
      }

      // Sync strategies
      const strategies = (pillarConfig.strategies as Array<Record<string, unknown>>) || [];
      for (const strategy of strategies) {
        const desc = typeof strategy === 'string' ? strategy : (strategy.description as string || '');
        db.rawRun(
          'INSERT INTO pillar_strategies (id, pillarId, description, status, lastReviewedAt, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
          [uuid(), pillarId, desc, 'active', now, now]
        );
      }
    }
  }

  private handleConfigRemoved(filePath: string): void {
    const slug = filePath.replace(/^.*[\\/]/, '').replace('.md', '');
    console.log(`[MissionManager] Mission config removed: ${slug}`);

    const db = getDb();
    db.rawRun('UPDATE missions SET status = ?, updatedAt = ? WHERE slug = ?', ['archived', new Date().toISOString(), slug]);
  }

  private createBasicConfig(config: ConfigFile): Record<string, unknown> {
    const titleMatch = config.mdContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : config.name;

    return {
      name: title,
      description: '',
      cadence: null,
      pillars: [],
      agents: { lead: { model: 'default' }, workers: [] },
    };
  }

  private calculateNextCycle(cadence: string | null): string | null {
    if (!cadence) return null;
    try {
      const interval = CronExpressionParser.parse(cadence);
      return interval.next().toDate().toISOString();
    } catch {
      return null;
    }
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  private deserializeMission(row: MissionRow): Mission {
    return {
      ...row,
      status: row.status as Mission['status'],
    };
  }

  private deserializePillar(row: PillarRow): Pillar {
    return {
      ...row,
      status: row.status as Pillar['status'],
    };
  }

  async close(): Promise<void> {
    this.stopScheduler();
    await this.configWatcher.close();
  }
}
