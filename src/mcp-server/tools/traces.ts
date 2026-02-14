/**
 * MCP Tool Handlers: Trace & Observability
 *
 * Tools: list_traces, get_trace, get_llm_calls, get_llm_call_detail, get_trace_stats
 *
 * Provides access to execution traces, LLM call details (token counts, durations,
 * request/response data), and aggregated statistics. Useful for validating agentic
 * system behavior — e.g., confirming single vs double LLM call patterns.
 */

import type { MCPServerDependencies, RegisteredTool, MCPToolCallResult } from '../types.js';

function textResult(text: string): MCPToolCallResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): MCPToolCallResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createTraceTools(deps: MCPServerDependencies): RegisteredTool[] {
  if (!deps.traceStore) {
    return []; // No trace store available — skip registering tools
  }

  const traceStore = deps.traceStore;

  return [
    // ── list_traces ────────────────────────────────────────────────────
    {
      definition: {
        name: 'list_traces',
        description:
          'List execution traces. Each trace represents one user message or task run through the agent system. ' +
          'Returns trace ID, trigger, agent count, LLM call count, total tokens, duration, and status.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max traces to return. Default 10, max 100.',
            },
            conversationId: {
              type: 'string',
              description: 'Filter by conversation ID.',
            },
            status: {
              type: 'string',
              enum: ['running', 'completed', 'error'],
              description: 'Filter by trace status.',
            },
            since: {
              type: 'string',
              description: 'ISO 8601 timestamp — only return traces started after this time.',
            },
          },
        },
      },
      handler: async (args) => {
        try {
          const limit = Math.min(Math.max((args.limit as number) || 10, 1), 100);
          const traces = traceStore.getTraces({
            limit,
            conversationId: args.conversationId as string | undefined,
            status: args.status as string | undefined,
            since: args.since as string | undefined,
          });

          if (traces.length === 0) {
            return textResult('No traces found matching the query.');
          }

          const rows = traces.map((t) => ({
            id: t.id,
            trigger: t.triggerType,
            triggerContent: t.triggerContent?.substring(0, 80) || null,
            conversationId: t.conversationId,
            agents: t.agentCount,
            llmCalls: t.llmCallCount,
            toolCalls: t.toolCallCount,
            inputTokens: t.totalInputTokens,
            outputTokens: t.totalOutputTokens,
            durationMs: t.durationMs,
            status: t.status,
            startedAt: t.startedAt,
          }));

          return textResult(JSON.stringify(rows, null, 2));
        } catch (err) {
          return errorResult(`Failed to list traces: ${err}`);
        }
      },
    },

    // ── get_trace ──────────────────────────────────────────────────────
    {
      definition: {
        name: 'get_trace',
        description:
          'Get full trace detail including all agent spans, LLM calls, and tool calls. ' +
          'Use this to inspect the complete execution flow of a single user interaction. ' +
          'LLM calls include token counts, model, duration, and caller agent info. ' +
          'Set include_messages=true to also get the raw request messages and system prompt for each LLM call.',
        inputSchema: {
          type: 'object',
          properties: {
            traceId: {
              type: 'string',
              description: 'The trace ID to retrieve.',
            },
            include_messages: {
              type: 'boolean',
              description:
                'Include raw request messages (messagesJson, systemPrompt) and response content for each LLM call. ' +
                'Default false — these can be very large.',
            },
          },
          required: ['traceId'],
        },
      },
      handler: async (args) => {
        try {
          const traceId = args.traceId as string;
          const includeMessages = args.include_messages === true;

          const full = traceStore.getFullTrace(traceId);
          if (!full) {
            return errorResult(`Trace not found: ${traceId}`);
          }

          // Build a structured summary
          const summary: Record<string, unknown> = {
            trace: {
              id: full.trace.id,
              conversationId: full.trace.conversationId,
              triggerType: full.trace.triggerType,
              triggerContent: full.trace.triggerContent,
              status: full.trace.status,
              durationMs: full.trace.durationMs,
              llmCallCount: full.trace.llmCallCount,
              toolCallCount: full.trace.toolCallCount,
              agentCount: full.trace.agentCount,
              totalInputTokens: full.trace.totalInputTokens,
              totalOutputTokens: full.trace.totalOutputTokens,
              startedAt: full.trace.startedAt,
              completedAt: full.trace.completedAt,
            },
            spans: full.spans.map((s) => ({
              id: s.id,
              agentId: s.agentId,
              agentName: s.agentName,
              agentEmoji: s.agentEmoji,
              agentType: s.agentType,
              agentRole: s.agentRole,
              parentSpanId: s.parentSpanId,
              llmCallCount: s.llmCallCount,
              toolCallCount: s.toolCallCount,
              durationMs: s.durationMs,
              status: s.status,
              error: s.error,
            })),
            llmCalls: full.llmCalls.map((c) => {
              const call: Record<string, unknown> = {
                id: c.id,
                spanId: c.spanId,
                workload: c.workload,
                provider: c.provider,
                model: c.model,
                inputTokens: c.inputTokens,
                outputTokens: c.outputTokens,
                durationMs: c.durationMs,
                callerAgentId: c.callerAgentId,
                callerAgentName: c.callerAgentName,
                callerPurpose: c.callerPurpose,
                stopReason: c.stopReason,
                status: c.status,
                error: c.error,
                startedAt: c.startedAt,
                completedAt: c.completedAt,
              };
              if (includeMessages) {
                call.systemPrompt = c.systemPrompt;
                call.messagesJson = c.messagesJson;
                call.responseContent = c.responseContent;
                call.responseToolUseJson = c.responseToolUseJson;
                call.toolsJson = c.toolsJson;
              }
              return call;
            }),
            toolCalls: full.toolCalls.map((t) => ({
              id: t.id,
              spanId: t.spanId,
              llmCallId: t.llmCallId,
              toolName: t.toolName,
              source: t.source,
              success: t.success,
              durationMs: t.durationMs,
              error: t.error,
            })),
          };

          return textResult(JSON.stringify(summary, null, 2));
        } catch (err) {
          return errorResult(`Failed to get trace: ${err}`);
        }
      },
    },

    // ── get_llm_calls ──────────────────────────────────────────────────
    {
      definition: {
        name: 'get_llm_calls',
        description:
          'List LLM API calls with token counts, model, duration, and caller info. ' +
          'Filter by trace, span, conversation, workload, or provider. ' +
          'Use this to analyze token usage patterns and identify cost drivers.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Max calls to return. Default 20, max 100.',
            },
            traceId: {
              type: 'string',
              description: 'Filter by trace ID.',
            },
            spanId: {
              type: 'string',
              description: 'Filter by span ID (specific agent).',
            },
            conversationId: {
              type: 'string',
              description: 'Filter by conversation ID.',
            },
            workload: {
              type: 'string',
              enum: ['main', 'fast', 'embedding', 'image_gen', 'browser', 'voice'],
              description: 'Filter by workload type.',
            },
            provider: {
              type: 'string',
              description: 'Filter by LLM provider (e.g., "anthropic", "openai").',
            },
            since: {
              type: 'string',
              description: 'ISO 8601 timestamp — only return calls after this time.',
            },
          },
        },
      },
      handler: async (args) => {
        try {
          const limit = Math.min(Math.max((args.limit as number) || 20, 1), 100);
          const calls = traceStore.getLlmCalls({
            limit,
            traceId: args.traceId as string | undefined,
            spanId: args.spanId as string | undefined,
            conversationId: args.conversationId as string | undefined,
            workload: args.workload as 'main' | 'fast' | 'embedding' | 'image_gen' | 'browser' | 'voice' | undefined,
            provider: args.provider as string | undefined,
            since: args.since as string | undefined,
          });

          if (calls.length === 0) {
            return textResult('No LLM calls found matching the query.');
          }

          const rows = calls.map((c) => ({
            id: c.id,
            traceId: c.traceId,
            spanId: c.spanId,
            workload: c.workload,
            provider: c.provider,
            model: c.model,
            inputTokens: c.inputTokens,
            outputTokens: c.outputTokens,
            durationMs: c.durationMs,
            callerAgentId: c.callerAgentId,
            callerAgentName: c.callerAgentName,
            callerPurpose: c.callerPurpose,
            stopReason: c.stopReason,
            status: c.status,
            startedAt: c.startedAt,
          }));

          return textResult(JSON.stringify(rows, null, 2));
        } catch (err) {
          return errorResult(`Failed to list LLM calls: ${err}`);
        }
      },
    },

    // ── get_llm_call_detail ────────────────────────────────────────────
    {
      definition: {
        name: 'get_llm_call_detail',
        description:
          'Get full detail for a single LLM call including the raw request (system prompt, messages, tools) ' +
          'and response (content, tool use). Use this to inspect exactly what was sent to and received from the LLM.',
        inputSchema: {
          type: 'object',
          properties: {
            callId: {
              type: 'string',
              description: 'The LLM call ID to retrieve.',
            },
          },
          required: ['callId'],
        },
      },
      handler: async (args) => {
        try {
          const callId = args.callId as string;
          const call = traceStore.getLlmCallById(callId);
          if (!call) {
            return errorResult(`LLM call not found: ${callId}`);
          }

          return textResult(JSON.stringify(call, null, 2));
        } catch (err) {
          return errorResult(`Failed to get LLM call detail: ${err}`);
        }
      },
    },

    // ── get_trace_stats ────────────────────────────────────────────────
    {
      definition: {
        name: 'get_trace_stats',
        description:
          'Get aggregated trace statistics: total traces, LLM calls, tool calls, total tokens, ' +
          'and average duration. Useful for understanding overall system cost and performance.',
        inputSchema: {
          type: 'object',
          properties: {
            since: {
              type: 'string',
              description: 'ISO 8601 timestamp — only count activity after this time. Omit for all-time stats.',
            },
          },
        },
      },
      handler: async (args) => {
        try {
          const stats = traceStore.getStats(args.since as string | undefined);
          return textResult(JSON.stringify(stats, null, 2));
        } catch (err) {
          return errorResult(`Failed to get trace stats: ${err}`);
        }
      },
    },
  ];
}
