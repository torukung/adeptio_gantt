// v1.0.5 F1 — last-edit timestamps ("แก้ไขล่าสุด") + F0 dual-write mirror removal.
// Reuses ./fixtures so the production-Worker block + pageerror/console guards are
// unconditional (see fixtures.js). Spec: docs/SPEC_v1.0.5.md §2–§3, §5 (T-F0, T-F1a/b/c).
//
// F1 stamping point is Store.save() (app.js ~195): DB.updatedAt=nowIso() and, when a
// project is open, proj().updatedAt=nowIso(). UI-only state (theme via saveUi, zoom via
// applyZoom→saveUi) writes LS_UI, never the doc, so it must NOT stamp. fmtStamp() renders
// legacy date-only "YYYY-MM-DD" as DD/MM/YYYY (no time) and full ISO as DD/MM/YYYY HH:mm.
const {
  test, expect,
  SEED_A, SEED_B,
  seed, openProject, openTimeline,
  readDoc, docFindNode,
} = require("./fixtures");

// recursive walk of the (tree) module list — Node side (doc is a plain object)
function walkNodes(ns, cb) { (ns || []).forEach((n) => { if (!n) return; cb(n); if (n.children) walkNodes(n.children, cb); }); }

/* ============================ F0 — dual-write mirror removed ============================ */
test.describe("T-F0 — mirror removed on save + v1-shape doc still migrates", () => {
  test("T-F0 saved v2 doc has NO features key on any container; a v1-shape doc migrates to docVer 2 tree", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // force an explicit Store.save() (collapse toggle → apply() → save). v1.0.4 wrote the mirror here.
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click();
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click(); // expand back

    const doc = await readDoc(page);
    const offenders = [];
    walkNodes(doc.projects[0].modules, (n) => { if (n.kind === "container" && "features" in n) offenders.push(n.id); });
    expect(offenders, "no container should carry a features[] mirror key after save").toEqual([]);

    // A v1-shape project (flat modules with features[]/parentId, NO kind, NO docVer) still migrates on
    // the LOAD path (migrateDB → migrateDoc). This is the read-path guard §2 keeps UNTOUCHED.
    const mig = await page.evaluate(() => {
      const d = { projects: [{
        id: "v1p", name: "V1", client: "QA", code: "V1", color: 0,
        createdAt: "2026-01-01", updatedAt: "2026-01-01",
        summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
        modules: [
          { id: "m1", name: "M1", color: 0, collapsed: false, parentId: null,
            features: [{ id: "f1", name: "F1", start: "2026-07-01", end: "2026-07-05", status: "not_started", custom: {} }] },
          { id: "m1s", name: "M1 Sub", color: 6, collapsed: false, parentId: "m1",
            features: [{ id: "fs", name: "Sub Feat", start: "2026-07-02", end: "2026-07-06", status: "done", custom: {} }] },
        ],
      }] };
      window.migrateDB(d);
      const p = d.projects[0];
      return {
        docVer: p.docVer,
        rootKinds: p.modules.map((n) => n.kind),
        m1Kind: p.modules[0].kind,
        m1ChildNames: (p.modules[0].children || []).map((c) => c.name),
        m1ChildKinds: (p.modules[0].children || []).map((c) => c.kind),
        m1HasFeaturesKey: "features" in p.modules[0],
      };
    });
    expect(mig.docVer, "v1-shape project migrates to docVer 2").toBe(2);
    expect(mig.rootKinds.every((k) => k === "container"), "every root becomes a container").toBe(true);
    expect(mig.m1Kind).toBe("container");
    // §2 order: the module's own features become children FIRST, then its parentId-children.
    expect(mig.m1ChildNames).toEqual(["F1", "M1 Sub"]);
    expect(mig.m1ChildKinds).toEqual(["feature", "container"]);
    expect(mig.m1HasFeaturesKey, "features[] is consumed by the lift, not left dangling").toBe(false);
  });
});

