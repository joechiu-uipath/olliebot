# External Events Architecture

## Overview

OllieBot is a continuously running agent. To be truly useful, it needs to react to the outside world — not just respond to user prompts. This document explores two complementary patterns for receiving external events:

1. **Outbound connections (pull)** — OllieBot establishes connections to external data sources (WebSocket, polling, subscription APIs) to monitor changes over time.
2. **Inbound webhooks (push)** — External services send HTTP requests to OllieBot when events occur.

Both patterns require OllieBot to have an internet-accessible endpoint, which introduces networking and security considerations covered in the final section.

---

## Part 1: Outbound Connections — Microsoft Graph as Case Study

### Why Microsoft Graph?

Microsoft Graph (`https://graph.microsoft.com/v1.0`) is the unified API for all Microsoft 365 services. It is the correct and recommended API for reading Outlook email and calendar. The legacy Outlook REST API has been deprecated.

Key endpoints:
- Mail: `GET /me/messages`, `GET /me/mailFolders('Inbox')/messages`
- Calendar: `GET /me/events`, `GET /me/calendarView`

### Change Notification Model

Microsoft Graph uses a **subscribe-and-receive** model. There are three delivery mechanisms:

| Method | Persistent Connection? | Supported Resources |
|--------|----------------------|---------------------|
| **Webhooks (HTTP POST)** | No (push-based) | Broad: mail, calendar, Teams, contacts |
| **WebSocket via SignalR** | Yes | Limited, less common for Outlook |
| **WebSocket via Socket.io** | Yes | OneDrive/SharePoint only |

**For email and calendar, webhooks are the primary mechanism.** WebSocket is not available for mail/calendar resources. This means Graph notifications are actually a *push* model (Pattern 2), not a persistent outbound connection (Pattern 1).

### How Subscriptions Work

**Step 1 — Create subscription:**
```
POST https://graph.microsoft.com/v1.0/subscriptions
```
```json
{
  "changeType": "created,updated",
  "notificationUrl": "https://your-server.com/api/webhooks/graph",
  "lifecycleNotificationUrl": "https://your-server.com/api/lifecycle",
  "resource": "me/mailFolders('Inbox')/messages",
  "expirationDateTime": "2026-02-09T11:00:00Z",
  "clientState": "your-secret-state-value"
}
```

**Step 2 — Endpoint validation:** Microsoft sends a `validationToken` query parameter to your endpoint. You must echo it back within 10 seconds with `Content-Type: text/plain`.

**Step 3 — Receive notifications:** When resources change, Microsoft POSTs a JSON payload containing the subscription ID, change type, and resource ID. Basic notifications contain metadata only — you must call Graph API to fetch the full resource.

**Step 4 — Acknowledge:** Return `2xx` within 10 seconds. If processing is slow, queue the event and return `202 Accepted` immediately.

### Notification Payload

```json
{
  "value": [{
    "subscriptionId": "{guid}",
    "changeType": "created",
    "resource": "users/{user}@{tenant}/messages/{id}",
    "clientState": "your-secret-state-value",
    "resourceData": {
      "@odata.type": "#Microsoft.Graph.Message",
      "@odata.id": "Users/{user}@{tenant}/Messages/{id}",
      "id": "{message_id}"
    }
  }]
}
```

### Rich Notifications (Include Resource Data)

To avoid a round-trip fetch, you can request encrypted resource data in the notification itself. This requires providing an encryption certificate:

```json
{
  "includeResourceData": true,
  "encryptionCertificate": "<base64-encoded-cert>",
  "encryptionCertificateId": "myCertId"
}
```

### OAuth Scopes for Read-Only Access

**Delegated permissions (user signed in):**
- `Mail.Read` — read user's mail
- `Calendars.Read` — read user's calendar
- `offline_access` — obtain refresh tokens for long-lived access

**Application permissions (daemon/service, requires admin consent):**
- `Mail.Read` — read all users' mail (tenant-wide)
- `Calendars.Read` — read all users' calendar (tenant-wide)

For OllieBot acting on behalf of a single user, delegated permissions with `offline_access` are the right model.

### Subscription Lifecycle

| Resource | Max Subscription Duration |
|----------|--------------------------|
| Mail (messages) | 4,230 minutes (~2.94 days) |
| Calendar (events) | 4,230 minutes (~2.94 days) |
| Contacts | 4,230 minutes (~2.94 days) |
| OneDrive | 42,300 minutes (~29.4 days) |

**Renewal:** `PATCH /subscriptions/{id}` with a new `expirationDateTime`. Must be renewed before expiry — recommended: renew every 2 days with a background scheduler. Subscribe to lifecycle notifications (`lifecycleNotificationUrl`) as a safety net.

**Limits:** Max 1,000 active subscriptions per mailbox across all apps.

### Delta Queries (Polling Alternative)

