// @ts-check
/* Column header interactions:
   - drag-reorder (persisted to the doc's colOrder),
   - drag-resize (local-only, persisted to ui.colW in the separate UI localStorage
     key — NEVER written back to the doc), and
   - the description-column wrap toggle, which flips ui.wrapTxt and re-syncs the
     right-pane row heights to the (now taller, wrapped) left rows. */
const { test, expect } = require("./fixtures.fix");
const {
  seedDoc, minimalDoc, openProject, gotoTimeline,
  readProject, readUi, assertPanesAligned, LS_KEY,
} = require("./helpers.fix");

const headerKeys = (page) =>
  page.$$eval("#leftHead .colHead", (hs) => hs.map((h) => h.dataset.key));

const boxOf = (page, sel) => page.locator(sel).boundingBox();

/* Drag a column header onto another; `before` chooses the left/right half so the
   insert side is deterministic. Moves past the 4px start threshold first. */
async function dragColumn(page, srcKey, tgtKey, before = true) {
  const src = await boxOf(page, `.colHead[data-key="${srcKey}"]`);
  const tgt = await boxOf(page, `.colHead[data-key="${tgtKey}"]`);
  const sx = src.x + src.width / 2, sy = src.y + src.height / 2;
  const tx = tgt.x + tgt.width * (before ? 0.2 : 0.8), ty = tgt.y + tgt.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 10, sy, { steps: 3 }); // exceed the 4px drag threshold
  await page.mouse.move(tx, ty, { steps: 14 });
  await page.mouse.move(tx, ty, { steps: 3 });
  await page.mouse.up();
}

test.describe("column reorder", () => {
  test.beforeEach(async ({ page }) => {
    await seedDoc(page, minimalDoc());
    await openProject(page, "test-proj");
    await gotoTimeline(page);
  });

  // Reorder two headers that are fully inside the 680px left pane (the last two
  // columns — status/remark — have clipped centers at the 1600px test viewport,
  // so they can't be grabbed reliably; End/Feature are always visible).
  test("drag the End header before the Feature header and persist colOrder", async ({ page }) => {
    expect(await headerKeys(page)).toEqual(["name", "description", "start", "end", "status", "remark"]);
    await dragColumn(page, "end", "name", true);
    await expect
      .poll(() => headerKeys(page))
      .toEqual(["end", "name", "description", "start", "status", "remark"]);

    const proj = await readProject(page);
    expect(proj.colOrder).toEqual(["end", "name", "description", "start", "status", "remark"]);
    await assertPanesAligned(page, "after column reorder");
  });

  test("dropping a column back on itself is a no-op", async ({ page }) => {
    await dragColumn(page, "start", "start", true);
    // order unchanged
    expect(await headerKeys(page)).toEqual(["name", "description", "start", "end", "status", "remark"]);
  });
});

test.describe("column resize", () => {
  test.beforeEach(async ({ page }) => {
    await seedDoc(page, minimalDoc());
    await openProject(page, "test-proj");
    await gotoTimeline(page);
  });

  test("dragging the resize handle widens the column and writes ui.colW only (not the doc)", async ({ page }) => {
    const before = await boxOf(page, '.colHead[data-key="name"]');
    const rz = await boxOf(page, '.colHead[data-key="name"] .colResize');
    const sx = rz.x + rz.width / 2, sy = rz.y + rz.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + 60, sy, { steps: 12 });
    await page.mouse.up();

    // Header re-rendered at the new width (~ +60px from the 190px default).
    await expect
      .poll(async () => Math.round((await boxOf(page, '.colHead[data-key="name"]')).width))
      .toBeGreaterThan(Math.round(before.width) + 40);

    // Width persisted to the UI store (local-only), clamped to [60,640].
    // v1.0.3 FIX 6: ui.colW is now namespaced per project id ({pid:{key:w}}) so a
    // resize in one project no longer bleeds into others. The seeded project id is "test-proj".
    const uiState = await readUi(page);
    expect(uiState.colW).toBeTruthy();
    expect(uiState.colW["test-proj"]).toBeTruthy();
    expect(uiState.colW["test-proj"].name).toBeGreaterThan(230);
    expect(uiState.colW["test-proj"].name).toBeLessThanOrEqual(640);

    // The DOCUMENT must be untouched by a width change (no customCols, no width field).
    const proj = await readProject(page);
    expect(proj.customCols).toEqual([]);
    expect(JSON.stringify(proj)).not.toContain('"w":250');

    await assertPanesAligned(page, "after column resize");
  });
});

test.describe("wrap toggle", () => {
  test("enabling wrap grows a long-description row and re-syncs the right pane", async ({ page }) => {
    const doc = minimalDoc();
    doc.projects[0].modules[0].features[0].description =
      "This is a deliberately very long description that must wrap across several lines " +
      "inside the narrow description column so the feature row grows taller than the default " +
      "single-line row height when word wrapping is switched on.";
    await seedDoc(page, doc);
    await openProject(page, "test-proj");
    await gotoTimeline(page);

    const rowSel = '.featRow[data-nid="fa1"]'; // v1.0.4: row addressed by feature node id (minimalDoc first feature = "fa1")
    const hBefore = (await boxOf(page, rowSel)).height;
    await assertPanesAligned(page, "wrap off");

    await page.click('.wrapToggle[data-act="wraptoggle"]');
    await expect(page.locator("#board")).toHaveClass(/wrapon/);
    await expect(page.locator('.wrapToggle')).toHaveClass(/on/);

    // The wrapped row is now clearly taller than the single-line baseline.
    await expect
      .poll(async () => (await boxOf(page, rowSel)).height)
      .toBeGreaterThan(hBefore + 10);

    // Right-pane bar rows were height-synced to the left rows → panes still aligned.
    await assertPanesAligned(page, "wrap on");

    // ui.wrapTxt persisted to the UI store.
    const uiState = await readUi(page);
    expect(uiState.wrapTxt).toBe(true);
  });
});
