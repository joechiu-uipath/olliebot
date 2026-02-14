/**
 * Token Reduction Types
 *
 * Type definitions for the input token reduction / prompt compression system.
 * Supports a multi-provider architecture where different compression backends
 * can be plugged in (LLMLingua-2, future providers, etc.).
 */

// ============================================================
// Provider configuration
// ============================================================

export type TokenReductionProviderType = 'llmlingua2';

/**
 * Provider-agnostic compression level.
 *
 * Each provider maps these levels to its own set of thresholds, rates,
 * and options.  Users pick a level; the provider picks the knobs.
 *
 * - default:    light compression, safe for most prompts
 * - aggressive: heavy compression, best for very large prompts
 */
export type CompressionLevel = 'default' | 'aggressive';

export interface TokenReductionConfig {
  /** Whether token reduction is enabled */
  enabled: boolean;
  /** Which provider to use */
  provider: TokenReductionProviderType;
  /** Provider-agnostic compression level */
  compressionLevel: CompressionLevel;
}

// ============================================================
// Compression result
// ============================================================

export interface CompressionResult {
  /** The compressed text */
  compressedText: string;
  /** Original text length in characters */
  originalLength: number;
  /** Compressed text length in characters */
  compressedLength: number;
  /** Estimated original token count */
  originalTokenCount: number;
  /** Estimated compressed token count */
  compressedTokenCount: number;
  /** Percentage of tokens saved (0-100) */
  tokenSavingsPercent: number;
  /** Time taken for compression in milliseconds */
  compressionTimeMs: number;
  /** Which provider performed the compression */
  provider: TokenReductionProviderType;
}

// ============================================================
// Provider interface
// ============================================================

export interface TokenReductionProvider {
  readonly name: TokenReductionProviderType;

  /** Initialize the provider (load models, etc.) */
  init(): Promise<void>;

  /** Compress a text prompt at the given compression level */
  compress(text: string, level: CompressionLevel): Promise<CompressionResult>;

  /** Shut down the provider (unload models, etc.) */
  shutdown(): Promise<void>;
}

// ============================================================
// Aggregate stats for tracking over time
// ============================================================

export interface TokenReductionStats {
  /** Total number of compressions performed */
  totalCompressions: number;
  /** Total original tokens across all compressions */
  totalOriginalTokens: number;
  /** Total compressed tokens across all compressions */
  totalCompressedTokens: number;
  /** Total tokens saved */
  totalTokensSaved: number;
  /** Overall percentage of tokens saved */
  overallSavingsPercent: number;
  /** Total time spent on compression in ms */
  totalCompressionTimeMs: number;
  /** Average compression time per call in ms */
  avgCompressionTimeMs: number;
}
