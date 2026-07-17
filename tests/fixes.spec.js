// @ts-check
/* v1.0.3 INTEGRITY FIXES — regression suite (one test per confirmed finding).
 *
 * FIX 1  Stored/DOM XSS via unescaped date values -> esc() every date value=.
 * FIX 2  Unsaved summary text lost on navigation  -> blur-save + save-before-hist.
 * FIX 3  Cloud pull adopts remote doc mid-drag     -> interaction latch gates sync.
 * FIX 4  pushPending latches true after failed push-> clear latch + backoff retry.
 * FIX 5  Silent localStorage write failure         -> one-time warning toast.
 * FIX 6  Column widths bleed across projects        -> per-project ui.colW[PID][key].
 *
 * All specs import { test, expect } from ../fixtures so the production-API block
 * and the pageerror-fail guard are unconditional (see fixtures.js). */
const { test, expect } = require("./fixtures.fix");
const {
  seedDoc, minimalDoc, openProject, gotoTimeline,
  readProject, readUi, LS_KEY,
} = require("./helpers.fix");

const boxOf = (page, sel) => page.locator(sel).boundingBox();

/* Two independent projects (A = "test-proj", B = "proj-b") for the per-project
   width-isolation test. B is a structural clone of A with a distinct id/name. */
function twoProjectDoc() {
  const d = minimalDoc();
  const b = JSON.parse(JSON.stringify(d.projects[0]));
  b.id = "proj-b"; b.name = "Project B"; b.code = "PB";
  d.projects.push(b);
  return d;
}

/* ---------- FIX 1 — XSS-inert date values ---------- */
test("FIX1: a malicious start date is HTML-escaped (no injected element, no script)", async ({ page }) => {
  const doc = minimalDoc();
  // Classic attribute-breakout payload placed in a persisted date field.
  doc.projects[0].modules[0].features[0].start = '"><img src=x onerror="window.__xss=1">';
  await seedDoc(page, doc);
  await openProject(page, "test-proj");
  await gotoTimeline(page); // renders the grid (#leftBody) incl. the start-date cell
  await page.waitForTimeout(200); // give any injected onerror the chance to fire

  // The onerror never ran and no <img> was injected into the grid.
  expect(await page.evaluate(() => window["__xss"])).toBeUndefined();
  expect(await page.locator("#leftBody img").count()).toBe(0);

  // The payload survives only as an inert attribute value (present as literal text,
  // not parsed as markup) — proving esc() neutralised it at HTML-parse time.
  const attr = await page.evaluate(() =>
    document.querySelector('#leftBody input[type=date][data-field="start"]').getAttribute("value")
  );
  expect(attr).toContain("<img"); // literal text inside the attribute, not an element
});

/* ---------- FIX 2 — summary text autosaves before navigation ---------- */
test("FIX2: summary text is persisted when navigating to history (not dropped)", async ({ page }) => {
  await seedDoc(page, minimalDoc());
  await openProject(page, "test-proj"); // summary is the landing tab
  await page.waitForSelector("#sumText");

  const typed = "ความคืบหน้าล่าสุด — ทดสอบ autosave " + Date.now();
  await page.fill("#sumText", typed);

  // Navigate to the history overlay via the history button (location.hash nav,
  // which bypasses switchTab's autosave — the reported data-loss path).
  await page.click("#sumHist");
  await page.waitForSelector("#historyOverlay .histItem");

  // The current summary text must be in the persisted model, not lost.
  expect((await readProject(page)).summary.current.text).toBe(typed);

  // Round-trip: reload the project; the textarea shows the persisted text.
  await openProject(page, "test-proj");
  await page.waitForSelector("#sumText");
  expect(await page.inputValue("#sumText")).toBe(typed);
});

/* ---------- FIX 3 — background sync defers while a drag is in flight ---------- */
test("FIX3: a live drag sets the interaction guard so a storage adopt is deferred", async ({ page }) => {
  await seedDoc(page, minimalDoc());
  await openProject(page, "test-proj");
  await gotoTimeline(page);

  // Begin (but do NOT finish) a feature-row drag: pointerdown on the grip, then move.
  // v1.0.4: rows addressed by data-nid (minimalDoc's first feature id = "fa1").
  const gb = await boxOf(page, '.featRow[data-nid="fa1"] .grip');
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2 + 24, { steps: 5 }); // enter rowDrag

  // The app reports it is interacting/editing, so cloudPull + the storage listener defer.
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(true);
  expect(await page.evaluate(() => window["editingNow"]())).toBe(true);
  expect(await page.locator(".rowGhost").count()).toBeGreaterThan(0); // drag is live

  // Simulate a cross-tab write of a DIFFERENT doc + the storage event that drives adoption.
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    d.projects[0].modules[0].name = "HIJACKED_MODULE";
    localStorage.setItem(key, JSON.stringify(d));
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) }));
  }, LS_KEY);

  // No mid-drag re-render: the original module row is still present and unchanged.
  // (An adopt would run route()->renderProject, resetting to the summary tab and
  //  destroying the grid, which would corrupt the in-flight drag.)
  await expect(page.locator('.modRow[data-nid="mod-a"] .modName')).toHaveText("Module A");
  expect(await page.locator(".rowGhost").count()).toBeGreaterThan(0);

  await page.mouse.up(); // finish the drag cleanly
  expect(await page.evaluate(() => window["isInteracting"]())).toBe(false);

  // CONTROL (proves the test isn't vacuous): when idle, the SAME storage path DOES
  // re-render — route() runs and the project re-renders on its summary landing tab.
  await page.evaluate((key) => {
    const d = JSON.parse(localStorage.getItem(key));
    d.projects[0].modules[0].name = "IDLE_ADOPTED";
    localStorage.setItem(key, JSON.stringify(d));
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) }));
  }, LS_KEY);
  await page.waitForSelector("#sumText"); // route() executed -> project re-rendered
});

