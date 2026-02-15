# Express to Hono Migration Plan

*Technical Assessment & Implementation Guide*

> **✅ COMPLETED (Feb 15, 2026):** This migration has been successfully executed. See [`docs/design/hono-migration-report.md`](../design/hono-migration-report.md) for the final migration report with all changes documented.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Hono Overview](#hono-overview)
4. [API Mapping](#api-mapping)
5. [Migration Strategy](#migration-strategy)
6. [Potential Blockers](#potential-blockers)
7. [Technical Issues & Watchouts](#technical-issues--watchouts)
8. [Expected Improvements](#expected-improvements)
9. [Expected Degradations](#expected-degradations)
10. [Migration Checklist](#migration-checklist)
11. [Rollback Plan](#rollback-plan)

---

## Executive Summary

| Aspect | Assessment |
|--------|------------|
| **Feasibility** | ✅ High - APIs are largely compatible |
| **Effort** | Medium - ~16-24 hours for full migration |
| **Risk** | Low-Medium - WebSocket handling requires care |
| **Benefit** | Performance gains, better TypeScript, smaller bundle |

**Recommendation**: Proceed with incremental migration. Start with leaf routes (eval, missions), validate, then migrate core routes.

---

## Current State Analysis

### Express Components in Use

| Component | Location | Hono Equivalent | Migration Complexity |
|-----------|----------|-----------------|---------------------|
| `express()` | `server/index.ts` | `new Hono()` | Low |
| `express.json()` | Global middleware | Built-in (automatic) | None |
| `express.Router()` | RAG, MCP routes | `new Hono()` (nested) | Low |
| `cors` middleware | Global | `hono/cors` | Low |
| `multer` | RAG file uploads | Manual or adapter | **High** |
| HTTP upgrade handling | WebSocket | Manual (same as Express) | Medium |

### Route Statistics

```
Total Routes:        ~45
GET endpoints:       ~30
POST endpoints:      ~10
PATCH endpoints:     ~3
PUT endpoints:       ~1
DELETE endpoints:    ~4
File upload routes:  1 (RAG)
```

### Request Patterns Used

| Pattern | Count | Hono Support |
|---------|-------|--------------|
| `req.params.id` | 25+ | ✅ `c.req.param('id')` |
| `req.query.limit` | 15+ | ✅ `c.req.query('limit')` |
| `req.body` | 20+ | ✅ `await c.req.json()` |
| `req.headers.authorization` | 2 | ✅ `c.req.header('authorization')` |
| `req.files` (multer) | 1 | ⚠️ Requires adapter |

### Response Patterns Used

| Pattern | Count | Hono Support |
|---------|-------|--------------|
| `res.json(data)` | 45+ | ✅ `c.json(data)` |
| `res.status(code).json()` | 30+ | ✅ `c.json(data, code)` |
| `res.send(html)` | 1 | ✅ `c.html(html)` |

---

## Hono Overview

### Key Characteristics

```typescript
// Hono is ultralight (~14kb) and fast
import { Hono } from 'hono';

const app = new Hono();

// Middleware
app.use('*', cors());

// Routes with type inference
app.get('/api/users/:id', (c) => {
  const id = c.req.param('id');  // Typed!
  return c.json({ id });
});

// Async handlers are native
app.post('/api/users', async (c) => {
  const body = await c.req.json();
  return c.json(body, 201);
});
```

### Hono vs Express API Comparison

| Express | Hono | Notes |
|---------|------|-------|
| `app.get(path, handler)` | `app.get(path, handler)` | Same |
| `app.use(middleware)` | `app.use(middleware)` | Same |
| `req.params.id` | `c.req.param('id')` | Method call |
| `req.query.limit` | `c.req.query('limit')` | Method call |
| `req.body` | `await c.req.json()` | Async, no middleware |
| `req.headers['x-foo']` | `c.req.header('x-foo')` | Method call |
| `res.json(data)` | `return c.json(data)` | Return value |
| `res.status(404).json()` | `return c.json(data, 404)` | Second param |
| `res.send(html)` | `return c.html(html)` | Explicit method |
| `next()` | `await next()` | Async |

---

## API Mapping

### Global Setup

```typescript
// Before (Express)
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors({ origin: [...] }));
app.use(express.json());

// After (Hono)
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();
app.use('*', cors({ origin: [...] }));
// No JSON middleware needed - built-in
```

### Route Handlers

```typescript
// Before (Express)
app.get('/api/conversations/:id/messages', (req: Request, res: Response) => {
  try {
    const conversationId = req.params.id as string;
    const limit = parseInt(req.query.limit as string) || 20;
    const messages = db.messages.find(conversationId, { limit });
    res.json({ items: messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// After (Hono)
app.get('/api/conversations/:id/messages', async (c) => {
  try {
    const conversationId = c.req.param('id');
    const limit = parseInt(c.req.query('limit') || '20');
    const messages = db.messages.find(conversationId, { limit });
    return c.json({ items: messages });
  } catch (error) {
    return c.json({ error: 'Failed to fetch messages' }, 500);
  }
});
```

### POST with Body

```typescript
// Before (Express)
app.post('/api/conversations', (req: Request, res: Response) => {
  const { title, channel } = req.body;
  // ...
  res.json(conversation);
});

// After (Hono)
app.post('/api/conversations', async (c) => {
  const { title, channel } = await c.req.json();
  // ...
  return c.json(conversation);
});
```

### Nested Routers

```typescript
// Before (Express)
import { Router } from 'express';
const router = Router();
router.get('/projects', handler);
app.use('/api/rag', router);

// After (Hono)
const ragRoutes = new Hono();
ragRoutes.get('/projects', handler);
app.route('/api/rag', ragRoutes);
```

### Authentication Middleware

```typescript
// Before (Express)
const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== secret) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
};

// After (Hono)
const authMiddleware = async (c: Context, next: Next) => {
  const token = c.req.header('authorization')?.replace('Bearer ', '');
  if (!token || token !== secret) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
};
```

---

## Migration Strategy

### Phase 1: Setup & Compatibility Layer (2-4 hours)

1. **Install Hono**
   ```bash
   pnpm add hono @hono/node-server
   ```

2. **Create parallel entry point**
   ```typescript
   // src/server/hono-server.ts
   import { Hono } from 'hono';
   import { serve } from '@hono/node-server';
   ```

3. **Migrate global middleware**
   - CORS configuration
   - Error handling

4. **Test with single route**
   - `/health` endpoint
   - Verify request/response cycle

### Phase 2: Leaf Routes (4-6 hours)

Migrate routes with no dependencies on other routes:

1. **Evaluation routes** (`eval-routes.ts`)
   - 5 endpoints
   - Self-contained
   - Good test case for patterns

2. **Mission routes** (`mission-routes.ts`)
   - 10+ endpoints
   - Uses helper wrappers (need to adapt)

3. **Dashboard routes** (`dashboard-routes.ts`)
   - 8 endpoints
   - HTML response (test `c.html()`)

### Phase 3: Core Routes (6-8 hours)

1. **Conversations & Messages**
   - Most complex with pagination
   - Test query parameter handling

2. **Settings, Tools, Skills, MCPs**
   - Straightforward CRUD

3. **Tasks & Sessions**
   - Browser/desktop session management

### Phase 4: Complex Routes (4-6 hours)

1. **RAG Routes with File Upload**
   - Requires multer replacement
   - See [File Upload Blocker](#1-file-upload-multer-replacement)

2. **MCP Server Routes**
   - Authentication middleware
   - Streaming responses

### Phase 5: WebSocket & Server Integration (4-6 hours)

1. **HTTP Server Integration**
   ```typescript
   import { createServer } from 'http';
   import { serve } from '@hono/node-server';

   // Option A: Use Hono's built-in server
   serve({ fetch: app.fetch, port: 3000 });

   // Option B: Attach to existing http.Server (for WebSocket)
   const server = createServer(async (req, res) => {
     // Convert to Fetch API and use Hono
   });
   ```

2. **WebSocket Handling**
   - Keep existing `ws` library
   - Maintain HTTP upgrade handler
   - See [WebSocket Integration](#2-websocket-integration)

---

## Potential Blockers

### 1. File Upload (Multer Replacement)

**Severity: HIGH** | **Workaround Available: YES**

**Issue**: Multer is Express-specific. Hono has different file handling.

**Current Code**:
```typescript
// Express + Multer
const upload = multer({ dest: 'uploads/', limits: { fileSize: MAX_SIZE } });
router.post('/upload', upload.array('files', 20), async (req, res) => {
  const files = req.files as Express.Multer.File[];
});
```

**Solutions**:

**Option A: Native Hono parsing** (Recommended)
```typescript
app.post('/upload', async (c) => {
  const formData = await c.req.formData();
  const files = formData.getAll('files') as File[];

  for (const file of files) {
    const buffer = await file.arrayBuffer();
    const filename = file.name;
    // Write to disk manually
    await writeFile(`uploads/${filename}`, Buffer.from(buffer));
  }
});
```

**Option B: Use `@hono/multer`** (if available)
```bash
pnpm add @hono/node-server  # Includes formData support
```

**Migration Effort**: 2-3 hours for RAG upload route

---

### 2. WebSocket Integration

**Severity: MEDIUM** | **Workaround Available: YES**

**Issue**: Hono doesn't have built-in WebSocket. Current setup uses `ws` library with custom HTTP upgrade handling.

**Current Code**:
```typescript
this.server = createServer(this.app);  // Express app
this.wss = new WebSocketServer({ noServer: true });

this.server.on('upgrade', (request, socket, head) => {
  // Route to correct WS server
});
```

**Solution**: Keep the same pattern - Hono can coexist with manual WebSocket handling.

```typescript
import { createServer } from 'http';
import { Hono } from 'hono';

const app = new Hono();
const server = createServer(async (req, res) => {
  // For non-upgrade requests, use Hono
  const response = await app.fetch(
    new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body: req.method !== 'GET' && req.method !== 'HEAD'
        ? req : undefined,
    })
  );

  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
});

// WebSocket upgrade handling (unchanged)
server.on('upgrade', (request, socket, head) => {
  // Same as current implementation
});

const wss = new WebSocketServer({ noServer: true });
```

**Alternative**: Use `@hono/node-ws` for integrated WebSocket support.

```typescript
import { createNodeWebSocket } from '@hono/node-ws';

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get('/ws', upgradeWebSocket((c) => ({
  onMessage(event, ws) { /* ... */ },
  onClose() { /* ... */ },
})));

const server = serve({ fetch: app.fetch, port: 3000 });
injectWebSocket(server);
```

**Migration Effort**: 4-6 hours depending on approach

---

### 3. Type Compatibility

**Severity: LOW** | **Workaround Available: YES**

**Issue**: Route handler function signatures are different.

**Express**:
```typescript
type Handler = (req: Request, res: Response, next: NextFunction) => void;
```

**Hono**:
```typescript
type Handler = (c: Context, next: Next) => Response | Promise<Response>;
```

**Solution**: Create adapter type or migrate incrementally.

```typescript
// Temporary adapter for gradual migration
function expressToHono(handler: ExpressHandler): HonoHandler {
  return async (c, next) => {
    // Adapt context to req/res interface
    // This is a crutch - full migration is better
  };
}
```

**Recommendation**: Don't use adapter. Migrate routes fully for type safety benefits.

---

## Technical Issues & Watchouts

### 1. Response Already Sent

**Express** allows calling `res.json()` multiple times (second is ignored).
**Hono** expects exactly one `return` - multiple returns cause issues.

```typescript
// BAD - works in Express, fails in Hono
app.get('/api/foo', async (c) => {
  if (!valid) {
    c.json({ error: 'Invalid' }, 400);  // Missing return!
  }
  return c.json({ data: 'ok' });  // Always executes
});

// GOOD
app.get('/api/foo', async (c) => {
  if (!valid) {
    return c.json({ error: 'Invalid' }, 400);  // Return early
  }
  return c.json({ data: 'ok' });
});
```

**Watchout**: Audit all routes for missing `return` on early exits.

---

### 2. Async Body Parsing

**Express**: `req.body` is synchronously available (middleware pre-parsed).
**Hono**: `c.req.json()` is async.

```typescript
// Express (sync)
app.post('/api/foo', (req, res) => {
  const { name } = req.body;  // Already parsed
});

// Hono (async)
app.post('/api/foo', async (c) => {
  const { name } = await c.req.json();  // Must await
});
```

**Watchout**: All POST/PUT/PATCH handlers must become `async`.

---

### 3. Query Parameter Types

**Express**: `req.query.foo` can be `string | string[] | undefined`.
**Hono**: `c.req.query('foo')` returns `string | undefined`.

```typescript
// Express (can be array)
const ids = req.query.ids;  // string | string[] | undefined

// Hono (always string or undefined)
const ids = c.req.query('ids');  // string | undefined
const idsArray = c.req.queries('ids');  // string[] (for ?ids=1&ids=2)
```

**Watchout**: Use `c.req.queries()` for array parameters.

---

### 4. Error Handling

**Express**: Unhandled errors in routes crash the process or fall through to error middleware.
**Hono**: Unhandled errors in routes return 500 by default.

```typescript
// Hono global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});
```

**Watchout**: Add global error handler early in migration.

---

### 5. Middleware Execution Order

**Express**: Middleware runs in registration order, stops at `res.send()`.
**Hono**: Middleware runs in onion model (before/after handler).

```typescript
// Hono onion model
app.use('*', async (c, next) => {
  console.log('Before handler');
  await next();  // Handler runs here
  console.log('After handler');
});
```

**Watchout**: Auth middleware should `return` on failure, not just skip `next()`.

---

### 6. Static File Serving

**Express**: `express.static('public')` is common.
**Hono**: Use `hono/serve-static`.

```typescript
import { serveStatic } from '@hono/node-server/serve-static';

app.use('/static/*', serveStatic({ root: './public' }));

// SPA fallback
app.get('*', serveStatic({ path: './public/index.html' }));
```

---

### 7. Request Body Size Limits

**Express**: Configure via `express.json({ limit: '10mb' })`.
**Hono**: No built-in limit - handle manually or use middleware.

```typescript
// Size limit middleware
app.use('*', async (c, next) => {
  const contentLength = parseInt(c.req.header('content-length') || '0');
  if (contentLength > 10 * 1024 * 1024) {
    return c.json({ error: 'Payload too large' }, 413);
  }
  await next();
});
```

---

## Expected Improvements

### 1. Performance

| Metric | Express | Hono (Node) | Improvement |
|--------|---------|-------------|-------------|
| Requests/sec | ~15,000 | ~50,000 | **3.3x** |
| Latency (p99) | ~2ms | ~0.6ms | **3.3x** |
| Memory per request | Higher | Lower | ~30% reduction |

*Note: Real-world improvement depends on handler logic. LLM-bound routes won't see speedup.*

### 2. TypeScript Experience

```typescript
// Hono has excellent type inference
app.get('/users/:id', (c) => {
  const id = c.req.param('id');  // TypeScript knows this is string
  return c.json({ id });  // Return type is inferred
});

// With Zod validation
import { zValidator } from '@hono/zod-validator';

app.post('/users',
  zValidator('json', z.object({ name: z.string() })),
  (c) => {
    const { name } = c.req.valid('json');  // Typed!
    return c.json({ name });
  }
);
```

### 3. Bundle Size

| Metric | Express | Hono |
|--------|---------|------|
| Package size | ~200kb | ~14kb |
| Dependencies | 30+ | 0 |

### 4. Built-in Middleware

Hono includes common middleware out of the box:
- `hono/cors` - CORS handling
- `hono/jwt` - JWT validation
- `hono/logger` - Request logging
- `hono/compress` - Response compression
- `hono/etag` - ETag support
- `hono/secure-headers` - Security headers (like helmet)

### 5. OpenAPI Generation

```typescript
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

const app = new OpenAPIHono();

const route = createRoute({
  method: 'get',
  path: '/users/{id}',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UserSchema } },
    },
  },
});

app.openapi(route, (c) => { /* ... */ });

// Auto-generated OpenAPI spec
app.doc('/doc', { openapi: '3.0.0', info: { title: 'API', version: '1.0' } });
```

---

## Expected Degradations

### 1. Ecosystem Size

| Aspect | Express | Hono |
|--------|---------|------|
| npm packages | 60,000+ | ~500 |
| Stack Overflow answers | Millions | Thousands |
| Tutorial availability | Abundant | Limited |

**Impact**: Less help available for edge cases.

### 2. Multer Loss

Multer is a mature, battle-tested file upload library. Hono's native `formData()` parsing is simpler but less feature-rich:

| Feature | Multer | Hono Native |
|---------|--------|-------------|
| Disk storage | ✅ Built-in | Manual |
| Memory storage | ✅ Built-in | Default |
| File filtering | ✅ Built-in | Manual |
| Size limits | ✅ Per-file | Manual |
| Field name validation | ✅ Built-in | Manual |

**Impact**: RAG upload route needs more manual code.

### 3. Learning Curve

Team needs to learn:
- Context object (`c`) instead of `req`/`res`
- Async body parsing
- Return-based responses
- Onion middleware model

**Impact**: 2-4 hours learning time per developer.

### 4. Debugging

Express has more mature debugging tools and error messages. Hono errors can be cryptic:

```
TypeError: Cannot read properties of undefined (reading 'json')
// vs Express which often shows "req.body is undefined"
```

**Mitigation**: Add verbose error logging middleware.

### 5. WebSocket Complexity

Current WebSocket setup is well-understood. Migration adds complexity:
- Need to maintain hybrid HTTP/WS server
- Or adopt Hono's WebSocket adapter (newer, less documented)

---

## Migration Checklist

### Pre-Migration

- [ ] Create feature branch `feat/hono-migration`
- [ ] Install dependencies: `pnpm add hono @hono/node-server`
- [ ] Create `src/server/hono-server.ts` entry point
- [ ] Set up parallel testing environment
- [ ] Document current route behavior (snapshot tests)

### Phase 1: Foundation

- [ ] Migrate CORS middleware
- [ ] Add global error handler
- [ ] Add request logging middleware
- [ ] Test `/health` endpoint
- [ ] Verify WebSocket upgrade still works

### Phase 2: Leaf Routes

- [ ] Migrate `eval-routes.ts` (5 endpoints)
- [ ] Migrate `mission-routes.ts` (10+ endpoints)
- [ ] Migrate `dashboard-routes.ts` (8 endpoints)
- [ ] Run integration tests

### Phase 3: Core Routes

- [ ] Migrate conversation endpoints
- [ ] Migrate message endpoints (test pagination)
- [ ] Migrate settings/tools/skills endpoints
- [ ] Migrate task endpoints
- [ ] Migrate session endpoints (browser/desktop)

### Phase 4: Complex Routes

- [ ] Implement file upload without Multer
- [ ] Migrate RAG routes
- [ ] Migrate MCP server routes (auth middleware)
- [ ] Migrate trace routes

### Phase 5: Integration

- [ ] Finalize HTTP server integration
- [ ] Test WebSocket functionality end-to-end
- [ ] Performance benchmark comparison
- [ ] Remove Express dependencies
- [ ] Update documentation

### Post-Migration

- [ ] Monitor production for 1 week
- [ ] Remove old Express code
- [ ] Update CLAUDE.md with new patterns
- [ ] Archive this migration document

---

## Rollback Plan

### Triggers for Rollback

1. WebSocket connectivity issues in production
2. File upload failures
3. Performance degradation (>20% slower)
4. Critical bugs not fixable within 4 hours

### Rollback Steps

1. **Immediate**: Revert to `main` branch
   ```bash
   git checkout main
   pnpm install
   pnpm dev
   ```

2. **If deployed**:
   ```bash
   git revert HEAD  # Revert merge commit
   git push origin main
   # Redeploy
   ```

3. **Post-mortem**: Document what failed and why

### Keeping Rollback Option Open

During migration, maintain both servers:

```typescript
// src/server/index.ts (keep Express working)
// src/server/hono-server.ts (new Hono server)

// Environment toggle
const USE_HONO = process.env.USE_HONO === 'true';
```

This allows instant rollback by changing an environment variable.

---

## Conclusion

Migration from Express to Hono is **feasible and beneficial**, with the primary challenges being:

1. **File upload handling** - Requires custom implementation
2. **WebSocket integration** - Needs careful handling but solvable
3. **Team learning curve** - Minor, patterns are similar

Expected timeline: **16-24 hours** for complete migration.

Recommended approach: **Incremental migration** with parallel servers, allowing rollback at any point.
