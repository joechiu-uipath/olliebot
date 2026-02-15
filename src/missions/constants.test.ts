/**
 * Unit tests for Mission Constants
 *
 * Tests the well-known conversation ID generators and constant values.
 * Maps to e2e test plan: MISSION-001 to MISSION-011 (mission management)
 */

import { describe, it, expect } from 'vitest';
import {
  metricConversationId,
  pillarTodoConversationId,
  DEFAULT_ACTIVE_TODO_LIMIT,
  DEFAULT_BACKLOG_TODO_LIMIT,
  TREND_HISTORY_COUNT,
  TREND_MIN_READINGS,
  TREND_STABILITY_THRESHOLD,
  METRIC_PRECISION,
} from './constants.js';

describe('metricConversationId', () => {
  it('generates deterministic ID from mission slug', () => {
    expect(metricConversationId('my-mission')).toBe('my-mission-metric');
  });

  it('generates different IDs for different missions', () => {
    const id1 = metricConversationId('mission-a');
    const id2 = metricConversationId('mission-b');
    expect(id1).not.toBe(id2);
  });

  it('is deterministic (same input always gives same output)', () => {
    const id1 = metricConversationId('test');
    const id2 = metricConversationId('test');
    expect(id1).toBe(id2);
  });
});

describe('pillarTodoConversationId', () => {
  it('generates deterministic ID from mission and pillar slugs', () => {
    expect(pillarTodoConversationId('my-mission', 'quality')).toBe('my-mission-quality-todo');
  });

  it('generates different IDs for different pillars', () => {
    const id1 = pillarTodoConversationId('mission', 'pillar-a');
    const id2 = pillarTodoConversationId('mission', 'pillar-b');
    expect(id1).not.toBe(id2);
  });

  it('generates different IDs for different missions same pillar', () => {
    const id1 = pillarTodoConversationId('mission-1', 'quality');
    const id2 = pillarTodoConversationId('mission-2', 'quality');
    expect(id1).not.toBe(id2);
  });
});

describe('constant values', () => {
  it('has reasonable TODO limits', () => {
    expect(DEFAULT_ACTIVE_TODO_LIMIT).toBeGreaterThan(0);
    expect(DEFAULT_BACKLOG_TODO_LIMIT).toBeGreaterThan(DEFAULT_ACTIVE_TODO_LIMIT);
  });

  it('has reasonable trend computation constants', () => {
    expect(TREND_HISTORY_COUNT).toBeGreaterThan(0);
    expect(TREND_MIN_READINGS).toBeGreaterThan(0);
    expect(TREND_MIN_READINGS).toBeLessThan(TREND_HISTORY_COUNT);
    expect(TREND_STABILITY_THRESHOLD).toBeGreaterThan(0);
    expect(TREND_STABILITY_THRESHOLD).toBeLessThan(1);
  });

  it('has valid metric precision', () => {
    expect(METRIC_PRECISION).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(METRIC_PRECISION)).toBe(true);
  });
});
