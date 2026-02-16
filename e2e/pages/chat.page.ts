/**
 * ChatPage - Page object for the chat area of the OllieBot UI.
 *
 * Encapsulates all chat-related interactions:
 * - Sending messages
 * - Reading responses
 * - Streaming behavior
 * - Tool execution display
 * - Delegation events
 * - Citations
 * - Input modes (#Think, #Deep Research)
 */

import { type Page, type Locator, expect } from '@playwright/test';
import type { WebSocketMock } from '../utils/ws-helper.js';

export class ChatPage {
  constructor(
    private page: Page,
    private ws: WebSocketMock,
  ) {}

  // --- Input ---

  /** The message input textarea. */
  get input(): Locator {
    return this.page.locator('textarea').first();
  }

  /** Type a message into the input field (does NOT submit). */
  async typeMessage(text: string): Promise<void> {
    await this.input.fill(text);
  }

  /** Send a message by typing and pressing Enter. */
  async sendMessage(text: string): Promise<void> {
    await this.input.fill(text);
    await this.input.press('Enter');
  }

  /** Submit using the send button instead of Enter. */
  async clickSend(): Promise<void> {
    await this.page.locator('form.input-form button[type="submit"]').click();
  }

  /** Clear the input field. */
  async clearInput(): Promise<void> {
    await this.input.fill('');
  }

  /** Get the current input value. */
  async getInputValue(): Promise<string> {
    return this.input.inputValue();
  }

  /** Get the input placeholder text. */
  async getInputPlaceholder(): Promise<string> {
    return (await this.input.getAttribute('placeholder')) || '';
  }

  // --- Hashtag Menu (# commands) ---

  /** Type # to open the hashtag command menu. */
  async openHashtagMenu(): Promise<void> {
    await this.input.focus();
    await this.input.clear();
    await this.page.keyboard.type('#');
  }

  /** Check if the hashtag menu is visible (handles both ChatInput and AgentChatInput variants). */
  get hashtagMenu(): Locator {
    return this.page.locator('.hashtag-menu, .agent-chat-hashtag-menu');
  }

  /** Select a hashtag menu item by text. */
  async selectHashtagItem(text: string): Promise<void> {
    await this.page.locator('.hashtag-menu-item, .agent-chat-hashtag-menu-item', { hasText: text }).click();
  }

  /** Get visible hashtag menu items. */
  async getHashtagMenuItems(): Promise<string[]> {
    const items = this.page.locator('.hashtag-menu-item, .agent-chat-hashtag-menu-item');
    return items.allTextContents();
  }

  /** Get hashtag menu items locator. */
  get hashtagMenuItems(): Locator {
    return this.page.locator('.hashtag-menu-item, .agent-chat-hashtag-menu-item');
  }

  /** Get hashtag menu item count. */
  async getHashtagMenuItemCount(): Promise<number> {
    return this.hashtagMenuItems.count();
  }

  // --- Command Chips ---

  /** Get the active command chip (e.g., #Deep Research). */
  get commandChip(): Locator {
    return this.page.locator('.hashtag-chip-command, .hashtag-chip');
  }

  /** Remove the active command chip. */
  async removeCommandChip(): Promise<void> {
    await this.page.locator('.hashtag-chip-remove').click();
  }

  // --- Messages ---

  /** All message elements in the chat. */
  get messages(): Locator {
    return this.page.locator('.message');
  }

  /** Get the nth message (0-indexed). */
  message(index: number): Locator {
    return this.messages.nth(index);
  }

  /** Get the last message. */
  get lastMessage(): Locator {
    return this.messages.last();
  }

  /** Get the avatar for a message by index. */
  messageAvatar(index: number): Locator {
    return this.message(index).locator('.message-avatar, [class*="avatar"]');
  }

  /** Get the avatar for the last message. */
  get lastMessageAvatar(): Locator {
    return this.lastMessage.locator('.message-avatar, [class*="avatar"]');
  }

