/**
 * Shared test fixtures for E2E tests.
 *
 * Contains factory functions for creating test data used across test suites.
 */

// --- Conversations ---

export function createConversation(overrides: Partial<{
  id: string;
  title: string;
  isWellKnown: boolean;
  icon: string;
}> = {}) {
  const id = overrides.id || `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    id,
    title: overrides.title || 'Test Conversation',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isWellKnown: overrides.isWellKnown ?? false,
    icon: overrides.icon,
  };
}

// --- Messages ---

export function createUserMessage(content: string, conversationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'user',
    content,
    conversationId,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createAssistantMessage(content: string, conversationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content,
    conversationId,
    createdAt: new Date().toISOString(),
    agentName: 'OllieBot',
    agentEmoji: '🐙',
    ...overrides,
  };
}

export function createToolMessage(toolName: string, conversationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content: '',
    conversationId,
    createdAt: new Date().toISOString(),
    messageType: 'tool_execution',
    toolName,
    toolSource: 'native',
    toolSuccess: true,
    toolDurationMs: 150,
    toolParameters: {},
    toolResult: 'Tool executed successfully.',
    ...overrides,
  };
}

export function createDelegationMessage(agentName: string, conversationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-deleg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content: '',
    conversationId,
    createdAt: new Date().toISOString(),
    messageType: 'delegation',
    delegationAgentId: `agent-${Date.now()}`,
    delegationAgentType: 'researcher',
    agentName,
    agentEmoji: '🔬',
    delegationMission: 'Research task',
    delegationRationale: 'Delegating for specialized research.',
    ...overrides,
  };
}

export function createErrorMessage(error: string, conversationId: string) {
  return {
    id: `msg-err-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content: error,
    conversationId,
    createdAt: new Date().toISOString(),
    messageType: 'error',
  };
}

export function createTaskRunMessage(taskName: string, conversationId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content: `Task "${taskName}" completed.`,
    conversationId,
    createdAt: new Date().toISOString(),
    messageType: 'task_run',
    taskId: `task-${Date.now()}`,
    taskName,
    taskDescription: `Scheduled task: ${taskName}`,
    ...overrides,
  };
}

