// ADEPTIO Gantt v1.0.4 — Stage-4 "theme" suite (§1.10 / R11 / R12).
//
// Covers: dark-token swap smoke (+ byte-identical switch-back), the Auto/Light/Dark segmented control
// (three states, reflects ui.theme, persists in LS_UI, default 'auto'), Auto following prefers-color-scheme
// BOTH directions with explicit override, export-forces-light (html2canvas stub records the capture-time
// theme), dark stepped-shade parity + exact dark formula, alignment after theme switches (× a zoom change),
// and WCAG contrast spot-checks. Every context still routes through fixtures.js (prod host aborted before
// page scripts run). Two visual screenshots (light + dark, week zoom, nested doc) are saved for the architect.
const { test, expect, openProject, openTimeline, assertAligned, readDoc } = require("./fixtures");
const path = require("path");

const LS_UI = "adeptio_ptrack_ui"; // ui store (per-device): { wrapTxt, colW, ppd, theme } — theme lives here, never in the doc (R12)
const SHOT_DIR = path.join(__dirname, "test-results");

// Spec dark tokens (prototype §1.10), as the browser-normalised rgb().
const DARK = {
  surface: "rgb(19, 18, 24)",   // #131218
  panel:   "rgb(27, 26, 34)",   // #1b1a22
  ink:     "rgb(236, 234, 243)",// #eceaf3
};

// A depth-0..3 nested doc so stepped shading is exercised at depth ≥3 and both panes have real rows.
function NESTED_DOC() {
  return {
    projects: [{
      id: "test-proj", name: "Nested", client: "QA", code: "TP", color: 0,
      createdAt: "2026-01-01", updatedAt: "2026-01-01", customCols: [],
      colOrder: ["name", "description", "start", "end", "status", "remark"], progressOrder: [],
      summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
      docVer: 2,
      modules: [
        { id: "m1", kind: "container", name: "Alpha", color: 0, collapsed: false, children: [
          { id: "f1", kind: "feature", fid: "A-1", name: "Alpha One", description: "", start: "2026-07-01", end: "2026-07-18", status: "done", remark: "", custom: {} },
          { id: "s1", kind: "container", name: "Alpha Sub", color: 6, collapsed: false, children: [
            { id: "f2", kind: "feature", fid: "A-2", name: "Sub Feat", description: "", start: "2026-07-10", end: "2026-08-05", status: "in_progress", remark: "", custom: {} },
            { id: "s2", kind: "container", name: "Alpha Sub Sub", color: 2, collapsed: false, children: [
              { id: "deep", kind: "feature", fid: "A-3", name: "Deep Feat", description: "", start: "2026-07-20", end: "2026-08-20", status: "blocked", remark: "", custom: {} },
            ]},
          ]},
        ]},
        { id: "m2", kind: "container", name: "Beta", color: 3, collapsed: false, children: [
          { id: "f3", kind: "feature", fid: "B-1", name: "Beta One", description: "", start: "2026-08-01", end: "2026-09-05", status: "at_risk", remark: "", custom: {} },
        ]},
      ],
    }],
  };
}

