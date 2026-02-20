/**
 * Message Chunker
 *
 * Converts chat messages into DocumentChunk[] for embedding.
 * Most messages are short (single chunk). Long assistant responses
 * may be split into multiple chunks using the existing chunkText() logic
 * from the RAG document-loader.
 */

import { chunkText } from '../rag-projects/document-loader.js';
import type { DocumentChunk } from '../rag-projects/types.js';
import { MESSAGE_CHUNK_SIZE, MESSAGE_CHUNK_OVERLAP } from '../constants.js';

/** Minimal message shape needed for chunking. */
export interface MessageForChunking {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

/**
 * Convert a message into document chunks for embedding.
 * Short messages (under chunk size) become a single chunk.
 * Long messages are split with overlap, preserving paragraph boundaries.
 *
 * The `documentPath` field is set to the conversationId, which enables
 * per-conversation deletion via LanceStore.deleteByDocumentFromTable().
 */
export function chunkMessage(message: MessageForChunking): DocumentChunk[] {
  const chunks = chunkText(message.content, {
    chunkSize: MESSAGE_CHUNK_SIZE,
    chunkOverlap: MESSAGE_CHUNK_OVERLAP,
    preserveParagraphs: true,
  });

  return chunks.map((text, index) => ({
    text,
    documentPath: message.conversationId,
    chunkIndex: index,
    contentType: 'text' as const,
    metadata: {
      messageId: message.id,
      conversationId: message.conversationId,
      role: message.role,
      createdAt: message.createdAt,
      totalChunks: chunks.length,
    },
  }));
}
