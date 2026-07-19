// Shared fixtures + helpers for the Adeptio Gantt v1.0.3 suite.
//
// HARD SAFETY RULE (spec §Playwright harness): every context aborts EVERY request
// to the production Cloudflare Worker before any page script runs. The app pushes
// the whole doc to production D1 on every Store.save() (cloudSync on load, an 800ms
// debounced cloudPush after each save, a 30s cloudPull, and a focus pull) — so a
// test that reaches the network could corrupt live customer data. We abort at the
// context layer AND assert in teardown that ZERO requests ever *reached* production
// (all attempts must fail/abort). The app wraps every fetch in try/catch, so aborts
// surface as caught rejections, never as a pageerror.
//
// External CDNs/fonts (cdnjs, googleapis, gstatic) are neutralized to empty 200s so
// the suite is hermetic and fast (the two <script src> tags in <head> would
// otherwise BLOCK parsing until they load). Tests never depend on xlsx/html2canvas
// behavior — only on the Export button being present, per spec.
const base = require("@playwright/test");

const PROD = "https://adeptio-gantt.pathom-bot.workers.dev";
const LS_KEY = "adeptio_ptrack_v2";

const test = base.test.extend({
  // Auto fixture — runs for EVERY test, regardless of module-require caching.
  _guard: [
    async ({ context, page }, use) => {
      // 1) Hard safety: abort the production Worker.
      await context.route(PROD + "/**", (route) => route.abort());
      // 2) Hermetic: neutralize external CDN/font requests (never depended upon).
      await context.route(/cdnjs\.cloudflare\.com/, (r) =>
        r.fulfill({ status: 200, contentType: "application/javascript", body: "" })
      );
      await context.route(/fonts\.googleapis\.com/, (r) =>
        r.fulfill({ status: 200, contentType: "text/css", body: "" })
      );
      await context.route(/fonts\.gstatic\.com/, (r) =>
        r.fulfill({ status: 200, contentType: "font/woff2", body: "" })
      );

      const prod = { attempts: [], reached: [], failed: [] };
      const pageErrors = [];
      const consoleErrors = [];
      page.on("request", (r) => { if (r.url().startsWith(PROD)) prod.attempts.push(r.url()); });
      page.on("response", (r) => { if (r.url().startsWith(PROD)) prod.reached.push(r.url()); });
      page.on("requestfailed", (r) => { if (r.url().startsWith(PROD)) prod.failed.push(r.url()); });
      page.on("pageerror", (e) => pageErrors.push(e.message || String(e)));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        // Ignore environmental network noise (aborted prod / neutralized CDN).
        if (/adeptio-gantt\.pathom-bot|net::ERR|Failed to load resource|status of 4|status of 5/i.test(t)) return;
        consoleErrors.push(t);
      });

      page._prod = prod;
      page._pageErrors = pageErrors;
      page._consoleErrors = consoleErrors;

      await use();

      // Teardown safety net (asserted for EVERY test):
      base.expect(
        prod.reached,
        `SAFETY VIOLATION: ${prod.reached.length} request(s) REACHED production D1: ${prod.reached.join(", ")}`
      ).toEqual([]);
      base.expect(
        pageErrors,
        `uncaught pageerror(s): ${pageErrors.join(" | ")}`
      ).toEqual([]);
      base.expect(
        consoleErrors,
        `unexpected console error(s): ${consoleErrors.join(" | ")}`
      ).toEqual([]);
    },
    { auto: true },
  ],
});

const expect = base.expect;

