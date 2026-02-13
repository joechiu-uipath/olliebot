/**
 * Run Skill Script Tool
 *
 * Executes scripts from within skill directories.
 * Sandboxed to only allow running scripts from registered skills.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join, normalize, resolve, extname, dirname } from 'path';
import type { NativeTool, NativeToolResult } from './types.js';
import type { SkillManager } from '../../skills/manager.js';

interface RunSkillScriptParams {
  /** Skill ID containing the script */
  skill_id: string;
  /** Name of the script file (e.g., "convert.js") */
  script_name: string;
  /** Optional arguments to pass to the script */
  args?: string[];
  /** Optional environment variables */
  env?: Record<string, string>;
  /** Working directory (defaults to script's directory) */
  cwd?: string;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

export class RunAgentSkillScriptTool implements NativeTool {
  name = 'run_agent_skill_script';
  description = `Execute a script from a skill's scripts/ directory.
Use this when a SKILL.md instructs you to run a script.

Example usage:
- Run a script: { "skill_id": "pdf-converter", "script_name": "convert.js", "args": ["input.pdf"] }`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'string',
        description: 'The skill ID containing the script',
      },
      script_name: {
        type: 'string',
        description: 'Name of the script file in the skill\'s scripts/ directory (e.g., "convert.js")',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to the script',
      },
      env: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'Environment variables to set',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (defaults to script directory)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000)',
      },
    },
    required: ['skill_id', 'script_name'],
  };

  private skillManager: SkillManager;

  constructor(skillManager: SkillManager) {
    this.skillManager = skillManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const {
      skill_id,
      script_name,
      args = [],
      env = {},
      cwd,
      timeout = 60000,
    } = params as unknown as RunSkillScriptParams;

    if (!skill_id) {
      return {
        success: false,
        error: 'skill_id is required',
      };
    }

    if (!script_name) {
      return {
        success: false,
        error: 'script_name is required',
      };
    }

    try {
      // Get skill metadata to find the directory
      const skillMeta = this.skillManager.getMetadata(skill_id);
      if (!skillMeta) {
        const available = this.skillManager.getAllMetadata().map(m => m.id);
        return {
          success: false,
          error: `Skill not found: "${skill_id}". Available skills: ${available.join(', ')}`,
        };
      }

      // Build the script path
      const scriptsDir = join(skillMeta.dirPath, 'scripts');
      const scriptPath = join(scriptsDir, script_name);

      // Resolve and normalize the path
      const resolvedPath = resolve(normalize(scriptPath));

      // Security check: ensure script is within skill's scripts directory
      const normalizedScriptsDir = resolve(scriptsDir);
      if (!resolvedPath.startsWith(normalizedScriptsDir)) {
        return {
          success: false,
          error: `Security error: Script must be within skill's scripts directory`,
        };
      }

      // Check script exists
      if (!existsSync(resolvedPath)) {
        return {
          success: false,
          error: `Script not found: ${script_name} in skill "${skill_id}"`,
        };
      }

      // Determine how to run the script based on extension
      const ext = extname(resolvedPath).toLowerCase();
      let command: string;
      let scriptArgs: string[];

      switch (ext) {
        case '.js':
        case '.mjs':
        case '.cjs':
          command = 'node';
          scriptArgs = [resolvedPath, ...(args || [])];
          break;
        case '.ts':
          command = 'npx';
          scriptArgs = ['tsx', resolvedPath, ...(args || [])];
          break;
        case '.py':
          command = 'python';
          scriptArgs = [resolvedPath, ...(args || [])];
          break;
        case '.sh':
          command = 'bash';
          scriptArgs = [resolvedPath, ...(args || [])];
          break;
        case '.ps1':
          command = 'powershell';
          scriptArgs = ['-ExecutionPolicy', 'Bypass', '-File', resolvedPath, ...(args || [])];
          break;
        case '.bat':
        case '.cmd':
          command = 'cmd';
          scriptArgs = ['/c', resolvedPath, ...(args || [])];
          break;
        default:
          // Try to run directly (for executables)
          command = resolvedPath;
          scriptArgs = args || [];
      }

      // Execute the script
      const workingDir = cwd ? resolve(cwd) : dirname(resolvedPath);

      console.log(`[RunAgentSkillScript] Running: ${command} ${scriptArgs.join(' ')}`);
      console.log(`[RunAgentSkillScript] CWD: ${workingDir}`);

      const result = await this.runProcess(command, scriptArgs, {
        cwd: workingDir,
        env: { ...process.env, ...env },
        timeout,
      });

      if (result.exitCode === 0) {
        console.log(`[RunAgentSkillScript] ✓ ${skill_id}/${script_name}`);
      } else {
        console.error(`[RunAgentSkillScript] ✗ ${skill_id}/${script_name} (exit: ${result.exitCode})`);
        if (result.stderr) {
          console.error(`[RunAgentSkillScript] stderr: ${result.stderr}`);
        }
        if (result.stdout) {
          console.error(`[RunAgentSkillScript] stdout: ${result.stdout}`);
        }
      }

      return {
        success: result.exitCode === 0,
        output: {
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          skill_id,
          script_name,
        },
        error: result.exitCode !== 0
          ? `Script exited with code ${result.exitCode}${result.stderr ? `\n${result.stderr}` : ''}${result.stdout && !result.stderr ? `\n${result.stdout}` : ''}`
          : undefined,
      };
    } catch (error) {
      console.error('[RunAgentSkillScript] Error:', error);
      return {
        success: false,
        error: `Script execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private runProcess(
    command: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: process.platform === 'win32',
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        reject(new Error(`Script timed out after ${options.timeout}ms`));
      }, options.timeout);

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (!killed) {
          resolve({
            exitCode: code ?? 1,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          });
        }
      });
    });
  }
}
