/**
 * Desktop Events
 *
 * Event definitions and creators for desktop session WebSocket broadcasts.
 * Mirrors the browser events structure.
 */

import type {
  DesktopSession,
  DesktopAction,
  ActionResult,
  ClickMarker,
  DesktopEvent,
  DesktopSessionCreatedEvent,
  DesktopSessionUpdatedEvent,
  DesktopSessionClosedEvent,
  DesktopScreenshotEvent,
  DesktopActionStartedEvent,
  DesktopActionCompletedEvent,
  DesktopClickMarkerEvent,
} from './types';

/**
 * Create a session created event
 */
export function createSessionCreatedEvent(session: DesktopSession): DesktopSessionCreatedEvent {
  return {
    type: 'desktop_session_created',
    session,
  };
}

/**
 * Create a session updated event
 */
export function createSessionUpdatedEvent(
  sessionId: string,
  updates: Partial<DesktopSession>
): DesktopSessionUpdatedEvent {
  return {
    type: 'desktop_session_updated',
    sessionId,
    updates,
  };
}

/**
 * Create a session closed event
 */
export function createSessionClosedEvent(sessionId: string): DesktopSessionClosedEvent {
  return {
    type: 'desktop_session_closed',
    sessionId,
  };
}

/**
 * Create a screenshot event
 */
export function createScreenshotEvent(sessionId: string, screenshot: string): DesktopScreenshotEvent {
  return {
    type: 'desktop_screenshot',
    sessionId,
    screenshot,
    timestamp: Date.now(),
  };
}

/**
 * Create an action started event
 */
export function createActionStartedEvent(
  sessionId: string,
  actionId: string,
  action: DesktopAction
): DesktopActionStartedEvent {
  return {
    type: 'desktop_action_started',
    sessionId,
    actionId,
    action,
  };
}

/**
 * Create an action completed event
 */
export function createActionCompletedEvent(
  sessionId: string,
  actionId: string,
  action: DesktopAction,
  result: ActionResult
): DesktopActionCompletedEvent {
  return {
    type: 'desktop_action_completed',
    sessionId,
    actionId,
    action,
    result,
  };
}

/**
 * Create a click marker event
 */
export function createClickMarkerEvent(sessionId: string, marker: ClickMarker): DesktopClickMarkerEvent {
  return {
    type: 'desktop_click_marker',
    sessionId,
    marker,
  };
}

/**
 * Type guard for desktop events
 */
export function isDesktopEvent(event: unknown): event is DesktopEvent {
  if (typeof event !== 'object' || event === null) return false;
  const e = event as { type?: string };
  return (
    e.type === 'desktop_session_created' ||
    e.type === 'desktop_session_updated' ||
    e.type === 'desktop_session_closed' ||
    e.type === 'desktop_screenshot' ||
    e.type === 'desktop_action_started' ||
    e.type === 'desktop_action_completed' ||
    e.type === 'desktop_click_marker'
  );
}

/**
 * All desktop event types for use in type guards
 */
export const DESKTOP_EVENT_TYPES = [
  'desktop_session_created',
  'desktop_session_updated',
  'desktop_session_closed',
  'desktop_screenshot',
  'desktop_action_started',
  'desktop_action_completed',
  'desktop_click_marker',
] as const;

export type DesktopEventType = (typeof DESKTOP_EVENT_TYPES)[number];
