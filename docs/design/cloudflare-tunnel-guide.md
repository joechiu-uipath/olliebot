# Cloudflare Tunnel Integration Guide

Detailed guide for exposing OllieBot's webhook endpoints to the internet using Cloudflare Tunnel.

---

## Why Cloudflare Tunnel?

- **Free**: Unlimited tunnels, unlimited bandwidth, automatic TLS, DDoS protection
- **Outbound-only**: `cloudflared` makes outbound connections to Cloudflare's edge — no open inbound ports on your machine
- **Stable URLs**: Custom domain on your Cloudflare zone (e.g., `webhooks.yourdomain.com`)
- **Always-on**: Designed for persistent operation with auto-reconnect and systemd integration
- **Security layers**: Cloudflare Access (SSO), WAF, bot management — all at the edge
- **Open source**: `cloudflared` client is Apache 2.0 licensed

---

## Installation

### Linux (Debian/Ubuntu)

```bash
# .deb package (amd64)
curl -L -o cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# Verify
cloudflared --version
```

### macOS

```bash
brew install cloudflare/cloudflare/cloudflared
```

### Docker

```bash
# Quick tunnel (no config needed)
docker run cloudflare/cloudflared:latest tunnel --no-autoupdate --url http://host.docker.internal:3000

# Named tunnel with token (remotely managed)
docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TUNNEL_TOKEN>
```

---

## Quick Tunnel (30-Second Dev Setup)

No account, no domain, no config file needed:

```bash
cloudflared tunnel --url http://localhost:3000
```

Output:
```
Your quick Tunnel has been created! Visit it at:
https://randomly-generated-words.trycloudflare.com
```

Your Express.js webhook endpoint at `localhost:3000/api/webhooks/github` becomes:
```
https://randomly-generated-words.trycloudflare.com/api/webhooks/github
```

**Characteristics:**
- Ephemeral — new random URL each time
- HTTPS with valid TLS certificate
- Rate limited to 200 concurrent in-flight requests
- No SSE support
- No Cloudflare account required
- Not suitable for production webhook subscriptions (URL changes on restart)

---

## Named Tunnel Setup (Persistent URLs)

### Prerequisites

1. A Cloudflare account (free)
2. A domain added to Cloudflare with nameservers pointed to Cloudflare

### Step 1: Authenticate

```bash
cloudflared tunnel login
```

This opens a browser for Cloudflare login. After authorizing, a certificate is saved to `~/.cloudflared/cert.pem`. This cert allows you to create/manage tunnels.

On headless servers, copy the printed URL and open it in any browser.

### Step 2: Create a Tunnel

```bash
cloudflared tunnel create olliebot-webhooks
```

Output:
```
Tunnel credentials written to /home/user/.cloudflared/<TUNNEL-UUID>.json
Created tunnel olliebot-webhooks with id ab1c2d3e-4f56-7890-abcd-ef1234567890
```

**Two credential files now exist:**

| File | Purpose |
|------|---------|
| `~/.cloudflared/cert.pem` | Administrative — create/delete tunnels, manage DNS |
| `~/.cloudflared/<UUID>.json` | Operational — run this specific tunnel (only file needed at runtime) |

### Step 3: Route DNS

```bash
cloudflared tunnel route dns olliebot-webhooks webhooks.yourdomain.com
```

This creates a CNAME record:
```
webhooks.yourdomain.com → ab1c2d3e-4f56-7890-abcd-ef1234567890.cfargotunnel.com
```

You can route multiple hostnames to the same tunnel:
```bash
cloudflared tunnel route dns olliebot-webhooks webhooks.yourdomain.com
cloudflared tunnel route dns olliebot-webhooks ollie.yourdomain.com
```

### Step 4: Create Configuration File

Create `~/.cloudflared/config.yml`:

**Minimal config:**

```yaml
tunnel: ab1c2d3e-4f56-7890-abcd-ef1234567890
credentials-file: /home/user/.cloudflared/ab1c2d3e-4f56-7890-abcd-ef1234567890.json

ingress:
  - hostname: webhooks.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

**Full config with multiple services:**

```yaml
tunnel: ab1c2d3e-4f56-7890-abcd-ef1234567890
credentials-file: /home/user/.cloudflared/ab1c2d3e-4f56-7890-abcd-ef1234567890.json

loglevel: info
logfile: /var/log/cloudflared/cloudflared.log

# Global defaults for all ingress rules
originRequest:
  connectTimeout: 30s
  noTLSVerify: false

ingress:
  # Webhook receiver — all paths forwarded to Express app
  - hostname: webhooks.yourdomain.com
    service: http://localhost:3000

  # OllieBot web UI (separate hostname, can add Cloudflare Access)
  - hostname: ollie.yourdomain.com
    service: http://localhost:3000

  # Catch-all (REQUIRED as last rule)
  - service: http_status:404
