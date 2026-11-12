import { defineConfig } from "orval";

export default defineConfig({
  calendar: {
    input: {
      target: "./spec/openapi.yaml",
    },
    output: {
      target: "./frontend/src/api/generated/calendar.ts",
      schemas: "./frontend/src/api/generated/model",
      client: "react-query",
      httpClient: "fetch",
      mode: "split",
      clean: true,
      baseUrl: {
        runtime: "env.apiBaseUrl",
        imports: [{ name: "env", importPath: "../../config/env" }],
      },
      override: {
        query: {
          version: 5,
        },
      },
    },
  },
});
