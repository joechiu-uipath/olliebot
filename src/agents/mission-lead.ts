// Mission Lead Agent — thin subclass of SupervisorAgentImpl
// Provides direct mission-context-aware chat without routing through the generic Supervisor.
// See docs/design/mission-lead-design-ready.md for full design rationale.

import { SupervisorAgentImpl } from './supervisor.js';
import type { AgentRegistry } from './base-agent.js';
import type { LLMService } from '../llm/service.js';
import type { Channel, Message } from '../channels/types.js';
import type { MissionManager } from '../missions/index.js';
import { getDb } from '../db/index.js';

/** Cached conversation → mission context mapping */
interface MissionChatContext {
  channel: 'mission' | 'pillar';
  missionId: string;
  missionSlug: string;
  pillarId?: string;
  pillarSlug?: string;
}

export class MissionLeadAgent extends SupervisorAgentImpl {
  private missionManager: MissionManager | null = null;
  private conversationContextCache: Map<string, MissionChatContext | null> = new Map();
  private currentMissionContext: string | null = null; // request-scoped

  constructor(llmService: LLMService, registry: AgentRegistry) {
    super(llmService, registry);

    // Load config from JSON
    const jsonConfig = registry.loadAgentConfig('mission-lead');
    const identity = jsonConfig?.identity as Record<string, string> | undefined;
    const canAccessTools = jsonConfig?.canAccessTools as string[] | undefined;

    // Override identity from JSON (readonly prevents reassignment, not property mutation)
    this.identity.id = identity?.id || 'mission-lead';
    this.identity.name = identity?.name || 'Mission Lead';
    this.identity.emoji = identity?.emoji || '🎯';
    this.identity.description = identity?.description || 'Mission Lead agent for strategic mission guidance';

    // Override capabilities from JSON (mission-lead has restricted tool access)
    if (canAccessTools) {
      this.capabilities.canAccessTools = canAccessTools;
    }

    // Override system prompt from .md file
    this.config.systemPrompt = registry.loadAgentPrompt('mission-lead');
  }

  setMissionManager(manager: MissionManager): void {
    this.missionManager = manager;
  }

  // --- Override 1: registerChannel ---
  // Store the channel for sending but do NOT bind onMessage.
  // Message routing is handled by the server's routing layer.
  override registerChannel(channel: Channel): void {
    this.channel = channel;
  }

  // --- Override 2: handleMessage ---
  // Set request-scoped mission context before parent processes the message.
  override async handleMessage(message: Message): Promise<void> {
    const conversationId = message.metadata?.conversationId as string | undefined;
    if (conversationId) {
      this.currentMissionContext = this.buildMissionContext(conversationId);
    }
    try {
      await super.handleMessage(message);
    } finally {
      this.currentMissionContext = null;
    }
  }

  // --- Override 3: buildSystemPrompt ---
  // Append mission context after parent builds base + delegation + browser sections.
  protected override buildSystemPrompt(
    additionalContext?: string,
    allowedTools?: string[]
  ): string {
    let prompt = super.buildSystemPrompt(additionalContext, allowedTools);

    if (this.currentMissionContext) {
      prompt += `\n\n${this.currentMissionContext}`;
    }

    return prompt;
  }

  // ========================================================================
  // Mission context builder
  // ========================================================================

  private lookupConversationContext(conversationId: string): MissionChatContext | null {
    if (this.conversationContextCache.has(conversationId)) {
      return this.conversationContextCache.get(conversationId)!;
    }

    const db = getDb();
    const conv = db.conversations.findById(conversationId);
    if (!conv?.metadata) {
      this.conversationContextCache.set(conversationId, null);
      return null;
    }

    const channel = conv.metadata.channel as string | undefined;
    if (channel !== 'mission' && channel !== 'pillar') {
      this.conversationContextCache.set(conversationId, null);
      return null;
    }

    const ctx: MissionChatContext = {
      channel: channel as 'mission' | 'pillar',
      missionId: conv.metadata.missionId as string,
      missionSlug: conv.metadata.missionSlug as string,
      pillarId: conv.metadata.pillarId as string | undefined,
      pillarSlug: conv.metadata.pillarSlug as string | undefined,
    };
    this.conversationContextCache.set(conversationId, ctx);
    return ctx;
  }

