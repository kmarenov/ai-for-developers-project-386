import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

// Isolated ports: E2E never shares in-memory backend state with `mise run dev` (8081/5173).
const BACKEND_PORT = 8091;
const FRONTEND_PORT = 5191;
const backendUrl = `http://127.0.0.1:${BACKEND_PORT}`;
const frontendUrl = `http://127.0.0.1:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",

  // The backend keeps state in process memory and all tests share it.
  fullyParallel: false,
  workers: 1,

  retries: CI ? 2 : 0,
  forbidOnly: CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // A hung run must always produce a report instead of being killed by the CI job timeout.
  globalTimeout: CI ? 10 * 60_000 : 5 * 60_000,

  reporter: CI
    ? [["github"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],

  use: {
    baseURL: frontendUrl,
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: [
    {
      name: "backend",
      command: "go run ./cmd/server",
      cwd: "backend",
      url: `${backendUrl}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      gracefulShutdown: { signal: "SIGTERM", timeout: 500 },
      env: {
        PORT: String(BACKEND_PORT),
        CORS_ALLOWED_ORIGIN: frontendUrl,
      },
    },
    {
      name: "frontend",
      command: `pnpm dev --host 127.0.0.1 --port ${FRONTEND_PORT} --strictPort`,
      cwd: "frontend",
      url: frontendUrl,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      env: { VITE_API_BASE_URL: backendUrl },
    },
  ],
});
