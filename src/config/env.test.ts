/**
 * Unit tests for Environment Variable Validation
 *
 * Tests the Zod-based env validation and config building.
 * Maps to e2e test plan: CONFIG-001 (env validation)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEnv, buildConfig } from './env.js';
import { 
  DEFAULT_TEST_PORT, 
  ALTERNATIVE_TEST_PORT, 
  DEFAULT_BIND_ADDRESS 
} from '../test-helpers/index.js';

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Start with a clean env for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns defaults when minimal env is set', () => {
    // Remove any existing values that would conflict
    delete process.env.PORT;
    delete process.env.MAIN_PROVIDER;
    delete process.env.MAIN_MODEL;

    const env = validateEnv();
    expect(env.PORT).toBe(DEFAULT_TEST_PORT);
    expect(env.MAIN_PROVIDER).toBe('openai');
    expect(env.MAIN_MODEL).toBe('gpt-5.2');
    expect(env.BIND_ADDRESS).toBe(DEFAULT_BIND_ADDRESS);
  });

  it('parses PORT as number', () => {
    process.env.PORT = String(ALTERNATIVE_TEST_PORT);
    const env = validateEnv();
    expect(env.PORT).toBe(ALTERNATIVE_TEST_PORT);
    expect(typeof env.PORT).toBe('number');
  });

  it('throws on invalid PORT (non-numeric)', () => {
    process.env.PORT = 'abc';
    expect(() => validateEnv()).toThrow('Invalid environment configuration');
  });

  it('accepts valid LLM provider values', () => {
    process.env.MAIN_PROVIDER = 'anthropic';
    process.env.FAST_PROVIDER = 'google';
    const env = validateEnv();
    expect(env.MAIN_PROVIDER).toBe('anthropic');
    expect(env.FAST_PROVIDER).toBe('google');
  });

  it('throws on invalid LLM provider', () => {
    process.env.MAIN_PROVIDER = 'invalid_provider';
    expect(() => validateEnv()).toThrow('Invalid environment configuration');
  });

  it('parses boolean-like strings for MCP_SERVER_ENABLED', () => {
    process.env.MCP_SERVER_ENABLED = 'true';
    const env = validateEnv();
    expect(env.MCP_SERVER_ENABLED).toBe(true);
  });

  it('treats non-true string as false for MCP_SERVER_ENABLED', () => {
    process.env.MCP_SERVER_ENABLED = 'false';
    const env = validateEnv();
    expect(env.MCP_SERVER_ENABLED).toBe(false);
  });

  it('accepts valid web search provider', () => {
    process.env.WEB_SEARCH_PROVIDER = 'serper';
    const env = validateEnv();
    expect(env.WEB_SEARCH_PROVIDER).toBe('serper');
  });

  it('accepts valid image gen provider', () => {
    process.env.IMAGE_GEN_PROVIDER = 'azure_openai';
    const env = validateEnv();
    expect(env.IMAGE_GEN_PROVIDER).toBe('azure_openai');
  });

  it('accepts optional API keys', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test-key';
    const env = validateEnv();
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test-key');
  });
});

describe('buildConfig', () => {
  it('builds config object from validated env', () => {
    const env = validateEnv();
    const config = buildConfig(env);

    expect(config.port).toBe(env.PORT);
    expect(config.mainProvider).toBe(env.MAIN_PROVIDER);
    expect(config.mainModel).toBe(env.MAIN_MODEL);
    expect(config.fastProvider).toBe(env.FAST_PROVIDER);
    expect(config.fastModel).toBe(env.FAST_MODEL);
  });

  it('sets default DB path when not specified', () => {
    const env = validateEnv();
    const config = buildConfig(env);
    expect(config.dbPath).toContain('olliebot.db');
  });

  it('uses specified DB path when provided', () => {
    process.env.DB_PATH = '/custom/path/db.sqlite';
    const env = validateEnv();
    const config = buildConfig(env);
    expect(config.dbPath).toBe('/custom/path/db.sqlite');
    delete process.env.DB_PATH;
  });

  it('falls back to main provider/model for deep research', () => {
    const env = validateEnv();
    const config = buildConfig(env);
    expect(config.deepResearchProvider).toBe(config.mainProvider);
    expect(config.deepResearchModel).toBe(config.mainModel);
  });

  it('uses explicit deep research provider when set', () => {
    process.env.DEEP_RESEARCH_PROVIDER = 'anthropic';
    process.env.DEEP_RESEARCH_MODEL = 'claude-sonnet-4';
    const env = validateEnv();
    const config = buildConfig(env);
    expect(config.deepResearchProvider).toBe('anthropic');
    expect(config.deepResearchModel).toBe('claude-sonnet-4');
    delete process.env.DEEP_RESEARCH_PROVIDER;
    delete process.env.DEEP_RESEARCH_MODEL;
  });

  it('defaults empty strings for missing API keys', () => {
    const env = validateEnv();
    const config = buildConfig(env);
    // API keys default to empty string when not set
    expect(typeof config.anthropicApiKey).toBe('string');
    expect(typeof config.googleApiKey).toBe('string');
  });
});
