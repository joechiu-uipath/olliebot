# Personal Data Source APIs: OAuth & Real-Time Change Detection Research

Research into APIs where a user can delegate read access to an agent like OllieBot via OAuth,
with support for real-time notifications or polling/delta queries for change detection.

**Date:** 2026-02-06

---

## Summary Scorecard

| Service | OAuth | Real-Time Push | Polling/Delta | Agent Viability |
|---|---|---|---|---|
| **Gmail API** | Yes (OAuth 2.0) | Yes (Pub/Sub) | Yes | Excellent |
| **Yahoo Mail** | Yes (OAuth 2.0, restricted) | No | IMAP only | Poor |
| **Google Calendar** | Yes (OAuth 2.0) | Yes (webhooks) | Yes | Excellent |
| **Apple Calendar** | No (app-specific passwords) | No | CalDAV sync-collection | Poor |
| **Todoist** | Yes (OAuth 2.0) | Yes (webhooks) | Yes (Sync API) | Excellent |
| **Google Tasks** | Yes (OAuth 2.0) | No | Polling only | Moderate |
| **Microsoft To-Do** | Yes (OAuth 2.0 via Graph) | Yes (Graph webhooks) | Yes (delta query) | Excellent |
| **Google Drive** | Yes (OAuth 2.0) | Yes (webhooks) | Yes (changes.list) | Excellent |
| **Dropbox** | Yes (OAuth 2.0) | Yes (webhooks) | Yes (list_folder/continue) | Excellent |
| **OneDrive** | Yes (OAuth 2.0 via Graph) | Yes (Graph webhooks) | Yes (delta query) | Excellent |
| **Slack** | Yes (OAuth 2.0) | Yes (Events API) | N/A | Excellent |
| **Discord** | Yes (OAuth 2.0) | Yes (Gateway WebSocket) | N/A | Good (requires persistent conn) |
| **Telegram** | No (bot token auth) | Yes (webhooks) | Yes (getUpdates) | Moderate (no OAuth) |
| **Twitter/X** | Yes (OAuth 2.0) | Yes (Filtered Stream) | Yes (REST polling) | Moderate (expensive tiers) |
| **GitHub** | Yes (OAuth 2.0) | Yes (webhooks) | Yes (notifications API) | Excellent |
| **Fitbit** | Yes (OAuth 2.0) | Yes (subscriptions/webhooks) | Yes | Excellent |
| **Google Fit** | Deprecated (June 2025) | N/A | N/A | Dead |
| **Apple Health** | No (on-device only) | No | No | Not viable |
| **Plaid** | Yes (Link + OAuth) | Yes (webhooks) | Yes (transactions/sync) | Excellent |
| **Google Home** | Yes (OAuth 2.0) | Limited | Limited | Moderate (certification required) |
| **SmartThings** | Yes (OAuth 2.0) | Yes (webhook SmartApps) | Yes | Good |
| **Home Assistant** | Yes (OAuth 2.0) | Yes (WebSocket API) | Yes (REST API) | Excellent (self-hosted) |
| **Notion** | Yes (OAuth 2.0) | Yes (webhooks, as of 2025-09) | Yes (polling) | Excellent |
| **Evernote** | Yes (OAuth 1.0a) | Yes (webhooks) | Yes (polling) | Moderate (manual approval) |

---

## 1. Email Providers

### Gmail API

