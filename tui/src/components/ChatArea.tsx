import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import type { Message } from '../types.js';

interface ChatAreaProps {
  messages: Message[];
  width: number;
  height: number;
  isFocused: boolean;
}

export function ChatArea({ messages, width, height, isFocused }: ChatAreaProps) {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const prevMessageCountRef = useRef(0);

  // Render all messages to lines FIRST
  const lines: Array<{ text: string; color?: string; bold?: boolean; dim?: boolean }> = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      lines.push({ text: '', color: 'white' }); // Empty line before
      lines.push({ text: ' You:', color: 'cyan', bold: true });
      wrapText(msg.content, width - 6).forEach(line => {
        lines.push({ text: `  ${line}`, color: 'white' });
      });
    } else if (msg.role === 'assistant') {
      lines.push({ text: '', color: 'white' }); // Empty line before
      const agentLabel = msg.agentName || 'Unknown';
      lines.push({ text: `${agentLabel}:`, color: 'magenta', bold: true });

      // Simple markdown rendering
      const rendered = renderMarkdown(msg.content, width - 6);
      rendered.forEach(line => {
        lines.push({ text: `  ${line.text}`, color: line.color, bold: line.bold, dim: line.dim });
      });

      if (msg.isStreaming) {
        lines.push({ text: '  [...]', color: 'yellow' });
      }
    } else if (msg.role === 'tool') {
      const statusIcon = msg.status === 'running' ? '[...]' :
                        msg.status === 'completed' ? '[OK]' : '[ERR]';
      const sourceIcon = msg.source === 'mcp' ? '[MCP]' : msg.source === 'skill' ? '[SKL]' : '[NAT]';
      const duration = msg.durationMs !== undefined ? ` (${msg.durationMs}ms)` : '';

      const isExpanded = expandedTools.has(msg.id);
      const expandIcon = isExpanded ? 'v' : '>';

      lines.push({
        text: `  ${expandIcon} ${sourceIcon} ${statusIcon} ${msg.toolName}${duration}`,
        color: msg.status === 'failed' ? 'red' : 'gray',
        dim: true
      });

      if (msg.status === 'running' && msg.progress) {
        const rawBarWidth = Math.min(20, width - 12);
        const barWidth = Math.max(0, rawBarWidth);
        const pct = msg.progress.total ? Math.min(1, msg.progress.current / msg.progress.total) : 0;
        const filled = Math.round(pct * barWidth);
        const empty = Math.max(0, barWidth - filled);
        const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
        const pctLabel = msg.progress.total ? ` ${Math.round(pct * 100)}%` : '';
        const progressMsg = msg.progress.message || '';
        const rawMaxMsgLen = width - barWidth - 14;
        const maxMsgLen = Math.max(1, rawMaxMsgLen);
        let truncMsg = progressMsg;
        if (progressMsg.length > maxMsgLen) {
          const sliceLen = Math.max(0, maxMsgLen - 3);
          truncMsg = (sliceLen > 0 ? progressMsg.slice(0, sliceLen) : '') + '...';
        }
        lines.push({
          text: `    ${bar}${pctLabel} ${truncMsg}`,
          color: 'blue',
          dim: true
        });
      }

      if (isExpanded && msg.parameters) {
        lines.push({ text: '    Parameters:', color: 'gray', dim: true });
        const paramStr = JSON.stringify(msg.parameters, null, 2);
        paramStr.split('\n').forEach(line => {
          lines.push({ text: `      ${line}`, color: 'gray', dim: true });
        });
      }

      if (isExpanded && msg.result) {
        lines.push({ text: '    Result:', color: 'gray', dim: true });
        const resultStr = typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2);
        resultStr.split('\n').slice(0, 10).forEach(line => {
          const truncated = line.length > width - 10 ? line.slice(0, width - 13) + '...' : line;
          lines.push({ text: `      ${truncated}`, color: 'gray', dim: true });
        });
      }

      if (isExpanded && msg.error) {
        lines.push({ text: `    Error: ${msg.error}`, color: 'red', dim: true });
      }
    } else if (msg.role === 'delegation') {
      lines.push({
        text: `  -> ${msg.agentName} - ${msg.mission}`,
        color: 'blue',
        dim: true
      });
    } else if (msg.role === 'task_run') {
      lines.push({
        text: `  [TASK] Running: ${msg.taskName}`,
        color: 'yellow',
        dim: true
      });
    }
  }

  // Calculate scroll bounds based on ACTUAL rendered lines
  const visibleHeight = height - 2;
  const maxScroll = Math.max(0, lines.length - visibleHeight);

  // Check if last message is streaming
  const lastMessage = messages[messages.length - 1];
  const isStreaming = lastMessage?.isStreaming ?? false;

  // Auto-scroll to bottom when NEW messages arrive OR when streaming
  useEffect(() => {
    const shouldAutoScroll =
      messages.length > prevMessageCountRef.current || // New message
      isStreaming; // Currently streaming

    if (shouldAutoScroll) {
      setScrollOffset(maxScroll);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, maxScroll, isStreaming, lines.length]);

  // Handle keyboard input when focused
  useInput((input, key) => {
    if (!isFocused) return;

    if (key.upArrow || (input === 'k')) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.downArrow || (input === 'j')) {
      setScrollOffset(prev => Math.min(maxScroll, prev + 1));
    } else if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - (height - 4)));
    } else if (key.pageDown) {
      setScrollOffset(prev => Math.min(maxScroll, prev + (height - 4)));
    }
  }, { isActive: isFocused });

  // Handle empty state
  if (lines.length === 0) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={height}
        borderStyle="single"
        borderColor={isFocused ? 'cyan' : 'gray'}
        justifyContent="center"
        alignItems="center"
      >
        <Text color="gray">Welcome to OllieBot</Text>
        <Text color="gray">Type a message to start chatting</Text>
      </Box>
    );
  }

  // Get visible slice of lines
  const visibleLines = lines.slice(scrollOffset, scrollOffset + visibleHeight);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="single"
      borderColor={isFocused ? 'cyan' : 'gray'}
      overflow="hidden"
    >
      {visibleLines.map((line, index) => (
        <Text
          key={index}
          color={line.color}
          bold={line.bold}
          dimColor={line.dim}
        >
          {line.text || ' '}
        </Text>
      ))}

      {/* Scroll indicator */}
      {scrollOffset > 0 && (
        <Box position="absolute" marginLeft={width - 8}>
          <Text color="gray"> {scrollOffset}</Text>
        </Box>
      )}
    </Box>
  );
}

