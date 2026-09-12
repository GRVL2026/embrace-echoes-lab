/**
 * Config dédiée aux tests de géométrie pure (caméra du Planner).
 * Pas de plugin React, pas de jsdom, pas de setup : démarrage en ~1 s au lieu de plusieurs
 * minutes avec la config applicative. C'est ce qui rend le harnais utilisable en pré-commit.
 *
 *   npx vitest run --config vitest.harness.config.ts
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/test/plannerCamera.test.ts", "src/test/harness/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
