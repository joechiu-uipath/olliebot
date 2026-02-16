/**
 * API Mock utilities for Playwright E2E tests.
 *
 * Provides route handlers for intercepting HTTP API calls and returning
 * simulated responses, so tests run without a real backend.
 */

import type { Page, Route } from '@playwright/test';

/** Startup data shape returned by GET /api/startup */
export interface StartupData {
  modelCapabilities: {
    provider: string;
    model: string;
    supportsExtendedThinking: boolean;
    supportsReasoningEffort: boolean;
    supportsVision: boolean;
    reasoningEfforts?: string[];
  };
  conversations: Array<{
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    isWellKnown: boolean;
    icon?: string;
  }>;
  feedMessages: {
    items: Array<Record<string, unknown>>;
    pagination: { hasOlder: boolean; hasNewer: boolean };
  };
  tasks: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  mcps: Array<Record<string, unknown>>;
  tools: {
    builtin: Array<Record<string, unknown>>;
    user: Array<Record<string, unknown>>;
    mcp: Record<string, Array<Record<string, unknown>>>;
  };
  ragProjects: Array<Record<string, unknown>>;
  agentTemplates: Array<Record<string, unknown>>;
  commandTriggers: Array<Record<string, unknown>>;
}

/** Default startup data used when no override is provided */
export function createDefaultStartupData(overrides?: Partial<StartupData>): StartupData {
  return {
    modelCapabilities: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      supportsExtendedThinking: true,
      supportsReasoningEffort: true,
      supportsVision: true,
      reasoningEfforts: ['high', 'xhigh'],
    },
    conversations: [
      {
        id: 'feed',
        title: 'Feed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isWellKnown: true,
        icon: '📡',
      },
    ],
    feedMessages: {
      items: [],
      pagination: { hasOlder: false, hasNewer: false },
    },
    tasks: [],
    skills: [],
    mcps: [],
    tools: { builtin: [], user: [], mcp: {} },
    ragProjects: [],
    agentTemplates: [
      { type: 'researcher', name: 'Researcher', emoji: '🔬', description: 'Research agent', collapseResponseByDefault: false },
      { type: 'coder', name: 'Coder', emoji: '💻', description: 'Coding agent', collapseResponseByDefault: false },
      { type: 'writer', name: 'Writer', emoji: '✍️', description: 'Writing agent', collapseResponseByDefault: false },
    ],
    commandTriggers: [
      { command: 'Deep Research', agentType: 'deep-research-lead', agentName: 'Deep Research Lead', agentEmoji: '🔬', description: 'Multi-step deep research' },
      { command: 'Modify', agentType: 'coding-lead', agentName: 'Coding Lead', agentEmoji: '💻', description: 'Frontend code modification' },
    ],
    ...overrides,
  };
}

/**
 * API route handler registry for mock API responses.
 */
export class ApiMock {
  private handlers: Map<string, (route: Route) => Promise<void>> = new Map();
  private startupData: StartupData;
  private conversationMessages: Map<string, Array<Record<string, unknown>>> = new Map();
  private conversationIdCounter = 0;

  constructor(startupOverrides?: Partial<StartupData>) {
    this.startupData = createDefaultStartupData(startupOverrides);
    this.registerDefaults();
  }