async function readUi(page) {
  return page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch (e) { return {}; } }, LS_UI);
}
async function memTheme(page) { return page.evaluate(() => ui.theme); } // in-memory ui.theme (the default 'auto' is only flushed to LS_UI on the first saveUi)
async function rootTheme(page) { return page.evaluate(() => document.documentElement.getAttribute("data-theme")); }
async function setTheme(page, mode) { await page.evaluate((m) => window.setTheme(m), mode); }
// --shade is a raw custom-property token stream (var()-substituted at computed time, NOT re-serialised) →
// resolve it through a probe element's background-color, which IS normalised. (Same trick as timeline/tree-ui.)
async function shadeRGB(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return null;
    const raw = getComputedStyle(el).getPropertyValue("--shade").trim();
    const probe = document.createElement("span"); probe.style.backgroundColor = raw || "transparent"; document.body.appendChild(probe);
    const norm = getComputedStyle(probe).backgroundColor; probe.remove(); return norm;
  }, sel);
}
// The rendered inline fill + ink of a feature bar (by node id). NESTED_DOC's "f1" is Alpha's direct
// feature → its bar colour is the parent container's palette entry PALETTE[0] (violet).
async function barFillInk(page, nid = "f1") {
  return page.evaluate((id) => {
    const b = document.querySelector(`#rowsLayer .bar[data-nid="${id}"]`);
    return b ? { bg: getComputedStyle(b).backgroundColor, ink: getComputedStyle(b).color } : null;
  }, nid);
}
// Browser-normalised EXPECTED bar colours for PALETTE[idx], computed IN-PAGE from the app's own
// hex2rgba/lighten (the formula under test IS the formula asserted) and pushed through a probe element
// so they match the normalisation the browser applies to computed backgroundColor/color.
async function paletteExpect(page, idx = 0) {
  return page.evaluate((i) => {
    const pc = PALETTE[i];
    const norm = (raw) => { const p = document.createElement("span"); p.style.backgroundColor = raw; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
    return { lightFill: norm(pc.fill), darkFill: norm(hex2rgba(pc.chip, 0.22)), darkInk: norm(lighten(pc.chip, 0.62)) };
  }, idx);
}

/* ===================================== TOKEN SWAP SMOKE ===================================== */
test.describe("§1.10 dark token swap", () => {
  test("switch to dark → body/surface/panel/ink = spec tokens; back to light → byte-identical", async ({ page }) => {
    await openProject(page, NESTED_DOC());
    // capture the LIGHT computed values first
    const light = await page.evaluate(() => ({
      root: document.documentElement.getAttribute("data-theme"),
      surface: getComputedStyle(document.body).backgroundColor,
      ink: getComputedStyle(document.body).color,
      panel: getComputedStyle(document.getElementById("topbar")).backgroundColor,
    }));
    expect(light.root, "default effective theme is light (no OS dark emulated)").toBe("light");

    await setTheme(page, "dark");
    expect(await rootTheme(page)).toBe("dark");
    const dark = await page.evaluate(() => ({
      surface: getComputedStyle(document.body).backgroundColor,
      ink: getComputedStyle(document.body).color,
      panel: getComputedStyle(document.getElementById("topbar")).backgroundColor,
    }));
    expect(dark.surface, "body background = --surface #131218").toBe(DARK.surface);
    expect(dark.panel, "topbar background = --panel #1b1a22").toBe(DARK.panel);
    expect(dark.ink, "body color = --ink #eceaf3").toBe(DARK.ink);

    // back to light → byte-identical to the pre-switch computed values
    await setTheme(page, "light");
    expect(await rootTheme(page)).toBe("light");
    const back = await page.evaluate(() => ({
      surface: getComputedStyle(document.body).backgroundColor,
      ink: getComputedStyle(document.body).color,
      panel: getComputedStyle(document.getElementById("topbar")).backgroundColor,
    }));
    expect(back.surface).toBe(light.surface);
    expect(back.ink).toBe(light.ink);
    expect(back.panel).toBe(light.panel);
  });
});

/* ================================= SEGMENTED CONTROL + PERSIST ================================= */
test.describe("§1.10 Auto/Light/Dark segmented control (R12 persistence)", () => {
  test("three states, active reflects ui.theme, default = auto", async ({ page }) => {
    await openProject(page, NESTED_DOC());
    const seg = page.locator("#themeSeg");
    await expect(seg.locator("[data-theme-set]")).toHaveCount(3);
    // default: auto active (in-memory default; LS_UI is written only on the first change)
    expect(await memTheme(page)).toBe("auto");
    await expect(seg.locator('[data-theme-set="auto"]')).toHaveClass(/\bon\b/);
    await expect(seg.locator('[data-theme-set="light"]')).not.toHaveClass(/\bon\b/);

    // click Dark → active moves, ui.theme persists in LS_UI (not the doc)
    await seg.locator('[data-theme-set="dark"]').click();
    await expect(seg.locator('[data-theme-set="dark"]')).toHaveClass(/\bon\b/);
    await expect(seg.locator('[data-theme-set="auto"]')).not.toHaveClass(/\bon\b/);
    expect(await readUi(page)).toMatchObject({ theme: "dark" });
    const doc = await readDoc(page);
    expect(JSON.stringify(doc), "theme is NEVER written into the doc (R12)").not.toContain('"theme"');

    // click Light
    await seg.locator('[data-theme-set="light"]').click();
    expect((await readUi(page)).theme).toBe("light");
    expect(await rootTheme(page)).toBe("light");
  });

  test("theme persists across a reload (LS_UI)", async ({ page }) => {
    await openProject(page, NESTED_DOC());
    await setTheme(page, "dark");
    expect((await readUi(page)).theme).toBe("dark");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#proj").waitFor({ state: "attached" });
    expect(await rootTheme(page), "restored dark from LS_UI on reload").toBe("dark");
    await expect(page.locator('#themeSeg [data-theme-set="dark"]')).toHaveClass(/\bon\b/);
  });
});

/* ===================================== AUTO — BOTH DIRECTIONS ===================================== */
test.describe("§5.4 Auto follows prefers-color-scheme; explicit overrides both directions", () => {
  test("auto follows an emulated dark scheme, and light/dark override it", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openProject(page, NESTED_DOC());
    expect(await memTheme(page), "default auto").toBe("auto");
    expect(await rootTheme(page), "auto + OS dark → dark").toBe("dark");

    await setTheme(page, "light");   // explicit light OVERRIDES the emulated dark scheme
    expect(await rootTheme(page)).toBe("light");
    await setTheme(page, "dark");
    expect(await rootTheme(page)).toBe("dark");

    await setTheme(page, "auto");    // back to auto → follows OS again (still dark)
    expect(await rootTheme(page)).toBe("dark");

    // live OS flip while in auto → the matchMedia listener re-applies (dark → light)
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => rootTheme(page)).toBe("light");
  });

  test("explicit dark overrides OS light and ignores REAL OS flips (both directions)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openProject(page, NESTED_DOC());
    expect(await rootTheme(page), "auto + OS light → light").toBe("light");
    await setTheme(page, "dark");    // explicit dark OVERRIDES the emulated light scheme
    expect(await rootTheme(page)).toBe("dark");
    // REAL change events (light → dark → back to light): explicit dark must ignore EACH one. Flipping to a
    // DIFFERENT scheme every step guarantees a genuine matchMedia "change" fires — the prior test emulated
    // 'light' while ALREADY light, so no event fired and the guard was never actually exercised (vacuous).
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(80);
    expect(await rootTheme(page), "explicit dark unmoved by OS→dark").toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(80);
    expect(await rootTheme(page), "explicit dark unmoved by OS→light").toBe("dark");
  });

  test("explicit light overrides OS dark and ignores REAL OS flips (mirror)", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openProject(page, NESTED_DOC());
    expect(await rootTheme(page), "auto + OS dark → dark").toBe("dark");
    await setTheme(page, "light");   // explicit light OVERRIDES the emulated dark scheme
    expect(await rootTheme(page)).toBe("light");
    await page.emulateMedia({ colorScheme: "light" });   // real change: dark → light
    await page.waitForTimeout(80);
    expect(await rootTheme(page), "explicit light unmoved by OS→light").toBe("light");
    await page.emulateMedia({ colorScheme: "dark" });    // real change: light → dark
    await page.waitForTimeout(80);
    expect(await rootTheme(page), "explicit light unmoved by OS→dark").toBe("light");
  });

  test("auto: a live OS flip re-renders the inline bar FILL, not just the attribute", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await openTimeline(page, NESTED_DOC());
    expect(await memTheme(page), "default auto").toBe("auto");
    expect(await rootTheme(page), "auto + OS dark → dark").toBe("dark");
    const exp = await paletteExpect(page, 0);
    expect((await barFillInk(page, "f1")).bg, "bar starts dark-filled").toBe(exp.darkFill);
    // Live OS flip dark→light under auto: BOTH the attribute AND the inline bar fill must follow. If onFlip
    // ever drops rerenderForTheme(), the attribute flips but the inline fill stays dark → this poll fails.
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => rootTheme(page)).toBe("light");
    await expect.poll(async () => (await barFillInk(page, "f1")).bg).toBe(exp.lightFill);
  });
});

