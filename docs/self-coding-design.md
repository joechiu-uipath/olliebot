# Self-Coding System Design

This document describes the architecture and design of OlliBot's self-modifying code system, which allows users to request frontend UI changes through natural language conversation.

## Overview

The self-coding system enables OlliBot to modify its own React frontend codebase through a structured multi-agent workflow. This provides a proof-of-concept for AI-assisted software development within a controlled, sandboxed environment.

### Key Principles

1. **Separation of Concerns**: Different agents handle orchestration, planning, execution, and error recovery
2. **Least Privilege**: Each agent only has access to the tools it needs
3. **Sequential Execution**: All agents execute ONE AT A TIME to avoid race conditions and file conflicts
4. **Validation**: All changes are verified through build checks before reporting success
5. **Error Recovery**: Build failures trigger automated Code Fixer to resolve issues
6. **Sandboxing**: All file operations are restricted to the `/web` directory

## Architecture

### Workflow DAG (Sequential Execution)

**IMPORTANT: All execution is SEQUENTIAL - one agent at a time, no parallelism.**

```
User Request
     │
     ▼
┌─────────────┐
│  Supervisor │ (routes requests)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Coding Lead │ (orchestrates - ONE planner at a time)
└──────┬──────┘
       │
       ▼
┌──────────────┐
│Coding Planner│ (ONE instance, executes workers sequentially)
└──────┬───────┘
       │
       │  ┌──────────────────────────────────────┐
       │  │ SEQUENTIAL LOOP (one worker at a time)│
       │  │                                        │
       │  │  Worker 1 → wait → inspect result     │
       │  │       ↓                               │
       │  │  Worker 2 → wait → inspect result     │
       │  │       ↓                               │
       │  │  Worker N → wait → inspect result     │
       │  │       ↓                               │
       │  │  Return aggregated results            │
       │  └──────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────┐
│              /web Directory                   │
│  (React 19 Frontend Codebase)                │
└──────────────────────────────────────────────┘
       │
       ▼
┌─────────────┐
│ Coding Lead │ (validates build)
└──────┬──────┘
       │ check_frontend_code
       │
   ┌───┴───┐
   │ Pass? │
   └───┬───┘
       │
  ┌────┴────┐
 Yes       No
  │         │
  ▼         ▼
Report   ┌───────────┐
Success  │Code Fixer │ (ONE instance, wait for completion)
         └─────┬─────┘
               │
               ▼
         ┌───────────┐
         │ Re-check  │◄──┐
         │ build     │   │
         └─────┬─────┘   │
               │         │
          ┌────┴────┐    │
          │ Pass?   │    │
          └────┬────┘    │
               │         │
          ┌────┴────┐    │
         Yes       No────┘
          │       (max 3)
          ▼
       Report
       Success
```

### Agent Responsibilities

| Agent | Role | Tools Available | Can Delegate To |
|-------|------|-----------------|-----------------|
| **Supervisor** | Routes user requests to appropriate specialists | All tools except `read_frontend_code`, `modify_frontend_code`, `check_frontend_code` | `coding-lead` |
| **Coding Lead** | Orchestrates workflow, validates builds, reports results | `read_skill`, `delegate`, `check_frontend_code` | `coding-planner`, `code-fixer` |
| **Coding Planner** | Analyzes requests, creates change plans, coordinates workers | `read_frontend_code`, `delegate` | `coding-worker` |
| **Coding Worker** | Executes individual atomic code changes | `read_frontend_code`, `modify_frontend_code` | None |
| **Code Fixer** | Fixes build errors (syntax, imports, brackets) | `read_frontend_code`, `modify_frontend_code`, `check_frontend_code` | None |

### Workflow Restrictions

- All self-coding agents are restricted to the `self-coding` workflow
- Supervisor cannot directly invoke Coding Planner, Coding Worker, or Code Fixer
- Coding Lead cannot directly invoke Coding Worker (must go through Planner)
- This ensures proper orchestration and prevents bypassing the planning phase

### Sequential Execution Model

**Critical: All agents execute ONE AT A TIME to prevent race conditions and file conflicts.**

| Level | Constraint |
|-------|------------|
| Coding Lead | Launches ONE Coding Planner, waits for completion before proceeding |
| Coding Lead | Launches ONE Code Fixer (if needed), waits for completion |
| Coding Planner | Launches ONE Coding Worker at a time, waits and inspects result |
| Coding Planner | Decides next action based on worker result (retry, next change, or complete) |

**Why Sequential?**
1. **File Safety**: Prevents multiple workers from editing the same file simultaneously
2. **Dependency Tracking**: Later changes may depend on earlier changes succeeding
3. **Error Recovery**: Planner can adapt strategy based on each worker's result
4. **Debugging**: Easier to trace issues when changes are applied one at a time

