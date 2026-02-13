/**
 * Render Engine
 *
 * Orchestrates LLM-powered dashboard rendering. Takes a snapshot's frozen
 * metricsJson + natural-language specText, sends them to the LLM, and
 * wraps the generated HTML with CDN library tags to produce a complete,
 * self-contained dashboard document.
 */

import type { LLMService } from '../llm/service.js';
import type { LLMMessage } from '../llm/types.js';
import type { DashboardStore } from './dashboard-store.js';
import {
  DASHBOARD_RENDER_MAX_TOKENS,
  DASHBOARD_RENDER_TEMPERATURE,
} from '../constants.js';

// ================================================================
// CDN library URLs (version-pinned)
// ================================================================

const CDN_LIBS = {
  echarts: 'https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js',
  marked: 'https://cdn.jsdelivr.net/npm/marked@15.0.7/marked.min.js',
  tabulatorCss: 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/css/tabulator_midnight.min.css',
  tabulatorJs: 'https://cdn.jsdelivr.net/npm/tabulator-tables@6.3.1/dist/js/tabulator.min.js',
};

// ================================================================
// System prompt for the LLM renderer
// ================================================================

const RENDER_SYSTEM_PROMPT = `You are a dashboard code generator. You produce a single, self-contained HTML document body that renders an interactive data dashboard. The HTML runs inside a sandboxed iframe.

Available libraries (pre-loaded via CDN <script> tags in the wrapper — do NOT add <script> or <link> tags for them):
- Apache ECharts 5.6.0: window.echarts — use for all charts (bar, line, area, pie, donut, gauge, heatmap, treemap, Sankey, sunburst, radar, scatter, parallel coordinates, etc.)
- marked.js 15.0.7: window.marked — use for markdown rendering (call marked.parse(str))
- Tabulator 6.3.1: window.Tabulator — use for interactive, sortable, filterable data tables

Rules:
1. Output ONLY the HTML body content. No <!DOCTYPE>, <html>, <head>, or <body> wrapper tags. No explanation, no markdown fences.
2. Hardcode all data from the DATA section directly into JavaScript variables.
3. Use the libraries above — they are already loaded. Do NOT add <script> or <link> tags for them.
4. Use inline <style> for all CSS. Dark theme with background #0f1117, text color #e0e0e0.
5. Make all charts responsive using ResizeObserver or window resize events.
6. Include smooth load animations on charts (animationDuration: 800, animationEasing: 'cubicOut').
7. Tables must be sortable and filterable.
8. The dashboard must work at widths from 800px to 1920px.
9. Use CSS Grid or Flexbox for layout. Use CSS custom properties for consistent theming.
10. Include a header section with the dashboard title and key metadata.
11. Format large numbers with toLocaleString(). Format durations in human-readable units.
12. Use professional BI styling: subtle borders, card-based layout, consistent spacing.`;

// ================================================================
// Default specs per snapshot type
// ================================================================

const DEFAULT_SPECS: Record<string, string> = {
  mission_report: `Executive mission report dashboard:
- Header with mission title, status badge, duration, and completion time
- KPI row: trace count, LLM calls, tool invocations, total tokens (input + output), error count
- Token usage breakdown by agent (treemap or horizontal bar)
- Agent activity summary (bar chart showing spans, LLM calls, tool calls per agent)
- Tool invocation breakdown (horizontal bar, sorted by count)
- LLM call detail table (sortable by duration, tokens, agent, model)
- Recent traces table (sortable by status, duration)
- Dark theme, professional BI styling with indigo/cyan accents`,

  agent_analytics: `System-wide agent analytics dashboard:
- KPI cards: total traces, LLM calls, tool calls, total tokens, agent count, error rate
- Token usage trend over time (stacked area chart: input vs output, with data zoom)
- LLM calls by model (donut chart)
- Top tools by invocation count (horizontal bar)
- Agent performance comparison (grouped bar: spans, LLM calls, tool calls per agent)
- Time series overview (line chart of activity over the time range)
- Recent traces table (sortable by status, duration, token count)
- Dark theme with indigo/cyan accent colors`,

  system_health: `System health monitoring dashboard:
- KPI cards: total traces, error count, error rate %, avg duration, total tokens
- Error rate trend over time (area chart with threshold line)
- Duration distribution (bar chart or histogram)
- Tool success/failure rates (stacked bar per tool)
- Agent error breakdown (horizontal bar)
- Recent error traces table (filtered to errors, sortable)
- Dark theme with green/red health indicators`,

  custom: `Data overview dashboard:
- KPI cards summarizing key numeric values from the data
- Appropriate charts based on the data structure
- Data table showing all available records
- Dark theme, clean professional styling`,
};

