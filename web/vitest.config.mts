import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url))
    }
  },
  // tsconfig keeps "jsx": "preserve" for Next; component tests need the automatic runtime.
  oxc: {
    jsx: { runtime: "automatic" }
  },
  test: {
    // Unit tests run in node; component tests opt into the DOM per file with
    // `// @vitest-environment jsdom` (see *.test.tsx).
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"]
  }
});
