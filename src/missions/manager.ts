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
} from './types.js';

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

  getMissions(): Mission[] {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM missions ORDER BY updatedAt DESC') as MissionRow[];
    return rows.map(r => this.deserializeMission(r));
  }

  getMissionBySlug(slug: string): Mission | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM missions WHERE slug = ?', [slug]) as MissionRow[];
    return rows[0] ? this.deserializeMission(rows[0]) : undefined;
  }

  updateMission(slug: string, updates: Partial<Pick<Mission, 'name' | 'description' | 'status' | 'cadence' | 'jsonConfig'>>): Mission | undefined {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      values.push(value);
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

  getPillarsByMission(missionId: string): Pillar[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillars WHERE missionId = ? ORDER BY createdAt ASC',
      [missionId]
    ) as PillarRow[];
    return rows.map(r => this.deserializePillar(r));
  }

  getPillarBySlug(missionId: string, pillarSlug: string): Pillar | undefined {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillars WHERE missionId = ? AND slug = ?',
      [missionId, pillarSlug]
    ) as PillarRow[];
    return rows[0] ? this.deserializePillar(rows[0]) : undefined;
  }

  // ========================================================================
  // Metrics CRUD
  // ========================================================================

  getMetricsByPillar(pillarId: string): PillarMetric[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillar_metrics WHERE pillarId = ? ORDER BY name ASC',
      [pillarId]
    ) as PillarMetricRow[];
    return rows.map(r => r as PillarMetric);
  }

  getMetricHistory(metricId: string, limit = 30): PillarMetricHistory[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM pillar_metric_history WHERE metricId = ? ORDER BY timestamp DESC LIMIT ?',
      [metricId, limit]
    ) as PillarMetricHistoryRow[];
    return rows.reverse(); // chronological order
  }

  updateMetric(metricId: string, current: string, trend: PillarMetric['trend']): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.rawRun(
      'UPDATE pillar_metrics SET current = ?, trend = ?, updatedAt = ? WHERE id = ?',
      [current, trend, now, metricId]
    );

    // Add history point
    const numericValue = parseFloat(current);
    if (!isNaN(numericValue)) {
      db.rawRun(
        'INSERT INTO pillar_metric_history (id, metricId, value, timestamp) VALUES (?, ?, ?, ?)',
        [uuid(), metricId, numericValue, now]
      );
    }
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

  getTodosByPillar(pillarId: string): MissionTodo[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM mission_todos WHERE pillarId = ? ORDER BY CASE priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, createdAt ASC',
      [pillarId]
    ) as MissionTodoRow[];
    return rows as MissionTodo[];
  }

  getTodosByMission(missionId: string): MissionTodo[] {
    const db = getDb();
    const rows = db.rawQuery(
      'SELECT * FROM mission_todos WHERE missionId = ? ORDER BY createdAt DESC',
      [missionId]
    ) as MissionTodoRow[];
    return rows as MissionTodo[];
  }

  getTodoById(todoId: string): MissionTodo | undefined {
    const db = getDb();
    const rows = db.rawQuery('SELECT * FROM mission_todos WHERE id = ?', [todoId]) as MissionTodoRow[];
    return rows[0] as MissionTodo | undefined;
  }

  createTodo(todo: Omit<MissionTodo, 'id' | 'createdAt' | 'startedAt' | 'completedAt'>): MissionTodo {
    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();

    db.rawRun(
      'INSERT INTO mission_todos (id, pillarId, missionId, title, description, status, priority, assignedAgent, conversationId, outcome, createdAt, startedAt, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, todo.pillarId, todo.missionId, todo.title, todo.description, todo.status, todo.priority, todo.assignedAgent, todo.conversationId, todo.outcome, now, null, null]
    );

    const created = this.getTodoById(id)!;
    this.emit('todo:created', { missionId: todo.missionId, pillarId: todo.pillarId, todo: created });
    return created;
  }

  updateTodo(todoId: string, updates: Partial<Pick<MissionTodo, 'title' | 'description' | 'status' | 'priority' | 'assignedAgent' | 'conversationId' | 'outcome' | 'startedAt' | 'completedAt'>>): MissionTodo | undefined {
    const db = getDb();
    const setClauses: string[] = [];
    const values: unknown[] = [];

    for (const [key, value] of Object.entries(updates)) {
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
        'INSERT INTO conversations (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
        [conversationId, `Mission: ${missionName}`, now, now]
      );

      db.rawRun(
        'INSERT INTO missions (id, slug, name, description, status, mdFile, jsonConfig, conversationId, cadence, lastCycleAt, nextCycleAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [missionId, slug, missionName, description, 'active', config.mdPath, JSON.stringify(jsonConfig), conversationId, cadence, null, this.calculateNextCycle(cadence), now, now]
      );

      // Sync pillars from config
      this.syncPillars(missionId, jsonConfig);
    }

    console.log(`[MissionManager] ${existing.length > 0 ? 'Updated' : 'Created'} mission: ${slug}`);
  }

  private syncPillars(missionId: string, jsonConfig: Record<string, unknown>): void {
    const db = getDb();
    const now = new Date().toISOString();
    const pillarsConfig = (jsonConfig.pillars as Array<Record<string, unknown>>) || [];

    for (const pillarConfig of pillarsConfig) {
      const pillarId = uuid();
      const pillarSlug = (pillarConfig.slug as string) || this.slugify(pillarConfig.name as string || 'unnamed');
      const conversationId = uuid();

      // Create conversation for pillar chat
      db.rawRun(
        'INSERT INTO conversations (id, title, createdAt, updatedAt) VALUES (?, ?, ?, ?)',
        [conversationId, `Pillar: ${pillarConfig.name}`, now, now]
      );

      db.rawRun(
        'INSERT INTO pillars (id, missionId, slug, name, description, status, conversationId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [pillarId, missionId, pillarSlug, pillarConfig.name || '', pillarConfig.description || '', 'active', conversationId, now, now]
      );

      // Sync metrics
      const metrics = (pillarConfig.metrics as Array<Record<string, unknown>>) || [];
      for (const metric of metrics) {
        db.rawRun(
          'INSERT INTO pillar_metrics (id, pillarId, name, target, current, unit, trend, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), pillarId, metric.name || '', metric.target || '', metric.current || '', metric.unit || '', 'unknown', now]
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
