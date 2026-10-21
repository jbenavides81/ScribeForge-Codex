import { defineConfig } from '@playwright/test';

// Whole-app tests. "dev" runs the built app from out/; "packaged" runs every test again on the
// unpacked installer build in release/win-unpacked, plus the checks only it needs. Test windows
// open on the left-most monitor and never take keyboard focus (see src/main/placement.ts), and
// each test run uses its own throwaway data.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: 'test-results/playwright',
  globalSetup: './tests/e2e/cleanup.ts',
  globalTeardown: './tests/e2e/cleanup.ts',
  projects: [
    { name: 'dev', testIgnore: /packaged\.spec\.ts/ },
    { name: 'packaged' },
  ],
});
