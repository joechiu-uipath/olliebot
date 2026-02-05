# Self-Coding System Design

This document describes the architecture and design of OlliBot's self-modifying code system, which allows users to request frontend UI changes through natural language conversation.

## Overview

The self-coding system enables OlliBot to modify its own React frontend codebase through a structured multi-agent workflow. This provides a proof-of-concept for AI-assisted software development within a controlled, sandboxed environment.

### Key Principles

1. **Separation of Concerns**: Different agents handle planning vs. execution
2. **Least Privilege**: Each agent only has access to the tools it needs
3. **Validation**: All changes are verified through build checks before reporting success
4. **Sandboxing**: All file operations are restricted to the `/web` directory

## Architecture

### Workflow DAG

```
User Request
     │
     ▼
┌─────────────┐
│  Supervisor │ (delegates, no frontend code access)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Coding Lead │ (orchestrates, validates)
└──────┬──────┘
       │
       ├──────────────────────────────────┐
       │                                  │
       ▼                                  ▼
┌──────────────┐                  ┌───────────────┐
│Coding Planner│ (plans)          │ Coding Worker │ (executes) ×N
└──────────────┘                  └───────────────┘
       │                                  │
       │ read_frontend_code               │ read_frontend_code
       │                                  │ modify_frontend_code
       │                                  │
       ▼                                  ▼
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
       ▼
   Report Results
```

### Agent Responsibilities

| Agent | Role | Tools Available |
|-------|------|-----------------|
| **Supervisor** | Routes user requests to appropriate specialists | All tools except `read_frontend_code`, `modify_frontend_code` |
| **Coding Lead** | Orchestrates the workflow, validates builds | `read_skill`, `delegate`, `check_frontend_code` |
| **Coding Planner** | Analyzes requests, creates structured change plans | `read_frontend_code` (read-only) |
| **Coding Worker** | Executes individual atomic code changes | `read_frontend_code`, `modify_frontend_code` |

### Workflow Restrictions

- **Coding Planner** and **Coding Worker** are restricted to the `self-coding` workflow
- Only **Coding Lead** can delegate to them (supervisor cannot invoke directly)
- This ensures proper orchestration and prevents bypassing the planning phase

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
  "edit_type": "replace|insert_before|insert_after|append|prepend|full_replace",
  "target": "string to find (for replace/insert)",
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
| Type | Description |
|------|-------------|
| `replace` | Find `target` and replace with `content` |
| `insert_before` | Insert `content` before `target` |
| `insert_after` | Insert `content` after `target` |
| `append` | Add `content` to end of file |
| `prepend` | Add `content` to beginning of file |
| `full_replace` | Replace entire file with `content` |

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

### Phase 2: Planning
1. Coding Lead delegates to Coding Planner with request details
2. Coding Planner uses `read_frontend_code` to examine:
   - Relevant source files
   - Directory structure
   - Existing patterns
3. Coding Planner outputs a JSON change plan:

```json
{
  "summary": "Add weather widget to header",
  "changes": [
    {
      "id": "change-1",
      "file_path": "src/components/WeatherWidget.jsx",
      "operation": "create",
      "content": "...",
      "priority": 1
    },
    {
      "id": "change-2",
      "file_path": "src/App.jsx",
      "operation": "edit",
      "edit_type": "insert_after",
      "target": "import StatusBadge",
      "content": "\nimport WeatherWidget from './components/WeatherWidget';",
      "priority": 2,
      "depends_on": ["change-1"]
    }
  ]
}
```

### Phase 3: Execution
1. Coding Lead parses the change plan
2. For each change, delegates to a Coding Worker
3. Independent changes can run in parallel (max 3 workers)
4. Workers use `modify_frontend_code` to execute changes
5. Coding Lead collects results from all workers

### Phase 4: Validation
1. Coding Lead runs `check_frontend_code` with `check: "build"`
2. If build fails: Report error details to user
3. If build succeeds: Proceed to report

### Phase 5: Reporting
Coding Lead reports to user:
- Summary of changes made
- Files modified (table format)
- Build status (pass/fail)
- Any errors or warnings

## File Structure

```
src/
├── agents/
│   ├── coding-lead.md      # Coding Lead system prompt
│   ├── coding-planner.md   # Coding Planner system prompt
│   ├── coding-worker.md    # Coding Worker system prompt
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
- Only Coding Workers can write files
- Coding Planner has read-only access
- Workflow restrictions prevent bypassing the orchestration

### Build Validation
- Changes are validated through `npm run build` before reporting success
- Failed builds are reported with error details
- Users are informed of any issues

## Configuration

### Workflow Constants (`src/self-coding/constants.ts`)

```typescript
export const SELF_CODING_WORKFLOW_ID = 'self-coding';
export const MAX_CHANGES_PER_REQUEST = 10;
export const MAX_PARALLEL_WORKERS = 3;
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
