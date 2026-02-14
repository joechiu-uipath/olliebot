/**
 * User Settings Service
 *
 * Manages persistent user settings stored in /user/settings.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';

export interface TokenReductionSettings {
  /** Enable token reduction for the main LLM */
  enabledForMain: boolean;
  /** Enable token reduction for the fast LLM */
  enabledForFast: boolean;
  /** Which provider to use (e.g. 'llmlingua2') */
  provider: string;
  /** Compression rate (0.0-1.0), e.g. 0.5 = keep 50% of tokens */
  rate: number;
  /** Model for the provider (e.g. 'bert-multilingual', 'xlm-roberta') */
  model: string;
}

export interface UserSettings {
  /** List of disabled MCP server IDs */
  disabled_mcps: string[];
  /** Token reduction (prompt compression) settings */
  token_reduction: TokenReductionSettings;
}

const DEFAULT_SETTINGS: UserSettings = {
  disabled_mcps: [],
  token_reduction: {
    enabledForMain: false,
    enabledForFast: false,
    provider: 'llmlingua2',
    rate: 0.5,
    model: 'bert-multilingual',
  },
};

const USER_DIR = resolve(process.cwd(), 'user');
const SETTINGS_PATH = join(USER_DIR, 'settings.json');

export class UserSettingsService {
  private settings: UserSettings;

  constructor() {
    this.settings = this.load();
  }

  /**
   * Load settings from disk, returning defaults if file doesn't exist
   */
  private load(): UserSettings {
    try {
      if (!existsSync(SETTINGS_PATH)) {
        return { ...DEFAULT_SETTINGS };
      }

      const content = readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(content);

      // Merge with defaults to ensure all fields exist
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // Ensure disabled_mcps is always an array
        disabled_mcps: Array.isArray(parsed.disabled_mcps) ? parsed.disabled_mcps : [],
        // Deep-merge token_reduction with defaults
        token_reduction: {
          ...DEFAULT_SETTINGS.token_reduction,
          ...(parsed.token_reduction || {}),
        },
      };
    } catch (error) {
      console.warn('[UserSettings] Failed to load settings, using defaults:', error);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * Save current settings to disk
   */
  private save(): void {
    try {
      // Ensure user directory exists
      if (!existsSync(USER_DIR)) {
        mkdirSync(USER_DIR, { recursive: true });
      }

      writeFileSync(SETTINGS_PATH, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (error) {
      console.error('[UserSettings] Failed to save settings:', error);
    }
  }

  /**
   * Get current settings
   */
  getSettings(): UserSettings {
    return { ...this.settings };
  }

  /**
   * Update settings (partial update, merges with existing)
   */
  updateSettings(updates: Partial<UserSettings>): UserSettings {
    this.settings = {
      ...this.settings,
      ...updates,
    };
    this.save();
    return this.getSettings();
  }

  /**
   * Check if an MCP server is disabled
   */
  isMcpDisabled(serverId: string): boolean {
    return this.settings.disabled_mcps.includes(serverId);
  }

  /**
   * Disable an MCP server (add to disabled list)
   */
  disableMcp(serverId: string): void {
    if (!this.settings.disabled_mcps.includes(serverId)) {
      this.settings.disabled_mcps.push(serverId);
      this.save();
      console.log(`[UserSettings] MCP disabled: ${serverId}`);
    }
  }

  /**
   * Enable an MCP server (remove from disabled list)
   */
  enableMcp(serverId: string): void {
    const index = this.settings.disabled_mcps.indexOf(serverId);
    if (index !== -1) {
      this.settings.disabled_mcps.splice(index, 1);
      this.save();
      console.log(`[UserSettings] MCP enabled: ${serverId}`);
    }
  }

  /**
   * Set MCP enabled/disabled status
   */
  setMcpEnabled(serverId: string, enabled: boolean): void {
    if (enabled) {
      this.enableMcp(serverId);
    } else {
      this.disableMcp(serverId);
    }
  }

  /**
   * Get list of disabled MCP server IDs
   */
  getDisabledMcps(): string[] {
    return [...this.settings.disabled_mcps];
  }

  // ============================================================
  // Token Reduction settings
  // ============================================================

  /**
   * Get current token reduction settings
   */
  getTokenReductionSettings(): TokenReductionSettings {
    return { ...this.settings.token_reduction };
  }

  /**
   * Update token reduction settings (partial update)
   */
  updateTokenReductionSettings(updates: Partial<TokenReductionSettings>): TokenReductionSettings {
    this.settings.token_reduction = {
      ...this.settings.token_reduction,
      ...updates,
    };
    this.save();
    console.log(`[UserSettings] Token reduction updated:`, this.settings.token_reduction);
    return this.getTokenReductionSettings();
  }

  /**
   * Check if token reduction is enabled for a given workload
   */
  isTokenReductionEnabled(workload: 'main' | 'fast'): boolean {
    return workload === 'main'
      ? this.settings.token_reduction.enabledForMain
      : this.settings.token_reduction.enabledForFast;
  }
}

// Singleton instance
let settingsInstance: UserSettingsService | null = null;

export function getUserSettingsService(): UserSettingsService {
  if (!settingsInstance) {
    settingsInstance = new UserSettingsService();
  }
  return settingsInstance;
}