/* ============================ F1a — an edit stamps a full ISO ============================ */
test.describe("T-F1a — a doc edit stamps a full-ISO last-edit datetime", () => {
  test("T-F1a editing a feature name → updatedAt is full ISO near now; card + status header render DD/MM/YYYY HH:mm", async ({ page }) => {
    await openTimeline(page, SEED_A());

    // EDIT a feature name (a genuine information edit) → blur → apply() → Store.save() → stamp.
    const txt = page.locator('#leftBody .featRow[data-nid="fa1"] .cell.feat .txt');
    await txt.fill("Alpha One EDITED");
    await txt.evaluate((el) => el.blur());
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").name)).toBe("Alpha One EDITED");

    const upd = (await readDoc(page)).projects[0].updatedAt;
    expect(upd, "updatedAt upgraded to a full ISO datetime").toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Math.abs(Date.now() - Date.parse(upd)), "stamp is 'now' (within 2 min)").toBeLessThan(120000);

    // the rendered stamp is DD/MM/YYYY HH:mm (24h, local)
    const fmt = await page.evaluate((s) => window.fmtStamp(s), upd);
    expect(fmt, "full-ISO stamp renders with a time component").toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

    // Project Status header #statusStamp (switch to summary tab — no save on tab render)
    await page.locator('.tabBtn[data-tab="summary"]').click();
    await expect(page.locator("#statusStamp")).toHaveText("แก้ไขล่าสุด " + fmt);

    // Dashboard card .lastEdit (reload → dashboard reads the persisted stamp)
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator('.card[data-open="test-proj"]').waitFor();
    await expect(page.locator('.card[data-open="test-proj"] .lastEdit')).toHaveText("แก้ไขล่าสุด " + fmt);
  });
});

/* ============================ F1b — UI-only changes do NOT stamp ============================ */
test.describe("T-F1b — theme + zoom are UI-only (never touch the doc)", () => {
  test("T-F1b switching theme and zooming leave updatedAt unchanged; a real edit still stamps", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const before = (await readDoc(page)).projects[0].updatedAt;

    // UI-only: theme segmented control (setTheme → saveUi, writes LS_UI) …
    await page.locator('[data-theme-set="dark"]').click();
    await page.locator('[data-theme-set="light"]').click();
    // … and zoom +/− (applyZoom → saveUi, writes LS_UI)
    await page.locator("#zoomIn").click();
    await page.locator("#zoomOut").click();

    const after = (await readDoc(page)).projects[0].updatedAt;
    expect(after, "UI-only theme/zoom changes must NOT re-stamp the doc").toBe(before);

    // De-vacuity: a genuine doc mutation DOES change it (so the equality above is meaningful).
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click(); // collapse toggle → Store.save()
    await expect.poll(() => readDoc(page).then((d) => d.projects[0].updatedAt)).not.toBe(before);
  });
});

/* ============================ F1c — legacy date-only renders cleanly ============================ */
test.describe("T-F1c — a legacy date-only updatedAt renders without time or NaN", () => {
  test("T-F1c '2026-01-01' → '01/01/2026' (no HH:mm, no NaN) on the card AND the status header", async ({ page }) => {
    // SEED_A ships updatedAt:"2026-01-01" (date-only). Do NOT trigger any save (staying on
    // dashboard / summary never calls Store.save), so the legacy value is preserved for display.
    await openProject(page, SEED_A()); // lands on the Project Status (summary) tab

    const statusText = await page.locator("#statusStamp").textContent();
    expect(statusText).toBe("แก้ไขล่าสุด 01/01/2026");
    expect(statusText).not.toContain(":");   // no time component
    expect(statusText).not.toContain("NaN");

    // Dashboard card renders the same date-only stamp
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator('.card[data-open="test-proj"]').waitFor();
    const cardText = await page.locator('.card[data-open="test-proj"] .lastEdit').textContent();
    expect(cardText).toBe("แก้ไขล่าสุด 01/01/2026");
    expect(cardText).not.toContain(":");
    expect(cardText).not.toContain("NaN");
  });
});
