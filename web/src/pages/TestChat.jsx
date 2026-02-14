/**
 * TestChat — standalone test page for AgentChat component.
 *
 * This page renders AgentChat in standalone mode (using its own WebSocket)
 * for testing and development purposes.
 *
 * Usage: Navigate to /test-chat?conversationId=<id>
 * Or just /test-chat to create a new conversation
 */

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AgentChat } from '../components/chat';
import '../components/chat/styles.css';

export default function TestChat() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversationId, setConversationId] = useState(null);
  const [error, setError] = useState(null);

  // Get conversationId from URL or create a new one
  useEffect(() => {
    const urlConversationId = searchParams.get('conversationId');

    if (urlConversationId) {
      setConversationId(urlConversationId);
    } else {
      // Create a new conversation
      fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'AgentChat Test' }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to create conversation');
          return res.json();
        })
        .then((data) => {
          const newId = data.id;
          setConversationId(newId);
          setSearchParams({ conversationId: newId });
        })
        .catch((err) => {
          console.error('Failed to create conversation:', err);
          setError(err.message);
        });
    }
  }, [searchParams, setSearchParams]);

  if (error) {
    return (
      <div className="test-chat-page">
        <div className="test-chat-error">
          <h2>Error</h2>
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  if (!conversationId) {
    return (
      <div className="test-chat-page">
        <div className="test-chat-loading">
          <span className="loading-spinner" />
          Creating conversation...
        </div>
      </div>
    );
  }

  return (
    <div className="test-chat-page">
      <header className="test-chat-header">
        <h1>AgentChat Test Page</h1>
        <div className="test-chat-info">
          <span>Conversation: {conversationId}</span>
          <button
            onClick={() => {
              setSearchParams({});
              setConversationId(null);
            }}
          >
            New Conversation
          </button>
        </div>
      </header>

      <main className="test-chat-main">
        <AgentChat conversationId={conversationId} />
      </main>
    </div>
  );
}
