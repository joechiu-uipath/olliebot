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

export type EditOperation = 'replace' | 'insert_before' | 'insert_after' | 'append' | 'prepend' | 'full_replace' | 'replace_line' | 'insert_at_line';
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
  /** For line-based operations: the line number (1-indexed) */
  line_number?: number;
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
- replace_line: Replace a specific line by line_number (1-indexed)
- insert_at_line: Insert content at a specific line number

TIPS:
- Use append/prepend when possible (no target needed)
- For targeted edits, use SHORT unique strings (1 line is best)
- Use replace_line/insert_at_line with line_number for precise edits
- Read the file first with read_frontend_code to find exact targets`;

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
        enum: ['replace', 'insert_before', 'insert_after', 'append', 'prepend', 'full_replace', 'replace_line', 'insert_at_line'],
        description: 'For edit operations: the type of edit to make',
      },
      target: {
        type: 'string',
        description: 'For replace/insert operations: the exact string to find in the file',
      },
      line_number: {
        type: 'number',
        description: 'For replace_line/insert_at_line: the line number (1-indexed)',
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
      line_number,
      content,
      description,
    } = params as unknown as ModifyFrontendCodeParams;

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
          return this.editFile(absolutePath, relativePath, edit_type, target, line_number, content);
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
    lineNumber?: number,
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

      case 'replace_line': {
        if (!lineNumber || lineNumber < 1) {
          return { success: false, error: 'line_number (1-indexed) is required for replace_line operation' };
        }
        const lines = currentContent.split('\n');
        if (lineNumber > lines.length) {
          return { success: false, error: `Line ${lineNumber} does not exist. File has ${lines.length} lines.` };
        }
        lines[lineNumber - 1] = content;
        newContent = lines.join('\n');
        break;
      }

      case 'insert_at_line': {
        if (!lineNumber || lineNumber < 1) {
          return { success: false, error: 'line_number (1-indexed) is required for insert_at_line operation' };
        }
        const lines = currentContent.split('\n');
        if (lineNumber > lines.length + 1) {
          return { success: false, error: `Line ${lineNumber} is beyond file end. File has ${lines.length} lines.` };
        }
        lines.splice(lineNumber - 1, 0, content);
        newContent = lines.join('\n');
        break;
      }

      case 'replace':
      case 'insert_before':
      case 'insert_after': {
        if (!target) {
          return { success: false, error: `target is required for ${editType} operation` };
        }

        // Normalize line endings for comparison (handle CRLF vs LF mismatch)
        // Detect the file's line ending style and normalize the target to match
        const fileUsesCRLF = currentContent.includes('\r\n');
        const normalizedTarget = fileUsesCRLF
          ? target.replace(/(?<!\r)\n/g, '\r\n')  // Convert LF to CRLF if file uses CRLF
          : target.replace(/\r\n/g, '\n');        // Convert CRLF to LF if file uses LF

        // Check for exact match first (with normalized line endings)
        if (currentContent.includes(normalizedTarget)) {
          // Also normalize content to match file's line ending style
          const normalizedContent = fileUsesCRLF
            ? content.replace(/(?<!\r)\n/g, '\r\n')
            : content.replace(/\r\n/g, '\n');

          if (editType === 'replace') {
            newContent = currentContent.replace(normalizedTarget, normalizedContent);
          } else if (editType === 'insert_before') {
            newContent = currentContent.replace(normalizedTarget, normalizedContent + normalizedTarget);
          } else {
            newContent = currentContent.replace(normalizedTarget, normalizedTarget + normalizedContent);
          }
          break;
        }

        // If no exact match, try to find similar content and provide helpful error
        const errorInfo = this.findSimilarContent(currentContent, target);
        return {
          success: false,
          error: `Target string not found in file.${errorInfo}`,
        };
      }

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

  /**
   * Find similar content in the file to help debug target mismatches
   */
  private findSimilarContent(fileContent: string, target: string): string {
    // Normalize line endings for consistent comparison
    const normalizedContent = fileContent.replace(/\r\n/g, '\n');
    const normalizedTarget = target.replace(/\r\n/g, '\n');

    const lines = normalizedContent.split('\n');
    const targetLines = normalizedTarget.split('\n');
    const targetFirstLine = targetLines[0].trim();

    // Skip if target first line is too short
    if (targetFirstLine.length < 5) {
      return `\n\nTarget too short to search for similar content. Use read_frontend_code to examine the file.`;
    }

    // Find lines that contain similar text
    const similarLines: { line: number; content: string; similarity: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lineTrimmed = lines[i].trim();

      // Skip empty or very short lines (would match everything)
      if (lineTrimmed.length < 10) {
        continue;
      }

      // Check if line contains significant part of target or vice versa
      if (lineTrimmed.includes(targetFirstLine)) {
        similarLines.push({
          line: i + 1,
          content: lines[i].substring(0, 80),
          similarity: 'contains target',
        });
      } else if (targetFirstLine.includes(lineTrimmed)) {
        similarLines.push({
          line: i + 1,
          content: lines[i].substring(0, 80),
          similarity: 'target contains this line',
        });
      } else if (lineTrimmed.length > 10) {
        // Check for partial matches (first 20 chars)
        const targetStart = targetFirstLine.substring(0, Math.min(20, targetFirstLine.length));
        if (lineTrimmed.includes(targetStart)) {
          similarLines.push({
            line: i + 1,
            content: lines[i].substring(0, 80),
            similarity: 'partial match',
          });
        }
      }
    }

    if (similarLines.length > 0) {
      const matches = similarLines.slice(0, 3).map(m =>
        `  Line ${m.line} (${m.similarity}): ${m.content}${m.content.length >= 80 ? '...' : ''}`
      ).join('\n');
      return `\n\nSimilar content found at:\n${matches}\n\nTip: The target may have different whitespace. Use line_number with replace_line for precise edits.`;
    }

    // Show some context from the file
    const preview = lines.slice(0, 10).map((l, i) => `  ${i + 1}: ${l.substring(0, 60)}`).join('\n');
    return `\n\nNo similar content found. First 10 lines of file:\n${preview}\n\nTip: Use read_frontend_code to examine the file first.`;
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
