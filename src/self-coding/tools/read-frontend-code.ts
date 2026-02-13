/**
 * Read Frontend Code Tool
 *
 * Read-only tool for examining the frontend codebase within /web directory.
 * Used by coding-planner to understand current code structure.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, relative } from 'path';
import type { NativeTool, NativeToolResult } from '../../tools/native/types.js';

// Base path for frontend code - all reads must be within this directory
const WEB_BASE_PATH = resolve(process.cwd(), 'web');

export interface ReadFrontendCodeParams {
  /** Relative path from /web directory (e.g., "src/components/Button.jsx" or "src/components") */
  path: string;
}

export class ReadFrontendCodeTool implements NativeTool {
  readonly name = 'read_frontend_code';
  readonly description = `Read frontend source code files or list directory contents within the /web directory.

This is a READ-ONLY tool for examining the frontend codebase structure.

Usage:
- Read a file: { "path": "src/App.jsx" } - Returns file content, line count, and size
- List a directory: { "path": "src/components" } - Returns list of files and subdirectories with sizes

All paths are relative to the /web directory.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path from /web directory (e.g., "src/App.jsx" for a file or "src/components" for a directory)',
      },
    },
    required: ['path'],
  };

  readonly private = true;

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const { path: filePath } = params as unknown as ReadFrontendCodeParams;

    // Validate and resolve file path
    const pathValidation = this.validatePath(filePath);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }
    const absolutePath = pathValidation.absolutePath!;
    const relativePath = pathValidation.relativePath!;

    console.log(`[ReadFrontendCode] read ${relativePath}`);

    try {
      if (!existsSync(absolutePath)) {
        return { success: false, error: `Path not found: ${relativePath}` };
      }

      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        return this.listDirectory(absolutePath, relativePath);
      } else {
        return this.readFile(absolutePath, relativePath);
      }
    } catch (error) {
      return {
        success: false,
        error: `Read failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private validatePath(filePath: string): { valid: boolean; absolutePath?: string; relativePath?: string; error?: string } {
    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, error: 'path is required and must be a string' };
    }

    // Normalize and resolve the path
    const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const absolutePath = resolve(WEB_BASE_PATH, normalizedPath);
    const relativePath = relative(WEB_BASE_PATH, absolutePath);

    // Security check: ensure the resolved path is within /web
    if (!absolutePath.startsWith(WEB_BASE_PATH)) {
      return {
        valid: false,
        error: `Security violation: Path "${filePath}" resolves outside of /web directory`,
      };
    }

    // Check for path traversal attempts
    if (normalizedPath.includes('..')) {
      return {
        valid: false,
        error: 'Path traversal (../) is not allowed',
      };
    }

    return { valid: true, absolutePath, relativePath };
  }

  private readFile(absolutePath: string, relativePath: string): NativeToolResult {
    const content = readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');

    return {
      success: true,
      output: {
        path: relativePath,
        type: 'file',
        content,
        lineCount: lines.length,
        size: content.length,
      },
    };
  }

  private listDirectory(absolutePath: string, relativePath: string): NativeToolResult {
    const entries = readdirSync(absolutePath, { withFileTypes: true });

    const files: Array<{ name: string; type: 'file' | 'directory'; size?: number }> = [];

    for (const entry of entries) {
      const entryPath = join(absolutePath, entry.name);
      if (entry.isDirectory()) {
        files.push({ name: entry.name, type: 'directory' });
      } else if (entry.isFile()) {
        const fileStats = statSync(entryPath);
        files.push({ name: entry.name, type: 'file', size: fileStats.size });
      }
    }

    // Sort: directories first, then files, alphabetically within each group
    files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    return {
      success: true,
      output: {
        path: relativePath || '.',
        type: 'directory',
        entries: files,
        totalEntries: files.length,
        directories: files.filter(f => f.type === 'directory').length,
        files: files.filter(f => f.type === 'file').length,
      },
    };
  }
}
