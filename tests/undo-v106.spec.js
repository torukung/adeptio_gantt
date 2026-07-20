// @ts-check
/* E2 — 5-step undo / redo (SPEC_v1.0.6 §3 + R-E2a..c).
 *
 * Whole-doc snapshots ride Store.save's exact serialization, session-only, capped at 5. The engine
 * state lives in top-level `let undoStack/redoStack` bindings — reachable by BARE name inside
 * page.evaluate (same global-lexical trick the E1 suite uses for `ui`), so these tests pin stack
 * lengths exactly instead of inferring them. `undo/redo/adoptRemote/Store/DB/PID` are likewise in
 * scope. Doc state is read from localStorage (readDoc) — the restore path persists via safeSet.
 *
 * Host-block + zero-prod-request + pageerror/console guards are auto from ./fixtures. */
const { test, expect, openTimeline, seed, SEED_A, readDoc, docFindNode } = require("./fixtures");

const MOD = process.platform === "darwin" ? "Meta" : "Control";

// One real, distinct doc mutation through the app's ONE stamping point (Store.save → history capture).
// Renames the first container; no re-render needed — history + localStorage are what we assert.
async function edit(page, name) {
  await page.evaluate((v) => { const P = DB.projects.find((p) => p.id === PID); P.modules[0].name = v; Store.save(); }, name);
}
const counts = (page) => page.evaluate(() => ({ u: undoStack.length, r: redoStack.length }));
// openTimeline() clicks the timeline tab, whose switchTab() autosaves the summary — but that Store.save
// writes the SAME text/date, a DATA no-op, so Store.save's updatedAt-stripped dirty-check spends NO
// history slot (SPEC §3). Earlier this suite masked a bug here by nulling the stacks; the audit flagged
// that workaround. The fix is real, so we ASSERT the clean baseline instead of hiding it: opening a
// project and viewing its chart must not silently consume one of the user's 5 undo steps.
async function expectFreshHistory(page) {
  const c = await counts(page);
  expect(c.u, "opening the timeline spends no undo slot (no-op summary autosave, §3 dirty-check)").toBe(0);
  expect(c.r).toBe(0);
}
const modName = async (page) => (await readDoc(page)).projects[0].modules[0].name;
const undoBtn = (page) => page.locator('[data-act="undo"]').first();
const redoBtn = (page) => page.locator('[data-act="redo"]').first();

async function openDashboard(page, doc) {
  if (doc) await seed(page, doc);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator("#dash").waitFor();
}

