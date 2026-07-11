// @ts-check
const { expect } = require("./fixtures.fix");

const LS_KEY = "adeptio_ptrack_v2";
const LS_UI = "adeptio_ptrack_ui";

/* Minimal, fully-specified doc for targeted states. Fresh object each call so
   tests never share references. Dates straddle 2026-07-11 so the today line shows. */
function minimalDoc() {
  return {
    projects: [
      {
        id: "test-proj",
        name: "Test Project",
        client: "ACME",
        code: "TP",
        color: 0,
        createdAt: "2026-07-01",
        updatedAt: "2026-07-01",
        customCols: [],
        progressOrder: [],
        summary: { current: { id: "sum1", date: "2026-07-01", text: "" }, history: [] },
        modules: [
          {
            id: "mod-a", name: "Module A", description: "first module", color: 0, collapsed: false,
            features: [
              { id: "fa1", fid: "A-1", name: "Alpha One", description: "desc a1", start: "2026-07-05", end: "2026-07-20", status: "in_progress", remark: "", custom: {} },
              { id: "fa2", fid: "A-2", name: "Alpha Two", description: "desc a2", start: "2026-07-15", end: "2026-08-02", status: "not_started", remark: "", custom: {} },
            ],
          },
          {
            id: "mod-b", name: "Module B", description: "second module", color: 1, collapsed: false,
            features: [
              { id: "fb1", fid: "B-1", name: "Bravo One", description: "desc b1", start: "2026-07-10", end: "2026-07-28", status: "done", remark: "", custom: {} },
              { id: "fb2", fid: "B-2", name: "Bravo Two", description: "desc b2", start: "2026-07-22", end: "2026-08-12", status: "at_risk", remark: "", custom: {} },
            ],
          },
        ],
      },
    ],
  };
}

/* Seed a targeted doc into localStorage BEFORE any page script runs. The guard
   (set only if empty) means a later reload keeps whatever the app itself saved —
   essential for the persistence round-trip tests. */
async function seedDoc(page, doc) {
  await page.addInitScript(
    ([key, d]) => {
      try {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(d));
      } catch (e) {}
    },
    [LS_KEY, doc]
  );
}

async function readDB(page) {
  return await page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }, LS_KEY);
}

async function readUi(page) {
  return await page.evaluate((key) => {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; }
  }, LS_UI);
}

/* Return the project object (by id) from the persisted doc. */
async function readProject(page, pid = "test-proj") {
  const db = await readDB(page);
  return db && db.projects.find((p) => p.id === pid);
}

async function openDashboard(page) {
  await page.goto("/");
  await page.waitForSelector("#dash");
}

async function openProject(page, pid = "test-proj") {
  await page.goto("/#project=" + pid);
  await page.waitForSelector("#proj");
}

async function gotoTimeline(page) {
  await page.click('.tabBtn[data-tab="timeline"]');
  await page.waitForSelector("#board");
  await page.waitForSelector("#leftBody .modRow");
}

/* ---------- left/right pane alignment ---------- *
 * Left  (#leftBody):  modRow | featRow* | addFeat   per expanded module.
 * Right (#rowsLayer): modBarRow | barRow(feature)* | barRow(spacer) per module.
 * The two sequences must be 1:1 in count, type, per-row top offset, and height —
 * that is the invariant that keeps the panes visually locked while scrolling.  */
async function collectRows(page) {
  return await page.evaluate(() => {
    const leftBody = document.getElementById("leftBody");
    const rowsLayer = document.getElementById("rowsLayer");
    if (!leftBody || !rowsLayer) return { ok: false, reason: "board not rendered" };
    const lbTop = leftBody.getBoundingClientRect().top;
    const rlTop = rowsLayer.getBoundingClientRect().top;
    const left = Array.from(leftBody.children).map((el) => {
      const r = el.getBoundingClientRect();
      const type = el.classList.contains("modRow") ? "mod"
        : el.classList.contains("featRow") ? "feat"
        : el.classList.contains("addFeat") ? "add" : "other";
      return { type, top: +(r.top - lbTop).toFixed(2), height: +r.height.toFixed(2), mi: el.dataset.mi ?? null, fi: el.dataset.fi ?? null };
    });
    const right = Array.from(rowsLayer.children).map((el) => {
      const r = el.getBoundingClientRect();
      const type = el.classList.contains("modBarRow") ? "mod"
        : el.querySelector(".bar") ? "feat" : "add";
      return { type, top: +(r.top - rlTop).toFixed(2), height: +r.height.toFixed(2) };
    });
    return { ok: true, left, right };
  });
}

