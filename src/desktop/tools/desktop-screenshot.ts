/**
 * Desktop Screenshot Tool
 *
 * Native tool for capturing screenshots from desktop sessions.
 */

import type { NativeTool, NativeToolResult } from '../../tools/native/types';
import type { DesktopSessionManager } from '../manager';

export class DesktopScreenshotTool implements NativeTool {
  readonly name = 'desktop_screenshot';
  readonly description = `Capture a screenshot from a desktop session.

Returns the current screenshot of the sandboxed desktop environment.
The screenshot is useful for understanding the current state of the desktop before executing actions.
Note: Do not attempt to display the image in your response - the user can preview it in the tool result UI.`;

  readonly inputSchema = {
    type: 'object',
    properties: {
      sessionId: {
        type: 'string',
        description: 'The desktop session ID to capture screenshot from',
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

    try {
      const screenshot = await this.desktopManager.captureScreenshot(sessionId);
      const dataUrl = `data:image/png;base64,${screenshot}`;

      return {
        success: true,
        output: {
          message: 'Screenshot captured successfully',
          sessionId,
          viewport: session.viewport,
          timestamp: new Date().toISOString(),
        },
        // Include screenshot as file with dataUrl for inline display
        files: [{
          name: 'screenshot.png',
          dataUrl,
          size: Math.round((screenshot.length * 3) / 4),
          mediaType: 'image/png',
        }],
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
