import { defineConfig } from 'vitest/config';

/**
 * dist/ is committed so pi can install this package straight from git, which
 * means vitest's default glob also matches the compiled copies of the tests.
 * Those need node_modules that are not installed in dist, so run the TypeScript
 * sources only.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
