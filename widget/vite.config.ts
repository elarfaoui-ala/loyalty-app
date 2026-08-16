import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/loader.ts',
      name: 'LoyaltyWidget',
      fileName: () => 'widget.js',
      formats: ['iife'],
    },
    minify: 'esbuild',
    sourcemap: true,
  },
});