Delta queries return only changes since the last request:

```
GET /me/mailFolders('{id}')/messages/delta
GET /me/calendarView/delta?startDateTime=...&endDateTime=...
```

Flow: initial request → follow `@odata.nextLink` pages → store the `@odata.deltaLink` → use it on next poll to get only changes.

### Recommended Architecture: Hybrid

The best pattern combines both:

1. **Webhooks** — real-time signal that something changed
2. **Delta queries** — efficient fetch of actual changed data
3. **Periodic safety poll** (every 30 min) — catches missed notifications

This hybrid pattern is recommended by Microsoft and provides both real-time responsiveness and resilience.

---

## Part 2: Other OAuth-Controlled Personal Data Sources

The following services support OAuth for delegated access and real-time or near-real-time change detection. These represent potential integrations where a user could authorize OllieBot to monitor their data.

### Tier 1: Excellent Agent Viability

| Service | OAuth | Real-Time Mechanism | Polling/Delta | Notes |
|---------|-------|-------------------|---------------|-------|
| **Gmail API** | OAuth 2.0 | Pub/Sub push + gRPC streaming pull | `history.list` with `historyId` | gRPC streaming pull requires no inbound ports — Google pushes through the outbound connection |
| **Google Calendar** | OAuth 2.0 | Webhook push notifications | `syncToken` on `events.list` | Channels expire in up to 7 days |
| **Microsoft Graph** (Outlook, OneDrive, To-Do) | OAuth 2.0 | Webhook subscriptions | Delta queries | Unified API for all M365 services |
| **Google Drive** | OAuth 2.0 | `changes.watch()` webhooks | `changes.list` with `startPageToken` | Webhook renewal creates new channel ID |
| **Dropbox** | OAuth 2.0 | Webhook change notifications | Cursor-based `list_folder/continue` | |
| **Slack** | OAuth 2.0 | Events API (HTTP push) | N/A | 30,000 deliveries/workspace/hour |
| **GitHub** | OAuth 2.0 | 60+ webhook event types | Notifications API, conditional requests with ETags | ETag requests don't count against rate limits |
| **Todoist** | OAuth 2.0 | Webhooks (HMAC-SHA256 signed) | Sync API for incremental sync | Also supports MCP |
| **Notion** | OAuth 2.0 | Native webhooks (API v2025-09-03+) | Database queries | 3 req/sec rate limit |
| **Fitbit** | OAuth 2.0 | Subscription webhooks | REST polling | |
| **Plaid** (Finance) | Link + OAuth | Transaction webhooks | `/transactions/sync` cursor-based | Plaid checks institutions 1-4 times/day |

### Tier 2: Moderate Viability

| Service | OAuth | Real-Time | Notes |
|---------|-------|-----------|-------|
| **Discord** | OAuth 2.0 | Gateway WebSocket (persistent) | Requires maintaining a persistent WebSocket connection; good fit for Pattern 1 |
| **Twitter/X** | OAuth 2.0 | Filtered Stream API | Expensive tiers for meaningful access |
| **Google Tasks** | OAuth 2.0 | No push | Polling only |
| **Telegram** | No OAuth (bot token) | Webhooks or long-polling | Cannot delegate access to user's account, only bot messages |

### Tier 3: Not Viable

| Service | Why |
|---------|-----|
| **Apple Calendar** | No OAuth, no webhooks, requires app-specific passwords |
| **Apple Health** | No cloud API — HealthKit is on-device only |
| **Google Fit** | Fully deprecated (June 2025), replaced by Health Connect (on-device only) |
| **Yahoo Mail** | OAuth exists but mail scope requires commercial application; IMAP only |

### Key Insight: Gmail's gRPC Streaming Pull

Gmail via Google Cloud Pub/Sub offers a unique advantage: **streaming pull via gRPC**. OllieBot opens an *outbound* gRPC connection to Google's Pub/Sub service, and Google pushes messages through it in real-time. This is a true Pattern 1 (outbound persistent connection) that requires **no inbound ports** and no public endpoint. This is the only major service that offers this model for email.

### Integration Pattern Recommendation

**Pattern D: Webhook + Delta Query Hybrid** (same as Microsoft Graph recommendation)

1. Subscribe to webhooks for real-time notification signal
2. Use delta/sync queries to fetch actual changed data
3. Run periodic safety polls (once/day) to catch missed notifications

This pattern works across Microsoft Graph, Google Drive, Gmail (via Pub/Sub + `history.list`), Dropbox, and most Tier 1 services.

---

## Part 3: Inbound Webhooks — IFTTT and Automation Platforms

### IFTTT Webhook Support

IFTTT's Webhooks service (formerly "Maker Channel") provides bidirectional webhook capability:

