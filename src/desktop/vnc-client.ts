/**
 * VNC Client Wrapper
 *
 * Wraps the rfb2 library to provide a clean interface for VNC operations.
 * Handles screenshot capture, mouse/keyboard input, and connection management.
 */

import { EventEmitter } from 'events';
import { PNG } from 'pngjs';
import type {
  VNCConfig,
  VNCConnectionInfo,
  PixelFormat,
  DesktopAction,
  ActionResult,
} from './types';

// rfb2 types (the package doesn't have TypeScript definitions)
interface RfbRect {
  x: number;
  y: number;
  width: number;
  height: number;
  encoding: number;
  data: Buffer;
}

interface RfbClient {
  width: number;
  height: number;
  pixelFormat: PixelFormat;
  title: string;

  // Methods
  requestUpdate(incremental: boolean, x: number, y: number, width: number, height: number): void;
  pointerEvent(x: number, y: number, buttonMask: number): void;
  keyEvent(keySym: number, isDown: boolean): void;
  end(): void;

  // Events
  on(event: 'connect', callback: () => void): void;
  on(event: 'error', callback: (error: Error) => void): void;
  on(event: 'rect', callback: (rect: RfbRect) => void): void;
  on(event: 'clipboard', callback: (text: string) => void): void;
  on(event: 'bell', callback: () => void): void;
  on(event: 'close', callback: () => void): void;
}

// VNC Key codes (X11 keysyms)
const KEY_CODES: Record<string, number> = {
  // Modifier keys
  shift: 0xffe1,
  ctrl: 0xffe3,
  control: 0xffe3,
  alt: 0xffe9,
  meta: 0xffe7,
  super: 0xffeb,
  win: 0xffeb,
  windows: 0xffeb,

  // Function keys
  f1: 0xffbe,
  f2: 0xffbf,
  f3: 0xffc0,
  f4: 0xffc1,
  f5: 0xffc2,
  f6: 0xffc3,
  f7: 0xffc4,
  f8: 0xffc5,
  f9: 0xffc6,
  f10: 0xffc7,
  f11: 0xffc8,
  f12: 0xffc9,

  // Navigation keys
  escape: 0xff1b,
  esc: 0xff1b,
  tab: 0xff09,
  backspace: 0xff08,
  enter: 0xff0d,
  return: 0xff0d,
  insert: 0xff63,
  delete: 0xffff,
  home: 0xff50,
  end: 0xff57,
  pageup: 0xff55,
  pagedown: 0xff56,

  // Arrow keys
  up: 0xff52,
  down: 0xff54,
  left: 0xff51,
  right: 0xff53,
  arrowup: 0xff52,
  arrowdown: 0xff54,
  arrowleft: 0xff51,
  arrowright: 0xff53,

  // Other keys
  space: 0x0020,
  capslock: 0xffe5,
  numlock: 0xff7f,
  scrolllock: 0xff14,
  printscreen: 0xff61,
  pause: 0xff13,
};

// Mouse button masks
const MOUSE_BUTTONS = {
  left: 1,
  middle: 2,
  right: 4,
  scrollUp: 8,
  scrollDown: 16,
};

export interface VNCClientEvents {
  connect: () => void;
  disconnect: () => void;
  error: (error: Error) => void;
  frame: (screenshot: string) => void;
  clipboard: (text: string) => void;
}

export class VNCClient extends EventEmitter {
  private client: RfbClient | null = null;
  private config: VNCConfig;
  private frameBuffer: Buffer | null = null;
  private frameBufferDirty = false;
  private connected = false;
  private width = 0;
  private height = 0;
  private pixelFormat: PixelFormat | null = null;
  private serverName = '';
  private pendingFrameRequest = false;

  constructor(config: VNCConfig) {
    super();
    this.config = {
      connectTimeout: 10000,
      ...config,
    };
  }