/* ---------- FIX 4 — failed push clears the pushPending latch ---------- */
test("FIX4: a failed cloud push clears pushPending (no permanent adoption block)", async ({ page }) => {
  await seedDoc(page, minimalDoc());
  await openProject(page, "test-proj");
  await gotoTimeline(page);

  // A mutation schedules a push: pushPending flips true synchronously; cloudPush()
  // fires ~800ms later and fails because the fixture aborts the production host.
  await page.click('.modRow[data-nid="mod-a"] .caret[data-act="toggle"]');
  expect(await page.evaluate(() => window["cloudSyncState"]().pushPending)).toBe(true);

  // After the push fails, the latch must return to false (otherwise cloudPull
  // adoption would be blocked forever).
  await expect
    .poll(() => page.evaluate(() => window["cloudSyncState"]().pushPending), { timeout: 5000 })
    .toBe(false);
});

/* ---------- FIX 5 — localStorage write failure surfaces a toast ---------- */
test("FIX5: a failed localStorage write shows a warning toast (not silent)", async ({ page }) => {
  await seedDoc(page, minimalDoc());
  await openProject(page, "test-proj");
  await gotoTimeline(page);

  // Make every localStorage write throw (quota exceeded / private-mode).
  await page.evaluate(() => { localStorage.setItem = () => { throw new Error("QuotaExceeded"); }; });

  // A mutation -> Store.save() -> safeSet() returns false -> one-time warning toast.
  await page.click('.modRow[data-nid="mod-a"] .caret[data-act="toggle"]');
  await expect(page.locator("#toast")).toContainText("บันทึกลงเครื่องไม่สำเร็จ");
  await expect(page.locator("#toast")).toHaveClass(/show/);
});

/* ---------- FIX 6 — column widths are namespaced per project ---------- */
test("FIX6: resizing a column in one project does not affect another", async ({ page }) => {
  await seedDoc(page, twoProjectDoc());
  await openProject(page, "test-proj"); // project A
  await gotoTimeline(page);

  // Widen the "Feature" (name) column in A by dragging its resize handle.
  const before = await boxOf(page, '.colHead[data-key="name"]');
  const rz = await boxOf(page, '.colHead[data-key="name"] .colResize');
  await page.mouse.move(rz.x + rz.width / 2, rz.y + rz.height / 2);
  await page.mouse.down();
  await page.mouse.move(rz.x + 70, rz.y + rz.height / 2, { steps: 10 });
  await page.mouse.up();

  const widenedA = Math.round((await boxOf(page, '.colHead[data-key="name"]')).width);
  expect(widenedA).toBeGreaterThan(Math.round(before.width) + 40);

  // The width is stored ONLY under project A's id — project B has no entry.
  let uiState = await readUi(page);
  expect(uiState.colW["test-proj"]).toBeTruthy();
  expect(uiState.colW["test-proj"].name).toBeGreaterThan(230);
  expect(uiState.colW["proj-b"]).toBeUndefined();

  // Project B's Feature column is still the default width (no cross-project bleed).
  await openProject(page, "proj-b");
  await gotoTimeline(page);
  const bWidth = Math.round((await boxOf(page, '.colHead[data-key="name"]')).width);
  expect(bWidth).toBeLessThan(widenedA - 30);

  // Reload A: its widened width persisted; B's persisted store is untouched.
  await openProject(page, "test-proj");
  await gotoTimeline(page);
  const reloadA = Math.round((await boxOf(page, '.colHead[data-key="name"]')).width);
  expect(Math.abs(reloadA - widenedA)).toBeLessThanOrEqual(2);
  uiState = await readUi(page);
  expect(uiState.colW["test-proj"].name).toBeGreaterThan(230);
  expect(uiState.colW["proj-b"]).toBeUndefined();
});
