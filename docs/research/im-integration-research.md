# Instant Messenger Integration Research

**Date**: 2026-03-13
**Status**: Research / Pre-implementation

---

## 1. Executive Summary

This document evaluates 6 messaging platforms for integration into OllieBot as external channels. The goal is to allow users to interact with OllieBot through their preferred messenger, with OllieBot receiving messages, processing them through its agent system, and replying via the same platform.

### Quick Comparison Matrix

| Platform | Bot Identity | Basic Input | Basic Output | Rich Output | Multi-Conversation | Difficulty |
|----------|-------------|-------------|--------------|-------------|-------------------|------------|
| **Teams** | Official (Azure AD) | Webhook | REST Activity | Adaptive Cards | Yes (per chat/channel) | Medium |
| **Slack** | Official (Bot Token) | Webhook / WebSocket | REST Web API | Block Kit | Yes (per thread) | Easy |
| **WhatsApp** | Business phone number | Webhook | REST Graph API | Interactive messages | No (1 per user) | Medium |
| **SMS/RCS** | Phone number | Webhook | REST Twilio API | RCS cards (fallback SMS) | No (1 per number) | Easy |
| **Messenger** | Facebook Page | Webhook | REST Send API | Templates + Quick Replies | Yes (per user) | Medium |
| **Discord** | Official (Bot Token) | WebSocket Gateway | REST API | Embeds | Yes (per channel/thread) | Easy |

**Priority**: Teams, Slack, WhatsApp, SMS/RCS are highest value. Discord and Messenger are secondary.

---

## 2. Existing OllieBot Channel Architecture

OllieBot already has a clean channel abstraction in `src/channels/types.ts`. Every communication interface implements the `Channel` interface:

```typescript
interface Channel {
  readonly id: string;
  readonly name: string;
  init(): Promise<void>;
  close(): Promise<void>;
  isConnected(): boolean;
  send(content: string, options?: SendOptions): Promise<void>;
  sendError(error: string, details?: string, conversationId?: string): Promise<void>;
  startStream(streamId: string, options?: StreamStartOptions): void;
  sendStreamChunk(streamId: string, chunk: string, conversationId?: string): void;
  endStream(streamId: string, options?: StreamEndOptions): void;
  onMessage(handler: (message: Message) => Promise<void>): void;
  onAction(handler: (action: string, data: unknown) => Promise<void>): void;
  broadcast(data: unknown): void;
}
```

Currently implemented: `ConsoleChannel` (stdin/stdout) and `WebSocketChannel` (web UI). Each messenger platform will become a new `Channel` implementation registered with the supervisor via `supervisor.registerChannel(channel)`.

**Key pattern**: The supervisor uses request-scoped `conversationId` from `message.metadata.conversationId` — each message carries its conversation context, enabling multiple concurrent conversations across all channels simultaneously.

---

## 3. Platform Deep Dives

---

### 3.1 Microsoft Teams ⭐ HIGH PRIORITY

#### Bot Identity

Teams bots are **official first-class citizens** with dedicated Azure AD identity:

1. Create an **Azure AD App Registration** → get `App ID` (client ID) and `App Secret`
2. Register a **Bot resource** in Azure Bot Service (or directly in Teams Developer Portal)
3. Bot appears as a distinct user in Teams with configurable display name and avatar
4. Supports single-tenant, multi-tenant, and user-assigned managed identity modes
5. **Important**: Multi-tenant bots deprecated after July 31, 2025. Microsoft now recommends single-tenant or user-assigned MSI for new bots.

No user impersonation needed — the bot has its own Azure AD identity.

#### Basic Input

Teams delivers messages via **HTTP POST webhook** (Activity-based model):

```
Teams → POST https://yourdomain.com/webhooks/teams
        Authorization: Bearer <JWT signed by Azure AD>
        Body: Activity JSON
```

Activity JSON shape for a user message:
```json
{
  "type": "message",
  "id": "1234567890123",
  "timestamp": "2026-03-13T10:00:00Z",
  "serviceUrl": "https://smba.trafficmanager.net/...",
  "channelId": "msteams",
  "from": { "id": "29:1abc...", "name": "Alice" },
  "conversation": { "id": "19:abc123@thread.v2", "isGroup": false },
  "text": "Hello OllieBot"
}
```

JWT validation: Extract `Bearer` token from `Authorization` header, validate against Azure AD OpenID Connect metadata at `https://login.microsoftonline.com/{tenantId}/v2.0/.well-known/openid-configuration`.

#### Basic Output

Bot replies by POST-ing an Activity back to the `serviceUrl` from the inbound Activity:

```
POST {serviceUrl}/v3/conversations/{conversationId}/activities
Authorization: Bearer <bot_access_token>
Content-Type: application/json

{
  "type": "message",
  "text": "Hello! How can I help?",
  "replyToId": "1234567890123"
}
```

Bot access token obtained from:
```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
grant_type=client_credentials
client_id={APP_ID}
client_secret={APP_SECRET}
scope=https://api.botframework.com/.default
```

Tokens are valid ~1 hour and should be cached.

#### Rich Output

Teams supports **Adaptive Cards** — a JSON-based card format:

```json
{
  "type": "message",
  "attachments": [{
    "contentType": "application/vnd.microsoft.card.adaptive",
    "content": {
      "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      "type": "AdaptiveCard",
      "version": "1.4",
      "body": [
        { "type": "TextBlock", "text": "# Hello", "wrap": true },
        { "type": "Image", "url": "https://..." }
      ],
      "actions": [
        { "type": "Action.Submit", "title": "Click me", "data": { "action": "confirm" } }
      ]
    }
  }]
}
```

**Supported card versions**: v1.5 on Teams desktop, **v1.4 is the safe cross-platform target** (desktop + mobile). Markdown is **not rendered** in Adaptive Cards — text must use `TextBlock` elements. Code requires inline styling via `fontType: "Monospace"`.

Other supported formats: Hero cards, Thumbnail cards, List cards — all via the same `attachments` mechanism.

#### Chat Session Control

