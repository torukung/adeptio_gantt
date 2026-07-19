// @ts-check
/* v1.0.4 Stage-3 "timeline" — continuous px-per-day zoom (PPD ∈ [0.9,34]) replacing the fixed
 * day/week/month presets, the −/readout/+/fit zoom controls, the §1.9 bar-label font curve + hide +
 * hover-bubble, right-pane stepped shading (frame-sync made visible), container span bars at depth,
 * and the R10 sticky-label ordering under zoom×wrap.
 *
 * Reuses ./fixtures so the production-Worker block + pageerror/console guards are unconditional. The
 * app pushes the whole doc to prod D1 on every save — fixtures aborts that host before page scripts run.
 */
const { test, expect, openTimeline, assertAligned } = require("./fixtures");

const LS_UI = "adeptio_ptrack_ui";

// A 3-deep tree (Root ▸ Sub One ▸ Deep) with a feature at every level, plus a far feature that widens
// the range. Root Feat carries a long description so the wrap-mode alignment checks actually change heights.
function DEEP_DOC() {
  return {
    projects: [{
      id: "test-proj", name: "Deep", client: "QA", code: "TP", color: 0,
      createdAt: "2026-01-01", updatedAt: "2026-01-01", customCols: [],
      colOrder: ["name", "description", "start", "end", "status", "remark"], progressOrder: [],
      summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
      docVer: 2,
      modules: [{
        id: "c-root", kind: "container", name: "Root", description: "", color: 0, collapsed: false, children: [
          { id: "root-feat", kind: "feature", fid: "", name: "Root Feat",
            description: "a deliberately long description that wraps across several lines when word wrap is on ".repeat(3),
            start: "2026-02-01", end: "2026-03-15", status: "in_progress", remark: "", custom: {} },
          { id: "c-sub1", kind: "container", name: "Sub One", description: "", color: 6, collapsed: false, children: [
            { id: "sub-feat", kind: "feature", fid: "", name: "Sub Feat", description: "", start: "2026-04-01", end: "2026-05-30", status: "not_started", remark: "", custom: {} },
            { id: "c-deep", kind: "container", name: "Deep", description: "", color: 7, collapsed: false, children: [
              { id: "deep-feat", kind: "feature", fid: "", name: "Deep Feat", description: "", start: "2026-06-01", end: "2026-07-30", status: "done", remark: "", custom: {} },
            ] },
          ] },
          { id: "root-feat2", kind: "feature", fid: "", name: "Root Feat Two", description: "", start: "2026-08-01", end: "2026-08-05", status: "not_started", remark: "", custom: {} },
        ],
      }],
    }],
  };
}

async function readUi(page) {
  return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } }, LS_UI);
}
// --shade is a raw custom-property token stream (NOT normalised by getComputedStyle) → resolve it through
// a probe element's background-color, which IS normalised, then compare. (Same trick as tree-ui's shadeRGB.)
async function shadeRGB(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return null;
    const raw = getComputedStyle(el).getPropertyValue("--shade").trim();
    const probe = document.createElement("span"); probe.style.backgroundColor = raw || "transparent"; document.body.appendChild(probe);
    const norm = getComputedStyle(probe).backgroundColor; probe.remove(); return norm;
  }, sel);
}
async function setPpdRender(page, ppd) { // set ui.ppd + re-render (no scroll re-centre) for clean measurement
  await page.evaluate((p) => { ui.ppd = p; window.renderTimeline(); }, ppd);
}
const clampPpd = (v) => Math.max(0.9, Math.min(34, v));
const curvePx = (ppd) => Math.max(6.4, Math.min(11.5, 6.2 + ppd * 0.55));

