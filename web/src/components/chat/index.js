/**
 * AgentChat — flexible chat component for agent conversations.
 *
 * This module provides:
 * - AgentChat: Main chat component (can use external or internal WebSocket)
 * - AgentChatMessage: Individual message renderer
 * - AgentChatInput: Standalone input with attachments, voice, reasoning modes
 * - useChatMessages: Hook for message state and WebSocket handling
 * - useAgentChatWebSocket: Hook for WebSocket connection management
 * - useVoiceToText: Hook for voice-to-text using OpenAI Realtime API
 *
 * Dependencies:
 * - react-virtuoso for virtualized scrolling
 * - MessageContent, CitationPanel for message rendering
 *
 * Usage:
 *   import { AgentChat } from './components/chat';
 *
 * With app-wide WebSocket (recommended for multi-chat apps):
 *   <AgentChat
 *     conversationId={conversationId}
 *     sendMessage={appSendMessage}
 *     subscribe={appSubscribe}
 *     isConnected={appIsConnected}
 *     modelCapabilities={modelCapabilities}
 *     commandTriggers={commandTriggers}
 *     agentTemplates={agentTemplates}
 *   />
 *
 * Standalone mode (creates its own WebSocket):
 *   <AgentChat
 *     conversationId={conversationId}
 *     onConnectionChange={(connected) => console.log('connected:', connected)}
 *   />
 */

export { AgentChat, default } from './AgentChat';
export { AgentChatMessage } from './AgentChatMessage';
export { AgentChatInput } from './AgentChatInput';
export { useChatMessages } from './useChatMessages';
export { useAgentChatWebSocket } from './useAgentChatWebSocket';
export { useVoiceToText } from './useVoiceToText';