- **1:1 chats**: `conversation.id` is unique per user–bot pair. Maps cleanly to one OllieBot conversation.
- **Group chats / channels**: `conversation.id` is the channel. Multiple users share one conversation.
- **Threading**: `replyToId` creates a **visible reply** in Teams but does NOT create a true thread like in Slack. Each reply starts a new independent message chain. There is no `thread_ts` equivalent.
- **Multi-conversation**: OllieBot can maintain separate conversations per Teams channel/chat, but within a single channel it's a flat conversation.

For OllieBot: map `conversation.id` → `ollieConversationId`. A user starting a new chat with the bot in a different Teams channel creates a different OllieBot conversation.

#### SDK / Technical Integration

**Current recommendation (2026)**: Microsoft 365 Agents SDK (`@microsoft/agents-activity`, `@microsoft/agents-bot-activity`). The Bot Framework SDK v4 is deprecated as of **December 31, 2025**.

```typescript
import { ActivityHandler, TurnContext } from '@microsoft/agents-sdk';

class OllieBotTeamsAdapter extends ActivityHandler {
  async onMessage(context: TurnContext): Promise<void> {
    const text = context.activity.text?.trim() ?? '';
    // Strip @bot mention
    const cleanText = text.replace(/<at>[^<]+<\/at>/g, '').trim();
    await this.handleInbound(context, cleanText);
  }
}
```

Alternatively (lightweight approach): skip the SDK entirely, implement JWT validation with `jsonwebtoken` and make direct REST calls. This avoids the heavy SDK dependency.

#### Open-Source Ecosystem

- **Rasa**: Ships a `MSTeamsConnector` class implementing `OutputChannel`. Validates JWT, sends Adaptive Cards via REST.
- **Botpress**: Native Teams integration via `@botpress/channel-teams`. Handles token caching and card formatting.
- **Bottender**: `@bottender/teams` package with automatic JWT verification and Adaptive Card helpers.
- **Microsoft's own samples**: `botbuilder-samples` repo on GitHub has extensive Node.js/TypeScript examples showing the full webhook → reply flow.

#### Constraints

| Constraint | Details |
|------------|---------|
| Rate limits | No documented hard limit, but throttling occurs under burst load; implement retry with backoff |
| Token refresh | Bot tokens expire in ~1 hour; cache and refresh proactively |
| App registration | Requires Azure account; free tier sufficient for development |
| Approval for org-wide | IT admin must approve bot installation across a tenant |
| Card version | Target Adaptive Card v1.4 for mobile compatibility |
| SDK deprecation | Bot Framework SDK v4 deprecated Dec 2025 → use M365 Agents SDK or raw REST |

---

### 3.2 Slack ⭐ HIGH PRIORITY

#### Bot Identity

Slack bots have **official first-class identity**:

1. Create a **Slack App** at api.slack.com/apps
2. Enable **Bot User** → gets a bot token starting with `xoxb-`
3. Define OAuth scopes (e.g., `chat:write`, `channels:history`, `im:history`, `im:write`)
4. Bot appears in workspace member list with configurable name and avatar
5. Supports both Socket Mode (WebSocket, no public URL) and Events API (HTTP webhook)

No user impersonation — the bot is its own workspace entity.

#### Basic Input

**Two modes:**

**Events API (production)** — HTTP POST webhook:
```
Slack → POST https://yourdomain.com/webhooks/slack
        X-Slack-Signature: v0=<HMAC-SHA256>
        X-Slack-Request-Timestamp: 1741867200
        Body: JSON event payload
```

Signature verification:
```typescript
const sigBase = `v0:${timestamp}:${rawBody}`;
const expectedSig = 'v0=' + hmacSHA256(signingSecret, sigBase);
if (!timingSafeEqual(expectedSig, requestSig)) throw new Error('Invalid signature');
```

**Socket Mode (development)** — WebSocket connection, no public URL needed:
```typescript
import { SocketModeClient } from '@slack/socket-mode';
const client = new SocketModeClient({ appToken: process.env.SLACK_APP_TOKEN });
client.on('message', async ({ event, ack }) => {
  await ack();
  // handle event
});
await client.start();
```

Event payload for a DM or channel message:
```json
{
  "type": "event_callback",
  "event": {
    "type": "message",
    "text": "Hello OllieBot",
    "user": "U01234567",
    "channel": "D01234567",
    "ts": "1741867200.000001",
    "thread_ts": "1741867200.000001"
  }
}
```

Handle `url_verification` challenge on initial webhook setup:
```json
{ "type": "url_verification", "challenge": "abc123" }
→ respond with: { "challenge": "abc123" }
```

#### Basic Output

Use Slack Web API `chat.postMessage`:
```
POST https://slack.com/api/chat.postMessage
Authorization: Bearer xoxb-your-bot-token
Content-Type: application/json

{
  "channel": "D01234567",
  "text": "Fallback text",
  "thread_ts": "1741867200.000001",
  "blocks": [...]
}
```

Always include `text` as a fallback for notifications even when using blocks. Include `thread_ts` to reply in-thread.

#### Rich Output

Slack uses **Block Kit** — a JSON-based UI framework:

```json
{
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Hello!* Here's a summary:" }
    },
    {
      "type": "image",
      "image_url": "https://...",
      "alt_text": "A chart"
    },
    {
      "type": "actions",
      "elements": [
        { "type": "button", "text": { "type": "plain_text", "text": "Approve" }, "action_id": "approve", "value": "approve" },
        { "type": "button", "text": { "type": "plain_text", "text": "Reject" }, "action_id": "reject", "value": "reject" }
      ]
    }
  ]
}
```

Slack's `mrkdwn` supports: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, ` ```code blocks``` `, `>quote`, `<url|link>`. Standard markdown renders natively — ideal for OllieBot's markdown output.

**Streaming simulation**: Send initial message with `chat.postMessage` → receive `ts` → use `chat.update` with same `ts` to progressively update as LLM generates. Throttle to ~1 update/second to avoid rate limits.

#### Chat Session Control

Slack has **excellent multi-conversation support**:

- **Direct Messages**: 1:1 bot–user conversation → `channel = D...`
- **Channel messages**: Bot mentioned in a public/private channel → `channel = C...`
- **Threads**: Users reply in a thread → `thread_ts` identifies the parent message

