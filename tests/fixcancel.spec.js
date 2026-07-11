// @ts-check
/* v1.0.3 POINTERCANCEL LATCH FIX — regression suite.
 *
 * DEFECT (adversarial audit): the `_interacting` latch is set by beginInteract()
 * in every drag-START handler, but pre-fix it was cleared ONLY by a `pointerup`
 * handler. No drag lifecycle listened for `pointercancel`, so if a drag ended via
 * pointercancel (touch/trackpad gesture reinterpreted as scroll, mobile app-switch,
 * pointer-device loss) endInteract() never ran: `_interacting` stuck true for the
 * whole page session, editingNow() then permanently blocked cloudPull adoption AND
 * the cross-tab `storage` listener — cloud/cross-tab sync silently frozen until a
 * reload. The dragged ghost + the pointermove listener also leaked on that path.
 *
 * FIX: every *Up handler is registered for BOTH 'pointerup' and 'pointercancel',
 * is idempotent, and removes ALL of its listeners (pointermove + both siblings) so
 * nothing leaks whichever fires. Defense-in-depth: renderBoard() self-heals a stuck
 * latch when no drag object is in flight.
 *
 * Reuses ./fixtures (production-Worker block + pageerror/console guard are auto). */
const { test, expect, openTimeline, SEED_A, LS_KEY } = require("./fixtures");

/* A drag ended by pointercancel must behave EXACTLY like a clean pointerup for the
   latch + cleanup, and must NOT freeze background sync. */
test("FIX7(module): pointercancel clears the latch, removes the ghost, and un-freezes sync", async ({ page }) => {
  await openTimeline(page, SEED_A());

  // Begin (but do NOT finish) a module drag: pointerdown on the grip creates the
  // .modGhost and latches interaction; a small move keeps the drag live.
  const grip = page.locator('#leftBody .modRow[data-mi="0"] .modGrip');
  const gb = await grip.boundingBox();
  expect(gb, "module grip must be present").not.toBeNull();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 30, { steps: 5 });

  // Drag is live: latch engaged, editing gate closed, ghost mounted.
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(true);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(true);
  expect(await page.locator(".modGhost").count()).toBeGreaterThan(0);

  // The pointer is CANCELLED instead of released (touch→scroll, app-switch, device loss).
  await page.evaluate(() => window.dispatchEvent(new Event("pointercancel")));

  // (a) latch cleared; (b) editing gate open so cloud/cross-tab adoption is allowed again;
  // and the ghost node did NOT leak.
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(false);
  expect(await page.locator(".modGhost").count()).toBe(0);

  // Release the real pointer: the pointerup sibling was removed, so this is an inert
  // no-op for the app (the auto pageerror/console guard would catch any fallout).
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

/* The same guarantee for a timeline bar drag (setPointerCapture + .dragging path). */
test("FIX7(bar): pointercancel clears the latch and leaves no bar stuck in .dragging", async ({ page }) => {
  await openTimeline(page, SEED_A());

  const bar = page.locator("#rowsLayer .bar").first();
  const bb = await bar.boundingBox();
  expect(bb, "at least one timeline bar must be present").not.toBeNull();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2 + 24, bb.y + bb.height / 2, { steps: 5 }); // enter bar drag

  expect(await page.evaluate(() => window["isInteracting"]())).toBe(true);
  expect(await page.locator("#rowsLayer .bar.dragging").count()).toBeGreaterThan(0);

  // Cancel instead of release.
  await page.evaluate(() => window.dispatchEvent(new Event("pointercancel")));

  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(false);
  expect(await page.locator("#rowsLayer .bar.dragging").count()).toBe(0); // no stuck drag state
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

/* Defense-in-depth: even if a latch somehow sticks (a drag path we didn't reach), a
   full renderBoard() with no drag object in flight self-heals it back to false. */
test("FIX7(self-heal): renderBoard() clears a stray latch when no drag is in flight", async ({ page }) => {
  await openTimeline(page, SEED_A());

  // Force the pathological stuck state directly, then trigger a full board render.
  await page.evaluate(() => window["beginInteract"]());
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(true);

  await page.evaluate(() => window["renderBoard"]());

  // No drag object is live, so the latch is auto-cleared.
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(false);
});