test.describe("E2 — undo / redo, 5 steps", () => {
  test("(a) 6 distinct edits → exactly 5 undos land, oldest dropped (final == state after edit #1)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await expectFreshHistory(page);
    for (let i = 1; i <= 6; i++) await edit(page, "N" + i);

    let c = await counts(page);
    expect(c.u, "undo stack caps at 5 (the pre-edit-1 snapshot was shifted out)").toBe(5);
    expect(c.r).toBe(0);
    expect(await modName(page)).toBe("N6");

    for (let i = 0; i < 5; i++) await page.evaluate(() => undo());
    c = await counts(page);
    expect(c.u, "5 undos exhaust the capped stack").toBe(0);
    expect(c.r, "each undo pushed onto redo").toBe(5);
    expect(await modName(page), "landed on the state after edit #1 — cannot reach the dropped pure-seed state").toBe("N1");
    await expect(undoBtn(page)).toBeDisabled();

    await page.evaluate(() => undo()); // 6th undo is a no-op
    expect(await modName(page)).toBe("N1");
  });

  test("(b) redo replays exactly what undo reverted", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await expectFreshHistory(page);
    await edit(page, "A");
    await edit(page, "B");
    expect(await modName(page)).toBe("B");

    await page.evaluate(() => undo());
    expect(await modName(page)).toBe("A");
    await page.evaluate(() => redo());
    expect(await modName(page)).toBe("B");

    const c = await counts(page);
    expect(c.u).toBe(2);
    expect(c.r).toBe(0);
  });

  test("(c) a fresh edit clears the redo stack (redo button disabled)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await edit(page, "A");
    await edit(page, "B");
    await page.evaluate(() => undo());
    expect((await counts(page)).r).toBe(1);
    await expect(redoBtn(page)).toBeEnabled();

    await edit(page, "C"); // fresh edit → redo must clear
    expect((await counts(page)).r).toBe(0);
    await expect(redoBtn(page)).toBeDisabled();
    expect(await modName(page)).toBe("C");
  });

  test("(d) disabled states track the stacks across dashboard ↔ project render swaps", async ({ page }) => {
    await openDashboard(page, SEED_A());
    await expect(page.locator('#dash [data-act="undo"]')).toBeDisabled();
    await expect(page.locator('#dash [data-act="redo"]')).toBeDisabled();

    // a dashboard-level mutation (PID null) → undo becomes available
    await page.evaluate(() => { DB.projects[0].name = "X"; Store.save(); renderDashboard(); });
    await expect(page.locator('#dash [data-act="undo"]')).toBeEnabled();
    await expect(page.locator('#dash [data-act="redo"]')).toBeDisabled();

    // swap to the project view — the SAME stacks must drive the freshly-built topbar buttons
    await page.evaluate(() => { location.hash = "project=test-proj"; });
    await page.locator("#proj").waitFor();
    await expect(page.locator('#proj [data-act="undo"]')).toBeEnabled();
    await expect(page.locator('#proj [data-act="redo"]')).toBeDisabled();

    await page.evaluate(() => undo()); // consume the single entry
    await expect(page.locator('#proj [data-act="undo"]')).toBeDisabled();
    await expect(page.locator('#proj [data-act="redo"]')).toBeEnabled();
  });

  test("(e) a no-op save spends no slot AND preserves redo (Store.save's own dirty-check, not just call-site guards)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await edit(page, "X");
    await edit(page, "Y");
    await page.evaluate(() => undo()); // back at X; redo now holds one entry (→ "Y")
    const before = await counts(page);
    expect(before.u, "one undo left after undoing Y").toBe(1);
    expect(before.r, "one redo pending").toBe(1);

    // (1) call-site guard: blur a feature-name contenteditable without changing the text → onTextBlur
    //     dirty-checks and returns BEFORE ever reaching Store.save.
    await page.evaluate(() => { const c = document.querySelector('#leftBody .featRow .cell.feat .txt'); c.focus(); c.blur(); });
    // (2) Store.save's OWN guard: a bare no-op Store.save() (only the updatedAt restamp differs from the
    //     current doc) is the path the summary autosave / no-change modal save / splitter click take. It
    //     must not spend a slot NOR wipe redo — that's the §3 guarantee bug the audit caught (the raw
    //     `_histBase!==s` compare saw the ms-timestamp delta and captured on every such save).
    await page.evaluate(() => Store.save());

    const after = await counts(page);
    expect(after.u, "no-op Store.save spends no undo slot (updatedAt-only delta ignored)").toBe(before.u);
    expect(after.r, "no-op Store.save must NOT clear the redo stack").toBe(before.r);
    expect(await modName(page), "doc content unchanged by the no-op save").toBe("X");
  });

  test("(f) simulated remote adoption clears both stacks (R-E2a)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await expectFreshHistory(page);
    await edit(page, "A");
    await edit(page, "B");
    expect((await counts(page)).u).toBe(2);

    await page.evaluate(() => {
      const doc = JSON.parse(JSON.stringify(DB));
      doc.projects[0].modules[0].name = "REMOTE";
      adoptRemote(doc, 999999);
    });

    const c = await counts(page);
    expect(c.u, "adoption wipes undo — undoing across another device's write would clobber it via LWW").toBe(0);
    expect(c.r).toBe(0);
    await expect(undoBtn(page)).toBeDisabled();
    await expect(redoBtn(page)).toBeDisabled();
    expect(await modName(page)).toBe("REMOTE");
  });

  test("(g) keyboard shortcut suppressed while typing in a grid cell (native undo wins)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await edit(page, "A");
    await edit(page, "B");
    const before = await counts(page);

    // focus a contenteditable grid cell, then press ⌘/Ctrl+Z — editingNow() must suppress the app handler
    await page.evaluate(() => { document.querySelector('#leftBody .featRow .cell.feat .txt').focus(); });
    await page.keyboard.press(`${MOD}+z`);

    const after = await counts(page);
    expect(after.u, "app undo stack untouched while a cell is focused").toBe(before.u);
    expect(after.r, "no app redo entry created").toBe(0);
    expect(await modName(page), "the app did not undo the doc").toBe("B");
  });

  test("(h) undo of a project-delete restores the card on the dashboard", async ({ page }) => {
    await openDashboard(page, SEED_A());
    page.on("dialog", (d) => d.accept()); // the delete guard confirm()

    await page.locator('.card[data-open="test-proj"] [data-act="delproj"]').click();
    await expect(page.locator('.card[data-open="test-proj"]')).toHaveCount(0);
    expect((await counts(page)).u).toBe(1);

    await page.evaluate(() => undo());
    await expect(page.locator('.card[data-open="test-proj"]')).toHaveCount(1);
    expect(await modName(page)).toBe("Alpha"); // pre-delete doc fully restored
  });

  test("(i) undo after a bar drag restores the doc dates AND the left-pane inputs (R-E2b)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const orig = docFindNode(await readDoc(page), "fa1"); // 2026-07-01 → 2026-07-15

    // prime a known zoom + scroll the bar into the right-pane viewport, then drag its body right
    await page.evaluate(() => { ui.ppd = 8; ui.cal = "CE"; renderTimeline(); });
    await page.evaluate(() => {
      const bar = document.querySelector('#rowsLayer .bar[data-nid="fa1"]');
      const R = el("rightScroll");
      R.scrollLeft = Math.max(0, (parseFloat(bar.style.left) || 0) - 120);
      R.dispatchEvent(new Event("scroll"));
    });
    const box = await page.locator('#rowsLayer .bar[data-nid="fa1"]').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 64, cy, { steps: 10 }); // ~+8 days at ppd=8
    await page.mouse.up();

    const moved = docFindNode(await readDoc(page), "fa1");
    expect(moved.start, "the drag committed a new start").not.toBe(orig.start);
    const inpMoved = await page.inputValue('#leftBody input[data-nid="fa1"][data-field="start"]');
    expect(inpMoved, "left-pane start input mirrors the moved date").toBe(moved.start);

    await page.evaluate(() => undo());

    const back = docFindNode(await readDoc(page), "fa1");
    expect(back.start, "doc start restored").toBe(orig.start);
    expect(back.end, "doc end restored").toBe(orig.end);
    const inpBack = await page.inputValue('#leftBody input[data-nid="fa1"][data-field="start"]');
    expect(inpBack, "R-E2b re-rendered the timeline → left-pane input restored too").toBe(orig.start);
  });

  test("(j) a cross-tab `storage` write clears both stacks (R-E2a via Store.load, not just adoptRemote)", async ({ page }) => {
    // R-E2a is implemented on the cloud channel (adoptRemote, test f). The SAME hazard exists for the
    // same-browser multi-tab channel: the `storage` listener adopts a sibling tab's write via Store.load.
    // If Store.load rebased _histBase but kept the stale stacks, an undo here would restore a pre-sync
    // snapshot and clobber the sibling's committed edit via LWW. Store.load must clear the stacks too.
    await openTimeline(page, SEED_A());
    await expectFreshHistory(page);
    await edit(page, "A");
    await edit(page, "B");
    expect((await counts(page)).u, "two local edits on the stack before the sibling write").toBe(2);

    // Simulate a sibling same-browser tab committing a newer doc, then the `storage` event our tab gets.
    // (An in-page localStorage.setItem does NOT self-fire `storage`, so dispatch it explicitly.)
    await page.evaluate(() => {
      const doc = JSON.parse(JSON.stringify(DB));
      doc.projects[0].modules[0].name = "SIBLING";
      const s = JSON.stringify(doc);
      localStorage.setItem(LS_KEY, s);
      window.dispatchEvent(new StorageEvent("storage", { key: LS_KEY, newValue: s }));
    });

    const c = await counts(page);
    expect(c.u, "adopting a sibling tab's write clears undo — an undo would LWW-clobber their edit").toBe(0);
    expect(c.r).toBe(0);
    await expect(undoBtn(page)).toBeDisabled();
    await expect(redoBtn(page)).toBeDisabled();
    expect(await modName(page), "the sibling's doc is now the live local doc").toBe("SIBLING");

    // an undo attempt is inert — there is no stale snapshot left to overwrite the sibling's write with
    await page.evaluate(() => undo());
    expect(await modName(page), "no stale snapshot survived the cross-tab adopt").toBe("SIBLING");
  });
});