export function createCitationMessage(content: string, conversationId: string, citations: Array<{
  title: string;
  url: string;
  snippet: string;
}>) {
  return {
    id: `msg-cite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: 'assistant',
    content,
    conversationId,
    createdAt: new Date().toISOString(),
    agentName: 'OllieBot',
    agentEmoji: '🐙',
    citations,
  };
}

// --- Tasks ---

export function createTask(overrides: Partial<{
  id: string;
  name: string;
  description: string;
  schedule: string;
  enabled: boolean;
  lastRun: string;
}> = {}) {
  return {
    id: overrides.id || `task-${Date.now()}`,
    name: overrides.name || 'Test Task',
    description: overrides.description || 'A test scheduled task',
    schedule: overrides.schedule || '0 9 * * *',
    enabled: overrides.enabled ?? true,
    lastRun: overrides.lastRun || null,
  };
}

// --- Skills ---

export function createSkill(overrides: Partial<{
  id: string;
  name: string;
  description: string;
}> = {}) {
  return {
    id: overrides.id || `skill-${Date.now()}`,
    name: overrides.name || 'Test Skill',
    description: overrides.description || 'A test skill',
  };
}

// --- MCP Servers ---

export function createMcpServer(overrides: Partial<{
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  transport: string;
  toolCount: number;
}> = {}) {
  return {
    id: overrides.id || `mcp-${Date.now()}`,
    name: overrides.name || 'Test MCP Server',
    enabled: overrides.enabled ?? true,
    status: overrides.status || 'connected',
    transport: overrides.transport || 'stdio',
    toolCount: overrides.toolCount ?? 3,
  };
}

// --- Tools ---

export function createToolInfo(name: string, description = 'A test tool') {
  return {
    name,
    description,
    inputs: [
      { name: 'query', type: 'string', description: 'Input query', required: true },
    ],
  };
}

// --- RAG Projects ---

export function createRagProject(overrides: Partial<{
  id: string;
  name: string;
  documentCount: number;
  indexedCount: number;
  vectorCount: number;
  lastIndexedAt: string;
  isIndexing: boolean;
}> = {}) {
  return {
    id: overrides.id || `rag-${Date.now()}`,
    name: overrides.name || 'Test RAG Project',
    documentCount: overrides.documentCount ?? 10,
    indexedCount: overrides.indexedCount ?? 10,
    vectorCount: overrides.vectorCount ?? 100,
    lastIndexedAt: overrides.lastIndexedAt || new Date().toISOString(),
    isIndexing: overrides.isIndexing ?? false,
  };
}

// --- Browser/Desktop Sessions ---

export function createBrowserSession(overrides: Partial<{
  id: string;
  status: string;
  url: string;
}> = {}) {
  return {
    id: overrides.id || `browser-${Date.now()}`,
    status: overrides.status || 'active',
    url: overrides.url || 'https://example.com',
  };
}

export function createDesktopSession(overrides: Partial<{
  id: string;
  status: string;
  platform: string;
}> = {}) {
  return {
    id: overrides.id || `desktop-${Date.now()}`,
    status: overrides.status || 'active',
    platform: overrides.platform || 'windows',
  };
}

// --- Missions ---

export function createMission(overrides: Partial<{
  slug: string;
  name: string;
  description: string;
  status: string;
  pillars: Array<Record<string, unknown>>;
}> = {}) {
  return {
    slug: overrides.slug || 'test-mission',
    name: overrides.name || 'Test Mission',
    description: overrides.description || 'A test mission for E2E',
    status: overrides.status || 'active',
    pillars: overrides.pillars || [
      { slug: 'pillar-1', name: 'Pillar 1', description: 'First pillar' },
    ],
  };
}

// --- Traces ---

export function createTrace(overrides: Partial<{
  id: string;
  conversationId: string;
  agentType: string;
  status: string;
  startTime: string;
  endTime: string;
  inputTokens: number;
  outputTokens: number;
}> = {}) {
  return {
    id: overrides.id || `trace-${Date.now()}`,
    conversationId: overrides.conversationId || 'conv-1',
    agentType: overrides.agentType || 'supervisor',
    status: overrides.status || 'completed',
    startTime: overrides.startTime || new Date().toISOString(),
    endTime: overrides.endTime || new Date().toISOString(),
    inputTokens: overrides.inputTokens ?? 100,
    outputTokens: overrides.outputTokens ?? 50,
  };
}

// --- Evaluations ---

export function createEvalSuite(overrides: Partial<{
  path: string;
  name: string;
  evaluations: Array<Record<string, unknown>>;
}> = {}) {
  return {
    path: overrides.path || 'test-suite',
    name: overrides.name || 'Test Evaluation Suite',
    evaluations: overrides.evaluations || [
      { path: 'test-eval-1', name: 'Test Eval 1', description: 'First eval' },
    ],
  };
}

export function createEvalResult(overrides: Partial<{
  id: string;
  evaluationPath: string;
  status: string;
  score: number;
}> = {}) {
  return {
    id: overrides.id || `result-${Date.now()}`,
    evaluationPath: overrides.evaluationPath || 'test-eval-1',
    status: overrides.status || 'completed',
    score: overrides.score ?? 0.85,
  };
}

// --- Dashboards ---

export function createDashboardSnapshot(overrides: Partial<{
  id: string;
  missionSlug: string;
  html: string;
}> = {}) {
  return {
    id: overrides.id || `snap-${Date.now()}`,
    missionSlug: overrides.missionSlug || 'test-mission',
    html: overrides.html || '<div class="dashboard"><h1>Dashboard</h1><p>KPI: 95%</p></div>',
    createdAt: new Date().toISOString(),
  };
}
