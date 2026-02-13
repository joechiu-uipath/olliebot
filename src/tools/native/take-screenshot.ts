/**
 * Take Screenshot Native Tool
 *
 * Captures a screenshot of the current screen using platform-specific methods.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { v4 as uuid } from 'uuid';
import type { NativeTool, NativeToolResult } from './types.js';

const execAsync = promisify(exec);

export class TakeScreenshotTool implements NativeTool {
  readonly name = 'take_screenshot';
  readonly description = 'Capture a screenshot of the current screen. Returns the screenshot as a base64-encoded data URL. Note: Do not attempt to display the image in your response - the user can preview it in the tool result UI.';
  readonly inputSchema = {
    type: 'object',
    properties: {},
    required: [],
  };

  async execute(_params: Record<string, unknown>): Promise<NativeToolResult> {
    const tempPath = join(tmpdir(), `screenshot-${uuid()}.png`);

    try {
      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS
        await execAsync(`screencapture -x "${tempPath}"`);
      } else if (platform === 'win32') {
        // Windows - use PowerShell with script file to avoid escaping issues
        // Must set DPI awareness to capture full resolution on scaled displays
        const psScriptPath = join(tmpdir(), `screenshot-script-${uuid()}.ps1`);
        const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Enable DPI awareness to get actual screen resolution (not scaled)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DpiAwareness {
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();
}
"@
[DpiAwareness]::SetProcessDPIAware() | Out-Null

$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
$bitmap.Save('${tempPath}')
$graphics.Dispose()
$bitmap.Dispose()
`;
        await writeFile(psScriptPath, psScript, 'utf8');
        try {
          await execAsync(`powershell -ExecutionPolicy Bypass -File "${psScriptPath}"`);
        } finally {
          await unlink(psScriptPath).catch(() => {});
        }
      } else {
        // Linux - try multiple screenshot tools
        try {
          await execAsync(`gnome-screenshot -f "${tempPath}"`);
        } catch {
          try {
            await execAsync(`scrot "${tempPath}"`);
          } catch {
            await execAsync(`import -window root "${tempPath}"`);
          }
        }
      }

      // Read screenshot as base64
      const imageBuffer = await readFile(tempPath);
      const base64 = imageBuffer.toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;

      // Clean up temp file
      await unlink(tempPath).catch(() => {});

      return {
        success: true,
        output: {
          format: 'png',
          capturedAt: new Date().toISOString(),
        },
        files: [{
          name: 'screenshot.png',
          dataUrl,
          size: imageBuffer.length,
          mediaType: 'image/png',
        }],
      };
    } catch (error) {
      // Clean up temp file if it exists
      await unlink(tempPath).catch(() => {});

      return {
        success: false,
        error: `Screenshot capture failed: ${String(error)}`,
      };
    }
  }
}