/* ----------------------------- seed builders ----------------------------- */
function mkFeat(id, name, start = "2026-07-01", end = "2026-07-15") {
  return { id, fid: "", name, description: "", start, end, status: "not_started", remark: "", custom: {} };
}
function mkMod(id, name, opts = {}) {
  const { parentId = null, color = 0, collapsed = false, features = [] } = opts;
  return { id, name, description: "", color, collapsed, features, parentId };
}
function mkDoc(modules) {
  return {
    projects: [
      {
        id: "test-proj",
        name: "Test Project",
        client: "QA",
        code: "TP",
        color: 0,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        customCols: [],
        colOrder: ["name", "description", "start", "end", "status", "remark"],
        progressOrder: [],
        summary: { current: { id: "sum-cur", date: "2026-01-01", text: "" }, history: [] },
        modules,
      },
    ],
  };
}
// 3 MAIN modules, no subs.
function SEED_A() {
  return mkDoc([
    mkMod("m-alpha", "Alpha", { color: 0, features: [mkFeat("fa1", "Alpha One"), mkFeat("fa2", "Alpha Two")] }),
    mkMod("m-beta", "Beta", { color: 1, features: [mkFeat("fb1", "Beta One"), mkFeat("fb2", "Beta Two")] }),
    mkMod("m-gamma", "Gamma", { color: 2, features: [mkFeat("fg1", "Gamma One")] }),
  ]);
}
// Alpha (main, 2 subs) + Beta (main, 1 sub). Already in normalized order.
function SEED_B() {
  return mkDoc([
    mkMod("m-alpha", "Alpha", { color: 0, features: [mkFeat("fa1", "Alpha One"), mkFeat("fa2", "Alpha Two")] }),
    mkMod("m-a-sub1", "Alpha Sub One", { parentId: "m-alpha", color: 6, features: [mkFeat("fs1", "Sub One Feat")] }),
    mkMod("m-a-sub2", "Alpha Sub Two", { parentId: "m-alpha", color: 6, features: [mkFeat("fs2", "Sub Two Feat")] }),
    mkMod("m-beta", "Beta", { color: 1, features: [mkFeat("fb1", "Beta One")] }),
    mkMod("m-b-sub1", "Beta Sub", { parentId: "m-beta", color: 7, features: [mkFeat("fbs1", "Beta Sub Feat")] }),
  ]);
}

/* --------------------------- navigation helpers -------------------------- */
// Idempotent seed: only write when localStorage is empty, so a page.reload() keeps
// mutations made during the test (addInitScript re-runs on every navigation).
async function seed(page, doc) {
  await page.addInitScript(
    ([k, v]) => { try { if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v); } catch (e) {} },
    [LS_KEY, JSON.stringify(doc)]
  );
}
async function openProject(page, doc) {
  if (doc) await seed(page, doc);
  await page.goto("/#project=test-proj", { waitUntil: "domcontentloaded" });
  await page.locator("#proj").waitFor({ state: "attached" });
}
async function openTimeline(page, doc) {
  await openProject(page, doc);
  await page.locator('.tabBtn[data-tab="timeline"]').click();
  await page.locator("#leftBody .modRow").first().waitFor({ state: "attached" });
  await page.locator("#rowsLayer .modBarRow").first().waitFor({ state: "attached" });
}

/* ------------------------------ read helpers ----------------------------- */
async function readDoc(page) {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), LS_KEY);
  return JSON.parse(raw);
}
function docModules(doc) { return doc.projects[0].modules; }
function docModNames(doc) { return docModules(doc).map((m) => m.name); }
function docModById(doc, id) { return docModules(doc).find((m) => m.id === id); }

async function gridModNames(page) {
  return page.$$eval("#leftBody .modRow .modName", (els) => els.map((e) => e.textContent));
}
async function gridFeatNames(page) {
  return page.$$eval("#leftBody .featRow .cell.feat .txt", (els) => els.map((e) => e.textContent.trim()));
}
// v1.0.4: rows/bars are addressed by data-nid (node id), not data-mi/data-fi array indices.
// nidOf returns the data-nid of the modRow whose modName textContent EXACTLY equals `name`.
async function nidOf(page, name) {
  return page.evaluate((nm) => {
    const rows = [...document.querySelectorAll("#leftBody .modRow")];
    const r = rows.find((x) => x.querySelector(".modName").textContent === nm);
    return r ? r.dataset.nid : null;
  }, name);
}
// data-nid of the featRow whose feature name (cell.feat .txt) EXACTLY equals `name`.
async function featNid(page, name) {
  return page.evaluate((nm) => {
    const rows = [...document.querySelectorAll("#leftBody .featRow")];
    const r = rows.find((x) => (x.querySelector(".cell.feat .txt").textContent || "").trim() === nm);
    return r ? r.dataset.nid : null;
  }, name);
}
/* ---- tree-doc read helpers (recursive; the doc is now a node tree) ---- */
function docFindNode(doc, id) {
  let hit = null;
  (function rec(ns) { (ns || []).forEach((n) => { if (!n) return; if (n.id === id) hit = n; if (n.children) rec(n.children); }); })(docModules(doc));
  return hit;
}
function docFindByName(doc, name) {
  let hit = null;
  (function rec(ns) { (ns || []).forEach((n) => { if (!n) return; if (n.name === name) hit = n; if (n.children) rec(n.children); }); })(docModules(doc));
  return hit;
}
function docParentOf(doc, id) {
  let par = null;
  (function rec(ns, p) { (ns || []).forEach((n) => { if (!n) return; if (n.id === id) par = p; if (n.children) rec(n.children, n); }); })(docModules(doc), null);
  return par;
}
function docCountFeatures(doc) { let n = 0; (function rec(ns) { (ns || []).forEach((x) => { if (!x) return; if (x.kind === "feature") n++; else if (x.children) rec(x.children); }); })(docModules(doc)); return n; }
function docCountContainers(doc) { let n = 0; (function rec(ns) { (ns || []).forEach((x) => { if (!x) return; if (x.kind === "container") { n++; rec(x.children || []); } }); })(docModules(doc)); return n; }