/* ============================ CONTINUOUS ZOOM — sweep table ============================ */
test.describe("§1.8/§1.9 continuous zoom — PPD sweep", () => {
  test("months-in-view, label font curve, and hide threshold across PPD ∈ {0.9,2,4.4,8,11,20,34}", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const SWEEP = [0.9, 2, 4.4, 8, 11, 20, 34];
    const table = [];
    for (const ppd of SWEEP) {
      const env = await page.evaluate((p) => { ui.ppd = p; window.renderTimeline(); return { months: window.monthsInView(), cw: document.getElementById("rightScroll").clientWidth }; }, ppd);
      const dom = await page.evaluate((nid) => {
        const bar = document.querySelector(`#rowsLayer .bar[data-nid="${nid}"]`);
        const lbl = bar.querySelector(".blabel");
        return { fs: parseFloat(getComputedStyle(lbl).fontSize), hidden: lbl.style.display === "none", barW: (parseFloat(bar.style.width) || 0) + 2 };
      }, "root-feat");
      const expFs = curvePx(ppd);
      const expHidden = expFs < 7.5 || dom.barW < 34;
      const expMonths = env.cw / (ppd * 30.4);
      expect(Math.abs(dom.fs - expFs), `font-size@ppd=${ppd} dom ${dom.fs} vs curve ${expFs}`).toBeLessThan(0.06);
      expect(dom.hidden, `hidden@ppd=${ppd} (fs ${dom.fs} barW ${dom.barW})`).toBe(expHidden);
      expect(Math.abs(env.months - expMonths), `monthsInView@ppd=${ppd}`).toBeLessThan(0.05);
      table.push({ ppd, monthsInView: +env.months.toFixed(2), labelPx: +dom.fs.toFixed(2), labelVisible: !dom.hidden });
    }
    // curve shape: hidden at the two smallest PPDs (font < 7.5), visible from 4.4 up (bar always ≥34px here)
    expect(table.map((r) => r.labelVisible)).toEqual([false, false, true, true, true, true, true]);
    // clamp ceiling: PPD ≥ ~9.64 pins the label at 11.5px
    expect(table.find((r) => r.ppd === 11).labelPx).toBeCloseTo(11.5, 1);
    expect(table.find((r) => r.ppd === 8).labelPx).toBeCloseTo(10.6, 1);
  });

  test("spec anchors: §1.9 curve + hide rule hold at ≈9 / ≈6.7 / ≈11 months in view (viewport-independent formula, no absolute-px knife-edge)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const cw = await page.evaluate(() => document.getElementById("rightScroll").clientWidth);
    for (const months of [9, 6.7, 11]) {
      const ppd = clampPpd(cw / (months * 30.4));
      await setPpdRender(page, ppd);
      const dom = await page.evaluate((nid) => {
        const bar = document.querySelector(`#rowsLayer .bar[data-nid="${nid}"]`), l = bar.querySelector(".blabel");
        return { fs: parseFloat(getComputedStyle(l).fontSize), hidden: l.style.display === "none", barW: (parseFloat(bar.style.width) || 0) + 2 };
      }, "root-feat");
      // (1) the rendered font-size IS the §1.9 curve for this PPD — 6.2 + ppd×0.55, clamped to [6.4,11.5]
      //     (curvePx). Viewport-width-independent: catches a broken slope/intercept/clamp.
      expect(Math.abs(dom.fs - curvePx(ppd)), `curve@${months}mo (ppd ${ppd.toFixed(3)})`).toBeLessThan(0.05);
      // (2) the hide decision is EXACTLY the rule recomputed from the DOM's OWN font-size + bar width —
      //     hidden ⇔ (font < 7.5 || barW < 34). No harness-dependent ~7.52px absolute-px assertion
      //     (the old anchors[0]===false / anchors[2]===true flaked with the live viewport width).
      expect(dom.hidden, `hide rule@${months}mo (fs ${dom.fs}, barW ${dom.barW.toFixed(1)})`).toBe(dom.fs < 7.5 || dom.barW < 34);
    }
  });
});

