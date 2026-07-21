// @ts-check
/* E4 — LIVE sync with Cloudflare (SPEC_v1.0.6 §5 + R-E4a..c).
 *
 * Every OTHER spec ABORTS the production Worker via ./fixtures; this file instead FULFILLS the Worker
 * URL with a scripted in-test mock and NEVER passes a request through to the network. Two fixtures:
 *
 *   `_safety`  — AUTO (runs for EVERY test in this file, findings 2/8). It (a) registers an ABORT
 *                fallback on the PROD URL so a test that FORGETS to destructure `mock` fails CLOSED —
 *                the request is aborted, never reaching the real worker — and (b) owns the zero-REAL-
 *                request / no-pageerror / no-console-error teardown assertions. Mirrors ./fixtures'
 *                auto `_guard`, so this file is exactly as safe as every other spec, not weaker.
 *   `mock`     — OPT-IN, and DEPENDS ON `_safety` so its FULFILLING route is registered AFTER the
 *                abort fallback. Playwright matches routes last-registered-first, so the fulfilling
 *                mock wins whenever a test requests it; with no mock, only the abort remains. Every
 *                fulfilled response carries `x-mock:1` so the safety net can tell a mock from a real
 *                hit. Nothing in ./fixtures is weakened — this all lives in this file's own `test`.
 *
 * Engine bindings (schedulePush/cloudPush/cloudPull/adoptRemote/pushPending/pushFails/lastSyncAt/
 * _syncState/undoStack/DB/PID/Store/stopPoll/…) are top-level app.js declarations, reachable by BARE
 * name inside page.evaluate — the same global-lexical trick the E2 suite uses. */
const base = require("@playwright/test");
const F = require("./fixtures");
const { SEED_A, seed, readDoc } = F;
const expect = base.expect;

/* Every fulfilled mock response is CORS-valid (the app's PUT/GET carry Authorization + JSON → the
   browser preflights) and tagged x-mock so the safety net can tell a mock from a real hit. */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
  "x-mock": "1",
};

