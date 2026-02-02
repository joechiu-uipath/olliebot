import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSlash: () => void;
  isDisabled: boolean;
  isFocused: boolean;
  placeholder: string;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  onSlash,
  isDisabled,
  isFocused,
  placeholder,
}: InputAreaProps) {
  const [cursorPosition, setCursorPosition] = useState(0);

  useInput((input, key) => {
    if (!isFocused) return;

    // Enter to submit (only if not disabled)
    if (key.return) {
      if (value.trim() && !isDisabled) {
        onSubmit();
        setCursorPosition(0);
      }
      return;
    }

    // Backspace
    if (key.backspace) {
      if (cursorPosition > 0) {
        onChange(value.slice(0, cursorPosition - 1) + value.slice(cursorPosition));
        setCursorPosition(prev => prev - 1);
      }
      return;
    }

    // Delete
    if (key.delete) {
      if (cursorPosition < value.length) {
        onChange(value.slice(0, cursorPosition) + value.slice(cursorPosition + 1));
      }
      return;
    }

    // Arrow keys for cursor movement
    if (key.leftArrow) {
      setCursorPosition(prev => Math.max(0, prev - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorPosition(prev => Math.min(value.length, prev + 1));
      return;
    }

    // Home/End
    if (key.ctrl && input === 'a') {
      setCursorPosition(0);
      return;
    }
    if (key.ctrl && input === 'e') {
      setCursorPosition(value.length);
      return;
    }

    // Slash at start triggers command menu
    if (input === '/' && value === '') {
      onSlash();
      return;
    }

    // Regular character input
    if (input && !key.ctrl && !key.meta) {
      onChange(value.slice(0, cursorPosition) + input + value.slice(cursorPosition));
      setCursorPosition(prev => prev + input.length);
    }
  }, { isActive: isFocused });

  // Render input with cursor
  const isPlaceholder = !value;

  // Simple cursor rendering
  const beforeCursor = value.slice(0, cursorPosition);
  const atCursor = value[cursorPosition] || ' ';
  const afterCursor = value.slice(cursorPosition + 1);

  return (
    <Box
      borderStyle="single"
      borderColor={isFocused ? 'cyan' : 'gray'}
      paddingX={1}
    >
      <Text color="cyan">&gt; </Text>
      {isFocused ? (
        <>
          <Text color="white">{beforeCursor}</Text>
          <Text backgroundColor="cyan" color="black">{atCursor}</Text>
          <Text color="white">{afterCursor}</Text>
          {isPlaceholder && <Text color="gray"> {placeholder}</Text>}
        </>
      ) : isPlaceholder ? (
        <Text color="gray">{placeholder}</Text>
      ) : (
        <Text color="white">{value}</Text>
      )}
    </Box>
  );
}
