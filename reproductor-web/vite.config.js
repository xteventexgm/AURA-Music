import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: false
  },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
