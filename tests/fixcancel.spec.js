// @ts-check
/* v1.0.3 CENTRALIZED DRAG-GUARD — regression suite (background-sync deferral).
 *
 * DESIGN: a single capture-phase guard defers background sync during ANY pointer
 * drag/resize. ONE document-level `pointerdown` (capture) latches `_dragging` when the
 * press lands on a drag handle (.bar/.grip/.colHead/.colResize/#splitter/.pgrip/
 * .modGrip); ONE document-level `pointerup` + `pointercancel` (capture) clears it.
 * Capture-phase document listeners ALWAYS fire — even under setPointerCapture, and on
 * the cancel path (touch→scroll, app-switch, device loss) — so the guard can NEVER
 * stick true. editingNow() consults it, so cloudPull adoption + the cross-tab `storage`
 * listener defer while a drag is live and resume the instant it ends.
 *
 * This REPLACES the old per-handler start/end interaction latch, the per-handler
 * `pointercancel` registrations, and the renderBoard() self-heal — none of that
 * machinery exists anymore, and no self-heal is needed. isInteracting() is kept as
 * the observable shim (returns _dragging). These tests assert OBSERVABLE behavior (guard
 * state + sync un-freeze), never internal bookkeeping.
 *
 * NOTE: the cancel is dispatched on `document` (where the capture-phase guard lives), so
 * it exercises the exact node a real, DOM-propagated pointercancel would reach.
 *
 * Reuses ./fixtures (production-Worker block + pageerror/console guard are auto). */
const { test, expect, openTimeline, SEED_A, LS_KEY } = require("./fixtures");

/* A module drag interrupted by pointercancel must NOT freeze background sync: the guard
   clears and cross-tab/cloud adoption is allowed again (the pre-fix bug froze it). */
test("FIX7(module): a pointercancel clears the drag guard and un-freezes background sync", async ({ page }) => {
  await openTimeline(page, SEED_A());

  // Begin (but do NOT finish) a module drag: pointerdown on the grip latches the guard
  // (capture-phase) and creates the .modGhost; a small move keeps the drag live.
  const grip = page.locator('#leftBody .modRow[data-nid="m-alpha"] .modGrip'); // v1.0.4: row addressed by container node id (SEED_A first module = "m-alpha")
  const gb = await grip.boundingBox();
  expect(gb, "module grip must be present").not.toBeNull();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 30, { steps: 5 });

  // Drag is live: guard engaged, editing gate closed, ghost mounted.
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(true);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(true);
  expect(await page.locator(".modGhost").count()).toBeGreaterThan(0);

  // The pointer is CANCELLED (touch→scroll, app-switch, device loss). The document-level
  // capture pointercancel ALWAYS fires and clears the guard.
  await page.evaluate(() => document.dispatchEvent(new Event("pointercancel")));

  // (a) guard cleared; (b) editing gate open again, so cloud/cross-tab adoption resumes.
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(false);

  // Release the real pointer: the drag's own pointerup handler fires and tears the
  // (targetless) drag down; the auto pageerror/console guard would catch any fallout.
  await page.mouse.up();

  // Prove sync truly recovered: the cross-tab storage path now re-renders (route()
  // runs -> project re-renders on its summary landing tab). Pre-fix this was blocked.
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    d.projects[0].modules[0].name = "ADOPTED_AFTER_CANCEL";
    localStorage.setItem(key, JSON.stringify(d));
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) }));
  }, LS_KEY);
  await page.waitForSelector("#sumText");
});

/* The same guarantee for a timeline bar drag: the bar takes setPointerCapture, yet the
   capture-phase document pointercancel still clears the guard and un-freezes sync. */
test("FIX7(bar): a pointercancel clears the guard even under setPointerCapture", async ({ page }) => {
  await openTimeline(page, SEED_A());

  const bar = page.locator("#rowsLayer .bar").first();
  const bb = await bar.boundingBox();
  expect(bb, "at least one timeline bar must be present").not.toBeNull();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 24, bb.y + bb.height / 2, { steps: 5 }); // enter bar drag

  expect(await page.evaluate(() => window["isInteracting"]())).toBe(true);
  expect(await page.locator("#rowsLayer .bar.dragging").count()).toBeGreaterThan(0);

  // Cancel instead of release. The bar holds pointer capture, but the capture-phase
  // document pointercancel still fires and clears the guard.
  await page.evaluate(() => document.dispatchEvent(new Event("pointercancel")));

  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(false);
  await page.mouse.up();

  // Idle storage adoption is no longer blocked.
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    d.projects[0].modules[0].name = "BAR_CANCEL_ADOPTED";
    localStorage.setItem(key, JSON.stringify(d));
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) }));
  }, LS_KEY);
  await page.waitForSelector("#sumText");
});

/* The single capture-phase guard REPLACES the old renderBoard() self-heal: the guard
   latches on a handle press and always clears on cancel/release, so it can never stick
   and renderBoard() no longer needs to heal it. */
test("FIX7(central-guard): the guard latches on a handle, clears on cancel, and can never stick", async ({ page }) => {
  await openTimeline(page, SEED_A());

  // A real press on a drag handle (timeline bar) latches the guard via the SINGLE
  // capture-phase pointerdown listener — no per-handler latch call involved.
  const bar = page.locator("#rowsLayer .bar").first();
  const bb = await bar.boundingBox();
  expect(bb, "at least one timeline bar must be present").not.toBeNull();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(true);

  // A document-level (capture) pointercancel clears it even though NO per-handler *Up
  // runs on a cancel path — so the guard can never stick true.
  await page.evaluate(() => document.dispatchEvent(new Event("pointercancel")));
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(false);

  await page.mouse.up(); // release the real button; the (targetless) drag tears down cleanly

  // renderBoard() used to self-heal a stuck latch; the guard is now structurally clear,
  // so a full re-render neither sets nor needs to clear it.
  await page.evaluate(() => window["renderBoard"]());
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);
});
