// Baseline regression — core flows on the app's OWN seed data (no injected doc),
// so pre-existing behavior (dashboard, project shell, real-data pane alignment,
// summary autosave) is guarded alongside the new module features.
const { test, expect, assertAligned } = require("./fixtures");

test.describe("baseline regression (default seed)", () => {
  test("dashboard renders all seeded projects", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator("#dash").waitFor();
    await expect(page.locator(".card[data-open]")).toHaveCount(3);
    await expect(page.locator(".dashHead h1")).toHaveText("Project Tracking");
    await expect(page.getByText("YSC — Inventory & Procurement", { exact: true })).toBeVisible();
  });

  test("open a project → summary then timeline; panes aligned on REAL data", async ({ page }) => {
    await page.goto("/#project=ysc-inv-proc", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#pName")).toHaveText("YSC — Inventory & Procurement");
    await expect(page.locator("#summaryPanel")).toBeVisible();

    await page.locator('.tabBtn[data-tab="timeline"]').click();
    await page.locator("#leftBody .modRow").first().waitFor();
    await expect(page.locator("#axis")).toBeVisible();
    await expect(page.locator("#rowsLayer .bar").first()).toBeVisible();
    await expect(page.locator("#leftBody .modRow")).toHaveCount(6); // 6 seed modules, no subs
    await assertAligned(page, "real-seed timeline");
  });

  test("summary text saves to localStorage", async ({ page }) => {
    await page.goto("/#project=osi-b2c", { waitUntil: "domcontentloaded" });
    await page.locator("#sumText").waitFor();
    await page.locator("#sumText").fill("อัปเดตทดสอบ regression");
    await page.locator("#sumSave").click();
    const doc = JSON.parse(await page.evaluate(() => localStorage.getItem("adeptio_ptrack_v2")));
    const p = doc.projects.find((x) => x.id === "osi-b2c");
    expect(p.summary.current.text).toBe("อัปเดตทดสอบ regression");
  });
});
