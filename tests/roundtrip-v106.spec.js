// @ts-check
/* E3 — structured spreadsheet round-trip (SPEC_v1.0.6 §4 + R-E3a..d).
 *
 * The app depends on the real SheetJS (XLSX) for BOTH read and write. In production that lib comes
 * from the cdnjs <script> tag in index.html; the shared fixture neutralizes cdnjs to an empty 200 for
 * hermeticity, so we inject the SAME lib/version (xlsx 0.18.5, a pinned devDependency) into the page
 * with addScriptTag — no network. Buffers are GENERATED IN-PAGE via XLSX.write({type:"array"}) and fed
 * straight to importWorkbook (never a real file / real network), exactly how exportXlsx works in prod.
 *
 * `proj/DB/PID/Store/undoStack/undo/importWorkbook/timelineWorkbook/XLSX/el/ui` are all reachable by
 * BARE name inside page.evaluate (the global-lexical trick the E1/E2 suites use).
 *
 * Host-block + zero-prod-request + pageerror/console guards are auto from ./fixtures. */
const {
  test, expect, openProject, readDoc,
  docFindNode, docFindByName, docParentOf, docCountFeatures, docCountContainers,
} = require("./fixtures");

const XLSX_PATH = require.resolve("xlsx/dist/xlsx.full.min.js");

/* Inject the real SheetJS into the page (no network). Must run AFTER the page has loaded. */
async function loadXlsx(page) {
  await page.addScriptTag({ path: XLSX_PATH });
  await page.waitForFunction(() => typeof window.XLSX !== "undefined" && !!(window.XLSX && window.XLSX.utils));
}

/* ---- v2 (tree-shaped) doc builders — the app stores this shape directly (docVer 2). ---- */
function feat(id, name, o = {}) {
  return {
    id, kind: "feature", fid: o.fid || "", name, description: o.description || "",
    start: o.start || "2026-07-01", end: o.end || "2026-07-15",
    status: o.status || "not_started", remark: o.remark || "", custom: o.custom || {},
  };
}
function cont(id, name, o = {}) {
  const n = { id, kind: "container", name, description: o.description || "", color: o.color == null ? 0 : o.color, collapsed: !!o.collapsed, children: o.children || [] };
  if (o.kpi) n.kpi = o.kpi;
  if (o.hideProgress != null) n.hideProgress = o.hideProgress;
  return n;
}
function mkV2Doc(modules, customCols = []) {
  const cKeys = customCols.map((c) => "c:" + c.id);
  return {
    projects: [{
      id: "test-proj", name: "RT Project", client: "QA", code: "RT", color: 0,
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
      customCols, colOrder: ["name", "description", "start", "end", "status", "remark", ...cKeys],
      progressOrder: modules.map((m) => m.id),
      summary: { current: { id: "sum-cur", date: "2026-01-01", text: "" }, history: [] },
      modules, docVer: 2,
    }],
  };
}

/* Build a workbook IN-PAGE from an array-of-arrays and drive importWorkbook with its buffer. Opens the
   preview modal (or, on zero-yield, toasts). Returns nothing — caller confirms/cancels + inspects. */
async function importAOA(page, aoa) {
  await page.evaluate((rows) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timeline");
    window.__buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    importWorkbook(window.__buf);
  }, aoa);
}
async function previewWarnings(page) {
  return page.$$eval(".impWarns li", (els) => els.map((e) => e.textContent.trim()));
}
const confirmImport = (page) => page.locator("#imp_confirm").click();

const H = ["Type", "Level", "Node ID", "Feature ID", "Name", "Description", "Start", "End", "Status", "Remark", "Color"];

