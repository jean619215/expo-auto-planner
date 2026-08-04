import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 第三方 vendored 產物,原封不動從 three 複製過來(由
    // scripts/build-venue-models.mjs 維護),不該套我們的風格規則。
    "public/draco/**",
  ]),
]);

export default eslintConfig;
