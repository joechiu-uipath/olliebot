/**
 * Type declarations for vnc-rfb-client
 */

declare module 'vnc-rfb-client' {
  interface VncClientOptions {
    debug?: boolean;
    debugLevel?: number;
    encodings?: number[];
  }

  interface VncConnectOptions {
    host: string;
    port: number;
    password?: string;
    set8BitColor?: boolean;
  }

  interface VncClient {
    connect(options: VncConnectOptions): void;
    disconnect(): void;

    getFb(): Buffer;
    clientWidth: number;
    clientHeight: number;

    sendKeyEvent(keysym: number, down: boolean): void;
    sendPointerEvent(
      x: number,
      y: number,
      button1: boolean,
      button2: boolean,
      button3: boolean,
      button4: boolean,
      button5: boolean,
      button6: boolean,
      button7: boolean,
      button8: boolean
    ): void;

    changeFps(fps: number): void;
    requestFrameUpdate(
      incremental: boolean,
      subscribe: boolean,
      x: number,
      y: number,
      width: number,
      height: number
    ): void;

    on(event: 'connected', callback: () => void): void;
    on(event: 'authenticated', callback: () => void): void;
    on(event: 'authError', callback: () => void): void;
    on(event: 'firstFrameUpdate', callback: (fb: Buffer) => void): void;
    on(event: 'frameUpdated', callback: (fb: Buffer) => void): void;
    on(event: 'rectProcessed', callback: (rect: unknown) => void): void;
    on(event: 'disconnect', callback: () => void): void;
    on(event: 'connectTimeout', callback: () => void): void;
    on(event: 'connectError', callback: (error: Error) => void): void;
    on(event: 'cutText', callback: (text: string) => void): void;
  }

  interface VncClientConstructor {
    new (options?: VncClientOptions): VncClient;
    consts: {
      encodings: {
        raw: number;
        copyRect: number;
        hextile: number;
        zrle: number;
        pseudoDesktopSize: number;
        pseudoCursor: number;
      };
    };
  }

  const VncClient: VncClientConstructor;
  export default VncClient;
}
