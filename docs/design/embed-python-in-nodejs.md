# Embedding an Isolated Python Runtime in Node.js

## Problem Statement

We need to run dynamically generated Python code from within a Node.js application. The Python runtime must be **isolated from any system Python installation** — fully self-contained and bundled with the application.

## Requirements

1. **Embeddable within Node.js** — runs inside or alongside the Node.js process
2. **Execute dynamic code** — run Python code strings generated at runtime
3. **Isolated from system Python** — no dependency on host Python installation

## Options Evaluated

### 1. Pyodide (WebAssembly) — RECOMMENDED

| Attribute | Detail |
|---|---|
| npm package | `pyodide` |
| Architecture | CPython compiled to WebAssembly via Emscripten |
| System Python required | **No** |
| Dynamic code execution | Yes (`runPython()` / `runPythonAsync()`) |
| GitHub stars | ~14,200 |
| Maintenance | Actively maintained, frequent releases (0.29.x, built on Python 3.13) |

**How it works:** Pyodide is the full CPython interpreter compiled to WebAssembly. When loaded in Node.js via `loadPyodide()`, it runs entirely in the V8 WASM runtime. Python code is passed as strings to `runPython()`. It includes a full JS↔Python FFI for exchanging objects between runtimes.

**Strengths:**
- Complete isolation — bundles its own CPython as WASM, zero system Python dependency
- Rich package ecosystem — supports pure Python wheels from PyPI via `micropip.install()`
- Many C-extension packages pre-built (numpy, pandas, scipy, scikit-learn, etc.)
- Mature project with strong community and funding (originated at Mozilla)
- Sandboxed execution — no native filesystem or network access from Python

**Weaknesses:**
- **Startup latency:** Several seconds to load the WASM binary + packages
- **Performance:** 2–8x slower than native CPython depending on workload
- **Memory:** WASM linear memory model has constraints
- **Single-threaded:** No true Python threading/multiprocessing
- **C extensions:** Custom C extensions require recompilation for Emscripten
- **Binary size:** WASM binary is several MB

**Basic usage:**

```js
import { loadPyodide } from "pyodide";

const pyodide = await loadPyodide();

// Run dynamically generated Python code
const code = `
import json
result = {"sum": 1 + 2, "product": 3 * 4}
json.dumps(result)
`;

const result = pyodide.runPython(code);
console.log(result); // '{"sum": 3, "product": 12}'

// Install packages at runtime
await pyodide.loadPackage("micropip");
const micropip = pyodide.pyimport("micropip");
await micropip.install("some-pure-python-package");
```

---

### 2. python-wasm / CoWasm (Alternative WASM)

| Attribute | Detail |
|---|---|
| npm package | `python-wasm` |
| Architecture | CPython compiled to WASM via Zig |
| System Python required | **No** |
| Dynamic code execution | Yes |
| Maintenance | **Dormant** — last published ~3 years ago |

Built with Zig instead of Emscripten, offering higher recursion limits and a smaller toolchain. However, the project is effectively abandoned. **Not recommended for production.**

---

### 3. @platformatic/python-node (Rust/N-API Bridge)

| Attribute | Detail |
|---|---|
| npm package | `@platformatic/python-node` |
| Architecture | Rust N-API addon embedding CPython in-process |
| System Python required | **Yes** (Python 3.8+) |
| Dynamic code execution | Partial — ASGI-focused, not general-purpose eval |
| Maintenance | Active (2025, backed by Platformatic) |

Embeds CPython directly in the Node.js process via a Rust native addon. Designed for running Python ASGI web frameworks (FastAPI, Starlette, Django) from Node.js. Near-native performance with microsecond-level latency for in-process calls.

**Disqualified:** Requires system Python installation. ASGI-focused rather than general-purpose code execution.

---

### 4. node-calls-python (N-API/CPython C API)

| Attribute | Detail |
|---|---|
| npm package | `node-calls-python` |
| Architecture | N-API addon using CPython C API |
| System Python required | **Yes** (needs `python3-dev` headers) |
| Dynamic code execution | Yes |
| Maintenance | Low activity, single maintainer |

Embeds CPython in-process using the C API. Supports calling Python functions, importing modules, and exchanging data. Near-native performance.

**Disqualified:** Requires system Python and native build tools. Single maintainer with known stability issues (worker thread crashes).

---

### 5. python-shell (Subprocess)

| Attribute | Detail |
|---|---|
| npm package | `python-shell` |
| Architecture | `child_process` spawn |
| System Python required | **Yes** |
| Dynamic code execution | Yes |
| Weekly downloads | ~81,000 (most popular by downloads) |

Spawns Python as a subprocess, communicating via stdin/stdout. Simple and widely used but the slowest approach with full dependency on system Python.

**Disqualified:** Requires system Python. Process spawn overhead per invocation.

---

### 6. JSPyBridge / pythonia (IPC Bridge)

| Attribute | Detail |
|---|---|
| npm package | `pythonia` |
| Architecture | Bidirectional IPC bridge with transparent object proxying |
| System Python required | **Yes** (Python 3.8+) |
| Dynamic code execution | Yes |
| GitHub stars | ~3,500 |

Provides transparent cross-language object proxying — operate on Python objects from JS as if local. Supports callbacks and cross-language class inheritance.

**Disqualified:** Requires system Python.

---

## Comparison Summary

| Solution | Isolated | Dynamic Code | Performance | Maintained | Verdict |
|---|---|---|---|---|---|
| **Pyodide** | Yes | Yes | 2–8x slower | Yes | **Recommended** |
| python-wasm | Yes | Yes | ~same as Pyodide | No (dormant) | Not viable |
| @platformatic/python-node | No | Partial | Near-native | Yes | Wrong use case |
| node-calls-python | No | Yes | Near-native | Low | Needs system Python |
| python-shell | No | Yes | Slow (subprocess) | Yes | Needs system Python |
| JSPyBridge | No | Yes | Moderate (IPC) | Moderate | Needs system Python |

## Recommendation

**Pyodide is the only mature, actively maintained option that satisfies all three requirements** (embeddable, dynamic code execution, isolated from system Python).

The key tradeoffs to plan for:

1. **Startup cost:** Pre-load the Pyodide instance at application startup and reuse it across requests. Consider a warm pool if multiple isolated contexts are needed.
2. **Package loading:** Pre-load commonly needed packages during initialization rather than on-demand.
3. **Performance:** Acceptable for code generation/execution workflows where the bottleneck is typically LLM inference, not Python execution speed.
4. **Memory:** Monitor WASM memory usage if executing many scripts; consider periodically recycling the Pyodide instance.

For our use case (running LLM-generated Python code), the startup and performance penalties are acceptable since LLM response latency dwarfs Python execution time, and the isolation guarantee is critical for both correctness and security.
