import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/visual",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    locale: "zh-CN",
    colorScheme: "light",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop-1366x768", use: { viewport: { width: 1366, height: 768 } } },
    { name: "ipad-landscape", use: { viewport: { width: 1180, height: 820 }, isMobile: true, hasTouch: true } },
    { name: "ipad-portrait", use: { viewport: { width: 820, height: 1180 }, isMobile: true, hasTouch: true } },
    { name: "phone-390x844", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
