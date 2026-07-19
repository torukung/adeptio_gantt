// v1.0.4 core-tree (Stage 1): migration (v1 flat + parentId → recursive node tree),
// normalizeTree invariants, dual-write mirror, data-nid addressing, and pane alignment
// after every mutation class. Reuses ./fixtures so the production-Worker block +
// pageerror/console guards are unconditional (see fixtures.js).
const {
  test, expect,
  SEED_A, SEED_B,
  seed, openProject, openTimeline,
  readDoc, assertAligned,
  gridModNames, gridFeatNames,
  clickModAct, dragFeature,
  docFindNode, docParentOf,
} = require("./fixtures");

// Real production snapshot copy (tests/data/ is gitignored — real client data, never committed).
// If the copy is absent (fresh clone), the snapshot test skips rather than hard-failing.
let PROD_SNAP = null;
try { PROD_SNAP = require("./data/prod_snapshot_copy.json"); } catch (e) { PROD_SNAP = null; }

/* ============================ MIGRATION ============================ */
test.describe("migration — v1 flat → recursive tree (idempotent)", () => {
  test("(a) a v1 seed doc (no subs) migrates to docVer 2; counts preserved; idempotent", async ({ page }) => {
    await openTimeline(page, SEED_A());

    // the live in-memory project is migrated
    const proj = await page.evaluate(() => JSON.parse(JSON.stringify(window.proj())));
    expect(proj.docVer).toBe(2);
    expect(proj.modules.every((n) => n.kind === "container")).toBe(true); // root holds containers only
    // rendered: 3 containers, 5 features
    await expect(page.locator("#leftBody .modRow")).toHaveCount(3);
    await expect(page.locator("#rowsLayer .bar")).toHaveCount(5);
    await assertAligned(page, "seed migrated");

    // migrateDoc idempotency on the RAW v1 doc, run entirely in-page
    const idem = await page.evaluate((doc) => {
      const cf = (ns) => { let k = 0; (ns || []).forEach((n) => { if (n && n.kind === "feature") k++; else if (n && n.children) k += cf(n.children); }); return k; };
      const cc = (ns) => { let k = 0; (ns || []).forEach((n) => { if (n && n.kind === "container") { k++; k += cc(n.children); } }); return k; };
      const p = doc.projects[0];
      window.migrateDoc(p); const first = JSON.stringify(p);
      window.migrateDoc(p); const second = JSON.stringify(p);
      return { docVer: p.docVer, containers: cc(p.modules), features: cf(p.modules), first, second };
    }, SEED_A());
    expect(idem.docVer).toBe(2);
    expect(idem.containers).toBe(3);
    expect(idem.features).toBe(5);
    expect(idem.second).toBe(idem.first); // migrating an already-migrated project is a structural no-op
  });

  test("(b) a v1 doc WITH parentId subs migrates to NESTED containers (features first, then subs)", async ({ page }) => {
    await openTimeline(page, SEED_B());

    const proj = await page.evaluate(() => JSON.parse(JSON.stringify(window.proj())));
    expect(proj.docVer).toBe(2);
    expect(proj.modules.map((m) => m.name)).toEqual(["Alpha", "Beta"]); // roots only

    // §2 order: each root's features become children FIRST, then its parentId-children
    const alpha = proj.modules[0];
    expect(alpha.children.map((c) => c.name)).toEqual(["Alpha One", "Alpha Two", "Alpha Sub One", "Alpha Sub Two"]);
    expect(alpha.children.map((c) => c.kind)).toEqual(["feature", "feature", "container", "container"]);

    const doc = { projects: [proj] };
    expect(docParentOf(doc, "m-a-sub1").id).toBe("m-alpha");
    expect(docParentOf(doc, "m-a-sub2").id).toBe("m-alpha");
    expect(docParentOf(doc, "m-b-sub1").id).toBe("m-beta");

    // 5 containers (2 roots + 3 subs), 6 features — all rendered
    await expect(page.locator("#leftBody .modRow")).toHaveCount(5);
    await expect(page.locator("#rowsLayer .bar")).toHaveCount(6);
    await assertAligned(page, "parentId doc migrated");

    // idempotent
    const idem = await page.evaluate((doc2) => {
      const p = doc2.projects[0];
      window.migrateDoc(p); const first = JSON.stringify(p);
      window.migrateDoc(p); return { first, second: JSON.stringify(p) };
    }, SEED_B());
    expect(idem.second).toBe(idem.first);
  });

  test("(c) the REAL production snapshot copy migrates, renders, and is idempotent", async ({ page }) => {
    test.skip(!PROD_SNAP, "tests/data/prod_snapshot_copy.json not present (gitignored real client data)");
    const doc = PROD_SNAP.doc || PROD_SNAP; // snapshot wraps {rev, updatedAt, doc}

    // pre-migration counts straight from the raw v1 doc (features[] arrays, flat modules)
    const rawFeatures = doc.projects.reduce((a, p) => a + (p.modules || []).reduce((b, m) => b + (m.features || []).length, 0), 0);
    const rawModules = doc.projects.reduce((a, p) => a + (p.modules || []).length, 0);
    const target = doc.projects.find((p) => (p.modules || []).length);

    // Seed the RAW v1 prod doc and load a real project — Store.load() migrates it on the way in
    // (the production host is blocked by the fixture, so this is safe against the live D1).
    await seed(page, doc);
    await page.goto("/#project=" + target.id, { waitUntil: "domcontentloaded" });
    await page.locator("#proj").waitFor({ state: "attached" });

    // migrateDB idempotency + count-preservation, run in-page on a fresh copy of the raw doc
    const res = await page.evaluate((d) => {
      const cf = (ns) => { let k = 0; (ns || []).forEach((n) => { if (n && n.kind === "feature") k++; else if (n && n.children) k += cf(n.children); }); return k; };
      const cc = (ns) => { let k = 0; (ns || []).forEach((n) => { if (n && n.kind === "container") { k++; k += cc(n.children); } }); return k; };
      window.migrateDB(d);
      const first = JSON.stringify(d);
      const feats = d.projects.reduce((a, p) => a + cf(p.modules), 0);
      const conts = d.projects.reduce((a, p) => a + cc(p.modules), 0);
      const allV2 = d.projects.every((p) => p.docVer === 2);
      const allContainerRoots = d.projects.every((p) => (p.modules || []).every((n) => n.kind === "container"));
      window.migrateDB(d);
      return { first, second: JSON.stringify(d), feats, conts, allV2, allContainerRoots };
    }, doc);

    expect(res.allV2, "every project stamped docVer 2").toBe(true);
    expect(res.allContainerRoots, "every root node is a container").toBe(true);
    expect(res.feats, "no features lost in migration").toBe(rawFeatures);
    expect(res.conts, "flat modules → root containers (this snapshot has no subs)").toBe(rawModules);
    expect(res.second, "migration is idempotent on real data").toBe(res.first);

    // and it renders the real project on the timeline
    await page.locator('.tabBtn[data-tab="timeline"]').click();
    await page.locator("#leftBody .modRow").first().waitFor();
    await assertAligned(page, "prod snapshot timeline");
  });
});

