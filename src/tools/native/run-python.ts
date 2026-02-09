/**
 * Run Python Native Tool
 *
 * Executes Python code using Pyodide (Python runtime in Node.js).
 * Supports standard library, numpy, pandas, matplotlib, plotly, and more.
 */

import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';
import type { NativeTool, NativeToolResult } from './types.js';

export class RunPythonTool implements NativeTool {
  readonly name = 'run_python';
  readonly description =
    'Execute Python code using Pyodide. Supports standard library, numpy, pandas, matplotlib, plotly, and other scientific packages. Returns the output of the code execution including stdout, stderr, and any returned values. Can generate plots and visualizations.';
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
        this.pyodide = await loadPyodide({
          indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
        });

        // Pre-load common packages including Plotly
        console.log('Loading common Python packages...');
        await this.pyodide.loadPackage(['numpy', 'pandas', 'matplotlib', 'micropip']);

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

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const code = String(params.code || '');
    const packages = Array.isArray(params.packages)
      ? (params.packages as string[])
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
        } catch (error) {
          // If standard packages fail, try micropip
          for (const pkg of packages) {
            try {
              await this.pyodide.runPythonAsync(`
                import micropip
                await micropip.install('${pkg}')
              `);
            } catch (micropipError) {
              console.warn(`Failed to install package ${pkg}:`, micropipError);
            }
          }
        }
      }

      // Set up stdout/stderr capture
      const captureCode = `
import sys
import io
from js import Object

_stdout_capture = io.StringIO()
_stderr_capture = io.StringIO()
_original_stdout = sys.stdout
_original_stderr = sys.stderr
sys.stdout = _stdout_capture
sys.stderr = _stderr_capture

_result = None
_error = None

try:
${code
  .split('\n')
  .map((line) => '    ' + line)
  .join('\n')}
except Exception as e:
    _error = str(e)
    import traceback
    _error = traceback.format_exc()
finally:
    sys.stdout = _original_stdout
    sys.stderr = _original_stderr

_output = {
    'stdout': _stdout_capture.getvalue(),
    'stderr': _stderr_capture.getvalue(),
    'result': str(_result) if _result is not None else None,
    'error': _error
}
_output
`;

      // Execute the code
      const result = await this.pyodide.runPythonAsync(captureCode);
      const output = result.toJs({ dict_converter: Object.fromEntries });

      // Build output message
      let outputText = '';

      if (output.stdout) {
        outputText += `STDOUT:\n${output.stdout}\n\n`;
      }

      if (output.stderr && !output.error) {
        outputText += `STDERR:\n${output.stderr}\n\n`;
      }

      if (output.result !== null) {
        outputText += `RESULT:\n${output.result}\n\n`;
      }

      if (output.error) {
        outputText += `ERROR:\n${output.error}`;
      }

      if (!outputText.trim()) {
        outputText = 'Code executed successfully with no output.';
      }

      return {
        success: !output.error,
        output: outputText.trim(),
        error: output.error || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute Python code: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
