# Express to Hono Migration Report

**Date:** 2026-02-15
**Status:** Complete

## Summary

Successfully migrated OllieBot's HTTP server from Express.js to Hono. All routes, middleware, and functionality have been converted. Express, cors, and multer packages have been removed from dependencies.

## Migration Scope

### Files Migrated

| File | Changes |
|------|---------|
| `src/server/index.ts` | Main server class - Express app to Hono app, CORS middleware, route registration, WebSocket upgrade handling |
| `src/server/eval-routes.ts` | Evaluation API routes - ~45 endpoints converted |
| `src/server/mission-routes.ts` | Mission API routes - helper functions adapted for Hono Context |
| `src/dashboard/dashboard-routes.ts` | Dashboard API routes |
| `src/rag-projects/routes.ts` | RAG API routes - multer replaced with native Hono formData() |
| `src/mcp-server/index.ts` | MCP server routes - Hono sub-router pattern |
| `src/mcp-server/handler.ts` | MCP HTTP handler - Express req/res to Hono Context |

### Packages Removed

**Dependencies:**
- `express` (^4.21.0)
- `cors` (^2.8.5)
- `multer` (^2.0.2)

**DevDependencies:**
- `@types/express` (^5.0.0)
- `@types/cors` (^2.8.17)
- `@types/multer` (^2.0.0)

### Packages Added

**Dependencies:**
- `hono` (^4.11.9)
- `@hono/node-server` (^1.19.9)
- `@hono/node-ws` (^1.3.0)

## Key Migration Patterns

### Route Handler Conversion

```typescript
// Express
app.get('/api/foo/:id', (req, res) => {
  const id = req.params.id;
  const limit = req.query.limit;
  res.json({ id, limit });
});

// Hono
app.get('/api/foo/:id', (c) => {
  const id = c.req.param('id');
  const limit = c.req.query('limit');
  return c.json({ id, limit });
});
```

### Request Body Parsing

```typescript
// Express (sync, body-parser middleware)
const body = req.body;

// Hono (async)
const body = await c.req.json();
```

### File Upload

```typescript
// Express + multer
const upload = multer({ dest: 'uploads/' });
app.post('/upload', upload.array('files'), (req, res) => {
  const files = req.files;
  // ...
});

// Hono native
app.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const files = formData.getAll('files') as File[];
  for (const file of files) {
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(destPath, Buffer.from(arrayBuffer));
  }
});
```

### CORS Middleware

```typescript
// Express + cors
import cors from 'cors';
app.use(cors({ origin: ..., credentials: true }));

// Hono
import { cors } from 'hono/cors';
app.use('*', cors({
  origin: (origin) => { ... },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
```

### Server Start + WebSocket

```typescript
// Express
const server = app.listen(port);
const wss = new WebSocket.Server({ noServer: true });
server.on('upgrade', ...);

// Hono
import { serve } from '@hono/node-server';
const nodeServer = serve({ fetch: app.fetch, port, hostname });
const server = nodeServer as unknown as Server;
server.on('upgrade', ...);
```

### Catch-all Route Patterns

```typescript
// Express
app.get('/api/eval/:path(*)', handler);

// Hono
app.get('/api/eval/:path{.+}', handler);
```

### SSE Streaming

```typescript
// Express
res.setHeader('Content-Type', 'text/event-stream');
res.write(': comment\n\n');

// Hono
import { streamSSE } from 'hono/streaming';
return streamSSE(c, async (stream) => {
  await stream.writeSSE({ data: 'message', event: 'type' });
});
```

## WebSocket Architecture

The existing WebSocket implementation using the `ws` library was preserved. Key decisions:

1. **Kept `ws` library** - The existing WebSocket architecture uses `noServer: true` mode with manual upgrade handling, which is well-suited for the current multi-endpoint design (main WS at `/` and voice WS at `/voice`)

2. **Attached to Hono's underlying HTTP server** - `@hono/node-server` returns the underlying Node.js HTTP server, which can be used directly for upgrade handling

3. **No changes to WebSocket handlers** - All WebSocket message handling, channel management, and event broadcasting remain unchanged

## Verification

| Check | Status |
|-------|--------|
| TypeScript compilation (`pnpm typecheck`) | ✅ Pass |
| Test suite (`pnpm test`) | ✅ 162 tests passing |
| Production build (`pnpm build:server`) | ✅ Pass |

## Potential Issues & Open Items

### 1. SSE Stream Compatibility

The MCP server's SSE endpoint (`GET /mcp`) was converted from Express's raw `res.write()` to Hono's `streamSSE()` helper. The event format changed slightly:

```typescript
// Before: SSE comment
res.write(': MCP SSE stream established\n\n');

// After: SSE event
await stream.writeSSE({ data: 'MCP SSE stream established', event: 'init' });
```

**Risk:** Low - Claude Code and other MCP clients should handle both formats. Monitor for any SSE connection issues.

### 2. Hono Context Type in Handler

The `src/mcp-server/handler.ts` now accepts Hono `Context` objects. The handler's return type changed from `Promise<void>` to `Promise<Response>`:

```typescript
// Before (Express)
async handlePost(req: Request, res: Response): Promise<void>

// After (Hono)
async handlePost(c: Context): Promise<Response>
```

**Risk:** None - Type-safe migration verified by TypeScript.

### 3. Native File Upload Size Limits

The native Hono `formData()` parsing doesn't have built-in size limits at the parsing level (unlike multer's `limits` option). File size validation is performed after parsing in `src/rag-projects/routes.ts`:

```typescript
if (file.size > MAX_FILE_UPLOAD_SIZE_BYTES) {
  return c.json({ error: `File exceeds maximum size` }, 400);
}
```

**Risk:** Low - Large files will be parsed before rejection. For most use cases this is acceptable. If memory becomes an issue with very large uploads, consider streaming approach or request size limits at reverse proxy level.

### 4. CORS Origin Callback

Hono's CORS middleware origin callback returns `string | null` instead of calling a callback:

```typescript
// Express cors - callback style
origin: (origin, callback) => {
  if (allowed) callback(null, origin);
  else callback(new Error('Not allowed'));
}

// Hono cors - return style
origin: (origin) => {
  if (allowed) return origin;
  return null;  // Blocked
}
```

**Risk:** None - Functionally equivalent, verified working.

### 5. Error Response Format Consistency

All error responses maintain the same JSON structure as before:

```typescript
return c.json({ error: 'Error message' }, statusCode);
```

**Risk:** None - Response format unchanged.

## Performance Notes

Hono is generally faster than Express due to:
- Trie-based router instead of linear route matching
- Lighter middleware chain
- Optimized request/response handling

No benchmarking was performed as part of this migration, but no performance regressions are expected.

## Rollback Plan

Git-based rollback only. Commit before migration can be used to restore Express version if needed:

```bash
git log --oneline  # Find pre-migration commit
git checkout <commit> -- src/server src/dashboard src/rag-projects src/mcp-server package.json
pnpm install
```

No Express code traces were left in the codebase.