/* ============================ ZOOM CONTROLS (−/readout/+/fit + presets) ============================ */
test.describe("§1.8 zoom controls", () => {
  test("+ then − returns to the starting PPD (×1.35 then ÷1.35 within clamp)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    await page.evaluate(() => window.applyZoom(8));
    const p0 = await page.evaluate(() => pxPerDay());
    await page.evaluate(() => window.applyZoom(pxPerDay() * 1.35));
    await page.evaluate(() => window.applyZoom(pxPerDay() / 1.35));
    const p1 = await page.evaluate(() => pxPerDay());
    expect(Math.abs(p1 - p0)).toBeLessThan(0.01);
    expect(p0).toBeCloseTo(8, 5);
  });

  test("reset (พอดี) fits ≈9 months ±0.2", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    await page.evaluate(() => window.applyZoom(30)); // start far from fit
    await page.evaluate(() => document.getElementById("zoomFit").click());
    const m = await page.evaluate(() => window.monthsInView());
    expect(Math.abs(m - 9)).toBeLessThanOrEqual(0.2);
  });

  test("+ preserves the date under the viewport centre (±1 day)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    await page.evaluate(() => window.applyZoom(8));
    await page.evaluate(() => { const R = document.getElementById("rightScroll"); R.scrollLeft = 400; });
    const before = await page.evaluate(() => { const R = document.getElementById("rightScroll"); return (R.scrollLeft + R.clientWidth / 2) / pxPerDay(); });
    await page.evaluate(() => document.getElementById("zoomIn").click()); // × 1.35, centred
    const after = await page.evaluate(() => { const R = document.getElementById("rightScroll"); return (R.scrollLeft + R.clientWidth / 2) / pxPerDay(); });
    expect(Math.abs(after - before), "centre day preserved").toBeLessThanOrEqual(1);
    // and the PPD actually changed
    expect(await page.evaluate(() => pxPerDay())).toBeCloseTo(10.8, 3);
  });

  test("presets set their exact PPD, toggle the active state, and update the readout", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    for (const [name, ppd] of [["day", 34], ["week", 11], ["month", 4.4]]) {
      await page.evaluate((n) => document.querySelector(`[data-zoom="${n}"]`).click(), name);
      expect(await page.evaluate(() => pxPerDay()), `${name} → ${ppd}`).toBeCloseTo(ppd, 5);
      expect(await page.evaluate((n) => document.querySelector(`[data-zoom="${n}"]`).classList.contains("on"), name), `${name} active`).toBe(true);
      // exactly one preset is active at a time
      expect(await page.evaluate(() => document.querySelectorAll("[data-zoom].on").length)).toBe(1);
      const ro = (await page.textContent("#zoomReadout")) || "";
      expect(ro, "readout is Thai months-in-view").toMatch(/^\d+\.\d+ เดือน$/);
    }
    // a non-preset PPD leaves NO preset active
    await page.evaluate(() => window.applyZoom(7.3));
    expect(await page.evaluate(() => document.querySelectorAll("[data-zoom].on").length)).toBe(0);
  });
});

/* ============================ ZOOM CONTROLS — REAL Playwright click path (H4b) ============================ */
// The evaluate-based tests above fire el.click() directly, which bypasses pointer/visibility actionability.
// These drive the SAME buttons through page.locator(...).click() (real pointerdown→pointerup→click).
test.describe("§1.8 zoom controls — real click path (H4b)", () => {
  test("real-click #zoomOut then #zoomIn returns to the starting PPD (±1e-9)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    await page.evaluate(() => window.applyZoom(8));          // baseline PPD
    const p0 = await page.evaluate(() => pxPerDay());
    await page.locator("#zoomOut").click();                 // ÷1.35, real pointer sequence
    await page.locator("#zoomIn").click();                  // ×1.35
    const p1 = await page.evaluate(() => pxPerDay());
    expect(Math.abs(p1 - p0), `round-trip ${p1} vs ${p0}`).toBeLessThan(1e-9);
    expect(p0).toBeCloseTo(8, 9);
  });

  test("real-click #zoomFit fits ≈9 months (±0.2)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    await page.evaluate(() => window.applyZoom(30));         // start far from fit
    await page.locator("#zoomFit").click();
    const m = await page.evaluate(() => window.monthsInView());
    expect(Math.abs(m - 9), `months-in-view ${m}`).toBeLessThanOrEqual(0.2);
  });

  test("real-click a preset sets its exact PPD + .on state (day/week/month)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    for (const [name, ppd] of [["day", 34], ["week", 11], ["month", 4.4]]) {
      await page.locator(`[data-zoom="${name}"]`).click();
      expect(await page.evaluate(() => pxPerDay()), `${name} → ${ppd}`).toBeCloseTo(ppd, 5);
      expect(await page.locator(`[data-zoom="${name}"]`).evaluate((b) => b.classList.contains("on")), `${name} .on`).toBe(true);
      expect(await page.evaluate(() => document.querySelectorAll("[data-zoom].on").length), "exactly one preset active").toBe(1);
    }
  });
});