**IFTTT → OllieBot (outbound "Make a web request" action):**
- Sends HTTP requests (GET, POST, PUT, DELETE, OPTIONS) to any public URL
- Fully configurable: method, content type, headers, body
- Body can include dynamic "ingredients" from any IFTTT trigger
- **Requires IFTTT Pro ($6.99/mo) or Pro+**

**OllieBot → IFTTT (inbound trigger):**
```
POST https://maker.ifttt.com/trigger/{event}/with/key/{user_key}
```
- Accepts up to 3 values (standard) or arbitrary JSON (`/json/` variant)
- Fires in real-time (seconds)

### IFTTT Limitations

- **No built-in authentication** for outbound webhooks (no HMAC, no static IPs, no reliable User-Agent)
- **12-second timeout** — your endpoint must respond within 12 seconds
- **Polling-based triggers** can have significant latency (minutes to hours, depending on plan tier)
- **No published rate limits** — community reports suggest hundreds/day for typical use

### Authentication Strategy for IFTTT Webhooks

Since IFTTT provides no cryptographic signing, use a **custom secret header**:

Configure in the IFTTT Applet's "Additional Headers" field:
```
X-OllieBot-Secret: <shared-secret>
```

OllieBot validates this header on every incoming request.

### What IFTTT Triggers Can Monitor

Any IFTTT service can be paired with "Make a web request". Key categories:

- **Smart Home**: Philips Hue, SmartThings, Ring (motion, doorbell, switch events)
- **Email/Productivity**: Gmail (new email matching search), Google Calendar (event starts)
- **Weather/Location**: Weather Underground (threshold alerts), location enter/exit
- **Content**: RSS Feed (new items), YouTube (new video by channel)
- **Time**: Cron-like scheduling (every hour, every day at X)
- **Device**: Android/iOS events (WiFi connect, battery level, phone call)

### Alternative Automation Platforms

| Platform | Outgoing Webhooks | Free Tier | Self-Hosting | Integrations |
|----------|------------------|-----------|-------------|-------------|
| **IFTTT** | Yes (Pro required) | No | No | ~1,000+ |
| **Zapier** | Yes (paid only) | No | No | ~8,700+ |
| **Make (Integromat)** | Yes (all plans) | Yes | No | ~2,900+ |
| **n8n** | Yes (core feature) | Yes | Yes (open source) | ~1,100+ |
| **Pipedream** | Yes | Yes (generous) | No | ~1,000+ |

**Key insight:** A single webhook receiver endpoint in OllieBot works with ALL of these platforms. They all send standard HTTP requests.

### What OllieBot Needs as a Webhook Receiver

**Minimum implementation:**
```
POST /api/webhooks/:source
```

Requirements:
1. **Public HTTPS endpoint** — accessible from the internet
2. **Fast acknowledgment** — return `200 OK` within 3 seconds, process async
3. **Authentication** — validate per-source secrets (header, URL token, or HMAC)
4. **Payload validation** — treat all input as untrusted, sanitize before processing
5. **Idempotency** — deduplicate by event ID to prevent replay
6. **Logging** — record all incoming webhooks for audit and debugging

**Suggested standardized payload format for IFTTT users to configure:**
```json
{
  "source": "ifttt",
  "event_type": "<<<{{EventName}}>>>",
  "data": {
    "value1": "<<<{{Value1}}>>>",
    "value2": "<<<{{Value2}}>>>",
    "value3": "<<<{{Value3}}>>>"
  },
  "occurred_at": "<<<{{OccurredAt}}>>>"
}
```

