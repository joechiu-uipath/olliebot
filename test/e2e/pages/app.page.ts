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
import { Mode } from '../constants/index.js';

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
    const btn = this.modeButton('chat');
    await btn.waitFor({ state: 'visible' });
    await btn.click();
    await this.page.waitForURL(/\/chat/);
    await expect(this.page.locator('.mode-btn.active')).toContainText('Chat');
  }

  /** Switch to Logs/Traces mode. */
  async switchToLogs(): Promise<void> {
    const btn = this.modeButton('traces');
    await btn.waitFor({ state: 'visible' });
    await btn.click();
    await this.page.waitForURL(/\/traces/);
    await expect(this.page.locator('.mode-btn.active')).toContainText('Trace');
  }

  /** Switch to Mission mode. */
  async switchToMission(): Promise<void> {
    const btn = this.modeButton('mission');
    await btn.waitFor({ state: 'visible' });
    await btn.click();
    await this.page.waitForURL(/\/mission/);
    await expect(this.page.locator('.mode-btn.active')).toContainText('Mission');
  }

  /** Switch to Eval mode. */
  async switchToEval(): Promise<void> {
    const btn = this.modeButton('eval');
    await btn.waitFor({ state: 'visible' });
    await btn.click();
    await this.page.waitForURL(/\/eval/);
    await expect(this.page.locator('.mode-btn.active')).toContainText('Eval');
  }

  /** Get the currently active mode button. */
  get activeModeButton(): Locator {
    return this.page.locator('.mode-btn.active');
  }

  /** Get the currently active mode name as string. */
  async getActiveModeName(): Promise<string> {
    const text = await this.activeModeButton.textContent();
    return text?.trim() || '';
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

  // --- Page Actions ---

  /** Reload the page and wait for app to be ready. */
  async reload(): Promise<void> {
    await this.page.reload();
    await this.waitForAppReady();
  }

  // --- Helpers ---

  private modeButton(mode: string): Locator {
    // Mode buttons have text content: 💬 Chat, 📋 Trace, 🎯 Mission, 📊 Eval
    const labels: Record<string, string> = {
      chat: 'Chat',
      traces: 'Trace',
      mission: 'Mission',
      eval: 'Eval',
    };
    return this.page.locator('.mode-btn', { hasText: labels[mode] || mode });
  }
}
