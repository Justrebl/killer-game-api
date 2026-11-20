import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "**/*.browser.spec.mjs",
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL
  },
  webServer: {
    command: "node test/serve-docs.mjs",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true
  }
});