// Helper to wrap text to width
function wrapText(text: string, width: number): string[] {
  if (!text) return [''];
  const lines: string[] = [];
  const paragraphs = text.split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.length <= width) {
      lines.push(paragraph);
    } else {
      let remaining = paragraph;
      while (remaining.length > 0) {
        if (remaining.length <= width) {
          lines.push(remaining);
          break;
        }
        // Find last space within width
        let breakPoint = remaining.lastIndexOf(' ', width);
        if (breakPoint === -1) breakPoint = width;
        lines.push(remaining.slice(0, breakPoint));
        remaining = remaining.slice(breakPoint + 1);
      }
    }
  }

  return lines;
}

// Simple markdown renderer
function renderMarkdown(text: string, width: number): Array<{ text: string; color?: string; bold?: boolean; dim?: boolean }> {
  if (!text) return [];
  const lines: Array<{ text: string; color?: string; bold?: boolean; dim?: boolean }> = [];
  const paragraphs = text.split('\n');

  let inCodeBlock = false;
  let codeLanguage = '';

  for (const para of paragraphs) {
    // Code block handling
    if (para.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeLanguage = para.slice(3).trim();
        lines.push({ text: `[${codeLanguage || 'code'}]`, color: 'gray', dim: true });
      } else {
        inCodeBlock = false;
        codeLanguage = '';
      }
      continue;
    }

    if (inCodeBlock) {
      // Code content - show with different color
      wrapText(para, width).forEach(line => {
        lines.push({ text: line, color: 'green' });
      });
      continue;
    }

    // Headers
    if (para.startsWith('### ')) {
      lines.push({ text: para.slice(4), color: 'yellow', bold: true });
      continue;
    }
    if (para.startsWith('## ')) {
      lines.push({ text: para.slice(3), color: 'yellow', bold: true });
      continue;
    }
    if (para.startsWith('# ')) {
      lines.push({ text: para.slice(2), color: 'yellow', bold: true });
      continue;
    }

    // List items
    if (para.startsWith('- ') || para.startsWith('* ')) {
      wrapText(` ${para}`, width).forEach(line => {
        lines.push({ text: line, color: 'white' });
      });
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(para)) {
      wrapText(` ${para}`, width).forEach(line => {
        lines.push({ text: line, color: 'white' });
      });
      continue;
    }

    // Bold text (simple replacement)
    let processed = para
      .replace(/\*\*(.*?)\*\*/g, (_, content) => chalk.bold(content))
      .replace(/__(.*?)__/g, (_, content) => chalk.bold(content));

    // Inline code
    processed = processed.replace(/`([^`]+)`/g, (_, content) => chalk.green(content));

    // Normal paragraph
    wrapText(processed, width).forEach(line => {
      lines.push({ text: line, color: 'white' });
    });
  }

  return lines;
}
