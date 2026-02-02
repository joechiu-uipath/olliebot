import React from 'react';
import { Box, Text } from 'ink';
import type { Conversation } from '../types.js';

interface HeaderProps {
  isConnected: boolean;
  currentConversation?: Conversation;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  focusArea?: 'sidebar' | 'chat' | 'input';
}

export function Header({ isConnected, currentConversation, focusArea }: HeaderProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="cyan"
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text color="cyan" bold>
          OllieBot
        </Text>
        <Text color="gray"> | </Text>
        <Text color="white">
          {currentConversation?.title || 'New Chat'}
        </Text>
      </Box>
      <Box>
        <Text color="gray">[Tab: </Text>
        <Text color={focusArea === 'sidebar' ? 'cyan' : 'gray'}>sidebar</Text>
        <Text color="gray">/</Text>
        <Text color={focusArea === 'chat' ? 'cyan' : 'gray'}>chat</Text>
        <Text color="gray">/</Text>
        <Text color={focusArea === 'input' ? 'cyan' : 'gray'}>input</Text>
        <Text color="gray">] </Text>
        <Text color={isConnected ? 'green' : 'red'}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </Text>
      </Box>
    </Box>
  );
}