For OllieBot: map `(channel, thread_ts)` → `ollieConversationId`. Each thread is a separate conversation. A new top-level message in a channel starts a new thread/conversation. This enables true multi-conversation: Alice can have thread A and thread B in the same Slack channel, each mapping to a different OllieBot conversation.

#### SDK / Technical Integration

**Recommended**: `@slack/bolt` — Slack's official framework:

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // dev mode, no public URL needed
  appToken: process.env.SLACK_APP_TOKEN,
});

app.message(async ({ message, say }) => {
  if (message.subtype) return; // ignore bot messages, edits, etc.
  const text = (message as any).text ?? '';
  // pass to OllieBot supervisor
  await say({ thread_ts: (message as any).ts, text: response });
});
```

For raw webhook (no SDK): implement HMAC-SHA256 verification + direct `fetch` calls to `slack.com/api/chat.postMessage`.

#### Open-Source Ecosystem

- **Rasa**: `SlackInput`/`SlackOutput` connector. Handles `url_verification`, strips bot mentions, posts via Web API.
- **Botpress**: `@botpress/channel-slack` with Socket Mode support and Block Kit formatting.
- **Bottender**: `createSlackBot()` factory with automatic signature verification and rate limiting.
- **Langchain/AutoGPT integrations**: Many use `@slack/bolt` directly with an LLM message handler.

#### Constraints

| Constraint | Details |
|------------|---------|
| Rate limits | Tier 2: 20+ req/min for `chat.postMessage`; Tier 3: 50+ req/min for reads |
| Socket Mode | Requires App-Level Token (`xapp-`) in addition to Bot Token (`xoxb-`) |
| Bot mentions | Strip `<@BOTID>` from message text before passing to supervisor |
| Message length | 3,000 characters per block, 50 blocks per message; split long responses |
| Workspace install | Each workspace requires separate OAuth install (unless distributing as public app) |

---

### 3.3 WhatsApp Business ⭐ HIGH PRIORITY

#### Bot Identity

WhatsApp bots operate as a **business phone number**, not a named bot identity:

1. Create **Meta Developer Account** → **Meta Business Account** → **WhatsApp Business Account (WABA)**
2. Register a **dedicated phone number** with the WABA (cannot be logged into WhatsApp/WA Business app simultaneously)
3. Business profile includes display name (requires Meta approval), description, website
4. Get **Phone Number ID** and **Access Token** from Meta Developer Console
5. **Facebook Business Verification** required for sending >250 messages/day or getting "Official Business Account" badge

The bot appears to users as a business contact, not a traditional chat bot.

#### Basic Input

WhatsApp delivers messages via **HTTP webhook** (Meta Webhooks pattern):

**Webhook verification** (GET, one-time setup):
```
GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=1234
→ respond with: 1234 (the challenge value)
```

**Inbound messages** (POST):
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "messages": [{
          "id": "wamid.abc123",
          "from": "15551234567",
          "timestamp": "1741867200",
          "type": "text",
          "text": { "body": "Hello OllieBot" }
        }],
        "contacts": [{ "profile": { "name": "Alice" }, "wa_id": "15551234567" }]
      }
    }]
  }]
}
```

Verify request using HMAC-SHA256 of raw body with `App Secret`:
```typescript
const sig = req.headers['x-hub-signature-256']; // sha256=<hash>
const expected = 'sha256=' + hmacSHA256(appSecret, rawBody);
```

#### Basic Output

**Session messages** (within 24h of last user message — free):
```
POST https://graph.facebook.com/v22.0/{phone_number_id}/messages
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "to": "15551234567",
  "type": "text",
  "text": { "body": "Hello! How can I help?" }
}
```

**Template messages** (outside 24h window — requires pre-approved template):
```json
{
  "messaging_product": "whatsapp",
  "to": "15551234567",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": { "code": "en_US" }
  }
}
```

Templates must be submitted to Meta for approval. Approval typically takes 24–48 hours. Templates support variables (e.g., `Hello {{1}}!`).

#### Rich Output

WhatsApp supports **interactive messages** within the 24h session window:

**Interactive buttons** (max 3 buttons):
```json
{
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": { "text": "Choose an option:" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "opt1", "title": "Option 1" } },
        { "type": "reply", "reply": { "id": "opt2", "title": "Option 2" } }
      ]
    }
  }
}
```

**List messages** (up to 10 items):
```json
{
  "type": "interactive",
  "interactive": {
    "type": "list",
    "body": { "text": "Select an item:" },
    "action": {
      "button": "View options",
      "sections": [{ "title": "Section", "rows": [{ "id": "r1", "title": "Item 1" }] }]
    }
  }
}
```

**Media messages**: Images, documents, audio, video (send as `type: "image"` with `image.link` URL).

**Text formatting**: WhatsApp supports limited markdown: `*bold*`, `_italic_`, `~strikethrough~`, `` `monospace` ``. No headers, no tables.

#### Chat Session Control

WhatsApp has **no threading model** — it's a flat conversation per user:

- Each user's phone number maps to exactly **one conversation thread**
- No concept of multiple parallel conversations with the same user
- For OllieBot: `from` phone number → one `ollieConversationId` per user
- **24-hour session window**: OllieBot can freely reply within 24h of the last user message. After 24h, only template messages can be sent.
- Session tracking required: store `lastInboundAt` timestamp in conversation metadata; check before each send.

#### SDK / Technical Integration

No official Node.js SDK for the Cloud API — use direct `fetch` to the Graph API:

