import { defineConfig } from "oxlint"

export default defineConfig({
  plugins: ["eslint", "import", "jsx-a11y", "oxc", "promise", "react", "typescript", "unicorn", "vitest"],
  categories: { correctness: "error" },
  options: { denyWarnings: true, reportUnusedDisableDirectives: "error" },
  ignorePatterns: [
    ".agent/**",
    ".agents/**",
    ".claude/**",
    ".codex/**",
    ".continue/**",
    ".cursor/**",
    ".gemini/**",
    ".opencode/**",
    ".pi/**",
    ".roo/**",
    ".superpowers/**",
    ".windsurf/**",
    "tools/oxlint/anti-slop/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "gamesheet", specifier: "@gamesheet-inc/oxlint-plugin" },
  ],
  rules: {
    complexity: ["error", { max: 10, variant: "classic" }],
    "no-restricted-properties": [
      "error",
      {
        object: "Schema",
        property: "Number",
        message:
          'Schema.Number accepts NaN and ±Infinity, and decodes the JSON strings "NaN" and "Infinity" into them. Use Schema.Finite or Schema.Int.',
      },
      {
        object: "Schema",
        property: "NumberFromString",
        message: 'Schema.NumberFromString decodes "NaN" and "Infinity". Use Schema.FiniteFromString.',
      },
    ],
    "gamesheet/no-comments": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
  overrides: [
    {
      files: ["packages/domain/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@strix/**", "../**/contracts", "../**/contracts/**", "../**/apps/**"],
                message: "@strix/domain imports nothing else from the workspace (plan §1).",
              },
              {
                group: [
                  "effect",
                  "effect/**",
                  "@effect/**",
                  "react",
                  "react/**",
                  "react-dom",
                  "react-dom/**",
                  "cloudflare:*",
                  "node:*",
                ],
                message: "@strix/domain is pure TypeScript: no framework or runtime imports (plan §3.1).",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["packages/contracts/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@strix/web", "@strix/worker", "../**/apps/**"],
                message: "@strix/contracts may import @strix/domain only (plan §1).",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["apps/web/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@strix/worker", "@strix/worker/**", "../**/worker", "../**/worker/**"],
                message: "The client never imports Worker code.",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["apps/worker/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@strix/web", "@strix/web/**", "../**/web", "../**/web/**"],
                message: "The Worker never imports client code.",
              },
            ],
          },
        ],
      },
    },
  ],
})
