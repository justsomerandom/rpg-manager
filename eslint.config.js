import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "src-tauri/gen", "src-tauri/target"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // These opt-in React 19 rules require state-flow refactors. Keep the
      // current behavior stable during this tooling-only normalization pass.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // Tauri command failures are normalized for display at the API boundary.
      "preserve-caught-error": "off",
    },
  },
);