```

**Validate your config:**

```bash
cloudflared tunnel ingress validate
```

**Test which rule matches a URL:**

```bash
cloudflared tunnel ingress rule https://webhooks.yourdomain.com/api/webhooks/github
```

### Step 5: Run the Tunnel

**Foreground (development):**

```bash
cloudflared tunnel run olliebot-webhooks
```

**As a systemd service (persistent):**

```bash
# Install the service (copies config to /etc/cloudflared/)
sudo cloudflared --config ~/.cloudflared/config.yml service install

# Enable and start
sudo systemctl enable --now cloudflared

# Verify
sudo systemctl status cloudflared
journalctl -u cloudflared -f
```

The generated systemd unit:
```ini
[Unit]
Description=cloudflare tunnel
After=network.target

[Service]
TimeoutStartSec=0
Type=notify
ExecStart=/usr/local/bin/cloudflared --config /etc/cloudflared/config.yml --no-autoupdate tunnel run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

> After installing as a service, edits go to `/etc/cloudflared/config.yml` (not `~/.cloudflared/`). Restart the service after changes.

---

## URL Patterns and Path Routing

### How Paths Work

Cloudflare Tunnel is a **transparent proxy at the hostname level**. The entire request path is forwarded as-is to the origin service:

```
Internet request:  POST https://webhooks.yourdomain.com/api/webhooks/github
 ↓ (Cloudflare edge)
 ↓ (cloudflared tunnel)
Local request:     POST http://localhost:3000/api/webhooks/github
```

The path is preserved exactly. You do **not** need per-path ingress rules for webhooks. One hostname rule forwards everything, and Express handles routing:

```typescript
// Express routes — all reachable through the single tunnel hostname
app.post('/api/webhooks/graph',  handleGraphNotification);   // Microsoft Graph
app.post('/api/webhooks/github', handleGitHubWebhook);       // GitHub
app.post('/api/webhooks/ifttt',  handleIFTTTWebhook);        // IFTTT
app.post('/api/webhooks/slack',  handleSlackEvent);           // Slack
```

### What to Register with Webhook Providers

| Provider | Webhook URL to Register |
|----------|------------------------|
| Microsoft Graph | `https://webhooks.yourdomain.com/api/webhooks/graph` |
| GitHub | `https://webhooks.yourdomain.com/api/webhooks/github` |
| IFTTT | `https://webhooks.yourdomain.com/api/webhooks/ifttt` |
| Slack Events API | `https://webhooks.yourdomain.com/api/webhooks/slack` |
| Quick tunnel (dev) | `https://random-words.trycloudflare.com/api/webhooks/github` |

### Advanced: Path-Based Routing to Different Services

If OllieBot runs multiple local services, you can route different URL paths to different ports:

```yaml
ingress:
  - hostname: app.yourdomain.com
    path: "^/api/webhooks/.*$"
    service: http://localhost:3000      # webhook handler

  - hostname: app.yourdomain.com
    path: "^/api/.*$"
    service: http://localhost:4000      # REST API

  - hostname: app.yourdomain.com
    service: http://localhost:8080      # frontend

  - service: http_status:404
```

The `path` value is a **regex**, not a glob. Rules are evaluated top-to-bottom, first match wins.

---

## Cloudflare Access (Protecting Non-Webhook Endpoints)

