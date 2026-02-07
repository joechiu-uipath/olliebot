/**
 * VNC Client Wrapper
 *
 * Wraps the vnc-rfb-client library to provide a clean interface for VNC operations.
 * Handles screenshot capture, mouse/keyboard input, and connection management.
 */

import { EventEmitter } from 'events';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import type {
  VNCConfig,
  VNCConnectionInfo,
  PixelFormat,
  DesktopAction,
  ActionResult,
} from './types';

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

export interface VNCClientEvents {
  connect: () => void;
  disconnect: () => void;
  error: (error: Error) => void;
  frame: (screenshot: string) => void;
  clipboard: (text: string) => void;
}

// Import types from declaration file
import type VncClientType from 'vnc-rfb-client';
type VncRfbClient = InstanceType<typeof VncClientType>;
type VncRfbClientModule = typeof VncClientType;

/**
 * Patch vnc-rfb-client to use pure JavaScript DES instead of Node crypto.
 * Node.js 17+ with OpenSSL 3.0 removed support for legacy DES algorithm.
 */
async function patchVncRfbClient(VncClient: VncRfbClientModule): Promise<void> {
  // Import our pure JS d3des implementation
  const d3des = await import('./d3des.js');

  // Monkey-patch the prototype to use d3des instead of Node crypto
  const proto = VncClient.prototype as Record<string, unknown>;
  const original = proto._handleAuthChallenge as () => Promise<void>;

  if ((proto as { _patchedForDes?: boolean })._patchedForDes) {
    return; // Already patched
  }

  proto._handleAuthChallenge = async function (this: VncRfbClient & {
    _challengeResponseSent: boolean;
    _socketBuffer: { readUInt32BE: () => number; buffer: Buffer; waitBytes: (n: number, msg: string) => Promise<void> };
    _authenticated: boolean;
    _expectingChallenge: boolean;
    _password: string;
    _log: (msg: string, debug: boolean, level?: number) => void;
    sendData: (data: Buffer) => void;
    _sendClientInit: () => void;
    resetState: () => void;
    emit: (event: string, ...args: unknown[]) => void;
  }) {
    if (this._challengeResponseSent) {
      // Challenge response already sent. Checking result.
      if (this._socketBuffer.readUInt32BE() === 0) {
        this._log('Authenticated successfully (d3des)', true);
        this._authenticated = true;
        this.emit('authenticated');
        this._expectingChallenge = false;
        this._sendClientInit();
      } else {
        this._log('Authentication failed', true);
        this.emit('authError');
        this.resetState();
      }
    } else {
      // Wait for the 16-byte challenge to arrive (important!)
      this._log('Challenge received, waiting for 16 bytes...', true);
      await this._socketBuffer.waitBytes(16, 'Auth challenge');

      // Use d3des pure JS implementation instead of Node crypto
      const challenge = this._socketBuffer.buffer.slice(0, 16);
      const response = d3des.response(challenge, this._password || '');

      this._log('Sending response (d3des): ' + response.toString('hex'), true, 2);

      this.sendData(response);
      this._challengeResponseSent = true;
    }
  };

  (proto as { _patchedForDes?: boolean })._patchedForDes = true;
  console.log('[VNCClient] Patched vnc-rfb-client to use pure JS DES (OpenSSL 3.0 compatible)');
}

export class VNCClient extends EventEmitter {
  private client: VncRfbClient | null = null;
  private config: VNCConfig;
  private connected = false;
  private width = 0;
  private height = 0;
  private pixelFormat: PixelFormat | null = null;
  private serverName = '';
  private hasFirstFrame = false;

  // Change detection state
  private lastFrameHash: number = 0;
  private lastScreenshot: string | null = null;
  private unchangedFrameCount = 0;

  constructor(config: VNCConfig) {
    super();
    this.config = {
      connectTimeout: 30000,
      ...config,
    };
  }

