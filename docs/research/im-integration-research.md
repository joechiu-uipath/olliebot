# Instant Messenger Integration Research

> **Date**: 2026-03-13
> **Purpose**: Technical assessment of integrating external messenger platforms as OllieBot channels
> **Platforms evaluated**: Microsoft Teams, Slack, Discord, Facebook Messenger, SMS/RCS, WhatsApp

---

## Table of Contents

- [Executive Summary](#executive-summary)
- [OllieBot Channel Architecture](#olliebot-channel-architecture)
- [Comparison Matrix](#comparison-matrix)
- [1. Microsoft Teams (Priority)](#1-microsoft-teams-priority)
- [2. Slack (Priority)](#2-slack-priority)
- [3. WhatsApp (Priority)](#3-whatsapp-priority)
- [4. SMS / RCS Gateway (Priority)](#4-sms--rcs-gateway-priority)
- [5. Discord](#5-discord)
- [6. Facebook Messenger](#6-facebook-messenger)
- [Implementation Recommendations](#implementation-recommendations)

---

## Executive Summary

All six platforms support bot integration with varying levels of complexity, cost, and capability. The key findings:

| Platform | Bot Identity | Input | Output | Rich Output | Multi-Session | Complexity | Cost |
|---|---|---|---|---|---|---|---|
| **Teams** | Official bot (Azure Bot Service) | Webhook (Azure relay) | REST API | Adaptive Cards (excellent) | 1:1 + channel threads | High (Azure required) | Free tier available |
| **Slack** | Official bot (Slack App) | Events API / Socket Mode | Web API | Block Kit (excellent) | Threads (unlimited) | Medium | Free |
| **WhatsApp** | Official (Cloud API) | Webhook | REST API | Interactive buttons/lists | Single thread per user | Medium | Per-message fees |
| **SMS/RCS** | Phone number (10DLC) | Webhook (provider) | REST API | MMS/RCS rich cards | Phone number pair | Medium | Per-segment fees |
| **Discord** | Official bot (Application) | Gateway WebSocket | REST API | Embeds + Components V2 | DMs + threads | Low-Medium | Free |
| **FB Messenger** | Facebook Page bot | Webhook | Send API | Templates + Quick Replies | Single thread per user | Medium | Free (24h window rules) |

### Integration Plan

**M365 Agents SDK** (Teams + Facebook Messenger + LINE): Use Azure Bot Service as a unified gateway. The SDK is free (MIT), and standard channel messages (Teams, FB Messenger, LINE) are free and unlimited. Cost is primarily Azure hosting (~$15-70/month). This covers 3 platforms with a single bot codebase, at the trade-off of reduced rich output fidelity on non-Teams channels.

**Native Slack Bolt SDK** (`@slack/bolt`): Slack is too important to accept the degraded experience from Azure Bot Service's Slack connector (broken Block Kit buttons, no modals, no slash commands). Socket Mode means no public endpoint needed.

**Remaining platforms** (Discord, WhatsApp, SMS/RCS): Native SDKs for each, since Azure Bot Service either doesn't support them (Discord, WhatsApp) or adds unnecessary indirection (SMS already goes through Twilio either way).

### M365 Agents SDK Cost Analysis

| Component | Cost |
|---|---|
| **M365 Agents SDK** | Free (MIT license, open source) |
| **Azure Bot Service - Standard channels** (Teams, Slack, FB, Telegram, LINE, Email, SMS) | **Free, unlimited messages** |
| **Azure Bot Service - Premium channels** (Direct Line, Direct Line Speech) | 10K msgs/month free, then $0.50/1K |
| **Azure App Service hosting** (required) | ~$13/month (Linux B1) to ~$69/month (Windows S1) |
| **Entra ID** | Free tier sufficient |
| **Application Insights** | ~$2.30/GB after 5GB/month free |

**Realistic minimum**: ~$15-70/month for hosting. Message routing is the cheap part.

### M365 Agents SDK - Full Channel List

**Active built-in channels** (all standard = free unlimited messages):

| Channel | Status | Rich Cards | Buttons | Adaptive Cards | Notes |
|---|---|---|---|---|---|
| **Microsoft Teams** | Full support | Full | Full | Full (v1.5 desktop, v1.2 mobile) | Best experience |
| **Facebook Messenger** | Active | Partial (images) | Yes | Partial (text/images, buttons may not work) | 24h window rules apply |
| **LINE** | Active | Converted to image | Partial | Converted to image | Limited rich output |
| **Telegram** | Active | Partial | Yes (inline keyboards) | No | MarkdownV2 for text |
| **Slack** | Active | Partial | **Known bugs** (clicks not forwarded) | Partial (rendered poorly) | **Not recommended -- use Bolt SDK** |
| **Email (Office 365)** | Active | As images + links | No | Rendered as image | Text-focused |
| **SMS (via Twilio)** | Active | No | No | No | Text only; Twilio fees apply |
| **Telephony** | Active | N/A | N/A | N/A | Voice only |
| **Web Chat** (Direct Line) | Active | Full | Full | Full | Premium channel ($0.50/1K msgs) |
| **Direct Line Speech** | Active | N/A | N/A | N/A | Premium; voice |
| **M365 Copilot** | Active (via Agents SDK) | Full | Full | Full | Copilot Studio integration |
| **Outlook Actionable Messages** | Active | Partial | Yes | Yes | Email-embedded cards |

**Deprecated/removed**: Skype (shut down May 2025), Skype for Business, Cortana, Kik, GroupMe, Kaizala.

**NOT natively supported**: Discord, WhatsApp (Azure Communication Services preview only), WeChat, Signal, iMessage.

### Why Not Use M365 Agents SDK for Slack?

| Aspect | Azure Bot Service Slack Connector | Native Slack Bolt SDK |
|---|---|---|
| Block Kit | **Partial, known bugs** (button clicks not forwarded) | Full support |
| Modals | **Not supported** | Full support |
| Slash commands | Limited | Full |
| Threading | Basic | Full control via `thread_ts` |
| App Home tab | Not supported | Full |
| Reactions | Limited | Full |
| File uploads | URL-based only | Full Files API |
| Formatting | Normalized to Activity schema, loses fidelity | Native mrkdwn |
| Latency | Extra hop through Azure | Direct WebSocket |

The Azure connector gives basic text messaging in Slack. Anything involving Block Kit interactions, modals, or slash commands is degraded or broken. For a primary channel, this is unacceptable.

---

## OllieBot Channel Architecture

OllieBot has an existing multi-channel architecture that new messenger integrations plug into.

### Core Interface (`src/channels/types.ts`)

```typescript
interface Channel {
  readonly id: string;    // Unique channel identifier (e.g., 'slack-main', 'teams-prod')
  readonly name: string;  // Human-readable channel type (e.g., 'slack', 'teams', 'web')

  init(): Promise<void>;
  isConnected(): boolean;
  close(): Promise<void>;

  // Message handling
  onMessage(handler: (message: Message) => Promise<void>): void;
  onAction(handler: (action: string, data: unknown) => Promise<void>): void;
  onNewConversation?(handler: () => void): void;
  onInteraction?(handler: (requestId: string, response: unknown, conversationId?: string) => Promise<void>): void;

  // Sending
  send(content: string, options?: SendOptions): Promise<void>;
  sendError(error: string, details?: string, conversationId?: string): Promise<void>;
  broadcast(data: unknown): void;

  // Streaming
  startStream(streamId: string, options?: StreamStartOptions): void;
  sendStreamChunk(streamId: string, chunk: string, conversationId?: string): void;
  endStream(streamId: string, options?: StreamEndOptions): void;
}
```

#### `id` and `name` are `readonly`

Yes -- both `id` and `name` are declared as `readonly` in the interface. This is correct because:
- `id` is a unique instance identifier (e.g., `'web-main'`, `'console-default'`) set at construction time. Changing it after registration would break agent-to-channel routing.
- `name` is the channel type label (e.g., `'web'`, `'console'`). It identifies the kind of channel, not a specific instance. It should never change.

New messenger channels should follow this pattern:
```typescript
class SlackChannel implements Channel {
  readonly id: string;       // e.g., 'slack-workspace-T12345'
  readonly name = 'slack';   // Always 'slack' for this channel type
}
```

#### `onAction` vs `onInteraction` -- Detailed Use Cases

These serve fundamentally different purposes:

**`onAction(handler: (action: string, data: unknown) => Promise<void>)`** -- Required

Handles **user-initiated UI actions** where the user clicks a button or performs a discrete action that doesn't correspond to a pending request. The action is fire-and-forget from the channel's perspective.

| Use Case | `action` string | `data` payload | Example |
|---|---|---|---|
| Button click in sent message | `'approve'`, `'reject'`, `'retry'` | `{ conversationId, messageId }` | User clicks "Approve" on a mission plan |
| Quick action from sidebar | `'switch_model'`, `'clear_context'` | `{ model: 'gpt-4' }` | User picks a model from a dropdown |
| Slash command trigger | `'command'` | `{ command: '/help' }` | User types a slash command |
| Agent delegation choice | `'delegate_to'` | `{ agentName: 'researcher' }` | User picks which agent to hand off to |
| Conversation action | `'archive'`, `'pin'`, `'delete'` | `{ conversationId }` | User right-clicks a conversation |
| Cancel running operation | `'cancel_mission'`, `'stop_task'` | `{ missionId }` | User clicks "Stop" on a running mission |

**How it flows**: WebSocket client sends `{ type: 'action', action: 'approve', data: { ... } }` -> WebSocketChannel routes to `actionHandler` -> Supervisor logs it. Currently the Supervisor only logs actions (`console.log`), suggesting this is an extension point for future UI interactivity.

**For messenger channels**: Map platform-native actions to this handler:
- **Slack**: Block Kit button clicks, overflow menu selections -> `onAction`
- **Teams**: Adaptive Card `Action.Submit` -> `onAction`
- **Discord**: Button clicks, select menu selections -> `onAction`
- **WhatsApp**: Reply button taps, list item selections -> `onAction`
- **FB Messenger**: Postback buttons, Quick Reply taps -> `onAction`

---

**`onInteraction(handler: (requestId: string, response: unknown, conversationId?: string) => Promise<void>)`** -- Optional

Handles **responses to bot-initiated requests** -- a request/response pattern where the bot asks a question or presents a form, and the user responds to that specific request. The `requestId` correlates the response back to the original request.

| Use Case | Who initiates | `requestId` | `response` payload | Example |
|---|---|---|---|---|
| Tool confirmation prompt | Bot asks user to confirm a tool execution | Tool's `requestId` | `{ approved: true }` | Bot: "Run `rm -rf ./dist`?" User: clicks "Confirm" |
| Form/modal submission | Bot opens a form for structured input | Form's `requestId` | `{ name: 'John', email: 'j@x.com' }` | Bot asks for config params via a modal |
| Multi-step wizard response | Bot walks user through steps | Step's `requestId` | `{ selectedOption: 'option-b' }` | Mission setup wizard |
| File selection response | Bot asks user to pick from options | Request's `requestId` | `{ fileId: 'abc123' }` | Bot: "Which file to analyze?" |
| Approval with feedback | Bot requests approval + optional notes | Approval `requestId` | `{ approved: true, notes: 'LGTM' }` | Code review approval flow |

**How it flows**: Bot sends a message with a `requestId` embedded (e.g., via buttons or a form) -> User responds in the UI -> WebSocket client sends `{ type: 'interaction-response', requestId: 'req-123', data: { approved: true }, conversationId: '...' }` -> WebSocketChannel routes to `interactionHandler`.

**Key difference from `onAction`**:
- `onAction`: User proactively does something. No pending request. Fire-and-forget.
- `onInteraction`: Bot asked a question, user is answering it. The `requestId` ties the response to the original ask.

**For messenger channels**: This maps to:
- **Slack**: Modal submission (`view_submission`) with a stored `requestId` in `private_metadata`
- **Teams**: Adaptive Card `Action.Submit` where the card includes a `requestId` in its data payload
- **Discord**: Modal submission, or button clicks on a message that contains a `requestId` in custom_id
- **WhatsApp**: Reply button taps where button payload contains the `requestId`

---

#### `broadcast(data: unknown)` -- Detailed Use Cases

`broadcast` is a **push notification channel** for system events that need to reach all connected clients immediately, independent of any conversation or message flow. It is NOT for sending chat messages to users.

**Current usage in the codebase** (from `supervisor.ts` and `websocket.ts`):

| Event Type | Payload | When Triggered | Purpose |
|---|---|---|---|
| `conversation_created` | `{ type, conversation: { id, title, createdAt, updatedAt } }` | New conversation auto-created | Frontend adds conversation to sidebar |
| `conversation_updated` | `{ type, conversation: { id, title, updatedAt } }` | Conversation title auto-renamed | Frontend updates sidebar title |
| `tool_requested` | `{ type, requestId, toolName, source, conversationId, parameters, agent* }` | Worker starts a tool call | Frontend shows "running tool..." indicator |
| `tool_progress` | `{ type, requestId, progress: { current, total?, message? } }` | Tool reports progress | Frontend updates progress bar |
| `tool_execution_finished` | `{ type, requestId, ... }` | Tool completes | Frontend clears tool indicator |

**How it works in WebSocketChannel**: Serializes `data` to JSON and sends to **every** connected WebSocket client. Also tracks tool events for stream/tool resumption when clients switch conversations.

**How it works in ConsoleChannel**: No-op (single user, no connected clients to push to).

**For messenger channels**, `broadcast` has different relevance per platform:

| Platform | broadcast() Behavior | Notes |
|---|---|---|
| **Slack** | Could update a "status" message in a dedicated channel | E.g., post tool progress to a #bot-activity channel |
| **Teams** | Could send proactive notification cards | Adaptive Card showing current operation status |
| **Discord** | Could update a status embed in a designated channel | E.g., bot-status channel |
| **WhatsApp** | Likely no-op | No concept of broadcasting; 1:1 only |
| **SMS** | No-op | No rich notification mechanism |
| **FB Messenger** | Likely no-op | 1:1 only, no sidebar concept |

**Implementation guidance for new channels**: Most messenger channels should implement `broadcast` as a **no-op** or as a selective forwarder that only pushes `conversation_created`/`conversation_updated` events if the platform supports proactive notifications. Tool-level events (`tool_requested`, `tool_progress`, etc.) are primarily for the web UI's real-time tool execution display and are generally not useful in messenger contexts.

### Existing Implementations

- **ConsoleChannel** (`src/channels/console.ts`): CLI/terminal using inquirer prompts
- **WebSocketChannel** (`src/channels/websocket.ts`): Multi-client WebSocket for web UI

### Registration Pattern

```typescript
// Server mode (src/server/index.ts)
const channel = new SomeChannel(id, config);
await channel.init();
supervisor.registerChannel(channel);

// Supervisor binds:
//   onMessage  -> handleMessage() for routing user messages to agents
//   onAction   -> currently just logs (extension point for UI actions)
```

### Key Design Points for New Channels

1. **Message ID**: Use native platform IDs (Slack `ts`, Discord message ID, etc.)
2. **Conversation context**: Store platform-specific IDs in `message.metadata`
3. **Streaming**: Platforms without live message editing should accumulate chunks and send final message on `endStream`
4. **Rate limiting**: Each channel must implement its own rate limiting
5. **Markdown conversion**: LLM output is standard Markdown; each platform needs a converter to its native format
6. **`onAction`**: Map platform-native button/action events. Required for all interactive channels.
7. **`onInteraction`**: Implement if the platform supports modal/form submissions tied to a specific bot request. Optional otherwise.
8. **`broadcast`**: No-op for most messenger channels. Only implement if the platform has a concept of push notifications or status channels.

---

## Comparison Matrix

### Bot Identity

| Platform | Official Bot Support | Registration Process | Can Impersonate Users? | Identity Persistence |
|---|---|---|---|---|
| Teams | Yes (Azure Bot Service) | Azure AD App + Bot Resource + Teams Channel | No -- bot has own identity | Bot name + icon in Teams |
| Slack | Yes (Slack App with bot user) | Create App + Install to Workspace | No -- bot has own identity | Bot name + avatar, always-online |
| Discord | Yes (Application + Bot) | Developer Portal registration | No (self-botting violates ToS) | Bot user with name + avatar |
| FB Messenger | Yes (via Facebook Page) | Create App + Page + Messenger product | No -- appears as Page identity | Page name + profile picture |
| SMS/RCS | Phone number identity | Twilio/provider account + 10DLC registration | N/A -- just a phone number | Phone number (SMS) / Verified brand (RCS) |
| WhatsApp | Yes (Business Platform) | Meta developer account + Business verification | No -- business phone number | Business name + profile + green checkmark (verified) |

### Input/Output Capabilities

| Platform | Input Method | Output Method | Max Message Length | Streaming Support |
|---|---|---|---|---|
| Teams | Azure Bot Service webhook relay | Bot Connector REST API | ~28KB text (Adaptive Card: 40KB) | Update existing message |
| Slack | Events API (Socket Mode or HTTP) | `chat.postMessage` Web API | 4,000 chars (40K absolute max) | Post + `chat.update` pattern |
| Discord | Gateway WebSocket | REST API `POST /channels/{id}/messages` | 2,000 chars | Post + edit (rate limited) |
| FB Messenger | HTTPS webhook POST | Send API `POST /me/messages` | 2,000 chars (text), templates vary | Not natively supported |
| SMS | Provider webhook POST | Provider REST API | 160 chars/segment (GSM-7) | N/A |
| RCS | Provider webhook POST | Provider REST API / Google RBM API | No practical limit | N/A |
| WhatsApp | HTTPS webhook POST | Cloud API `POST /{phone_id}/messages` | 4,096 chars | Not supported |

### Rich Output

| Platform | Markdown | HTML | Images | Interactive Elements | Cards/Templates |
|---|---|---|---|---|---|
| Teams | Subset supported | Limited subset | Via Adaptive Cards | Adaptive Card actions, buttons | Adaptive Cards (best), Hero, Thumbnail |
| Slack | mrkdwn (custom syntax) | Not supported | Image blocks, file uploads | Buttons, selects, date pickers, modals | Block Kit sections, rich_text |
| Discord | Standard MD subset | Not supported | Embeds, Media Gallery | Buttons (5 styles), Select Menus, Modals | Embeds, Components V2 containers |
| FB Messenger | Not supported | Not supported | Attachments (JPEG, PNG, GIF) | Quick Replies (13), Postback buttons | Generic, Button, Receipt, Media templates |
| SMS | Not supported | Not supported | MMS (images, GIF, video) | None | None |
| RCS | Not supported | Not supported | Rich card media (100MB) | Suggested replies (11), suggested actions | Rich Cards, Carousels (2-10 cards) |
| WhatsApp | Custom formatting (`*bold*`, `_italic_`) | Not supported | Media messages (5MB image) | Reply buttons (3), List messages (10 items) | Template messages (header/body/footer/buttons) |

### Chat Session Control

| Platform | Session Model | Multiple Concurrent Sessions | Thread Support | Bot-Initiated Conversations |
|---|---|---|---|---|
| Teams | 1:1 personal chat + channel threads | Yes (1:1 + multiple channels/groups) | Channel threads | Yes (proactive messaging, bot must be installed) |
| Slack | DMs + channel threads | Yes (unlimited threads per user) | Native threads via `thread_ts` | Yes (post to user ID opens DM) |
| Discord | DM channel + guild threads | Yes (DM + multiple guild threads) | Native threads in guild channels | Yes (open DM channel) |
| FB Messenger | Single 1:1 thread per user-page pair | No (single continuous thread) | None | Yes (within 24h window or via message tags) |
| SMS | Phone number pair = conversation | Only via multiple bot numbers | None (flat message stream) | Yes (outbound SMS anytime, compliance required) |
| RCS | Phone number pair = conversation | Only via multiple agent numbers | None | Yes (requires approved templates for some) |
| WhatsApp | Single thread per user-business number | No (single continuous thread) | None | Yes (template messages only outside 24h window) |

---

## 1. Microsoft Teams (Priority)

### Overview

Teams bots operate through **Azure Bot Service**, which acts as a relay between Teams and your bot's HTTPS endpoint. The bot receives normalized Activity objects and responds via the Bot Connector REST API.

### Bot Identity

- **Registration**: Azure AD (Entra ID) App Registration + Azure Bot resource + Teams Channel enabled
- **Identity model**: Bots have their own identity (name, icon). They do NOT impersonate users.
- **Tenant model**: Single-tenant only for new registrations (multi-tenant deprecated July 2025)
- **Lightweight alternative**: Outgoing Webhooks (no Azure AD, but team-scoped only, no 1:1 chats)

### SDK Landscape (Critical Transition)

The Bot Framework SDK (`botbuilder-js`) reached **end-of-support December 31, 2025**. Two successors:

| SDK | Scope | Status | npm Packages |
|---|---|---|---|
| **Microsoft 365 Agents SDK** | Multi-channel (Teams, Copilot Studio, Webchat, Slack) | GA (JS, Python, .NET) | `@microsoft/agents-hosting`, `@microsoft/agents-hosting-express`, `@microsoft/agents-hosting-teams` |
| **Teams SDK** (Teams AI Library v2) | Teams-only | GA (JS, .NET; Python preview) | `@microsoft/teams-sdk` |

**Recommendation**: Use **M365 Agents SDK** for OllieBot -- it supports Teams and potentially other channels, aligning with OllieBot's multi-channel design.

### Basic Input

**Architecture**: Teams -> Microsoft Teams Service -> Azure Bot Service -> `POST /api/messages` on your server

**Activity object** (incoming):
```json
{
  "type": "message",
  "text": "<at>BotName</at> hello world",
  "from": { "id": "user-aad-id", "name": "User Name" },
  "conversation": { "id": "conversation-id", "tenantId": "tenant-id" },
  "channelData": { "tenant": { "id": "tenant-id" }, "team": { "id": "team-id" } }
}
```

**Message receipt rules**:
- **1:1 personal chat**: All messages received, no @mention needed
- **Channel/Group**: Only receives @mentioned messages (must strip `<at>BotName</at>` before processing)
- **RSC permission** (`ChannelMessage.Read.Group`): Receive ALL channel messages without @mention (requires admin consent)

**Authentication**: Incoming requests carry JWT Bearer tokens from Azure Bot Service. Your endpoint must validate these tokens.

### Basic Output

**Reactive replies**: Respond to the same `serviceUrl` and conversation from the incoming activity.

**Proactive messaging**: Bot can initiate messages if:
- Bot is already installed for the user
- You have a stored conversation reference
- Can use Graph API to proactively install the bot

**Rate limits**:
- 50 RPS per app per tenant (global)
- 1 message per 2 seconds sustained per thread
- HTTP 429 with backoff required

**Message updates**: `PUT /v3/conversations/{id}/activities/{activityId}` -- useful for streaming pattern.

### Rich Output

**Adaptive Cards** are the primary rich output format:
- JSON-based, schema v1.5 on desktop, v1.2 on mobile
- 40KB size limit per card
- Interactive: `Action.Submit`, `Action.OpenUrl`, `Action.ShowCard`, input fields
- Layout: `Layout.Stack`, `Layout.Flow`, `Layout.AreaGrid`
- Can be sent as carousels (`attachmentLayout: "carousel"`)

**Text formatting**: Supports a Markdown subset. Limited HTML (tightening restrictions). No table support in text-only messages.

**Other card types**: Hero Card, Thumbnail Card, List Card, Receipt Card, Sign-in Card.

### Chat Session Control

| Scope | Threading | Bot Trigger | Notes |
|---|---|---|---|
| Personal (1:1) | Flat, persistent | Any message | Private, long-lived, **no auto-reset** |
| Group Chat | Non-threaded | @mention required | 3+ users |
| Channel | Threaded | @mention required | Up to 2000 members |

**Key constraint**: Cannot create multiple parallel 1:1 conversations with the same user. Same user CAN interact via 1:1 + multiple channels simultaneously.

**State management**: No built-in session timeout. You must manage context windows yourself (critical for LLM-backed bots).

### Integration Requirements

- **Azure subscription** (free tier suffices for Bot Service)
- **Microsoft Entra ID App Registration** (single tenant)
- **Public HTTPS endpoint** (ngrok/Dev Tunnels for development)
- **Teams App Manifest** (`manifest.json` + icons, zipped, uploaded to Teams)

### How Open Source Projects Integrate

- **Bridge bot pattern**: Thin Teams bot forwards messages to AI backend, relays responses. Used by [openai-teams-bot](https://github.com/formulahendry/openai-teams-bot).
- **Open WebUI**: Community [Teams integration via Bot Framework adapter](https://github.com/open-webui/open-webui/discussions/7627) that forwards to Open WebUI API.
- **Botpress** (14.5k stars, TypeScript, MIT): Native Teams channel integration with visual conversation designer.
- **Rasa** (21k stars, Python, Apache 2.0): Teams integration, enterprise-proven.

### OllieBot Integration Architecture

```
Teams User -> Teams Service -> Azure Bot Service -> OllieBot Hono Server (/api/teams/messages)
                                                         |
                                                    TeamsChannel.onMessage()
                                                         |
                                                    Supervisor.handleMessage()
                                                         |
                                                    Worker (LLM + tools)
                                                         |
                                                    TeamsChannel.send() -> Bot Connector REST API -> Teams
```

**Env vars needed**:
```
TEAMS_APP_ID=<entra-app-id>
TEAMS_APP_PASSWORD=<entra-app-secret>
TEAMS_TENANT_ID=<tenant-id>
```

**npm dependencies**: `@microsoft/agents-hosting`, `@microsoft/agents-hosting-express`, `@microsoft/agents-hosting-teams`

---

## 2. Slack (Priority)

### Overview

Slack provides the most developer-friendly bot experience of all platforms. Socket Mode eliminates the need for a public endpoint, and the Bolt SDK provides an excellent TypeScript-native framework.

### Bot Identity

- **Modern Slack Apps** are the only supported path (legacy custom bots discontinued March 2025, classic apps EOL November 2026)
- Bot user has its own identity: display name, avatar, always-online presence
- Operates under a **bot token** (`xoxb-...`) independent of installing user
- **Single workspace**: "Install to Workspace" button, no OAuth needed
- **Multi-workspace**: Full OAuth 2.0 v2 flow, store per-workspace bot tokens

**Token types**:
- `xoxb-` (bot token) -- primary for all bot actions
- `xapp-` (app-level token) -- required for Socket Mode (`connections:write` scope)
- `xoxp-` (user token) -- rarely needed

### Basic Input

**Events API** is the standard (RTM is dead). Two delivery mechanisms:

**Socket Mode (recommended for OllieBot)**:
- WebSocket connection -- **no public HTTPS endpoint required**
- `xapp-` token calls `apps.connections.open` for a WebSocket URL
- Bolt SDK handles reconnection automatically
- Ideal for self-hosted apps behind firewalls

**HTTP Webhooks**:
- Slack POSTs to your public HTTPS endpoint
- Must respond within 3 seconds with HTTP 200
- Requires request signing verification

**Message reception**:

| Trigger | Event Type | Required Scope |
|---|---|---|
| @mention in channel | `app_mention` | `app_mentions:read` |
| DM to bot | `message.im` | `im:history` |
| Channel message | `message.channels` | `channels:history` |
| Private channel | `message.groups` | `groups:history` |

### Basic Output

**Primary**: `chat.postMessage` -- pass a user ID as `channel` to auto-open DM.

**Ephemeral messages**: `chat.postEphemeral` -- visible only to one user, not persisted.

**Rate limits** (updated May 2025):
- `chat.postMessage`: ~1 msg/sec/channel (burst allowed)
- `chat.postEphemeral`: ~100 calls/min
- HTTP 429 with `Retry-After` header
- Persistent violation risks app disablement

**Message limits**: 4,000 chars recommended, 40,000 absolute max. Up to 50 blocks per message.

### Rich Output

**Block Kit** is the layout framework:

| Block Type | Purpose |
|---|---|
| `section` | Text with optional accessory (button, image, overflow) |
| `header` | Large bold text |
| `divider` | Horizontal rule |
| `image` | Standalone image (external URL or uploaded file) |
| `context` | Small text/images for metadata |
| `actions` | Row of interactive elements |
| `rich_text` | Complex formatted text with lists, quotes, code |
| `video` | Embedded video player |

**Interactive components**: Buttons (primary/danger/default), select menus (static/external/users/conversations/channels), multi-select, date/time pickers, checkboxes, radio buttons, modals (up to 100 blocks).

**mrkdwn (NOT standard Markdown)**:
- `*bold*`, `_italic_`, `~strikethrough~`, `` `code` ``, ` ```code block``` `
- `>` blockquotes, `<URL|text>` links, `<@U12345>` mentions
- No heading levels, no tables, no nested lists
- **Critical**: LLM Markdown output must be converted to mrkdwn. Use [`md-to-slack`](https://github.com/nicoespeon/md-to-slack) npm package.

**Image uploads**: Use `files.getUploadURLExternal` + `files.completeUploadExternal` (new API). `files.upload` deprecated March 2025.

### Chat Session Control

**Threads are the key mechanism**:
- Send initial message, capture its `ts` (timestamp = unique message ID)
- All replies use `thread_ts: parentTs` in `chat.postMessage`
- **Unlimited parallel threads** with the same user
- Thread replies optionally broadcast to channel with `reply_broadcast: true`
- `conversations.replies` retrieves full thread history

**Session mapping for OllieBot**:
```
{ slackTeamId, slackChannelId, threadTs } -> olliebotConversationId
```

New thread = new OllieBot conversation. Continued thread = continued conversation.

### Integration Code Pattern

```typescript
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,     // xoxb-...
  appToken: process.env.SLACK_APP_TOKEN,  // xapp-...
  socketMode: true,
});

// Handle @mentions
app.event('app_mention', async ({ event, say }) => {
  await say({ text: `Hello <@${event.user}>`, thread_ts: event.ts });
});

// Handle DMs
app.message(async ({ message, say }) => {
  if (message.subtype === undefined) {  // TypeScript narrowing needed
    await say({ text: 'Processing...', thread_ts: message.ts });
  }
});

await app.start();
```

**Streaming pattern**: Post initial message ("Thinking...") -> accumulate LLM chunks -> periodically `chat.update` the message -> final `chat.update` with complete response.

### Required Scopes

`app_mentions:read`, `chat:write`, `im:history`, `im:write`, `users:read`, `files:write`, optionally `channels:history`, `commands`

### How Open Source Projects Integrate

- **Slack's official AI chatbot sample** ([bolt-python-ai-chatbot](https://github.com/slack-samples/bolt-python-ai-chatbot)): Bolt + Anthropic/OpenAI, handles DMs, @mentions, slash commands.
- **LLM-SlackBot-Channels** ([Vokturz/LLM-slackbot-channels](https://github.com/Vokturz/LLM-slackbot-channels)): Per-channel personalities, tool use, document integration.
- **Hubot** (`hubot-slack`): Legacy adapter using deprecated RTM. Still works but aging.
- **Open WebUI**: No native Slack bot. Webhook integration for push notifications only.

### OllieBot Integration Architecture

```
Slack User -> Slack -> Socket Mode WebSocket -> @slack/bolt event handler
                                                    |
                                               SlackChannel.onMessage()
                                                    |
                                               Supervisor.handleMessage()
                                                    |
                                               Worker (LLM + tools)
                                                    |
                                               SlackChannel.send() -> chat.postMessage -> Slack
```

**Env vars needed**:
```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

**npm dependency**: `@slack/bolt` (single package, includes web-api and socket-mode)

---

## 3. WhatsApp (Priority)

### Overview

WhatsApp Business Platform (Cloud API) is the official integration path. The On-Premises API was fully sunset October 2025. Meta hosts everything; your server receives webhooks and sends messages via REST API.

### Bot Identity

**Three tiers** (only the third supports bots):
1. **WhatsApp Messenger** -- consumer app, no bot capability
2. **WhatsApp Business App** -- free mobile app for small businesses, no API
3. **WhatsApp Business Platform (API)** -- programmable API, this is what we use

**Phone number requirements**:
- Valid number capable of receiving SMS/voice for OTP verification
- **Cannot** be currently registered on WhatsApp Messenger or Business App
- Display name must clearly reflect the business
- Meta limits new businesses to 2 phone numbers initially

**Business verification tiers**:

| Tier | Unique Recipients/24h | Requirement |
|---|---|---|
| Tier 0 (Unverified) | 250 | Default |
| Tier 1 | 1,000 | Business verification |
| Tier 2 | 10,000 | Quality + volume |
| Tier 3 | 100,000 | Quality + volume |
| Unlimited | No cap | Quality + volume |

**Test numbers**: Meta provides a test business phone number during setup. Can send to up to 5 allow-listed numbers.

### Basic Input

**Webhook architecture**: HTTPS POST from Meta to your registered endpoint.

**Setup**:
1. Register HTTPS webhook URL with valid TLS certificate
2. Handle GET verification requests (`hub.mode`, `hub.verify_token`, `hub.challenge`)
3. Handle POST event notifications
4. Return HTTP 200 within 5-10 seconds (process async)

**Supported incoming message types**: Text, Image, Video, Audio, Document, Location, Contacts, Sticker, Reactions, Interactive replies (button/list selections), Order messages.

**Webhook payload**:
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "15551234567",
          "id": "wamid.HBgLMTU...",
          "type": "text",
          "text": { "body": "Hello!" }
        }]
      }
    }]
  }]
}
```

**Important gotcha (2025+)**: Creating an app may NOT automatically register the WABA-to-App subscription. Manually POST to `/{WABA_ID}/subscribed_apps`.

### Basic Output

**Send endpoint**: `POST /{PHONE_NUMBER_ID}/messages` with Bearer token.

**The 24-hour customer service window**:
- Customer messages your business -> 24-hour window opens
- Within window: **free**, unlimited messages, any type
- Timer resets with each new customer message
- Outside window: **only pre-approved template messages** (paid)

**Pricing (post-July 2025)**:

| Category | Cost Range (USD) | Notes |
|---|---|---|
| Marketing | $0.025 - $0.1365 | Varies by country; paused for US numbers as of April 2025 |
| Utility | $0.004 - $0.0456 | Free within 24h service window |
| Authentication | $0.004 - $0.0456 | Volume discounts |
| Service (replies) | **Free** | Within 24h window |

**Throughput**: 80 msg/sec default, auto-upgrades to 1,000 msg/sec at scale.

### Rich Output

**Interactive messages** (within 24h window, no approval needed):
- **Reply Buttons**: Up to 3 buttons per message
- **List Messages**: Up to 10 sections, 10 rows total
- **CTA Buttons**: Open URL or dial phone
- **WhatsApp Flows**: Multi-step form-like experiences

**Media messages**:

| Type | Max Size | Formats |
|---|---|---|
| Image | 5 MB | JPEG, PNG |
| Video | 16 MB | MP4, 3GPP |
| Audio | 16 MB | AAC, MP4, MPEG, AMR, OGG |
| Document | 100 MB | PDF, DOC, DOCX, XLS, PPT, etc. |

**Template messages** (for outside 24h window):
- Header: text, image, video, or document
- Body: text with variable placeholders (`{{1}}`, `{{2}}`)
- Footer: text
- Buttons: Quick Reply (3), CTA (URL/phone), Copy Code
- Must be pre-approved by Meta (usually automated, minutes to 48 hours)

**Text formatting**: `*bold*`, `_italic_`, `~strikethrough~`, ` ```monospace``` `, `- ` bullet lists, `1. ` numbered lists. No headers, no tables, no inline images.

### Chat Session Control

- **1:1 only** between business phone number and customer phone number
- No concept of channels or threads -- single linear message stream per customer
- Your bot manages context by mapping `wa_id` to internal conversation state
- **Groups API** (October 2025+): Limited -- max 8 participants, only API-created groups, requires Official Business Account

### Authentication

**Permanent tokens** (recommended for production):
1. Business Settings > System Users > Add (Admin role)
2. Assign assets: App (Full Control) + WABA (Full Control)
3. Generate token with "Never" expiration
4. Permissions: `whatsapp_business_messaging`, `whatsapp_business_management`

### Official vs Unofficial Libraries

| Factor | Official Cloud API | Unofficial (Baileys/Evolution API) |
|---|---|---|
| Cost | Per-message fees | Free (self-hosted) |
| Stability | Guaranteed by Meta | Can break with protocol changes |
| ToS Compliance | Fully compliant | **Violates WhatsApp ToS** |
| Account Risk | None | **Bans possible** |
| Group Support | Limited (8 users) | Full |
| Setup | Moderate (verification) | Low (Docker + QR scan) |

**Official Node.js SDK**: [`@WhatsApp/WhatsApp-Nodejs-SDK`](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK) -- handles webhook setup, message sending, media upload.

**Recommendation**: Use official Cloud API only. Unofficial libraries carry unacceptable ban risk for a production system.

### How Open Source Projects Integrate

- **Evolution API** (massively popular): REST wrapper built on Baileys (unofficial protocol). Docker-based. Native n8n integration. Same ToS risks.
- **python-whatsapp-bot** ([daveebbelaar](https://github.com/daveebbelaar/python-whatsapp-bot)): Pure Python + Flask using official Cloud API + OpenAI.
- **Open WebUI**: No native WhatsApp plugin. Pipelines Plugin Framework could bridge to Cloud API.
- **Wassenger**: Commercial WhatsApp API gateway with ChatGPT bot example.

### OllieBot Integration Architecture

```
WhatsApp User -> Meta Cloud -> Webhook POST -> OllieBot Hono Server (/api/whatsapp/webhook)
                                                    |
                                               WhatsAppChannel.onMessage()
                                                    |
                                               Supervisor.handleMessage()
                                                    |
                                               Worker (LLM + tools)
                                                    |
                                               WhatsAppChannel.send() -> Cloud API POST -> Meta -> WhatsApp User
```

**Env vars needed**:
```
WHATSAPP_PHONE_NUMBER_ID=<phone-number-id>
WHATSAPP_ACCESS_TOKEN=<permanent-system-user-token>
WHATSAPP_VERIFY_TOKEN=<webhook-verify-token>
WHATSAPP_WABA_ID=<business-account-id>
```

**npm dependency**: `@WhatsApp/WhatsApp-Nodejs-SDK` or direct HTTP calls to Graph API

---

## 4. SMS / RCS Gateway (Priority)

### Overview

SMS integration uses a CPaaS provider (Twilio, Vonage, etc.) as a gateway. RCS adds rich messaging capabilities on top. **Google Voice has no API and is a dead end.**

### Bot Identity

#### SMS Numbers

| Type | Cost | Throughput | Setup Time | Voice Support |
|---|---|---|---|---|
| **10DLC Long Code** | ~$1-2/month + $4.50-44 brand reg | Trust Score-based | 10-15 days | Yes |
| **Short Code (5-6 digits)** | $500 setup + $2,000+/month | Highest | 6-10 weeks | No |
| **Toll-Free** | Moderate | Up to 1,200 texts/min | Days | Yes |

**A2P 10DLC registration** is mandatory for US SMS since September 2023:
1. Brand registration ($4.50 sole proprietor / $44 standard)
2. Campaign registration ($15 one-time + $2/month)
3. Link to Messaging Service with phone numbers

#### RCS Identity

- **RCS Agents** have verified brand name, logo, description, colored badge
- Registration through Google RBM Partner program or certified partner (Sinch, Vonage, Twilio)
- Uses Google Service Account keys for auth
- npm: `@google/rcsbusinessmessaging`

#### Google Voice: Dead End

- **No official API. Google has stated they do not plan to release one.**
- No REST API, no SDK, no webhooks, no programmatic access
- All unofficial libraries (`pygooglevoice`, `Google-Voice-PHP-API`, etc.) are unmaintained and broken
- Using workarounds violates Google Voice Acceptable Use Policy
- **Do not pursue.**

### SMS Providers Comparison

| Provider | Outbound SMS Price | TypeScript SDK | Strengths |
|---|---|---|---|
| **Twilio** | ~$0.0079/segment | `twilio` (types included) | Largest ecosystem, best docs |
| **Vonage** | ~$0.007/segment | `@vonage/server-sdk` | Competitive pricing, also supports RCS |
| **Plivo** | ~$0.0066/segment | `plivo` | HIPAA/GDPR, healthcare focus |
| **MessageBird** | ~$0.008/segment | `messagebird` | Omnichannel, strong in Europe |
| **Sinch** | ~$0.0078/segment | `@sinch/sdk-core` | Enterprise scale, owns RCS infrastructure |

**Recommendation**: **Twilio** for SMS (best TypeScript support, largest ecosystem). **Vonage** as alternative if you want unified SMS + RCS through one API.

### Basic Input

All providers use **webhooks**:
1. User sends SMS to your provider phone number
2. Provider receives at carrier level
3. Provider POSTs to your configured webhook URL
4. Parse: `From` (sender), `To` (your number), `Body` (text), `MediaUrl` (MMS attachments)

**Twilio webhook**: Configure under Phone Numbers > Messaging > "A message comes in" > your URL.

### Basic Output

**Twilio example**:
```typescript
import Twilio from 'twilio';
const client = Twilio(ACCOUNT_SID, AUTH_TOKEN);

await client.messages.create({
  body: 'Hello from OllieBot',
  to: '+15551234567',
  from: '+15559876543',
});
```

**Critical character encoding gotcha**:
- **GSM-7**: 160 chars/segment, 153 in multi-segment
- **UCS-2** (triggered by ANY non-GSM-7 char including emojis, smart quotes): 70 chars/segment, 67 in multi-segment
- **A single emoji makes the entire message UCS-2**, potentially tripling segment count and cost
- Keep messages under 320 characters for best deliverability
- Each segment billed separately (~$0.008 each)

### Rich Output

#### SMS/MMS
- MMS: images, GIFs, audio, video, vCards
- Text up to ~1,600 chars (no segment splitting for MMS)
- Max MMS size: ~300KB reliably
- No interactive elements, no buttons, no carousels

#### RCS (the future of rich SMS)

| Feature | Capability |
|---|---|
| Rich Cards | Media + title + description + up to 4 suggested replies/actions |
| Carousels | 2-10 horizontally scrollable rich cards |
| Suggested Replies | Up to 11 tappable quick-reply chips |
| Suggested Actions | Open URL, open maps, dial phone, share location, create calendar event |
| Read Receipts | Native support |
| Typing Indicators | Native support |
| File Sharing | Documents, PDFs |

RCS adoption is accelerating: iOS 18 support, 1B+ daily messages in US, 5x growth in 2024.

### Chat Session Control

- **No native session concept** in SMS. Conversations defined implicitly by phone number pair.
- **Twilio Conversations API** provides structured session management:
  - Participant bound by number pair (From/To)
  - Only one active Conversation per number pair
  - Cross-channel: same Conversation can include SMS + WhatsApp + webchat
- **For OllieBot**: Identify conversations by phone number pair. Store context in SQLite keyed by phone number.

### How Open Source Projects Integrate

- **twilio-gpt-sms** ([Promptable](https://github.com/promptable/twilio-gpt-sms)): GPT + Twilio SMS bot starter kit.
- **openai-sms-bot**: OpenAI + Twilio SMS chatbot.
- **Twilio blog tutorial**: [Serverless ChatGPT SMS Chatbot](https://www.twilio.com/en-us/blog/sms-chatbot-openai-api-node).

### OllieBot Integration Architecture

```
User Phone -> Carrier -> Twilio -> Webhook POST -> OllieBot Hono Server (/api/sms/webhook)
                                                        |
                                                   SMSChannel.onMessage()
                                                        |
                                                   Supervisor.handleMessage()
                                                        |
                                                   Worker (LLM + tools)
                                                        |
                                                   SMSChannel.send() -> Twilio API -> Carrier -> User Phone
```

**Env vars needed**:
```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=+15559876543
```

**npm dependency**: `twilio`

---

## 5. Discord

### Overview

Discord bots use a persistent WebSocket connection (Gateway) for real-time events plus REST API for sending messages. The discord.js library is a natural fit for OllieBot's TypeScript stack.

### Bot Identity

- Register via [Discord Developer Portal](https://discord.com/developers/applications)
- Create Application -> enable Bot feature -> copy bot token
- Bot has own identity (name, avatar, always-online)
- Added to servers via OAuth2 invite URL with `bot` + `applications.commands` scopes
- Self-botting (automating normal user accounts) violates ToS

### Basic Input

**Two approaches** (mutually exclusive):

| | Gateway (WebSocket) | HTTP Interactions |
|---|---|---|
| Connection | Persistent WebSocket | Stateless POST |
| Receives messages | Yes (with intent) | No |
| Slash commands | Yes | Yes |
| Button/menu clicks | Yes | Yes |
| Best for | Full-featured bots | Serverless/slash-only |

**MESSAGE_CONTENT Privileged Intent**: Required to read message content in guilds. Exceptions: bot's own messages, DMs, @mentions. Bots in <100 servers can enable freely; larger bots must apply.

**Recommendation**: Gateway + use @mentions/DMs (content always available) to avoid privileged intent. Slash commands for structured interactions.

### Basic Output

- `POST /channels/{id}/messages` -- 2,000 character limit
- Global rate: 50 req/sec; per-channel: ~5 msg/5 sec
- Long AI responses must be split across multiple messages
- Message editing available for streaming pattern

### Rich Output

**Markdown**: Bold, italic, underline, strikethrough, blockquotes, inline/fenced code with syntax highlighting.

**Embeds**: Colored cards with title (256 chars), description (4,096 chars), up to 25 fields, footer, thumbnail, image. Up to 10 embeds/message, 6,000 char total.

**Components V2 (March 2025+)**: Major overhaul with modular components:
- Container, Section, Text Display, Media Gallery, Separator
- Buttons (5 styles, up to 5 per row), Select Menus, Modals
- 40 component limit per message
- Enabled via `IS_COMPONENTS_V2` flag

### Chat Session Control

- **DMs**: One DM channel per user-bot pair (cannot create multiple)
- **Threads**: Can create threads in guild channels -- primary mechanism for separate sessions per user
- **Session pattern**: DM channel ID or thread ID maps to OllieBot conversation session

### Integration

**Library**: `discord.js` v14+ (TypeScript-native, 26K+ GitHub stars, ~446K weekly npm downloads)

**Env vars needed**:
```
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
```

**npm dependency**: `discord.js`

### How Open Source Projects Integrate

- **OpenClaw**: Routes Discord messages to AI agent sessions based on guild/channel/thread context.
- **Botpress** (14.5K stars): Visual conversation designer with Discord channel.
- Many GitHub projects under [discord-chatbot](https://github.com/topics/discord-chatbot): Common pattern is Gateway -> LLM API -> split response at 2,000 chars.

---

## 6. Facebook Messenger

### Overview

Messenger bots operate through a Facebook Page. All communication uses webhooks for input and the Send API for output. The 24-hour messaging window is the primary operational constraint.

### Bot Identity

- **Facebook Page is mandatory** -- users see the Page name and picture
- **Development Mode**: Only admins/developers/test users can interact (effectively a private bot)
- **Public access**: Requires Meta App Review (`pages_messaging` permission) -- known to be conservative with rejections

### Basic Input

**Webhook-based**: Meta POSTs JSON to your HTTPS endpoint.

**Webhook events**: `messages`, `messaging_postbacks` (button taps), `message_deliveries`, `message_reads`, `messaging_optins`, `messaging_referrals`.

**Setup**: Create Facebook App -> add Messenger product -> register webhook URL -> subscribe Page.

**Security**: Validate `X-Hub-Signature-256` HMAC on every request.

### Basic Output

**Send API**: `POST https://graph.facebook.com/v{version}/me/messages`

**24-Hour Messaging Window**:
- User messages Page -> 24h window opens (unlimited messages, any content)
- Outside window: only approved **Message Tags** (Confirmed Event Update, Post-Purchase Update, Account Update, Human Agent)
- **One-Time Notifications (OTN)**: User opts in for a single follow-up
- Violating policies -> warnings, restrictions, permanent blocks

**Rate limits**: ~250 RPS safe threshold; 200 x engaged_users calls/24h.

### Rich Output

**Templates**:

| Template | Description | Limits |
|---|---|---|
| Generic | Carousel of cards (image, title, subtitle, buttons) | 10 elements, 3 buttons each |
| Button | Text + buttons | 640 chars, 3 buttons |
| Receipt | Order confirmation | Structured data |
| Media | Image/video + optional button | 1 media + 1 button |

**Quick Replies**: Up to 13 buttons above composer. Can request location/email/phone.

**Buttons**: URL, Postback, Call, Log In/Out, Share.

**Webviews**: URL buttons open in Messenger's built-in browser (compact/tall/full).

**Attachments**: Images (JPEG, PNG, GIF), audio, video, files.

### Chat Session Control

- **Always 1:1** between user and Page (no group chats with bots)
- No built-in session concept -- your bot manages state using user's PSID (Page-Scoped ID)
- PSID is stable per user-per-page
- **Handover Protocol**: Transfer conversation control between apps (e.g., bot to live agent)

### Integration

**No official Node.js SDK from Meta**. Most projects use direct HTTP calls to the Graph API.

**Env vars needed**:
```
FB_PAGE_ACCESS_TOKEN=...
FB_APP_SECRET=...
FB_VERIFY_TOKEN=...
```

### How Open Source Projects Integrate

- **Botkit**: `botkit-adapter-facebook` handles webhook verification, parsing, sending.
- **Botpress**: Visual flow builder with Messenger as channel module.
- **Rasa**: `facebook` connector in `credentials.yml`.
- **BotMan** (PHP): Facebook Messenger driver.

---

## Implementation Recommendations

### SDK Strategy

| Platform | SDK | Rationale |
|---|---|---|
| **Teams** | M365 Agents SDK | Native, full Adaptive Card support |
| **Facebook Messenger** | M365 Agents SDK (Azure Bot Service connector) | Free routing, acceptable for basic text + templates |
| **LINE** | M365 Agents SDK (Azure Bot Service connector) | Free routing, cards rendered as images (acceptable) |
| **Slack** | Native `@slack/bolt` | Full Block Kit, modals, slash commands, Socket Mode |
| **Discord** | Native `discord.js` | Not supported by Azure Bot Service |
| **WhatsApp** | Native (Cloud API / `@WhatsApp/WhatsApp-Nodejs-SDK`) | Not supported by Azure Bot Service |
| **SMS/RCS** | Native `twilio` | Azure Bot Service SMS also uses Twilio underneath; going direct avoids indirection |

### Channel Interface Fitness Review

The current `Channel` interface has a gap: **WebSocketChannel has capabilities that exceed the interface**.

WebSocketChannel exposes these methods NOT in the Channel interface:

| Extra Method | Purpose | Should it be in Channel? |
|---|---|---|
| `attachToServer(wss)` | Bind to HTTP server's WebSocket upgrade | No -- transport-specific |
| `onBrowserAction(handler)` | Handle browser automation session actions | No -- feature-specific |
| `onDesktopAction(handler)` | Handle desktop automation session actions | No -- feature-specific |
| `onNewConversation(handler)` | New conversation event | Already optional in interface |
| `getConnectedClients()` | Client count for monitoring | Could be useful as optional `getClientCount?()` |
| `disconnectAllClients()` | Test cleanup | No -- test utility |
| Private: `sendToClient(clientId, data)` | Targeted send to one client | No -- multi-client is WebSocket-specific |
| Private: `sendActiveStreamState(clientId, conversationId)` | Stream resume on conversation switch | No -- web UI-specific |

**Verdict**: The Channel interface fits WebSocketChannel well for its public contract. The extra methods are transport-specific extensions, not core channel behavior. Messenger channels will NOT need `attachToServer`, `onBrowserAction`, `onDesktopAction`, or targeted client sends. The interface is sound as-is.

One potential addition for messenger channels: an optional `sendTypingIndicator?(conversationId: string): void` -- Slack, Teams, Discord, WhatsApp, and FB Messenger all support typing indicators, but the current interface has no way to express this. This could be added as an optional method.

### Shared Infrastructure

All messenger channels share a common pattern that can be abstracted:

```typescript
// src/channels/messenger-base.ts
abstract class MessengerChannel implements Channel {
  abstract readonly id: string;
  abstract readonly name: string;

  protected messageHandler: ((message: Message) => Promise<void>) | null = null;
  protected actionHandler: ((action: string, data: unknown) => Promise<void>) | null = null;
  protected interactionHandler: ((requestId: string, response: unknown, conversationId?: string) => Promise<void>) | null = null;
  protected activeStreams: Map<string, { content: string; messageId?: string }> = new Map();

  onMessage(handler: (message: Message) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onAction(handler: (action: string, data: unknown) => Promise<void>): void {
    this.actionHandler = handler;
  }

  onInteraction(handler: (requestId: string, response: unknown, conversationId?: string) => Promise<void>): void {
    this.interactionHandler = handler;
  }

  // Common streaming pattern: accumulate + send/update on end
  startStream(streamId: string): void {
    this.activeStreams.set(streamId, { content: '' });
  }

  sendStreamChunk(streamId: string, chunk: string): void {
    const stream = this.activeStreams.get(streamId);
    if (stream) stream.content += chunk;
  }

  // Most messenger channels: no-op (system events are web UI-specific)
  broadcast(_data: unknown): void {}

  abstract endStream(streamId: string, options?: StreamEndOptions): void;
  abstract send(content: string, options?: SendOptions): Promise<void>;
  abstract sendError(error: string, details?: string, conversationId?: string): Promise<void>;
  abstract isConnected(): boolean;
  abstract init(): Promise<void>;
  abstract close(): Promise<void>;
}
```

### Markdown Conversion Layer

Each platform needs LLM Markdown output converted to its native format:

| Platform | Conversion Needed | Tool |
|---|---|---|
| Slack | Markdown -> mrkdwn | `md-to-slack` npm package |
| Teams | Markdown -> Adaptive Card JSON or Teams MD subset | Custom converter |
| Discord | Minimal (mostly compatible) | Strip unsupported elements |
| WhatsApp | Markdown -> WhatsApp formatting | Custom converter (`**` -> `*`, etc.) |
| SMS | Strip all formatting | Plain text only |
| FB Messenger | Strip all formatting | Plain text (no markdown support) |
| LINE | Strip all formatting | Plain text (cards are images) |

### Webhook Router

For platforms requiring webhooks (Teams, WhatsApp, SMS, FB Messenger), add routes to the Hono server. M365 Agents SDK channels route through Azure Bot Service, so only the Teams endpoint is needed locally:

```typescript
// src/server/index.ts (additions)

// M365 Agents SDK (Teams + FB Messenger + LINE all route through a single Azure Bot Service endpoint)
app.post('/api/im-channels/azure-bot/webhook', agentsBotChannel.handleWebhook);

// Native integrations
// Slack: no webhook needed (Socket Mode uses outbound WebSocket)
// Discord: no webhook needed (Gateway uses outbound WebSocket)
app.post('/api/im-channels/whatsapp/webhook', whatsappChannel.handleWebhook);
app.get('/api/im-channels/whatsapp/webhook', whatsappChannel.handleVerification);
app.post('/api/im-channels/sms/webhook', smsChannel.handleWebhook);
```

### Implementation Order

1. **Slack** (native `@slack/bolt`) -- Socket Mode, no public endpoint, full Block Kit, free
2. **Teams + FB Messenger + LINE** (M365 Agents SDK) -- Single Azure Bot resource, one codebase for 3 channels, ~$15-70/month Azure hosting
3. **Discord** (native `discord.js`) -- Gateway WebSocket, threads for sessions, free
4. **WhatsApp** (native Cloud API) -- Webhook + REST, business verification required, per-message costs
5. **SMS/RCS** (native `twilio`) -- Webhook + REST, 10DLC registration, per-segment costs

### Environment Configuration

Add to `.env.example`:
```bash
# Slack (native Bolt SDK)
SLACK_BOT_TOKEN=
SLACK_APP_TOKEN=

# M365 Agents SDK (Teams + FB Messenger + LINE)
AZURE_BOT_APP_ID=
AZURE_BOT_APP_PASSWORD=
AZURE_BOT_TENANT_ID=

# Discord (native discord.js)
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=

# WhatsApp (native Cloud API)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_WABA_ID=

# SMS (native Twilio)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
```

### Key Dependencies

```json
{
  "@slack/bolt": "^4.x",
  "@microsoft/agents-hosting": "^1.x",
  "@microsoft/agents-hosting-express": "^1.x",
  "@microsoft/agents-hosting-teams": "^1.x",
  "discord.js": "^14.x",
  "twilio": "^5.x",
  "md-to-slack": "^1.x"
}
```

For WhatsApp, use `@WhatsApp/WhatsApp-Nodejs-SDK` or direct HTTP calls to the Graph API. Facebook Messenger and LINE are routed through Azure Bot Service (no separate SDK needed).