  /**
   * Install all API mocks on the page. Call before navigating.
   */
  async install(page: Page): Promise<void> {
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname;
      const method = route.request().method();
      const key = `${method} ${path}`;

      // Try exact match first, then pattern match
      const handler = this.handlers.get(key)
        || this.findPatternHandler(method, path);

      if (handler) {
        await handler(route);
      } else {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: `No mock for ${key}` }),
        });
      }
    });

    // Health check
    await page.route('**/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }),
      });
    });
  }

  /**
   * Override a specific API route.
   */
  setHandler(method: string, path: string, handler: (route: Route) => Promise<void>): void {
    this.handlers.set(`${method} ${path}`, handler);
  }

  /**
   * Add a conversation to the startup data.
   */
  addConversation(conv: { id: string; title: string; isWellKnown?: boolean; icon?: string }): void {
    this.startupData.conversations.push({
      id: conv.id,
      title: conv.title,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isWellKnown: conv.isWellKnown ?? false,
      icon: conv.icon,
    });
  }

  /**
   * Add messages for a conversation.
   * For the 'feed' conversation, also updates startupData.feedMessages.
   */
  setConversationMessages(conversationId: string, messages: Array<Record<string, unknown>>): void {
    this.conversationMessages.set(conversationId, messages);
    // Also update feedMessages in startup data for Feed conversation
    if (conversationId === 'feed') {
      this.startupData.feedMessages = {
        items: messages,
        pagination: { hasOlder: false, hasNewer: false },
      };
    }
  }

  /**
   * Add tasks to startup data.
   */
  setTasks(tasks: Array<Record<string, unknown>>): void {
    this.startupData.tasks = tasks;
  }

  /**
   * Add skills to startup data.
   */
  setSkills(skills: Array<Record<string, unknown>>): void {
    this.startupData.skills = skills;
  }

  /**
   * Add MCP servers to startup data.
   */
  setMcps(mcps: Array<Record<string, unknown>>): void {
    this.startupData.mcps = mcps;
  }

  /**
   * Set tools in startup data.
   */
  setTools(tools: StartupData['tools']): void {
    this.startupData.tools = tools;
  }

  /**
   * Set RAG projects in startup data.
   */
  setRagProjects(projects: Array<Record<string, unknown>>): void {
    this.startupData.ragProjects = projects;
  }

  /**
   * Update the startup data directly.
   */
  updateStartupData(update: Partial<StartupData>): void {
    Object.assign(this.startupData, update);
  }

  private registerDefaults(): void {
    // GET /api/startup
    this.handlers.set('GET /api/startup', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(this.startupData),
      });
    });

    // GET /api/model-capabilities
    this.handlers.set('GET /api/model-capabilities', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(this.startupData.modelCapabilities),
      });
    });

    // GET /api/state
    this.handlers.set('GET /api/state', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'idle' }),
      });
    });

    // GET /api/settings
    this.handlers.set('GET /api/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });

    // PATCH /api/settings
    this.handlers.set('PATCH /api/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    // POST /api/conversations
    this.handlers.set('POST /api/conversations', async (route) => {
      let body: Record<string, unknown> | null = null;
      try {
        body = route.request().postDataJSON();
      } catch {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Invalid JSON body' }),
        });
        return;
      }
      const id = `conv-${++this.conversationIdCounter}`;
      const conv = {
        id,
        title: body?.title || 'New Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isWellKnown: false,
      };
      this.startupData.conversations.push(conv);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(conv),
      });
    });

    // GET /api/tools
    this.handlers.set('GET /api/tools', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(this.startupData.tools),
      });
    });
  }

  private findPatternHandler(method: string, path: string): ((route: Route) => Promise<void>) | undefined {
    // GET /api/conversations/:id/messages
    if (method === 'GET' && /^\/api\/conversations\/[^/]+\/messages/.test(path)) {
      return async (route) => {
        const match = path.match(/^\/api\/conversations\/([^/]+)\/messages/);
        const convId = match ? decodeURIComponent(match[1]) : '';
        const msgs = this.conversationMessages.get(convId) || [];
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: msgs,
            pagination: { hasOlder: false, hasNewer: false },
          }),
        });
      };
    }

    // DELETE /api/conversations/:id
    if (method === 'DELETE' && /^\/api\/conversations\/[^/]+$/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      };
    }

    // DELETE /api/conversations/:id/messages
    if (method === 'DELETE' && /^\/api\/conversations\/[^/]+\/messages$/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      };
    }

    // PATCH /api/conversations/:id
    if (method === 'PATCH' && /^\/api\/conversations\/[^/]+$/.test(path)) {
      return async (route) => {
        const body = route.request().postDataJSON();
        const match = path.match(/^\/api\/conversations\/([^/]+)$/);
        const convId = match ? decodeURIComponent(match[1]) : '';
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ conversation: { id: convId, title: body?.title } }),
        });
      };
    }

    // POST /api/tasks/:id/run
    if (method === 'POST' && /^\/api\/tasks\/[^/]+\/run$/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      };
    }

    // PATCH /api/tasks/:id
    if (method === 'PATCH' && /^\/api\/tasks\/[^/]+$/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      };
    }

    // PATCH /api/mcps/:id
    if (method === 'PATCH' && /^\/api\/mcps\/[^/]+$/.test(path)) {
      return async (route) => {
        const body = route.request().postDataJSON();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'mock-mcp', enabled: body?.enabled }),
        });
      };
    }

    // DELETE /api/browser/sessions/:id
    if (method === 'DELETE' && /^\/api\/browser\/sessions\/[^/]+$/.test(path)) {
      return async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      };
    }

    // DELETE /api/desktop/sessions/:id
    if (method === 'DELETE' && /^\/api\/desktop\/sessions\/[^/]+$/.test(path)) {
      return async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      };
    }

    // Traces endpoints
    if (method === 'GET' && /^\/api\/traces/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], stats: { totalTraces: 0, totalTokens: 0 } }),
        });
      };
    }

    // Eval endpoints
    if (method === 'GET' && /^\/api\/eval/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      };
    }

    // Mission endpoints
    if (method === 'GET' && /^\/api\/missions/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      };
    }

    // POST to mission endpoints
    if (method === 'POST' && /^\/api\/missions/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      };
    }

    // RAG endpoints
    if (method === 'GET' && /^\/api\/rag/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      };
    }

    // POST to RAG endpoints
    if (method === 'POST' && /^\/api\/rag/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
      };
    }

    // Dashboard endpoints
    if (/^\/api\/dashboards/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'snap-1', html: '<div>Dashboard</div>' }),
        });
      };
    }

    // Prompts endpoints
    if (method === 'GET' && /^\/api\/prompts/.test(path)) {
      return async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      };
    }

    return undefined;
  }
}
