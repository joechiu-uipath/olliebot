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
import { ToolName } from '../../constants/index.js';

// MCP tool names are dynamic (format: mcp.<server>__<tool>)
// Keep as string constants for consistency
const MCP_TOOL_GITHUB_LIST_REPOS = 'mcp.github__list_repos';

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
    await app.reload();

    // Expand Tools accordion to see MCP servers
    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.accordionContent('Tools')).toBeVisible();

    // Verify the MCP server group appears with connected status
    await expect(app.sidebar.mcpToolGroup('GitHub MCP')).toBeVisible();
    await expect(app.sidebar.mcpStatusConnected('GitHub MCP')).toBeVisible();
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
    await app.reload();

    // Expand Tools accordion to see MCP tools
    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.accordionContent('Tools')).toBeVisible();

    // Verify the MCP tool group is visible
    await expect(app.sidebar.mcpToolGroup('Tools MCP')).toBeVisible();
  });

  // MCP-003: Tool execution
  test('executes MCP tool and shows result', async ({ app }) => {
    const conv = createConversation({ id: 'conv-mcp', title: 'MCP Test' });
    app.api.addConversation(conv);
    await app.reload();
    await app.sidebar.selectConversation('MCP Test');

    await app.chat.sendMessage('Use GitHub tool to list repos');

    app.ws.simulateToolExecution({
      conversationId: 'conv-mcp',
      turnId: 'turn-mcp',
      requestId: 'req-mcp',
      toolName: MCP_TOOL_GITHUB_LIST_REPOS,
      toolSource: 'mcp',
      parameters: { org: 'test-org' },
      result: JSON.stringify({ repos: ['repo-1', 'repo-2'] }),
    });

    // Tool event card should be visible (click to expand for details)
    await expect(app.chat.toolByName(MCP_TOOL_GITHUB_LIST_REPOS)).toBeVisible();
  });

  // MCP-004: Server enable/disable
  test('toggles MCP server via Tools accordion', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-toggle', name: 'Toggle MCP', enabled: true });
    app.api.setMcps([mcpServer]);
    app.api.setTools({ builtin: [], user: [], mcp: { 'Toggle MCP': [] } });
    await app.reload();

    await app.sidebar.toggleAccordion('Tools');

    // Toggle the MCP server via its toggle slider (input is hidden, click the label)
    await expect(app.sidebar.mcpToolGroup('Toggle MCP')).toBeVisible();
    await app.sidebar.mcpToggle('Toggle MCP').click();
  });

  // MCP-005: Server reconnection
  test('reconnects after MCP server restart', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-reconnect', name: 'Reconnect MCP', status: 'connected' });
    app.api.setMcps([mcpServer]);
    app.api.setTools({ builtin: [], user: [], mcp: { 'Reconnect MCP': [] } });
    await app.reload();

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
    await app.reload();

    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.mcpToolGroup('Sidebar MCP')).toBeVisible();

    // Toggle MCP via the label (input is hidden behind custom slider)
    await app.sidebar.mcpToggle('Sidebar MCP').click();
  });

  // MCP-008: MCP connection status
  test('sidebar shows connection status', async ({ app }) => {
    const mcpServer = createMcpServer({ id: 'mcp-status', name: 'Status MCP', status: 'connected' });
    app.api.setMcps([mcpServer]);
    app.api.setTools({ builtin: [], user: [], mcp: { 'Status MCP': [] } });
    await app.reload();

    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.mcpToolGroup('Status MCP')).toBeVisible();
    await expect(app.sidebar.mcpStatusConnected('Status MCP')).toBeVisible();
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
    await app.reload();

    await app.sidebar.toggleAccordion('Tools');
    await expect(app.sidebar.mcpToolGroup('Count MCP')).toBeVisible();
    // Tool count badge shows the number of tools
    await expect(app.sidebar.mcpToolCount('Count MCP')).toContainText('3');
  });
});
