import { defineConfig, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';

const config = {
  root: 'apps/web',
  publicDir: '../../public',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/cytoscape/')) return 'graph-engine';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    css: true,
  },
} satisfies UserConfig & { test: { environment: 'jsdom'; setupFiles: string[]; css: boolean } };

export default defineConfig(config);
