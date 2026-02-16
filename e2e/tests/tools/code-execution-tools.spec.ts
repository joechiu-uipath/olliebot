/**
 * Tools - Code Execution Tests
 *
 * Covers: TOOL-CODE-001 through TOOL-CODE-005
 */

import { test, expect } from '../../utils/test-base.js';
import { createConversation } from '../../fixtures/index.js';

test.describe('Code Execution Tools', () => {

  test.beforeEach(async ({ app }) => {
    const conv = createConversation({ id: 'conv-code', title: 'Code Tools' });
    app.api.addConversation(conv);
    await app.page.reload();
    await app.waitForAppReady();
    await app.sidebar.selectConversation('Code Tools');
  });

  // TOOL-CODE-001: Run Python (Pyodide)
  test('executes Python code with pyodide engine', async ({ app }) => {
    await app.chat.sendMessage('Run print("Hello World") in Python');

    app.ws.simulateToolExecution({
      conversationId: 'conv-code',
      turnId: 'turn-py1',
      requestId: 'req-py1',
      toolName: 'run_python',
      parameters: { code: 'print("Hello World")', engine: 'pyodide' },
      result: 'Hello World',
    });

    await expect(app.chat.toolByName('run_python')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-CODE-002: Run Python (Monty)
  test('executes Python with monty engine', async ({ app }) => {
    await app.chat.sendMessage('Calculate 2 + 2 in Python');

    app.ws.simulateToolExecution({
      conversationId: 'conv-code',
      turnId: 'turn-py2',
      requestId: 'req-py2',
      toolName: 'run_python',
      parameters: { code: 'print(2 + 2)', engine: 'monty' },
      result: '4',
    });

    await expect(app.chat.toolByName('run_python')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-CODE-003: Python with packages
  test('loads numpy/pandas/matplotlib packages', async ({ app }) => {
    await app.chat.sendMessage('Create a numpy array');

    app.ws.simulateToolExecution({
      conversationId: 'conv-code',
      turnId: 'turn-py3',
      requestId: 'req-py3',
      toolName: 'run_python',
      parameters: { code: 'import numpy as np; print(np.array([1,2,3]))' },
      result: '[1 2 3]',
    });

    await expect(app.chat.toolByName('run_python')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-CODE-004: Python file output
  test('Python generates image file', async ({ app }) => {
    await app.chat.sendMessage('Create a chart with matplotlib');

    app.ws.simulateToolExecution({
      conversationId: 'conv-code',
      turnId: 'turn-py4',
      requestId: 'req-py4',
      toolName: 'run_python',
      parameters: { code: 'import matplotlib.pyplot as plt; plt.plot([1,2,3]); plt.savefig("chart.png")' },
      result: JSON.stringify({ files: [{ name: 'chart.png', type: 'image/png' }] }),
    });

    await expect(app.chat.toolByName('run_python')).toBeVisible({ timeout: 5000 });
  });

  // TOOL-CODE-005: Generate Python
  test('generates Python code via generate_python', async ({ app }) => {
    await app.chat.sendMessage('Generate a function to sort a list');

    app.ws.simulateToolExecution({
      conversationId: 'conv-code',
      turnId: 'turn-gen',
      requestId: 'req-gen',
      toolName: 'generate_python',
      parameters: { description: 'sort a list' },
      result: 'def sort_list(lst):\n    return sorted(lst)',
    });

    await expect(app.chat.toolByName('generate_python')).toBeVisible({ timeout: 5000 });
  });
});