/* ========================= normalizeTree (R4) ========================= */
test.describe("normalizeTree invariants (R4)", () => {
  test("duplicate ids are re-id'd so every node is unique", async ({ page }) => {
    await openProject(page, SEED_A());
    const res = await page.evaluate(() => {
      const P = { modules: [
        { id: "dup", kind: "container", name: "A", children: [ { id: "x", kind: "feature", name: "f1" }, { id: "x", kind: "feature", name: "f2" } ] },
        { id: "dup", kind: "container", name: "B", children: [] },
      ] };
      window.normalizeTree(P);
      const ids = []; (function w(ns) { ns.forEach((n) => { ids.push(n.id); if (n.children) w(n.children); }); })(P.modules);
      return { ids, unique: new Set(ids).size === ids.length };
    });
    expect(res.ids.length).toBe(4);
    expect(res.unique).toBe(true);
  });

  test("a stray ROOT feature is wrapped into a recovery container '(กู้คืน)' (never dropped)", async ({ page }) => {
    await openProject(page, SEED_A());
    const res = await page.evaluate(() => {
      const P = { modules: [
        { id: "c1", kind: "container", name: "Keep", children: [] },
        { id: "loose", kind: "feature", name: "Orphan" },
      ] };
      window.normalizeTree(P);
      let parentName = null;
      (function w(ns, par) { ns.forEach((n) => { if (n.id === "loose") parentName = par ? par.name : null; if (n.children) w(n.children, n); }); })(P.modules, null);
      return { rootKinds: P.modules.map((n) => n.kind), hasRecovery: P.modules.some((n) => n.name === "(กู้คืน)"), parentName };
    });
    expect(res.rootKinds.every((k) => k === "container")).toBe(true); // root = containers only
    expect(res.hasRecovery).toBe(true);
    expect(res.parentName).toBe("(กู้คืน)");
  });

  test("a feature carrying children is converted to a container", async ({ page }) => {
    await openProject(page, SEED_A());
    const res = await page.evaluate(() => {
      const P = { modules: [ { id: "weird", kind: "feature", name: "HasKids", children: [ { id: "k", kind: "feature", name: "kid" } ] } ] };
      window.normalizeTree(P);
      const root = P.modules[0];
      return { rootKind: root.kind, childCount: (root.children || []).length };
    });
    expect(res.rootKind).toBe("container"); // feature-with-children → container
    expect(res.childCount).toBe(1);
  });
});