export class RenderEngine {
  constructor(
    private llmService: LLMService,
    private dashboardStore: DashboardStore,
  ) {}

  /**
   * Render a pending snapshot by sending its data + spec to the LLM.
   * Updates the snapshot record with the rendered HTML and metadata.
   * Returns the complete HTML document (with library wrapper).
   */
  async render(snapshotId: string): Promise<string> {
    const snapshot = this.dashboardStore.getSnapshotById(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    if (snapshot.status === 'rendered' && snapshot.renderedHtml) {
      return this.wrapWithLibraries(snapshot.renderedHtml);
    }

    // Mark as rendering
    this.dashboardStore.updateStatus(snapshotId, 'rendering');

    const spec = snapshot.specText || DEFAULT_SPECS[snapshot.snapshotType] || DEFAULT_SPECS.custom;

    const userMessage = `## DATA\n${snapshot.metricsJson}\n\n## DASHBOARD SPEC\n${spec}`;

    const messages: LLMMessage[] = [
      { role: 'user', content: userMessage },
    ];

    const startTime = Date.now();

    try {
      const response = await this.llmService.generate(messages, {
        systemPrompt: RENDER_SYSTEM_PROMPT,
        maxTokens: DASHBOARD_RENDER_MAX_TOKENS,
        temperature: DASHBOARD_RENDER_TEMPERATURE,
      });

      const durationMs = Date.now() - startTime;
      const generatedBody = this.extractHtml(response.content);

      // Store the generated body (without library wrapper) in the DB
      this.dashboardStore.updateRenderedHtml(snapshotId, generatedBody, {
        model: response.model,
        durationMs,
        tokensIn: response.usage?.inputTokens || 0,
        tokensOut: response.usage?.outputTokens || 0,
      });

      console.log(`[RenderEngine] Rendered snapshot ${snapshotId} in ${durationMs}ms (${response.usage?.outputTokens || 0} tokens out)`);

      return this.wrapWithLibraries(generatedBody);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.dashboardStore.updateStatus(snapshotId, 'error', errorMessage);
      console.error(`[RenderEngine] Failed to render snapshot ${snapshotId}:`, errorMessage);
      throw error;
    }
  }

  /**
   * Re-render a snapshot with a modified spec.
   * Creates a new version in the same lineage, renders it, and returns the HTML.
   */
  async rerender(snapshotId: string, newSpec: string): Promise<{ snapshotId: string; html: string }> {
    const newId = this.dashboardStore.createNewVersion(snapshotId, newSpec);
    if (!newId) {
      throw new Error(`Source snapshot not found: ${snapshotId}`);
    }

    const html = await this.render(newId);
    return { snapshotId: newId, html };
  }

  /**
   * Get the default spec for a given snapshot type.
   */
  getDefaultSpec(snapshotType: string): string {
    return DEFAULT_SPECS[snapshotType] || DEFAULT_SPECS.custom;
  }

  /**
   * Wrap LLM-generated dashboard body with the CDN library preamble
   * to create a complete, self-contained HTML document.
   */
  wrapWithLibraries(generatedBody: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard</title>

  <!-- Dashboard Library Stack (CDN) -->
  <script src="${CDN_LIBS.echarts}"></script>
  <script src="${CDN_LIBS.marked}"></script>
  <link href="${CDN_LIBS.tabulatorCss}" rel="stylesheet">
  <script src="${CDN_LIBS.tabulatorJs}"></script>

  <style>
    /* Base reset for dashboard iframe */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #0f1117; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
${generatedBody}
</body>
</html>`;
  }

  // ================================================================
  // Helpers
  // ================================================================

  /**
   * Extract HTML from LLM response, stripping markdown fences if present.
   */
  private extractHtml(content: string): string {
    let html = content.trim();

    // Strip markdown code fences
    if (html.startsWith('```html')) {
      html = html.slice(7);
    } else if (html.startsWith('```')) {
      html = html.slice(3);
    }
    if (html.endsWith('```')) {
      html = html.slice(0, -3);
    }

    return html.trim();
  }
}
