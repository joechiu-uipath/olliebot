import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const ReactCompilerConfig = {
  // Skip App.jsx - it uses refs in useState initializers for WebSocket handler
  // which the compiler incorrectly flags as "ref access during render"
  sources(filename) {
    return !filename.endsWith('App.jsx');
  },
  // Log which files get compiled (remove in production)
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendPort = '3000';

  return {
    plugins: [
      react({
        babel: {
          plugins: [['babel-plugin-react-compiler', ReactCompilerConfig]],
        },
      }),
    ],
    server: {
      port: 5173,
      proxy: {
        // Proxy API requests to backend
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
        // Proxy main WebSocket to backend
        '/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
        // Proxy voice WebSocket to backend
        '/voice': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
      // HMR configuration for Windows compatibility
      watch: {
        usePolling: true,
        interval: 100,
      },
      hmr: {
        overlay: true,
      },
    },
  };
});