/* ============ F1 — LWW clobber window: a still-open OLD tab injects a v1-SHAPE module ============
   Scenario: v1.0.4 ships; an old v1.0.3 tab adopts the v2 doc (renders via the mirror), then SAVES a
   NEW module in v1 shape — {id,name,color,collapsed,features:[…], (parentId?)} with NO kind and NO
   children. When that doc returns to a v1.0.4 tab it hits migrateDoc's sanitize-only branch → normalizeTree.
   normalizeTree must LIFT features[] → children (not classify the node as a feature, wrap it into "(กู้คืน)",
   and strand its features[] as invisible data — then persist + cloud-push the loss). */
test.describe("F1 — old-tab v1-shape injection is lifted (never mis-classified / never lost)", () => {
  const injFeats = () => [
    { id: "if1", fid: "", name: "Inj A", description: "", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} },
    { id: "if2", fid: "", name: "Inj B", description: "", start: "2026-07-03", end: "2026-07-12", status: "done", remark: "", custom: {} },
  ];
  // A bare {docVer, modules} shape for direct normalizeTree() calls.
  const v2WithInjection = (extra) => ({
    docVer: 2,
    modules: [
      { id: "c1", kind: "container", name: "Existing", color: 0, collapsed: false, children: [{ id: "e1", kind: "feature", name: "E1", start: "2026-07-01", end: "2026-07-05", status: "not_started", custom: {} }] },
      Object.assign({ id: "inj", name: "Injected", color: 1, collapsed: false, features: injFeats() }, extra || {}),
    ],
  });
  // Wrap the same modules into a full docVer-2 project doc so it can be seeded + loaded + rendered.
  const mkV2Doc = (mods) => ({
    projects: [{
      id: "test-proj", name: "Inj Test", client: "QA", code: "IT", color: 0,
      createdAt: "2026-01-01", updatedAt: "2026-01-01", customCols: [],
      colOrder: ["name", "description", "start", "end", "status", "remark"], progressOrder: [],
      summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
      docVer: 2, modules: mods.modules,
    }],
  });

  test("(i) injected root v1-shape module → root CONTAINER with its features as children; no recovery; features consumed; idempotent", async ({ page }) => {
    await openProject(page, SEED_A()); // just to boot the app (window.normalizeTree)
    const res = await page.evaluate((P) => {
      window.normalizeTree(P);
      const first = JSON.stringify(P);
      window.normalizeTree(P); // idempotency: a second pass is a structural no-op
      const inj = P.modules.find((n) => n.id === "inj");
      return {
        kind: inj && inj.kind,
        childNames: inj ? (inj.children || []).map((c) => c.name) : null,
        childKinds: inj ? (inj.children || []).map((c) => c.kind) : null,
        hasFeaturesKey: inj ? "features" in inj : null,
        hasRecovery: P.modules.some((n) => n.name === "(กู้คืน)"),
        rootKinds: P.modules.map((n) => n.kind),
        stable: first === JSON.stringify(P),
      };
    }, v2WithInjection());
    expect(res.kind).toBe("container"); // NOT a feature
    expect(res.childNames).toEqual(["Inj A", "Inj B"]); // order preserved
    expect(res.childKinds).toEqual(["feature", "feature"]);
    expect(res.hasFeaturesKey).toBe(false); // features[] CONSUMED by the lift (not left dangling)
    expect(res.hasRecovery).toBe(false); // never wrapped into a recovery container
    expect(res.rootKinds.every((k) => k === "container")).toBe(true);
    expect(res.stable).toBe(true); // idempotent JSON
  });

  test("(ii) injected module carrying parentId → RE-HOMED into the target container; parentId dissolved; idempotent", async ({ page }) => {
    await openProject(page, SEED_A());
    const res = await page.evaluate((P) => {
      window.normalizeTree(P);
      const first = JSON.stringify(P);
      window.normalizeTree(P);
      const find = (id) => { let h = null; (function w(ns) { (ns || []).forEach((n) => { if (n.id === id) h = n; if (n.children) w(n.children); }); })(P.modules); return h; };
      const parentOf = (id) => { let p = null; (function w(ns, par) { (ns || []).forEach((n) => { if (n.id === id) p = par; if (n.children) w(n.children, n); }); })(P.modules, null); return p; };
      const inj = find("inj");
      const par = parentOf("inj");
      const anyParentId = (() => { let f = false; (function w(ns) { (ns || []).forEach((n) => { if ("parentId" in n) f = true; if (n.children) w(n.children); }); })(P.modules); return f; })();
      return {
        stillRoot: P.modules.some((n) => n.id === "inj"),
        parentId: par && par.id,
        injKind: inj && inj.kind,
        injChildNames: inj ? inj.children.map((c) => c.name) : null,
        anyParentId,
        stable: first === JSON.stringify(P),
      };
    }, v2WithInjection({ parentId: "c1" }));
    expect(res.stillRoot).toBe(false); // no longer at root
    expect(res.parentId).toBe("c1"); // re-homed under the container its parentId names
    expect(res.injKind).toBe("container");
    expect(res.injChildNames).toEqual(["Inj A", "Inj B"]); // features still lifted, order preserved
    expect(res.anyParentId).toBe(false); // parentId dissolved everywhere
    expect(res.stable).toBe(true);
  });

  test("(iii) the lifted features RENDER after a real load (the data is never invisible)", async ({ page }) => {
    await openTimeline(page, mkV2Doc(v2WithInjection()));
    const feats = await gridFeatNames(page);
    expect(feats).toContain("Inj A");
    expect(feats).toContain("Inj B");
    await expect(page.locator("#rowsLayer .bar")).toHaveCount(3); // E1 + Inj A + Inj B
    await assertAligned(page, "injected features render");
  });

  test("(iv) a v2 container with a stale features[] mirror PLUS children is untouched by the lift (children win)", async ({ page }) => {
    await openProject(page, SEED_A());
    const res = await page.evaluate(() => {
      const P = { docVer: 2, modules: [{
        id: "c1", kind: "container", name: "Cont", collapsed: false,
        children: [{ id: "real", kind: "feature", name: "Real", custom: {} }],
        features: [{ id: "ghost1", kind: "feature", name: "GhostA", custom: {} }, { id: "ghost2", kind: "feature", name: "GhostB", custom: {} }],
      }] };
      window.normalizeTree(P);
      const c = P.modules[0];
      return { kind: c.kind, childNames: (c.children || []).map((x) => x.name), childCount: (c.children || []).length };
    });
    expect(res.kind).toBe("container");
    expect(res.childNames).toEqual(["Real"]); // the ghost mirror never becomes authority — children unchanged
    expect(res.childCount).toBe(1);
  });
});

