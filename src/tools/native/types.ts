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
  /**
   * When true, this tool is only available to supervisor agents.
   * Private tools are automatically included in supervisor's tool list
   * without explicit configuration, and excluded from other agents
   * unless explicitly granted.
   */
  readonly private?: boolean;

  execute(params: Record<string, unknown>): Promise<NativeToolResult>;
}
