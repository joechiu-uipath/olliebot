/**
 * Task Manager - Loads and manages agent tasks from .md files
 *
 * Watches the agent config directory for .md files, parses them,
 * and maintains task state in memory. Filesystem is the source of truth
 * for task configuration; runtime state (lastRun, nextRun) is ephemeral.
 */

import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'events';
import { CronExpressionParser } from 'cron-parser';
import { ConfigWatcher, type ConfigFile } from '../config/watcher.js';
import type { LLMService } from '../llm/service.js';
import { getUserSettingsService } from '../settings/service.js';

export interface TaskManagerConfig {
  tasksDir: string;
  llmService: LLMService;
  /** Interval in ms to check for due tasks (default: 30000 = 30 seconds) */
  schedulerInterval?: number;
}

/** In-memory task representation */
export interface Task {
  id: string;
  name: string;
  mdFile: string;
  jsonConfig: Record<string, unknown>;
  status: 'active' | 'paused';
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
}

export interface TaskDueEvent {
  task: Task;
}

export interface TaskUpdatedEvent {
  task: {
    id: string;
    name: string;
    status: string;
    lastRun: string | null;
    nextRun: string | null;
  };
}

export class TaskManager extends EventEmitter {
  private configWatcher: ConfigWatcher;
  private llmService: LLMService;
  private tasksDir: string;
  private schedulerInterval: number;
  private schedulerTimer: NodeJS.Timeout | null = null;

  /** In-memory task storage - keyed by task name for easy lookup */
  private tasks: Map<string, Task> = new Map();

  constructor(config: TaskManagerConfig) {
    super();
    this.tasksDir = config.tasksDir;
    this.llmService = config.llmService;
    this.schedulerInterval = config.schedulerInterval ?? 30000;
    this.configWatcher = new ConfigWatcher(config.tasksDir);
  }

  async init(): Promise<void> {
    // Initialize config watcher
    await this.configWatcher.init();

    // Set up event handlers
    this.configWatcher.on('config:added', (config: ConfigFile) => {
      this.loadTask(config);
    });

    this.configWatcher.on('config:changed', (config: ConfigFile) => {
      this.loadTask(config);
    });

    this.configWatcher.on('config:removed', (filePath: string) => {
      this.handleConfigRemoved(filePath);
    });

    this.configWatcher.on('config:error', (error: Error) => {
      console.error(`[TaskManager] ConfigWatcher error:`, error);
    });

    // Load existing configs into memory
    const configs = this.configWatcher.getConfigs();
    for (const [, config] of configs) {
      await this.loadTask(config);
    }

    console.log(`[TaskManager] Initialized with ${this.tasks.size} tasks from ${this.tasksDir}`);
  }

  /**
   * Start the scheduler that checks for due tasks.
   * Call this AFTER setting up event listeners for 'task:due'.
   */
  startScheduler(): void {
    if (this.schedulerTimer) {
      return; // Already running
    }

    console.log(`[TaskManager] Starting scheduler (interval: ${this.schedulerInterval}ms)`);

    // Check immediately on startup
    this.checkDueTasks();

    // Then check periodically
    this.schedulerTimer = setInterval(() => {
      this.checkDueTasks();
    }, this.schedulerInterval);
  }