/* ===================================== EXPORT FORCES LIGHT (§1.10) ===================================== */
test.describe("§1.10 exportPng forces light for the capture, then restores", () => {
  test("html2canvas samples LIGHT pastel bar fills at capture; dark restored + re-rendered after; aligned", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    await setTheme(page, "dark");
    expect(await rootTheme(page)).toBe("dark");
    const exp = await paletteExpect(page, 0);
    expect((await barFillInk(page, "f1")).bg, "bar is dark-filled before export").toBe(exp.darkFill);

    // Stub html2canvas (the CDN is neutralised in fixtures) to RECORD, AT CAPTURE TIME, both the root theme
    // AND a real bar's computed fill — pinning what actually gets painted into the PNG, not just the attribute.
    // No-op the anchor download so the test has no side effects.
    await page.evaluate(() => {
      window.__cap = { theme: null, calls: 0, barFill: null };
      window.html2canvas = (node, opts) => {
        window.__cap.calls++;
        window.__cap.theme = document.documentElement.getAttribute("data-theme");  // theme AT capture time
        const bar = document.querySelector('#rowsLayer .bar[data-nid="f1"]');        // sample the rendered bar AT capture time
        window.__cap.barFill = bar ? getComputedStyle(bar).backgroundColor : null;
        return Promise.resolve({ toDataURL: () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" });
      };
      window.__origAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { window.__cap.clicked = true; };
    });

    await page.evaluate(() => window.exportPng());
    await expect.poll(() => page.evaluate(() => window.__cap && window.__cap.calls)).toBeGreaterThan(0);

    const cap = await page.evaluate(() => window.__cap);
    expect(cap.calls, "html2canvas was invoked").toBe(1);
    expect(cap.theme, "capture ran under FORCED light").toBe("light");
    expect(cap.barFill, "bar was the LIGHT pastel (pc.fill) at capture — no dark fill leaks into the PNG").toBe(exp.lightFill);
    expect(await rootTheme(page), "user's dark theme restored after export").toBe("dark");
    // the post-restore re-render actually RAN → the bar is the dark translucent fill again (not stuck light)
    expect((await barFillInk(page, "f1")).bg, "bar restored to the dark translucent fill after export").toBe(exp.darkFill);

    await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.__origAnchorClick; });
    await assertAligned(page, "after export in dark");
  });
});

