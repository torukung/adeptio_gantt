// @ts-check
/* v1.0.3 — SLIDING (sticky-within-bar) GANTT LABELS + hover-bubble fallback.
 *
 * A wide bar shows its .blabel at the bar's start. When the chart scrolls horizontally
 * and the bar's START scrolls off the LEFT edge of #rightScroll while the bar is still
 * partly visible, updateStickyLabels() translateX-es the label RIGHT so it stays pinned
 * just inside the viewport-left edge (still readable). Once the label would leave the
 * bar's RIGHT edge the shift CLAMPS — past that the label clips and the hover floatTip
 * takes over (same fallback that small bars already use). renderTimeline() applies the
 * shift for the current scroll; the rAF-throttled R.onscroll hook keeps it live.
 *
 * Reuses ./fixtures (production-Worker block + pageerror/console guard are auto). The
 * seed uses week zoom (11px/day). A far-right "Spacer" feature extends the range so the
 * wide bar's END can be scrolled to the viewport-left edge (needed for the clamp case). */
const { test, expect, openTimeline, mkDoc, mkMod, mkFeat, assertAligned } = require("./fixtures");

// feature order = children order: f-slide = wide slider, f-tiny = tiny (truncating) bar, f-spacer = spacer.
function SEED_SLIDE() {
  return mkDoc([
    mkMod("m-wide", "Wide Module", {
      color: 0,
      features: [
        mkFeat("f-slide", "Slide Label", "2026-02-10", "2026-03-10"),        // ~317px bar, ~label fits → slides
        mkFeat("f-tiny", "Small Bar Overflow Name", "2026-01-15", "2026-01-15"), // 1-day bar → label truncates
        mkFeat("f-spacer", "Spacer", "2026-11-01", "2026-12-20"),            // far right → extends the range
      ],
    }),
  ]);
}

// v1.0.4: bars are addressed by data-nid (feature node id). SEED_SLIDE feature ids: f-slide, f-tiny.
const WIDE = '.bar[data-nid="f-slide"]';
const TINY = '.bar[data-nid="f-tiny"]';

// Set #rightScroll.scrollLeft, fire the real onscroll hook, and let the rAF-throttled
// updateStickyLabels() settle (double-rAF). Returns the scrollLeft the browser accepted.
async function scrollChart(page, left) {
  return page.evaluate(async (x) => {
    const R = document.getElementById("rightScroll");
    R.scrollLeft = x;
    R.dispatchEvent(new Event("scroll")); // exercise the R.onscroll → scheduleStickyLabels path
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return R.scrollLeft;
  }, left);
}

// Geometry of the wide bar + viewport, read straight from the DOM.
async function wideGeom(page) {
  return page.evaluate((sel) => {
    const R = document.getElementById("rightScroll");
    const bar = document.querySelector(sel);
    const lbl = bar.querySelector(".blabel");
    return {
      barLeft: parseFloat(bar.style.left) || 0,
      barW: parseFloat(bar.style.width) || bar.offsetWidth,
      labelW: lbl.scrollWidth,
      maxScroll: R.scrollWidth - R.clientWidth,
      clientWidth: R.clientWidth,
    };
  }, WIDE);
}