/* ============================ PERSISTENCE (R12) ============================ */
test.describe("R12 — PPD persistence + legacy zoom mapping", () => {
  test("changing PPD writes ui.ppd to LS_UI and it restores on reload", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    await page.evaluate(() => window.applyZoom(20));
    const ui1 = await readUi(page);
    expect(ui1.ppd).toBeCloseTo(20, 5);
    expect("zoom" in ui1, "no legacy zoom key is written").toBe(false);
    await page.reload(); // seed() is idempotent (writes only when empty) → LS survives
    await page.locator("#proj").waitFor({ state: "attached" });
    expect(await page.evaluate(() => pxPerDay()), "PPD restored from LS_UI").toBeCloseTo(20, 5);
  });

  test("a legacy {zoom:'week'} ui value maps to PPD 11 once, then drops the zoom key", async ({ page }) => {
    await page.addInitScript((k) => { try { localStorage.setItem(k, JSON.stringify({ zoom: "week", wrapTxt: false, colW: {} })); } catch (e) {} }, LS_UI);
    await openTimeline(page, DEEP_DOC());
    expect(await page.evaluate(() => pxPerDay()), "legacy week → 11").toBeCloseTo(11, 5);
    await page.evaluate(() => window.saveUi()); // any save rewrites LS_UI without the zoom key
    const ui = await readUi(page);
    expect("zoom" in ui, "legacy zoom key dropped on save").toBe(false);
    expect(ui.ppd).toBeCloseTo(11, 5);
  });
});

