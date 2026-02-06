/**
 * Desktop Control Module Types
 *
 * Mirrors the browser module types but for sandboxed desktop environments.
 * Uses VNC for remote control instead of Playwright.
 */

// ============================================
// Sandbox Types
// ============================================

export type SandboxType = 'windows-sandbox' | 'hyperv' | 'virtualbox' | 'tart';

export type DesktopPlatform = 'windows' | 'macos' | 'linux';

export interface SandboxConfig {
  type: SandboxType;
  platform: DesktopPlatform;
  /** Memory in MB */
  memory?: number;
  /** Number of CPU cores */
  cpus?: number;
  /** Path to sandbox config file or VM */
  configPath?: string;
  /** Startup script to run */
  startupScript?: string;
  /** Whether to enable GPU acceleration */
  enableGpu?: boolean;
  /** Whether to enable networking */
  enableNetwork?: boolean;
}

export interface SandboxInfo {
  type: SandboxType;
  platform: DesktopPlatform;
  status: 'starting' | 'running' | 'stopped' | 'error';
  hostname?: string;
  vncPort?: number;
  rdpPort?: number;
  startedAt?: Date;
  error?: string;
}

// ============================================
// VNC Connection Types
// ============================================

export interface VNCConfig {
  host: string;
  port: number;
  password?: string;
  /** Timeout for connection in ms */
  connectTimeout?: number;
  /** Encoding preferences */
  encodings?: string[];
}

export interface VNCConnectionInfo {
  connected: boolean;
  host: string;
  port: number;
  width: number;
  height: number;
  pixelFormat?: PixelFormat;
  serverName?: string;
}

export interface PixelFormat {
  bitsPerPixel: number;
  depth: number;
  bigEndianFlag: boolean;
  trueColorFlag: boolean;
  redMax: number;
  greenMax: number;
  blueMax: number;
  redShift: number;
  greenShift: number;
  blueShift: number;
}

// ============================================
// Desktop Session Types
// ============================================

export type DesktopSessionStatus =
  | 'provisioning' // Sandbox is being created
  | 'starting' // VNC connection being established
  | 'active' // Ready for interaction
  | 'busy' // Currently executing an action
  | 'idle' // Connected but not executing
  | 'error' // Error state
  | 'closed'; // Session terminated

export interface DesktopSession {
  id: string;
  name: string;
  status: DesktopSessionStatus;
  sandbox: SandboxInfo;
  vnc?: VNCConnectionInfo;
  viewport: { width: number; height: number };
  lastScreenshot?: string;
  lastScreenshotAt?: Date;
  currentApplication?: string;
  createdAt: Date;
  error?: string;
}

export interface DesktopSessionConfig {
  name?: string;
  sandbox: SandboxConfig;
  vnc?: Partial<VNCConfig>;
  viewport?: { width: number; height: number };
  /** Computer Use provider to use */
  computerUseProvider?: ComputerUseProvider;
  /** Interval for periodic screenshots in ms (0 to disable) */
  screenshotInterval?: number;
}

// ============================================
// Action Types (mirrors browser actions)
// ============================================

export type DesktopActionType =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'type'
  | 'key'
  | 'hotkey'
  | 'scroll'
  | 'move'
  | 'drag'
  | 'screenshot'
  | 'wait';

export interface DesktopAction {
  type: DesktopActionType;
  /** X coordinate for mouse actions */
  x?: number;
  /** Y coordinate for mouse actions */
  y?: number;
  /** Text to type */
  text?: string;
  /** Key to press (e.g., 'Enter', 'Tab', 'Escape') */
  key?: string;
  /** Keys for hotkey combination (e.g., ['ctrl', 'c']) */
  keys?: string[];
  /** Scroll direction */
  direction?: 'up' | 'down' | 'left' | 'right';
  /** Scroll amount in pixels */
  amount?: number;
  /** Drag end coordinates */
  endX?: number;
  endY?: number;
  /** Wait duration in ms */
  duration?: number;
  /** Action ID for tracking */
  actionId?: string;
}

export interface ActionResult {
  success: boolean;
  action: DesktopAction;
  screenshot?: string;
  error?: string;
  duration?: number;
}

// ============================================
// Computer Use Integration Types
// ============================================

export type ComputerUseProvider = 'anthropic' | 'openai' | 'google' | 'azure_openai';

export interface ComputerUseAction {
  type: 'click' | 'type' | 'scroll' | 'key' | 'wait' | 'screenshot' | 'double_click' | 'drag';
  x?: number;
  y?: number;
  text?: string;
  key?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
}

export interface ComputerUseResponse {
  action?: ComputerUseAction;
  isComplete: boolean;
  result?: string;
  reasoning?: string;
  responseId?: string;
  callId?: string;
}

export interface InstructionContext {
  conversationId?: string;
  previousResponseId?: string;
  previousCallId?: string;
  maxSteps?: number;
}

export interface InstructionResult {
  success: boolean;
  result?: string;
  error?: string;
  steps: number;
  actions: DesktopAction[];
  finalScreenshot?: string;
}

// ============================================
// Click Marker Types (for visual debugging)
// ============================================

export interface ClickMarker {
  id: string;
  x: number;
  y: number;
  type: 'click' | 'double_click' | 'right_click' | 'drag_start' | 'drag_end';
  number: number;
  timestamp: number;
}

// ============================================
// Manager Types
// ============================================

export interface IDesktopSessionManager {
  createSession(config: DesktopSessionConfig): Promise<DesktopSession>;
  getSession(sessionId: string): DesktopSession | undefined;
  getSessions(): DesktopSession[];
  closeSession(sessionId: string): Promise<void>;
  closeAllSessions(): Promise<void>;

  // Action execution
  executeAction(sessionId: string, action: DesktopAction): Promise<ActionResult>;
  executeInstruction(
    sessionId: string,
    instruction: string,
    context?: InstructionContext
  ): Promise<InstructionResult>;

  // Screenshot
  captureScreenshot(sessionId: string): Promise<string>;
}

// ============================================
// Event Types
// ============================================

export interface DesktopSessionCreatedEvent {
  type: 'desktop_session_created';
  session: DesktopSession;
}

export interface DesktopSessionUpdatedEvent {
  type: 'desktop_session_updated';
  sessionId: string;
  updates: Partial<DesktopSession>;
}

export interface DesktopSessionClosedEvent {
  type: 'desktop_session_closed';
  sessionId: string;
}

export interface DesktopScreenshotEvent {
  type: 'desktop_screenshot';
  sessionId: string;
  screenshot: string;
  timestamp: number;
}

export interface DesktopActionStartedEvent {
  type: 'desktop_action_started';
  sessionId: string;
  actionId: string;
  action: DesktopAction;
}

export interface DesktopActionCompletedEvent {
  type: 'desktop_action_completed';
  sessionId: string;
  actionId: string;
  action: DesktopAction;
  result: ActionResult;
}

export interface DesktopClickMarkerEvent {
  type: 'desktop_click_marker';
  sessionId: string;
  marker: ClickMarker;
}

export type DesktopEvent =
  | DesktopSessionCreatedEvent
  | DesktopSessionUpdatedEvent
  | DesktopSessionClosedEvent
  | DesktopScreenshotEvent
  | DesktopActionStartedEvent
  | DesktopActionCompletedEvent
  | DesktopClickMarkerEvent;