/* ===================== dual-write mirror — REMOVED in v1.0.5 (spec §2, T-F0) ===================== */
test.describe("dual-write mirror removed", () => {
  test("after a save, NO container carries a features[] key (mirror is gone)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // force a Store.save() (collapse toggle → apply() → save; v1.0.4 wrote the mirror here)
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click();
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click(); // expand back

    const doc = await readDoc(page);
    ["m-alpha", "m-a-sub1", "m-beta"].forEach((id) => {
      const n = docFindNode(doc, id);
      expect(n.kind).toBe("container");
      expect("features" in n, `no mirror key on ${id}`).toBe(false);
    });
  });

  test("load IGNORES the mirror when docVer>=2 (renders from children, not features[])", async ({ page }) => {
    // A v2 doc whose features[] mirror DISAGREES with children — children must win on load.
    const doc = {
      projects: [{
        id: "test-proj", name: "Mirror Test", client: "QA", code: "MT", color: 0,
        createdAt: "2026-01-01", updatedAt: "2026-01-01", customCols: [],
        colOrder: ["name", "description", "start", "end", "status", "remark"], progressOrder: [],
        summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
        docVer: 2,
        modules: [{
          id: "c1", kind: "container", name: "Cont", collapsed: false,
          children: [{ id: "real", kind: "feature", name: "RealChild", description: "", fid: "", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} }],
          features: [
            { id: "ghost1", kind: "feature", name: "GhostA", description: "", fid: "", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} },
            { id: "ghost2", kind: "feature", name: "GhostB", description: "", fid: "", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} },
          ],
        }],
      }],
    };
    await openTimeline(page, doc);
    expect(await gridFeatNames(page)).toEqual(["RealChild"]); // the ghosts in features[] are NOT rendered
    await expect(page.locator("#rowsLayer .bar")).toHaveCount(1);
    await assertAligned(page, "mirror ignored on load");
  });
});