- **OAuth:** Yes, full OAuth 2.0 with granular scopes (e.g., `gmail.readonly`, `gmail.modify`).
- **Real-Time Push:** Yes, via Google Cloud Pub/Sub. Call `users.watch()` to monitor a mailbox for changes. Notifications are delivered to a Pub/Sub topic, which can then push to a webhook URL or be consumed via streaming pull (gRPC -- no inbound ports needed).
- **Polling/Delta:** Yes. After receiving a push notification (which contains only a `historyId`), call `users.history.list` with the previous `historyId` to get incremental changes.
- **Monitorable Data:** New messages, label changes, message deletions, draft changes.
- **Rate Limits:** Max 1 notification/sec per user. Watch expires after 7 days and must be renewed. Standard Gmail API quota: 250 quota units/user/sec.
- **Notable:** Streaming pull via gRPC is an excellent alternative to webhooks for an agent -- the client opens an outbound connection and holds it open; Google sends messages through it in real-time. No exposed ports required.
- **Sources:** [Gmail Push Notifications Guide](https://developers.google.com/workspace/gmail/api/guides/push)

### Yahoo Mail

- **OAuth:** Yes, OAuth 2.0 is supported, but mail scope access is **restricted**. Developers must apply through [Yahoo Sender Hub](https://senders.yahooinc.com/developer/developer-access/) and provide evidence of policy compliance. Self-service setup is not available for mail, contacts, or calendar scopes.
- **Real-Time Push:** No webhook or push notification system available.
- **Polling/Delta:** IMAP with SASL OAUTHBEARER authentication only. No REST API for mail.
- **Monitorable Data:** Email messages via IMAP.
- **Rate Limits:** Not publicly documented for IMAP.
- **Notable:** The proprietary Yahoo Mail API has been discontinued. Only IMAP/SMTP with OAuth is available, and requires commercial application approval.
- **Sources:** [Yahoo OAuth 2.0 Guide](https://developer.yahoo.com/oauth2/guide/), [Yahoo Developer Access](https://senders.yahooinc.com/developer/developer-access/)

---

## 2. Calendar

### Google Calendar API

- **OAuth:** Yes, full OAuth 2.0. Scopes include `calendar.readonly`, `calendar.events.readonly`, etc.
- **Real-Time Push:** Yes, via webhooks (push notifications). Call `events.watch()` to create a notification channel for a specific calendar. Google sends HTTP POST to your HTTPS endpoint when events change.
- **Polling/Delta:** Yes. Use `syncToken` parameter on `events.list` to get incremental changes since last sync. The `updatedMin` parameter can also filter by modification time.
- **Monitorable Data:** Events (created, updated, deleted), calendar list changes, ACL changes, settings changes.
- **Rate Limits:** 1,000,000 queries/day default. Per-user per-minute limits apply. Notification channels expire after up to 1 week and must be renewed.
- **Notable:** Webhook notifications do NOT include event data -- they signal that something changed. You must call the API to fetch the actual changes. The `X-Goog-Resource-State` header indicates the type of change.
- **Sources:** [Google Calendar Push Notifications](https://developers.google.com/workspace/calendar/api/guides/push)

### Apple Calendar (iCloud)

- **OAuth:** No. Apple does not provide OAuth for CalDAV authentication. Only app-specific passwords with Basic Auth are supported.
- **Real-Time Push:** No. No webhook or push notification support for third-party apps.
- **Polling/Delta:** Limited. CalDAV `sync-collection` REPORT can detect changes, but must be polled manually.
- **Monitorable Data:** Calendar events via CalDAV (ICS format).
- **Rate Limits:** Not documented.
- **Notable:** Poor developer experience. Documentation is sparse, not all CalDAV methods work, no PATCH support (full PUT required). Not recommended for OllieBot integration. Consider using unified calendar APIs like Cronofy or Nylas as intermediaries.
- **Sources:** [Apple CalDAV Documentation](https://developer.apple.com/documentation/devicemanagement/caldav), [OneCal iCloud Integration Guide](https://www.onecal.io/blog/how-to-integrate-icloud-calendar-api-into-your-app)

---

## 3. Task/Todo Managers

### Todoist API

- **OAuth:** Yes, full OAuth 2.0. Scopes are configured in the App Management Console. Token revocation per RFC 7009 is supported.
- **Real-Time Push:** Yes, via webhooks. Webhook URLs must use HTTPS. Webhooks activate when a user completes the OAuth flow. Payloads include `event_name`, `user_id`, `event_data`. Requests are signed with `X-Todoist-Hmac-SHA256`.
- **Polling/Delta:** Yes. The Sync API (v9) supports incremental syncing using sync tokens. The REST API (v2) is simpler for individual operations.
- **Monitorable Data:** Task creation/completion/updates, project changes, label changes, comment changes.
- **Rate Limits:** Not explicitly documented per endpoint, but standard API rate limiting applies.
- **Notable:** Also supports MCP (Model Context Protocol) for AI assistant integration. CORS support on all non-OAuth endpoints. Webhooks should be treated as notifications, not primary data sources, due to potential out-of-order/failed deliveries.
- **Sources:** [Todoist API v1](https://developer.todoist.com/api/v1/), [Todoist Sync API v9](https://developer.todoist.com/sync/v9/), [Todoist Webhooks Guide](https://rollout.com/integration-guides/todoist/quick-guide-to-implementing-webhooks-in-todoist)

### Google Tasks API

- **OAuth:** Yes, OAuth 2.0 with scopes like `tasks.readonly`.
- **Real-Time Push:** No. No webhook or event subscription capability.
- **Polling/Delta:** Polling only. No built-in delta/sync token mechanism. Must poll `tasklists.list` and `tasks.list` periodically and diff locally.
- **Monitorable Data:** Task lists, tasks (title, status, due date, notes, completion).
- **Rate Limits:** 50,000 queries/day courtesy limit (can request increase). Max 1000 results per page.
- **Notable:** Significantly less capable than Todoist for agent integration due to lack of push notifications. Would require frequent polling. HTTP 503 returned when limits exceeded; use exponential backoff.
- **Sources:** [Google Tasks API Quotas](https://developers.google.com/workspace/tasks/limits), [Google Tasks Auth Scopes](https://developers.google.com/workspace/tasks/auth)

### Microsoft To-Do (via Microsoft Graph)

- **OAuth:** Yes, OAuth 2.0 via Microsoft Graph. Supports both delegated and application permissions.
- **Real-Time Push:** Yes, via Microsoft Graph change notifications (webhooks). Subscribe to `todoTask` resources on specific task lists. Supports `created`, `updated`, `deleted` change types. Can also receive events via Azure Event Grid (CloudEvents schema).
- **Polling/Delta:** Yes, via Microsoft Graph delta query. Enables incremental sync of changes.
- **Monitorable Data:** Task creation, updates, deletion, status changes across task lists.
- **Rate Limits:** Standard Microsoft Graph throttling (varies by endpoint). Subscription expiration requires periodic renewal.
- **Notable:** Known issue -- webhooks may not always trigger on status changes and deletions unless `changeType` is explicitly set to `"created,updated,deleted"` in the subscription.
- **Sources:** [Microsoft Graph Change Notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview), [Microsoft To-Do API Overview](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview)

---

## 4. Cloud Storage

### Google Drive API

- **OAuth:** Yes, full OAuth 2.0 with granular scopes (`drive.readonly`, `drive.metadata.readonly`, `drive.file`).
- **Real-Time Push:** Yes, via webhooks. Use `files.watch()` for individual files or `changes.watch()` for drive-wide changes. Google sends empty-body HTTP POST to your HTTPS endpoint; you must then call `changes.list` to get actual changes.
- **Polling/Delta:** Yes. The Changes API (`changes.list`) returns incremental changes using a `startPageToken`. Supports tracking file content changes, metadata changes, permission changes.
- **Monitorable Data:** File creation, modification, deletion, permission changes, sharing changes, folder structure changes.
- **Rate Limits:** 12,000 queries/user/100sec, 1,000,000 queries/day/project. Watch channels expire (no dashboard to manage them -- must track yourself). Bulk actions can generate hundreds of notifications.
- **Notable:** Webhook renewal creates a NEW channel (different ID) which can cause gaps or duplicates. Drive does not notify you before expiration -- it just stops. Consider throttling for bulk action scenarios.
- **Sources:** [Google Drive Push Notifications](https://developers.google.com/workspace/drive/api/guides/push), [Drive Changes API](https://www.emptor.io/blog/demystifying-the-google-drive-changes-api)

### Dropbox API

- **OAuth:** Yes, full OAuth 2.0 with scoped permissions. Requires `files.metadata.read` scope for webhooks.
- **Real-Time Push:** Yes, via webhooks. Dropbox sends HTTP POST with JSON containing account IDs that have changes. Payload does NOT include actual file changes -- must call `/files/list_folder/continue` with cursor to get details.
- **Polling/Delta:** Yes. Use `/files/list_folder` with cursor-based pagination for incremental change detection. Keep track of the latest cursor for each user.
- **Monitorable Data:** File/folder creation, file content updates. Does NOT detect sharing setting changes or other metadata-only changes.
- **Rate Limits:** No specific documented rate for webhooks. Standard API rate limits apply. Cannot subscribe to specific event types -- all changes fire the same notification.
- **Notable:** Webhook verification uses a challenge-response pattern (GET with `challenge` parameter, must echo back within 10 seconds). Upcoming 2026 change: API server root certificate changes may affect connections.
- **Sources:** [Dropbox Webhooks Reference](https://www.dropbox.com/developers/reference/webhooks), [Dropbox Detecting Changes Guide](https://developers.dropbox.com/detecting-changes-guide)

### OneDrive (via Microsoft Graph)

- **OAuth:** Yes, OAuth 2.0 via Microsoft Graph. Supports delegated and application permissions.
- **Real-Time Push:** Yes, via Microsoft Graph change notifications (webhooks). Subscribe to drive item changes. Also supports Azure Event Hubs and Event Grid delivery.
- **Polling/Delta:** Yes, excellent delta query support. `GET /me/drive/root/delta` returns incremental changes with cursor-based pagination. Supports "sync from now" with `?token=latest`. OneDrive for Business supports timestamp-based tokens. Permission change tracking available via `Prefer: deltashowsharingchanges` header.
- **Monitorable Data:** File/folder creation, modification, deletion, permission changes, sharing changes.
- **Rate Limits:** Standard Microsoft Graph throttling. Subscription renewal required. Must acknowledge notifications with HTTP 202.
- **Notable:** Best practice is to combine webhooks + delta query: subscribe to webhooks, then use delta query to get actual changes. Periodic delta query (once/day) recommended as safety net in case notifications are missed.
- **Sources:** [Microsoft Graph Delta Query](https://learn.microsoft.com/en-us/graph/delta-query-overview), [driveItem Delta API](https://learn.microsoft.com/en-us/graph/api/driveitem-delta)

---

## 5. Communication

### Slack API

- **OAuth:** Yes, full OAuth 2.0. Event types are tied to OAuth permission scopes granted during app installation. Scopes include `channels:history`, `channels:read`, `im:read`, `im:history`, etc.
- **Real-Time Push:** Yes, via the Events API (recommended). Set up endpoint URLs to receive event payloads as HTTP POST with JSON. Supports granular event type subscriptions. Also legacy RTM (Real Time Messaging) WebSocket API still available but deprecated.
- **Polling/Delta:** Not the primary model, but `conversations.history` can be used for polling (subject to strict rate limits for non-Marketplace apps).
- **Monitorable Data:** Messages (public/private channels, DMs), reactions, channel changes, user presence, file uploads, app mentions, slash commands.
- **Rate Limits:** Events API: 30,000 deliveries/workspace/hour. Web API: tiered rate limits per method (Tier 1-4). **Critical 2025 change:** Non-Marketplace apps face severe rate limits on `conversations.history` and `conversations.replies` (1 req/min, max 15 objects). Marketplace-approved and internal custom apps are exempt.
- **Notable:** Events may arrive out of order. Must verify `X-Slack-Signature` and `X-Slack-Request-Timestamp` headers. Only subscribe to events you need. Incoming webhooks are for *sending* messages, not receiving -- don't confuse with Events API.
- **Sources:** [Slack Events API](https://docs.slack.dev/apis/events-api/), [Slack Rate Limits](https://docs.slack.dev/apis/web-api/rate-limits/), [2025 Rate Limit Changes](https://api.slack.com/changelog/2025-05-terms-rate-limit-update-and-faq)

### Discord API

- **OAuth:** Yes, OAuth 2.0. Scopes include `identify`, `guilds`, `guilds.members.read`, `messages.read`, `gateway.connect`, `bot`. Bearer tokens can connect to the Gateway on behalf of a user.
- **Real-Time Push:** Yes, via the Gateway API (WebSocket). Supports real-time events: messages, reactions, member updates, voice state, channel changes, etc. Requires maintaining a persistent WebSocket connection with heartbeats. Also supports slash command interactions via HTTP endpoint (stateless, no persistent connection needed).
- **Polling/Delta:** REST API can poll channels, messages, etc. But the primary model is the WebSocket Gateway.
- **Monitorable Data:** Messages (guild and DM), reactions, member join/leave, voice state, channel/role changes, presence updates.
- **Rate Limits:** 50 requests/sec global. Per-route rate limits via response headers. Privileged Gateway Intents (GuildMembers, GuildPresences, MessageContent) require explicit enablement and justification for large bots (75+ guilds).
- **Notable:** The WebSocket Gateway requires a persistent runtime -- serverless platforms will not work. For stateless interactions (slash commands), use HTTP Interactions Endpoint. Rate limits on OAuth token exchange: 10 sign-ins/hour per user.
- **Sources:** [Discord Gateway Docs](https://discord.com/developers/docs/topics/gateway), [Discord OAuth2](https://docs.discord.food/topics/oauth2), [Discord Rate Limits](https://discord.com/developers/docs/topics/rate-limits)

### Telegram Bot API

- **OAuth:** No. Telegram uses bot token authentication (obtained from BotFather), not OAuth. Users interact with the bot via Telegram; no delegated account access model.
- **Real-Time Push:** Yes, via webhooks. Register a URL with `setWebhook`, and Telegram sends HTTP POST with update payloads. SSL/TLS required. Supported ports: 443, 80, 88, 8443.
- **Polling/Delta:** Yes, via `getUpdates` (long polling). Mutually exclusive with webhooks. Updates stored server-side for up to 24 hours.
- **Monitorable Data:** Messages, edited messages, channel posts, inline queries, callback queries, file uploads.
- **Rate Limits:** Not strictly documented per se, but sending messages is limited to ~30 messages/sec to different chats, ~20 messages/min to the same group.
- **Notable:** No OAuth means no "delegate read access to your Telegram account" model. The bot can only see messages sent to it or in groups where it is a member. Use `secret_token` for webhook verification. API version 7.7 as of latest.
- **Sources:** [Telegram Bot API](https://core.telegram.org/bots/api), [Telegram Webhooks Guide](https://core.telegram.org/bots/webhooks)

---

## 6. Social Media

### Twitter/X API v2

- **OAuth:** Yes, OAuth 2.0 (App-Only and User Context). OAuth 2.0 PKCE for user-context access. OAuth 1.0a also supported for legacy.
- **Real-Time Push:** Yes, via Filtered Stream (persistent SSE connection with rule-based filtering). The Filtered Stream Webhooks API (push-based, no persistent connection) exists but is **Enterprise-tier only**.
- **Polling/Delta:** Yes. REST endpoints for user timelines, mentions, search. `since_id` parameter for incremental polling.
- **Monitorable Data:** Tweets (user timeline, mentions, search), likes, follows, lists. Filtered Stream can match complex rules across all public tweets.
- **Rate Limits:** Complex tiered system based on access level:
  - **Free tier:** Very limited (1 app, read-only, 1 filtered stream rule, 10,000 tweet reads/month).
  - **Basic ($200/month):** 10,000 tweet reads/month, limited endpoints.
  - **Pro ($5,000/month):** 1M tweet reads/month, full filtered stream (25 rules).
  - **Enterprise:** Custom pricing, filtered stream webhooks, higher limits.
  - Monthly "post quota" applies to search and stream endpoints.
- **Notable:** The free tier is essentially unusable for agent integration. Even Basic tier is limited. Real-time streaming requires maintaining a persistent connection. The Enterprise webhook option is cost-prohibitive for most use cases.
- **Sources:** [X API Filtered Stream](https://developer.x.com/en/docs/x-api/tweets/filtered-stream/migrate), [X API Pricing](https://elfsight.com/blog/how-to-get-x-twitter-api-key-in-2025/), [Filtered Stream Webhooks](https://docs.x.com/x-api/webhooks/stream/introduction)

### GitHub API

- **OAuth:** Yes, full OAuth 2.0 (also supports GitHub Apps with installation tokens). OAuth apps get 5,000 requests/hour; GitHub Apps get higher limits.
- **Real-Time Push:** Yes, via webhooks. Can subscribe to 60+ event types on repositories, organizations, or apps. Webhook payloads include full event data. Signed with `X-Hub-Signature-256`.
- **Polling/Delta:** Yes. Notifications API (`/notifications`) with `since` parameter. ETags and conditional requests (304 responses don't count against rate limit). `Last-Modified` headers for efficient polling.
- **Monitorable Data:** Push events, pull requests, issues, comments, releases, deployments, stars, forks, workflow runs, security alerts, discussions.
- **Rate Limits:** OAuth apps: 5,000 requests/hour (15,000 for Enterprise Cloud). Conditional requests (ETag/304) do NOT count against limits. Secondary rate limits for abuse prevention. GitHub Apps have better limits than OAuth tokens.
- **Notable:** Excellent agent target. Webhooks are the recommended approach (avoids rate limit issues from polling). Consider GitHub Apps over OAuth for better rate limits. GraphQL API can reduce multiple REST calls into one request.
- **Sources:** [GitHub Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [GitHub Webhooks](https://docs.github.com/en/webhooks/about-webhooks), [GitHub REST Best Practices](https://docs.github.com/rest/guides/best-practices-for-using-the-rest-api)

---

## 7. Health/Fitness

### Fitbit API (now under Google)

- **OAuth:** Yes, OAuth 2.0 with Authorization Code Grant and PKCE. Scopes include `activity`, `heartrate`, `sleep`, `weight`, `nutrition`, `profile`, `settings`.
- **Real-Time Push:** Yes, via Subscription API (webhooks). Register a subscriber endpoint URL; Fitbit sends HTTP POST notifications in near real-time when user data is updated. Endpoint must respond within 5 seconds with HTTP 204.
- **Polling/Delta:** Yes. REST endpoints for all data types with date/time range parameters.
- **Monitorable Data:** Steps, calories, distance, heart rate (including 1-second intraday in 2026), sleep stages, weight, body composition, activity logs, nutrition logs.
- **Rate Limits:** 1,500 API calls/hour/user. Subscriber auto-disabled if endpoint doesn't respond properly. Endpoint verification required (challenge-response).
- **Notable:** Excellent for health monitoring. Webhook notifications reduce polling by ~80%. Intraday data (1-minute or 1-second resolution for heart rate) requires special approval for personal apps. Subscriber stats endpoint shows last 1,000 webhook deliveries.
- **Sources:** [Fitbit Subscription API](https://dev.fitbit.com/build/reference/web-api/subscription/), [Fitbit Web API Reference](https://dev.fitbit.com/build/reference/web-api/), [Using Subscriptions Guide](https://dev.fitbit.com/build/reference/web-api/developer-guide/using-subscriptions/)

### Google Fit API

- **OAuth:** Was OAuth 2.0, now **fully deprecated**.
- **Real-Time Push:** N/A (shut down).
- **Polling/Delta:** N/A (shut down).
- **Status:** Google Fit REST API fully shut down as of June 30, 2025. New developer sign-ups ended May 1, 2024. Replacement is **Health Connect** (Android-only, on-device, no cloud API, no OAuth). For cloud-accessible health data, use **Fitbit Web API** instead.
- **Sources:** [Google Fit Deprecation FAQ](https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq), [Migration Guide](https://developer.android.com/health-and-fitness/health-connect/migration/fit)

### Apple Health (HealthKit)

- **OAuth:** No. HealthKit is a local, on-device framework only. No REST API, no cloud API, no OAuth.
- **Real-Time Push:** No.
- **Polling/Delta:** No (requires native iOS app to access data locally).
- **Monitorable Data:** Only accessible via a native iOS/watchOS app running on the user's device.
- **Notable:** Completely unusable for a server-side agent. Data never leaves the device unless a native app explicitly exports it. Third-party services like **Terra API** or **Thryve** act as middleware: they provide a native SDK that reads HealthKit data on-device and sends it to their cloud via webhooks, effectively bridging the gap. This is the only viable path for an agent.
- **Sources:** [Apple HealthKit Documentation](https://developer.apple.com/documentation/healthkit), [Terra API Apple Health Integration](https://tryterra.co/integrations/apple-health)

---

## 8. Finance

### Plaid API

- **OAuth:** Yes, but unique model. Uses **Plaid Link** (frontend module) for user authentication -- user authenticates directly with their bank via Link, producing a `public_token` that is exchanged for a long-lived `access_token`. Many banks use OAuth under the hood (user is redirected to bank's OAuth page). Plaid itself provides OAuth 2.0 endpoints for partner/dashboard access.
- **Real-Time Push:** Yes, via webhooks. Set webhook URL in `/link/token/create`. Plaid sends HTTP POST for various event types:
  - `INITIAL_UPDATE` (first 30 days of transactions, ~10 sec after link)
  - `HISTORICAL_UPDATE` (all historical transactions, ~1 min after link)
  - `SYNC_UPDATES_AVAILABLE` (ongoing transaction changes)
  - `DEFAULT_UPDATE` (new transactions, 1-4x/day)
  - `TRANSACTIONS_REMOVED` (transactions removed by institution)
  - Item error/status webhooks (e.g., `OAUTH_CONSENT_EXPIRED`, `OAUTH_USER_REVOKED`)
- **Polling/Delta:** Yes. `/transactions/sync` with cursor-based incremental sync. Returns added, modified, and removed transactions since last cursor.
- **Monitorable Data:** Transactions, balances, account info, investment holdings, liabilities, identity, income.
- **Rate Limits:** Webhook retries for up to 24 hours with exponential backoff (starting at 30 sec, 4x delay). Must handle duplicate/out-of-order webhooks.
- **Notable:** Plaid checks for new transactions 1-4 times/day depending on institution. Not true real-time for transactions -- more like near-daily. Balance checks can be on-demand. Webhook verification is optional but recommended. As of Dec 2025, v2 personal finance categories taxonomy is the default for new integrations.
- **Sources:** [Plaid Webhooks](https://plaid.com/docs/api/webhooks/), [Plaid Transactions](https://plaid.com/docs/api/products/transactions/), [Plaid Link OAuth Guide](https://plaid.com/docs/link/oauth/)

---

## 9. Smart Home

### Google Home APIs

- **OAuth:** Yes, OAuth 2.0 for device access. Users grant permission for an app to access their smart home data. Must pass certification before launching.
- **Real-Time Push:** Limited. The Home APIs SDK (Android/iOS) provides device state access, but the push notification model is primarily designed for on-device apps, not server-side agents. The older Smart Home API (for building device integrations) uses SYNC/QUERY/EXECUTE intents from Google to your cloud service.
- **Polling/Delta:** Limited. Device state can be queried via the API, but no documented delta/change tracking mechanism for external polling.
- **Monitorable Data:** Device states (lights, thermostats, locks, cameras, etc.) across 600M+ compatible devices. Supports Matter and Cloud-to-cloud device types.
- **Rate Limits:** Not publicly documented for the new Home APIs. Certification required.
- **Notable:** The Home APIs are relatively new (2025) and primarily targeted at mobile app developers. Server-side agent integration is not the primary use case. SHA-1 fingerprint is required for OAuth to work. Requires Google Home Developer Console setup and certification.
- **Sources:** [Google Home APIs Overview](https://developers.home.google.com/apis), [Home APIs Android SDK](https://developers.home.google.com/apis/android/overview)

### SmartThings API

- **OAuth:** Yes, full OAuth 2.0. Personal Access Tokens now expire after 24 hours (changed Dec 2024); OAuth flow is the recommended long-term auth method.
- **Real-Time Push:** Yes, via Webhook SmartApps. Register a publicly accessible HTTPS URL; SmartThings sends signed webhook payloads (x.509 certificates) for device events. Domain verification required.
- **Polling/Delta:** Yes. REST API for querying device states, capabilities, and locations.
- **Monitorable Data:** Device states (sensors, switches, locks, thermostats, cameras), automation triggers, scenes, locations.
- **Rate Limits:** Not explicitly documented per endpoint. Standard API throttling applies.
- **Notable:** Good for IoT integration. Webhook SmartApps require domain ownership verification. Security model uses rotating x.509 certificates for request signing. Supports 200+ device types across the Samsung ecosystem.
- **Sources:** [SmartThings OAuth Integrations](https://developer.smartthings.com/docs/connected-services/oauth-integrations), [SmartThings Webhook SmartApps](https://developer.smartthings.com/docs/connected-services/hosting/webhook-smartapp)

### Home Assistant

- **OAuth:** Yes, OAuth 2.0 for third-party apps (provides refresh tokens). Also supports Long-lived Access Tokens (valid up to 10 years) for simpler integrations.
- **Real-Time Push:** Yes, via WebSocket API. Subscribe to `state_changed` events for real-time, bidirectional communication. Can subscribe to all events or use `subscribe_trigger` for filtered subscriptions. Automatic reconnection and resubscription supported.
- **Polling/Delta:** Yes, via REST API. Query entity states, call services, access configuration. Endpoint: `/api/states`.
- **Monitorable Data:** All entity states (sensors, switches, lights, climate, media players, automations, scripts). Essentially any device or integration connected to the HA instance.
- **Rate Limits:** Self-hosted, so no external rate limits. Performance depends on the HA instance hardware.
- **Notable:** The best option for comprehensive smart home monitoring IF the user runs their own Home Assistant instance. WebSocket API provides true real-time with very low latency. Webhooks are also supported (unauthenticated, but can be encrypted). The JS WebSocket library (`home-assistant-js-websocket`) provides a ready-made client with auto-reconnection.
- **Sources:** [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/), [Home Assistant REST API](https://www.home-assistant.io/integrations/api/), [HA JS WebSocket Library](https://github.com/home-assistant/home-assistant-js-websocket)

---

## 10. Notes

### Notion API

- **OAuth:** Yes, full OAuth 2.0. Public integrations use OAuth to access user workspaces. Internal integrations use API keys.
- **Real-Time Push:** Yes (as of API version 2025-09-03). Native webhook support with event subscriptions. Events include page creation/update/deletion, database changes, and `data_source.schema_updated`. Webhook subscriptions are configured through integration settings.
- **Polling/Delta:** Yes. Query databases with `filter` and `sorts`. Use `last_edited_time` property (updates every ~1 minute) for change detection. The `search` endpoint can also find recently modified pages.
- **Monitorable Data:** Pages (creation, updates, deletion), database entries, properties, comments, blocks. New data source model (2025-09-03) adds `data_source_id` to webhook payloads.
- **Rate Limits:** 3 requests/second per integration. Average request limit with burstable capacity.
- **Notable:** Webhooks are a significant recent addition (2025-09). The API version 2025-09-03 introduced breaking changes with multi-source databases. Webhook handlers must support both old and new event payload formats during migration. Third-party platforms (Make, n8n) already support Notion webhooks.
- **Sources:** [Notion Webhooks Reference](https://developers.notion.com/reference/webhooks), [Notion API Upgrade Guide 2025-09-03](https://developers.notion.com/docs/upgrade-guide-2025-09-03), [Notion Webhooks Developer Guide](https://softwareengineeringstandard.com/2025/08/31/notion-webhooks/)

### Evernote API

- **OAuth:** Yes, OAuth 1.0a (not OAuth 2.0). API key must be manually requested and approved (allow up to 5 business days). There are indications of an OAuth 2.0 migration in 2025 but not confirmed as complete.
- **Real-Time Push:** Yes, via webhooks (called "notifications"). Register by emailing devsupport@evernote.com with your Customer Key, URL, and note filter. Notifications are HTTP GET requests containing user ID, notebook GUID, note GUID, and reason code.
- **Polling/Delta:** Yes, but expensive. Use `NoteStore.findNotesMetadata` for polling (not recommended -- expensive on Evernote servers). Poll no more than once per 15 minutes or risk API key revocation. Webhooks strongly preferred.
- **Monitorable Data:** Note creation and updates (filtered by search grammar, e.g., `resource:image/*`). Evernote Business also supports `business_create` and `business_update` events.
- **Rate Limits:** Rate limits enforced but not well-documented. Excessive polling (>1x per 15 min) may result in temporary API key revocation.
- **Notable:** The manual webhook registration process (email-based) is antiquated. OAuth 1.0a is more complex to implement than OAuth 2.0. Webhook notifications require pre-configured note filters. The 2025 update mentions a revamped RESTful API with caching strategies, but developer experience remains below modern standards.
- **Sources:** [Evernote OAuth Documentation](https://dev.evernote.com/doc/articles/authentication.php), [Evernote Polling Notifications](https://dev.evernote.com/doc/articles/polling_notification.php), [Evernote Developer Documentation](https://dev.evernote.com/doc/)

---

## Recommended Priority for OllieBot Integration

### Tier 1 -- Excellent fit (OAuth + real-time + well-documented)
1. **Gmail API** -- Pub/Sub streaming pull is ideal for agents (no inbound ports)
2. **Google Calendar API** -- Webhooks + syncToken delta queries
3. **Microsoft Graph** (Outlook, OneDrive, To-Do) -- Unified API, webhooks + delta queries
4. **Google Drive API** -- Webhooks + Changes API
5. **Slack API** -- Events API with granular subscriptions
6. **GitHub API** -- Webhooks + conditional polling with ETags
7. **Todoist API** -- Webhooks + Sync API + MCP support
8. **Notion API** -- New webhook support (2025-09) + OAuth
9. **Plaid API** -- Webhooks for financial data + transaction sync
10. **Dropbox API** -- Webhooks + cursor-based delta

### Tier 2 -- Good fit with caveats
11. **Fitbit API** -- OAuth + subscription webhooks (health monitoring)
12. **Home Assistant** -- WebSocket real-time (requires user self-hosting)
13. **SmartThings API** -- OAuth + webhook SmartApps
14. **Discord API** -- OAuth + Gateway WebSocket (requires persistent connection)

### Tier 3 -- Usable but limited
15. **Google Tasks API** -- OAuth but polling-only (no push)
16. **Twitter/X API** -- Expensive tiers for useful access
17. **Evernote API** -- OAuth 1.0a, manual webhook registration
18. **Google Home APIs** -- New, certification required, mobile-first

### Tier 4 -- Not recommended / not viable
19. **Telegram Bot API** -- No OAuth (bot token only, not delegated user access)
20. **Yahoo Mail** -- Restricted access, IMAP only, no push
21. **Apple Calendar** -- No OAuth, no webhooks
22. **Apple Health** -- No cloud API (on-device only)
23. **Google Fit** -- Deprecated/shut down (use Fitbit instead)

---

## Architecture Patterns for OllieBot

### Pattern A: Webhook Receiver
For services with webhook support (Gmail via Pub/Sub, Slack, GitHub, Todoist, etc.):
```
User OAuth -> OllieBot registers webhook subscription
Service detects change -> Sends HTTP POST to OllieBot webhook endpoint
OllieBot processes notification -> Fetches full data via API if needed
```

### Pattern B: Streaming Connection
For services with WebSocket/SSE/streaming (Discord Gateway, Home Assistant WebSocket, Gmail Pub/Sub streaming pull):
```
User OAuth -> OllieBot opens persistent connection
Service streams events in real-time
OllieBot processes events as they arrive
```

### Pattern C: Polling with Delta Queries
For services without push (Google Tasks) or as a safety net:
```
User OAuth -> OllieBot stores sync token/cursor
Periodic poll -> Fetch changes since last sync token
OllieBot processes incremental changes -> Updates sync token
```

### Pattern D: Webhook + Delta Query (Recommended Hybrid)
Best practice for maximum reliability (Microsoft Graph, Google Drive):
```
User OAuth -> OllieBot subscribes to webhooks AND stores sync token
Webhook fires -> OllieBot uses delta query to get actual changes
Periodic safety poll (1x/day) -> Catch any missed notifications
```
