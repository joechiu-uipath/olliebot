/**
 * Modify Frontend Code Tool
 *
 * Write-only tool for modifying the frontend codebase within /web directory.
 * Used by coding-worker to execute code changes.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { dirname, resolve, relative } from 'path';
import type { NativeTool, NativeToolResult } from './types.js';

// Base path for frontend code - all modifications must be within this directory
const WEB_BASE_PATH = resolve(process.cwd(), 'web');

// Protected files that cannot be deleted (but can be edited)
const PROTECTED_FILES = ['src/main.jsx', 'index.html', 'vite.config.js', 'package.json'];

export type EditOperation = 'replace' | 'insert_before' | 'insert_after' | 'append' | 'prepend' | 'full_replace';
export type FileOperation = 'create' | 'edit' | 'delete';

export interface ModifyFrontendCodeParams {
  /** Relative path from /web directory (e.g., "src/components/Button.jsx") */
  file_path: string;
  /** Operation to perform on the file */
  operation: FileOperation;
  /** For edit operations: the type of edit */
  edit_type?: EditOperation;
  /** For replace/insert operations: the target string to find */
  target?: string;
  /** For create/edit operations: the content to write */
  content?: string;
  /** Description of the change (for logging) */
  description?: string;
}

export class ModifyFrontendCodeTool implements NativeTool {
  readonly name = 'modify_frontend_code';
  readonly description = `Modify frontend source code files within the /web directory. This is a WRITE-ONLY tool for creating, editing, and deleting files.

Operations:
- create: Create a new file (fails if file exists)
- edit: Modify an existing file
- delete: Remove a file (protected files cannot be deleted)

Edit types (for edit operation):
- replace: Find and replace target string with content
- insert_before: Insert content before the target string
- insert_after: Insert content after the target string
- append: Add content at the end of the file
- prepend: Add content at the beginning of the file
- full_replace: Replace entire file content

NOTE: Use read_frontend_code tool to examine files before modifying them.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: 'Relative path from /web directory (e.g., "src/components/Button.jsx")',
      },
      operation: {
        type: 'string',
        enum: ['create', 'edit', 'delete'],
        description: 'Operation to perform on the file',
      },
      edit_type: {
        type: 'string',
        enum: ['replace', 'insert_before', 'insert_after', 'append', 'prepend', 'full_replace'],
        description: 'For edit operations: the type of edit to make',
      },
      target: {
        type: 'string',
        description: 'For replace/insert operations: the exact string to find in the file',
      },
      content: {
        type: 'string',
        description: 'For create/edit operations: the content to write',
      },
      description: {
        type: 'string',
        description: 'Brief description of the change being made',
      },
    },
    required: ['file_path', 'operation'],
  };

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const {
      file_path,
      operation,
      edit_type,
      target,
      content,
      description,
    } = params as ModifyFrontendCodeParams;

    // Validate and resolve file path
    const pathValidation = this.validatePath(file_path);
    if (!pathValidation.valid) {
      return { success: false, error: pathValidation.error };
    }
    const absolutePath = pathValidation.absolutePath!;
    const relativePath = pathValidation.relativePath!;

    console.log(`[ModifyFrontendCode] ${operation} ${relativePath}${description ? ` - ${description}` : ''}`);

    try {
      switch (operation) {
        case 'create':
          return this.createFile(absolutePath, relativePath, content);
        case 'edit':
          return this.editFile(absolutePath, relativePath, edit_type, target, content);
        case 'delete':
          return this.deleteFile(absolutePath, relativePath);
        default:
          return { success: false, error: `Unknown operation: ${operation}` };
      }
    } catch (error) {
      return {
        success: false,
        error: `Operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private validatePath(filePath: string): { valid: boolean; absolutePath?: string; relativePath?: string; error?: string } {
    if (!filePath || typeof filePath !== 'string') {
      return { valid: false, error: 'file_path is required and must be a string' };
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

  private createFile(absolutePath: string, relativePath: string, content?: string): NativeToolResult {
    if (existsSync(absolutePath)) {
      return { success: false, error: `File already exists: ${relativePath}. Use 'edit' operation to modify.` };
    }

    if (content === undefined) {
      return { success: false, error: 'content is required for create operation' };
    }

    // Create parent directories if they don't exist
    const parentDir = dirname(absolutePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    writeFileSync(absolutePath, content, 'utf-8');

    return {
      success: true,
      output: {
        path: relativePath,
        operation: 'created',
        size: content.length,
        lineCount: content.split('\n').length,
      },
    };
  }

  private editFile(
    absolutePath: string,
    relativePath: string,
    editType?: EditOperation,
    target?: string,
    content?: string
  ): NativeToolResult {
    if (!existsSync(absolutePath)) {
      return { success: false, error: `File not found: ${relativePath}. Use 'create' operation for new files.` };
    }

    if (!editType) {
      return { success: false, error: 'edit_type is required for edit operation' };
    }

    if (content === undefined) {
      return { success: false, error: 'content is required for edit operation' };
    }

    const currentContent = readFileSync(absolutePath, 'utf-8');
    let newContent: string;

    switch (editType) {
      case 'full_replace':
        newContent = content;
        break;

      case 'append':
        newContent = currentContent + content;
        break;

      case 'prepend':
        newContent = content + currentContent;
        break;

      case 'replace':
      case 'insert_before':
      case 'insert_after':
        if (!target) {
          return { success: false, error: `target is required for ${editType} operation` };
        }

        if (!currentContent.includes(target)) {
          // Provide helpful error with context
          const preview = currentContent.substring(0, 500);
          return {
            success: false,
            error: `Target string not found in file. First 500 chars of file:\n${preview}`,
          };
        }

        if (editType === 'replace') {
          newContent = currentContent.replace(target, content);
        } else if (editType === 'insert_before') {
          newContent = currentContent.replace(target, content + target);
        } else {
          newContent = currentContent.replace(target, target + content);
        }
        break;

      default:
        return { success: false, error: `Unknown edit_type: ${editType}` };
    }

    writeFileSync(absolutePath, newContent, 'utf-8');

    return {
      success: true,
      output: {
        path: relativePath,
        operation: 'edited',
        editType,
        previousSize: currentContent.length,
        newSize: newContent.length,
        lineCount: newContent.split('\n').length,
      },
    };
  }

  private deleteFile(absolutePath: string, relativePath: string): NativeToolResult {
    if (!existsSync(absolutePath)) {
      return { success: false, error: `File not found: ${relativePath}` };
    }

    // Check if file is protected
    if (PROTECTED_FILES.includes(relativePath)) {
      return {
        success: false,
        error: `Cannot delete protected file: ${relativePath}. Protected files: ${PROTECTED_FILES.join(', ')}`,
      };
    }

    const previousContent = readFileSync(absolutePath, 'utf-8');
    unlinkSync(absolutePath);

    return {
      success: true,
      output: {
        path: relativePath,
        operation: 'deleted',
        previousSize: previousContent.length,
      },
    };
  }
}
