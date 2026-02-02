import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Conversation, ScheduledTask, ToolsData, McpServer, Skill } from '../types.js';

interface SidebarProps {
  width: number;
  height: number;
  conversations: Conversation[];
  currentConversationId: string | null;
  tasks: ScheduledTask[];
  tools: ToolsData;
  mcpServers: McpServer[];
  skills: Skill[];
  expandedAccordions: Record<string, boolean>;
  onToggleAccordion: (key: string) => void;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onRunTask: (taskId: string) => void;
  isFocused: boolean;
}

// Simple truncate function
function truncateToWidth(str: string, maxWidth: number): string {
  if (str.length > maxWidth) {
    return str.slice(0, maxWidth - 3) + '...';
  }
  return str;
}

export function Sidebar({
  width,
  height,
  conversations,
  currentConversationId,
  tasks,
  tools,
  mcpServers,
  skills,
  expandedAccordions,
  onToggleAccordion,
  onSelectConversation,
  onNewConversation,
  onRunTask,
  isFocused,
}: SidebarProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  // Local state for sub-accordions (tool categories, MCP servers, etc.)
  const [expandedSubs, setExpandedSubs] = useState<Record<string, boolean>>({});

  const toggleSub = (id: string) => {
    setExpandedSubs(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Build flat list of all items for navigation
  type ItemType = 'header' | 'subheader' | 'conversation' | 'task' | 'tool-item' | 'mcp' | 'mcp-tool' | 'skill' | 'new';
  const items: Array<{ type: ItemType; id: string; label: string; accordion?: string; description?: string }> = [];

  // New chat button
  items.push({ type: 'new', id: 'new', label: '+ New Chat' });

  // Conversations accordion
  items.push({ type: 'header', id: 'conversations', label: `${expandedAccordions.conversations ? '▼' : '▶'} Conversations (${conversations.length})` });
  if (expandedAccordions.conversations) {
    conversations.forEach(conv => {
      const marker = conv.id === currentConversationId ? '*' : ' ';
      items.push({ type: 'conversation', id: conv.id, label: `  ${marker} ${conv.title}`, accordion: 'conversations' });
    });
  }

  // Tasks accordion
  items.push({ type: 'header', id: 'tasks', label: `${expandedAccordions.tasks ? '▼' : '▶'} Tasks (${tasks.length})` });
  if (expandedAccordions.tasks) {
    tasks.forEach(task => {
      const statusMarker = task.status === 'active' ? '[ON]' : '[--]';
      items.push({ type: 'task', id: task.id, label: `  ${statusMarker} ${task.name}`, accordion: 'tasks', description: task.description });
    });
  }

  // Tools accordion
  const toolCount = tools.builtin.length + tools.user.length + Object.values(tools.mcp).reduce((sum, arr) => sum + arr.length, 0);
  items.push({ type: 'header', id: 'tools', label: `${expandedAccordions.tools ? '▼' : '▶'} Tools (${toolCount})` });
  if (expandedAccordions.tools) {
    // Builtin tools
    if (tools.builtin.length > 0) {
      const builtinExpanded = expandedSubs['tools-builtin'];
      items.push({ type: 'subheader', id: 'tools-builtin', label: `  ${builtinExpanded ? '▼' : '▶'} Builtin (${tools.builtin.length})`, accordion: 'tools' });
      if (builtinExpanded) {
        tools.builtin.forEach(tool => {
          items.push({ type: 'tool-item', id: `tool-builtin-${tool.name}`, label: `    ${tool.name}`, accordion: 'tools', description: tool.description });
        });
      }
    }
    // User tools
    if (tools.user.length > 0) {
      const userExpanded = expandedSubs['tools-user'];
      items.push({ type: 'subheader', id: 'tools-user', label: `  ${userExpanded ? '▼' : '▶'} User (${tools.user.length})`, accordion: 'tools' });
      if (userExpanded) {
        tools.user.forEach(tool => {
          items.push({ type: 'tool-item', id: `tool-user-${tool.name}`, label: `    ${tool.name}`, accordion: 'tools', description: tool.description });
        });
      }
    }
    // MCP tools (under Tools section)
    Object.entries(tools.mcp).forEach(([server, serverTools]) => {
      const mcpExpanded = expandedSubs[`tools-mcp-${server}`];
      items.push({ type: 'subheader', id: `tools-mcp-${server}`, label: `  ${mcpExpanded ? '▼' : '▶'} MCP: ${server} (${serverTools.length})`, accordion: 'tools' });
      if (mcpExpanded) {
        serverTools.forEach(tool => {
          items.push({ type: 'tool-item', id: `tool-mcp-${server}-${tool.name}`, label: `    ${tool.name}`, accordion: 'tools', description: tool.description });
        });
      }
    });
  }

  // MCPs accordion (server status, expandable to show their tools)
  items.push({ type: 'header', id: 'mcps', label: `${expandedAccordions.mcps ? '▼' : '▶'} MCPs (${mcpServers.length})` });
  if (expandedAccordions.mcps) {
    mcpServers.forEach(mcp => {
      const statusMarker = mcp.enabled ? '[ON]' : '[--]';
      const mcpExpanded = expandedSubs[`mcp-${mcp.id}`];
      items.push({
        type: 'subheader',
        id: `mcp-${mcp.id}`,
        label: `  ${mcpExpanded ? '▼' : '▶'} ${statusMarker} ${mcp.name} (${mcp.toolCount})`,
        accordion: 'mcps'
      });
      // Show tools for this MCP if expanded
      if (mcpExpanded && tools.mcp[mcp.name]) {
        tools.mcp[mcp.name].forEach(tool => {
          items.push({
            type: 'mcp-tool',
            id: `mcp-tool-${mcp.id}-${tool.name}`,
            label: `    ${tool.name}`,
            accordion: 'mcps',
            description: tool.description
          });
        });
      }
    });
  }

  // Skills accordion
  items.push({ type: 'header', id: 'skills', label: `${expandedAccordions.skills ? '▼' : '▶'} Skills (${skills.length})` });
  if (expandedAccordions.skills) {
    skills.forEach(skill => {
      items.push({ type: 'skill', id: skill.id, label: `  ${skill.name}`, accordion: 'skills', description: skill.description });
    });
  }

  // Handle keyboard input when focused
  useInput((input, key) => {
    if (!isFocused) return;

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      // Adjust scroll if needed
      if (selectedIndex - 1 < scrollOffset) {
        setScrollOffset(Math.max(0, scrollOffset - 1));
      }
    } else if (key.downArrow) {
      setSelectedIndex(prev => Math.min(items.length - 1, prev + 1));
      // Adjust scroll if needed
      const visibleHeight = height - 2;
      if (selectedIndex + 1 >= scrollOffset + visibleHeight) {
        setScrollOffset(prev => prev + 1);
      }
    } else if (key.return) {
      const item = items[selectedIndex];
      if (item.type === 'new') {
        onNewConversation();
      } else if (item.type === 'header') {
        onToggleAccordion(item.id);
      } else if (item.type === 'subheader') {
        toggleSub(item.id);
      } else if (item.type === 'conversation') {
        onSelectConversation(item.id);
      } else if (item.type === 'task') {
        // Run the task when Enter is pressed
        onRunTask(item.id);
      }
    }
  }, { isActive: isFocused });

  // Calculate visible items
  const visibleHeight = height - 2;
  const visibleItems = items.slice(scrollOffset, scrollOffset + visibleHeight);

  // Available width for label (accounting for border and padding)
  const maxLabelWidth = width - 4;

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={isFocused ? 'cyan' : 'gray'}
    >
      {visibleItems.map((item, visibleIndex) => {
        const actualIndex = scrollOffset + visibleIndex;
        const isSelected = isFocused && actualIndex === selectedIndex;

        let color: string = 'white';
        if (item.type === 'header') color = 'yellow';
        if (item.type === 'subheader') color = 'cyan';
        if (item.type === 'new') color = 'green';
        if (item.type === 'tool-item' || item.type === 'mcp-tool') color = 'gray';
        if (item.type === 'task') color = 'magenta';

        // Fit label to exact width, accounting for emoji width
        const label = truncateToWidth(item.label, maxLabelWidth);

        return (
          <Box key={item.id + '-' + visibleIndex}>
            <Text
              backgroundColor={isSelected ? 'blue' : undefined}
              color={color}
              bold={item.type === 'header' || item.type === 'subheader' || item.type === 'new'}
            >
              {label}
            </Text>
          </Box>
        );
      })}

      {/* Scroll indicators */}
      {scrollOffset > 0 && (
        <Box position="absolute" marginTop={0}>
          <Text color="gray"> ...</Text>
        </Box>
      )}
      {scrollOffset + visibleHeight < items.length && (
        <Box position="absolute" marginTop={visibleHeight - 1}>
          <Text color="gray"> ...</Text>
        </Box>
      )}
    </Box>
  );
}
