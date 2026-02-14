/**
 * LLMLingua-2 Token Reduction Provider
 *
 * Uses the @atjsh/llmlingua-2 library (pure JS/TS implementation)
 * to compress prompts using BERT-based models.
 *
 * Supported models:
 * - bert-multilingual (BERT base multilingual cased) - 710MB, good balance
 * - xlm-roberta (XLM-RoBERTa large) - 2240MB, highest accuracy
 *
 * The default is bert-multilingual for reasonable size and performance.
 */

import type {
  TokenReductionProvider,
  CompressionResult,
  CompressOptions,
} from './types.js';

// Model name mapping to HuggingFace ONNX-compatible model repos
const MODEL_MAP: Record<string, string> = {
  'bert-multilingual': 'Arcoldd/llmlingua4j-bert-base-onnx',
  'xlm-roberta': 'atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank',
};

type LLMLingua2ModelType = 'bert-multilingual' | 'xlm-roberta';

export class LLMLingua2Provider implements TokenReductionProvider {
  readonly name = 'llmlingua2' as const;
  private promptCompressor: unknown = null;
  private initialized = false;
  private modelType: LLMLingua2ModelType;
  private modelName: string;

  constructor(model?: string) {
    // Default to bert-multilingual (smaller, faster)
    this.modelType = (model === 'xlm-roberta' ? 'xlm-roberta' : 'bert-multilingual') as LLMLingua2ModelType;
    this.modelName = MODEL_MAP[this.modelType] || model || MODEL_MAP['bert-multilingual'];
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    console.log(`[TokenReduction:LLMLingua2] Initializing with model: ${this.modelType} (${this.modelName})`);

    try {
      // Dynamic import to avoid loading heavy ML dependencies when disabled
      const { LLMLingua2 } = await import('@atjsh/llmlingua-2');

      // Use js-tiktoken/lite with o200k_base ranks as shown in the library examples
      const { Tiktoken } = await import('js-tiktoken/lite');
      const o200k_base = (await import('js-tiktoken/ranks/o200k_base')).default;
      const oaiTokenizer = new Tiktoken(o200k_base);

      // Factory options matching the library's expected interface
      const factoryOptions = {
        transformerJSConfig: {
          device: 'auto' as const,
          dtype: 'fp32' as const,
        },
        oaiTokenizer,
        logger: (msg: unknown) => console.log(`[TokenReduction:LLMLingua2] ${msg}`),
      };

      let result;
      if (this.modelType === 'xlm-roberta') {
        result = await LLMLingua2.WithXLMRoBERTa(this.modelName, {
          ...factoryOptions,
          modelSpecificOptions: { use_external_data_format: true },
        });
      } else {
        result = await LLMLingua2.WithBERTMultilingual(this.modelName, {
          ...factoryOptions,
          modelSpecificOptions: { subfolder: '' },
        });
      }

      this.promptCompressor = result.promptCompressor;
      this.initialized = true;
      console.log(`[TokenReduction:LLMLingua2] Initialized successfully`);
    } catch (error) {
      console.error('[TokenReduction:LLMLingua2] Failed to initialize:', error);
      throw error;
    }
  }

  async compress(text: string, rate: number, options?: CompressOptions): Promise<CompressionResult> {
    if (!this.initialized || !this.promptCompressor) {
      throw new Error('LLMLingua2 provider not initialized. Call init() first.');
    }

    // Skip compression for very short texts (not worth the overhead)
    if (text.length < 100) {
      return {
        compressedText: text,
        originalLength: text.length,
        compressedLength: text.length,
        originalTokenCount: this.estimateTokens(text),
        compressedTokenCount: this.estimateTokens(text),
        tokenSavingsPercent: 0,
        compressionTimeMs: 0,
        provider: 'llmlingua2',
      };
    }

    const startTime = Date.now();
    const originalTokenCount = this.estimateTokens(text);

    try {
      const compressor = this.promptCompressor as {
        compress_prompt(context: string, options: Record<string, unknown>): Promise<string>;
      };

      const compressedText = await compressor.compress_prompt(text, {
        rate,
        force_tokens: options?.forceTokens || ['\n', '?', '.', '!', ','],
        force_reserve_digit: options?.forceReserveDigit ?? true,
        drop_consecutive: options?.dropConsecutive ?? true,
      });

      const compressionTimeMs = Date.now() - startTime;
      const compressedTokenCount = this.estimateTokens(compressedText);
      const tokensSaved = originalTokenCount - compressedTokenCount;
      const tokenSavingsPercent = originalTokenCount > 0
        ? Math.round((tokensSaved / originalTokenCount) * 10000) / 100
        : 0;

      return {
        compressedText,
        originalLength: text.length,
        compressedLength: compressedText.length,
        originalTokenCount,
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
        originalTokenCount,
        compressedTokenCount: originalTokenCount,
        tokenSavingsPercent: 0,
        compressionTimeMs: Date.now() - startTime,
        provider: 'llmlingua2',
      };
    }
  }

  async shutdown(): Promise<void> {
    this.promptCompressor = null;
    this.initialized = false;
    console.log('[TokenReduction:LLMLingua2] Shut down');
  }

  /**
   * Rough token estimate (~4 chars per token for English).
   * This is used for stats display only; the actual compression
   * is model-driven and doesn't depend on this estimate.
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