const test = base.test.extend({
  /* AUTO fail-closed safety net (findings 2/8). Runs for EVERY test in this file — even one that forgets
     `mock`. Registers an ABORT fallback on the PROD URL (a mock-less test can never reach the real
     worker) and owns the zero-REAL-request / no-pageerror / no-console-error teardown assertions. */
  _safety: [
    async ({ context, page }, use) => {
      // Fallback abort. The opt-in `mock` fixture (which DEPENDS on _safety) registers its fulfilling
      // route AFTER this one; Playwright matches routes last-registered-first, so the mock wins when
      // present. With no mock, this abort is all that remains → the request fails closed, never sent.
      await context.route(F.PROD + "/**", (route) => route.abort());
      // Hermetic: neutralize external CDN/font requests (never depended upon), mirroring ./fixtures.
      await context.route(/cdnjs\.cloudflare\.com/, (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
      await context.route(/fonts\.googleapis\.com/, (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
      await context.route(/fonts\.gstatic\.com/, (r) => r.fulfill({ status: 200, contentType: "font/woff2", body: "" }));

      const reachedReal = [], pageErrors = [], consoleErrors = [];
      page.on("response", (r) => { if (r.url().startsWith(F.PROD) && r.headers()["x-mock"] !== "1") reachedReal.push(r.url()); });
      page.on("pageerror", (e) => pageErrors.push(e.message || String(e)));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        const t = m.text();
        if (/adeptio-gantt\.pathom-bot|net::ERR|Failed to load resource|status of 4|status of 5/i.test(t)) return;
        consoleErrors.push(t);
      });

      await use();

      expect(reachedReal, `SAFETY VIOLATION: ${reachedReal.length} PROD request(s) reached the REAL worker: ${reachedReal.join(", ")}`).toEqual([]);
      expect(pageErrors, `uncaught pageerror(s): ${pageErrors.join(" | ")}`).toEqual([]);
      expect(consoleErrors, `unexpected console error(s): ${consoleErrors.join(" | ")}`).toEqual([]);
    },
    { auto: true },
  ],

  /* OPT-IN scriptable FULFILLING mock: rev/doc, failure toggles, a response gate. Depends on `_safety`
     so its route registers AFTER the abort fallback and therefore wins (never passes a request through). */
  mock: async ({ context, page, _safety }, use) => {
    const state = { rev: 1, doc: null, puts: [], gets: 0, failPut: false, failGet: false, _gate: null };
    // hold(): gate the PUT response so a push stays in-flight (pushPending latched) — for R-E4c / findings 6-7.
    state.hold = () => { let rel; state._gate = new Promise((r) => (rel = r)); return () => { state._gate = null; rel(); }; };

    const J = (obj) => ({ status: 200, headers: { ...CORS, "content-type": "application/json" }, body: JSON.stringify(obj) });
    const E = (code) => ({ status: code, headers: { ...CORS, "content-type": "application/json" }, body: '{"error":"mock"}' });

    // FULFILL — never route.continue()/route.fetch(). Any un-cased PROD path gets a benign mocked 200.
    await context.route(F.PROD + "/**", async (route) => {
      const req = route.request(), method = req.method(), url = req.url();
      if (method === "OPTIONS") return route.fulfill({ status: 204, headers: CORS, body: "" }); // CORS preflight
      if (url.includes("/api/state")) {
        if (method === "PUT") {
          state.puts.push(req.postData() || "");
          if (state._gate) await state._gate;             // keep the push in-flight until released (R-E4c / findings 6-7)
          if (state.failPut) return route.fulfill(E(500));
          state.rev += 1;
          return route.fulfill(J({ rev: state.rev }));
        }
        state.gets += 1;
        if (state.failGet) return route.fulfill(E(500));
        return route.fulfill(J({ rev: state.rev, doc: state.doc, updatedAt: new Date().toISOString() }));
      }
      return route.fulfill(J({ ok: true }));
    });

    await use(state);
  },
});

/* ------------------------------- helpers ------------------------------- */
async function open(page) {
  await seed(page, SEED_A());
  await page.goto("/#project=test-proj", { waitUntil: "domcontentloaded" });
  await page.locator("#syncChip").waitFor({ state: "attached" }); // topbar (with the chip) is up
}
// One real doc mutation through the app's ONE stamping point → schedulePush fires.
async function editModule(page, name) {
  await page.evaluate((v) => { const P = DB.projects.find((p) => p.id === PID); P.modules[0].name = v; Store.save(); }, name);
}
// Wait out the initial cloudSync seed push, then clear the PUT log for a clean per-test baseline.
async function settle(page, mock) {
  await expect.poll(() => mock.puts.length, { timeout: 5000 }).toBeGreaterThanOrEqual(1); // seed PUT received
  await expect.poll(() => page.evaluate(() => pushPending), { timeout: 5000 }).toBe(false); // and processed
  mock.puts.length = 0;
}
// Emulate document visibility (CDP-free shim) + fire the event the app listens on.
async function setHidden(page, hidden) {
  await page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test.describe("E4 — live sync (push / pull / chip / flush), mock-fulfilled", () => {
  test("(1) an edit produces a PUT within ~1s carrying the FULL doc", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    await editModule(page, "EDITED-1");
    await expect.poll(() => mock.puts.length, { timeout: 1500 }).toBeGreaterThanOrEqual(1); // 250ms debounce + request
    const body = JSON.parse(mock.puts[mock.puts.length - 1]);
    expect(body.doc, "PUT body carries the full doc under {doc}").toBeTruthy();
    expect(body.doc.projects[0].modules[0].name, "the edit rode the pushed doc").toBe("EDITED-1");
    expect(Array.isArray(body.doc.projects), "the whole project tree is pushed, not a diff").toBe(true);
  });

  test("(2) poll cadence: ~5s while visible, none while hidden, immediate on re-visible", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    // visible → at least one poll fires within ~6s (interval is 5s)
    const g0 = mock.gets;
    await expect.poll(() => mock.gets, { timeout: 8000 }).toBeGreaterThan(g0);

    // hidden → polling stops (interval cleared)
    await setHidden(page, true);
    const g1 = mock.gets;
    await page.waitForTimeout(6000);
    expect(mock.gets, "a hidden tab issues no polls").toBe(g1);

    // visible again → an immediate catch-up poll fires
    await setHidden(page, false);
    await expect.poll(() => mock.gets, { timeout: 2000 }).toBeGreaterThan(g1);
  });

  test("(3) a higher-rev remote doc is adopted: DOM + doc update, cross-device toast, undo cleared (R-E4b/R-E2a)", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    // build undo history, then make sure no push is pending (adoption requires !pushPending)
    await editModule(page, "H1");
    await editModule(page, "H2");
    expect(await page.evaluate(() => undoStack.length), "local edits populated undo").toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => pushPending), { timeout: 5000 }).toBe(false);

    // script a NEWER remote doc and trigger a background poll
    const remote = SEED_A();
    remote.projects[0].name = "REMOTE-SYNCED";
    remote.projects[0].modules[0].name = "RemoteMod";
    mock.doc = remote; mock.rev = 999;
    await page.evaluate(() => cloudPull(false));

    await expect(page.locator("#pName"), "DOM re-rendered from the adopted doc").toHaveText("REMOTE-SYNCED");
    await expect(page.locator("#toast"), "R-E4b: a background-poll adopt announces once").toHaveText("อัปเดตจากเครื่องอื่นแล้ว");
    expect(await page.evaluate(() => undoStack.length), "R-E2a: adoption clears undo").toBe(0);
    expect(await page.evaluate(() => redoStack.length), "R-E2a: adoption clears redo").toBe(0);
    expect((await readDoc(page)).projects[0].modules[0].name, "adopted doc persisted to localStorage").toBe("RemoteMod");
  });

  test("(4) a failed push flips the chip to OFFLINE; the next success restores SYNCED", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    // simulate full offline so the chip deterministically holds 'offline' (a succeeding poll would legitimately clear it)
    mock.failPut = true; mock.failGet = true;
    await editModule(page, "FAIL-1");
    await expect(page.locator("#syncChip")).toHaveClass(/offline/, { timeout: 3000 });
    await expect(page.locator("#syncChip .scLabel")).toHaveText("ออฟไลน์ · จะซิงก์อัตโนมัติ");

    // recovery: the next successful push clears offline → synced
    mock.failPut = false; mock.failGet = false;
    await editModule(page, "OK-1");
    await expect(page.locator("#syncChip")).toHaveClass(/synced/, { timeout: 3000 });
    await expect(page.locator("#syncChip .scLabel")).toContainText("ซิงก์แล้ว");
  });

  test("(R-E4c) a successful poll while a push is PENDING must NOT flip the chip to synced", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    const release = mock.hold(); // gate the PUT response → the push stays in-flight
    try {
      await editModule(page, "PENDING");
      await expect.poll(() => mock.puts.length, { timeout: 2000 }).toBeGreaterThan(0); // the PUT reached the (gated) handler
      expect(await page.evaluate(() => pushPending), "push is latched while the response is held").toBe(true);

      await page.evaluate(() => cloudPull(false)); // a poll that succeeds meanwhile
      await expect(page.locator("#syncChip"), "R-E4c: still syncing, not synced").toHaveClass(/syncing/);
      await expect(page.locator("#syncChip .scLabel")).toHaveText("กำลังซิงก์…");
    } finally {
      release(); // let the push complete
    }
    await expect(page.locator("#syncChip"), "once the push lands the chip is synced").toHaveClass(/synced/, { timeout: 3000 });
  });

  test("(R-E4a) a pending push is FLUSHED on pagehide (a PUT is issued at once)", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    // edit + pagehide in the SAME tick, before the 250ms debounce elapses → pushPending is latched, flush fires now
    await page.evaluate(() => {
      const P = DB.projects.find((p) => p.id === PID);
      P.modules[0].name = "FLUSH";
      Store.save();                                 // schedulePush → pushPending=true, 250ms timer armed
      window.dispatchEvent(new Event("pagehide"));  // flushOnExit → cancels the timer + cloudPush({keepalive:true})
    });
    await expect.poll(() => mock.puts.length, { timeout: 1500 }).toBeGreaterThan(0);
    const body = JSON.parse(mock.puts[mock.puts.length - 1]);
    expect(body.doc.projects[0].modules[0].name, "the last edit survived via the flush PUT").toBe("FLUSH");
  });

  test("(chip) shows on BOTH surfaces and reflects a successful sync", async ({ page, mock }) => {
    // project topbar
    await open(page);
    await settle(page, mock);
    await editModule(page, "PT");
    await expect(page.locator("#proj #syncChip")).toBeVisible();
    await expect(page.locator("#proj #syncChip")).toHaveClass(/synced/, { timeout: 3000 });

    // dashboard bar
    await page.evaluate(() => { location.hash = ""; route(); });
    await expect(page.locator("#dash #syncChip"), "chip present on the dashboard bar too").toBeVisible();
  });

  /* ------------- audit regressions (E4 fix worker) ------------- */

  // Finding 3 (major): a PUT that keeps FAILING while GET reads fine must not let the 5s poll pin the
  // chip green — the edit is still un-pushed. (Existing test (4) fails GET too, so it can't catch this.)
  test("(finding 3) a good poll during push-failure backoff must NOT paint the chip synced", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    mock.failPut = true;                                  // writes fail (D1 error / rate-limit); reads still succeed
    await editModule(page, "OWED");
    await expect(page.locator("#syncChip")).toHaveClass(/offline/, { timeout: 3000 });

    // a background poll now succeeds while the retry is still owed → the chip must STAY offline
    await page.evaluate(() => cloudPull(false));
    await expect(page.locator("#syncChip"), "finding 3: a succeeding GET does not clear an owed failed push").toHaveClass(/offline/);
    await expect(page.locator("#syncChip .scLabel")).toHaveText("ออฟไลน์ · จะซิงก์อัตโนมัติ");

    // recovery: once the PUT lands, the owed edit is on the server → synced
    mock.failPut = false;
    await editModule(page, "LANDED");
    await expect(page.locator("#syncChip")).toHaveClass(/synced/, { timeout: 3000 });
  });

  // Findings 1/5/9: a real tab close fires visibilitychange→hidden THEN pagehide back-to-back; the
  // one-shot flush must issue EXACTLY ONE keepalive PUT, not a duplicate whole-doc write to prod.
  test("(findings 1/5/9) tab close flushes EXACTLY ONE keepalive PUT (visibilitychange→hidden + pagehide)", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    await page.evaluate(() => {
      const P = DB.projects.find((p) => p.id === PID);
      P.modules[0].name = "ONESHOT";
      Store.save();                                       // schedulePush → pushPending latched, 250ms timer
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange")); // flushOnExit → ONE keepalive PUT
      window.dispatchEvent(new Event("pagehide"));           // flushOnExit again → must be a no-op (latched)
    });
    await expect.poll(() => mock.puts.length, { timeout: 1500 }).toBeGreaterThan(0);
    await page.waitForTimeout(400);                        // give any erroneous 2nd PUT time to arrive
    expect(mock.puts.length, "one-shot: not a duplicate ~59KB PUT / rev bump to prod").toBe(1);
    expect(JSON.parse(mock.puts[0]).doc.projects[0].modules[0].name).toBe("ONESHOT");
  });

  // Findings 6/7: a second edit landing while a push is in-flight must NOT issue a concurrent (out-of-
  // order) PUT — normal pushes are serialized — and must NOT be lost; it is re-pushed once the first
  // push completes (a 5s poll can't adopt a remote over the still-latched, un-pushed edit meanwhile).
  test("(findings 6/7) an edit queued during an in-flight push is serialized + re-pushed, never dropped", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);

    const release = mock.hold();                           // gate PUT responses → push A stays in flight
    try {
      await editModule(page, "A");
      await expect.poll(() => mock.puts.length, { timeout: 2000 }).toBe(1); // push A reached the gated handler
      expect(await page.evaluate(() => pushPending), "the un-acked edit keeps the latch set").toBe(true);

      await editModule(page, "B");                         // a newer edit lands mid-flight
      await page.waitForTimeout(600);                       // its 250ms debounce fires…
      expect(mock.puts.length, "finding 7: serialized — no overlapping/out-of-order 2nd PUT").toBe(1);
      expect(await page.evaluate(() => pushPending), "finding 6: latch stays set for the queued edit").toBe(true);
    } finally {
      release();                                           // let push A complete → the queued B is pushed
    }
    await expect.poll(() => mock.puts.length, { timeout: 3000 }).toBe(2);
    expect(JSON.parse(mock.puts[1]).doc.projects[0].modules[0].name, "finding 6: the mid-flight edit rode the trailing push, not dropped").toBe("B");
    await expect(page.locator("#syncChip")).toHaveClass(/synced/, { timeout: 3000 });
  });

  // Finding 4: a poll that OBSERVES a strictly-newer remote but must DEFER adoption (user mid-edit)
  // is NOT an up-to-date tick — it must not re-stamp lastSyncAt / claim a fresh 'synced'.
  test("(finding 4) a poll deferring a newer remote does not re-stamp a false 'synced'", async ({ page, mock }) => {
    await open(page);
    await settle(page, mock);
    await page.evaluate(() => stopPoll());                 // drive polls explicitly — no background interval racing this

    const t0 = await page.evaluate(() => lastSyncAt);
    await page.waitForTimeout(25);                          // ensure the clock would move if wrongly restamped

    const remote = SEED_A(); remote.projects[0].name = "NEWER-DEFER";
    mock.doc = remote; mock.rev = 999;
    await page.evaluate(() => { el("modalRoot").style.display = "block"; }); // editingNow() → true (adoption defers)
    await page.evaluate(() => cloudPull(false));

    await expect(page.locator("#pName"), "adoption correctly deferred while mid-edit").not.toHaveText("NEWER-DEFER");
    const t1 = await page.evaluate(() => lastSyncAt);
    expect(t1, "finding 4: a deferred-newer-remote poll leaves lastSyncAt untouched (no false fresh-sync)").toBe(t0);

    await page.evaluate(() => { el("modalRoot").style.display = "none"; }); // clear editing state before teardown
  });
});
