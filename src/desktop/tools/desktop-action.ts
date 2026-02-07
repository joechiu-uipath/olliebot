/**
 * Desktop Action Tool
 *
 * Native tool for executing actions on desktop sessions.
 * Supports both direct actions and AI-driven instructions.
 */

import type { NativeTool, NativeToolResult } from '../../tools/native/types';
import type { DesktopSessionManager } from '../manager';
import type { DesktopActionType } from '../types';

export class DesktopActionTool implements NativeTool {
  readonly name = 'desktop_action';
  readonly description = `Execute actions on a desktop session or give an instruction for AI to complete.

There are two modes:
1. Direct action: Execute a specific action (click, type, scroll, etc.)
2. Instruction: Give a natural language instruction for the Computer Use AI to execute

Direct Actions:
- click: Click at coordinates (x, y)
- double_click: Double-click at coordinates
- right_click: Right-click at coordinates
- type: Type text
- key: Press a key (Enter, Tab, Escape, etc.)
- hotkey: Press key combination (e.g., ["ctrl", "c"])
- scroll: Scroll up/down at optional coordinates
- move: Move mouse to coordinates
- drag: Drag from (x, y) to (endX, endY)
- wait: Wait for specified duration
- screenshot: Capture screenshot without action

Examples:
- Direct click: { sessionId: "xxx", actionType: "click", x: 100, y: 200 }
- Type text: { sessionId: "xxx", actionType: "type", text: "Hello World" }
- Instruction: { sessionId: "xxx", instruction: "Open Notepad and type Hello World" }`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The desktop session ID to execute action on',
      },
      // Direct action mode
      actionType: {
        type: 'string',
        enum: ['click', 'double_click', 'right_click', 'type', 'key', 'hotkey', 'scroll', 'move', 'drag', 'wait', 'screenshot'],
        description: 'Type of action to execute (for direct action mode)',
      },
      x: {
        type: 'number',
        description: 'X coordinate for mouse actions',
      },
      y: {
        type: 'number',
        description: 'Y coordinate for mouse actions',
      },
      text: {
        type: 'string',
        description: 'Text to type (for type action)',
      },
      key: {
        type: 'string',
        description: 'Key to press (for key action, e.g., "Enter", "Tab", "Escape")',
      },
      keys: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keys for hotkey combination (e.g., ["ctrl", "c"])',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right'],
        description: 'Scroll direction',
      },
      amount: {
        type: 'number',
        description: 'Scroll amount in clicks (default: 3)',
      },
      endX: {
        type: 'number',
        description: 'End X coordinate for drag action',
      },
      endY: {
        type: 'number',
        description: 'End Y coordinate for drag action',
      },
      duration: {
        type: 'number',
        description: 'Wait duration in milliseconds (for wait action)',
      },
      // Instruction mode
      instruction: {
        type: 'string',
        description: 'Natural language instruction for AI to execute (uses Computer Use model)',
      },
      maxSteps: {
        type: 'number',
        description: 'Maximum steps for instruction execution (default: 10)',
      },
    },
    required: ['sessionId'],
  };

  private desktopManager: DesktopSessionManager;

  constructor(desktopManager: DesktopSessionManager) {
    this.desktopManager = desktopManager;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const sessionId = String(params.sessionId);

    // Check if session exists
    const session = this.desktopManager.getSession(sessionId);
    if (!session) {
      return {
        success: false,
        error: `Session not found: ${sessionId}`,
      };
    }

    // Check if session is busy
    if (session.status === 'busy') {
      return {
        success: false,
        error: 'Session is busy executing another action',
      };
    }

    try {
      // Instruction mode
      if (params.instruction) {
        return await this.executeInstruction(sessionId, params);
      }

      // Direct action mode
      if (params.actionType) {
        return await this.executeDirectAction(sessionId, params);
      }

      return {
        success: false,
        error: 'Either actionType or instruction is required',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async executeDirectAction(
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<NativeToolResult> {
    const actionType = String(params.actionType) as DesktopActionType;

    const result = await this.desktopManager.executeAction(sessionId, {
      type: actionType,
      x: params.x !== undefined ? Number(params.x) : undefined,
      y: params.y !== undefined ? Number(params.y) : undefined,
      text: params.text ? String(params.text) : undefined,
      key: params.key ? String(params.key) : undefined,
      keys: Array.isArray(params.keys) ? params.keys.map(String) : undefined,
      direction: params.direction as 'up' | 'down' | 'left' | 'right' | undefined,
      amount: params.amount !== undefined ? Number(params.amount) : undefined,
      endX: params.endX !== undefined ? Number(params.endX) : undefined,
      endY: params.endY !== undefined ? Number(params.endY) : undefined,
      duration: params.duration !== undefined ? Number(params.duration) : undefined,
    });

    if (result.success) {
      return {
        success: true,
        output: {
          message: `Action ${actionType} executed successfully`,
          action: result.action,
          duration: result.duration,
          hasScreenshot: !!result.screenshot,
        },
      };
    } else {
      return {
        success: false,
        error: result.error || 'Action failed',
      };
    }
  }

  private async executeInstruction(
    sessionId: string,
    params: Record<string, unknown>
  ): Promise<NativeToolResult> {
    const instruction = String(params.instruction);
    const maxSteps = params.maxSteps ? Number(params.maxSteps) : 10;

    const result = await this.desktopManager.executeInstruction(sessionId, instruction, {
      maxSteps,
    });

    if (result.success) {
      return {
        success: true,
        output: {
          message: result.result || 'Instruction completed successfully',
          steps: result.steps,
          actionsExecuted: result.actions.length,
          actions: result.actions.map((a) => ({
            type: a.type,
            x: a.x,
            y: a.y,
            text: a.text,
            key: a.key,
          })),
        },
      };
    } else {
      return {
        success: false,
        error: result.error || 'Instruction failed',
        output: {
          steps: result.steps,
          actionsExecuted: result.actions.length,
        },
      };
    }
  }
}