  /** Get message content text. */
  async getMessageContent(index: number): Promise<string> {
    return (await this.message(index).locator('.message-content').textContent()) || '';
  }

  /** Get the last message's content. */
  async getLastMessageContent(): Promise<string> {
    return (await this.lastMessage.locator('.message-content').textContent()) || '';
  }

  /** Get the number of messages visible. */
  async getMessageCount(): Promise<number> {
    return this.messages.count();
  }

  /** Check if a message is from user or assistant. */
  async getMessageRole(index: number): Promise<'user' | 'assistant' | 'error'> {
    const cls = (await this.message(index).getAttribute('class')) || '';
    if (cls.includes('user')) return 'user';
    if (cls.includes('error')) return 'error';
    return 'assistant';
  }

  /** Wait for a message containing specific text (checks message content and task-run events). */
  async waitForMessageContaining(text: string, timeout = 5000): Promise<void> {
    await expect(
      this.page.locator('.message-content, .task-run-event', { hasText: text }).first()
    ).toBeVisible({ timeout });
  }

  /** Check if a message is currently streaming. */
  async isStreaming(): Promise<boolean> {
    return this.page.locator('.message.streaming').isVisible();
  }

  /** Wait for streaming indicator to be visible. */
  async waitForStreaming(timeout = 3000): Promise<void> {
    await expect(this.page.locator('.message.streaming')).toBeVisible({ timeout });
  }

  /** Wait for streaming to complete (no streaming indicator). */
  async waitForStreamingComplete(timeout = 3000): Promise<void> {
    await expect(this.page.locator('.message.streaming')).not.toBeVisible({ timeout });
  }

  // --- User Message Display ---

  /** Get user messages. */
  get userMessages(): Locator {
    return this.page.locator('.message.user');
  }

  /** Get assistant messages. */
  get assistantMessages(): Locator {
    return this.page.locator('.message.assistant');
  }

  /** Get error messages. */
  get errorMessages(): Locator {
    return this.page.locator('.message.error');
  }

  // --- Token Usage ---

  /** Get the usage footer of a message. */
  messageUsage(index: number): Locator {
    return this.message(index).locator('.message-usage-footer');
  }

  /** Get the last message's usage footer. */
  get lastMessageUsage(): Locator {
    return this.lastMessage.locator('.message-usage-footer');
  }

  // --- Tool Execution ---

  /** Get tool event blocks in the chat (the clickable header row). */
  get toolEvents(): Locator {
    return this.page.locator('.tool-event');
  }

  /** Get tool event by tool name. */
  toolByName(name: string): Locator {
    return this.page.locator('.tool-event', { hasText: name });
  }

  /** Get expanded tool details (visible after clicking tool event). */
  get toolDetails(): Locator {
    return this.page.locator('.tool-details');
  }

  /** Expand a tool event by clicking it. Waits for tool details to be visible. */
  async expandTool(toolName: string): Promise<void> {
    await this.toolByName(toolName).click();
    await this.toolDetails.waitFor({ state: 'visible' });
  }

  /** Get the tool progress bar. */
  get toolProgress(): Locator {
    return this.page.locator('.tool-progress');
  }

  // --- Delegation Events ---

  /** Get delegation event cards. */
  get delegationEvents(): Locator {
    return this.page.locator('.delegation-event');
  }

  /** Get delegation event by agent name. */
  delegationByAgent(name: string): Locator {
    return this.page.locator('.delegation-event', { hasText: name });
  }

  // --- Task Run Events ---

  /** Get task run event cards. */
  get taskRunEvents(): Locator {
    return this.page.locator('.task-run-event');
  }

  // --- Citations ---

  /** Get citation panels. */
  get citationPanels(): Locator {
    return this.page.locator('.citation-panel, [class*="citation"]');
  }

