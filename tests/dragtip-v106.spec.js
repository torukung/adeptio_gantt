// @ts-check
/* E1 — live date readout while moving / edge-resizing a Gantt bar (SPEC_v1.0.6 §2 + R-E1a..d).
 *
 * The readout rides the shared floatTip singleton with a distinct `.dragDates` accent (R-E1b),
 * renders inside the existing onBarMove frame (R-E1c), suppresses the hover tip while a drag is
 * live (R-E1a), and clears on pointerup AND on a cancelled drag (R-E1d). Content is built from
 * the app's own `fmtThai(parse(iso))`, so these assertions are calendar-agnostic (BE + CE) and
 * pin "tip == committed doc" exactly.
 *
 * Host-block + zero-prod-request + pageerror/console guards are auto from ./fixtures. */
const { test, expect, openTimeline, SEED_A, readDoc, docFindNode } = require("./fixtures");

const FID = "fa1"; // Alpha One — first feature bar in SEED_A (2026-07-01 → 2026-07-15)

// Zoom to a known width, pick a calendar, and scroll the bar into the right-pane viewport so its
// on-screen box (and its handles') is real. ppd=8 keeps the whole bar + both 9px handles in view.
async function primeBar(page, { nid = FID, ppd = 8, cal = "CE" } = {}) {
  await page.evaluate(({ p, c }) => { ui.ppd = p; ui.cal = c; window.renderTimeline(); }, { p: ppd, c: cal });
  await page.evaluate((id) => {
    const bar = document.querySelector(`#rowsLayer .bar[data-nid="${id}"]`);
    const R = document.getElementById("rightScroll");
    R.scrollLeft = Math.max(0, (parseFloat(bar.style.left) || 0) - 120);
    R.dispatchEvent(new Event("scroll"));
  }, nid);
  const box = await page.locator(`#rowsLayer .bar[data-nid="${nid}"]`).boundingBox();
  expect(box, "primed bar must have an on-screen box").not.toBeNull();
  return box;
}

const tipLoc = (page) => page.locator(".floatTip");
async function tipState(page) {
  return page.evaluate(() => {
    const t = document.querySelector(".floatTip");
    if (!t) return { present: false, visible: false, drag: false, text: "", dim: null };
    const dim = t.querySelector(".dim");
    return {
      present: true,
      visible: getComputedStyle(t).display !== "none",
      drag: t.classList.contains("dragDates"),
      text: t.textContent,
      dim: dim ? dim.textContent : null,
    };
  });
}
// Format an ISO date + inclusive duration through the app's own chart-date helpers.
const thai = (page, iso) => page.evaluate((s) => window.fmtThai(window.parse(s)), iso);
const inclDays = (page, s, e) => page.evaluate(({ s, e }) => window.daysBetween(s, e) + 1, { s, e });
async function committed(page) {
  const n = docFindNode(await readDoc(page), FID);
  return { start: n.start, end: n.end, a: await thai(page, n.start), b: await thai(page, n.end), dur: await inclDays(page, n.start, n.end) };
}

