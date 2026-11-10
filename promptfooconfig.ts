/**
 * OllieBot Promptfoo Evaluation Config
 *
 * TypeScript config — no YAML.
 * Run with: pnpm eval
 * View results: pnpm eval:view
 *
 * Test cases are in prompt-tests/*.yaml (organized by category).
 */

import type { UnifiedConfig } from 'promptfoo';

const config: UnifiedConfig = {
  description: 'OllieBot Agent Evaluation Suite',

  // The prompt template is a passthrough — OllieBot builds its own system prompt internally.
  // {{message}} is replaced with the test case's `message` variable.
  prompts: ['{{message}}'],

  providers: [
    {
      // Custom provider wrapping OllieBot's agent loop
      id: 'file://src/evaluation/promptfoo-provider.ts',
      label: 'OllieBot Supervisor',
      config: {
        target: 'supervisor',
        maxToolIterations: 5,
      },
    },
  ],

  // Default test settings
  defaultTest: {
    options: {
      // Use a capable model for LLM-rubric grading
      provider: 'openai:gpt-4o',
    },
  },

  // Test cases loaded from external JSON files
  tests: [
    'file://prompt-tests/basic-qa.json',
    'file://prompt-tests/delegation.json',
    'file://prompt-tests/response-quality.json',
    'file://prompt-tests/edge-cases.json',
  ],
};

export default config;
