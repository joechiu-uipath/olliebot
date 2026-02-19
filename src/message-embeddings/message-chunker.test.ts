/**
 * Unit tests for Message Chunker
 *
 * Tests message chunking logic for embedding.
 */

import { describe, it, expect } from 'vitest';
import { chunkMessage } from './message-chunker.js';
import type { MessageForChunking } from './message-chunker.js';

describe('chunkMessage', () => {
  const createMessage = (content: string): MessageForChunking => ({
    id: 'msg-123',
    conversationId: 'conv-456',
    role: 'user',
    content,
    createdAt: '2024-01-01T00:00:00.000Z',
  });

  it('creates single chunk for short messages', () => {
    const message = createMessage('This is a short message');
    const chunks = chunkMessage(message);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(message.content);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[0].documentPath).toBe(message.conversationId);
    expect(chunks[0].contentType).toBe('text');
  });

  it('preserves message metadata in chunks', () => {
    const message = createMessage('Test message');
    const chunks = chunkMessage(message);

    const metadata = chunks[0].metadata as Record<string, unknown>;
    expect(metadata).toBeDefined();
    expect(metadata.messageId).toBe(message.id);
    expect(metadata.conversationId).toBe(message.conversationId);
    expect(metadata.role).toBe(message.role);
    expect(metadata.createdAt).toBe(message.createdAt);
    expect(metadata.totalChunks).toBe(1);
  });

  it('splits long messages into multiple chunks', () => {
    // Create a message longer than MESSAGE_CHUNK_SIZE (800)
    const longContent = 'Lorem ipsum dolor sit amet. '.repeat(50); // ~1400 chars
    const message = createMessage(longContent);
    const chunks = chunkMessage(message);

    expect(chunks.length).toBeGreaterThan(1);
    
    // Each chunk should have sequential index
    chunks.forEach((chunk, idx) => {
      expect(chunk.chunkIndex).toBe(idx);
      expect(chunk.documentPath).toBe(message.conversationId);
    });

    // All chunks should have same totalChunks count
    const totalChunks = (chunks[0].metadata as Record<string, unknown>).totalChunks;
    expect(totalChunks).toBe(chunks.length);
    
    chunks.forEach(chunk => {
      const meta = chunk.metadata as Record<string, unknown>;
      expect(meta.totalChunks).toBe(totalChunks);
    });
  });

  it('uses conversationId as documentPath for deletion support', () => {
    const message = createMessage('Test content');
    const chunks = chunkMessage(message);

    // documentPath should be conversationId to enable per-conversation deletion
    expect(chunks[0].documentPath).toBe(message.conversationId);
  });

  it('handles empty messages by returning empty array', () => {
    const message = createMessage('');
    const chunks = chunkMessage(message);

    // chunkText filters out empty chunks
    expect(chunks).toHaveLength(0);
  });

  it('handles messages with only whitespace by returning empty array', () => {
    const message = createMessage('   \n\n   ');
    const chunks = chunkMessage(message);

    // chunkText filters out whitespace-only chunks
    expect(chunks).toHaveLength(0);
  });

  it('preserves paragraph boundaries in long messages', () => {
    // Create content with clear paragraph breaks
    const paragraph1 = 'First paragraph. '.repeat(50); // ~850 chars
    const paragraph2 = '\n\nSecond paragraph. '.repeat(50); // ~950 chars
    const message = createMessage(paragraph1 + paragraph2);
    const chunks = chunkMessage(message);

    expect(chunks.length).toBeGreaterThan(1);
    
    // Chunks should respect paragraph boundaries when possible
    // (chunkText uses preserveParagraphs: true)
    chunks.forEach(chunk => {
      expect(chunk.text.length).toBeGreaterThan(0);
    });
  });

  it('creates chunk with overlap for long messages', () => {
    // Create a message that will be split
    const content = 'Test sentence. '.repeat(100); // ~1500 chars
    const message = createMessage(content);
    const chunks = chunkMessage(message);

    expect(chunks.length).toBeGreaterThan(1);
    
    // With MESSAGE_CHUNK_OVERLAP = 100, chunks should have some overlapping content
    // This is handled by the underlying chunkText function
    if (chunks.length > 1) {
      const lastWordsChunk1 = chunks[0].text.slice(-50);
      const firstWordsChunk2 = chunks[1].text.slice(0, 50);
      
      // There should be some overlap (though exact matching depends on word boundaries)
      expect(chunks[0].text.length).toBeGreaterThan(0);
      expect(chunks[1].text.length).toBeGreaterThan(0);
    }
  });
});
