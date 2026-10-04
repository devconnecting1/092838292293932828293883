import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import pluginReactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

import { config as baseConfig } from "./base.js"

/**
 * A custom ESLint configuration for libraries that use React.
 *
 * Sem eslint-plugin-react: ele não suporta o ESLint 10. O parser do typescript-eslint
 * (em tseslint.configs.recommended) já entende JSX em .tsx, e o ESLint 10 rastreia
 * referências em JSX nativamente.
 *
 * @type {import("eslint").Linter.Config} */
export const config = [
  ...baseConfig,
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
  {
    plugins: {
      "react-hooks": pluginReactHooks,
    },
    rules: {
      ...pluginReactHooks.configs.recommended.rules,
    },
  },
]
