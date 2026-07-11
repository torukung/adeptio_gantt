// Playwright config for the Adeptio Gantt v1.0.3 suite.
// Serves the repo ROOT (one level up) via python3's http.server on :4173 — GitHub
// Pages also serves the repo root, so this mirrors production hosting exactly.
// Chromium-only, single worker (localStorage + a shared static server are global
// state; parallel pages would race). The production-API block lives in fixtures.js.
const { defineConfig, devices } = require("@playwright/test");
const path = require("path");

module.exports = defineConfig({
  testDir: __dirname,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 30000,
  expect: { timeout: 6000 },
  reporter: [["list"], ["json", { outputFile: path.join(__dirname, "results.json") }]],
  use: {
    baseURL: "http://localhost:4173",
    actionTimeout: 8000,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "python3 -m http.server 4173",
    cwd: path.resolve(__dirname, ".."), // repo root
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
