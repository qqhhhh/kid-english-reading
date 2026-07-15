import { expect, test, type Page } from "@playwright/test";

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.innerWidth + 2);
  expect(dimensions.bodyScrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.innerWidth + 2);
}

test("child entry redirects to a fitting login page", async ({ page }, testInfo) => {
  await page.goto("/practice", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/login\?next=%2Fpractice/);
  await expect(page.locator("body")).toBeVisible();
  await expectNoPageOverflow(page);
  const readingPane = page.locator(".sb-reading-pane");
  const voicePicker = page.locator(".sb-stage-toolbar .voice-picker");
  if ((await readingPane.count()) > 0 && (await voicePicker.count()) > 0) {
    const [paneBox, pickerBox] = await Promise.all([readingPane.boundingBox(), voicePicker.boundingBox()]);
    expect(paneBox).not.toBeNull();
    expect(pickerBox).not.toBeNull();
    expect(pickerBox!.x + pickerBox!.width).toBeLessThanOrEqual(paneBox!.x + paneBox!.width + 1);
  }
  await page.screenshot({ path: testInfo.outputPath("child-practice.png"), fullPage: true });
  await page.close();
});

test("parent entry redirects to a fitting login page", async ({ page }, testInfo) => {
  await page.goto("/parent?section=overview", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/login\?next=%2Fparent%3Fsection%3Doverview/);
  await expect(page.locator("body")).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("parent-overview.png"), fullPage: true });
  await page.close();
});