/* -------------------------- computed-style helpers ----------------------- */
async function pseudo(page, selector, which) {
  return page.evaluate(
    ({ selector, which }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const s = getComputedStyle(el, which);
      return { content: s.content, width: s.width, height: s.height, backgroundColor: s.backgroundColor };
    },
    { selector, which }
  );
}
async function pxProp(page, selector, prop) {
  return page.evaluate(
    ({ selector, prop }) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      return parseFloat(getComputedStyle(el)[prop]);
    },
    { selector, prop }
  );
}

/* --------------------------- ALIGNMENT invariant ------------------------- */
// Left pane (#leftBody) and right pane (#rowsLayer) render P.modules in the SAME
// normalized order, emitting index-aligned row sequences:
//   modRow(46px) ↔ modBarRow(46px) · featRow(42px) ↔ barRow(42px) · addFeat(32px) ↔ spacer(32px)
// So row COUNT must match and each row's height must match its counterpart. This is
// the spec's core "row-count + per-row height" invariant, asserted after EVERY mutation.
async function alignmentSnapshot(page) {
  return page.evaluate(() => {
    const dim = (sel) =>
      [...document.querySelectorAll(sel)].map((e) => ({
        cls: e.className,
        h: Math.round(e.getBoundingClientRect().height),
      }));
    return { L: dim("#leftBody > *"), R: dim("#rowsLayer > *") };
  });
}
async function assertAligned(page, label = "") {
  const { L, R } = await alignmentSnapshot(page);
  expect(L.length, `${label} left row count (${L.length}) != right row count (${R.length})`).toBe(R.length);
  expect(L.length, `${label} expected at least one row`).toBeGreaterThan(0);
  for (let i = 0; i < L.length; i++) {
    expect(
      Math.abs(L[i].h - R[i].h),
      `${label} row ${i} height mismatch: left ${L[i].h}px [${L[i].cls}] vs right ${R[i].h}px [${R[i].cls}]`
    ).toBeLessThanOrEqual(1);
  }
}

/* ------------------------------- interactions ---------------------------- */
// D7: the grip menu REPLACES the v1.0.3 hover clusters (.modActs/.rowActs). Hover the module row's
// GRIP to slide the pill open, then click the [data-act] button (same act names as the old cluster,
// plus new indent/outdent/promote). The menu opens on grip hover only — never plain row hover.
//
// The pill reveals via a clip-path animation, and clip-path suppresses pointer events on the still-
// clipped region — so under CPU load a click aimed before the reveal finishes can fall through the
// clipped pill, drop the grip's :hover, and close the menu (a flake). We therefore wait until the
// target button is actually the top hit-target at its own centre (fully revealed) before clicking.
// The mouse stays parked on the grip during the wait, so the menu keeps animating open.
async function _pillButtonReady(page, rowSel, act) {
  await page.waitForFunction(
    ({ rowSel, act }) => {
      const b = document.querySelector(`${rowSel} .gripPill [data-act="${act}"]`);
      if (!b) return false;
      const r = b.getBoundingClientRect();
      if (r.width < 1) return false;
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!el && (b === el || b.contains(el));
    },
    { rowSel, act }
  );
}
async function clickModAct(page, name, act) {
  const nid = await nidOf(page, name);
  expect(nid, `module "${name}" not found`).not.toBeNull();
  const rowSel = `#leftBody .modRow[data-nid="${nid}"]`;
  await page.locator(`${rowSel} .modGrip`).hover();
  await _pillButtonReady(page, rowSel, act);
  await page.locator(`${rowSel} .gripPill [data-act="${act}"]`).click();
}
// Sibling helper for feature rows (addressed by node id): hover the feature grip → click the pill action.
async function clickFeatAct(page, nid, act) {
  const rowSel = `#leftBody .featRow[data-nid="${nid}"]`;
  await page.locator(`${rowSel} .grip[data-act="rowdrag"]`).hover();
  await _pillButtonReady(page, rowSel, act);
  await page.locator(`${rowSel} .gripPill [data-act="${act}"]`).click();
}

