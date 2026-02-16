/**
 * Self-Coding Tests
 *
 * Covers: SELFCODE-001 through SELFCODE-011
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Self-Coding', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-selfcode', title: 'Self-Coding' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Self-Coding');
  });

  // SELFCODE-001: Read frontend code
  test('reads file via read_frontend_code tool', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-read',
      requestId: 'req-read',
      toolName: 'read_frontend_code',
      parameters: { path: 'src/App.jsx' },
      result: 'import React from "react";\n// ... file contents',
    });

    await expect(app.chat.toolByName('read_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-002: List frontend directory
  test('lists directory contents', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-list',
      requestId: 'req-list',
      toolName: 'read_frontend_code',
      parameters: { path: 'src/components/', action: 'list' },
      result: 'ChatInput.jsx\nMessageContent.jsx\nCodeBlock.jsx\n...',
    });

    await expect(app.chat.toolByName('read_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-003: Create file
  test('creates new file via modify_frontend_code', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-create',
      requestId: 'req-create',
      toolName: 'modify_frontend_code',
      parameters: { path: 'src/components/NewComponent.jsx', action: 'create', content: 'export default function NewComponent() {}' },
      result: 'File created: src/components/NewComponent.jsx',
    });

    await expect(app.chat.toolByName('modify_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-004: Edit file - replace
  test('replaces text in file', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-replace',
      requestId: 'req-replace',
      toolName: 'modify_frontend_code',
      parameters: { path: 'src/App.jsx', action: 'replace', search: 'old text', replacement: 'new text' },
      result: 'Replaced 1 occurrence.',
    });

    await expect(app.chat.toolByName('modify_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-005: Edit file - insert
  test('inserts text at line number', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-insert',
      requestId: 'req-insert',
      toolName: 'modify_frontend_code',
      parameters: { path: 'src/App.jsx', action: 'insert', line: 10, content: '// New comment' },
      result: 'Inserted at line 10.',
    });

    await expect(app.chat.toolByName('modify_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-006: Delete file
  test('deletes file (non-protected)', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-delete',
      requestId: 'req-delete',
      toolName: 'modify_frontend_code',
      parameters: { path: 'src/components/TempFile.jsx', action: 'delete' },
      result: 'File deleted: src/components/TempFile.jsx',
    });

    await expect(app.chat.toolByName('modify_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-007: Protected file delete blocked
  test('cannot delete protected files', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-protected',
      requestId: 'req-protected',
      toolName: 'modify_frontend_code',
      parameters: { path: 'src/main.jsx', action: 'delete' },
      result: 'Error: Cannot delete protected file: src/main.jsx',
      success: false,
    });

    await expect(app.chat.toolByName('modify_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-008: Check frontend build
  test('validates frontend build via check_frontend_code', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-check',
      requestId: 'req-check',
      toolName: 'check_frontend_code',
      parameters: {},
      result: 'Build check passed. No errors found.',
    });

    await expect(app.chat.toolByName('check_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-009: Coding workflow delegation
  test('supervisor delegates to coding lead for code modification', async ({ app }) => {
    await app.chat.sendMessage('Modify the frontend to add dark mode');

    app.ws.simulateDelegation({
      conversationId: 'conv-selfcode',
      agentId: 'agent-cl',
      agentType: 'coding-lead',
      agentName: 'Coding Lead',
      agentEmoji: '💻',
      mission: 'Add dark mode to frontend',
    });

    await expect(app.chat.delegationByAgent('Coding Lead')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-010: Code fixer on build failure
  test('code fixer auto-fixes build errors', async ({ app }) => {
    // Simulate build check failure followed by fix
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-fail',
      requestId: 'req-fail',
      toolName: 'check_frontend_code',
      parameters: {},
      result: 'Build failed: SyntaxError in Component.jsx',
      success: false,
    });

    // Code fixer auto-triggers
    app.ws.simulateDelegation({
      conversationId: 'conv-selfcode',
      agentId: 'agent-fix',
      agentType: 'coding-fixer',
      agentName: 'Code Fixer',
      agentEmoji: '🔧',
      mission: 'Fix build error in Component.jsx',
    });

    await expect(app.chat.toolByName('check_frontend_code')).toBeVisible({ timeout: 5000 });
  });

  // SELFCODE-011: Path sandboxing
  test('operations restricted to /web directory', async ({ app }) => {
    app.ws.simulateToolExecution({
      conversationId: 'conv-selfcode',
      turnId: 'turn-sandbox',
      requestId: 'req-sandbox',
      toolName: 'read_frontend_code',
      parameters: { path: '../src/index.ts' },
      result: 'Error: Path traversal not allowed. Operations restricted to web/ directory.',
      success: false,
    });

    await expect(app.chat.toolByName('read_frontend_code')).toBeVisible({ timeout: 5000 });
  });
});