```typescript
async function sendWhatsAppMessage(to: string, text: string): Promise<void> {
  const response = await fetch(
    `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    }
  );
}
```

Third-party libraries: `whatsapp-cloud-api` (npm), `@green-api/whatsapp-api-client`. Most teams use the Cloud API directly.

#### Open-Source Ecosystem

- **Rasa**: `WhatsAppConnector` via Twilio or Meta Cloud API. Handles session window tracking.
- **Botpress**: `@botpress/channel-whatsapp` with template management UI.
- **Moltbot**: Self-hosted, explicitly supports WhatsApp via Meta Cloud API. Stores session state in SQLite.
- **n8n / Zapier**: No-code integration via webhook triggers + HTTP node to Graph API.

#### Constraints

| Constraint | Details |
|------------|---------|
| 24-hour window | Free replies only within 24h of last user message; template messages required after |
| Template approval | All outbound-initiated messages require pre-approved templates (24-48h approval time) |
| Rate limits | 80 MPS default; upgradeable tiers: 250 → 2K → 10K → unlimited new conversations/day |
| Phone number | Dedicated number required; cannot simultaneously use WhatsApp app |
| Business verification | Required for >250 msgs/day or Official Business Account |
| Text limit | 4,096 characters per text message |
| No streaming | Cannot simulate streaming; buffer full response before sending |

---

### 3.4 SMS / RCS ⭐ HIGH PRIORITY

#### Bot Identity

SMS/RCS has **no named bot identity** — messages come from a phone number:

- **Long code** (standard phone number): Cheap, but limited throughput (1 MPS). Looks like a regular person texting.
- **Short code** (5-6 digit number): Higher throughput, but expensive and requires carrier approval (~4-6 weeks).
- **Toll-free number**: Good balance — higher throughput than long code, cheaper than short code, no lengthy approval.
- **Alphanumeric sender ID**: Send-only (no replies possible); not available in US/Canada.

For **RCS**: sender appears as a branded business with logo, name, and verified checkmark — much better than a raw phone number.

#### Basic Input (Twilio)

Twilio delivers inbound SMS/RCS via **HTTP webhook**:

```
POST /webhooks/sms
Content-Type: application/x-www-form-urlencoded

MessageSid=SMxxx&From=%2B15551234567&To=%2B15559876543&Body=Hello+OllieBot
```

Validate Twilio signature:
```typescript
import twilio from 'twilio';
const isValid = twilio.validateRequest(
  authToken,
  signature, // X-Twilio-Signature header
  fullWebhookUrl,
  params     // parsed form body as key-value object
);
```

#### Basic Output (Twilio)

```typescript
import twilio from 'twilio';
const client = twilio(accountSid, authToken);

await client.messages.create({
  body: 'Hello from OllieBot!',
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  to: '+15551234567',
});
```

Using `MessagingServiceSid` instead of `from` enables **automatic RCS → SMS fallback**: Twilio detects device capability and sends RCS if supported, SMS otherwise. No code change needed.

**TwiML webhook response** (simple synchronous reply, not recommended for slow LLM responses):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Hello from OllieBot!</Message>
</Response>
```

**Recommended**: Return empty `<Response/>` immediately, process asynchronously, send reply via REST API. This avoids Twilio timeout issues with slow LLM responses.

#### Rich Output

**SMS**: Plain text only. No formatting. Split at 160 chars (single SMS) or 1,600 chars (concatenated). Strip all markdown.

**MMS**: Images and short video. Include `mediaUrl` in Twilio API call. Carrier support varies.

**RCS** (via Twilio with Messaging Service):
- Rich cards with title, description, image, and action buttons
- Suggested replies (quick reply chips)
- Carousels
- Read receipts and typing indicators
- Twilio handles RCS/SMS fallback automatically

Example RCS rich card via Twilio (ContentSid approach):
```typescript
await client.messages.create({
  contentSid: 'HXxxx', // pre-built rich card template
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
  to: '+15551234567',
  contentVariables: JSON.stringify({ name: 'Alice' }),
});
```

Alternatively, Google's **RCS Business Messaging (Jibe)** API provides direct RCS without SMS fallback:
```
POST https://rcsbusinessmessaging.googleapis.com/v1/phones/{phone}/agentMessages
Authorization: Bearer {oauth_token}
Body: richCard or text message JSON
```
Google RCS uses Service Account OAuth2 and HMAC-SHA512 webhook verification. Good for branded RCS-first experiences, but no SMS fallback.

#### Chat Session Control

SMS/RCS has **no threading** — it's a flat conversation per phone number:

- Each user's `From` number maps to one conversation
- No concept of threads or multiple parallel conversations
- **Session management**: SMS is fully stateless. Implement time-based sessions: if last message is >4 hours ago, start a new OllieBot conversation. Configurable threshold.
- Store `lastMessageAt` in conversation metadata for session boundary detection.

#### SDK / Technical Integration

**Twilio** (recommended):
```typescript
// Inbound webhook handler
app.post('/webhooks/sms', async (c) => {
  const params = await c.req.parseBody();
  const from = params.From as string;
  const body = params.Body as string;

  // Validate signature
  const signature = c.req.header('X-Twilio-Signature') ?? '';
  const valid = twilio.validateRequest(authToken, signature, webhookUrl, params);
  if (!valid) return c.text('Forbidden', 403);

  // Acknowledge immediately, process async
  const twiml = new twilio.twiml.MessagingResponse();
  c.header('Content-Type', 'text/xml');
  return c.body(twiml.toString()); // empty response
});
```

**Google RCS Business Messaging**:
```typescript
// Uses googleapis npm package with service account auth
import { RcsBusinessMessaging } from 'rcsbusinessmessaging';
const client = new RcsBusinessMessaging({
  auth: new GoogleAuth({ keyFile: 'service-account.json', scopes: [...] })
});
```

#### Open-Source Ecosystem

- **Rasa**: `TwilioConnector` for SMS. Handles TwiML response and async send.
- **Botpress**: SMS channel via Twilio integration in Botpress Cloud.
- **BotMan** (PHP): `NexmoDriver` and `TwilioDriver` for SMS.
- **Twilio's own samples**: Extensive Node.js examples for webhook + async reply pattern at twilio.com/docs.

#### Constraints

| Constraint | Details |
|------------|---------|
| Rate limits | Long code: 1 MPS; Toll-free: 3 MPS; Short code: 100 MPS |
| RCS availability | RCS requires Messaging Service; device must support RCS; carriers must support |
| SMS character limit | 160 chars (single), 1,600 chars (concatenated multi-part) |
| No formatting | SMS is plain text only; all markdown must be stripped |
| No streaming | Buffer full LLM response before sending |
| Cost | Per-message pricing; MMS/RCS more expensive than SMS |
| Stateless | No native session; must implement time-based session grouping |

---

### 3.5 Facebook Messenger

#### Bot Identity

Messenger bots are tied to a **Facebook Page** (not a personal account):