(Triple-bracket `<<<>>>` escaping is IFTTT's recommended approach for JSON safety.)

---

## Part 4: Networking — Exposing OllieBot to the Internet

Both webhook subscriptions (Microsoft Graph, IFTTT) and inbound webhooks require OllieBot to have a publicly accessible HTTPS endpoint. Here are the options.

### Tunnel / Forwarding Service Comparison

| Service | Free Tier | Stable URLs (Free) | Custom Domains | Built-in Auth | Best For |
|---------|-----------|-------------------|----------------|--------------|----------|
| **Cloudflare Tunnel** | 50 tunnels, unlimited BW | Yes (your domain) | Yes (free) | Cloudflare Access | Persistent endpoints |
| **Tailscale Funnel** | Yes | Yes (`*.ts.net`) | No | No | Simple stable tunnel |
| **ngrok** | 1 endpoint, 1GB BW | Yes (`*.ngrok-free.dev`) | Paid only | OAuth, Basic | Webhook dev/testing |
| **localhost.run** | Random URLs | No | $9/mo | No | Zero-install SSH tunnel |
| **bore** | Unlimited (OSS) | No | No | Shared secret | Quick TCP forwarding |
| **zrok** | Self-host free | Self-host only | Self-host | OAuth | Zero-trust sharing |
| **Inlets** | No free tier | N/A | Yes | No | Production self-hosted |

### Recommendations

**For development/testing:** ngrok is the most practical. One free stable dev domain, built-in webhook signature verification for 50+ providers, traffic inspection/replay for debugging.

**For persistent operation:** Cloudflare Tunnel is the strongest choice:
- Unlimited bandwidth at no cost
- Stable custom domain (requires domain on Cloudflare DNS)
- Built-in DDoS protection, WAF, bot management
- Outbound-only connection model (no open inbound ports)
- `cloudflared` daemon auto-reconnects and is designed for always-on use
- Cloudflare Access for identity-based authentication at the edge

**For simplicity:** Tailscale Funnel — one command (`tailscale funnel 3000`), stable `*.ts.net` URL, free, but no custom domains and no built-in auth layer.

### Cloud-Native Alternatives

Instead of tunneling from a local machine:

**Option A: VPS + Caddy + Tailscale (~$4/mo)**
Deploy a small VPS running Caddy (auto-TLS reverse proxy) + Tailscale mesh back to your local agent. Stable custom domain, full control.

**Option B: Cloud Function + Message Queue**
Deploy a minimal serverless function (Cloudflare Worker, AWS Lambda) that receives webhooks at a stable URL, validates signatures, and pushes to a queue (SQS, Redis). OllieBot polls or subscribes to the queue. Most resilient — webhooks are never lost even if OllieBot is offline.

**Option C: Webhook Relay (webhookrelay.com)**
Purpose-built SaaS for forwarding webhooks to local agents. Supports payload transformation, retries, multi-destination routing.

### Security Considerations

**Authentication at the endpoint:**
- Never rely on URL obscurity alone
- Implement per-source secret validation (HMAC, shared secret headers)
- Use tunnel provider's edge auth when available (Cloudflare Access, ngrok OAuth)

**TLS/HTTPS:**
- All reputable tunnel services provide automatic TLS termination
- Traffic between the tunnel daemon and localhost is typically unencrypted (acceptable on loopback)

**Rate limiting:**
- Implement application-level rate limiting on webhook endpoints
- Use tunnel provider's rate limiting when available (ngrok Traffic Policy, Cloudflare WAF)

**Webhook signature verification:**
- Always verify HMAC signatures from providers that support them (GitHub, Stripe, Slack, Todoist)
- Verify timestamps to prevent replay attacks (reject webhooks >5 minutes old)
- For providers without signing (IFTTT), use custom shared secrets

**Network isolation:**
- Bind local server to `127.0.0.1` only
- Never tunnel to `0.0.0.0`
- Consider running OllieBot in a container for additional isolation
- Shut down tunnels when not in use (for dev scenarios)

**Data handling:**
- Treat all webhook payloads as untrusted input
- Sanitize before processing or storing
- Log incoming requests for audit
- Implement idempotency to prevent duplicate processing

---

## Part 5: Integration with OllieBot Architecture

### Current Architecture Points of Extension

OllieBot already has several patterns that support external events:

1. **Express server** (`src/server/index.ts`) — existing HTTP endpoint infrastructure
2. **WebSocket channels** (`src/channels/web.ts`) — real-time broadcast to UI
3. **MessageEventService** (`src/services/message-event-service.ts`) — unified broadcast + persist
4. **TaskManager** (`src/tasks/manager.ts`) — cron-based scheduling (useful for subscription renewal and delta polling)
5. **Channel abstraction** (`src/channels/`) — extensible pattern for new input sources

### Proposed Integration Patterns

**Pattern A: Webhook Channel**
New channel type that converts inbound webhooks to messages for the supervisor:
```
HTTP POST → /api/webhooks/:source
  → Authenticate & validate
  → Transform to internal Message
  → Route to supervisor via MessageEventService
  → Supervisor processes, responds
  → Response persisted + broadcast to UI
```

**Pattern B: Subscription Manager Service**
Background service that manages Graph/Google subscriptions:
```
On startup:
  → Create/renew webhook subscriptions for configured sources
  → Schedule renewal via TaskManager (every 2 days for Graph)
  → Schedule safety delta polls (every 30 min)

On webhook notification:
  → Verify clientState/signature
  → Fetch changed data via delta query
  → Route to supervisor as Message
```

**Pattern C: Polling Connector**
For sources without webhook support (Google Tasks, etc.):
```
TaskManager cron job (every N minutes):
  → Call delta/sync API
  → Diff against last known state
  → Generate Message for each change
  → Route to supervisor
```

### Next Steps

1. Implement a generic webhook receiver endpoint in the Express server
2. Implement a Microsoft Graph subscription manager (mail + calendar)
3. Add IFTTT webhook support as a second webhook source
4. Set up Cloudflare Tunnel (or ngrok for dev) for public endpoint
5. Build subscription renewal and lifecycle management
6. Add delta query polling as a safety mechanism