/* ==================== data-nid addressing (R1) ==================== */
test.describe("node-id addressing", () => {
  test("every row + bar carries data-nid; there is NO data-mi/data-fi in the DOM", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const missing = await page.evaluate(() => {
      let miss = 0;
      ["#leftBody .modRow", "#leftBody .featRow", "#leftBody .addFeat", "#rowsLayer .bar"].forEach((s) =>
        document.querySelectorAll(s).forEach((e) => { if (!e.getAttribute("data-nid")) miss++; })
      );
      return miss;
    });
    expect(missing, "rows/bars all carry data-nid").toBe(0);
    const legacy = await page.evaluate(() => document.querySelectorAll("[data-mi],[data-fi]").length);
    expect(legacy, "no legacy data-mi/data-fi anywhere in the DOM").toBe(0);
  });
});

/* ================= pane alignment after each mutation ================ */
test.describe("pane alignment holds after every mutation class (R9/R11)", () => {
  test("create · edit · up/down · collapse · drag · delete-cascade", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await assertAligned(page, "initial");

    // CREATE — add a feature into Alpha via the modal (creation on save only, R3)
    await page.locator('#leftBody .addFeat[data-nid="m-alpha"]').click();
    await expect(page.locator("#fm_name")).toBeVisible();
    await page.locator("#fm_name").fill("Fresh Feature");
    await page.locator("#fm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();
    await expect.poll(() => gridFeatNames(page).then((n) => n.includes("Fresh Feature"))).toBe(true);
    await assertAligned(page, "after create");

    // EDIT — change a feature's status (onStatusChange → apply → re-render)
    await page.locator('#leftBody .featRow[data-nid="fb1"] select.statusSel').selectOption("done");
    await assertAligned(page, "after edit (status)");

    // UP/DOWN — move a sub among its siblings. DE-VACUITY (F5d): the sibling order must ACTUALLY change,
    // else assertAligned would pass on a silent no-op and prove nothing.
    const modsBefore = await gridModNames(page);
    await clickModAct(page, "Alpha Sub Two", "modup");
    await expect.poll(() => gridModNames(page)).toEqual(["Alpha", "Alpha Sub Two", "Alpha Sub One", "Beta", "Beta Sub"]);
    expect(await gridModNames(page), "modup must reorder the siblings").not.toEqual(modsBefore);
    await assertAligned(page, "after up/down");

    // COLLAPSE + EXPAND
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click();
    await assertAligned(page, "after collapse");
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click();
    await assertAligned(page, "after expand");

    // DRAG — reorder two features inside Alpha. DE-VACUITY (F5d): the feature order must ACTUALLY change.
    const featsBefore = await gridFeatNames(page);
    await dragFeature(page, "fa1", "fa2", "after");
    await expect.poll(() => gridFeatNames(page).then((n) => n.indexOf("Alpha Two") < n.indexOf("Alpha One"))).toBe(true);
    expect(await gridFeatNames(page), "feature drag must reorder the features").not.toEqual(featsBefore);
    await assertAligned(page, "after feature drag");

    // DELETE-CASCADE — remove Beta and its whole subtree
    page.once("dialog", (d) => d.accept());
    await clickModAct(page, "Beta", "delmod");
    await expect.poll(() => gridModNames(page).then((n) => n.includes("Beta"))).toBe(false);
    await assertAligned(page, "after delete-cascade");
  });
});

