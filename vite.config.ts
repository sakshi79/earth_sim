import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path (any repo name).
  base: './',
  build: {
    target: 'es2022',
    // three.js alone is ~550 kB minified; the real budget is 1 MB gzipped (docs/SPEC.md section 8).
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // Reachable from a phone on the same network for touch testing.
    host: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
