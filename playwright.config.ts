import { defineConfig } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import path from "path";

// Minimal .env loader (no extra dependency) — only used for local test
// credentials, never for secrets that matter beyond this throwaway test run.
const envFile = path.join(__dirname, ".env.playwright.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2];
    }
  }
}

export default defineConfig({
  testDir: "./playwright-tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // The venue plan editor renders an up-to-800px-square Stage below its
    // mode toolbar; the default 720px-tall viewport clips the bottom of the
    // canvas, so plain (non-drag) clicks near the canvas's lower edge would
    // land outside the viewport entirely. Height includes headroom for the
    // page's usage-instructions paragraph and step-progress bar (added above
    // the toolbar) so the full 50x50m stage stays reachable by
    // page.mouse.click() without scrolling.
    viewport: { width: 1280, height: 1250 },
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
