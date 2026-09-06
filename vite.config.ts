import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@sparkjsdev')) return 'world-runtime';
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/convex/')) return 'convex';
        },
      },
    },
  },
});