/* ===================================== INLINE BAR FILL/INK — EXACT FORMULAS ===================================== */
test.describe("§1.10 item 6 inline bar fill + ink — exact formulas, both themes", () => {
  test("light = pc.fill (byte-identical); dark = hex2rgba(chip,.22) / lighten(chip,.62); dark ≠ light", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    const exp = await paletteExpect(page, 0);                       // f1's container (m1) is color 0 → violet chip
    // LIGHT — byte-identical to the v1.0.3 pastel fill
    const light = await barFillInk(page, "f1");
    expect(light.bg, "light bar fill === pc.fill (byte-identical)").toBe(exp.lightFill);
    // DARK — the exact chip-derived formulas
    await setTheme(page, "dark");
    const dark = await barFillInk(page, "f1");
    expect(dark.bg, "dark bar fill === hex2rgba(chip,.22)").toBe(exp.darkFill);
    expect(dark.ink, "dark bar ink === lighten(chip,.62)").toBe(exp.darkInk);
    // kills the inverted-flag mutant (dark?light:dark) — the two fills MUST differ
    expect(exp.darkFill, "computed dark fill != computed light fill").not.toBe(exp.lightFill);
    expect(dark.bg, "rendered dark fill != rendered light fill").not.toBe(light.bg);
  });
});

/* ===================================== PRINT GUARD (§1.10 T2) ===================================== */
test.describe("§1.10 T2 print — inline dark fills forced light; tokens revert under print media", () => {
  test("beforeprint stamps light + light bar fills; afterprint restores dark + dark fills", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    await setTheme(page, "dark");
    expect(await rootTheme(page)).toBe("dark");
    const exp = await paletteExpect(page, 0);
    expect((await barFillInk(page, "f1")).bg, "dark-filled before print").toBe(exp.darkFill);
    // beforeprint runs synchronously (Chromium fires it BEFORE painting the print view) → force light + rebuild
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    expect(await rootTheme(page), "attribute forced light during print").toBe("light");
    expect((await barFillInk(page, "f1")).bg, "inline bar fills forced light during print").toBe(exp.lightFill);
    // afterprint → restore the user's dark theme + dark inline fills
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect.poll(() => rootTheme(page)).toBe("dark");
    await expect.poll(async () => (await barFillInk(page, "f1")).bg).toBe(exp.darkFill);
  });

  test("emulate print media → dark TOKEN block reverts to light (@media screen wrap)", async ({ page }) => {
    await openProject(page, NESTED_DOC());
    // light --surface baseline
    await setTheme(page, "light");
    const lightSurface = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // dark on screen → dark ground
    await setTheme(page, "dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(DARK.surface);
    // emulate PRINT media: the WHOLE dark block sits inside @media screen, so body tokens revert to :root light
    // (the attribute is still 'dark' — emulateMedia does not fire beforeprint — so this isolates the CSS wrap)
    await page.emulateMedia({ media: "print" });
    const printSurface = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    await page.emulateMedia({ media: "screen" });                    // restore
    expect(printSurface, "print reverts to light --surface").toBe(lightSurface);
    expect(printSurface, "print is not the dark ground").not.toBe(DARK.surface);
  });
});

