/**
 * LLMLingua-2 Token Reduction Provider
 *
 * Uses the @atjsh/llmlingua-2 library (pure JS/TS implementation)
 * to compress prompts using BERT-based models.
 *
 * All provider-specific knobs (model choice, rate, thresholds, token
 * preservation) are encapsulated here and driven by the provider-agnostic
 * CompressionLevel enum.
 *
 * Level presets (estimated token counts via ~4 chars/token heuristic):
 *
 *   default:
 *     - skip if < 800 estimated tokens
 *     - rate = 0.5  (keep ~50 % of tokens)
 *
 *   aggressive:
 *     - skip if < 2000 estimated tokens
 *     - rate = 0.8  (keep ~20 % of tokens)
 */

import type {
  TokenReductionProvider,
  CompressionResult,
  CompressionLevel,
} from './types.js';

// ────────────────────────────────────────────────────────────
// Provider-specific constants
// ────────────────────────────────────────────────────────────

/** HuggingFace ONNX model used by this provider (bert-multilingual, 710 MB). */
const MODEL_NAME = 'Arcoldd/llmlingua4j-bert-base-onnx';

/** Per-level presets.  All tuning lives here. */
interface LevelPreset {
  /** Minimum estimated token count to activate compression */
  activationThreshold: number;
  /** Compression rate passed to llmlingua-2 (0 = remove all, 1 = keep all) */
  rate: number;
}

const LEVEL_PRESETS: Record<CompressionLevel, LevelPreset> = {
  default: { activationThreshold: 800, rate: 0.5 },
  aggressive: { activationThreshold: 2000, rate: 0.8 },
};

/** Tokens that should always be preserved (applies to every level). */
const FORCE_TOKENS = ['\n', '?', '.', '!', ','];

// ────────────────────────────────────────────────────────────
// Provider implementation
// ────────────────────────────────────────────────────────────

export class LLMLingua2Provider implements TokenReductionProvider {
  readonly name = 'llmlingua2' as const;
  private promptCompressor: unknown = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;

    console.log(`[TokenReduction:LLMLingua2] Initializing with model: bert-multilingual (${MODEL_NAME})`);

    try {
      // Suppress noisy ONNX Runtime C++ warnings (level 3 = errors only)
      if (!process.env.ORT_LOG_LEVEL) {
        process.env.ORT_LOG_LEVEL = '3';
      }

      // Dynamic import to avoid loading heavy ML dependencies when disabled
      const { LLMLingua2 } = await import('@atjsh/llmlingua-2');

      // Use js-tiktoken/lite with o200k_base ranks as shown in the library examples
      const { Tiktoken } = await import('js-tiktoken/lite');
      const o200k_base = (await import('js-tiktoken/ranks/o200k_base')).default;
      const oaiTokenizer = new Tiktoken(o200k_base);

      const factoryOptions = {
        transformerJSConfig: {
          device: 'auto' as const,
          dtype: 'fp32' as const,
        },
        oaiTokenizer,
        logger: () => {},
      };

      const result = await LLMLingua2.WithBERTMultilingual(MODEL_NAME, {
        ...factoryOptions,
        modelSpecificOptions: { subfolder: '' },
      });

      this.promptCompressor = result.promptCompressor;
      this.initialized = true;
      console.log(`[TokenReduction:LLMLingua2] Initialized successfully`);
    } catch (error) {
      console.error('[TokenReduction:LLMLingua2] Failed to initialize:', error);
      throw error;
    }
  }

  async compress(text: string, level: CompressionLevel): Promise<CompressionResult> {
    if (!this.initialized || !this.promptCompressor) {
      throw new Error('LLMLingua2 provider not initialized. Call init() first.');
    }

    const preset = LEVEL_PRESETS[level];
    const estimatedTokens = this.estimateTokens(text);

    // Skip compression when below the activation threshold for this level
    if (estimatedTokens < preset.activationThreshold) {
      return {
        compressedText: text,
        originalLength: text.length,
        compressedLength: text.length,
        originalTokenCount: estimatedTokens,
        compressedTokenCount: estimatedTokens,
        tokenSavingsPercent: 0,
        compressionTimeMs: 0,
        provider: 'llmlingua2',
      };
    }

    const startTime = Date.now();

    try {
      const compressor = this.promptCompressor as {
        compress_prompt(context: string, options: Record<string, unknown>): Promise<string>;
      };

      const compressedText = await compressor.compress_prompt(text, {
        rate: preset.rate,
        force_tokens: FORCE_TOKENS,
        force_reserve_digit: true,
        drop_consecutive: true,
      });

      const compressionTimeMs = Date.now() - startTime;
      const compressedTokenCount = this.estimateTokens(compressedText);
      const tokensSaved = estimatedTokens - compressedTokenCount;
      const tokenSavingsPercent = estimatedTokens > 0
        ? Math.round((tokensSaved / estimatedTokens) * 10000) / 100
        : 0;

      return {
        compressedText,
        originalLength: text.length,
        compressedLength: compressedText.length,
        originalTokenCount: estimatedTokens,
        compressedTokenCount,
        tokenSavingsPercent,
        compressionTimeMs,
        provider: 'llmlingua2',
      };
    } catch (error) {
      console.error('[TokenReduction:LLMLingua2] Compression failed:', error);
      // On failure, return the original text unmodified
      return {
        compressedText: text,
        originalLength: text.length,
        compressedLength: text.length,
        originalTokenCount: estimatedTokens,
        compressedTokenCount: estimatedTokens,
        tokenSavingsPercent: 0,
        compressionTimeMs: Date.now() - startTime,
        provider: 'llmlingua2',
      };
    }
  }

  /**
   * Rough token estimate (~4 chars per token for English).
   * Used for activation-threshold checks and stats display only;
   * the actual compression is model-driven.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