test.describe("E3 — structured spreadsheet round-trip", () => {
  test("(a) export → re-import the SAME workbook → tree deep-equals + kpi/hideProgress/collapsed carried", async ({ page }) => {
    const owner = { id: "owner", label: "Owner", w: 130, kind: "text" };
    const doc = mkV2Doc([
      cont("m-alpha", "Alpha", {
        color: 0, hideProgress: false, collapsed: false,
        kpi: { target: 80, actual: 50, state: "auto", detail: "d", remark: "r" },
        children: [
          feat("fa1", "Alpha One", { fid: "F1", start: "2026-07-01", end: "2026-07-10", status: "in_progress", remark: "go", custom: { owner: "Alice" } }),
          cont("m-a-sub", "Alpha Sub", {
            color: 6, collapsed: true, kpi: { target: 40, actual: 10, state: "auto", detail: "", remark: "" },
            children: [feat("fs1", "Sub One", { start: "2026-07-05", end: "2026-07-20", status: "done", custom: { owner: "Bob" } })],
          }),
          // fa2 sits AFTER the sub-container among Alpha's children — the ordering that proves a feature's own
          // Level is honoured on import. Before the fix, import ignored feature Level and attached to the deepest
          // open container (Alpha Sub), silently re-nesting fa2 one level too deep and breaking the deep-equals.
          feat("fa2", "Alpha Two", { fid: "F2", start: "2026-07-11", end: "2026-07-18", status: "not_started", custom: { owner: "Carol" } }),
        ],
      }),
      cont("m-beta", "Beta", {
        color: 1, hideProgress: false, collapsed: false,
        kpi: { target: 60, actual: 60, state: "auto", detail: "", remark: "" },
        // fb1 has a SPARSE custom map (the Owner column exists project-wide but this feature holds no value).
        // The round-trip must NOT densify it to { owner: "" }, or both the deep-equals AND the no-wasted-undo-slot
        // guarantee below break.
        children: [feat("fb1", "Beta One", { start: "2026-08-01", end: "2026-08-15", status: "at_risk" })],
      }),
    ], [owner]);

    await openProject(page, doc);
    await loadXlsx(page);

    const before = await page.evaluate(() => JSON.parse(JSON.stringify(proj())));

    // export the live tree to a workbook, then re-import that exact buffer
    await page.evaluate(() => { window.__buf = XLSX.write(timelineWorkbook(proj()), { type: "array", bookType: "xlsx" }); importWorkbook(window.__buf); });
    await expect(page.locator("#imp_confirm")).toBeVisible();
    await confirmImport(page);

    const after = await page.evaluate(() => JSON.parse(JSON.stringify(proj())));

    // full structural fidelity: ids, nesting, names, descriptions, colours, dates, status, remark, customs
    expect(after.modules, "tree deep-equals after a same-workbook round-trip").toEqual(before.modules);
    expect(after.customCols, "custom columns reused by label (id/w/kind kept)").toEqual(before.customCols);
    expect(after.colOrder).toEqual(before.colOrder);

    // explicit carry-over (R-E3b): the sheet carries none of these — only Node-ID match restores them
    const persisted = await readDoc(page);
    const sub = docFindNode(persisted, "m-a-sub");
    expect(sub, "nested container survived by id").not.toBeNull();
    expect(sub.collapsed, "collapsed carried from the pre-import node").toBe(true);
    expect(docFindNode(persisted, "m-alpha").kpi.target, "kpi carried").toBe(80);
    expect(docFindNode(persisted, "m-beta").kpi.actual, "kpi carried").toBe(60);
    // sheet-carried fields round-tripped
    expect(docFindNode(persisted, "m-a-sub").color, "colour round-tripped via the Color column").toBe(6);
    expect(docFindNode(persisted, "fa1").custom.owner, "custom value round-tripped").toBe("Alice");
    expect(docFindNode(persisted, "fa1").status).toBe("in_progress");
    expect(docParentOf(persisted, "m-a-sub").id, "nesting preserved by Level").toBe("m-alpha");
    // finding: the feature AFTER the sub-container re-nests to its own Level (2 → Alpha), not the deepest container
    expect(docParentOf(persisted, "fa2").id, "post-sub-container feature honours its Level").toBe("m-alpha");
    expect(docFindNode(persisted, "fa2").custom.owner, "its custom value round-tripped").toBe("Carol");
    // finding: a sparse feature stays sparse — no densified empty custom keys
    expect(docFindNode(persisted, "fb1").custom, "sparse custom map is not densified to { owner: '' }").toEqual({});

    // a LOSSLESS round-trip is a content no-op → E2's updatedAt-stripped dirty-check spends NO undo slot
    // (the "one undo step for a real replace" guarantee is asserted in test (f), where the tree changes).
    expect(await page.evaluate(() => undoStack.length), "lossless re-import is a no-op — no wasted undo slot").toBe(0);
  });

  test("(b) hand-mangled workbook imports with R-E3a tolerances + warnings surfaced in the preview", async ({ page }) => {
    await openProject(page, mkV2Doc([cont("seed", "Seed", { children: [feat("sf", "Seed Feat")] })]));
    await loadXlsx(page);

    const aoa = [
      H,
      ["Feature", 1, "orphan", "", "Orphan Feat", "", "2026-01-01", "2026-01-05", "Not Started", "", ""], // no container above → recovery
      ["Module", 1, "cA", "", "Container A", "", "", "", "", "", 2],
      ["Feature", 2, "fA1", "F1", "Feat A1", "", "2569-03-01", "2569-03-10", "In Progress", "", ""], // BE year → 2026
      ["Module", 3, "cB", "", "Container B", "", "", "", "", "", 3], // level jump (stack depth 1, L3) → clamp to 2 (child of A)
      ["", "", "", "", "Appended Feature", "", "2026-04-01", "2026-04-05", "Done", "", ""], // blank Type + Name → feature (under B)
      ["Feature", 2, "fA1", "DUP", "Dup Id Feat", "", "2026-05-01", "2026-05-02", "Not Started", "", ""], // dup Node ID → mint
      ["Feature", 2, "fEnd", "", "Bad Dates", "", "2026-06-10", "2026-06-01", "", "", ""], // end < start → clamp
    ];
    await importAOA(page, aoa);
    await expect(page.locator("#imp_confirm")).toBeVisible();

    const warns = await previewWarnings(page);
    expect(warns.some((w) => w.includes("(นำเข้า)")), "orphan-feature recovery warned").toBe(true);
    expect(warns.some((w) => /level ข้ามขั้น.*ระดับ 2/.test(w)), "level-jump clamp warned").toBe(true);
    expect(warns.some((w) => w.includes("Node ID ซ้ำ")), "duplicate Node ID warned").toBe(true);
    expect(warns.some((w) => w.includes("วันสิ้นสุดก่อนวันเริ่ม")), "end<start warned").toBe(true);

    await confirmImport(page);
    const doc = await readDoc(page);

    // 3 containers: (นำเข้า) recovery + A + B ; 5 features
    expect(docCountContainers(doc)).toBe(3);
    expect(docCountFeatures(doc)).toBe(5);
    // level-jump clamp: B nested under A (not a root)
    expect(docParentOf(doc, "cB"), "Container B clamped under A").not.toBeNull();
    expect(docParentOf(doc, "cB").id).toBe("cA");
    // BE-year date normalized to CE
    expect(docFindNode(doc, "fA1").start).toBe("2026-03-01");
    expect(docFindNode(doc, "fA1").end).toBe("2026-03-10");
    // end<start clamped
    const bad = docFindByName(doc, "Bad Dates");
    expect(bad.end).toBe(bad.start);
    expect(bad.start).toBe("2026-06-10");
    // blank-Type row became a feature under B
    const appended = docFindByName(doc, "Appended Feature");
    expect(appended.kind).toBe("feature");
    expect(docParentOf(doc, appended.id).id).toBe("cB");
    // dup Node ID minted a fresh id (only the first "fA1" keeps it)
    expect(docFindByName(doc, "Dup Id Feat").id).not.toBe("fA1");
    // orphan recovered into the auto "(นำเข้า)" container at root
    const rec = docFindByName(doc, "(นำเข้า)");
    expect(rec, "recovery container created").not.toBeNull();
    expect(docParentOf(doc, rec.id), "recovery is a root container").toBeNull();
    expect(docParentOf(doc, docFindByName(doc, "Orphan Feat").id).id).toBe(rec.id);
  });

  test("(c) legacy flat headers still import (through the same preview)", async ({ page }) => {
    await openProject(page, mkV2Doc([cont("seed", "Seed", { children: [feat("sf", "Seed Feat")] })]));
    await loadXlsx(page);

    const aoa = [
      ["Module", "Feature", "Start", "End", "Status"],
      ["Payments", "Checkout", "2026-02-01", "2026-02-10", "In Progress"],
      ["Payments", "Refund", "2026-02-05", "2026-02-15", "Not Started"],
      ["Reporting", "Dashboard", "2026-03-01", "2026-03-20", "Done"],
    ];
    await importAOA(page, aoa);
    await expect(page.locator("#imp_confirm"), "legacy path routes through the preview (R-E3d)").toBeVisible();
    await confirmImport(page);

    const doc = await readDoc(page);
    expect(docCountContainers(doc)).toBe(2);
    expect(docCountFeatures(doc)).toBe(3);
    const pay = docFindByName(doc, "Payments");
    expect(pay.children.filter((c) => c.kind === "feature").length).toBe(2);
    expect(docFindByName(doc, "Checkout").status).toBe("in_progress");
    expect(docFindByName(doc, "Dashboard").status).toBe("done");
  });

  test("(d) legacy Module path 'A › B' nests into containers (R-E3d upgrade)", async ({ page }) => {
    await openProject(page, mkV2Doc([cont("seed", "Seed", { children: [feat("sf", "Seed Feat")] })]));
    await loadXlsx(page);

    const aoa = [
      ["Module", "Feature", "Start", "End"],
      ["Core › Auth", "Login", "2026-01-01", "2026-01-05"],
      ["Core › Auth", "Logout", "2026-01-06", "2026-01-08"],
      ["Core › Billing", "Invoice", "2026-02-01", "2026-02-10"],
    ];
    await importAOA(page, aoa);
    await confirmImport(page);

    const doc = await readDoc(page);
    const core = docFindByName(doc, "Core");
    expect(core, "Core root container created from the path head").not.toBeNull();
    expect(docParentOf(doc, core.id), "Core is a root").toBeNull();
    const auth = docFindByName(doc, "Auth"), billing = docFindByName(doc, "Billing");
    expect(docParentOf(doc, auth.id).id, "Auth nested under Core").toBe(core.id);
    expect(docParentOf(doc, billing.id).id, "Billing nested under Core").toBe(core.id);
    expect(docParentOf(doc, docFindByName(doc, "Login").id).id, "Login under Auth").toBe(auth.id);
    // Core (a pure path container) holds no direct features — only the two sub-containers
    expect(core.children.every((c) => c.kind === "container")).toBe(true);
  });

  test("(e) preview cancel → doc byte-identical, no mutation", async ({ page }) => {
    await openProject(page, mkV2Doc([
      cont("m1", "Mod One", { color: 2, children: [feat("f1", "Feat One", { start: "2026-05-01", end: "2026-05-09" })] }),
    ]));
    await loadXlsx(page);

    const beforeMem = await page.evaluate(() => JSON.stringify(DB));
    const beforeLs = JSON.stringify(await readDoc(page));

    await page.evaluate(() => { window.__buf = XLSX.write(timelineWorkbook(proj()), { type: "array", bookType: "xlsx" }); importWorkbook(window.__buf); });
    await expect(page.locator("#imp_confirm")).toBeVisible();
    await page.locator("#imp_cancel").click();
    await expect(page.locator(".modal")).toHaveCount(0); // modal closed

    expect(await page.evaluate(() => JSON.stringify(DB)), "in-memory doc untouched by parse+cancel").toBe(beforeMem);
    expect(JSON.stringify(await readDoc(page)), "persisted doc untouched").toBe(beforeLs);
    expect(await page.evaluate(() => undoStack.length), "cancel spends no undo slot").toBe(0);
  });

  test("(f) preview confirm applies as exactly ONE undo step that restores the pre-import doc", async ({ page }) => {
    await openProject(page, mkV2Doc([
      cont("m1", "Mod One", { color: 2, children: [feat("f1", "Feat One", { start: "2026-05-01", end: "2026-05-09" })] }),
    ]));
    await loadXlsx(page);

    const beforeMods = await page.evaluate(() => JSON.stringify(proj().modules));
    const u0 = await page.evaluate(() => undoStack.length);

    // import a DIFFERENT structure so the mutation is real
    const aoa = [
      H,
      ["Module", 1, "n1", "", "New Mod", "", "", "", "", "", 4],
      ["Feature", 2, "nf1", "X1", "New Feat", "", "2026-09-01", "2026-09-10", "Blocked", "", ""],
    ];
    await importAOA(page, aoa);
    await confirmImport(page);

    expect(await page.evaluate(() => undoStack.length), "the whole replace is ONE undo step").toBe(u0 + 1);
    expect(await page.evaluate(() => JSON.stringify(proj().modules)), "import actually changed the tree").not.toBe(beforeMods);
    expect((await readDoc(page)).projects[0].modules.some((m) => m.name === "New Mod")).toBe(true);

    await page.evaluate(() => undo());
    expect(await page.evaluate(() => JSON.stringify(proj().modules)), "one undo restores the exact pre-import tree").toBe(beforeMods);
    expect(await page.evaluate(() => undoStack.length)).toBe(u0);
  });

  test("(g) zero-yield workbook → toast, NO preview modal (R-E3c)", async ({ page }) => {
    await openProject(page, mkV2Doc([cont("m1", "Mod One", { children: [feat("f1", "Feat One")] })]));
    await loadXlsx(page);

    // structured header, but every data row is blank (blank Type + blank Name → skipped)
    const aoa = [
      ["Type", "Level", "Node ID", "Name", "Start", "End", "Status"],
      ["", "", "", "", "", "", ""],
      ["", "", "", "", "", "", ""],
    ];
    await importAOA(page, aoa);

    await expect(page.locator(".modal"), "no preview opens on a zero-yield parse").toHaveCount(0);
    await expect(page.locator("#imp_confirm")).toHaveCount(0);
    await expect(page.locator("#toast")).toContainText("ไม่พบข้อมูลที่นำเข้าได้");
    // doc untouched
    expect((await readDoc(page)).projects[0].modules.length).toBe(1);
  });

  test("(h) import mints a NEW custom column (§4.3), lists it in the preview (§4.4), and leaves empty cells sparse", async ({ page }) => {
    // seed already owns "Owner"; the import adds a second column, "Priority", that isn't a project column yet
    await openProject(page, mkV2Doc(
      [cont("seed", "Seed", { children: [feat("sf", "Seed Feat", { custom: { owner: "Z" } })] })],
      [{ id: "owner", label: "Owner", w: 130, kind: "text" }],
    ));
    await loadXlsx(page);

    const aoa = [
      [...H, "Owner", "Priority"],
      ["Module", 1, "cN", "", "New Mod", "", "", "", "", "", 0, "", ""],
      ["Feature", 2, "fWith", "", "Has Pri", "", "2026-09-01", "2026-09-05", "Not Started", "", "", "Alice", "High"],
      ["Feature", 2, "fNone", "", "No Pri", "", "2026-09-06", "2026-09-10", "Not Started", "", "", "", ""], // both custom cells blank → sparse
    ];
    await importAOA(page, aoa);
    await expect(page.locator("#imp_confirm")).toBeVisible();

    // §4.4 preview surfaces the freshly-minted column as a "new" tag and the reused one as a plain tag
    const newTags = await page.$$eval(".impCols .tag.new", (els) => els.map((e) => e.textContent.trim()));
    expect(newTags, "preview lists the freshly-minted column").toContain("Priority");
    const reusedTags = await page.$$eval(".impCols .tag:not(.new)", (els) => els.map((e) => e.textContent.trim()));
    expect(reusedTags, "preview lists the reused column").toContain("Owner");

    await confirmImport(page);
    const after = await page.evaluate(() => JSON.parse(JSON.stringify(proj())));

    // a new col minted with the §4.3 defaults (kind text, width 150); the existing Owner col reused by id
    const pri = after.customCols.find((c) => c.label === "Priority");
    expect(pri, "Priority column created").toBeTruthy();
    expect(pri.kind).toBe("text");
    expect(pri.w).toBe(150);
    expect(after.customCols.some((c) => c.id === "owner"), "existing Owner col reused by id").toBe(true);
    // colOrder: reused col before the fresh col, fresh appended last (build() reconstruction)
    expect(after.colOrder.indexOf("c:owner")).toBeLessThan(after.colOrder.indexOf("c:" + pri.id));
    expect(after.colOrder[after.colOrder.length - 1]).toBe("c:" + pri.id);

    // values: the feature with a Priority cell carries it; the empty-cell feature keeps a sparse map (finding)
    const doc = await readDoc(page);
    const has = docFindNode(doc, "fWith"), none = docFindNode(doc, "fNone");
    expect(has.custom[pri.id]).toBe("High");
    expect(has.custom.owner).toBe("Alice");
    expect(none.custom, "feature with empty custom cells keeps a sparse map").toEqual({});
  });

  test("(i) a custom column whose label collides with a reserved alias survives the round-trip (no silent drop)", async ({ page }) => {
    // "Notes" is a Remark alias; before the fix the exported custom "Notes" header re-imported as the fixed
    // Remark key (already claimed) and the whole column + all its per-feature values vanished silently.
    const notes = { id: "cnotes", label: "Notes", w: 140, kind: "text" };
    await openProject(page, mkV2Doc(
      [cont("m1", "Mod", { children: [feat("f1", "Feat", { remark: "real remark", custom: { cnotes: "my note" } })] })],
      [notes],
    ));
    await loadXlsx(page);

    const before = await page.evaluate(() => JSON.parse(JSON.stringify(proj())));
    await page.evaluate(() => { window.__buf = XLSX.write(timelineWorkbook(proj()), { type: "array", bookType: "xlsx" }); importWorkbook(window.__buf); });
    await expect(page.locator("#imp_confirm")).toBeVisible();
    await confirmImport(page);
    const after = await page.evaluate(() => JSON.parse(JSON.stringify(proj())));

    expect(after.customCols, "the alias-colliding custom column is NOT dropped").toEqual(before.customCols);
    const f1 = docFindNode(await readDoc(page), "f1");
    expect(f1.custom.cnotes, "custom 'Notes' value preserved").toBe("my note");
    expect(f1.remark, "the fixed Remark column value stays distinct from the custom 'Notes' column").toBe("real remark");
    expect(after.modules, "full tree still round-trips losslessly").toEqual(before.modules);
  });

  test("(j) reordered sheets (Info before Timeline) still import — the Timeline sheet is located by name", async ({ page }) => {
    await openProject(page, mkV2Doc([cont("seed", "Seed", { children: [feat("sf", "Seed Feat")] })]));
    await loadXlsx(page);

    const tl = [
      H,
      ["Module", 1, "rM", "", "Reordered Mod", "", "", "", "", "", 1],
      ["Feature", 2, "rF", "", "Reordered Feat", "", "2026-10-01", "2026-10-05", "Done", "", ""],
    ];
    // 2-sheet workbook with Info FIRST and Timeline SECOND (a user dragging tabs in Excel/Numbers/Sheets)
    await page.evaluate((rows) => {
      const info = XLSX.utils.aoa_to_sheet([["Adeptio Gantt — Timeline"], ["Project", "RT"], ["Client", "QA"], ["Code", "RT"]]);
      const t = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, info, "Info");
      XLSX.utils.book_append_sheet(wb, t, "Timeline");
      importWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    }, tl);

    await expect(page.locator("#imp_confirm"), "import locates the Timeline sheet despite Info being sheet 0").toBeVisible();
    await confirmImport(page);

    const doc = await readDoc(page);
    expect(docFindByName(doc, "Reordered Mod"), "structured Timeline sheet parsed after reorder").not.toBeNull();
    expect(docFindByName(doc, "Reordered Feat").status).toBe("done");
  });

  test("(k) §4.3: an existing custom column absent from the file is NAMED in the preview, then dropped on confirm", async ({ page }) => {
    const owner = { id: "owner", label: "Owner", w: 130, kind: "text" };
    const doc = mkV2Doc(
      [cont("m-k", "Kappa", { children: [feat("fk1", "Kappa One", { custom: { owner: "Alice" } })] })],
      [owner],
    );
    await openProject(page, doc);
    await loadXlsx(page);

    // structured file WITHOUT the Owner column — the user deleted it in Excel
    await importAOA(page, [
      H, // no custom headers at all
      ["Module", 1, "m-k", "", "Kappa", "", "", "", "", "", 0],
      ["Feature", 2, "fk1", "", "Kappa One", "", "2026-07-01", "2026-07-15", "Not Started", "", ""],
    ]);

    // preview names the doomed column with the .drop tag — the removal is a shown decision, not a surprise
    await expect(page.locator("#imp_confirm")).toBeVisible();
    await expect(page.locator(".impCols .tag.drop"), "dropped column named in the preview").toHaveText("Owner");

    await confirmImport(page);
    const after = await readDoc(page);
    const P = after.projects.find((p) => p.id === "test-proj");
    expect(P.customCols, "confirm removes the absent custom column").toEqual([]);
    expect(P.colOrder.some((k) => k === "c:owner"), "colOrder no longer references the dropped col").toBe(false);
  });
});
