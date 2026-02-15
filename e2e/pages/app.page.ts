/**
 * OllieBotApp - Top-level page object for the OllieBot web UI.
 *
 * This is the entry point for all E2E test interactions.
 * All DOM knowledge is encapsulated here and in child page objects.
 * Test code should NEVER reference CSS selectors directly.
 */

import { type Page, type Locator, expect } from '@playwright/test';
import { ChatPage } from './chat.page.js';
import { SidebarPage } from './sidebar.page.js';
import { WebSocketMock } from '../utils/ws-helper.js';
import { ApiMock, type StartupData } from '../utils/api-mock.js';

export class OllieBotApp {
  readonly page: Page;
  readonly chat: ChatPage;
  readonly sidebar: SidebarPage;
  readonly ws: WebSocketMock;
  readonly api: ApiMock;

  constructor(page: Page, opts?: { startupData?: Partial<StartupData> }) {
    this.page = page;
    this.ws = new WebSocketMock();
    this.api = new ApiMock(opts?.startupData);
    this.chat = new ChatPage(page, this.ws);
    this.sidebar = new SidebarPage(page, this.ws);
  }

  /** Set up mocks and navigate to the app. */
  async goto(path = '/'): Promise<void> {
    await this.api.install(this.page);
    await this.ws.install(this.page);
    await this.page.goto(path);
    await this.waitForAppReady();
  }

  /** Wait until the app has loaded and the WebSocket is connected. */
  async waitForAppReady(): Promise<void> {
    await this.page.waitForSelector('.sidebar', { timeout: 10_000 });
    // Wait for connected status
    await expect(this.connectionStatus).toContainText('Connected', { timeout: 5_000 });
  }

  // --- Mode Switching ---

  /** Switch to Chat mode. */
  async switchToChat(): Promise<void> {
    await this.modeButton('chat').click();
  }

  /** Switch to Logs/Traces mode. */
  async switchToLogs(): Promise<void> {
    await this.modeButton('traces').click();
  }

  /** Switch to Mission mode. */
  async switchToMission(): Promise<void> {
    await this.modeButton('mission').click();
  }

  /** Switch to Eval mode. */
  async switchToEval(): Promise<void> {
    await this.modeButton('eval').click();
  }

  /** Get the currently active mode. */
  async getActiveMode(): Promise<string> {
    const activeBtn = this.page.locator('.mode-btn.active');
    const text = await activeBtn.textContent();
    return text?.trim().toLowerCase() || '';
  }

  // --- App Width ---

  /** Get the main app container. */
  get appContainer(): Locator {
    return this.page.locator('.app-container, .App, [class*="app"]').first();
  }

  // --- Connection Status ---

  /** Get the connection status indicator. */
  get connectionStatus(): Locator {
    return this.page.locator('.status');
  }

  /** Check if connected. */
  async isConnected(): Promise<boolean> {
    const cls = await this.connectionStatus.getAttribute('class');
    return cls?.includes('connected') ?? false;
  }

  // --- Welcome Screen ---

  /** Check if the welcome screen is visible. */
  async isWelcomeVisible(): Promise<boolean> {
    return this.page.locator('.welcome').isVisible();
  }

  // --- Scroll to Bottom ---

  /** Get the scroll-to-bottom button. */
  get scrollToBottomButton(): Locator {
    return this.page.locator('.scroll-to-bottom');
  }

  // --- Helpers ---

  private modeButton(mode: string): Locator {
    // Mode buttons have text content: 💬 Chat, 📊 Logs, 🎯 Mission, 🧪 Eval
    const labels: Record<string, string> = {
      chat: 'Chat',
      traces: 'Logs',
      mission: 'Mission',
      eval: 'Eval',
    };
    return this.page.locator('.mode-btn', { hasText: labels[mode] || mode });
  }
}
