/**
 * MessageEventService - Centralized service for broadcasting AND persisting message-list events.
 *
 * This service ensures that events shown in the chat UI are always persisted to the database.
 * By combining broadcast + persistence in single methods, we prevent the bug where an event
 * is broadcast to the UI but not saved to DB (causing data loss on refresh).
 *
 * Usage:
 *   const service = new MessageEventService(webChannel);
 *   service.emitToolEvent(event, conversationId, agentInfo);
 *   service.emitDelegationEvent(...);
 *   service.emitTaskRunEvent(...);
 *   service.emitErrorEvent(...);
 */

import { v4 as uuid } from 'uuid';
import { getDb } from '../db/index.js';
import type { Channel } from '../channels/types.js';
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
  private channel: Channel | null = null;

  constructor(channel: Channel | null = null) {
    this.channel = channel;
  }

  /**
   * Set/update the channel (can be set after construction)
   */
  setChannel(channel: Channel): void {
    this.channel = channel;
  }

  /**
   * Check if a result contains media content (images, audio, etc.) that should not be truncated.
   * Detects:
   * - Data URLs (data:*;base64,) for images, audio, or any other media type
   * - Legacy audio fields (result.audio or result.output.audio)
   */
  private hasMediaContent(result: unknown): boolean {
    if (!result || typeof result !== 'object') {
      return false;
    }

    try {
      const jsonStr = JSON.stringify(result);
      // Check for any data URL (covers images, audio, video, etc.)
      if (jsonStr.includes('data:') && jsonStr.includes(';base64,')) {
        return true;
      }
    } catch {
      // If stringification fails, fall through to legacy checks
    }

    // Legacy audio detection (for backwards compatibility)
    const resultObj = result as Record<string, unknown>;
    if ('audio' in resultObj && typeof resultObj.audio === 'string') {
      return true;
    }
    if (resultObj.output && typeof resultObj.output === 'object') {
      const output = resultObj.output as Record<string, unknown>;
      if ('audio' in output && typeof output.audio === 'string') {
        return true;
      }
    }

    return false;
  }

  /**
   * Emit a tool event - broadcasts to UI AND persists to database.
   * Only persists 'tool_execution_finished' events to avoid duplicates.
   */
  emitToolEvent(
    event: ToolEvent,
    conversationId: string | null,
    agentInfo: AgentInfo,
    turnId?: string
  ): void {
    // Broadcast to UI
    if (this.channel) {
      // Progress events: broadcast immediately, no persistence needed
      if (event.type === 'tool_progress') {
        this.channel.broadcast({
          type: 'tool_progress',
          requestId: event.requestId,
          toolName: event.toolName,
          source: event.source,
          progress: event.progress,
          conversationId: conversationId || undefined,
          turnId: turnId || undefined,
          timestamp: event.timestamp.toISOString(),
          agentId: agentInfo.id,
          agentName: agentInfo.name,
          agentEmoji: agentInfo.emoji,
          agentType: agentInfo.type,
        });
        return; // Progress events are broadcast-only, not persisted
      }

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
          this.channel.broadcast({
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
          const limit = 10000;
          // For media content or small results, pass object directly
          // For large non-media results, truncate
          if (this.hasMediaContent(event.result) || fullResult.length <= limit) {
            resultForBroadcast = event.result; // Pass object directly
          } else {
            resultForBroadcast = fullResult.substring(0, limit) + '...(truncated)';
          }
        } catch {
          resultForBroadcast = String(event.result);
        }
      }

      this.channel.broadcast({
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
          // Media content gets a much higher limit (5MB) to preserve images, audio, etc.
          // Non-media content is limited to 10KB to avoid database bloat
          const limit = this.hasMediaContent(event.result) ? 5000000 : 10000;
          // For media content or small results, store object directly
          // For large non-media results, store truncated string
          if (fullResult.length <= limit) {
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
    turnId?: string
  ): void {
    const timestamp = new Date().toISOString();

    // Broadcast to UI
    if (this.channel) {
      this.channel.broadcast({
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
    conversationId: string | null
  ): string {
    const timestamp = new Date().toISOString();
    const messageId = `task-run-${data.taskId}`;

    // The task_run event is the start of a turn - its ID is the turnId
    const turnId = messageId;

    // Broadcast to UI
    if (this.channel) {
      this.channel.broadcast({
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
    conversationId: string | null
  ): void {
    const timestamp = new Date().toISOString();
    const messageId = `error-${uuid()}`;

    // Broadcast to UI
    if (this.channel) {
      this.channel.broadcast({
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

export function setMessageEventServiceChannel(channel: Channel): void {
  getMessageEventService().setChannel(channel);
}
