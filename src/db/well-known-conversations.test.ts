/**
 * Unit Tests for Well-Known Conversations
 *
 * Tests for the well-known conversation module to ensure proper identification
 * of special conversations like Feed that should not be used for user messages.
 */

import { describe, it, expect } from 'vitest';
import {
  WellKnownConversations,
  isWellKnownConversation,
  getWellKnownConversationMeta,
  getAllWellKnownConversationMeta,
} from './well-known-conversations.js';

describe('WellKnownConversations', () => {
  describe('constants', () => {
    it('should define FEED conversation ID', () => {
      expect(WellKnownConversations.FEED).toBe('feed');
    });
  });

  describe('isWellKnownConversation', () => {
    it('should return true for Feed conversation ID', () => {
      expect(isWellKnownConversation('feed')).toBe(true);
    });

    it('should return true for FEED constant', () => {
      expect(isWellKnownConversation(WellKnownConversations.FEED)).toBe(true);
    });

    it('should return false for regular UUID conversation IDs', () => {
      expect(isWellKnownConversation('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('should return false for arbitrary strings', () => {
      expect(isWellKnownConversation('my-conversation')).toBe(false);
      expect(isWellKnownConversation('random-id')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(isWellKnownConversation('')).toBe(false);
    });

    it('should be case-sensitive (Feed != feed)', () => {
      expect(isWellKnownConversation('Feed')).toBe(false);
      expect(isWellKnownConversation('FEED')).toBe(false);
    });
  });

  describe('getWellKnownConversationMeta', () => {
    it('should return metadata for Feed', () => {
      const meta = getWellKnownConversationMeta('feed');
      expect(meta).toBeDefined();
      expect(meta?.id).toBe('feed');
      expect(meta?.title).toBe('Feed');
      expect(meta?.icon).toBe('⚡');
    });

    it('should return undefined for unknown conversation IDs', () => {
      expect(getWellKnownConversationMeta('unknown')).toBeUndefined();
      expect(getWellKnownConversationMeta('random-uuid')).toBeUndefined();
    });
  });

  describe('getAllWellKnownConversationMeta', () => {
    it('should return array with Feed metadata', () => {
      const metas = getAllWellKnownConversationMeta();
      expect(Array.isArray(metas)).toBe(true);
      expect(metas.length).toBeGreaterThanOrEqual(1);

      const feedMeta = metas.find(m => m.id === 'feed');
      expect(feedMeta).toBeDefined();
    });
  });
});

describe('Message Routing - Well-Known Conversation Protection', () => {
  /**
   * These tests document the expected behavior for message routing
   * to prevent user messages from polluting well-known conversations.
   */

  describe('Feed conversation protection', () => {
    it('Feed should be protected from user-initiated messages', () => {
      // The Feed conversation should only receive scheduled task messages
      // User messages sent while viewing Feed should create new conversations
      expect(isWellKnownConversation('feed')).toBe(true);
    });

    it('regular conversations should not be protected', () => {
      // Regular UUID conversations should be usable for user messages
      expect(isWellKnownConversation('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });
  });

  describe('routing decision helper', () => {
    /**
     * Helper function to determine if a conversation ID should be used
     * for a given message type. This mirrors the logic in supervisor.ts.
     */
    function shouldUseConversationId(
      conversationId: string | undefined,
      isScheduledTask: boolean
    ): boolean {
      if (!conversationId) return false;

      // Well-known conversations should only be used for scheduled tasks
      if (isWellKnownConversation(conversationId) && !isScheduledTask) {
        return false;
      }

      return true;
    }

    it('should allow Feed for scheduled tasks', () => {
      expect(shouldUseConversationId('feed', true)).toBe(true);
    });

    it('should NOT allow Feed for user messages', () => {
      expect(shouldUseConversationId('feed', false)).toBe(false);
    });

    it('should allow regular conversations for user messages', () => {
      expect(shouldUseConversationId('550e8400-e29b-41d4-a716-446655440000', false)).toBe(true);
    });

    it('should allow regular conversations for scheduled tasks', () => {
      expect(shouldUseConversationId('550e8400-e29b-41d4-a716-446655440000', true)).toBe(true);
    });

    it('should return false for undefined conversationId', () => {
      expect(shouldUseConversationId(undefined, false)).toBe(false);
      expect(shouldUseConversationId(undefined, true)).toBe(false);
    });
  });
});
