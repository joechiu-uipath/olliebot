// System Prompt Logger - logs LLM system prompts to files for debugging

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

// Get the log directory (relative to project root)
const LOG_DIR = join(process.cwd(), 'log');

// Ensure log directory exists
function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Log a system prompt to a file
 * @param agentName - Name of the agent making the LLM call
 * @param systemPrompt - The system prompt being sent to the LLM
 * @param context - Optional additional context (e.g., tool count, mission)
 */
export function logSystemPrompt(
  agentName: string,
  systemPrompt: string,
  context?: {
    toolCount?: number;
    skillCount?: number;
    mission?: string;
  }
): void {
  try {
    ensureLogDir();

    // Create unique filename with timestamp and agent name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = agentName.replace(/[^a-zA-Z0-9]/g, '-');
    const filename = `${timestamp}_${safeName}.txt`;
    const filepath = join(LOG_DIR, filename);

    // Build log content
    let content = `=== System Prompt Log ===\n`;
    content += `Agent: ${agentName}\n`;
    content += `Timestamp: ${new Date().toISOString()}\n`;
    if (context?.toolCount !== undefined) {
      content += `Tools: ${context.toolCount}\n`;
    }
    if (context?.skillCount !== undefined) {
      content += `Skills: ${context.skillCount}\n`;
    }
    if (context?.mission) {
      content += `Mission: ${context.mission}\n`;
    }
    content += `\n${'='.repeat(50)}\n\n`;
    content += systemPrompt;

    writeFileSync(filepath, content, 'utf-8');
  } catch (error) {
    // Don't fail the main operation if logging fails
    console.error('[PromptLogger] Failed to log system prompt:', error);
  }
}