1. Create a **Facebook Page** (business or public figure)
2. Create a **Meta App** linked to the page
3. Get a **Page Access Token** (long-lived)
4. Bot messages appear as coming from the Page, not a user
5. **No user impersonation** — the Page is the bot's identity

#### Basic Input

Meta delivers messages via webhook (same Meta Webhooks pattern as WhatsApp):

```
POST /webhooks/messenger
X-Hub-Signature-256: sha256=<hmac>

{
  "object": "page",
  "entry": [{
    "id": "PAGE_ID",
    "messaging": [{
      "sender": { "id": "USER_PSID" },
      "recipient": { "id": "PAGE_ID" },
      "timestamp": 1741867200000,
      "message": {
        "mid": "m_abc123",
        "text": "Hello OllieBot"
      }
    }]
  }]
}
```

Verify using same HMAC-SHA256 approach as WhatsApp (uses `App Secret`). Handle GET verification challenge on setup.

#### Basic Output

```
POST https://graph.facebook.com/v22.0/me/messages
Authorization: Bearer {page_access_token}

{
  "recipient": { "id": "USER_PSID" },
  "message": { "text": "Hello! How can I help?" }
}
```

#### Rich Output

Messenger supports **templates** and **quick replies**:

**Generic Template** (card carousel):
```json
{
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "generic",
        "elements": [{
          "title": "Card Title",
          "subtitle": "Card description",
          "image_url": "https://...",
          "buttons": [
            { "type": "postback", "title": "Click me", "payload": "action_id" },
            { "type": "web_url", "title": "Learn more", "url": "https://..." }
          ]
        }]
      }
    }
  }
}
```

**Quick Replies** (disappear after selection):
```json
{
  "message": {
    "text": "Choose an option:",
    "quick_replies": [
      { "content_type": "text", "title": "Option 1", "payload": "opt1" },
      { "content_type": "text", "title": "Option 2", "payload": "opt2" }
    ]
  }
}
```

**Button Template**: Text with action buttons. Max 3 buttons. Limited markdown support (bold only).

#### Chat Session Control

- Each user has a unique **Page-Scoped ID (PSID)** — stable per user–page pair
- **One conversation per user** — Messenger doesn't support multiple threads per user with the same page
- **No 24h restriction** on replies (unlike WhatsApp) for pages with Messaging permission
- Standard Messaging: respond within 24h of last user message (same pattern as WhatsApp)
- **Human Agent Tag**: allows 7-day window for complex issues requiring human followup
- For OllieBot: PSID → `ollieConversationId` (1:1 mapping)

#### Constraints

| Constraint | Details |
|------------|---------|
| Rate limits | 200 messages/second per page |
| 24h window | Standard messaging requires response within 24h; "Message Tags" for special cases |
| App review | Facebook reviews apps before granting full Messenger access; development mode works for testers |
| No markdown | Text messages don't render markdown; use templates for rich content |
| Page required | Must have a Facebook Page; personal accounts cannot host bots |

---

### 3.6 Discord

#### Bot Identity

Discord bots are **official first-class citizens** with dedicated bot identity:

1. Create application at discord.com/developers/applications
2. Add a **Bot** to the application → get Bot Token
3. Configure **Privileged Gateway Intents** as needed (Message Content Intent for reading messages)
4. Bot has username, discriminator, and avatar
5. **No approval needed** for servers with <100 members during development; verification required for 100+ server deployments

The bot appears as its own user in servers, clearly distinguished from human users.

#### Basic Input

Two connection modes:

**Gateway (WebSocket, recommended)**: Bot connects to Discord's WebSocket gateway and receives real-time events. No public URL needed.

```typescript
import { Client, GatewayIntentBits } from 'discord.js';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.mentions.has(client.user!)) return; // only respond when mentioned
  // handle message
});

await client.login(process.env.DISCORD_BOT_TOKEN);
```

**Interactions Endpoint (HTTP)**: Register application commands (slash commands); Discord sends HTTP POST on command invocation. Requires public URL but enables slash commands.

#### Basic Output

```typescript
// Reply to message
await message.reply('Hello from OllieBot!');

// Send to specific channel
const channel = client.channels.cache.get(channelId) as TextChannel;
await channel.send({ content: 'Hello!', embeds: [...] });
```

**Streaming simulation**: Send initial message → edit progressively as LLM generates:
```typescript
const msg = await channel.send('Thinking...');
// as chunks arrive:
await msg.edit(accumulatedContent);
// final edit with complete response
await msg.edit(finalContent);
```

#### Rich Output

Discord uses **Embeds** for rich content:

```typescript
const embed = {
  color: 0x5865F2, // Discord blurple
  title: 'Response Title',
  description: '**Markdown** _is_ supported natively!',
  fields: [
    { name: 'Field 1', value: 'Value 1', inline: true },
    { name: 'Field 2', value: 'Value 2', inline: true },
  ],
  image: { url: 'https://...' },
  footer: { text: 'OllieBot' },
  timestamp: new Date().toISOString(),
};

await channel.send({ embeds: [embed] });
```

**Discord markdown** renders natively in regular messages: `**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `code` ``, ` ```code blocks``` `, `> quote`, `# Headers`. This makes Discord the easiest platform for OllieBot's markdown output — minimal transformation needed.

**Buttons and select menus** via Action Rows:
```typescript
const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('approve').setLabel('Approve').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId('reject').setLabel('Reject').setStyle(ButtonStyle.Danger),
);
await channel.send({ content: 'Choose:', components: [row] });
```

#### Chat Session Control

Discord has **excellent multi-conversation support**:

- **Server channels**: Each channel is a separate conversation context. `channelId` → `ollieConversationId`.
- **Threads**: Users can create threads on messages; threads have their own `channelId`. `threadId` → separate `ollieConversationId`.
- **Direct Messages**: `channelId` of the DM → `ollieConversationId`.
- **Forum channels**: Each post is a thread — excellent for organizing multiple concurrent topics.

OllieBot can naturally support many parallel conversations: Alice's thread in #general, Bob's DM, and a public forum post each map to separate OllieBot conversations.

#### Constraints

