/**
 * MessageEventService - Centralized service for broadcasting AND persisting message-list events.
 *
 * This service ensures that events shown in the chat UI are always persisted to the database.
 * By combining broadcast + persistence in single methods, we prevent the bug where an event
 * is broadcast to the UI but not saved to DB (causing data loss on refresh).
 *
 * Usage:
 *   const service = new MessageEventService(webChannel);
 *   service.emitToolEvent(event, conversationId, channelId, agentInfo);
 *   service.emitDelegationEvent(...);
 *   service.emitTaskRunEvent(...);
 *   service.emitErrorEvent(...);
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import type { WebChannel } from '../channels/web.js';
import type { ToolEvent } from '../tools/types.js';

export interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  type?: string;
}

export interface DelegationEventData {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentType: string;
  parentAgentId?: string;
  parentAgentName?: string;
  mission: string;
  rationale?: string;
}

export interface TaskRunEventData {
  taskId: string;
  taskName: string;
  taskDescription: string;
}

export interface ErrorEventData {
  error: string;
  details?: string;
}

export class MessageEventService {
  constructor(private webChannel: WebChannel | null = null) {}

  /**
   * Set/update the WebChannel (can be set after construction)
   */
  setWebChannel(channel: WebChannel): void {
    this.webChannel = channel;
  }

  /**
   * Emit a tool event - broadcasts to UI AND persists to database.
   * Only persists 'tool_execution_finished' events to avoid duplicates.
   */
  emitToolEvent(
    event: ToolEvent,
    conversationId: string | null,
    channelId: string,
    agentInfo: AgentInfo,
    turnId?: string
  ): void {
    // Broadcast to UI
    if (this.webChannel && typeof this.webChannel.broadcast === 'function') {
      // Check if result contains audio data - if so, broadcast play_audio event
      // Audio can be in result.audio (legacy) or result.output.audio (nested from native tools)
      if (event.type === 'tool_execution_finished' && event.result !== undefined) {
        const result = event.result as Record<string, unknown>;
        let audioData: string | undefined;
        let mimeType: string | undefined;
        let voice: unknown;
        let model: unknown;

        if (result && typeof result === 'object') {
          if ('audio' in result && typeof result.audio === 'string') {
            // Legacy: audio at top level
            audioData = result.audio;
            mimeType = result.mimeType as string | undefined;
            voice = result.voice;
            model = result.model;
          } else if (result.output && typeof result.output === 'object') {
            // Nested: audio in output (from native tool wrapper)
            const output = result.output as Record<string, unknown>;
            if ('audio' in output && typeof output.audio === 'string') {
              audioData = output.audio;
              mimeType = output.mimeType as string | undefined;
              voice = output.voice;
              model = output.model;
            }
          }
        }

        if (audioData) {
          // Broadcast play_audio event for immediate playback
          this.webChannel.broadcast({
            type: 'play_audio',
            audio: audioData,
            mimeType: mimeType || 'audio/pcm;rate=24000',
            voice,
            model,
          });
        }
      }

      // For broadcast: pass result object directly (not pre-stringified)
      // The WebSocket layer will JSON.stringify the entire message
      // For large results without media, we truncate to avoid memory issues
      let resultForBroadcast: unknown = undefined;
      if (event.type === 'tool_execution_finished' && event.result !== undefined) {
        try {
          const fullResult = JSON.stringify(event.result);
          const result = event.result as Record<string, unknown>;
          // Check for audio in result.audio or result.output.audio (nested structure from native tools)
          const hasAudioData = result && typeof result === 'object' && (
            ('audio' in result && typeof result.audio === 'string') ||
            (result.output && typeof result.output === 'object' && 'audio' in (result.output as Record<string, unknown>) && typeof (result.output as Record<string, unknown>).audio === 'string')
          );
          // Check for data:image/ URLs (from files[].dataUrl or direct image data)
          const hasImageData = fullResult.includes('data:image/');
          const limit = 10000;
          // For media content (audio/images) or small results, pass object directly
          // For large non-media results, truncate
          if (hasAudioData || hasImageData || fullResult.length <= limit) {
            resultForBroadcast = event.result; // Pass object directly
          } else {
            resultForBroadcast = fullResult.substring(0, limit) + '...(truncated)';
          }
        } catch {
          resultForBroadcast = String(event.result);
        }
      }

      this.webChannel.broadcast({
        ...event,
        result: resultForBroadcast,
        conversationId: conversationId || undefined,
        turnId: turnId || undefined,
        timestamp: event.timestamp.toISOString(),
        startTime: 'startTime' in event ? event.startTime.toISOString() : undefined,
        endTime: 'endTime' in event ? event.endTime.toISOString() : undefined,
        agentId: agentInfo.id,
        agentName: agentInfo.name,
        agentEmoji: agentInfo.emoji,
        agentType: agentInfo.type,
      });
    }

    // Persist to database (only completed events to avoid duplicates)
    if (event.type !== 'tool_execution_finished') {
      return;
    }

    if (!conversationId) {
      console.error(
        `[MessageEventService] Cannot save tool event: conversationId is null (tool: ${event.toolName}, agent: ${agentInfo.name})`
      );
      return;
    }

    try {
      const db = getDb();
      const messageId = `tool-${event.requestId}`;

      // Check if already saved (avoid duplicates on re-runs)
      const existing = db.messages.findById(messageId);
      if (existing) {
        return;
      }

      // Store result as object (not pre-stringified) for consistency with broadcast
      // The DB layer handles JSON serialization of metadata
      let resultForStorage: unknown = undefined;
      if (event.result !== undefined) {
        try {
          const fullResult = JSON.stringify(event.result);
          // Don't truncate image data URLs or audio data
          const hasImageData = fullResult.includes('data:image/');
          // Check for audio in result.audio or result.output.audio (nested structure from native tools)
          const result = event.result as Record<string, unknown>;
          const hasAudioData = typeof result === 'object' && result !== null && (
            ('audio' in result && typeof result.audio === 'string') ||
            (result.output && typeof result.output === 'object' && 'audio' in (result.output as Record<string, unknown>) && typeof (result.output as Record<string, unknown>).audio === 'string')
          );
          const limit = (hasImageData || hasAudioData) ? 5000000 : 10000;
          // For media content or small results, store object directly
          // For large non-media results, store truncated string
          if (hasImageData || hasAudioData || fullResult.length <= limit) {
            resultForStorage = event.result; // Store object directly
          } else {
            resultForStorage = fullResult.substring(0, limit) + '...(truncated)';
          }
        } catch {
          resultForStorage = String(event.result);
        }
      }

      db.messages.create({
        id: messageId,
        conversationId,
        channel: channelId,
        role: 'tool',
        content: '',
        metadata: {
          type: 'tool_event',
          toolName: event.toolName,
          source: event.source,
          success: event.success as boolean,
          durationMs: event.durationMs as number,
          error: event.error as string | undefined,
          parameters: event.parameters as Record<string, unknown> | undefined,
          result: resultForStorage,
          agentId: agentInfo.id,
          agentName: agentInfo.name,
          agentEmoji: agentInfo.emoji,
          agentType: agentInfo.type,
        },
        // Use the original event timestamp for consistent ordering with real-time
        createdAt: event.timestamp.toISOString(),
        turnId,
      });
    } catch (error) {
      console.error(`[MessageEventService] Failed to save tool event:`, error);
    }
  }

  /**
   * Emit a delegation event - broadcasts to UI AND persists to database.
   */
  emitDelegationEvent(
    data: DelegationEventData,
    conversationId: string | null,
    channelId: string,
    turnId?: string
  ): void {
    const timestamp = new Date().toISOString();

    // Broadcast to UI
    if (this.webChannel && typeof this.webChannel.broadcast === 'function') {
      this.webChannel.broadcast({
        type: 'delegation',
        agentId: data.agentId,
        agentName: data.agentName,
        agentEmoji: data.agentEmoji,
        agentType: data.agentType,
        parentAgentId: data.parentAgentId,
        parentAgentName: data.parentAgentName,
        mission: data.mission,
        rationale: data.rationale,
        conversationId: conversationId || undefined,
        turnId: turnId || undefined,
        timestamp,
      });
    }

    // Persist to database
    if (!conversationId) {
      console.error(
        `[MessageEventService] Cannot save delegation event: conversationId is null (agent: ${data.agentName})`
      );
      return;
    }

    try {
      const db = getDb();
      const messageId = `delegation-${data.agentId}`;

      // Check if already saved
      const existing = db.messages.findById(messageId);
      if (existing) {
        return;
      }

      db.messages.create({
        id: messageId,
        conversationId,
        channel: channelId,
        role: 'system',
        content: '',
        metadata: {
          type: 'delegation',
          agentId: data.agentId,
          agentName: data.agentName,
          agentEmoji: data.agentEmoji,
          agentType: data.agentType,
          parentAgentId: data.parentAgentId,
          parentAgentName: data.parentAgentName,
          mission: data.mission,
          rationale: data.rationale,
        },
        createdAt: timestamp,
        turnId,
      });
    } catch (error) {
      console.error(`[MessageEventService] Failed to save delegation event:`, error);
    }
  }

  /**
   * Emit a task_run event - broadcasts to UI AND persists to database.
   * Returns the turnId (messageId) for this task run, which should be used
   * for all subsequent messages in this turn.
   */
  emitTaskRunEvent(
    data: TaskRunEventData,
    conversationId: string | null,
    channelId: string
  ): string {
    const timestamp = new Date().toISOString();
    const messageId = `task-run-${data.taskId}`;

    // The task_run event is the start of a turn - its ID is the turnId
    const turnId = messageId;

    // Broadcast to UI
    if (this.webChannel && typeof this.webChannel.broadcast === 'function') {
      this.webChannel.broadcast({
        type: 'task_run',
        taskId: data.taskId,
        taskName: data.taskName,
        taskDescription: data.taskDescription,
        conversationId: conversationId || undefined,
        turnId,
        timestamp,
      });
    }

    // Persist to database
    if (!conversationId) {
      console.error(
        `[MessageEventService] Cannot save task_run event: conversationId is null (task: ${data.taskName})`
      );
      return turnId;
    }

    try {
      const db = getDb();

      // Check if already saved (avoid duplicates)
      const existing = db.messages.findById(messageId);
      if (existing) {
        return turnId;
      }

      db.messages.create({
        id: messageId,
        conversationId,
        channel: channelId,
        role: 'system',
        content: '',
        metadata: {
          type: 'task_run',
          taskId: data.taskId,
          taskName: data.taskName,
          taskDescription: data.taskDescription,
        },
        createdAt: timestamp,
        turnId, // task_run's turnId is itself
      });
    } catch (error) {
      console.error(`[MessageEventService] Failed to save task_run event:`, error);
    }

    return turnId;
  }

  /**
   * Emit an error event - broadcasts to UI AND persists to database.
   */
  emitErrorEvent(
    data: ErrorEventData,
    conversationId: string | null,
    channelId: string
  ): void {
    const timestamp = new Date().toISOString();
    const messageId = `error-${uuid()}`;

    // Broadcast to UI
    if (this.webChannel && typeof this.webChannel.broadcast === 'function') {
      this.webChannel.broadcast({
        type: 'error',
        id: messageId,
        error: data.error,
        details: data.details,
        conversationId: conversationId || undefined,
        timestamp,
      });
    }

    // Persist to database
    if (!conversationId) {
      console.error(
        `[MessageEventService] Cannot save error event: conversationId is null (error: ${data.error})`
      );
      return;
    }

    try {
      const db = getDb();

      db.messages.create({
        id: messageId,
        conversationId,
        channel: channelId,
        role: 'system',
        content: '',
        metadata: {
          type: 'error',
          error: data.error,
          details: data.details,
        },
        createdAt: timestamp,
      });
    } catch (error) {
      console.error(`[MessageEventService] Failed to save error event:`, error);
    }
  }
}

// Singleton instance for global access
let globalMessageEventService: MessageEventService | null = null;

export function getMessageEventService(): MessageEventService {
  if (!globalMessageEventService) {
    globalMessageEventService = new MessageEventService();
  }
  return globalMessageEventService;
}

export function setMessageEventServiceChannel(channel: WebChannel): void {
  getMessageEventService().setWebChannel(channel);
}