/* ============================ §1.9 LABEL HIDE + BUBBLE + STICKY INTERPLAY ============================ */
test.describe("§1.9 label hide → status dot + hover bubble; sticky slide skipped while hidden", () => {
  test("at a hide-zoom the label is display:none, the dot shows, and hovering shows the .floatTip", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    await page.evaluate(() => { const R = document.getElementById("rightScroll"); R.scrollLeft = 0; });
    await setPpdRender(page, 2); // font 7.3 < 7.5 → every label hides
    const st = await page.evaluate((nid) => {
      const bar = document.querySelector(`#rowsLayer .bar[data-nid="${nid}"]`);
      const lbl = bar.querySelector(".blabel"), dot = bar.querySelector(".sdot");
      return { hidden: lbl.style.display === "none", dotShown: !!dot && getComputedStyle(dot).display !== "none", needsTip: window.labelNeedsTip(lbl) };
    }, "root-feat");
    expect(st.hidden, "label hidden at ppd=2").toBe(true);
    expect(st.dotShown, "status dot still shown").toBe(true);
    expect(st.needsTip, "hidden label always qualifies for the bubble").toBe(true);

    // hover the (in-view) bar → floatTip shows the feature name
    const pt = await page.evaluate((nid) => { const bar = document.querySelector(`#rowsLayer .bar[data-nid="${nid}"]`); const r = bar.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, "root-feat");
    await page.mouse.move(pt.x, pt.y);
    const tip = page.locator(".floatTip");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText("Root Feat");

    // sticky slide must be skipped for a hidden label: no transform even after a horizontal scroll
    await page.evaluate(async () => { const R = document.getElementById("rightScroll"); R.scrollLeft = 200; R.dispatchEvent(new Event("scroll")); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    const tf = await page.evaluate((nid) => document.querySelector(`#rowsLayer .bar[data-nid="${nid}"] .blabel`).style.transform, "root-feat");
    expect(tf, "no sticky transform on a hidden label").toBe("");
  });
});

/* ============================ R10 — sticky label ⊆ bar∩viewport at 3 zooms × wrap on/off ============================ */
test.describe("R10 — label rect ⊆ (bar ∩ viewport) after a horizontal scroll (zoom × wrap matrix)", () => {
  for (const ppd of [8, 11, 20]) {
    for (const wrap of [false, true]) {
      test(`ppd=${ppd} wrap=${wrap}`, async ({ page }) => {
        await openTimeline(page, DEEP_DOC());
        await page.evaluate(({ p, w }) => { ui.ppd = p; ui.wrapTxt = w; window.renderBoard(); }, { p: ppd, w: wrap });
        // scroll so Root Feat's start goes ~100px off the left edge (bar still mostly visible → label slides)
        await page.evaluate(async () => {
          const bar = document.querySelector('#rowsLayer .bar[data-nid="root-feat"]');
          const R = document.getElementById("rightScroll");
          R.scrollLeft = (parseFloat(bar.style.left) || 0) + 100;
          R.dispatchEvent(new Event("scroll"));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        });
        const res = await page.evaluate(() => {
          const R = document.getElementById("rightScroll");
          const bar = document.querySelector('#rowsLayer .bar[data-nid="root-feat"]');
          const lbl = bar.querySelector(".blabel");
          if (lbl.style.display === "none") return { hidden: true };
          const lr = lbl.getBoundingClientRect(), br = bar.getBoundingClientRect(), rr = R.getBoundingClientRect();
          const clipL = Math.max(br.left, rr.left), clipR = Math.min(br.right, rr.right);
          return { hidden: false, ok: lr.left >= clipL - 1.5 && lr.right <= clipR + 1.5, shifted: lbl.style.transform };
        });
        expect(res.hidden, "wide bar label is visible at these zooms").toBe(false);
        expect(res.ok, "label rect ⊆ bar ∩ viewport (post-shift rects)").toBe(true);
        expect(/translateX\([\d.]+px\)/.test(res.shifted), "label actually slid in").toBe(true);
        await assertAligned(page, `R10 ppd=${ppd} wrap=${wrap}`);
      });
    }
  }
});

/* ============================ ALIGNMENT at 3 zoom levels × wrap on/off ============================ */
test.describe("alignment holds across zoom × wrap", () => {
  for (const ppd of [4.4, 11, 34]) {
    for (const wrap of [false, true]) {
      test(`assertAligned ppd=${ppd} wrap=${wrap}`, async ({ page }) => {
        await openTimeline(page, DEEP_DOC());
        await page.evaluate(({ p, w }) => { ui.ppd = p; ui.wrapTxt = w; window.renderBoard(); }, { p: ppd, w: wrap });
        await assertAligned(page, `zoom=${ppd} wrap=${wrap}`);
      });
    }
  }
});

/* ============================ §1.6 RIGHT-PANE STEPPED SHADING PARITY ============================ */
test.describe("§1.6 right-pane stepped shading — parity with the left pane at every depth", () => {
  test("computed --shade matches left↔right for EVERY row, keyed by data-nid + row-kind (not child index), ≥3-deep doc", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    // Key each LEFT row (modRow / featRow / addFeat) to its RIGHT twin by the SAME data-nid, disambiguated
    // by row-kind → modRow↔modBarRow, featRow↔barRow(with .bar), addFeat↔barRow spacer(no .bar). NB a
    // container id appears on BOTH its modRow and addFeat (and on both modBarRow and the spacer), so pure
    // data-nid is ambiguous — the kind + a "consume each right row once" set resolves it and makes any
    // extra/missing/duplicated row fail (not just a silent index shift).
    const res = await page.evaluate(() => {
      const norm = (raw) => { const p = document.createElement("span"); p.style.backgroundColor = raw || "transparent"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
      const shade = (el) => norm(getComputedStyle(el).getPropertyValue("--shade").trim());
      const L = [...document.querySelectorAll("#leftBody > *")];
      const R = [...document.querySelectorAll("#rowsLayer > *")];
      const kindOf = (el) => el.classList.contains("modRow") ? "mod" : el.classList.contains("featRow") ? "feat" : el.classList.contains("addFeat") ? "add" : "other";
      const used = new Set();
      const twin = (nid, kind) => {
        for (let j = 0; j < R.length; j++) {
          if (used.has(j)) continue;
          const r = R[j]; if (r.dataset.nid !== nid) continue;
          const hasBar = !!r.querySelector(".bar");
          if (kind === "mod" && r.classList.contains("modBarRow")) return j;
          if (kind === "feat" && r.classList.contains("barRow") && hasBar) return j;
          if (kind === "add" && r.classList.contains("barRow") && !hasBar) return j;
        }
        return -1;
      };
      let unmatched = 0; const rows = [];
      for (let i = 0; i < L.length; i++) {
        const el = L[i], kind = kindOf(el), nid = el.dataset.nid, j = twin(nid, kind);
        if (j < 0) { unmatched++; rows.push({ i, kind, nid, lc: el.className, matched: false }); continue; }
        used.add(j);
        rows.push({ i, kind, nid, lc: el.className, rc: R[j].className, matched: true, l: shade(el), r: shade(R[j]) });
      }
      return { ln: L.length, rn: R.length, usedCount: used.size, unmatched, rows };
    });
    expect(res.ln, "left/right row-count parity").toBe(res.rn);
    expect(res.unmatched, "every left row finds its data-nid twin on the right").toBe(0);
    expect(res.usedCount, "every right row is matched exactly once (extra/orphan right rows fail)").toBe(res.rn);
    for (const row of res.rows) {
      expect(row.matched, `left row ${row.i} [${row.lc}] (nid ${row.nid}, ${row.kind}) has no right twin`).toBe(true);
      expect(row.l, `row ${row.i} [${row.lc}] ↔ [${row.rc}] shade parity (nid ${row.nid})`).toBe(row.r);
    }
    // sanity: the nested depths actually carry the stepped values (not all-transparent by accident)
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="deep-feat"]')).toBe("rgba(146, 65, 255, 0.09)");
    expect(await shadeRGB(page, '#rowsLayer .barRow[data-nid="deep-feat"]')).toBe("rgba(146, 65, 255, 0.09)");
  });

  test("a nested chart row paints the shade as a real background-image, and a drag mark never wipes it", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const sel = '#rowsLayer .barRow[data-nid="deep-feat"]';
    const before = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundImage, sel);
    expect(before, "shade is a real gradient layer (paint-side, not probe-only)").toContain("gradient");
    // depth-3 value paints
    expect(await shadeRGB(page, sel)).toBe("rgba(146, 65, 255, 0.09)");
    // a drag mark lands on the .bar, not the row → the row's shade image must survive unchanged
    await page.evaluate(() => document.querySelector('#rowsLayer .bar[data-nid="deep-feat"]').classList.add("dragging"));
    const after = await page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundImage, sel);
    expect(after, "drag mark does not wipe the shade").toBe(before);
    // and an alt-striped nested row still carries the shade image alongside its stripe colour
    const altHasShade = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#rowsLayer .barRow.alt")];
      return rows.some((r) => /gradient/.test(getComputedStyle(r).backgroundImage));
    });
    expect(altHasShade, "alt row keeps the shade image").toBe(true);
  });
});