Webhook endpoints must be open to the internet (webhook providers can't authenticate via SSO). But OllieBot's web UI and API should be protected.

### Recommended: Separate Hostnames

```yaml
ingress:
  # Webhooks — open, no Access policy
  - hostname: webhooks.yourdomain.com
    service: http://localhost:3000

  # Web UI — protected by Cloudflare Access
  - hostname: ollie.yourdomain.com
    service: http://localhost:3000

  - service: http_status:404
```

Configure Cloudflare Access on `ollie.yourdomain.com` only:

1. Go to [Zero Trust dashboard](https://one.dash.cloudflare.com) → **Access controls** → **Applications**
2. **Add application** → **Self-hosted**
3. Set domain to `ollie.yourdomain.com`
4. Add an **Allow** policy (e.g., "Emails ending in @yourdomain.com")
5. Choose identity provider (Google, GitHub, one-time PIN, etc.)

Now the web UI requires SSO login, but webhook endpoints remain open for Microsoft Graph, IFTTT, etc. to POST to.

### Service Tokens (Machine-to-Machine Auth)

For programmatic access to protected endpoints:

1. Zero Trust → **Service credentials** → **Service tokens** → Create
2. You get `CF-Access-Client-Id` and `CF-Access-Client-Secret`
3. Clients include these as HTTP headers

---

## Dashboard vs. CLI Management

### CLI-Managed (Locally-Managed Tunnel)

- Config lives in `~/.cloudflared/config.yml`
- Managed via `cloudflared tunnel` commands
- Auth via `cert.pem` + `<UUID>.json`
- Best for: solo developers, version-controlled configs

### Dashboard-Managed (Remotely-Managed Tunnel)

- Config lives on Cloudflare's servers
- Managed via [Zero Trust dashboard](https://one.dash.cloudflare.com) → **Networks** → **Connectors** → **Cloudflare Tunnels**
- Auth via a single tunnel token
- Run command: `cloudflared tunnel --no-autoupdate run --token <TOKEN>`
- Best for: teams, Docker/K8s, no local config files needed

Both approaches produce the same result. Dashboard-managed is simpler for Docker deployments since you only need to pass a single token string.

---

## Pricing

| What | Cost |
|------|------|
| Cloudflare Tunnel | **Free** — unlimited tunnels (up to 1,000), unlimited bandwidth |
| Automatic TLS | **Free** |
| DDoS protection | **Free** |
| Cloudflare Access (Zero Trust) | **Free** up to 50 users |
| Domain on Cloudflare | **At-cost** via Cloudflare Registrar (e.g., `.com` ~$10/year) |
| Argo Smart Routing (optional) | ~$5/mo + $0.10/GB — optimizes routing, not required |

**For OllieBot receiving webhooks: total cost is $0** (assuming you already have a domain, or can register one cheaply).

---

## Cloudflare Tunnel vs. ngrok

| | Cloudflare Tunnel | ngrok |
|---|---|---|
| **Quick start** | `cloudflared tunnel --url localhost:3000` | `ngrok http 3000` |
| **Free stable URLs** | Yes (your domain) | No (paid feature) |
| **Free bandwidth** | Unlimited | 1 GB/mo |
| **Custom domains (free)** | Yes | No |
| **Request inspection UI** | No | Yes (`localhost:4040`) |
| **Webhook replay** | No | Yes |
| **DDoS protection** | Full Cloudflare stack | Basic |
| **Edge authentication** | Cloudflare Access (SSO) | OAuth/JWT (paid) |
| **Open source client** | Yes (Apache 2.0) | No |
| **Production-ready** | Yes | Primarily dev/testing |
| **Setup effort** | More (domain, DNS, config) | Less (sign up, one command) |

**Use ngrok** for quick debugging with its inspector UI and replay. **Use Cloudflare Tunnel** for persistent webhook endpoints in a continuously running agent.

---

## End-to-End: OllieBot Webhook Setup

### 1. Express webhook routes (in OllieBot)

```typescript
// src/server/routes/webhooks.ts
import { Router } from 'express';

const router = Router();

// Microsoft Graph change notifications
router.post('/api/webhooks/graph', (req, res) => {
  // Step 1: Handle validation token (subscription creation)
  if (req.query.validationToken) {
    return res.type('text/plain').send(req.query.validationToken);
  }

  // Step 2: Verify clientState
  const notifications = req.body.value;
  for (const n of notifications) {
    if (n.clientState !== process.env.GRAPH_CLIENT_STATE) {
      return res.status(403).send('Invalid clientState');
    }
  }

  // Step 3: Acknowledge immediately, process async
  res.status(202).send();
  processGraphNotifications(notifications);
});

// IFTTT webhooks
router.post('/api/webhooks/ifttt', (req, res) => {
  if (req.headers['x-olliebot-secret'] !== process.env.IFTTT_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  res.status(200).json({ received: true });
  processIFTTTEvent(req.body);
});

// GitHub webhooks (HMAC-SHA256 signed)
router.post('/api/webhooks/github', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  if (!verifyGitHubSignature(req.body, signature)) {
    return res.status(401).send('Invalid signature');
  }
  res.status(200).json({ received: true });
  processGitHubEvent(req.headers['x-github-event'], req.body);
});

export default router;
```

### 2. Cloudflare Tunnel config

```yaml
# ~/.cloudflared/config.yml
tunnel: <your-tunnel-uuid>
credentials-file: /home/user/.cloudflared/<your-tunnel-uuid>.json

ingress:
  - hostname: webhooks.yourdomain.com
    service: http://localhost:3000
  - hostname: ollie.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

### 3. Run everything

```bash
# Terminal 1: OllieBot
npm run dev   # Express listens on localhost:3000

# Terminal 2: Tunnel
cloudflared tunnel run olliebot-webhooks

# Now register these URLs with providers:
#   Microsoft Graph subscription → https://webhooks.yourdomain.com/api/webhooks/graph
#   GitHub webhook               → https://webhooks.yourdomain.com/api/webhooks/github
#   IFTTT "Make web request"     → https://webhooks.yourdomain.com/api/webhooks/ifttt
```

### 4. For production: systemd

```bash
sudo cloudflared --config ~/.cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
```

Both OllieBot and `cloudflared` survive reboots and run persistently.
