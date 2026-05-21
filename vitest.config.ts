import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    // Mirror the @/ path alias from tsconfig.json so tests import the same way
    // production code does.
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    // Engines are pure TypeScript — no DOM, no React. Node env is faster and
    // surfaces any accidental browser-only dependencies.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep CI runs reproducible.
    pool: 'forks',
  },
});
