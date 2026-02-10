/**
 * Run Python Native Tool
 *
 * Executes Python code using an embedded Python runtime.
 * Supports two engines:
 * - pyodide: Full Python runtime with numpy, pandas, matplotlib, plotly support
 * - monty: Fast, sandboxed Python interpreter (subset of Python, no external packages)
 *
 * Set PYTHON_ENGINE env var to 'monty' or 'pyodide' (default: 'pyodide')
 */

import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';
import { Mutex } from 'async-mutex';
import type { NativeTool, NativeToolResult } from './types.js';

// Dynamic import for monty (ES module)
type MontyModule = typeof import('@pydantic/monty');
let montyModule: MontyModule | null = null;

async function getMontyModule(): Promise<MontyModule> {
  if (!montyModule) {
    montyModule = await import('@pydantic/monty');
  }
  return montyModule;
}

// Get Python engine from environment
type PythonEngine = 'pyodide' | 'monty';
function getPythonEngine(): PythonEngine {
  const engine = process.env.PYTHON_ENGINE?.toLowerCase();
  if (engine === 'monty') return 'monty';
  return 'pyodide'; // default
}

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

  get description(): string {
    const engine = getPythonEngine();
    if (engine === 'monty') {
      return 'Execute Python code using Monty - a fast, sandboxed Python interpreter. Runs a SUBSET of Python with microsecond startup times. HARD LIMITATIONS: (1) No "with" statements (context managers). (2) No "class" definitions. (3) No "match" statements. (4) No external packages - only builtins. (5) Limited stdlib (only sys, typing, asyncio). (6) No filesystem/network. (7) print() not captured - use output() function instead. Best for: simple calculations, list/dict operations, basic algorithms. For full Python with packages, file I/O, or advanced features, switch to pyodide engine.';
    }
    return 'Execute Python code using Pyodide - full Python runtime in Node.js. Supports standard library, numpy, pandas, matplotlib, plotly, and other scientific packages. Returns stdout, stderr, and returned values. Can generate plots and visualizations (images are auto-detected and returned). Note: Do not attempt to display generated images in your response - the user can preview them in the tool result UI. LIMITATION: No network access - requests, urllib, and HTTP calls will fail. For data that requires fetching from APIs, either: (1) use web_search or web_fetch tools first to get the data, then pass it as a literal/embedded value in the Python code, or (2) generate sample/mock data for demonstration purposes.';
  }

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
          'Optional list of additional Python packages to load (e.g., ["numpy", "pandas", "matplotlib", "plotly"]). Common packages are pre-loaded. NOTE: Only supported with pyodide engine; ignored with monty.',
      }
    },
    required: ['code'],
  };

  private pyodide: PyodideInterface | null = null;
  private initPromise: Promise<void> | null = null;
  private pyodideMutex = new Mutex(); // Serialize Pyodide execution

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
      // Convert Uint8Array to base64 without building an intermediate string
      return Buffer.from(data).toString('base64');
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

  /**
   * Clean up output files from previous runs to ensure isolation
   */
  private cleanupOutputFiles(): void {
    if (!this.pyodide) return;

    try {
      const files = this.listFiles();
      const fs = this.pyodide.FS;

      for (const file of files) {
        const ext = this.getExtension(file);
        if (OUTPUT_FILE_EXTENSIONS.includes(ext)) {
          try {
            fs.unlink(`/home/pyodide/${file}`);
          } catch {
            // Ignore errors - file may not exist
          }
        }
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Main execute method - dispatches to the appropriate engine
   */
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

    const engine = getPythonEngine();

    if (engine === 'monty') {
      return this.executeWithMonty(code);
    } else {
      return this.executeWithPyodide(code, packages);
    }
  }

  /**
   * Execute Python code using Monty (fast, sandboxed interpreter)
   *
   * Note: Monty has a built-in print() that can't be overridden.
   * We provide an output() function for explicit output capture.
   */
  private async executeWithMonty(code: string): Promise<NativeToolResult> {
    try {
      const { Monty, MontyRuntimeError, MontySyntaxError, runMontyAsync } = await getMontyModule();

      const start = performance.now();

      // Capture output using custom external function
      // Note: print() is a monty builtin that can't be overridden
      const outputLines: string[] = [];

      // Create Monty instance with 'output' as external function
      const monty = new Monty(code, {
        externalFunctions: ['output'],
      });

      let result: unknown = null;
      let executionError: string | null = null;

      try {
        // Run with output() captured via external function
        result = await runMontyAsync(monty, {
          externalFunctions: {
            output: (...args: unknown[]) => {
              // Filter out the kwargs object that monty passes as the last argument
              // (it's always an empty {} for regular calls)
              const filteredArgs = args.filter(arg => {
                // Skip empty kwargs objects
                if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
                  const keys = Object.keys(arg as object);
                  return keys.length > 0; // Only keep non-empty objects
                }
                return true;
              });

              // Similar to print(): join args with space
              const line = filteredArgs.map(arg => {
                if (Array.isArray(arg)) {
                  return JSON.stringify(arg);
                }
                if (typeof arg === 'object' && arg !== null) {
                  return JSON.stringify(arg);
                }
                return String(arg);
              }).join(' ');
              outputLines.push(line);
              return null; // output() returns None
            },
          },
        });
      } catch (err) {
        if (err instanceof MontyRuntimeError) {
          executionError = err.display('traceback');
        } else if (err instanceof MontySyntaxError) {
          executionError = err.display('type-msg');
        } else {
          executionError = err instanceof Error ? err.message : String(err);
        }
      }

      const elapsed = performance.now() - start;

      // Build output from captured output() calls
      let output = outputLines.join('\n');

      // Add return value if present and meaningful
      if (result !== undefined && result !== null) {
        const resultStr = typeof result === 'object' ? JSON.stringify(result) : String(result);
        // Only show result if it's not None/null
        if (resultStr !== 'null' && resultStr !== 'None') {
          output = output ? `${output}\n=> ${resultStr}` : `=> ${resultStr}`;
        }
      }

      if (!output && !executionError) {
        output = `Code executed successfully in ${elapsed.toFixed(2)}ms (monty engine)`;
      }

      return {
        success: !executionError,
        output: output || undefined,
        error: executionError || undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to execute Python code with Monty: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Execute Python code using Pyodide (full Python runtime)
   * Uses mutex to serialize execution since Pyodide instance is shared.
   */
  private async executeWithPyodide(
    code: string,
    packages: string[]
  ): Promise<NativeToolResult> {
    // Use runExclusive to serialize Pyodide access (auto-releases on completion)
    return this.pyodideMutex.runExclusive(async () => {
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

      // Clean up output files from previous runs to ensure isolation
      this.cleanupOutputFiles();

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
        // Auto-detect common output files
        const allFiles = this.listFiles();
        const filesToExtract = allFiles.filter((name) =>
          OUTPUT_FILE_EXTENSIONS.includes(this.getExtension(name))
        );

        // Extract each file
        for (const filePath of filesToExtract) {
          const base64 = this.readFileAsBase64(filePath);
          if (base64) {
            const ext = this.getExtension(filePath);
            const mediaType = MEDIA_TYPE_MAP[ext] || 'application/octet-stream';
            const dataUrl = `data:${mediaType};base64,${base64}`;
            extractedFiles.push({
              name: filePath,
              dataUrl,
              size: Math.round((base64.length * 3) / 4),
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
    }); // runExclusive auto-releases mutex
  }
}