/* ============ F2 — inline FIELD edits do a LIGHT render (left grid NOT rebuilt) ============
   name / date / status / modname edits keep #leftBody intact so the focused editor + its listeners
   survive; only renderTimeline()+meta(+progress) refresh. A no-op blur must not even Store.save(). */
test.describe("F2 — field edits keep the grid (light render)", () => {
  test("(i) a no-change name blur neither saves nor re-renders (DOM identity + localStorage preserved)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const before = JSON.stringify(await readDoc(page));
    const handle = await page.$('#leftBody .featRow[data-nid="fa1"]');
    const txt = page.locator('#leftBody .featRow[data-nid="fa1"] .cell.feat .txt');
    await txt.focus();
    await txt.evaluate((el) => el.blur()); // blur with NO change → dirty-check returns before apply()
    expect(await handle.evaluate((el) => el.isConnected)).toBe(true); // grid never touched
    expect(JSON.stringify(await readDoc(page))).toBe(before); // no Store.save()
    await assertAligned(page, "no-op blur");
  });

  test("(ii) a changed name blur updates the doc + .blabel yet keeps the featRow element (grid not rebuilt)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const handle = await page.$('#leftBody .featRow[data-nid="fa1"]');
    const txt = page.locator('#leftBody .featRow[data-nid="fa1"] .cell.feat .txt');
    await txt.fill("Alpha One EDITED");
    await txt.evaluate((el) => el.blur());
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").name)).toBe("Alpha One EDITED"); // doc updated
    await expect(page.locator('#rowsLayer .bar[data-nid="fa1"] .blabel')).toHaveText("Alpha One EDITED"); // blabel refreshed by renderTimeline
    expect(await handle.evaluate((el) => el.isConnected)).toBe(true); // #leftBody NOT rebuilt → a real focused editor would have survived
    await assertAligned(page, "name edit light render");
  });

  test("(iii) a date change via fill() updates the doc + moves the bar; the date input stays connected", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const dateInp = page.locator('#leftBody .featRow[data-nid="fa1"] input[data-field="start"]');
    const handle = await dateInp.elementHandle();
    const leftBefore = await page.locator('#rowsLayer .bar[data-nid="fa1"]').evaluate((b) => b.style.left);
    await dateInp.fill("2026-07-20");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").start)).toBe("2026-07-20"); // doc updated
    const leftAfter = await page.locator('#rowsLayer .bar[data-nid="fa1"]').evaluate((b) => b.style.left);
    expect(leftAfter).not.toBe(leftBefore); // bar geometry changed
    expect(await handle.evaluate((el) => el.isConnected)).toBe(true); // date input NOT rebuilt
    await assertAligned(page, "date edit light render");
  });

  test("(iv) a status change updates the doc + bar .sdot + the select boxShadow, grid intact", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const sel = page.locator('#leftBody .featRow[data-nid="fa1"] select.statusSel');
    const handle = await sel.elementHandle();
    const sdotBefore = await page.locator('#rowsLayer .bar[data-nid="fa1"] .sdot').evaluate((e) => e.style.background);
    const shadowBefore = await sel.evaluate((e) => e.style.boxShadow);
    await sel.selectOption("done");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").status)).toBe("done"); // doc updated
    const sdotAfter = await page.locator('#rowsLayer .bar[data-nid="fa1"] .sdot').evaluate((e) => e.style.background);
    const shadowAfter = await sel.evaluate((e) => e.style.boxShadow);
    expect(sdotAfter, "bar .sdot recoloured by renderTimeline").not.toBe(sdotBefore);
    expect(shadowAfter, "select inset boxShadow patched inline").not.toBe(shadowBefore);
    expect(await handle.evaluate((el) => el.isConnected)).toBe(true); // select NOT rebuilt
    await assertAligned(page, "status edit light render");
  });
});
