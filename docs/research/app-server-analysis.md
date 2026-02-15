# Application Server Framework Analysis

*Analysis Date: February 2026*

> **⚠️ UPDATE (Feb 15, 2026):** This analysis is now **historical**. OllieBot has migrated from Express to **Hono** as of February 2026. See [`hono-upgrade-plan.md`](./hono-upgrade-plan.md) and [`hono-migration-report.md`](../design/hono-migration-report.md) for migration details. The recommendations below were written before the migration decision and are preserved for reference.

This document analyzes the server framework requirements for OllieBot, evaluates available options, and provides recommendations.

---

## Table of Contents

1. [Current Implementation](#current-implementation)
2. [Technical Requirements](#technical-requirements)
3. [Framework Options](#framework-options)
4. [Comparison Matrix](#comparison-matrix)
5. [Recommendations](#recommendations)

---

## Current Implementation

### Framework
**Express.js v4.21.0** - Minimal, unopinionated web framework for Node.js

### Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP Server                               │
│                    (Node.js http.Server)                         │
├─────────────────────────────────────────────────────────────────┤
│  Express App                │  WebSocket Servers (ws library)   │
│  ├── CORS middleware        │  ├── Main WS (/ path)             │
│  ├── JSON body parser       │  │   └── Chat messages            │
│  ├── Multer (file uploads)  │  └── Voice WS (/voice path)       │
│  └── REST API routes        │      └── Real-time transcription  │
├─────────────────────────────┴───────────────────────────────────┤
│                     HTTP Upgrade Handler                         │
│              (Routes upgrade requests to WS servers)             │
└─────────────────────────────────────────────────────────────────┘
```

### Current Route Structure

| Category | Endpoints | Purpose |
|----------|-----------|---------|
| Core API | 15 routes | Conversations, messages, settings |
| Agents | 3 routes | State, active agents, clients |
| Tools | 4 routes | MCP servers, skills, tools |
| Tasks | 3 routes | Scheduled tasks CRUD + execution |
| Sessions | 2 routes | Browser/desktop session management |
| Traces | 6 routes | Observability, LLM call history |
| RAG | 5+ routes | Vector search project management |
| Eval | 3+ routes | Evaluation framework |
| Missions | 5+ routes | Long-running mission management |
| Dashboard | 3+ routes | Dashboard rendering |
| MCP Server | 1 mount | OllieBot as MCP server |
| **Total** | **~45 routes** | |

### Middleware Stack

| Middleware | Purpose | Location |
|------------|---------|----------|
| `cors` | Origin validation, CORS headers | Global |
| `express.json()` | JSON body parsing | Global |
| `multer` | Multipart file uploads | RAG routes only |
| Custom auth | Bearer token validation | MCP routes only |

### Static File Serving
**Not implemented.** Current setup:
- **Development**: Vite dev server (port 5173) proxies API calls to Express (port 3000)
- **Production**: Requires external solution (nginx, CDN, or adding `express.static`)

---

## Technical Requirements

### Must Have (Critical)

| Requirement | Description | Current Solution |
|-------------|-------------|------------------|
| **REST API** | JSON request/response for ~45 endpoints | `express.json()` |
| **WebSocket** | Dual WS servers (chat + voice) on same HTTP server | `ws` library with `noServer` mode |
| **HTTP Upgrade** | Route upgrade requests to correct WS server by path | Manual `server.on('upgrade')` handler |
| **CORS** | Configurable origin whitelist | `cors` middleware |
| **File Upload** | Multipart form data for RAG documents | `multer` middleware |
| **Route Modularity** | Feature-based route organization | Express `Router` |
| **TypeScript** | Full type safety | `@types/express` |

### Should Have (Important)

| Requirement | Description | Current Solution |
|-------------|-------------|------------------|
| **Request Validation** | Schema validation for request bodies | Manual (inconsistent) |
| **Error Handling** | Centralized error responses | Manual try/catch |
| **Logging** | Request/response logging | Console.log (ad-hoc) |
| **Static Files** | Serve production frontend build | Not implemented |
| **Rate Limiting** | Prevent abuse | Not implemented |

### Nice to Have (Future)

| Requirement | Description | Current Solution |
|-------------|-------------|------------------|
| **OpenAPI/Swagger** | API documentation | Not implemented |
| **Health Checks** | Kubernetes-style probes | Basic `/health` endpoint |
| **Metrics** | Prometheus-compatible metrics | Not implemented |
| **Streaming** | Server-Sent Events (SSE) | Not used (WebSocket instead) |

---

## Framework Options

### 1. Express.js (Current)

**Overview**: Minimal, flexible web framework. Industry standard since 2010.

**Pros**:
- Massive ecosystem (60k+ npm packages)
- Extremely well-documented
- Team already familiar with it
- Maximum flexibility - no magic
- Easy to integrate any middleware
- Works with any template engine, ORM, etc.

**Cons**:
- Callback-based API (async/await requires wrapping)
- No built-in validation, must add middleware
- Performance is adequate but not best-in-class
- No native TypeScript (requires @types)
- Express 5 still in beta after years

**Performance**: ~15,000 req/s (JSON response benchmark)

**WebSocket Integration**: Manual via `ws` library - requires custom upgrade handling

**Best For**: Projects needing maximum flexibility and ecosystem compatibility

---

### 2. Fastify

**Overview**: Modern, high-performance framework focused on developer experience.

**Pros**:
- 2-3x faster than Express (schema-based serialization)
- Built-in JSON schema validation
- Native async/await support
- First-class TypeScript support
- Built-in logging (Pino)
- Plugin system with encapsulation
- OpenAPI/Swagger generation from schemas

**Cons**:
- Smaller ecosystem than Express
- Different middleware model (plugins vs middleware)
- Some Express middleware needs adapters
- Learning curve for plugin system

**Performance**: ~45,000 req/s (JSON response benchmark)

**WebSocket Integration**: `@fastify/websocket` - first-class support, automatic upgrade handling

**Best For**: Performance-critical APIs, TypeScript projects, teams wanting built-in validation

---

### 3. Hono

**Overview**: Ultralight, edge-first framework. Runs on Node, Deno, Bun, Cloudflare Workers.

**Pros**:
- Extremely fast (~100k req/s with Bun)
- Tiny bundle size (~14kb)
- First-class TypeScript with type inference
- Works across all JS runtimes
- Built-in middleware (CORS, JWT, etc.)
- Express-like API (easy migration)
- Built-in OpenAPI generation

**Cons**:
- Younger project (2022), smaller ecosystem
- Less battle-tested at scale
- Fewer tutorials/resources
- WebSocket support varies by runtime
- Some Node.js-specific features need adapters

**Performance**: ~50,000+ req/s (Node.js), ~100,000+ req/s (Bun)

**WebSocket Integration**: Runtime-dependent. Node.js requires `ws` library (similar to Express)

**Best For**: Edge deployments, multi-runtime projects, performance-critical lightweight APIs

---

### 4. Koa

**Overview**: Express successor by the same team. Minimalist with modern async patterns.

**Pros**:
- Clean async/await middleware (no callbacks)
- Smaller core than Express
- Better error handling with try/catch
- Context object simplifies request/response
- Designed by Express creators with lessons learned

**Cons**:
- Smaller ecosystem than Express
- Requires more middleware for basic features
- Less documentation/tutorials
- Development has slowed
- No significant performance advantage

**Performance**: ~18,000 req/s (similar to Express)

**WebSocket Integration**: Manual via `ws` library (same as Express)

**Best For**: Teams wanting cleaner async code without major performance gains

---

### 5. NestJS

**Overview**: Full-featured framework with Angular-style architecture (decorators, DI, modules).

**Pros**:
- Full-featured: validation, auth, GraphQL, WebSocket built-in
- Strong architectural patterns (enforced structure)
- Excellent TypeScript integration
- Built-in dependency injection
- Great documentation
- Enterprise-ready with testing utilities
- Can use Express or Fastify under the hood

**Cons**:
- Heavy/opinionated - significant learning curve
- Decorator-based (not everyone's preference)
- Overkill for simple APIs
- Slower startup time
- Larger bundle size
- Framework lock-in

**Performance**: Depends on underlying adapter (Express or Fastify)

**WebSocket Integration**: Built-in `@nestjs/websockets` with decorators

**Best For**: Large teams, enterprise projects, teams wanting enforced architecture

---

## Comparison Matrix

| Criteria | Express | Fastify | Hono | Koa | NestJS |
|----------|---------|---------|------|-----|--------|
| **Performance** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| **TypeScript** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Ecosystem** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Learning Curve** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **WebSocket** | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Validation** | ⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐ | ⭐⭐⭐⭐⭐ |
| **Migration Effort** | N/A | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Maturity** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

### Performance Benchmarks (req/s, JSON response)

```
Hono (Bun)     ████████████████████████████████████████ 100,000+
Hono (Node)   ████████████████████░░░░░░░░░░░░░░░░░░░░  50,000
Fastify       ██████████████████░░░░░░░░░░░░░░░░░░░░░░  45,000
Koa           ███████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  18,000
Express       ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  15,000
NestJS+Express████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12,000
```

*Note: Real-world performance depends on application logic, not just framework overhead.*

---

## Recommendations

### Primary Recommendation: **Stay with Express** (Short-term)

**Rationale**:

1. **Working System**: The current implementation is functional and stable
2. **Migration Cost**: ~45 routes would need rewriting with no immediate feature gain
3. **Performance Not a Bottleneck**: OllieBot is LLM-bound, not HTTP-bound. LLM calls take 1-30 seconds; Express overhead is negligible
4. **Ecosystem**: All needed middleware already exists and is integrated
5. **Team Familiarity**: No learning curve, immediate productivity

**Recommended Improvements** (keep Express, add enhancements):

| Enhancement | Effort | Benefit |
|-------------|--------|---------|
| Add `express.static` for production | 5 min | Serve frontend without nginx |
| Add `express-rate-limit` | 30 min | Prevent API abuse |
| Add `helmet` for security headers | 15 min | Security hardening |
| Centralize error handling middleware | 2 hours | Consistent error responses |
| Add request logging middleware | 1 hour | Debugging, audit trail |
| Add Zod validation to routes | 4 hours | Type-safe request validation |

```typescript
// Example improvements
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { static as serveStatic } from 'express';

// Security headers
app.use(helmet());

// Rate limiting
app.use('/api/', rateLimit({ windowMs: 60000, max: 100 }));

// Static files (production)
app.use(serveStatic('web/dist'));

// SPA fallback
app.get('*', (req, res) => res.sendFile('web/dist/index.html'));
```

---

### Secondary Recommendation: **Migrate to Fastify** (Medium-term)

**When to Consider Migration**:
- If request validation becomes a pain point (Fastify has built-in JSON schema validation)
- If structured logging becomes necessary (Fastify has Pino built-in)
- If WebSocket handling grows more complex (Fastify has cleaner WS integration)
- If performance profiling shows Express as a bottleneck (unlikely but possible)

**Migration Path**:

1. **Phase 1**: Add `fastify-express` compatibility layer
   - Run Fastify with Express middleware
   - Zero route changes required
   - Test performance improvement

2. **Phase 2**: Migrate routes incrementally
   - Convert one route group at a time (e.g., `/api/conversations/*`)
   - Use Fastify schemas for validation
   - Keep Express routes working via compatibility layer

3. **Phase 3**: Remove Express dependency
   - Convert remaining routes
   - Replace Express middleware with Fastify plugins
   - Remove compatibility layer

**Migration Example**:

```typescript
// Before (Express)
app.post('/api/conversations', (req, res) => {
  const { title } = req.body;
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'Title required' });
  }
  // ...
});

// After (Fastify)
fastify.post('/api/conversations', {
  schema: {
    body: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', minLength: 1, maxLength: 100 }
      }
    }
  }
}, async (request, reply) => {
  const { title } = request.body; // Already validated
  // ...
});
```

**Estimated Migration Effort**: 16-24 hours for full migration

---

## Decision Matrix

| Scenario | Recommendation |
|----------|----------------|
| Need it working today | Stay with Express |
| Adding 10+ new endpoints | Consider Fastify |
| Performance issues identified | Migrate to Fastify |
| Multi-runtime deployment needed | Consider Hono |
| Building enterprise product with team of 5+ | Consider NestJS |
| Just need security improvements | Stay with Express + helmet |

---

## Conclusion

**Express is the right choice for OllieBot today.** The framework's limitations (no built-in validation, manual WebSocket handling) are minor inconveniences, not blockers. The application's performance is dominated by LLM latency, making HTTP framework speed irrelevant.

If future requirements demand better validation, logging, or WebSocket handling, **Fastify provides a clear upgrade path** with 2-3x performance improvement and better TypeScript support, while maintaining a similar programming model.

**Do not migrate to NestJS** - the architectural overhead is not justified for a single-developer project with ~45 routes.

**Do not migrate to Hono** - while performant, the WebSocket story on Node.js is not significantly better than Express, and the ecosystem is less mature.
