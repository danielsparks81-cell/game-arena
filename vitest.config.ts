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
    // surfaces any accidental browser-only dependencies. Component tests (.test.tsx)
    // opt INTO jsdom per-file with a `// @vitest-environment jsdom` pragma.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Keep CI runs reproducible.
    pool: 'forks',
  },
});
