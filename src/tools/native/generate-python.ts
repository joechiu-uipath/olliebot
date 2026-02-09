/**
 * Generate Python Native Tool
 *
 * Generates Python code based on user input using an LLM.
 */

import type { NativeTool, NativeToolResult } from './types.js';
import type { LLMService } from '../../llm/service.js';

export interface GeneratePythonConfig {
  llmService: LLMService;
}

export class GeneratePythonTool implements NativeTool {
  readonly name = 'generate_python';
  readonly description =
    'Generate Python code based on a natural language description. Returns syntactically correct Python code that can be executed.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Natural language description of what the Python code should do',
      },
      context: {
        type: 'string',
        description: 'Optional additional context or requirements for the code generation',
      },
    },
    required: ['description'],
  };

  private llmService: GeneratePythonConfig['llmService'];

  constructor(config: GeneratePythonConfig) {
    this.llmService = config.llmService;
  }

  async execute(params: Record<string, unknown>): Promise<NativeToolResult> {
    const description = String(params.description || '');
    const context = String(params.context || '');

    if (!description.trim()) {
      return {
        success: false,
        error: 'description parameter is required',
      };
    }

    try {
      const systemPrompt = `You are a Python code generator. Generate clean, efficient, and well-commented Python code based on user requirements.

Rules:
- Return ONLY the Python code, no explanations or markdown formatting
- Include comments to explain complex logic
- Use standard library when possible
- Code should be production-ready and follow Python best practices
- If the task requires data visualization, use matplotlib or plotly
- Handle potential errors appropriately`;

      const userMessage = context
        ? `${description}\n\nAdditional context: ${context}`
        : description;

      const response = await this.llmService.quickGenerate(
        [
          {
            role: 'user',
            content: userMessage,
          },
        ],
        {
          systemPrompt,
          maxTokens: 4096,
        }
      );

      const code = response.content.trim();

      // Remove markdown code blocks if present
      const cleanedCode = code
        .replace(/^```python\s*\n?/i, '')
        .replace(/^```\s*\n?/, '')
        .replace(/\n?```\s*$/g, '')
        .trim();

      return {
        success: true,
        output: cleanedCode,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to generate Python code: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
