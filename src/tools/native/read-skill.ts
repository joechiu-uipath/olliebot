import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, normalize, resolve } from 'path';
import type { NativeTool, NativeToolResult } from './types.js';
import type { SkillManager } from '../../skills/manager.js';

interface ReadSkillParams {
  /** Skill ID to read (e.g., "frontend-modifier") */
  skill_id: string;
  /** Optional: specific file within the skill directory (e.g., "references/forms.md") */
  file?: string;
}

/**
 * Read Skill Tool - Allows the agent to read skill files
 *
 * Per the Agent Skills spec, agents activate skills by reading SKILL.md files
 * and any referenced documents in the skill directory.
 */
export class ReadSkillTool implements NativeTool {
  name = 'read_skill';
  description = `Read a skill file to load its instructions. Provide the skill_id to read the main SKILL.md file.
You can also read additional files within the skill directory like references or documentation.

Example usage:
- Read main skill: { "skill_id": "frontend-modifier" }
- Read reference file: { "skill_id": "frontend-modifier", "file": "references/api.md" }`;

  inputSchema = {
    type: 'object' as const,
    properties: {
      skill_id: {
        type: 'string',
        description: 'The skill ID to read (e.g., "frontend-modifier")',
      },
      file: {
        type: 'string',
        description: 'Optional: specific file within skill directory (e.g., "references/forms.md")',
      },
    },
    required: ['skill_id'],
  };

  private skillManager: SkillManager;

  constructor(skillManager: SkillManager) {
    this.skillManager = skillManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const { skill_id, file } = params as unknown as ReadSkillParams;

    if (!skill_id) {
      return {
        success: false,
        error: 'skill_id is required',
      };
    }

    try {
      // Get skill metadata to find the directory
      const skillMeta = this.skillManager.getMetadata(skill_id);
      if (!skillMeta) {
        // List available skills to help the agent
        const available = this.skillManager.getAllMetadata().map(m => m.id);
        return {
          success: false,
          error: `Skill not found: "${skill_id}". Available skills: ${available.join(', ')}`,
        };
      }

      // Determine the target path
      let targetPath: string;
      if (file) {
        // Reading a specific file within the skill directory
        targetPath = join(skillMeta.dirPath, file);
      } else {
        // Reading the main SKILL.md file
        targetPath = skillMeta.filePath;
      }

      // Normalize and resolve
      targetPath = resolve(normalize(targetPath));

      // Security check: ensure path is within the skill directory
      const normalizedSkillDir = resolve(skillMeta.dirPath);
      if (!targetPath.startsWith(normalizedSkillDir)) {
        return {
          success: false,
          error: 'Access denied: path must be within skill directory',
        };
      }

      // Check if file exists
      if (!existsSync(targetPath)) {
        return {
          success: false,
          error: `File not found: ${file || 'SKILL.md'}`,
        };
      }

      // Read the file
      const content = await readFile(targetPath, 'utf-8');

      console.log(`[ReadSkillTool] Read skill file: ${targetPath} (${content.length} chars)`);

      return {
        success: true,
        output: {
          skill_id,
          source: skillMeta.source,
          path: targetPath,
          content,
          size: content.length,
        },
      };
    } catch (error) {
      console.error('[ReadSkillTool] Error:', error);
      return {
        success: false,
        error: `Failed to read skill file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
