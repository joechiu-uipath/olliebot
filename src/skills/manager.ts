import { watch, type FSWatcher } from 'chokidar';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { Skill, SkillMetadata, SkillSource } from './types.js';
import { SkillParser } from './parser.js';
import { SKILL_EXECUTION_TIMEOUT_MS } from '../constants.js';

// Get the directory of this module (for builtin skills)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Skill Manager - Discovers, loads, and provides skills to agents
 *
 * Based on the Agent Skills specification:
 * https://agentskills.io/specification
 *
 * Key principles:
 * - Progressive disclosure: metadata loaded at startup, full content on activation
 * - Agent-driven execution: agents read SKILL.md and execute scripts via bash tools
 * - Filesystem-based: skills are directories with SKILL.md files
 * - Dual sources: builtin skills (shipped with app) and user skills (in user folder)
 */
export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private metadata: Map<string, SkillMetadata> = new Map();
  private parser: SkillParser;
  private watcher: FSWatcher | null = null;
  private userSkillsDir: string;
  private builtinSkillsDir: string;

  constructor(userSkillsDir: string) {
    this.userSkillsDir = userSkillsDir;
    // Builtin skills are in src/skills/builtin/ relative to this file
    this.builtinSkillsDir = join(__dirname, 'builtin');
    this.parser = new SkillParser();

    // Ensure user skills directory exists
    if (!existsSync(userSkillsDir)) {
      mkdirSync(userSkillsDir, { recursive: true });
    }
  }

  /**
   * Initialize the skill manager
   * Loads metadata for all skills (not full content - progressive disclosure)
   */
  async init(): Promise<void> {
    // Load metadata for all skills from both sources
    await this.loadMetadata();

    // Watch for changes in user skills only (builtin are immutable)
    this.startWatching();

    console.log(`[SkillManager] Initialized with ${this.metadata.size} skills`);
  }

  /**
   * Load metadata for all skills (frontmatter only)
   * This keeps initial context usage low
   */
  private async loadMetadata(): Promise<void> {
    // Load builtin skills first
    if (existsSync(this.builtinSkillsDir)) {
      const builtinMetadata = await this.parser.loadMetadataFromDirectory(this.builtinSkillsDir, 'builtin');
      for (const meta of builtinMetadata) {
        this.metadata.set(meta.id, meta);
        console.log(`[SkillManager] Discovered builtin skill: ${meta.name} (${meta.id})`);
        // No dependency installation for builtin skills
      }
    }

    // Load user skills (may override builtin if same ID)
    if (existsSync(this.userSkillsDir)) {
      const userMetadata = await this.parser.loadMetadataFromDirectory(this.userSkillsDir, 'user');
      for (const meta of userMetadata) {
        if (this.metadata.has(meta.id)) {
          console.log(`[SkillManager] User skill "${meta.id}" overrides builtin`);
        }
        this.metadata.set(meta.id, meta);
        console.log(`[SkillManager] Discovered user skill: ${meta.name} (${meta.id})`);

        // Auto-install dependencies if skill has scripts with package.json
        await this.installSkillDependencies(meta.dirPath);
      }
    }
  }

  /**
   * Install npm dependencies for a skill if needed
   */
  private async installSkillDependencies(skillDir: string): Promise<void> {
    const scriptsDir = join(skillDir, 'scripts');
    const packageJsonPath = join(scriptsDir, 'package.json');
    const nodeModulesPath = join(scriptsDir, 'node_modules');

    // Check if scripts/package.json exists
    if (!existsSync(packageJsonPath)) {
      return;
    }

    // Check if node_modules already exists
    if (existsSync(nodeModulesPath)) {
      return;
    }

    try {
      // Read package.json to check for dependencies
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
      const hasDeps = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;
      const hasDevDeps = packageJson.devDependencies && Object.keys(packageJson.devDependencies).length > 0;

      if (!hasDeps && !hasDevDeps) {
        return;
      }

      console.log(`[SkillManager] Installing dependencies for skill in ${scriptsDir}...`);

      execSync('npm install', {
        cwd: scriptsDir,
        stdio: 'pipe',
        timeout: SKILL_EXECUTION_TIMEOUT_MS,
      });

      console.log(`[SkillManager] Dependencies installed for ${scriptsDir}`);
    } catch (error) {
      console.error(`[SkillManager] Failed to install dependencies in ${scriptsDir}:`, error);
    }
  }

  /**
   * Watch for skill file changes (user skills only)
   */
  private startWatching(): void {
    this.watcher = watch(join(this.userSkillsDir, '*', 'SKILL.md'), {
      persistent: true,
      ignoreInitial: true,
    });

    this.watcher.on('add', async (filePath) => {
      const skill = await this.parser.parseSkill(
        filePath,
        join(filePath, '..'),
        'user'
      );
      if (skill) {
        this.metadata.set(skill.id, skill);
        this.skills.set(skill.id, skill);
        console.log(`[SkillManager] Added user skill: ${skill.name}`);
      }
    });

    this.watcher.on('change', async (filePath) => {
      const skill = await this.parser.parseSkill(
        filePath,
        join(filePath, '..'),
        'user'
      );
      if (skill) {
        this.metadata.set(skill.id, skill);
        this.skills.set(skill.id, skill);
        console.log(`[SkillManager] Updated user skill: ${skill.name}`);
      }
    });

    this.watcher.on('unlink', (filePath) => {
      // Find and remove the skill
      for (const [id, meta] of this.metadata) {
        if (meta.filePath === filePath && meta.source === 'user') {
          this.metadata.delete(id);
          this.skills.delete(id);
          console.log(`[SkillManager] Removed user skill: ${meta.name}`);
          break;
        }
      }
    });
  }

  /**
   * Get skill metadata for system prompt injection
   * Returns flat list format matching tools: - skill_id: description
   * @param excludeSources - Optional array of sources to exclude (e.g., ['builtin'])
   * @param allowedSkillIds - Optional array of skill IDs to include (whitelist, takes precedence over excludeSources)
   */
  getSkillsForSystemPrompt(excludeSources?: SkillSource[], allowedSkillIds?: string[]): string {
    if (this.metadata.size === 0) {
      return '';
    }

    let filteredMetadata: SkillMetadata[];

    // If allowedSkillIds is provided, use it as a whitelist (takes precedence)
    // Note: allowedSkillIds=[] means NO skills, allowedSkillIds=undefined means use other filtering
    if (allowedSkillIds !== undefined) {
      filteredMetadata = Array.from(this.metadata.values()).filter(
        meta => allowedSkillIds.includes(meta.id)
      );
    } else if (excludeSources) {
      // Otherwise fall back to source-based filtering
      filteredMetadata = Array.from(this.metadata.values()).filter(
        meta => !excludeSources.includes(meta.source)
      );
    } else {
      filteredMetadata = Array.from(this.metadata.values());
    }

    if (filteredMetadata.length === 0) {
      return '';
    }

    // Format skills in flat list format matching tools: - skill_id: description
    const skillsList = filteredMetadata
      .map((meta) => {
        // Remove newlines from description
        const desc = meta.description.replace(/[\r\n]+/g, ' ').trim();
        return `- ${meta.id}: ${desc}`;
      })
      .join('\n');

    return skillsList;
  }

  /**
   * Get instructions for how the agent should use skills
   * Include this in the system prompt along with available_skills
   * @param excludeSources - Optional array of sources to exclude (e.g., ['builtin'])
   * @param allowedSkillIds - Optional array of skill IDs to include (whitelist, takes precedence over excludeSources)
   */
  getSkillUsageInstructions(excludeSources?: SkillSource[], allowedSkillIds?: string[]): string {
    let filteredMetadata: SkillMetadata[];

    // If allowedSkillIds is provided, use it as a whitelist (takes precedence)
    // Note: allowedSkillIds=[] means NO skills, allowedSkillIds=undefined means use other filtering
    if (allowedSkillIds !== undefined) {
      filteredMetadata = Array.from(this.metadata.values()).filter(
        meta => allowedSkillIds.includes(meta.id)
      );
    } else if (excludeSources) {
      filteredMetadata = Array.from(this.metadata.values()).filter(
        meta => !excludeSources.includes(meta.source)
      );
    } else {
      filteredMetadata = Array.from(this.metadata.values());
    }

    if (filteredMetadata.length === 0) {
      return '';
    }

    return `## Available Skills

Skills provide domain knowledge and workflows. Use read_agent_skill tool with skill_id to activate.`;
  }

  /**
   * Get a skill by ID - loads full content if not already cached
   */
  async getSkill(skillId: string): Promise<Skill | null> {
    // Check cache first
    if (this.skills.has(skillId)) {
      return this.skills.get(skillId)!;
    }

    // Get metadata
    const meta = this.metadata.get(skillId);
    if (!meta) {
      return null;
    }

    // Load full skill
    const skill = await this.parser.parseSkill(meta.filePath, meta.dirPath, meta.source);
    if (skill) {
      this.skills.set(skillId, skill);
    }

    return skill;
  }

  /**
   * Get all skill metadata
   */
  getAllMetadata(): SkillMetadata[] {
    return Array.from(this.metadata.values());
  }

  /**
   * Get skill metadata by ID
   */
  getMetadata(skillId: string): SkillMetadata | undefined {
    return this.metadata.get(skillId);
  }

  /**
   * Check if a skill exists
   */
  hasSkill(skillId: string): boolean {
    return this.metadata.has(skillId);
  }

  /**
   * Get the user skills directory path
   */
  getUserSkillsDir(): string {
    return this.userSkillsDir;
  }

  /**
   * Get the builtin skills directory path
   */
  getBuiltinSkillsDir(): string {
    return this.builtinSkillsDir;
  }

  /**
   * Get the directory path for a specific skill by ID
   */
  getSkillDir(skillId: string): string | null {
    const meta = this.metadata.get(skillId);
    return meta?.dirPath || null;
  }

  /**
   * Escape special XML characters
   */
  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  async close(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
