/**
 * Desktop Session Instance
 *
 * Wraps a VNC connection and provides event-based session management.
 * Similar to BrowserSessionInstance but for desktop control.
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { VNCClient } from './vnc-client';
import type {
  DesktopSession,
  DesktopSessionStatus,
  DesktopSessionConfig,
  DesktopAction,
  ActionResult,
  ClickMarker,
  VNCConfig,
  SandboxInfo,
  ComputerUseProvider,
} from './types';

// Import Computer Use providers (reuse from browser module)
import type { IComputerUseProvider, ComputerUseResponse } from '../browser/strategies/computer-use/providers/types';

export interface DesktopSessionEvents {
  'status-changed': (status: DesktopSessionStatus, error?: string) => void;
  'screenshot': (screenshot: string) => void;
  'action-started': (actionId: string, action: DesktopAction) => void;
  'action-completed': (actionId: string, action: DesktopAction, result: ActionResult) => void;
  'click-marker': (marker: ClickMarker) => void;
  'error': (error: Error) => void;
  'closed': () => void;
}

export class DesktopSessionInstance extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly config: DesktopSessionConfig;

  private vncClient: VNCClient | null = null;
  private status: DesktopSessionStatus = 'provisioning';
  private sandbox: SandboxInfo;
  private lastScreenshot: string | null = null;
  private lastScreenshotAt: Date | null = null;
  private screenshotInterval: NodeJS.Timeout | null = null;
  private clickMarkerCount = 0;
  private error: string | null = null;
  private createdAt: Date;
  private actionLock = false;

  // Computer Use provider (reused from browser module)
  private cuProvider: IComputerUseProvider | null = null;
  private conversationHistory: Array<{ role: string; content: unknown }> = [];

  constructor(config: DesktopSessionConfig, sandbox: SandboxInfo) {
    super();
    this.id = uuidv4();
    this.name = config.name || `Desktop ${this.id.slice(0, 8)}`;
    this.config = config;
    this.sandbox = sandbox;
    this.createdAt = new Date();
  }

  /**
   * Initialize the session by connecting to VNC
   */
  async initialize(vncConfig: VNCConfig): Promise<void> {
    this.setStatus('starting');

    try {
      this.vncClient = new VNCClient(vncConfig);

      // Set up VNC event handlers
      this.vncClient.on('error', (error: Error) => {
        this.setStatus('error', error.message);
        this.emit('error', error);
      });

      this.vncClient.on('disconnect', () => {
        if (this.status !== 'closed') {
          this.setStatus('error', 'VNC connection lost');
        }
      });

      // Connect to VNC server
      await this.vncClient.connect();

      // Start periodic screenshots if configured
      const interval = this.config.screenshotInterval ?? 1000;
      if (interval > 0) {
        this.startPeriodicScreenshots(interval);
      }

      // Capture initial screenshot
      await this.captureScreenshot();

      this.setStatus('active');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus('error', message);
      throw error;
    }
  }

  /**
   * Set the Computer Use provider
   */
  setComputerUseProvider(provider: IComputerUseProvider): void {
    this.cuProvider = provider;
  }

  /**
   * Get current session state
   */
  getSession(): DesktopSession {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      sandbox: this.sandbox,
      vnc: this.vncClient?.getConnectionInfo(),
      viewport: this.vncClient?.getScreenSize() || this.config.viewport || { width: 1024, height: 768 },
      lastScreenshot: this.lastScreenshot || undefined,
      lastScreenshotAt: this.lastScreenshotAt || undefined,
      createdAt: this.createdAt,
      error: this.error || undefined,
    };
  }

  /**
   * Capture screenshot
   */
  async captureScreenshot(): Promise<string> {
    if (!this.vncClient?.isConnected()) {
      throw new Error('VNC not connected');
    }

    const screenshot = await this.vncClient.captureScreenshot();
    this.lastScreenshot = screenshot;
    this.lastScreenshotAt = new Date();
    this.emit('screenshot', screenshot);
    return screenshot;
  }

  /**
   * Execute a single action
   */
  async executeAction(action: DesktopAction): Promise<ActionResult> {
    if (!this.vncClient?.isConnected()) {
      return {
        success: false,
        action,
        error: 'VNC not connected',
      };
    }

    // Generate action ID
    const actionId = action.actionId || uuidv4();
    action.actionId = actionId;

    // Emit action started
    this.emit('action-started', actionId, action);
    this.setStatus('busy');

    try {
      // Execute the action
      const result = await this.vncClient.executeAction(action);

      // Emit click marker for visual feedback
      if (['click', 'double_click', 'right_click'].includes(action.type) && action.x !== undefined && action.y !== undefined) {
        this.emitClickMarker(action.x, action.y, action.type as 'click' | 'double_click' | 'right_click');
      }

      // Update last screenshot
      if (result.screenshot) {
        this.lastScreenshot = result.screenshot;
        this.lastScreenshotAt = new Date();
        this.emit('screenshot', result.screenshot);
      }

      // Emit action completed
      this.emit('action-completed', actionId, action, result);
      this.setStatus('active');

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: ActionResult = {
        success: false,
        action,
        error: errorMessage,
      };

      this.emit('action-completed', actionId, action, result);
      this.setStatus('active');

      return result;
    }
  }

  /**
   * Execute an instruction using Computer Use model
   */
  async executeInstruction(
    instruction: string,
    context?: {
      conversationId?: string;
      previousResponseId?: string;
      previousCallId?: string;
      maxSteps?: number;
    }
  ): Promise<{
    success: boolean;
    result?: string;
    error?: string;
    steps: number;
    actions: DesktopAction[];
    finalScreenshot?: string;
  }> {
    if (!this.cuProvider) {
      return {
        success: false,
        error: 'No Computer Use provider configured',
        steps: 0,
        actions: [],
      };
    }

    if (!this.vncClient?.isConnected()) {
      return {
        success: false,
        error: 'VNC not connected',
        steps: 0,
        actions: [],
      };
    }

    // Acquire action lock
    if (this.actionLock) {
      return {
        success: false,
        error: 'Session is busy with another instruction',
        steps: 0,
        actions: [],
      };
    }

    this.actionLock = true;
    this.setStatus('busy');

    const maxSteps = context?.maxSteps || 10;
    const executedActions: DesktopAction[] = [];
    let stepCount = 0;
    let lastResponseId = context?.previousResponseId;
    let lastCallId = context?.previousCallId;

    try {
      while (stepCount < maxSteps) {
        stepCount++;

        // Capture current screenshot
        const screenshot = await this.captureScreenshot();
        const screenSize = this.vncClient.getScreenSize();

        // Get action from Computer Use provider
        const cuResponse: ComputerUseResponse = await this.cuProvider.getAction({
          screenshot,
          instruction,
          screenSize,
          history: this.conversationHistory,
          previousResponseId: lastResponseId,
          previousCallId: lastCallId,
        });

        // Update conversation tracking
        lastResponseId = cuResponse.responseId;
        lastCallId = cuResponse.callId;

        // Check if complete
        if (cuResponse.isComplete) {
          this.actionLock = false;
          this.setStatus('active');

          return {
            success: true,
            result: cuResponse.result,
            steps: stepCount,
            actions: executedActions,
            finalScreenshot: screenshot,
          };
        }

        // Execute the action
        if (cuResponse.action) {
          const desktopAction = this.convertToDesktopAction(cuResponse.action);
          const result = await this.executeAction(desktopAction);
          executedActions.push(desktopAction);

          if (!result.success) {
            console.warn(`Action failed: ${result.error}`);
            // Continue anyway - the model will see the result in the next screenshot
          }
        }

        // Brief pause between actions
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Max steps reached
      this.actionLock = false;
      this.setStatus('active');

      return {
        success: false,
        error: `Max steps (${maxSteps}) reached without completion`,
        steps: stepCount,
        actions: executedActions,
        finalScreenshot: this.lastScreenshot || undefined,
      };
    } catch (error) {
      this.actionLock = false;
      this.setStatus('error', error instanceof Error ? error.message : String(error));

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        steps: stepCount,
        actions: executedActions,
      };
    }
  }

  /**
   * Convert Computer Use action to Desktop action
   */
  private convertToDesktopAction(cuAction: {
    type: string;
    x?: number;
    y?: number;
    text?: string;
    key?: string;
    direction?: string;
    amount?: number;
    startX?: number;
    startY?: number;
    endX?: number;
    endY?: number;
  }): DesktopAction {
    // Map Computer Use coordinates if needed (some providers use normalized coords)
    const screenSize = this.vncClient?.getScreenSize() || { width: 1024, height: 768 };

    // Google Gemini uses 1000x1000 normalized coordinates
    let x = cuAction.x;
    let y = cuAction.y;
    if (this.config.computerUseProvider === 'google' && x !== undefined && y !== undefined) {
      x = Math.round((x / 1000) * screenSize.width);
      y = Math.round((y / 1000) * screenSize.height);
    }

    return {
      type: cuAction.type as DesktopAction['type'],
      x,
      y,
      text: cuAction.text,
      key: cuAction.key,
      direction: cuAction.direction as DesktopAction['direction'],
      amount: cuAction.amount,
      endX: cuAction.endX,
      endY: cuAction.endY,
    };
  }

  /**
   * Start periodic screenshot capture
   */
  private startPeriodicScreenshots(intervalMs: number): void {
    this.stopPeriodicScreenshots();

    this.screenshotInterval = setInterval(async () => {
      if (this.vncClient?.isConnected() && !this.actionLock) {
        try {
          await this.captureScreenshot();
        } catch (error) {
          console.error('Periodic screenshot failed:', error);
        }
      }
    }, intervalMs);
  }

  /**
   * Stop periodic screenshot capture
   */
  private stopPeriodicScreenshots(): void {
    if (this.screenshotInterval) {
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = null;
    }
  }

  /**
   * Emit click marker for visual debugging
   */
  private emitClickMarker(
    x: number,
    y: number,
    type: 'click' | 'double_click' | 'right_click' | 'drag_start' | 'drag_end'
  ): void {
    this.clickMarkerCount++;
    const marker: ClickMarker = {
      id: uuidv4(),
      x,
      y,
      type,
      number: this.clickMarkerCount,
      timestamp: Date.now(),
    };
    this.emit('click-marker', marker);
  }

  /**
   * Set session status
   */
  private setStatus(status: DesktopSessionStatus, error?: string): void {
    this.status = status;
    this.error = error || null;
    this.emit('status-changed', status, error);
  }

  /**
   * Update sandbox info
   */
  updateSandbox(info: Partial<SandboxInfo>): void {
    this.sandbox = { ...this.sandbox, ...info };
  }

  /**
   * Close the session
   */
  async close(): Promise<void> {
    this.stopPeriodicScreenshots();

    if (this.vncClient) {
      this.vncClient.disconnect();
      this.vncClient = null;
    }

    this.setStatus('closed');
    this.emit('closed');
  }

  /**
   * Check if session is busy
   */
  isBusy(): boolean {
    return this.actionLock;
  }
}
