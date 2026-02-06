/**
 * Desktop Control Module
 *
 * Provides sandboxed desktop environment control with VNC.
 * Mirrors the browser module architecture.
 */

// Types
export * from './types';

// Events
export * from './events';

// Core classes
export { VNCClient } from './vnc-client';
export { DesktopSessionInstance } from './session';
export { DesktopSessionManager, type IBroadcaster, type DesktopSessionManagerConfig } from './manager';

// Tools
export { DesktopSessionTool, DesktopActionTool, DesktopScreenshotTool } from './tools';