| Constraint | Details |
|------------|---------|
| Rate limits | 50 requests/second global; per-channel: ~5 messages/second before slowmode kicks in |
| Message length | 2,000 characters per message; 4,096 for embed descriptions |
| Message Content Intent | Must enable "Message Content" privileged intent in developer portal to read message text |
| Verification | Bots in 100+ servers require Discord verification (simple application process) |
| Slash command latency | Must respond to interactions within 3 seconds or use deferred responses |

---

## 4. Cross-Platform Comparison

### Bot Identity

| Platform | Bot Type | Registration | User Impersonation |
|----------|----------|--------------|-------------------|
| Teams | Azure AD app | Azure Portal / Teams Dev Portal | No |
| Slack | Workspace bot | api.slack.com/apps | No |
| WhatsApp | Business phone | Meta Developer Console + Business Verification | No (business, not person) |
| SMS/RCS | Phone number | Twilio account | No |
| Messenger | Facebook Page | Meta Developer Console | No |
| Discord | Bot application | discord.com/developers | No |

All 6 platforms support **official bot identity** — no user impersonation required.

### Input/Output Mechanism

| Platform | Inbound | Outbound | Auth Type |
|----------|---------|----------|-----------|
| Teams | HTTP webhook (JWT auth) | REST POST to serviceUrl | Azure AD JWT |
| Slack | HTTP webhook or WebSocket | REST `chat.postMessage` | HMAC-SHA256 / Bot Token |
| WhatsApp | HTTP webhook | REST Graph API | HMAC-SHA256 / Bearer token |
| SMS/RCS | HTTP webhook | REST Twilio API | HMAC-SHA256 |
| Messenger | HTTP webhook | REST Send API | HMAC-SHA256 / Page token |
| Discord | WebSocket Gateway or HTTP | REST API / `.reply()` | Bot Token |

### Rich Content Capabilities

| Platform | Markdown | Images | Buttons | Cards/Templates | Streaming |
|----------|----------|--------|---------|-----------------|-----------|
| Teams | Via Adaptive Card only | Adaptive Card Image | Action buttons | Adaptive Cards | Edit message |
| Slack | Native mrkdwn | Image blocks | Action buttons | Block Kit sections | Edit via `chat.update` |
| WhatsApp | `*bold*` `_italic_` only | Media messages | Interactive (max 3) | List messages | Not supported |
| SMS | None | MMS (limited) | None (text only) | None | Not supported |
| RCS | Basic | Rich cards | Suggested replies | Rich cards, carousels | Not supported |
| Messenger | None | Attachment | Button template | Generic/list template | Not supported |
| Discord | Native markdown | Embed image | Component buttons | Embeds | Edit message |

### Threading / Multi-Conversation

| Platform | Threading | Multiple Convos per User | OllieBot Mapping |
|----------|-----------|--------------------------|-----------------|
| Teams | Limited (replyToId, not true threads) | Yes (per channel/chat) | `conversation.id` → conversationId |
| Slack | Native thread_ts | Yes (per thread) | `(channel, thread_ts)` → conversationId |
| WhatsApp | None | No (1 per user) | `from` phone → conversationId |
| SMS | None | No (1 per number) | `From` phone → conversationId |
| Messenger | None | No (1 per PSID) | `sender.id` → conversationId |
| Discord | Native threads | Yes (per channel/thread) | `channelId` → conversationId |

---

## 5. Shared Infrastructure Design

The goal: **thin per-platform adapters, fat shared layer**. Each platform adapter handles only:
1. Webhook signature verification
2. Parsing platform-native payload → `NormalizedInboundMessage`
3. Rendering `NormalizedOutboundMessage` → platform-native API calls

All conversation mapping, session management, streaming buffering, content rendering, and Channel interface implementation live in shared code.

### 5.1 Normalized Inbound Message

```typescript
// src/channels/messengers/types.ts

type MessengerPlatform = 'teams' | 'slack' | 'whatsapp' | 'sms' | 'messenger' | 'discord';

interface NormalizedInboundMessage {
  // Platform identity
  platform: MessengerPlatform;
  externalMessageId: string;      // Platform's native message ID
  externalThreadId: string;       // Channel/thread/conversation ID on the platform
  externalUserId: string;         // User's ID on the platform
  externalUserDisplayName?: string;

  // Content
  text: string;                   // Plain text, always present
  attachments?: NormalizedAttachment[];
  replyToMessageId?: string;      // If user replied to a specific message

  // Metadata
  timestamp: Date;
  rawPayload: unknown;            // Original platform payload for edge cases
}

interface NormalizedAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'location';
  url?: string;
  data?: string;                  // base64 fallback
  mimeType?: string;
  filename?: string;
  caption?: string;
}
```

### 5.2 Normalized Outbound Message

```typescript
interface NormalizedOutboundMessage {
  platform: MessengerPlatform;
  externalThreadId: string;       // Resolved from ConversationMapper
  replyToMessageId?: string;      // For platforms supporting thread replies
  blocks: OutboundBlock[];
  agent?: { name: string; emoji?: string };
}

type OutboundBlock =
  | { type: 'text'; content: string; format?: 'markdown' | 'plain' }
  | { type: 'image'; url?: string; data?: string; mimeType?: string; altText?: string; caption?: string }
  | { type: 'file'; url: string; filename: string; mimeType?: string }
  | { type: 'card'; title: string; subtitle?: string; body?: string; imageUrl?: string; actions?: CardAction[] }
  | { type: 'button_group'; buttons: CardAction[] }
  | { type: 'code'; language?: string; content: string };

interface CardAction {
  type: 'button' | 'link';
  label: string;
  value: string;                  // Action ID or URL
}
```

### 5.3 Messenger Adapter Interface

Each platform implements only this interface:

```typescript
// src/channels/messengers/adapter.ts

interface MessengerAdapter {
  readonly platform: MessengerPlatform;

  // Lifecycle
  init(app: Hono): Promise<void>;   // Register webhook routes
  close(): Promise<void>;

  // Inbound: parse raw webhook payload → normalized (null = ignore this event)
  parseInbound(rawPayload: unknown): NormalizedInboundMessage | null;

  // Outbound: normalized → platform API call
  sendOutbound(message: NormalizedOutboundMessage): Promise<{ externalMessageId: string }>;

  // Optional: update existing message (for streaming simulation)
  updateOutbound?(externalMessageId: string, message: NormalizedOutboundMessage): Promise<void>;

  // Webhook: verify request signature
  verifyWebhook(req: HonoRequest): Promise<boolean>;

  // Webhook: handle platform verification challenge (Slack, WhatsApp, Messenger)
  handleVerification?(req: HonoRequest): Response | null;
}
```

