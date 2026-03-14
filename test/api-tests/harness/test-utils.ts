/**
 * Shared test utilities for API integration tests
 *
 * Provides common helper functions to reduce duplication across test files.
 */

import { getDb } from '../../src/db/index.js';

// ---------------------------------------------------------------------------
// Database Seeding Helpers
// ---------------------------------------------------------------------------

export interface SeedConversationOptions {
  id: string;
  title: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a conversation directly in the database for testing.
 */
export function seedConversation(options: SeedConversationOptions): void {
  const db = getDb();
  db.conversations.create({
    id: options.id,
    title: options.title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    metadata: options.metadata,
  });
}

export interface SeedMessageOptions {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
  /** Optional timestamp override (defaults to incremental timestamps) */
  createdAt?: string;
}

/**
 * Create a message directly in the database for testing.
 */
export function seedMessage(options: SeedMessageOptions): void {
  const db = getDb();
  db.messages.create({
    id: options.id,
    conversationId: options.conversationId,
    role: options.role,
    content: options.content,
    metadata: options.metadata || {},
    createdAt: options.createdAt || new Date().toISOString(),
  });
}

/**
 * Seed a conversation with N messages for pagination testing.
 * Messages are created with incrementing timestamps to ensure stable ordering.
 */
export function seedConversationWithMessages(
  conversationId: string,
  messageCount: number,
  options?: {
    conversationTitle?: string;
    messagePrefix?: string;
  }
): void {
  const title = options?.conversationTitle || `Seeded ${conversationId}`;
  const messagePrefix = options?.messagePrefix || 'Message';

  // Create the conversation
  seedConversation({ id: conversationId, title });

  // Create messages with incremental timestamps
  for (let i = 0; i < messageCount; i++) {
    const timestamp = new Date(Date.now() + i * 1000).toISOString();
    seedMessage({
      id: `msg-${conversationId}-${i}`,
      conversationId,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `${messagePrefix} ${i}`,
      createdAt: timestamp,
    });
  }
}

// ---------------------------------------------------------------------------
// Common Assertions
// ---------------------------------------------------------------------------

/**
 * Assert that a response has the expected status and valid JSON body.
 */
export function expectValidResponse<T>(
  response: { status: number; body: T },
  expectedStatus: number
): asserts response is { status: number; body: T } {
  if (response.status !== expectedStatus) {
    throw new Error(
      `Expected status ${expectedStatus} but got ${response.status}: ${JSON.stringify(response.body)}`
    );
  }
}

/**
 * Wait for an async operation to complete (e.g., message processing).
 */
export async function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