// Pointer-drag a module by its grip to a target module row. The app hit-tests with
// document.elementFromPoint, so we must issue REAL mouse moves (page.mouse) with a
// small kick-off move + a settling move so elementFromPoint stabilizes on the target.
async function dragModule(page, srcName, tgtName, where /* 'before' | 'after' | 'onto' */) {
  const sNid = await nidOf(page, srcName);
  const tNid = await nidOf(page, tgtName);
  expect(sNid, `drag source "${srcName}" not found`).not.toBeNull();
  expect(tNid, `drag target "${tgtName}" not found`).not.toBeNull();
  const grip = page.locator(`#leftBody .modRow[data-nid="${sNid}"] .modGrip`);
  const tgt = page.locator(`#leftBody .modRow[data-nid="${tNid}"]`);
  await grip.scrollIntoViewIfNeeded();
  const gb = await grip.boundingBox();
  await tgt.scrollIntoViewIfNeeded();
  const tb = await tgt.boundingBox();
  const sx = gb.x + gb.width / 2, sy = gb.y + gb.height / 2;
  const tx = tb.x + tb.width / 2;
  const ty = where === "before" ? tb.y + tb.height * 0.25 : where === "after" ? tb.y + tb.height * 0.8 : tb.y + tb.height * 0.5;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 3, sy + 3, { steps: 3 }); // kick off drag → creates ghost
  await page.mouse.move(tx, ty, { steps: 18 });
  await page.mouse.move(tx, ty, { steps: 6 }); // settle so elementFromPoint locks on
  await page.mouse.up();
}

// Pointer-drag a feature row by its grip to another feature row (regression guard).
// v1.0.4: features are addressed by data-nid (the feature's node id).
async function dragFeature(page, srcNid, tgtNid, where /* 'before' | 'after' */) {
  const grip = page.locator(`#leftBody .featRow[data-nid="${srcNid}"] .grip[data-act="rowdrag"]`);
  const tgt = page.locator(`#leftBody .featRow[data-nid="${tgtNid}"]`);
  const gb = await grip.boundingBox();
  const tb = await tgt.boundingBox();
  const sx = gb.x + gb.width / 2, sy = gb.y + gb.height / 2;
  const tx = tb.x + tb.width / 2;
  const ty = where === "before" ? tb.y + tb.height * 0.25 : tb.y + tb.height * 0.8;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 3, sy + 3, { steps: 3 });
  await page.mouse.move(tx, ty, { steps: 18 });
  await page.mouse.move(tx, ty, { steps: 6 });
  await page.mouse.up();
}

module.exports = {
  test,
  expect,
  PROD,
  LS_KEY,
  mkFeat,
  mkMod,
  mkDoc,
  SEED_A,
  SEED_B,
  seed,
  openProject,
  openTimeline,
  readDoc,
  docModules,
  docModNames,
  docModById,
  gridModNames,
  gridFeatNames,
  nidOf,
  featNid,
  docFindNode,
  docFindByName,
  docParentOf,
  docCountFeatures,
  docCountContainers,
  pseudo,
  pxProp,
  alignmentSnapshot,
  assertAligned,
  clickModAct,
  clickFeatAct,
  dragModule,
  dragFeature,
};