/* ============================ §5.3 CONTAINER SPAN BARS AT DEPTH ============================ */
test.describe("§5.3 container span bars render correctly at depth ≥2", () => {
  test("the depth-2 Deep container shows a capped span, and depth-1 Sub One spans all descendants", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const deep = await page.evaluate(() => {
      const row = document.querySelector('#rowsLayer .modBarRow[data-nid="c-deep"]');
      const mb = row.querySelector(".modBar");
      return { has: !!mb, caps: mb ? mb.querySelectorAll(".cap").length : 0, span: mb ? !!mb.querySelector(".span") : false, w: mb ? parseFloat(mb.style.width) : 0 };
    });
    expect(deep.has, "depth-2 container has a span bar").toBe(true);
    expect(deep.caps, "both end caps render").toBe(2);
    expect(deep.span).toBe(true);
    expect(deep.w).toBeGreaterThan(0);
    // Sub One (depth 1) span covers Sub Feat + Deep Feat → wider than Deep's span alone
    const w = await page.evaluate(() => ({
      sub: parseFloat(document.querySelector('#rowsLayer .modBarRow[data-nid="c-sub1"] .modBar').style.width),
      deep: parseFloat(document.querySelector('#rowsLayer .modBarRow[data-nid="c-deep"] .modBar').style.width),
    }));
    expect(w.sub, "container span derives from ALL descendants").toBeGreaterThan(w.deep);
    await assertAligned(page, "container spans at depth");
  });
});

