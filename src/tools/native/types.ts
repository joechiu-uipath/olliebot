/**
 * Native Tool Interface
 *
 * Defines the contract for native (built-in) tools.
 */

export interface NativeToolResult {
  success: boolean;
  output?: unknown;
  error?: string;
  /** Image data for tools that return visual content */
  image?: {
    type: 'base64';
    media_type: 'image/png' | 'image/jpeg' | 'image/webp';
    data: string;
  };
}

export interface NativeTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;

  execute(params: Record<string, unknown>): Promise<NativeToolResult>;
}
