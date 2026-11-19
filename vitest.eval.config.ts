import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 10 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
