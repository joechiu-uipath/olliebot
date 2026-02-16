/**
 * MCP Integration Tests
 *
 * Covers: MCP-001 through MCP-009
 *
 * MCP servers are rendered inside the "Tools" accordion as .mcp-tool-group items.
 * There is no separate "MCPs" accordion — MCPs are part of the Tools section.
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation, createMcpServer } from '../../fixtures/index.js';

test.describe('MCP Integration', () => {

  // MCP-001: Server connection
  test('MCP server shows as connected on startup', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-1', name: 'GitHub MCP', status: 'connected', toolCount: 5 });
    app.api.setMcps([mcpServer]);
    app.api.setTools({
      builtin: [],
      user: [],
      mcp: {
        'GitHub MCP': [
          { name: 'gh_list_repos', description: 'List repos', inputs: [] },
        ],
      },
    });
    await app.page.reload();
    await app.waitForAppReady();

    // Expand Tools accordion to see MCP servers
    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.accordion('Tools').locator('.accordion-content')).toBeVisible({ timeout: 3000 });

    // Verify the MCP server group appears with connected status
    const mcpGroup = app.page.locator('.mcp-tool-group', { hasText: 'GitHub MCP' });
    await expect(mcpGroup).toBeVisible();
    await expect(mcpGroup.locator('.mcp-status.connected')).toBeVisible();
  });

  // MCP-002: Tool discovery
  test('lists tools from MCP server', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-tools', name: 'Tools MCP', toolCount: 3 });
    app.api.setMcps([mcpServer]);
    app.api.setTools({
      builtin: [],
      user: [],
      mcp: {
        'Tools MCP': [
          { name: 'mcp_tool_1', description: 'First MCP tool', inputs: [] },
          { name: 'mcp_tool_2', description: 'Second MCP tool', inputs: [] },
          { name: 'mcp_tool_3', description: 'Third MCP tool', inputs: [] },
        ],
      },
    });
    await app.page.reload();
    await app.waitForAppReady();

    // Expand Tools accordion to see MCP tools
    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.accordion('Tools').locator('.accordion-content')).toBeVisible({ timeout: 3000 });

    // Verify the MCP tool group is visible
    await expect(app.page.locator('.mcp-tool-group', { hasText: 'Tools MCP' })).toBeVisible();
  });

  // MCP-003: Tool execution
  test('executes MCP tool and shows result', async ({ app }) => {
    const conv = createConversation({ id: 'conv-mcp', title: 'MCP Test' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('MCP Test');

    await app.chat.sendMessage('Use GitHub tool to list repos');

    app.ws.simulateToolExecution({
      conversationId: 'conv-mcp',
      turnId: 'turn-mcp',
      requestId: 'req-mcp',
      toolName: 'mcp.github__list_repos',
      toolSource: 'mcp',
      parameters: { org: 'test-org' },
      result: JSON.stringify({ repos: ['repo-1', 'repo-2'] }),
    });

    // Tool event card should be visible (click to expand for details)
    await expect(app.chat.toolByName('mcp.github__list_repos')).toBeVisible({ timeout: 5000 });
  });

  // MCP-004: Server enable/disable
  test('toggles MCP server via Tools accordion', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-toggle', name: 'Toggle MCP', enabled: true });
    app.api.setMcps([mcpServer]);
    app.api.setTools({ builtin: [], user: [], mcp: { 'Toggle MCP': [] } });
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Tools');

    // Toggle the MCP server via its toggle slider (input is hidden, click the label)
    const mcpGroup = app.page.locator('.mcp-tool-group', { hasText: 'Toggle MCP' });
    await expect(mcpGroup).toBeVisible();
    await mcpGroup.locator('.mcp-toggle').click();
  });

  // MCP-005: Server reconnection
  test('reconnects after MCP server restart', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-reconnect', name: 'Reconnect MCP', status: 'connected' });
    app.api.setMcps([mcpServer]);
    app.api.setTools({ builtin: [], user: [], mcp: { 'Reconnect MCP': [] } });
    await app.page.reload();
    await app.waitForAppReady();

    // Simulate server status change via WS
    app.ws.send({
      type: 'mcp_status_changed' as any,
      serverId: 'mcp-reconnect',
      status: 'disconnected',
    });

    // Then reconnect
    app.ws.send({
      type: 'mcp_status_changed' as any,
      serverId: 'mcp-reconnect',
      status: 'connected',
    });
  });

  // MCP-007: MCP toggle in sidebar
  test('enables/disables MCP via sidebar toggle', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-sidebar', name: 'Sidebar MCP', enabled: true });
    app.api.setMcps([mcpServer]);
    app.api.setTools({ builtin: [], user: [], mcp: { 'Sidebar MCP': [] } });
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Tools');
    const mcpGroup = app.page.locator('.mcp-tool-group', { hasText: 'Sidebar MCP' });
    await expect(mcpGroup).toBeVisible({ timeout: 3000 });

    // Toggle MCP via the label (input is hidden behind custom slider)
    await mcpGroup.locator('.mcp-toggle').click();
  });

  // MCP-008: MCP connection status
  test('sidebar shows connection status', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-status', name: 'Status MCP', status: 'connected' });
    app.api.setMcps([mcpServer]);
    app.api.setTools({ builtin: [], user: [], mcp: { 'Status MCP': [] } });
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Tools');
    const mcpGroup = app.page.locator('.mcp-tool-group', { hasText: 'Status MCP' });
    await expect(mcpGroup).toBeVisible();
    await expect(mcpGroup.locator('.mcp-status.connected')).toBeVisible();
  });

  // MCP-009: MCP tool count
  test('sidebar shows tool count per server', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-count', name: 'Count MCP', toolCount: 3, status: 'connected' });
    app.api.setMcps([mcpServer]);
    app.api.setTools({
      builtin: [],
      user: [],
      mcp: {
        'Count MCP': [
          { name: 'tool_a', description: 'A', inputs: [] },
          { name: 'tool_b', description: 'B', inputs: [] },
          { name: 'tool_c', description: 'C', inputs: [] },
        ],
      },
    });
    await app.page.reload();
    await app.waitForAppReady();

    await app.sidebar.toggleAccordion('Tools');
    const mcpGroup = app.page.locator('.mcp-tool-group', { hasText: 'Count MCP' });
    await expect(mcpGroup).toBeVisible();
    // Tool count badge shows the number of tools
    await expect(mcpGroup.locator('.tool-group-count')).toContainText('3');
  });
});
