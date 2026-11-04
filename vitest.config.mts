import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "node_modules.corrupt/**"],
  },
});