  private buildMissionContext(conversationId: string): string | null {
    if (!this.missionManager) return null;

    const ctx = this.lookupConversationContext(conversationId);
    if (!ctx) return null;

    const mission = this.missionManager.getMissionBySlug(ctx.missionSlug);
    if (!mission) return null;

    const pillars = this.missionManager.getPillarsByMission(mission.id);
    const allTodos = this.missionManager.getTodosByMission(mission.id);

    const lines: string[] = [];
    lines.push('## Current Mission Context');
    lines.push('');
    lines.push(`**Mission**: ${mission.name} (slug: \`${mission.slug}\`)`);
    lines.push(`**Status**: ${mission.status}`);
    if (mission.description) {
      lines.push(`**Description**: ${mission.description}`);
    }
    if (mission.lastCycleAt) {
      lines.push(`**Last cycle**: ${mission.lastCycleAt}`);
    }
    lines.push('');

    // If this is a pillar-scoped conversation, focus on that pillar
    if (ctx.channel === 'pillar' && ctx.pillarId) {
      const pillar = pillars.find(p => p.id === ctx.pillarId);
      if (pillar) {
        lines.push(`### Current Pillar: ${pillar.name} (slug: \`${pillar.slug}\`)`);
        lines.push(`Status: ${pillar.status}`);
        if (pillar.description) lines.push(`Description: ${pillar.description}`);
        lines.push('');
        this.appendPillarDetail(lines, pillar);
      }

      // Also show sibling pillars (summary only) for broader context
      const siblings = pillars.filter(p => p.id !== ctx.pillarId);
      if (siblings.length > 0) {
        lines.push('');
        lines.push('### Other Pillars (summary)');
        for (const p of siblings) {
          const todoCount = allTodos.filter(t => t.pillarId === p.id).length;
          lines.push(`- **${p.name}** (slug: \`${p.slug}\`, ${p.status}) — ${todoCount} todos`);
        }
      }
    } else {
      // Mission-level conversation — show all pillars with detail
      lines.push(`### Pillars (${pillars.length})`);
      lines.push('');
      for (const pillar of pillars) {
        lines.push(`#### ${pillar.name} (slug: \`${pillar.slug}\`, status: ${pillar.status})`);
        if (pillar.description) lines.push(pillar.description);
        lines.push('');
        this.appendPillarDetail(lines, pillar);
        lines.push('');
      }
    }

    // Pending/in-progress todos across the mission
    const activeTodos = allTodos.filter(t => t.status === 'pending' || t.status === 'in_progress');
    if (activeTodos.length > 0) {
      lines.push('### Active TODOs');
      for (const todo of activeTodos.slice(0, 10)) {
        const pillar = pillars.find(p => p.id === todo.pillarId);
        lines.push(`- [${todo.status}] **${todo.title}** (${todo.priority}) — ${pillar?.name || 'unlinked'}`);
      }
      if (activeTodos.length > 10) {
        lines.push(`- ...and ${activeTodos.length - 10} more`);
      }
    }

    return lines.join('\n');
  }

  private appendPillarDetail(lines: string[], pillar: { id: string }): void {
    if (!this.missionManager) return;

    const metrics = this.missionManager.getMetricsByPillar(pillar.id);
    const strategies = this.missionManager.getStrategiesByPillar(pillar.id);
    const todos = this.missionManager.getTodosByPillar(pillar.id);

    if (metrics.length > 0) {
      lines.push('**Metrics**:');
      for (const m of metrics) {
        lines.push(`- ${m.name}: ${m.current} ${m.unit} (target: ${m.target}, trend: ${m.trend})`);
      }
    }

    if (strategies.length > 0) {
      lines.push('**Strategies**:');
      for (const s of strategies) {
        lines.push(`- [${s.status}] ${s.description}`);
      }
    }

    if (todos.length > 0) {
      const byStatus: Record<string, number> = { pending: 0, in_progress: 0, completed: 0, blocked: 0 };
      for (const t of todos) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      }
      const parts = Object.entries(byStatus).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`);
      lines.push(`**TODOs**: ${parts.join(', ')}`);
    }
  }
}
