/**
 * Helper utilities for message handling in the chat UI
 */

/**
 * Transform message data from API format to component format.
 * Pure function with no component dependencies.
 *
 * @param {Array} data - Array of messages from API
 * @returns {Array} Transformed messages for UI rendering
 */
export function transformMessages(data) {
  return data.map((msg) => {
    let role = msg.role;
    if (msg.messageType === 'task_run') role = 'task_run';
    else if (msg.messageType === 'tool_event' || msg.role === 'tool') role = 'tool';
    else if (msg.messageType === 'delegation') role = 'delegation';

    return {
      id: msg.id,
      role,
      content: msg.content,
      timestamp: msg.createdAt,
      agentName: msg.agentName || msg.delegationAgentId,
      agentEmoji: msg.agentEmoji,
      attachments: msg.attachments,
      taskId: msg.taskId,
      taskName: msg.taskName,
      taskDescription: msg.taskDescription,
      toolName: msg.toolName,
      source: msg.toolSource,
      status: msg.toolSuccess === true ? 'completed' : msg.toolSuccess === false ? 'failed' : undefined,
      durationMs: msg.toolDurationMs,
      error: msg.toolError,
      parameters: msg.toolParameters,
      result: msg.toolResult,
      files: msg.toolFiles,
      agentType: msg.agentType || msg.delegationAgentType || (msg.agentName?.includes('-') ? msg.agentName : undefined),
      mission: msg.delegationMission,
      reasoningMode: msg.reasoningMode,
      messageType: msg.messageType,
      agentCommand: msg.agentCommand,
      citations: msg.citations,
      usage: msg.usage,
    };
  });
}

/**
 * Check if an agent type should have its messages collapsed by default.
 * Uses agentTemplates data from backend.
 *
 * @param {string} agentType - The agent's type identifier
 * @param {string} agentName - The agent's display name (fallback)
 * @param {Array} agentTemplates - Agent templates from backend
 * @returns {boolean} True if agent's messages should be collapsed
 */
export function shouldCollapseByDefault(agentType, agentName, agentTemplates) {
  if (!agentTemplates || agentTemplates.length === 0) {
    return false; // No templates loaded yet
  }

  // Check by agentType first
  if (agentType) {
    const template = agentTemplates.find(t => t.type === agentType);
    if (template?.collapseResponseByDefault) {
      return true;
    }
  }

  // Fall back to matching by display name (for legacy messages without agentType)
  if (agentName) {
    const template = agentTemplates.find(t => t.name === agentName);
    if (template?.collapseResponseByDefault) {
      return true;
    }
  }

  return false;
}
