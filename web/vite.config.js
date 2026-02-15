import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// React Compiler (experimental) - auto-memoizes components and hooks
// Reduces need for manual useMemo/useCallback optimization
const ReactCompilerConfig = {
  // Skip App.jsx - it uses refs in useState initializers for WebSocket handler
  // which the compiler incorrectly flags as "ref access during render"
  sources(filename) {
    return !filename.endsWith('App.jsx');
  },
  // Log compilation results during development (helps debug compiler issues)
  logger: {
    logEvent(filename, event) {
      if (event.kind === 'CompileSuccess') {
        console.log(`[React Compiler] ✓ ${filename}`);
      } else if (event.kind === 'CompileError') {
        console.log(`[React Compiler] ✗ ${filename}: ${event.detail}`);
      }
    },
  },
};

// Backend server port - must match the port in src/index.ts
const BACKEND_PORT = 3000;

export default defineConfig({
  // Plugins run during build and dev
  plugins: [
    react({
      // Use Babel for React Compiler transformation
      // (SWC doesn't support React Compiler yet)
      babel: {
        plugins: [['babel-plugin-react-compiler', ReactCompilerConfig]],
      },
    }),
  ],

  server: {
    // Vite dev server port - access UI at http://localhost:5173
    port: 5173,

    // Proxy configuration - forwards requests to backend during development
    // This avoids CORS issues and mimics production where both are served from same origin
    proxy: {
      // REST API requests -> backend Express server
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true, // Sets Host header to target URL (needed for virtual hosts)
      },
      // Main chat WebSocket -> backend WS server
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true, // Enable WebSocket proxying
      },
      // Voice WebSocket -> backend WS server (separate endpoint for audio streaming)
      '/voice': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true,
      },
    },

    // File watching configuration for Windows
    // Native fs.watch can be unreliable on Windows (especially with antivirus, OneDrive, or WSL)
    // Polling is slower but more reliable - 100ms interval balances responsiveness vs CPU
    watch: {
      usePolling: true,
      interval: 100,
    },
  },
});