test.describe("E1 — live drag date readout", () => {
  test("move-drag: one line with both dates + duration, matches the committed doc, clears on pointerup (BE)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const box = await primeBar(page, { cal: "BE" }); // BE path → Thai months + BE year via fmtThai
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy, { steps: 8 }); // ~+8 days at ppd=8

    const live = await tipState(page);
    expect(live.visible, "readout appears on the move frame").toBe(true);
    expect(live.drag, "readout carries the .dragDates accent (R-E1b)").toBe(true);
    expect(live.dim, "move mode is single-line — no .dim block").toBeNull();

    await page.mouse.up();
    const c = await committed(page);
    expect(c.start, "start actually moved right").not.toBe("2026-07-01");
    expect(live.text, "tip == committed dates + inclusive duration").toBe(`${c.a} → ${c.b} · ${c.dur} วัน`);
    expect(live.text, "BE month flowed through fmtThai").toContain("ก.ค.");
    await expect(tipLoc(page), "no tip after pointerup").toBeHidden();
  });

  test("left-handle resize: เริ่ม line over a dim end·duration, matches the commit (CE)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await primeBar(page);
    const hb = await page.locator(`#rowsLayer .bar[data-nid="${FID}"] .handle.l`).boundingBox();
    expect(hb, "left handle box").not.toBeNull();

    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 32, hb.y + hb.height / 2, { steps: 6 }); // start moves right, stays < end

    const live = await tipState(page);
    expect(live.visible && live.drag, "left-resize readout live").toBe(true);
    await page.mouse.up();

    const c = await committed(page);
    expect(live.text.startsWith(`เริ่ม ${c.a}`), `first line names the moving start edge; got "${live.text}"`).toBe(true);
    expect(live.dim, "dim line = → end · duration").toBe(`→ ${c.b} · ${c.dur} วัน`);
    expect(c.end, "a left-handle drag never touches the end").toBe("2026-07-15");
    expect(c.start, "start actually moved").not.toBe("2026-07-01");
  });

  test("right-handle resize: สิ้นสุด line over a dim start·duration, matches the commit (CE)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await primeBar(page);
    const hb = await page.locator(`#rowsLayer .bar[data-nid="${FID}"] .handle.r`).boundingBox();
    expect(hb, "right handle box").not.toBeNull();

    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2, { steps: 6 }); // end moves right

    const live = await tipState(page);
    expect(live.visible && live.drag, "right-resize readout live").toBe(true);
    await page.mouse.up();

    const c = await committed(page);
    expect(live.text.startsWith(`สิ้นสุด ${c.b}`), `first line names the moving end edge; got "${live.text}"`).toBe(true);
    expect(live.dim, "dim line = start → · duration").toBe(`${c.a} → · ${c.dur} วัน`);
    expect(c.start, "a right-handle drag never touches the start").toBe("2026-07-01");
    expect(c.end, "end actually moved").not.toBe("2026-07-15");
  });

  test("R-E1a: the hover tip is suppressed while a bar drag is live", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const box = await primeBar(page);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 44, cy, { steps: 6 });
    expect((await tipState(page)).drag, "drag readout is up").toBe(true);

    // Fire a board mousemove WITHOUT a following pointermove. onBoardMove must early-return
    // (if (drag) return) and leave the readout intact — otherwise it would hideTip() this
    // short, non-truncated label and there is no onBarMove frame to restore it.
    await page.evaluate((id) => {
      const bar = document.querySelector(`#rowsLayer .bar[data-nid="${id}"]`);
      const r = bar.getBoundingClientRect();
      bar.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 6, clientY: r.top + r.height / 2 }));
    }, FID);

    const after = await tipState(page);
    expect(after.visible && after.drag, "drag readout survived the hover mousemove (R-E1a)").toBe(true);
    await page.mouse.up();
  });

  test("R-E1d: a synthesized pointercancel mid-drag leaves no orphan tip", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const box = await primeBar(page);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 50, cy, { steps: 6 });
    expect((await tipState(page)).visible, "readout up before cancel").toBe(true);

    // Cancel on document (where the capture-phase guard lives) — the FIX7 convention.
    await page.evaluate(() => document.dispatchEvent(new Event("pointercancel")));
    await expect(tipLoc(page), "cancel drops the readout (R-E1d)").toBeHidden();

    // The cancel ALONE (no trailing pointerup — a genuine pointercancel is never followed by one)
    // must FULLY tear the bar drag down. If `drag` survives, the R-E1a `if(drag) return` guards in
    // onBoardOver/onBoardMove silently kill EVERY hover tooltip until the next complete bar drag,
    // the bar stays stuck in `.dragging`, and body text-selection stays disabled. Assert the whole
    // teardown HERE, before the release, so a regression can't hide behind the pointerup below.
    const afterCancel = await page.evaluate((id) => ({
      drag: drag, // module-level bar-drag state (read bare, like `ui` above); null ⇒ hover guards released
      stuck: !!document.querySelector(`#rowsLayer .bar[data-nid="${id}"].dragging`),
      userSelect: document.body.style.userSelect,
    }), FID);
    expect(afterCancel.drag, "cancel nulls the bar-drag state (no orphan drag → hover tips live again)").toBeNull();
    expect(afterCancel.stuck, "cancel sheds the .dragging class (bar not left visually stuck)").toBe(false);
    expect(afterCancel.userSelect, "cancel restores body text-selection").toBe("");

    await page.mouse.up(); // release the real pointer; teardown must not throw (auto pageerror guard)
    await expect(tipLoc(page), "still no tip after the release").toBeHidden();

    // Second symptom the finding flags: a cancelled drag must ABORT (snap back), never COMMIT its
    // last dragged position. The cancel nulls drag._s, so the trailing pointerup can't commit — the
    // committed doc dates stay exactly as seeded (SEED_A fa1 = 2026-07-01 → 2026-07-15).
    const n = docFindNode(await readDoc(page), FID);
    expect(n.start, "cancelled drag committed no new start (snap-back, not commit)").toBe("2026-07-01");
    expect(n.end, "cancelled drag committed no new end (snap-back, not commit)").toBe("2026-07-15");
  });

  test("a plain pointerdown with no movement never flashes the readout", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const box = await primeBar(page);
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

    await page.mouse.move(cx, cy); // hover settles; short label needs no hover tip
    await expect(tipLoc(page)).toBeHidden();
    await page.mouse.down(); // press, do NOT move
    await expect(tipLoc(page), "no readout on a click without a move frame").toBeHidden();
    await page.mouse.up();
    await expect(tipLoc(page)).toBeHidden();
  });
});