/* ============================ §1.8 tickMode AXIS COVERAGE (H4c) ============================ */
// tickMode() = ppd>=18 ? "day" : (ppd>=6.2 ? "week" : "month"). Verify the ACTUAL rendered axis DOM at
// each mode + at both sides of the two knees (18/17.9, 6.2/6.1). Driven via window.applyZoom in evaluate.
test.describe("§1.8 tickMode axis coverage (H4c)", () => {
  const stats = (page, ppd) =>
    page.evaluate((p) => {
      window.applyZoom(p);
      const ticks = [...document.querySelectorAll("#axisTicks .tick")];
      return {
        mode: window.tickMode(),
        texts: ticks.map((t) => (t.textContent || "").trim()),
        anyWkendTick: !!document.querySelector("#axisTicks .tick.wkend"),
        wband: document.querySelectorAll("#gridLayer .wband").length,
        vlineMonth: document.querySelectorAll("#gridLayer .vline.month").length,
        vlinePlain: [...document.querySelectorAll("#gridLayer .vline")].filter((v) => !v.classList.contains("month")).length,
      };
    }, ppd);

  test("PPD 34 → day mode: per-day numbered ticks + weekend cells + weekend grid bands", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const s = await stats(page, 34);
    expect(s.mode).toBe("day");
    expect(s.texts.length, "one tick per day → many").toBeGreaterThan(60);
    expect(s.texts.every((t) => /^\d+$/.test(t)), "every day tick shows a day number").toBe(true);
    expect(s.anyWkendTick, "weekend tick cells present").toBe(true);
    expect(s.wband, "weekend shading bands present in the grid").toBeGreaterThan(0);
  });

  test("PPD 11 → week mode: 'd/m' ticks every 7 days, no weekend cells/bands", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const s = await stats(page, 11);
    expect(s.mode).toBe("week");
    const nonEmpty = s.texts.filter((t) => t.length);
    expect(nonEmpty.length, "week ticks present").toBeGreaterThan(0);
    expect(nonEmpty.every((t) => /^\d+\/\d+$/.test(t)), "every week tick is 'd/m'").toBe(true);
    expect(s.anyWkendTick, "no per-weekend tick cells in week mode").toBe(false);
    expect(s.wband, "no weekend bands in week mode").toBe(0);
    expect(s.vlinePlain, "weekly vlines present").toBeGreaterThan(0);
  });

  test("PPD 4.4 → month mode: empty ticks, only month vlines (no weekly vlines/bands)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const s = await stats(page, 4.4);
    expect(s.mode).toBe("month");
    expect(s.texts.every((t) => t === ""), "month-mode ticks carry no text").toBe(true);
    expect(s.vlineMonth, "month vlines present").toBeGreaterThan(0);
    expect(s.vlinePlain, "no non-month (weekly) vlines in month mode").toBe(0);
    expect(s.wband, "no weekend bands in month mode").toBe(0);
  });

  test("knees: 18→day, 17.9→week; 6.2→week, 6.1→month (asserted via axis DOM)", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    const s18 = await stats(page, 18);
    expect(s18.mode, "18 is day").toBe("day");
    expect(s18.texts.every((t) => /^\d+$/.test(t)) && s18.anyWkendTick, "18 renders a day axis").toBe(true);

    const s179 = await stats(page, 17.9);
    expect(s179.mode, "17.9 is week").toBe("week");
    expect(s179.texts.filter((t) => t.length).every((t) => /^\d+\/\d+$/.test(t)), "17.9 renders a week axis").toBe(true);
    expect(s179.wband, "17.9 has no weekend bands").toBe(0);

    const s62 = await stats(page, 6.2);
    expect(s62.mode, "6.2 is week").toBe("week");
    expect(s62.texts.filter((t) => t.length).every((t) => /^\d+\/\d+$/.test(t)), "6.2 renders a week axis").toBe(true);

    const s61 = await stats(page, 6.1);
    expect(s61.mode, "6.1 is month").toBe("month");
    expect(s61.texts.every((t) => t === ""), "6.1 renders a month axis (empty ticks)").toBe(true);
    expect(s61.vlinePlain, "6.1 has no weekly vlines").toBe(0);
  });
});