  /**
   * Stop the scheduler
   */
  private stopScheduler(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
      console.log(`[TaskManager] Scheduler stopped`);
    }
  }

  /**
   * Check for tasks that are due to run
   */
  private checkDueTasks(): void {
    const now = new Date();

    for (const task of this.tasks.values()) {
      // Skip disabled or paused tasks
      if (!task.enabled || task.status !== 'active' || !task.nextRun) {
        continue;
      }

      const nextRunDate = new Date(task.nextRun);
      if (nextRunDate <= now) {
        console.log(`[TaskManager] Task "${task.name}" is due (scheduled: ${task.nextRun})`);
        this.emit('task:due', { task } as TaskDueEvent);
      }
    }
  }

  /**
   * Mark a task as executed and calculate next run time
   * Should be called after a task has been run
   */
  markTaskExecuted(taskId: string): void {
    // Find task by ID
    let task: Task | undefined;
    for (const t of this.tasks.values()) {
      if (t.id === taskId) {
        task = t;
        break;
      }
    }

    if (!task) {
      console.warn(`[TaskManager] Task not found: ${taskId}`);
      return;
    }

    const now = new Date().toISOString();
    task.lastRun = now;
    task.nextRun = this.calculateNextRun(task.jsonConfig);

    console.log(`[TaskManager] Task "${task.name}" executed. Next run: ${task.nextRun || 'manual'}`);

    // Emit task:updated event for WebSocket sync
    this.emit('task:updated', {
      task: {
        id: task.id,
        name: task.name,
        status: task.status,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
      },
    } as TaskUpdatedEvent);
  }

  private handleConfigRemoved(filePath: string): void {
    const name = filePath.replace(/^.*[\\/]/, '').replace('.md', '');
    console.log(`[TaskManager] Task config removed: ${name}`);

    // Remove from in-memory storage
    this.tasks.delete(name);
  }

  /**
   * Load a task config into memory
   */
  private async loadTask(config: ConfigFile): Promise<void> {
    try {
      // Parse the markdown to JSON config
      let jsonConfig: Record<string, unknown> = {};
      try {
        if (config.jsonContent) {
          // Use cached JSON config
          jsonConfig = JSON.parse(config.jsonContent);
        } else {
          // Use LLM to parse markdown to JSON
          const jsonStr = await this.llmService.parseTaskConfig(config.mdContent);
          jsonConfig = JSON.parse(jsonStr);

          // Cache the generated JSON config to filesystem
          await this.configWatcher.updateJsonConfig(config.name, JSON.stringify(jsonConfig, null, 2));
        }
      } catch (parseError) {
        console.warn(`[TaskManager] Could not parse config for ${config.name}:`, parseError);
        // Create a basic config from the markdown
        jsonConfig = this.createBasicConfig(config);

        // Cache the basic config so we don't retry LLM parsing on every restart
        try {
          await this.configWatcher.updateJsonConfig(config.name, JSON.stringify(jsonConfig, null, 2));
        } catch (saveError) {
          console.warn(`[TaskManager] Could not save basic config for ${config.name}:`, saveError);
        }
      }

      // Check if task already exists (preserve lastRun if updating)
      const existing = this.tasks.get(config.name);

      // Check if task is disabled in user settings
      const userSettings = getUserSettingsService();
      const isDisabled = userSettings.isTaskDisabled(config.name);

      const task: Task = {
        id: existing?.id || uuid(),
        name: config.name,
        mdFile: config.mdPath,
        jsonConfig,
        status: 'active',
        enabled: !isDisabled,
        lastRun: existing?.lastRun || null,
        nextRun: this.calculateNextRun(jsonConfig),
      };

      this.tasks.set(config.name, task);
      console.log(`[TaskManager] ${existing ? 'Updated' : 'Loaded'} task: ${config.name}`);
    } catch (error) {
      console.error(`[TaskManager] Error loading task ${config.name}:`, error);
    }
  }

  /**
   * Create a basic config from markdown content without LLM parsing
   */
  private createBasicConfig(config: ConfigFile): Record<string, unknown> {
    // Extract title from first heading
    const titleMatch = config.mdContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : config.name;

    // Extract description from content after title
    const descMatch = config.mdContent.match(/^#\s+.+\n+(.+?)(?:\n#|$)/s);
    const description = descMatch ? descMatch[1].trim() : '';

    return {
      name: title,
      description,
      trigger: {
        type: 'manual',
      },
      actions: [],
      rawMarkdown: config.mdContent,
    };
  }

  /**
   * Calculate next run time based on config
   */
  private calculateNextRun(config: Record<string, unknown>): string | null {
    const trigger = config.trigger as { type?: string; schedule?: string } | undefined;

    if (!trigger || trigger.type !== 'schedule' || !trigger.schedule) {
      return null;
    }

    try {
      const interval = CronExpressionParser.parse(trigger.schedule);
      const nextDate = interval.next().toDate();
      return nextDate.toISOString();
    } catch (error) {
      console.warn(`[TaskManager] Invalid cron expression "${trigger.schedule}":`, error);
      return null;
    }
  }

  /**
   * Get all tasks (both enabled and disabled)
   */
  getTasks(): Array<{
    id: string;
    name: string;
    status: string;
    enabled: boolean;
    lastRun: string | null;
    nextRun: string | null;
  }> {
    return Array.from(this.tasks.values())
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        enabled: t.enabled,
        lastRun: t.lastRun,
        nextRun: t.nextRun,
      }));
  }

  /**
   * Get a task by ID
   */
  getTaskById(taskId: string): Task | undefined {
    for (const task of this.tasks.values()) {
      if (task.id === taskId) {
        return task;
      }
    }
    return undefined;
  }

  /**
   * Get tasks formatted for API/UI consumption
   */
  getTasksForApi(): Array<{
    id: string;
    name: string;
    description: string;
    schedule: string | null;
    status: string;
    enabled: boolean;
    lastRun: string | null;
    nextRun: string | null;
  }> {
    return Array.from(this.tasks.values())
      .map((t) => {
        const config = t.jsonConfig as { description?: string; trigger?: { schedule?: string } };
        return {
          id: t.id,
          name: t.name,
          description: config.description || '',
          schedule: config.trigger?.schedule || null,
          status: t.status,
          enabled: t.enabled,
          lastRun: t.lastRun,
          nextRun: t.nextRun,
        };
      });
  }

  /**
   * Set task enabled/disabled status
   */
  setTaskEnabled(taskId: string, enabled: boolean): boolean {
    // Find task by ID
    let task: Task | undefined;
    for (const t of this.tasks.values()) {
      if (t.id === taskId) {
        task = t;
        break;
      }
    }

    if (!task) {
      console.warn(`[TaskManager] Task not found: ${taskId}`);
      return false;
    }

    // Update in-memory state
    task.enabled = enabled;

    // Persist to user settings
    const userSettings = getUserSettingsService();
    userSettings.setTaskEnabled(task.name, enabled);

    console.log(`[TaskManager] Task "${task.name}" ${enabled ? 'enabled' : 'disabled'}`);

    // Emit task:updated event for WebSocket sync
    this.emit('task:updated', {
      task: {
        id: task.id,
        name: task.name,
        status: task.status,
        enabled: task.enabled,
        lastRun: task.lastRun,
        nextRun: task.nextRun,
      },
    });

    return true;
  }

  async close(): Promise<void> {
    this.stopScheduler();
    await this.configWatcher.close();
  }
}
