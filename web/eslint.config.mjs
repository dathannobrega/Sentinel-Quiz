import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 ships native flat configs (no FlatCompat / @eslint/eslintrc bridge).
const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "out/**", "coverage/**", "next-env.d.ts"]
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      "no-restricted-globals": [
        "error",
        { name: "confirm", message: "Use the ConfirmDialog component instead of window.confirm." },
        { name: "alert", message: "Use an Alert notice instead of window.alert." }
      ]
    }
  },
  {
    // New in eslint-plugin-react-hooks 7 (bundled with eslint-config-next 16). They flag patterns that
    // predate the upgrade (setState in reset effects, Date.now() in initializers, string heading tags
    // seen as components). Kept visible as warnings until those call sites are refactored on purpose.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn"
    }
  },
  {
    // Playwright fixtures receive a `use` callback that is not a React hook.
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    rules: {
      "react-hooks/rules-of-hooks": "off"
    }
  }
];

export default eslintConfig;