async function assertPanesAligned(page, label = "") {
  const res = await collectRows(page);
  expect(res.ok, `panes rendered ${label} ${res.reason || ""}`).toBeTruthy();
  const { left, right } = res;
  // Row counts match (this is the "left/right pane row-count" assertion).
  expect(right.length, `L/R row count ${label} (L=${left.length} R=${right.length})`).toBe(left.length);
  const nModL = left.filter((r) => r.type === "mod").length;
  const nModR = right.filter((r) => r.type === "mod").length;
  expect(nModR, `module row count ${label}`).toBe(nModL);
  const nFeatL = left.filter((r) => r.type === "feat").length;
  const nFeatR = right.filter((r) => r.type === "feat").length;
  expect(nFeatR, `feature row count ${label}`).toBe(nFeatL);
  // Per-row type + geometry alignment.
  for (let i = 0; i < left.length; i++) {
    expect(right[i].type, `row ${i} type ${label} (L=${left[i].type} R=${right[i].type})`).toBe(left[i].type);
    expect(
      Math.abs(left[i].top - right[i].top),
      `row ${i} top align ${label} (L=${left[i].top} R=${right[i].top})`
    ).toBeLessThanOrEqual(1.5);
    expect(
      Math.abs(left[i].height - right[i].height),
      `row ${i} height align ${label} (L=${left[i].height} R=${right[i].height})`
    ).toBeLessThanOrEqual(1.5);
  }
  return { left, right };
}

/* Center-of-element pointer drag using raw mouse events (drives the app's
   pointerdown/move/up handlers, which Chromium synthesizes from mouse events). */
async function dragGrip(page, sourceSelector, targetSelector, opts = {}) {
  const src = await page.locator(sourceSelector).boundingBox();
  const tgt = await page.locator(targetSelector).boundingBox();
  if (!src || !tgt) throw new Error("dragGrip: missing box for " + sourceSelector + " / " + targetSelector);
  const sx = src.x + src.width / 2, sy = src.y + src.height / 2;
  // Bias toward top/bottom third of the target so before/after resolves as intended.
  const frac = opts.before === false ? 0.75 : opts.before === true ? 0.25 : 0.5;
  const tx = tgt.x + tgt.width / 2, ty = tgt.y + tgt.height * frac;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Move in steps so onRowDragMove/elementFromPoint hit-tests the target repeatedly.
  await page.mouse.move(sx, sy + 6, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 12 });
  await page.mouse.move(tx, ty, { steps: 3 }); // settle on target
  await page.mouse.up();
}

/* Replace the text of a real contenteditable cell, exercising the app's blur/
   keydown save path (onTextBlur). Name/module fields blur on Enter; description
   blurs by clicking an inert element in the topbar. */
async function editContenteditable(page, selector, text, opts = {}) {
  const blur = opts.blur || "enter";
  const loc = page.locator(selector);
  await loc.click();
  await loc.selectText();
  await page.keyboard.type(text);
  if (blur === "enter") await page.keyboard.press("Enter");
  else await page.locator("#pName").click(); // inert h1 in the topbar → blurs the cell
}

module.exports = {
  LS_KEY, LS_UI,
  minimalDoc, seedDoc, readDB, readUi, readProject,
  openDashboard, openProject, gotoTimeline,
  collectRows, assertPanesAligned, dragGrip, editContenteditable,
};