/* ===================================== DARK STEPPED-SHADE PARITY ===================================== */
test.describe("§1.6 dark stepped shading — parity + exact dark formula", () => {
  test("depth-3 dark = rgba(169,112,255,.165); light unchanged = rgba(146,65,255,.09)", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    // LIGHT first — the depth-3 feature keeps the v1.0.3 light value
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="deep"]')).toBe("rgba(146, 65, 255, 0.09)");
    expect(await shadeRGB(page, '#rowsLayer .barRow[data-nid="deep"]')).toBe("rgba(146, 65, 255, 0.09)");

    await setTheme(page, "dark");
    // DARK — the dark channel resolves: .055 × 3 = .165 (exact), and the two panes stay in lockstep
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="deep"]')).toBe("rgba(169, 112, 255, 0.165)");
    expect(await shadeRGB(page, '#rowsLayer .barRow[data-nid="deep"]')).toBe("rgba(169, 112, 255, 0.165)");
    // depth-1 dark = .055; depth-2 dark = .11
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="f1"]')).toBe("rgba(169, 112, 255, 0.055)");
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="f2"]')).toBe("rgba(169, 112, 255, 0.11)");
    // depth-0 root container → still no tint in dark
    expect(await shadeRGB(page, '#leftBody .modRow[data-nid="m1"]')).toBe("rgba(0, 0, 0, 0)");
  });

  test("every row: left↔right --shade parity holds in dark (nid + row-kind keyed)", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    await setTheme(page, "dark");
    const res = await page.evaluate(() => {
      const norm = (raw) => { const p = document.createElement("span"); p.style.backgroundColor = raw || "transparent"; document.body.appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; };
      const shade = (el) => norm(getComputedStyle(el).getPropertyValue("--shade").trim());
      const L = [...document.querySelectorAll("#leftBody > *")], R = [...document.querySelectorAll("#rowsLayer > *")];
      const kindOf = (el) => el.classList.contains("modRow") ? "mod" : el.classList.contains("featRow") ? "feat" : el.classList.contains("addFeat") ? "add" : "other";
      const used = new Set();
      const twin = (nid, kind) => {
        for (let j = 0; j < R.length; j++) {
          if (used.has(j)) continue; const r = R[j]; if (r.dataset.nid !== nid) continue;
          const hasBar = !!r.querySelector(".bar");
          if (kind === "mod" && r.classList.contains("modBarRow")) return j;
          if (kind === "feat" && r.classList.contains("barRow") && hasBar) return j;
          if (kind === "add" && r.classList.contains("barRow") && !hasBar) return j;
        }
        return -1;
      };
      let mism = 0, matched = 0;
      for (let i = 0; i < L.length; i++) {
        const el = L[i], j = twin(el.dataset.nid, kindOf(el));
        if (j < 0) continue; used.add(j); matched++;
        if (shade(el) !== shade(R[j])) mism++;
      }
      return { ln: L.length, rn: R.length, matched, mism };
    });
    expect(res.ln, "row-count parity").toBe(res.rn);
    expect(res.matched, "all left rows twinned to a right row").toBe(res.ln);
    expect(res.mism, "left/right --shade mismatches in dark").toBe(0);
  });
});

/* ===================================== ALIGNMENT (R11) ACROSS THEME × ZOOM ===================================== */
test.describe("R11 alignment holds across theme switches (both directions) and theme × zoom", () => {
  test("assertAligned after light→dark, dark→light, and a zoom change while dark", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    await assertAligned(page, "light initial");
    await setTheme(page, "dark");
    await assertAligned(page, "after light→dark");
    // zoom while dark (theme × zoom interplay: inline bar fills rebuilt at the new PPD, heights preserved)
    await page.evaluate(() => window.applyZoom(20));
    await assertAligned(page, "after zoom-in while dark");
    await page.evaluate(() => window.applyZoom(2));
    await assertAligned(page, "after zoom-out while dark");
    await setTheme(page, "light");
    await assertAligned(page, "after dark→light");
  });
});

