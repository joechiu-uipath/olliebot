/**
 * SidebarPage - Page object for the OllieBot sidebar.
 *
 * Encapsulates interactions with:
 * - Conversation list
 * - Accordion sections (Tasks, Skills, MCPs, Tools, Computer Use, RAG)
 * - Mode switcher
 * - Mobile menu
 */

import { type Page, type Locator, expect } from '@playwright/test';
import type { WebSocketMock } from '../utils/ws-helper.js';

export class SidebarPage {
  constructor(
    private page: Page,
    private ws: WebSocketMock,
  ) {}

  // --- Sidebar Container ---

  /** The sidebar element. */
  get container(): Locator {
    return this.page.locator('.sidebar');
  }

  /** Check if sidebar is open. */
  async isOpen(): Promise<boolean> {
    const cls = await this.container.getAttribute('class');
    return cls?.includes('open') ?? !cls?.includes('collapsed');
  }

  /** Toggle sidebar open/closed. */
  async toggle(): Promise<void> {
    await this.page.locator('.sidebar-toggle').click();
  }

  /** Mobile hamburger menu. */
  get mobileMenuButton(): Locator {
    return this.page.locator('.mobile-menu-btn, [class*="hamburger"]');
  }

  // --- Conversations ---

  /** The new conversation button. */
  get newChatButton(): Locator {
    return this.page.locator('.new-conversation-btn');
  }

  /** Create a new conversation. */
  async createNewConversation(): Promise<void> {
    await this.newChatButton.click();
  }

  /** Get all conversation items. */
  get conversations(): Locator {
    return this.page.locator('.conversation-item');
  }

  /** Get the active (selected) conversation. */
  get activeConversation(): Locator {
    return this.page.locator('.conversation-item.active');
  }

  /** Select a conversation by title. */
  async selectConversation(title: string): Promise<void> {
    await this.page.locator('.conversation-item', { hasText: title }).click();
  }

  /** Get a conversation item by title. */
  conversationByTitle(title: string): Locator {
    return this.page.locator('.conversation-item', { hasText: title });
  }

  /** Get the title of a conversation item. */
  async getConversationTitle(index: number): Promise<string> {
    return (await this.conversations.nth(index).locator('.conversation-title').textContent()) || '';
  }

  /** Right-click or find actions menu for a conversation. */
  async openConversationActions(title: string): Promise<void> {
    const item = this.conversationByTitle(title);
    // Hover to reveal the actions button (it's hidden until hover)
    await item.hover();
    const actionsBtn = item.locator('.actions-menu-btn');
    await actionsBtn.click();
  }

  /** Start inline rename of a conversation. */
  async startRename(title: string): Promise<void> {
    await this.openConversationActions(title);
    await this.page.locator('.actions-menu-item', { hasText: /rename/i }).click();
  }

  /** Complete inline rename. */
  async finishRename(newTitle: string): Promise<void> {
    const input = this.page.locator('.conversation-rename-input');
    await input.fill(newTitle);
    await input.press('Enter');
  }

  /** Delete a conversation. */
  async deleteConversation(title: string): Promise<void> {
    await this.openConversationActions(title);
    await this.page.locator('.actions-menu-item', { hasText: /delete/i }).click();
  }

  /** Get the count of conversations (excluding well-known). */
  async getConversationCount(): Promise<number> {
    return this.conversations.count();
  }

  // --- Accordion Sections ---

  /** Get an accordion by its title text. */
  accordion(label: string): Locator {
    return this.page.locator('.accordion', { hasText: label });
  }

  /** Toggle an accordion section. */
  async toggleAccordion(label: string): Promise<void> {
    await this.accordion(label).locator('.accordion-header').click();
  }

  /** Check if an accordion is expanded. */
  async isAccordionExpanded(label: string): Promise<boolean> {
    const header = this.accordion(label).locator('.accordion-header');
    const cls = await header.getAttribute('class');
    return cls?.includes('expanded') ?? false;
  }

  /** Get items in an accordion. */
  accordionItems(label: string): Locator {
    return this.accordion(label).locator('.accordion-item, .task-item, .skill-item, .mcp-item');
  }

  // --- Tasks Accordion ---

  /** Get all task items. */
  get tasks(): Locator {
    return this.page.locator('.task-item');
  }

  /** Toggle a task's enabled state. */
  async toggleTask(taskName: string): Promise<void> {
    const taskItem = this.page.locator('.task-item', { hasText: taskName });
    await taskItem.locator('.task-toggle').click();
  }

  /** Run a task by name (run button is hover-revealed). */
  async runTask(taskName: string): Promise<void> {
    const taskItem = this.page.locator('.task-item', { hasText: taskName });
    await taskItem.hover();
    await taskItem.locator('.task-run-btn').click();
  }

  // --- MCP Accordion ---

  /** Get all MCP items. */
  get mcpItems(): Locator {
    return this.page.locator('.accordion-item').filter({ has: this.page.locator('.mcp-toggle') });
  }

  /** Toggle MCP server enabled state. */
  async toggleMcp(mcpName: string): Promise<void> {
    const item = this.page.locator('.accordion-item', { hasText: mcpName });
    await item.locator('.mcp-toggle').click();
  }

  // --- Tools Accordion ---

  /** Get the tool groups. */
  get toolGroups(): Locator {
    return this.page.locator('.tool-group, [class*="tool-category"]');
  }

  // --- Computer Use Sessions ---

  /** Get browser session items. */
  get browserSessions(): Locator {
    return this.page.locator('[class*="browser-session"]');
  }

  /** Get desktop session items. */
  get desktopSessions(): Locator {
    return this.page.locator('[class*="desktop-session"]');
  }

  /** Click a browser session to open preview. */
  async openBrowserPreview(sessionId: string): Promise<void> {
    await this.page.locator(`[class*="browser-session"][data-session-id="${sessionId}"], [class*="session-item"]`, { hasText: sessionId }).click();
  }

  // --- RAG Projects ---

  /** Get RAG project items. */
  get ragProjects(): Locator {
    return this.page.locator('[class*="rag-project"]');
  }

  // --- Mode Switcher ---

  /** Get mode switcher buttons. */
  get modeSwitcher(): Locator {
    return this.page.locator('.mode-switcher');
  }

  /** Get a specific mode button. */
  modeButton(label: string): Locator {
    return this.page.locator('.mode-btn', { hasText: label });
  }

  /** Get the active mode button. */
  get activeModeButton(): Locator {
    return this.page.locator('.mode-btn.active');
  }
}