  /**
   * Connect to VNC server
   */
  async connect(): Promise<VNCConnectionInfo> {
    const tag = `[VNCClient]`;
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.connectTimeout || 30000;
      console.log(`${tag} connect: Starting (host=${this.config.host}, port=${this.config.port}, timeout=${timeoutMs}ms)`);

      let settled = false;
      const timeoutId = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.error(`${tag} connect: TIMEOUT after ${timeoutMs}ms`);
          reject(new Error(`Connection timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // Dynamic import of vnc-rfb-client
      console.log(`${tag} connect: Loading vnc-rfb-client module...`);
      import('vnc-rfb-client').then(async (module) => {
        const VncClient = module.default as VncRfbClientModule;
        console.log(`${tag} connect: vnc-rfb-client loaded`);

        // Patch to use pure JS DES (OpenSSL 3.0 compatibility)
        await patchVncRfbClient(VncClient);

        // Create client with supported encodings (Raw, CopyRect, Hextile, ZRLE)
        this.client = new VncClient({
          debug: false,
          debugLevel: 0,
          encodings: [
            VncClient.consts.encodings.copyRect,
            VncClient.consts.encodings.zrle,
            VncClient.consts.encodings.hextile,
            VncClient.consts.encodings.raw,
            VncClient.consts.encodings.pseudoDesktopSize,
          ],
        });

        this.client.on('connected', () => {
          console.log(`${tag} connected event`);
        });

        this.client.on('authenticated', () => {
          console.log(`${tag} authenticated event`);
        });

        this.client.on('authError', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            console.error(`${tag} authError event - password rejected`);
            reject(new Error('VNC authentication failed - wrong password'));
          }
        });

        this.client.on('firstFrameUpdate', (fb: Buffer) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);

            this.connected = true;
            this.hasFirstFrame = true;
            this.width = this.client!.clientWidth;
            this.height = this.client!.clientHeight;
            this.serverName = 'VNC Server';

            // Default pixel format (vnc-rfb-client normalizes to RGBA)
            this.pixelFormat = {
              bitsPerPixel: 32,
              depth: 24,
              bigEndianFlag: false,
              trueColorFlag: true,
              redMax: 255,
              greenMax: 255,
              blueMax: 255,
              redShift: 0,
              greenShift: 8,
              blueShift: 16,
            };

            // Check if framebuffer has content
            const firstNonZero = fb.findIndex(b => b !== 0);
            const hasContent = firstNonZero >= 0;
            console.log(`${tag} firstFrameUpdate: ${this.width}x${this.height}, fbSize=${fb.length}, hasContent=${hasContent}${hasContent ? ` (first non-zero at byte ${firstNonZero})` : ''}`);

            // Set FPS for updates
            this.client!.changeFps(5);

            this.emit('connect');

            resolve({
              connected: true,
              host: this.config.host,
              port: this.config.port,
              width: this.width,
              height: this.height,
              pixelFormat: this.pixelFormat,
              serverName: this.serverName,
            });
          }
        });

        this.client.on('frameUpdated', () => {
          // Frame updated, can capture new screenshot
        });

        this.client.on('disconnect', () => {
          console.log(`${tag} disconnect event`);
          this.connected = false;
          this.emit('disconnect');
        });

        this.client.on('connectTimeout', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            console.error(`${tag} connectTimeout event`);
            reject(new Error('VNC connection timeout'));
          }
        });

        this.client.on('connectError', (error: Error) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            console.error(`${tag} connectError event: ${error.message}`);
            reject(error);
          }
        });

        this.client.on('cutText', (text: string) => {
          this.emit('clipboard', text);
        });

        // Connect
        console.log(`${tag} connect: Connecting to ${this.config.host}:${this.config.port}...`);
        this.client.connect({
          host: this.config.host,
          port: this.config.port,
          password: this.config.password || '',
          set8BitColor: false,
        });

      }).catch((error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeoutId);
          console.error(`${tag} connect: Failed to load vnc-rfb-client: ${error.message}`);
          reject(new Error(`Failed to load vnc-rfb-client: ${error.message}`));
        }
      });
    });
  }

  /**
   * Fast hash of framebuffer for change detection.
   * Samples every Nth pixel for speed.
   */
  private computeFrameHash(fb: Buffer): number {
    // Sample every 1000th byte for a quick hash
    let hash = 0;
    const step = 1000;
    for (let i = 0; i < fb.length; i += step) {
      hash = ((hash << 5) - hash + fb[i]) | 0;
    }
    return hash;
  }

  /**
   * Capture screenshot as base64 JPEG (fast) or PNG.
   * Includes change detection - returns cached screenshot if frame unchanged.
   *
   * @param format - 'jpeg' (default, fast) or 'png' (lossless)
   * @param quality - JPEG quality 1-100 (default: 80)
   * @param forceCapture - Skip change detection and always encode
   * @returns Object with screenshot and whether it changed since last capture
   */
  async captureScreenshotWithChangeInfo(options?: {
    format?: 'jpeg' | 'png';
    quality?: number;
    forceCapture?: boolean;
  }): Promise<{ screenshot: string; changed: boolean; mimeType: string }> {
    const t0 = Date.now();
    const tag = '[VNCClient] captureScreenshot:';
    const format = options?.format || 'jpeg';
    const quality = options?.quality || 80;
    const forceCapture = options?.forceCapture || false;
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';

    if (!this.connected || !this.client) {
      throw new Error('Not connected to VNC server');
    }

    // Get framebuffer directly from vnc-rfb-client
    const fb = this.client.getFb();
    const t1 = Date.now();

    if (!fb || fb.length === 0) {
      throw new Error('No framebuffer available');
    }

    // Change detection - compute quick hash and compare
    const currentHash = this.computeFrameHash(fb);
    const t2 = Date.now();

    if (!forceCapture && currentHash === this.lastFrameHash && this.lastScreenshot) {
      this.unchangedFrameCount++;
      // Only log occasionally to avoid spam
      if (this.unchangedFrameCount % 10 === 0) {
        console.log(`${tag} unchanged (${this.unchangedFrameCount} frames), returning cached`);
      }
      return { screenshot: this.lastScreenshot, changed: false, mimeType };
    }

    // Frame changed - reset counter and encode
    if (this.unchangedFrameCount > 0) {
      console.log(`${tag} frame changed after ${this.unchangedFrameCount} unchanged frames`);
    }
    this.unchangedFrameCount = 0;
    this.lastFrameHash = currentHash;

    // Use sharp for fast encoding
    // vnc-rfb-client returns RGBA buffer
    const t3 = Date.now();
    let outputBuffer: Buffer;

    if (format === 'jpeg') {
      outputBuffer = await sharp(fb, {
        raw: { width: this.width, height: this.height, channels: 4 }
      })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
    } else {
      outputBuffer = await sharp(fb, {
        raw: { width: this.width, height: this.height, channels: 4 }
      })
        .png({ compressionLevel: 6 })
        .toBuffer();
    }
    const t4 = Date.now();

    const base64 = outputBuffer.toString('base64');
    const t5 = Date.now();

    // Cache the screenshot
    this.lastScreenshot = base64;

    console.log(`${tag} ${this.width}x${this.height} ${format.toUpperCase()}, getFb=${t1-t0}ms, hash=${t2-t1}ms, encode=${t4-t3}ms, base64=${t5-t4}ms, total=${t5-t0}ms, size=${(base64.length/1024).toFixed(1)}KB`);

    return { screenshot: base64, changed: true, mimeType };
  }

  /**
   * Capture screenshot as base64 JPEG (fast) or PNG.
   * Includes change detection - returns cached screenshot if frame unchanged.
   *
   * @param format - 'jpeg' (default, fast) or 'png' (lossless)
   * @param quality - JPEG quality 1-100 (default: 80)
   * @param forceCapture - Skip change detection and always encode
   */
  async captureScreenshot(options?: {
    format?: 'jpeg' | 'png';
    quality?: number;
    forceCapture?: boolean;
  }): Promise<string> {
    const result = await this.captureScreenshotWithChangeInfo(options);
    return result.screenshot;
  }

  /**
   * Legacy PNG capture method (slower, for compatibility)
   */
  async captureScreenshotPng(): Promise<string> {
    const t0 = Date.now();
    const tag = '[VNCClient] captureScreenshotPng:';

    if (!this.connected || !this.client) {
      throw new Error('Not connected to VNC server');
    }

    const fb = this.client.getFb();

    if (!fb || fb.length === 0) {
      throw new Error('No framebuffer available');
    }

    // vnc-rfb-client returns RGBA buffer, convert to PNG using pngjs
    const png = new PNG({ width: this.width, height: this.height });
    fb.copy(png.data, 0, 0, Math.min(fb.length, png.data.length));

    const pngBuffer = PNG.sync.write(png);
    const base64 = pngBuffer.toString('base64');

    console.log(`${tag} ${this.width}x${this.height}, total=${Date.now()-t0}ms, size=${(base64.length/1024).toFixed(1)}KB`);

    return base64;
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
   * Send pointer event using vnc-rfb-client's 8-button interface
   */
  private sendPointer(x: number, y: number, buttons: { left?: boolean; middle?: boolean; right?: boolean; scrollUp?: boolean; scrollDown?: boolean } = {}): void {
    if (!this.client) throw new Error('Not connected');

    this.client.sendPointerEvent(
      x, y,
      buttons.left || false,      // button1 (left)
      buttons.middle || false,    // button2 (middle)
      buttons.right || false,     // button3 (right)
      buttons.scrollUp || false,  // button4 (scroll up)
      buttons.scrollDown || false, // button5 (scroll down)
      false,                      // button6
      false,                      // button7
      false                       // button8
    );
  }

  /**
   * Move mouse to coordinates
   */
  async moveMouse(x: number, y: number): Promise<void> {
    this.sendPointer(x, y);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  /**
   * Left click at coordinates
   */
  async click(x: number, y: number): Promise<void> {
    // Move to position
    this.sendPointer(x, y);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Press left button
    this.sendPointer(x, y, { left: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Release
    this.sendPointer(x, y);
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
    this.sendPointer(x, y);
    await new Promise((resolve) => setTimeout(resolve, 10));

    this.sendPointer(x, y, { right: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.sendPointer(x, y);
  }

  /**
   * Drag from one point to another
   */
  async drag(startX: number, startY: number, endX: number, endY: number): Promise<void> {
    // Move to start
    this.sendPointer(startX, startY);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Press button
    this.sendPointer(startX, startY, { left: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Move to end (with intermediate steps for smoothness)
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const x = startX + ((endX - startX) * i) / steps;
      const y = startY + ((endY - startY) * i) / steps;
      this.sendPointer(Math.round(x), Math.round(y), { left: true });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Release button
    this.sendPointer(endX, endY);
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
    // Default to center of screen
    const scrollX = x ?? Math.round(this.width / 2);
    const scrollY = y ?? Math.round(this.height / 2);

    // Move to position
    this.sendPointer(scrollX, scrollY);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const isUp = direction === 'up';
    const isDown = direction === 'down';

    for (let i = 0; i < clicks; i++) {
      this.sendPointer(scrollX, scrollY, { scrollUp: isUp, scrollDown: isDown });
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.sendPointer(scrollX, scrollY);
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
        this.client.sendKeyEvent(KEY_CODES.shift, true);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      this.client.sendKeyEvent(keySym, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      this.client.sendKeyEvent(keySym, false);

      if (needsShift) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        this.client.sendKeyEvent(KEY_CODES.shift, false);
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
    this.client.sendKeyEvent(keySym, true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.client.sendKeyEvent(keySym, false);
  }

  /**
   * Press a hotkey combination
   */
  async hotkey(keys: string[]): Promise<void> {
    if (!this.client) throw new Error('Not connected');

    // Press all keys down
    for (const key of keys) {
      const keySym = this.keyToKeySym(key);
      this.client.sendKeyEvent(keySym, true);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Release all keys in reverse order
    for (const key of [...keys].reverse()) {
      const keySym = this.keyToKeySym(key);
      this.client.sendKeyEvent(keySym, false);
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
      pixelFormat: this.pixelFormat ?? undefined,
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
      this.client.disconnect();
      this.client = null;
    }
    this.connected = false;
    this.hasFirstFrame = false;
  }
}
