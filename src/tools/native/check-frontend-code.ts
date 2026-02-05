/**
 * Check Frontend Code Tool
 *
 * Validates the frontend codebase by running build and optional lint commands.
 * Used by coding-lead to verify code integrity after modifications.
 */

import { spawn } from 'child_process';
import { resolve } from 'path';
import { existsSync } from 'fs';
import type { NativeTool, NativeToolResult } from './types.js';

// Base path for frontend code
const WEB_BASE_PATH = resolve(process.cwd(), 'web');

export type CheckOperation = 'build' | 'lint' | 'typecheck' | 'all';

export interface CheckFrontendCodeParams {
  /** Type of check to run */
  check: CheckOperation;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
}

export class CheckFrontendCodeTool implements NativeTool {
  readonly name = 'check_frontend_code';
  readonly description = `Validate the frontend codebase by running build, lint, or type checking commands.

Use this tool to verify code integrity after modifications.

Operations:
- build: Run \`npm run build\` to verify the code compiles (recommended after changes)
- lint: Run \`npm run lint\` if available (checks code style)
- typecheck: Run \`npm run typecheck\` if available (TypeScript type checking)
- all: Run all available checks in sequence

Returns success/failure status with any error output.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      check: {
        type: 'string',
        enum: ['build', 'lint', 'typecheck', 'all'],
        description: 'Type of check to run',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 60000)',
      },
    },
    required: ['check'],
  };

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const { check, timeout = 60000 } = params as CheckFrontendCodeParams;

    // Verify web directory exists
    if (!existsSync(WEB_BASE_PATH)) {
      return {
        success: false,
        error: `Frontend directory not found: ${WEB_BASE_PATH}`,
      };
    }

    console.log(`[CheckFrontendCode] Running ${check} check...`);

    try {
      switch (check) {
        case 'build':
          return await this.runCheck('npm run build', 'build', timeout);
        case 'lint':
          return await this.runCheck('npm run lint', 'lint', timeout);
        case 'typecheck':
          return await this.runCheck('npm run typecheck', 'typecheck', timeout);
        case 'all':
          return await this.runAllChecks(timeout);
        default:
          return { success: false, error: `Unknown check type: ${check}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Check failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private async runCheck(
    command: string,
    checkName: string,
    timeout: number
  ): Promise<NativeToolResult> {
    const startTime = Date.now();

    try {
      const result = await this.executeCommand(command, timeout);
      const duration = Date.now() - startTime;

      if (result.exitCode === 0) {
        console.log(`[CheckFrontendCode] ✓ ${checkName} passed (${duration}ms)`);
        return {
          success: true,
          output: {
            check: checkName,
            status: 'passed',
            duration,
            stdout: result.stdout.slice(-2000), // Last 2000 chars
          },
        };
      } else {
        console.error(`[CheckFrontendCode] ✗ ${checkName} failed (exit: ${result.exitCode})`);
        return {
          success: false,
          error: `${checkName} check failed`,
          output: {
            check: checkName,
            status: 'failed',
            exitCode: result.exitCode,
            duration,
            stdout: result.stdout.slice(-2000),
            stderr: result.stderr.slice(-2000),
          },
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        return {
          success: false,
          error: `${checkName} check timed out after ${timeout}ms`,
        };
      }
      throw error;
    }
  }

  private async runAllChecks(timeout: number): Promise<NativeToolResult> {
    const results: Array<{ check: string; status: string; duration: number; error?: string }> = [];
    let allPassed = true;

    // Run build (required)
    const buildResult = await this.runCheck('npm run build', 'build', timeout);
    results.push({
      check: 'build',
      status: buildResult.success ? 'passed' : 'failed',
      duration: (buildResult.output as { duration?: number })?.duration || 0,
      error: buildResult.error,
    });
    if (!buildResult.success) allPassed = false;

    // Try lint (optional - may not exist)
    try {
      const lintResult = await this.runCheck('npm run lint', 'lint', timeout);
      results.push({
        check: 'lint',
        status: lintResult.success ? 'passed' : 'failed',
        duration: (lintResult.output as { duration?: number })?.duration || 0,
        error: lintResult.error,
      });
      if (!lintResult.success) allPassed = false;
    } catch {
      results.push({ check: 'lint', status: 'skipped', duration: 0 });
    }

    // Try typecheck (optional - may not exist)
    try {
      const typecheckResult = await this.runCheck('npm run typecheck', 'typecheck', timeout);
      results.push({
        check: 'typecheck',
        status: typecheckResult.success ? 'passed' : 'failed',
        duration: (typecheckResult.output as { duration?: number })?.duration || 0,
        error: typecheckResult.error,
      });
      if (!typecheckResult.success) allPassed = false;
    } catch {
      results.push({ check: 'typecheck', status: 'skipped', duration: 0 });
    }

    return {
      success: allPassed,
      output: {
        check: 'all',
        status: allPassed ? 'all_passed' : 'some_failed',
        results,
      },
      error: allPassed ? undefined : 'One or more checks failed',
    };
  }

  private executeCommand(
    command: string,
    timeout: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'cmd' : '/bin/sh';
      const shellFlag = isWindows ? '/c' : '-c';

      const proc = spawn(shell, [shellFlag, command], {
        cwd: WEB_BASE_PATH,
        env: { ...process.env, CI: 'true' }, // CI=true for non-interactive mode
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

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
