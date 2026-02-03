/**
 * Model Capabilities
 *
 * Defines which models support reasoning/thinking features and at what levels.
 *
 * Sources:
 * - OpenAI: https://platform.openai.com/docs/guides/reasoning
 * - Anthropic: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
 * - Google: https://ai.google.dev/gemini-api/docs/thinking
 *
 * Note: Different providers use different API mechanisms:
 * - OpenAI: `reasoning_effort` parameter (none/minimal/low/medium/high/xhigh)
 * - Anthropic: `thinking.budget_tokens` for extended thinking, `effort` param for Opus 4.5
 * - Google: `thinking_level` for Gemini 3, `thinking_budget` for Gemini 2.5
 *
 * The UI shows 'high' as "Think" and 'xhigh' as "Think+" for enhanced reasoning.
 */

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelCapabilities {
  supportsReasoningEffort: boolean;
  /** Available reasoning levels above default (for UI selection) */
  reasoningEfforts: ReasoningEffort[];
  /** Default reasoning level for this model */
  defaultEffort?: ReasoningEffort;
}

/**
 * Model capabilities lookup table (by model name only, provider-agnostic).
 * reasoningEfforts lists levels ABOVE default that users can select in the UI.
 * 'high' = "Think" mode, 'xhigh' = "Think+" mode
 */
export const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  // ==========================================================================
  // OpenAI Models (use reasoning_effort parameter)
  // ==========================================================================

  // O-series models (support low, medium, high - default is medium)
  'o1': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'o3': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'o3-mini': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'o3-pro': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'o4-mini': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // GPT-5 base series (support minimal, low, medium, high - default is medium)
  'gpt-5': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gpt-5-mini': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gpt-5-nano': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gpt-5-codex': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // GPT-5-pro only supports high (and it's the default)
  'gpt-5-pro': { supportsReasoningEffort: false, reasoningEfforts: [], defaultEffort: 'high' },

  // GPT-5.1 series (gpt-5.1 defaults to 'none', others default to 'medium')
  'gpt-5.1': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'none' },
  'gpt-5.1-chat': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gpt-5.1-codex': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gpt-5.1-codex-mini': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // GPT-5.1-codex-max and GPT-5.2 support xhigh
  'gpt-5.1-codex-max': { supportsReasoningEffort: true, reasoningEfforts: ['high', 'xhigh'], defaultEffort: 'medium' },
  'gpt-5.2': { supportsReasoningEffort: true, reasoningEfforts: ['high', 'xhigh'], defaultEffort: 'medium' },
  'gpt-5.2-codex': { supportsReasoningEffort: true, reasoningEfforts: ['high', 'xhigh'], defaultEffort: 'medium' },

  // ==========================================================================
  // Anthropic Claude Models (use thinking.budget_tokens or effort parameter)
  // Extended thinking uses budget_tokens; effort param only on Opus 4.5
  // ==========================================================================

  // Claude Opus 4.5 - supports effort parameter (low/medium/high)
  'claude-opus-4-5-20251101': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // Claude 4 models - support extended thinking (budget_tokens)
  'claude-sonnet-4-5-20250929': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-sonnet-4-20250514': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-opus-4-20250514': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-opus-4-1-20250805': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-haiku-4-5-20251001': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // Claude 3.7 Sonnet - supports extended thinking
  'claude-3-7-sonnet-20250219': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // Shorter aliases for Claude models
  'claude-opus-4-5': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-sonnet-4-5': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-sonnet-4': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-opus-4': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-opus-4-1': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-haiku-4-5': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'claude-3-7-sonnet': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // ==========================================================================
  // Google Gemini Models (use thinking_level or thinking_budget)
  // Gemini 3: thinking_level (minimal/low/medium/high)
  // Gemini 2.5: thinking_budget (token count, 0 to disable, -1 for dynamic)
  // ==========================================================================

  // Gemini 3 models - use thinking_level parameter
  'gemini-3-pro': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gemini-3-flash': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // Gemini 2.5 models - use thinking_budget parameter
  'gemini-2.5-pro': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gemini-2.5-flash': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gemini-2.5-flash-lite': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },

  // Aliases with version suffixes
  'gemini-2.5-pro-preview': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
  'gemini-2.5-flash-preview': { supportsReasoningEffort: true, reasoningEfforts: ['high'], defaultEffort: 'medium' },
};

/**
 * Get model capabilities for a given model.
 * Provider is accepted for API compatibility but not used in lookup.
 */
export function getModelCapabilities(_provider: string, model: string): ModelCapabilities {
  return MODEL_CAPABILITIES[model] || { supportsReasoningEffort: false, reasoningEfforts: [] };
}