/* ===================================== WCAG CONTRAST SPOT-CHECKS ===================================== */
test.describe("§1.10 contrast — legible on the dark ground", () => {
  test("ink/surface, ink/panel, bar label ink on worst-fill, status dots — computed WCAG", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    await setTheme(page, "dark");
    const r = await page.evaluate(() => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
      const Lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
      const ratio = (a, b) => { const la = Lum(a), lb = Lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); };
      const over = (fg, bg) => { const a = fg[3] == null ? 1 : fg[3]; return [0, 1, 2].map((i) => Math.round(fg[i] * a + bg[i] * (1 - a))); }; // composite fg (maybe alpha) over opaque bg
      const cs = (sel, prop) => { const el = document.querySelector(sel); return el ? rgb(getComputedStyle(el)[prop]) : null; };

      const surface = cs("body", "backgroundColor");
      const panel = cs("#topbar", "backgroundColor");
      const ink = cs("body", "color");
      // worst bar = the violet palette (color 0) → Alpha's feature bar "f1"
      const bar = document.querySelector('#rowsLayer .bar[data-nid="f1"]');
      const barInk = rgb(getComputedStyle(bar).color);
      const barFillRaw = rgb(getComputedStyle(bar).backgroundColor);           // rgba chip @ .22
      const paneBg = cs("#rightScroll", "backgroundColor") || panel;           // the bar composites over the (panel) pane
      const barFill = over(barFillRaw, paneBg);
      // status dots — read each rendered .sdot on the dark panel
      const dots = [...document.querySelectorAll("#rowsLayer .sdot")].map((d) => ratio(rgb(getComputedStyle(d).backgroundColor), paneBg));

      const round = (x) => Math.round(x * 100) / 100;
      return {
        inkSurface: round(ratio(ink, surface)),
        inkPanel: round(ratio(ink, panel)),
        barInkFill: round(ratio(barInk, barFill)),
        statusMin: round(Math.min(...dots)),
        statusMax: round(Math.max(...dots)),
      };
    });
    // body-text pairs ≥ 4.5; graphical (bar label small, status dots) ≥ 3
    expect(r.inkSurface, `ink/surface=${r.inkSurface}`).toBeGreaterThanOrEqual(4.5);
    expect(r.inkPanel, `ink/panel=${r.inkPanel}`).toBeGreaterThanOrEqual(4.5);
    expect(r.barInkFill, `worst bar ink/fill=${r.barInkFill}`).toBeGreaterThanOrEqual(4.5);
    expect(r.statusMin, `worst status dot=${r.statusMin}`).toBeGreaterThanOrEqual(3);
  });
});

/* ===================================== VISUAL SCREENSHOTS (not asserted) ===================================== */
test.describe("visual — timeline light + dark (week zoom, nested doc), saved for the architect", () => {
  test("capture light and dark", async ({ page }) => {
    await openTimeline(page, NESTED_DOC());
    await page.evaluate(() => window.applyZoom(11)); // week
    // Web fonts are stubbed to empty 200s by fixtures, so the FontFaceSet settles
    // immediately in principle — but under full-suite CPU load the neutralised
    // fonts.googleapis.com stylesheet can still be in-flight when page.screenshot()
    // runs its implicit font-wait, which then times out ("waiting for fonts to load").
    // Settle document.fonts explicitly (bounded, never hangs) and take each shot as a
    // best-effort capture (disabled animations + hidden caret + a generous timeout) so
    // this NON-ASSERTIVE, PNG-saving test can never fail the suite on a font-wait race.
    await page.evaluate(() => Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))])).catch(() => {});
    const shoot = async (name) => {
      try {
        await page.screenshot({ path: path.join(SHOT_DIR, name), animations: "disabled", caret: "hide", timeout: 20000 });
      } catch (e) { console.warn("theme screenshot skipped (" + name + "): " + (e && e.message)); }
    };
    await setTheme(page, "light");
    await page.waitForTimeout(120);
    await shoot("theme-timeline-light.png");
    await setTheme(page, "dark");
    await page.waitForTimeout(120);
    await shoot("theme-timeline-dark.png");
    expect(await rootTheme(page)).toBe("dark");
  });
});