  /** Get cited sources. */
  get citedSources(): Locator {
    return this.page.locator('.cited-source, [class*="source"]');
  }

  // --- Attachments ---

  /** Get attachment chips in the input area. */
  get attachmentChips(): Locator {
    return this.page.locator('.attachment-chip');
  }

  /** Remove an attachment by index. */
  async removeAttachment(index: number): Promise<void> {
    await this.page.locator('.attachment-remove').nth(index).click();
  }

  // --- Message Action Buttons ---

  /** Get action buttons in messages. */
  get messageActionButtons(): Locator {
    return this.page.locator('.action-button');
  }

  // --- Code Blocks ---

  /** Get code blocks in messages. */
  get codeBlocks(): Locator {
    return this.page.locator('.code-block, pre code');
  }

  /** Get the copy button on a code block. */
  codeBlockCopyButton(index: number): Locator {
    return this.codeBlocks.nth(index).locator('button', { hasText: /copy/i });
  }

  // --- HTML Preview ---

  /** Get HTML preview toggle buttons. */
  get htmlPreviewToggles(): Locator {
    return this.page.locator('[class*="html-preview"] button, [class*="html-toggle"]');
  }

  /** Get HTML fullscreen modal. */
  get htmlPreviewModal(): Locator {
    return this.page.locator('.html-preview-modal');
  }

  // --- Reasoning Chips ---

  /** Get reasoning mode chips on messages. */
  get reasoningChips(): Locator {
    return this.page.locator('.message-reasoning-chip');
  }

  /** Get message type chips. */
  get messageTypeChips(): Locator {
    return this.page.locator('.message-type-chip');
  }

  /** Get message command chips. */
  get messageCommandChips(): Locator {
    return this.page.locator('.message-command-chip');
  }

  // --- Voice ---

  /** Get the voice button. */
  get voiceButton(): Locator {
    return this.page.locator('button.voice-button');
  }

  /** Check if voice is recording. */
  async isVoiceRecording(): Promise<boolean> {
    const cls = await this.voiceButton.getAttribute('class');
    return cls?.includes('recording') ?? false;
  }

  // --- Audio Player ---

  /** Get audio players in messages. */
  get audioPlayers(): Locator {
    return this.page.locator('.tool-result-audio, [class*="audio-player"]');
  }

  /** Get the audio play button. */
  get audioPlayButton(): Locator {
    return this.page.locator('.audio-play-button');
  }

  /** Get audio play button text (e.g., "▶️ Play" or "🔊 Playing..."). */
  async getAudioPlayButtonText(): Promise<string> {
    return (await this.audioPlayButton.textContent()) || '';
  }

  // --- Image Preview ---

  /** Get image preview elements in tool results. */
  get toolResultImages(): Locator {
    return this.page.locator('.tool-result-image img, .tool-result-with-image img');
  }

  /** Get image src attribute from tool result. */
  async getToolResultImageSrc(index = 0): Promise<string> {
    return (await this.toolResultImages.nth(index).getAttribute('src')) || '';
  }

  // --- PDF Viewer ---

  /** Get the PDF viewer modal. */
  get pdfViewerModal(): Locator {
    return this.page.locator('.pdf-modal-backdrop');
  }

  /** Close the PDF viewer modal. */
  async closePdfViewer(): Promise<void> {
    await this.page.locator('.pdf-modal-close').click();
  }

  // --- Trace Links ---

  /** Get trace link buttons. */
  get traceLinks(): Locator {
    return this.page.locator('.trace-link');
  }

  // --- Scroll ---

  /** Get the scroll-to-bottom button. */
  get scrollToBottomButton(): Locator {
    return this.page.locator('.scroll-to-bottom');
  }

  /** Click scroll-to-bottom. */
  async scrollToBottom(): Promise<void> {
    if (await this.scrollToBottomButton.isVisible()) {
      await this.scrollToBottomButton.click();
    }
  }
}