test.describe("sliding sticky Gantt labels", () => {
  test("wide bar: start scrolled off-left → label slides to stay just inside the viewport", async ({ page }) => {
    await openTimeline(page, SEED_SLIDE());
    const g = await wideGeom(page);
    // Precondition: chart is horizontally scrollable and the label fits inside the bar
    // (so the slide — not truncation — is what keeps it readable).
    expect(g.maxScroll, "chart must be horizontally scrollable").toBeGreaterThan(g.barLeft + 200);
    expect(g.barW, "wide bar must be wider than its label").toBeGreaterThan(g.labelW + 40);

    // Scroll the bar's START 120px off the left edge (bar still mostly visible).
    const applied = await scrollChart(page, g.barLeft + 120);
    expect(applied).toBeGreaterThan(g.barLeft); // bar start really is off-left now

    const r = await page.evaluate((sel) => {
      const R = document.getElementById("rightScroll");
      const lbl = document.querySelector(sel).querySelector(".blabel");
      const lr = lbl.getBoundingClientRect(), rr = R.getBoundingClientRect();
      return { transform: lbl.style.transform, lblLeft: lr.left, vpLeft: rr.left };
    }, WIDE);

    // (a) a POSITIVE translateX is applied…
    const m = /translateX\(([\d.]+)px\)/.exec(r.transform);
    expect(m, `expected a positive translateX, got "${r.transform}"`).not.toBeNull();
    expect(parseFloat(m[1])).toBeGreaterThan(0);
    // (b) …and it keeps the label's left edge inside (≥) the chart viewport's left edge.
    expect(r.lblLeft).toBeGreaterThanOrEqual(r.vpLeft - 2);
  });

  test("scroll back to 0 → the slide transform is cleared (label sits at the bar start)", async ({ page }) => {
    await openTimeline(page, SEED_SLIDE());
    const g = await wideGeom(page);

    await scrollChart(page, g.barLeft + 120); // slide it…
    const shifted = await page.evaluate((sel) => document.querySelector(sel).querySelector(".blabel").style.transform, WIDE);
    expect(/translateX\([\d.]+px\)/.test(shifted), "precondition: label is shifted while scrolled").toBe(true);

    await scrollChart(page, 0); // …then scroll the bar's start fully back into view.
    const cleared = await page.evaluate((sel) => document.querySelector(sel).querySelector(".blabel").style.transform, WIDE);
    expect(cleared, "transform must reset to '' when the bar start is back in view").toBe("");
  });

  test("scrolled past the clamp → label clips and the hover bubble shows the full name", async ({ page }) => {
    await openTimeline(page, SEED_SLIDE());
    const g = await wideGeom(page);

    // Scroll so only ~30px of the bar's right end sits at the viewport-left edge — the
    // label (wider than that sliver) can no longer fit, so the shift clamps and clips.
    const want = g.barLeft + g.barW - 30;
    expect(want, "seed must let us scroll the bar's end to the viewport-left").toBeLessThanOrEqual(g.maxScroll);
    await scrollChart(page, want);

    const st = await page.evaluate((sel) => {
      const R = document.getElementById("rightScroll");
      const bar = document.querySelector(sel);
      const lbl = bar.querySelector(".blabel");
      const barLeft = parseFloat(bar.style.left) || 0, barW = parseFloat(bar.style.width) || 0;
      return {
        transform: lbl.style.transform,
        sliver: barLeft + barW - R.scrollLeft,          // visible width of the bar at the viewport-left
        labelW: lbl.scrollWidth,
        needsTip: window["labelNeedsTip"](lbl),         // fallback should now be engaged
      };
    }, WIDE);

    expect(st.sliver, "bar's visible sliver must be narrower than the label (so it clips)").toBeLessThan(st.labelW);
    expect(/translateX\([\d.]+px\)/.test(st.transform), "shift is clamped (a positive translateX)").toBe(true);
    expect(st.needsTip, "labelNeedsTip must be true once the label is clipped").toBe(true);

    // Hover the bar's visible sliver (WITHOUT auto-scrolling it back into view) → floatTip.
    const pt = await page.evaluate((sel) => {
      const R = document.getElementById("rightScroll");
      const rect = document.querySelector(sel).getBoundingClientRect();
      return { x: R.getBoundingClientRect().left + 5, y: rect.top + rect.height / 2 };
    }, WIDE);
    await page.mouse.move(pt.x, pt.y);

    const tip = page.locator(".floatTip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Slide Label");
  });

  test("small bar (narrower than its label) still shows the hover bubble", async ({ page }) => {
    await openTimeline(page, SEED_SLIDE());
    await scrollChart(page, 0); // openTimeline auto-centers on "today"; bring the early tiny bar into view

    // The 1-day bar is far narrower than its name → the label is ellipsis-truncated
    // regardless of scroll, and hovering it shows the full name in the floatTip.
    const truncated = await page.evaluate((sel) => {
      const lbl = document.querySelector(sel).querySelector(".blabel");
      return { clipped: (lbl.scrollWidth - lbl.clientWidth) > 1, needsTip: window["labelNeedsTip"](lbl) };
    }, TINY);
    expect(truncated.clipped, "the tiny bar's label must be truncated").toBe(true);
    expect(truncated.needsTip, "labelNeedsTip true for the small bar (unchanged behavior)").toBe(true);

    const pt = await page.evaluate((sel) => {
      const rect = document.querySelector(sel).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, TINY);
    await page.mouse.move(pt.x, pt.y);

    const tip = page.locator(".floatTip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Small Bar Overflow Name");
  });

  test("left/right pane vertical alignment still holds after a horizontal scroll", async ({ page }) => {
    await openTimeline(page, SEED_SLIDE());
    const g = await wideGeom(page);

    const applied = await scrollChart(page, g.barLeft + 120);
    expect(applied).toBeGreaterThan(0); // the chart really scrolled horizontally

    // The left pane must NOT have scrolled horizontally with the chart, and the per-row
    // height alignment invariant between #leftBody and #rowsLayer must still hold.
    const leftScrollLeft = await page.evaluate(() => document.getElementById("leftScroll").scrollLeft);
    expect(leftScrollLeft, "left pane must not scroll horizontally with the chart").toBe(0);
    await assertAligned(page, "after horizontal scroll");
  });
});