### Output Formats

| Agent | Output Format | Description |
|-------|---------------|-------------|
| Supervisor | Natural language | User-facing conversational response |
| Coding Lead | Markdown | User-facing status report with tables |
| Coding Planner | JSON only | Machine-readable plan and execution results |
| Coding Worker | JSON only | Machine-readable change result |
| Code Fixer | JSON only | Machine-readable fix result |

## Tools

### read_frontend_code

**Purpose**: Read-only access to examine files and directories in `/web`

**Location**: `src/tools/native/read-frontend-code.ts`

**Input Schema**:
```json
{
  "path": "src/App.jsx"
}
```

**Operations**:
- Read file content (returns content, line count, size)
- List directory contents (returns entries with types and sizes)

**Security**:
- Path validation ensures all reads stay within `/web`
- Path traversal (`../`) is blocked

---

### modify_frontend_code

**Purpose**: Write operations for creating, editing, and deleting files in `/web`

**Location**: `src/tools/native/modify-frontend-code.ts`

**Input Schema**:
```json
{
  "file_path": "src/components/Button.jsx",
  "operation": "create|edit|delete",
  "edit_type": "replace|insert_before|insert_after|append|prepend|full_replace|replace_line|insert_at_line",
  "target": "string to find (for replace/insert)",
  "line_number": 42,
  "content": "content to write",
  "description": "what this change does"
}
```

**Operations**:
| Operation | Description | Required Fields |
|-----------|-------------|-----------------|
| `create` | Create a new file (fails if exists) | `file_path`, `content` |
| `edit` | Modify an existing file | `file_path`, `edit_type`, `content` |
| `delete` | Remove a file | `file_path` |

**Edit Types**:
| Type | Description | Required |
|------|-------------|----------|
| `replace` | Find `target` and replace with `content` | `target`, `content` |
| `insert_before` | Insert `content` before `target` | `target`, `content` |
| `insert_after` | Insert `content` after `target` | `target`, `content` |
| `append` | Add `content` to end of file | `content` |
| `prepend` | Add `content` to beginning of file | `content` |
| `full_replace` | Replace entire file with `content` | `content` |
| `replace_line` | Replace line at `line_number` with `content` | `line_number`, `content` |
| `insert_at_line` | Insert `content` at `line_number` | `line_number`, `content` |

**Best Practices**:
- Use `append`/`prepend` when possible (no target needed, most reliable)
- Use `replace_line`/`insert_at_line` for precise edits (avoids whitespace issues)
- For targeted edits, use SHORT unique strings (single line is best)
- Always read the file first to find exact targets or line numbers

**Error Handling**:
- When target string is not found, the tool provides helpful error messages
- Shows similar content found in the file with line numbers
- Suggests using line-based operations for precise edits

**Security**:
- Path validation ensures all writes stay within `/web`
- Protected files cannot be deleted: `main.jsx`, `index.html`, `vite.config.js`, `package.json`

---

### check_frontend_code

**Purpose**: Validate frontend code integrity by running build/lint commands

**Location**: `src/tools/native/check-frontend-code.ts`

**Input Schema**:
```json
{
  "check": "build|lint|typecheck|all",
  "timeout": 60000
}
```

**Operations**:
| Check | Command | Description |
|-------|---------|-------------|
| `build` | `npm run build` | Verify code compiles (recommended) |
| `lint` | `npm run lint` | Check code style (if available) |
| `typecheck` | `npm run typecheck` | TypeScript type checking (if available) |
| `all` | All of above | Run all available checks in sequence |

**Output**: Returns pass/fail status with stdout/stderr for debugging

---

### read_skill

**Purpose**: Read skill files to understand codebase structure and conventions

**Location**: `src/tools/native/read-skill.ts`

**Usage**: Coding Lead reads the `frontend-modifier` skill to understand:
- Frontend directory structure
- Technology stack (React 19, Vite, etc.)
- Coding conventions
- Available components and patterns

## Workflow Phases

### Phase 1: Preparation
1. Supervisor receives user request for frontend modification
2. Supervisor delegates to Coding Lead
3. Coding Lead reads `frontend-modifier` skill to understand codebase

### Phase 2: Planning & Execution
1. Coding Lead delegates to Coding Planner with full request details
2. Coding Planner uses `read_frontend_code` to examine:
   - Relevant source files
   - Directory structure
   - Existing patterns
3. Coding Planner creates a change plan and delegates to Coding Workers
4. Workers execute changes and return JSON results
5. Planner aggregates results and returns to Coding Lead

