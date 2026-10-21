import { defineConfig } from 'vite';

export default defineConfig({
  base: '/voxel-planet/',
  server: {
    port: 5174,
    open: false,
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
