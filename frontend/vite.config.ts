import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/health": "http://localhost:8081",
      "/config": "http://localhost:8081",
      "/meeting-types": {
        target: "http://localhost:8081",
        // `/meeting-types` is both an API prefix and a frontend route. A
        // browser document navigation (or a refresh) sends Accept: text/html
        // and must get the SPA shell, while API calls keep proxying to the
        // backend.
        bypass(request) {
          if (request.headers.accept?.includes("text/html")) {
            return "/index.html";
          }
        },
      },
      "/available-slots": "http://localhost:8081",
      "/bookings": "http://localhost:8081",
    },
  },
});
