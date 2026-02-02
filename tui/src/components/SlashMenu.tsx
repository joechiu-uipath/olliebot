import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface SlashMenuProps {
  onSelect: (command: string) => void;
  onClose: () => void;
}

const commands = [
  { id: 'new', label: '/new', description: 'Start a new conversation' },
  { id: 'switch', label: '/switch', description: 'Switch to another conversation' },
  { id: 'tasks', label: '/tasks', description: 'Toggle tasks panel' },
  { id: 'tools', label: '/tools', description: 'Toggle tools panel' },
  { id: 'mcp', label: '/mcp', description: 'Toggle MCP servers panel' },
  { id: 'clear', label: '/clear', description: 'Clear current conversation' },
  { id: 'help', label: '/help', description: 'Show available commands' },
];

export function SlashMenu({ onSelect, onClose }: SlashMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filter, setFilter] = useState('');

  const filteredCommands = commands.filter(cmd =>
    cmd.label.toLowerCase().includes(filter.toLowerCase()) ||
    cmd.description.toLowerCase().includes(filter.toLowerCase())
  );

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => Math.max(0, prev - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => Math.min(filteredCommands.length - 1, prev + 1));
      return;
    }

    if (key.return) {
      if (filteredCommands[selectedIndex]) {
        onSelect(filteredCommands[selectedIndex].id);
      }
      return;
    }

    if (key.backspace) {
      setFilter(prev => prev.slice(0, -1));
      setSelectedIndex(0);
      return;
    }

    // Filter input
    if (input && !key.ctrl && !key.meta) {
      setFilter(prev => prev + input);
      setSelectedIndex(0);
    }
  });

  return (
    <Box
      position="absolute"
      marginTop={-10}
      marginLeft={5}
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text color="cyan" bold>Commands</Text>
        {filter && <Text color="gray"> (filter: {filter})</Text>}
      </Box>

      {filteredCommands.length === 0 ? (
        <Text color="gray">No matching commands</Text>
      ) : (
        filteredCommands.map((cmd, index) => (
          <Box key={cmd.id}>
            <Text
              backgroundColor={index === selectedIndex ? 'blue' : undefined}
              color={index === selectedIndex ? 'white' : 'yellow'}
              bold={index === selectedIndex}
            >
              {cmd.label}
            </Text>
            <Text color="gray"> - {cmd.description}</Text>
          </Box>
        ))
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          ↑↓ navigate | Enter select | Esc cancel
        </Text>
      </Box>
    </Box>
  );
}
