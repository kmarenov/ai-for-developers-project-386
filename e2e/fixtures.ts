import { test as base, expect, request, type APIRequestContext } from "@playwright/test";

// Backend must match the `webServer` entry in playwright.config.ts.
const BACKEND_URL = "http://127.0.0.1:8091";

export const test = base.extend<{ api: APIRequestContext }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright fixtures require a destructuring parameter.
  api: async ({}, use) => {
    const context = await request.newContext({ baseURL: BACKEND_URL });
    await use(context);
    await context.dispose();
  },
});

export { expect };
