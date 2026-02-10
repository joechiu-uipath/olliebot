/**
 * Run Python Native Tool
 *
 * Executes Python code using Pyodide (Python runtime in Node.js).
 * Supports standard library, numpy, pandas, matplotlib, plotly, and more.
 */

import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';
import type { NativeTool, NativeToolResult } from './types.js';

// Common output file extensions to auto-detect
const OUTPUT_FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.pdf', '.csv', '.json', '.html'];

// Map file extensions to media types
const MEDIA_TYPE_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
};

export class RunPythonTool implements NativeTool {
  readonly name = 'run_python';
  readonly description =
    'Execute Python code using an embedded Python runtime - Pyodide. Supports standard library, numpy, pandas, matplotlib, plotly, and other scientific packages. Returns stdout, stderr, and returned values. Can generate plots and visualizations (images are auto-detected and returned). Note: Do not attempt to display generated images in your response - the user can preview them in the tool result UI. LIMITATION: No network access - requests, urllib, and HTTP calls will fail. For data that requires fetching from APIs, either: (1) use web_search or web_fetch tools first to get the data, then pass it as a literal/embedded value in the Python code, or (2) generate sample/mock data for demonstration purposes.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute',
      },
      packages: {
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          'Optional list of additional Python packages to load (e.g., ["numpy", "pandas", "matplotlib", "plotly"]). Common packages are pre-loaded.',
      },
      outputFiles: {
        type: 'array',
        items: {
          type: 'string',
        },
        description:
          'Optional list of specific file paths to extract. If not provided, common output files (*.png, *.jpg, *.svg, *.pdf, *.csv, *.json, *.html) are auto-detected and returned as base64.',
      },
    },
    required: ['code'],
  };

  private pyodide: PyodideInterface | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {}

  private async ensurePyodideLoaded(): Promise<void> {
    if (this.pyodide) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        console.log('Loading Pyodide...');
        // In Node.js, loadPyodide uses the bundled files from the npm package
        this.pyodide = await loadPyodide();

        // Pre-load common packages
        console.log('Loading common Python packages...');
        await this.pyodide.loadPackage(['numpy', 'pandas', 'matplotlib', 'micropip']);

        // Configure matplotlib to use Agg backend (non-interactive, no DOM required)
        // This MUST be done before any pyplot imports to avoid webagg backend errors
        this.pyodide.runPython(`
import matplotlib
matplotlib.use('Agg')
`);

        // Install plotly using micropip
        await this.pyodide.runPythonAsync(`
import micropip
await micropip.install('plotly')
`);

        console.log('Pyodide and packages loaded successfully');
      } catch (error) {
        this.pyodide = null;
        this.initPromise = null;
        throw error;
      }
    })();

    return this.initPromise;
  }

  /**
   * List files in Pyodide's virtual filesystem root directory
   */
  private listFiles(): string[] {
    if (!this.pyodide) return [];

    try {
      const fs = this.pyodide.FS;
      const entries = fs.readdir('/home/pyodide');
      return entries.filter((name: string) => {
        if (name === '.' || name === '..') return false;
        try {
          const stat = fs.stat(`/home/pyodide/${name}`);
          return fs.isFile(stat.mode);
        } catch {
          return false;
        }
      });
    } catch {
      return [];
    }
  }

  /**
   * Read a file from Pyodide's virtual filesystem as base64
   */
  private readFileAsBase64(filePath: string): string | null {
    if (!this.pyodide) return null;

    try {
      const fs = this.pyodide.FS;
      const fullPath = filePath.startsWith('/') ? filePath : `/home/pyodide/${filePath}`;
      const data = fs.readFile(fullPath);
      // Convert Uint8Array to base64
      let binary = '';
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      return Buffer.from(binary, 'binary').toString('base64');
    } catch {
      return null;
    }
  }

  /**
   * Get file extension from filename
   */
  private getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const code = String(params.code || '');
    const packages = Array.isArray(params.packages)
      ? (params.packages as string[])
      : [];
    const outputFiles = Array.isArray(params.outputFiles)
      ? (params.outputFiles as string[])
      : [];

    if (!code.trim()) {
      return {
        success: false,
        error: 'code parameter is required',
      };
    }

    try {
      // Ensure Pyodide is loaded
      await this.ensurePyodideLoaded();

      if (!this.pyodide) {
        throw new Error('Failed to load Pyodide');
      }

      // Load additional packages if requested
      if (packages.length > 0) {
        try {
          await this.pyodide.loadPackage(packages);
        } catch {
          // If standard packages fail, try micropip for each
          for (const pkg of packages) {
            try {
              await this.pyodide.runPythonAsync(
                `import micropip; await micropip.install(${JSON.stringify(pkg)})`
              );
            } catch (micropipError) {
              console.warn(`Failed to install package ${pkg}:`, micropipError);
            }
          }
        }
      }

      // Set up stdout/stderr capture using Pyodide's globals
      this.pyodide.runPython(`
import sys
import io

_stdout_capture = io.StringIO()
_stderr_capture = io.StringIO()
_original_stdout = sys.stdout
_original_stderr = sys.stderr
sys.stdout = _stdout_capture
sys.stderr = _stderr_capture
`);

      // Execute the user code
      let executionError: string | null = null;
      let executionResult: unknown = null;

      try {
        // Wrap code in try-finally to ensure streams are restored
        executionResult = await this.pyodide.runPythonAsync(code);
      } catch (err) {
        executionError = err instanceof Error ? err.message : String(err);
      }

      // Capture output and restore streams
      this.pyodide.runPython(`
sys.stdout = _original_stdout
sys.stderr = _original_stderr
`);

      const stdout = this.pyodide.globals.get('_stdout_capture').getvalue() as string;
      const stderr = this.pyodide.globals.get('_stderr_capture').getvalue() as string;

      // Clean up capture objects
      this.pyodide.runPython(`
del _stdout_capture, _stderr_capture, _original_stdout, _original_stderr
`);

      // Extract output files from virtual filesystem
      const extractedFiles: Array<{
        name: string;
        dataUrl: string;
        size: number;
        mediaType: string;
      }> = [];

      if (!executionError) {
        // Determine which files to extract
        let filesToExtract = outputFiles;

        // If no files specified, auto-detect common output files
        if (filesToExtract.length === 0) {
          const allFiles = this.listFiles();
          filesToExtract = allFiles.filter((name) =>
            OUTPUT_FILE_EXTENSIONS.includes(this.getExtension(name))
          );
        }

        // Extract each file
        for (const filePath of filesToExtract) {
          const base64 = this.readFileAsBase64(filePath);
          if (base64) {
            const ext = this.getExtension(filePath);
            const mediaType = MEDIA_TYPE_MAP[ext] || 'application/octet-stream';
            // Build full data URL with MIME type for inline display and truncation exemption
            const dataUrl = `data:${mediaType};base64,${base64}`;
            extractedFiles.push({
              name: filePath,
              dataUrl,
              size: Math.round((base64.length * 3) / 4), // Approximate decoded size
              mediaType,
            });
          }
        }
      }

      // Build error string from stderr + execution error
      const errorParts: string[] = [];
      if (stderr) {
        errorParts.push(stderr);
      }
      if (executionError) {
        errorParts.push(executionError);
      }
      const errorOutput = errorParts.join('\n').trim() || undefined;

      return {
        success: !executionError,
        output: stdout || (executionError ? undefined : 'Code executed successfully.'),
        error: errorOutput,
        files: extractedFiles.length > 0 ? extractedFiles : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute Python code: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