**Planner Output Format**:
```json
{
  "status": "completed|partial|failed",
  "plan": {
    "summary": "Add weather widget to header",
    "total_changes": 3,
    "changes": [...]
  },
  "results": [
    {"change_id": "1", "status": "success", "file_path": "..."},
    {"change_id": "2", "status": "failed", "error": "..."}
  ],
  "files_modified": ["src/components/Widget.jsx"],
  "files_failed": ["src/App.jsx"]
}
```

### Phase 3: Build Validation
1. Coding Lead runs `check_frontend_code` with `check: "build"`
2. If build passes → Proceed to reporting
3. If build fails → Enter error recovery loop

### Phase 4: Error Recovery (if needed)
1. Coding Lead delegates to Code Fixer with build error output
2. Code Fixer:
   - Analyzes error messages (line numbers, error types)
   - Reads affected files
   - Applies targeted fixes
   - Verifies fix with `check_frontend_code`
3. If still failing, repeat (max 3 attempts)
4. Code Fixer returns JSON result

**Code Fixer Output Format**:
```json
{
  "status": "fixed|failed",
  "fixes_applied": [
    {
      "file": "src/App.jsx",
      "line": 45,
      "error_type": "mismatched_tag",
      "description": "Changed </span> to </div>",
      "success": true
    }
  ],
  "build_status": "pass|fail",
  "remaining_errors": [],
  "attempts": 2
}
```

### Phase 5: Reporting
Coding Lead reports to user in markdown format:

**Success**:
```markdown
## Frontend Modification Complete

### Summary
Added weather widget component to the application header.

### Changes Made
| File | Operation | Status |
|------|-----------|--------|
| src/components/WeatherWidget.jsx | created | ✓ |
| src/App.jsx | edited | ✓ |

### Build Status
✅ Build passed

### Notes
The widget displays current temperature fetched from the weather API.
```

**Failure**:
```markdown
## Frontend Modification Failed

### Summary
Attempted to add weather widget but encountered errors.

### Issues
- Target string not found in App.jsx
- Build failed with syntax error

### Partial Changes
- src/components/WeatherWidget.jsx was created

### Recommendation
Review App.jsx manually or provide more specific modification instructions.
```

## File Structure

```
src/
├── agents/
│   ├── coding-lead.md      # Coding Lead system prompt
│   ├── coding-planner.md   # Coding Planner system prompt
│   ├── coding-worker.md    # Coding Worker system prompt
│   ├── code-fixer.md       # Code Fixer system prompt
│   └── registry.ts         # Agent templates and tool access
├── tools/native/
│   ├── read-frontend-code.ts   # Read-only file access
│   ├── modify-frontend-code.ts # Write file operations
│   └── check-frontend-code.ts  # Build validation
├── skills/builtin/
│   └── frontend-modifier/
│       └── SKILL.md        # Frontend codebase documentation
└── self-coding/
    ├── constants.ts        # Workflow constants
    └── types.ts            # TypeScript interfaces
```

## Security Considerations

### Path Sandboxing
- All file operations are restricted to `/web` directory
- Path traversal attempts (`../`) are rejected
- Paths are normalized and validated before use

### Protected Files
- Critical files cannot be deleted: `main.jsx`, `index.html`, `vite.config.js`, `package.json`
- These files can still be edited (with caution)

### Tool Access Control
- Supervisor cannot directly access frontend code tools
- Only Coding Workers and Code Fixer can write files
- Coding Planner has read-only access
- Workflow restrictions prevent bypassing the orchestration

### Build Validation
- Changes are validated through `npm run build` before reporting success
- Failed builds trigger Code Fixer for automated repair
- Users are informed of any unresolved issues

### Error Recovery Limits
- Code Fixer limited to 3 fix attempts per failure
- Prevents infinite loops on unfixable errors
- Reports failure with details for manual intervention

## Configuration

### Workflow Constants (`src/self-coding/constants.ts`)

```typescript
export const SELF_CODING_WORKFLOW_ID = 'self-coding';
export const MAX_CHANGES_PER_REQUEST = 10;
export const MAX_PARALLEL_WORKERS = 3;
export const MAX_FIX_ATTEMPTS = 3;
export const BUILD_TIMEOUT_MS = 60000;
export const FRONTEND_BASE_PATH = 'web';
```

### Protected Files

```typescript
export const PROTECTED_FILES = [
  'src/main.jsx',
  'index.html',
  'vite.config.js',
  'package.json',
];
```

## Future Enhancements

1. **Git Integration**: Add tools for staging and committing changes
2. **Rollback Support**: Ability to revert changes on build failure
3. **Preview Mode**: Show diff before applying changes
4. **Test Execution**: Run tests as part of validation
5. **Lint Auto-fix**: Automatically fix style issues
6. **Component Library**: Pre-built components the system can use
7. **Multi-file Diffs**: Show unified diff of all changes before execution
8. **Caching**: Cache file reads to reduce redundant I/O