A typical adapter is **~200-400 lines** covering: config loading, webhook route setup, signature verification, payload parsing, and API client calls. No business logic.

### 5.4 MessengerChannel (shared Channel implementation)

A single `MessengerChannel` class implements the existing `Channel` interface for **all** platforms:

```typescript
// src/channels/messengers/messenger-channel.ts

class MessengerChannel implements Channel {
  readonly id: string;
  readonly name: string;

  private streamBuffers = new Map<string, { content: string; conversationId?: string }>();

  constructor(
    private adapter: MessengerAdapter,
    private conversationMapper: ConversationMapper,
    private contentRenderer: ContentRenderer,
  ) {
    this.id = `messenger-${adapter.platform}`;
    this.name = adapter.platform;
  }

  async init(): Promise<void> { /* delegate to adapter */ }
  async close(): Promise<void> { /* delegate to adapter */ }
  isConnected(): boolean { return true; }

  // Called by supervisor/worker to send response
  async send(content: string, options?: SendOptions): Promise<void> {
    const conversationId = options?.conversationId;
    if (!conversationId) return;

    const mapping = await this.conversationMapper.reverseResolve(conversationId);
    if (!mapping) return;

    const blocks = this.contentRenderer.markdownToBlocks(content, options);
    const degraded = this.contentRenderer.degradeForPlatform(blocks, this.adapter.platform);

    await this.adapter.sendOutbound({
      platform: this.adapter.platform,
      externalThreadId: mapping.externalThreadId,
      blocks: degraded,
      agent: options?.agent ? { name: options.agent.agentName ?? '', emoji: options.agent.agentEmoji } : undefined,
    });
  }

  // Streaming: buffer chunks, send complete message on endStream
  startStream(streamId: string, options?: StreamStartOptions): void {
    this.streamBuffers.set(streamId, { content: '', conversationId: options?.conversationId });
  }

  sendStreamChunk(streamId: string, chunk: string): void {
    const buf = this.streamBuffers.get(streamId);
    if (buf) buf.content += chunk;
  }

  async endStream(streamId: string, options?: StreamEndOptions): Promise<void> {
    const buf = this.streamBuffers.get(streamId);
    this.streamBuffers.delete(streamId);
    if (!buf?.content) return;

    await this.send(buf.content, { conversationId: buf.conversationId ?? options?.conversationId });
  }

  // Called by adapter when inbound message arrives
  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
    this.adapter.init(this.honoApp); // sets up webhook route that calls handleInbound
  }

  private async handleInbound(normalized: NormalizedInboundMessage): Promise<void> {
    const conversationId = await this.conversationMapper.resolve(
      normalized.platform,
      normalized.externalThreadId,
      normalized.externalUserId,
    );

    const message: Message = {
      id: normalized.externalMessageId,
      role: 'user',
      content: normalized.text,
      attachments: normalized.attachments?.map(a => ({
        name: a.filename ?? a.type,
        type: a.mimeType ?? a.type,
        size: 0,
        data: a.data ?? '',
      })),
      metadata: {
        conversationId,
        platform: normalized.platform,
        externalThreadId: normalized.externalThreadId,
        externalUserId: normalized.externalUserId,
        externalUserDisplayName: normalized.externalUserDisplayName,
      },
      createdAt: normalized.timestamp,
    };

    await this.messageHandler?.(message);
  }

  // broadcast: no-op for messengers (single-user channels)
  broadcast(_data: unknown): void {}
  onAction(handler: (action: string, data: unknown) => Promise<void>): void {}
  async sendError(error: string, _details?: string, conversationId?: string): Promise<void> {
    await this.send(`Error: ${error}`, { conversationId });
  }
}
```

### 5.5 ConversationMapper

```typescript
// src/channels/messengers/conversation-mapper.ts

interface ConversationMapper {
  // Find or create OllieBot conversation for a platform thread
  resolve(
    platform: MessengerPlatform,
    externalThreadId: string,
    externalUserId: string,
  ): Promise<string>; // returns ollieConversationId

  // Reverse: OllieBot conversationId → platform thread info
  reverseResolve(
    ollieConversationId: string,
  ): Promise<{ platform: MessengerPlatform; externalThreadId: string } | null>;
}
```

Backed by SQLite table:
```sql
CREATE TABLE IF NOT EXISTS messenger_conversations (
  platform          TEXT NOT NULL,
  external_thread_id TEXT NOT NULL,
  external_user_id  TEXT,
  ollie_conversation_id TEXT NOT NULL,
  metadata          TEXT,           -- JSON: lastInboundAt, phoneNumber, channelName, etc.
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  PRIMARY KEY (platform, external_thread_id)
);
```

`resolve()` behavior:
1. Look up `(platform, externalThreadId)` in table
2. If found: update `updated_at`, return `ollieConversationId`
3. If not found: create new OllieBot conversation (in `conversations` table with `metadata.channel = platform`), insert mapping row, return new ID
4. For time-bounded sessions (SMS, WhatsApp): check `lastInboundAt` in metadata; if >threshold (configurable per platform), create new conversation

### 5.6 ContentRenderer

```typescript
// src/channels/messengers/content-renderer.ts

interface ContentRenderer {
  // Convert OllieBot markdown + options → normalized blocks
  markdownToBlocks(markdown: string, options?: SendOptions): OutboundBlock[];

  // Degrade blocks for platform capabilities
  degradeForPlatform(blocks: OutboundBlock[], platform: MessengerPlatform): OutboundBlock[];
}
```

**Degradation rules**:

