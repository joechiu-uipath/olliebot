/**
 * Environment Variable Validation
 *
 * Validates and types all environment variables at startup using Zod.
 * This ensures invalid config values are caught early with clear error messages.
 */

import { z } from 'zod';
import { join } from 'path';

/**
 * LLM provider types
 */
const LLMProviderSchema = z.enum(['anthropic', 'google', 'openai', 'azure_openai']);

/**
 * Web search provider types
 * Must match WebSearchProvider in src/tools/native/web-search.ts
 */
const WebSearchProviderSchema = z.enum(['tavily', 'serper', 'google_custom_search']);

/**
 * Image generation provider types
 */
const ImageGenProviderSchema = z.enum(['openai', 'azure_openai']);

/**
 * Voice provider types
 */
const VoiceProviderSchema = z.enum(['openai', 'azure_openai']);

/**
 * Embedding provider types
 */
const EmbeddingProviderSchema = z.enum(['google', 'openai', 'azure_openai']);

/**
 * Environment variable schema with defaults and validation
 */
const envSchema = z.object({
  // Server
  PORT: z.string().regex(/^\d+$/).transform(Number).default('3000'),
  DB_PATH: z.string().optional(),
  BIND_ADDRESS: z.string().default('127.0.0.1'),

  // LLM Providers
  MAIN_PROVIDER: LLMProviderSchema.default('openai'),
  MAIN_MODEL: z.string().default('gpt-5.2'),
  FAST_PROVIDER: LLMProviderSchema.default('openai'),
  FAST_MODEL: z.string().default('gpt-4.1-mini'),

  // API Keys (optional - validated at runtime based on provider selection)
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Azure OpenAI
  AZURE_OPENAI_API_KEY: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().url().optional().or(z.literal('')),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-02-15-preview'),

  // Embeddings
  EMBEDDING_PROVIDER: EmbeddingProviderSchema.default('openai'),

  // MCP Client (connecting to external MCP servers)
  MCP_SERVERS: z.string().default('[]'),

  // MCP Server (OllieBot as MCP server)
  MCP_SERVER_ENABLED: z.string().transform(v => v === 'true').default('false'),
  MCP_SERVER_SECRET: z.string().optional(),
  MCP_SERVER_AUTH_DISABLED: z.string().transform(v => v === 'true').default('false'),

  // Image Generation
  IMAGE_GEN_PROVIDER: ImageGenProviderSchema.default('openai'),
  IMAGE_GEN_MODEL: z.string().default('dall-e-3'),

  // Web Search
  WEB_SEARCH_PROVIDER: WebSearchProviderSchema.default('tavily'),
  WEB_SEARCH_API_KEY: z.string().optional(),
  GOOGLE_CUSTOM_SEARCH_ENGINE_ID: z.string().optional(),

  // Deep Research
  DEEP_RESEARCH_PROVIDER: LLMProviderSchema.optional(),
  DEEP_RESEARCH_MODEL: z.string().optional(),

  // Voice
  VOICE_PROVIDER: VoiceProviderSchema.default('azure_openai'),
  VOICE_MODEL: z.string().default('gpt-4o-realtime-preview'),
});

/**
 * Parsed and validated environment type
 */
export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Validate environment variables at startup.
 * Throws ZodError with detailed messages if validation fails.
 */
export function validateEnv(): ValidatedEnv {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('[Config] Environment variable validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Invalid environment configuration. See errors above.');
  }

  return result.data;
}

/**
 * Build the CONFIG object from validated environment variables.
 * This replaces the loose type-casting approach.
 */
export function buildConfig(env: ValidatedEnv) {
  return {
    port: env.PORT,
    dbPath: env.DB_PATH || join(process.cwd(), 'user', 'data', 'olliebot.db'),
    bindAddress: env.BIND_ADDRESS,
    tasksDir: join(process.cwd(), 'user', 'tasks'),
    missionsDir: join(process.cwd(), 'user', 'missions'),
    skillsDir: join(process.cwd(), 'user', 'skills'),
    userToolsDir: join(process.cwd(), 'user', 'tools'),
    ragDir: join(process.cwd(), 'user', 'rag'),

    // LLM Configuration
    mainProvider: env.MAIN_PROVIDER,
    mainModel: env.MAIN_MODEL,
    fastProvider: env.FAST_PROVIDER,
    fastModel: env.FAST_MODEL,

    // API Keys
    anthropicApiKey: env.ANTHROPIC_API_KEY || '',
    googleApiKey: env.GOOGLE_API_KEY || '',
    openaiApiKey: env.OPENAI_API_KEY || '',

    // Azure OpenAI
    azureOpenaiApiKey: env.AZURE_OPENAI_API_KEY || '',
    azureOpenaiEndpoint: env.AZURE_OPENAI_ENDPOINT || '',
    azureOpenaiApiVersion: env.AZURE_OPENAI_API_VERSION,

    // Embeddings
    embeddingProvider: env.EMBEDDING_PROVIDER,

    // MCP Configuration
    mcpServers: env.MCP_SERVERS,

    // MCP Server (OllieBot as MCP server)
    mcpServerEnabled: env.MCP_SERVER_ENABLED,
    mcpServerSecret: env.MCP_SERVER_SECRET || '',
    mcpServerAuthDisabled: env.MCP_SERVER_AUTH_DISABLED,

    // Image Generation
    imageGenProvider: env.IMAGE_GEN_PROVIDER,
    imageGenModel: env.IMAGE_GEN_MODEL,

    // Web Search
    webSearchProvider: env.WEB_SEARCH_PROVIDER,
    webSearchApiKey: env.WEB_SEARCH_API_KEY || '',
    googleCustomSearchEngineId: env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID || '',

    // Deep Research (falls back to main provider/model)
    deepResearchProvider: env.DEEP_RESEARCH_PROVIDER || env.MAIN_PROVIDER,
    deepResearchModel: env.DEEP_RESEARCH_MODEL || env.MAIN_MODEL,

    // Voice
    voiceProvider: env.VOICE_PROVIDER,
    voiceModel: env.VOICE_MODEL,
    voiceVoice: 'alloy' as const,
  };
}

export type AppConfig = ReturnType<typeof buildConfig>;