  /**
   * Connect to VNC server
   */
  async connect(): Promise<VNCConnectionInfo> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Connection timeout after ${this.config.connectTimeout}ms`));
      }, this.config.connectTimeout);

      // Dynamic import of rfb2
      import('rfb2').then((rfb2Module) => {
        const rfb = rfb2Module.default || rfb2Module;

        this.client = rfb.createConnection({
          host: this.config.host,
          port: this.config.port,
          password: this.config.password || '',
        }) as RfbClient;

        this.client.on('connect', () => {
          clearTimeout(timeoutId);
          this.connected = true;
          this.width = this.client!.width;
          this.height = this.client!.height;
          this.pixelFormat = this.client!.pixelFormat;
          this.serverName = this.client!.title || 'VNC Server';

          // Initialize frame buffer (RGBA)
          this.frameBuffer = Buffer.alloc(this.width * this.height * 4);
          this.frameBufferDirty = false;

          // Request initial full frame
          this.requestFullFrame();

          this.emit('connect');

          resolve({
            connected: true,
            host: this.config.host,
            port: this.config.port,
            width: this.width,
            height: this.height,
            pixelFormat: this.pixelFormat!,
            serverName: this.serverName,
          });
        });

        this.client.on('rect', (rect: RfbRect) => {
          this.handleRect(rect);
        });

        this.client.on('error', (error: Error) => {
          clearTimeout(timeoutId);
          this.emit('error', error);
          reject(error);
        });

        this.client.on('close', () => {
          this.connected = false;
          this.emit('disconnect');
        });

        this.client.on('clipboard', (text: string) => {
          this.emit('clipboard', text);
        });
      }).catch((error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to load rfb2: ${error.message}`));
      });
    });
  }

  /**
   * Handle incoming rectangle update
   */
  private handleRect(rect: RfbRect): void {
    if (!this.frameBuffer || !rect.data) return;

    // Copy rect data into frame buffer
    // rect.data is in the server's pixel format, need to convert to RGBA
    const bytesPerPixel = this.pixelFormat?.bitsPerPixel ? this.pixelFormat.bitsPerPixel / 8 : 4;

    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const srcOffset = (y * rect.width + x) * bytesPerPixel;
        const dstOffset = ((rect.y + y) * this.width + (rect.x + x)) * 4;

        if (dstOffset + 3 < this.frameBuffer.length && srcOffset + bytesPerPixel <= rect.data.length) {
          // Convert pixel format to RGBA
          if (bytesPerPixel === 4) {
            // Assume BGRA or RGBA
            if (this.pixelFormat?.blueShift === 0) {
              // BGRA
              this.frameBuffer[dstOffset + 0] = rect.data[srcOffset + 2]; // R
              this.frameBuffer[dstOffset + 1] = rect.data[srcOffset + 1]; // G
              this.frameBuffer[dstOffset + 2] = rect.data[srcOffset + 0]; // B
              this.frameBuffer[dstOffset + 3] = 255; // A
            } else {
              // RGBA
              this.frameBuffer[dstOffset + 0] = rect.data[srcOffset + 0];
              this.frameBuffer[dstOffset + 1] = rect.data[srcOffset + 1];
              this.frameBuffer[dstOffset + 2] = rect.data[srcOffset + 2];
              this.frameBuffer[dstOffset + 3] = 255;
            }
          } else if (bytesPerPixel === 3) {
            // RGB
            this.frameBuffer[dstOffset + 0] = rect.data[srcOffset + 0];
            this.frameBuffer[dstOffset + 1] = rect.data[srcOffset + 1];
            this.frameBuffer[dstOffset + 2] = rect.data[srcOffset + 2];
            this.frameBuffer[dstOffset + 3] = 255;
          }
        }
      }
    }

    this.frameBufferDirty = true;
    this.pendingFrameRequest = false;
  }

  /**
   * Request full frame update from server
   */
  requestFullFrame(): void {
    if (!this.client || !this.connected) return;
    this.pendingFrameRequest = true;
    this.client.requestUpdate(false, 0, 0, this.width, this.height);
  }

  /**
   * Request incremental frame update
   */
  requestIncrementalFrame(): void {
    if (!this.client || !this.connected) return;
    this.client.requestUpdate(true, 0, 0, this.width, this.height);
  }

  /**
   * Capture screenshot as base64 PNG
   */
  async captureScreenshot(): Promise<string> {
    if (!this.connected || !this.frameBuffer) {
      throw new Error('Not connected to VNC server');
    }

    // Request frame update and wait for it
    this.requestFullFrame();
    await this.waitForFrame(2000);

    // Convert frame buffer to PNG
    const png = new PNG({ width: this.width, height: this.height });
    this.frameBuffer.copy(png.data);

    const pngBuffer = PNG.sync.write(png);
    return pngBuffer.toString('base64');
  }

  /**
   * Wait for frame update
   */
  private async waitForFrame(timeoutMs = 1000): Promise<void> {
    const startTime = Date.now();
    while (this.pendingFrameRequest && Date.now() - startTime < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Execute a desktop action
   */
  async executeAction(action: DesktopAction): Promise<ActionResult> {
    if (!this.connected || !this.client) {
      return {
        success: false,
        action,
        error: 'Not connected to VNC server',
      };
    }

    const startTime = Date.now();

    try {
      switch (action.type) {
        case 'click':
          await this.click(action.x!, action.y!);
          break;

        case 'double_click':
          await this.doubleClick(action.x!, action.y!);
          break;

        case 'right_click':
          await this.rightClick(action.x!, action.y!);
          break;

        case 'type':
          await this.type(action.text!);
          break;

        case 'key':
          await this.pressKey(action.key!);
          break;

        case 'hotkey':
          await this.hotkey(action.keys!);
          break;

        case 'scroll':
          await this.scroll(action.direction!, action.amount || 3, action.x, action.y);
          break;

        case 'move':
          await this.moveMouse(action.x!, action.y!);
          break;

        case 'drag':
          await this.drag(action.x!, action.y!, action.endX!, action.endY!);
          break;

        case 'wait':
          await new Promise((resolve) => setTimeout(resolve, action.duration || 1000));
          break;

        case 'screenshot':
          // Just capture, don't execute anything
          break;

        default:
          return {
            success: false,
            action,
            error: `Unknown action type: ${action.type}`,
          };
      }

      // Wait a bit for the action to take effect
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Capture screenshot after action
      const screenshot = await this.captureScreenshot();

      return {
        success: true,
        action,
        screenshot,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        action,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Move mouse to coordinates
   */
  async moveMouse(x: number, y: number): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    this.client.pointerEvent(x, y, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Left click at coordinates
   */
  async click(x: number, y: number): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    // Move to position
    this.client.pointerEvent(x, y, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Press and release left button
    this.client.pointerEvent(x, y, MOUSE_BUTTONS.left);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.client.pointerEvent(x, y, 0);
  }

  /**
   * Double click at coordinates
   */
  async doubleClick(x: number, y: number): Promise<void> {
    await this.click(x, y);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await this.click(x, y);
  }

  /**
   * Right click at coordinates
   */
  async rightClick(x: number, y: number): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    this.client.pointerEvent(x, y, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    this.client.pointerEvent(x, y, MOUSE_BUTTONS.right);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.client.pointerEvent(x, y, 0);
  }

  /**
   * Drag from one point to another
   */
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    // Move to start
    this.client.pointerEvent(startX, startY, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Press button
    this.client.pointerEvent(startX, startY, MOUSE_BUTTONS.left);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Move to end (with intermediate steps for smoothness)
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      this.client.pointerEvent(Math.round(x), Math.round(y), MOUSE_BUTTONS.left);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Release button
    this.client.pointerEvent(endX, endY, 0);
  }

  /**
   * Scroll at coordinates
   */
  async scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    clicks = 3,
    x?: number,
    y?: number
  ): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    // Default to center of screen
    const scrollX = x ?? Math.round(this.width / 2);
    const scrollY = y ?? Math.round(this.height / 2);

    // Move to position
    this.client.pointerEvent(scrollX, scrollY, 0);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // VNC scroll is done via button 4 (up) and button 5 (down)
    const buttonMask = direction === 'up' ? MOUSE_BUTTONS.scrollUp : MOUSE_BUTTONS.scrollDown;

    for (let i = 0; i < clicks; i++) {
      this.client.pointerEvent(scrollX, scrollY, buttonMask);
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.client.pointerEvent(scrollX, scrollY, 0);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /**
   * Type text
   */
  async type(text: string): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    for (const char of text) {
      const keySym = this.charToKeySym(char);
      const needsShift = this.needsShift(char);

      if (needsShift) {
        this.client.keyEvent(KEY_CODES.shift, true);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      this.client.keyEvent(keySym, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      this.client.keyEvent(keySym, false);

      if (needsShift) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.client.keyEvent(KEY_CODES.shift, false);
      }

      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  }

  /**
   * Press a single key
   */
  async pressKey(key: string): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    const keySym = this.keyToKeySym(key);
    this.client.keyEvent(keySym, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.client.keyEvent(keySym, false);
  }

  /**
   * Press a hotkey combination
   */
  async hotkey(keys: string[]): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    // Press all keys down
    for (const key of keys) {
      const keySym = this.keyToKeySym(key);
      this.client.keyEvent(keySym, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Release all keys in reverse order
    for (const key of keys.reverse()) {
      const keySym = this.keyToKeySym(key);
      this.client.keyEvent(keySym, false);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Convert character to X11 keysym
   */
  private charToKeySym(char: string): number {
    const code = char.charCodeAt(0);

    // ASCII printable characters
    if (code >= 0x20 && code <= 0x7e) {
      // For uppercase and symbols that need shift, return the base keysym
      if (char >= 'A' && char <= 'Z') {
        return code; // Keep uppercase
      }
      return code;
    }

    // Special characters
    const special: Record<string, number> = {
      '\n': KEY_CODES.enter,
      '\r': KEY_CODES.enter,
      '\t': KEY_CODES.tab,
      '\b': KEY_CODES.backspace,
    };

    return special[char] || code;
  }

  /**
   * Check if character needs shift key
   */
  private needsShift(char: string): boolean {
    // Uppercase letters
    if (char >= 'A' && char <= 'Z') return true;

    // Symbols that need shift
    const shiftSymbols = '~!@#$%^&*()_+{}|:"<>?';
    return shiftSymbols.includes(char);
  }

  /**
   * Convert key name to X11 keysym
   */
  private keyToKeySym(key: string): number {
    const lowerKey = key.toLowerCase();

    // Check known keys
    if (KEY_CODES[lowerKey] !== undefined) {
      return KEY_CODES[lowerKey];
    }

    // Single character
    if (key.length === 1) {
      return key.charCodeAt(0);
    }

    // Unknown key
    console.warn(`Unknown key: ${key}, using space`);
    return KEY_CODES.space;
  }

  /**
   * Get connection info
   */
  getConnectionInfo(): VNCConnectionInfo {
    return {
      connected: this.connected,
      host: this.config.host,
      port: this.config.port,
      width: this.width,
      height: this.height,
      pixelFormat: this.pixelFormat || undefined,
      serverName: this.serverName,
    };
  }

  /**
   * Get screen size
   */
  getScreenSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Disconnect from VNC server
   */
  disconnect(): void {
    if (this.client) {
      this.client.end();
      this.client = null;
    }
    this.connected = false;
    this.frameBuffer = null;
  }
}