| Block Type | Teams | Slack | WhatsApp | SMS | Messenger | Discord |
|------------|-------|-------|----------|-----|-----------|---------|
| `text` (markdown) | Adaptive Card TextBlock | mrkdwn section | `*bold*` `_italic_` conversion | strip all | strip all | pass-through |
| `image` | Adaptive Card Image | image block | media message | omit (or MMS) | image attachment | embed image |
| `code` | TextBlock monospace | mrkdwn code | monospace `` ` `` | plain text | plain text | native ` ``` ` |
| `card` | Adaptive Card Container | section + accessory | interactive list item | text summary | generic template | embed |
| `button_group` | Adaptive Card Actions | actions block | interactive buttons (max 3) | numbered text list | quick replies | component row |
| Long text (>limit) | split | split | split at 4096 | split at 1600 | split | split at 2000 |

### 5.7 Streaming Strategy

Most messenger platforms do not support token-by-token streaming. `MessengerChannel` uses a **buffer-then-send** approach:

| Platform | Streaming Support | Strategy |
|----------|------------------|----------|
| Slack | Via message update | Buffer 1s of chunks, `chat.update` on interval; final update on `endStream` |
| Discord | Via message edit | Same as Slack using `msg.edit()` |
| Teams | Via activity update | Send initial empty card, `updateActivity()` every 1s |
| WhatsApp | None | Buffer entire response, send single message on `endStream` |
| SMS | None | Buffer entire response, send on `endStream` (may split) |
| Messenger | None | Buffer entire response, send on `endStream` |

For platforms supporting updates (Slack, Discord, Teams): `MessengerChannel.startStream()` can send a placeholder message and store its ID, then `sendStreamChunk()` accumulates content and schedules throttled updates, and `endStream()` sends the final content.

---

## 6. Recommended Implementation Order

| Phase | Platforms | Reason |
|-------|-----------|--------|
| 1 | Foundation (shared types, ConversationMapper, ContentRenderer, MessengerChannel, WebhookRouter) | Required by all platforms |
| 2 | Slack | Best dev experience (Socket Mode = no public URL), best docs, immediate value |
| 3 | Discord | Very similar model to Slack, easy to validate the shared layer |
| 4 | Teams | Requires Azure setup; Slack implementation validates the architecture first |
| 5 | WhatsApp | Requires Meta Business verification; phone number setup |
| 6 | SMS/RCS | Requires Twilio account and number |
| 7 | Facebook Messenger | Requires Facebook Page and app review |

### Dependencies to Add

```json
{
  "@slack/bolt": "^4.x",          // Slack - Socket Mode + Events API
  "discord.js": "^14.x",          // Discord - Gateway WebSocket
  "@microsoft/agents-sdk": "^1.x", // Teams - M365 Agents SDK
  "twilio": "^5.x"                // SMS/RCS - request validation + API client
}
```

WhatsApp, Messenger, and Teams outbound messages use native `fetch` to REST APIs — no additional SDK needed.

---

## 7. Environment Configuration

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-...            # Bot token for Web API calls
SLACK_SIGNING_SECRET=...            # For webhook signature verification
SLACK_APP_TOKEN=xapp-...            # For Socket Mode (development)
SLACK_MODE=socket                   # 'socket' (dev) | 'events' (prod)

# Microsoft Teams
TEAMS_APP_ID=...                    # Azure AD App Registration client ID
TEAMS_APP_SECRET=...                # Azure AD App Registration client secret
TEAMS_TENANT_ID=...                 # Azure AD tenant ID (for single-tenant bots)

# WhatsApp Business
WHATSAPP_PHONE_NUMBER_ID=...        # WhatsApp Business phone number ID
WHATSAPP_ACCESS_TOKEN=...           # Meta Graph API access token
WHATSAPP_VERIFY_TOKEN=...           # Arbitrary string for webhook verification
WHATSAPP_APP_SECRET=...             # Meta App secret for HMAC verification
WHATSAPP_SESSION_WINDOW_HOURS=24    # Hours before session expires (default: 24)

# Twilio SMS/RCS
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SERVICE_SID=...    # Use Messaging Service for RCS fallback
TWILIO_PHONE_NUMBER=...             # Fallback if not using Messaging Service
TWILIO_SMS_SESSION_HOURS=4          # Hours before starting new conversation

# Facebook Messenger
MESSENGER_PAGE_ACCESS_TOKEN=...
MESSENGER_VERIFY_TOKEN=...
MESSENGER_APP_SECRET=...

# Discord
DISCORD_BOT_TOKEN=...
DISCORD_MENTION_ONLY=true           # Only respond when bot is mentioned
```

---

## 8. Security Considerations

All inbound webhook requests must be **cryptographically verified** before processing:

| Platform | Verification Method |
|----------|-------------------|
| Teams | JWT in `Authorization` header, validated against Azure AD OIDC keys |
| Slack | `X-Slack-Signature`: `v0=` + HMAC-SHA256(signing_secret, `v0:{ts}:{body}`) |
| WhatsApp | `X-Hub-Signature-256`: `sha256=` + HMAC-SHA256(app_secret, body) |
| Twilio | `X-Twilio-Signature`: HMAC-SHA1 of URL+params using auth_token |
| Messenger | `X-Hub-Signature-256`: same as WhatsApp |
| Discord | Ed25519 signature verification for HTTP interactions; Bot Token for Gateway |

Verification failures must return `403 Forbidden` immediately, before any processing. Never log raw webhook payloads containing user messages without explicit user consent.

---

## 9. Summary

All 6 platforms support official bot identity — no user impersonation is needed anywhere. The primary integration pattern is **webhook in, REST out** (Teams, WhatsApp, SMS, Messenger) with Slack and Discord also supporting WebSocket connections that eliminate the need for a public URL during development.

The most valuable integrations for OllieBot users, ranked:
1. **Slack** — highest developer adoption, best APIs, easiest to build
2. **Teams** — enterprise users, most commonly used work chat
3. **WhatsApp** — largest consumer messaging platform globally
4. **SMS/RCS** — universal reach (works on any phone)
5. **Discord** — communities, open-source, developer audiences
6. **Messenger** — declining use, but large installed base

A normalized message format (`NormalizedInboundMessage` / `NormalizedOutboundMessage` with `OutboundBlock[]`) with per-platform adapters and a shared `MessengerChannel` implementation minimizes per-platform code to ~200-400 lines while handling all common concerns (conversation mapping, streaming buffering, content degradation, rate limiting) in shared infrastructure.
