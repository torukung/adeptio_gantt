// v1.0.3 module features — DnD reorder, up/down block moves, sub-modules (parentId),
// tree-line rails, step indentation, delete-promote, has-subs guard, progress ↳,
// Excel button, localStorage round-trip, and left/right alignment after EVERY mutation.
const {
  test, expect,
  SEED_A, SEED_B,
  openProject, openTimeline,
  readDoc, docModNames,
  gridModNames, gridFeatNames,
  docFindNode, docFindByName, docParentOf,
  pseudo, pxProp, assertAligned,
  clickModAct, dragModule, dragFeature,
} = require("./fixtures");

/* local helpers */
async function isSubMod(page, name) {
  return page.evaluate((nm) => {
    const r = [...document.querySelectorAll("#leftBody .modRow")].find(
      (x) => x.querySelector(".modName").textContent === nm
    );
    return r ? r.classList.contains("subMod") : null;
  }, name);
}
async function createSubViaModal(page, name, parentId) {
  await page.locator("#btnAddMod").click();
  await expect(page.locator("#mm_name")).toBeVisible();
  await page.locator("#mm_name").fill(name);
  await expect(page.locator("#mm_parentField")).toBeHidden(); // hidden while "main"
  await page.locator('#mm_kind button[data-k="sub"]').click();
  await expect(page.locator("#mm_parentField")).toBeVisible(); // shown when "sub"
  await page.selectOption("#mm_parent", parentId);
  await page.locator("#mm_save").click();
  await expect(page.locator("#modalRoot")).toBeHidden();
}
// Pointer-drag a feature (by node id) onto an arbitrary target element — a container's modRow header
// (→ FRONT insert) or an addFeat zone (→ APPEND). Aims at the target CENTER so elementFromPoint resolves
// the container (rowDragEval: featRow → addFeat → modRow). Mirrors fixtures' dragFeature mechanics.
async function dragFeatureOnto(page, srcNid, target) {
  const grip = page.locator(`#leftBody .featRow[data-nid="${srcNid}"] .grip[data-act="rowdrag"]`);
  await grip.scrollIntoViewIfNeeded();
  const gb = await grip.boundingBox();
  await target.scrollIntoViewIfNeeded();
  const tb = await target.boundingBox();
  const sx = gb.x + gb.width / 2, sy = gb.y + gb.height / 2;
  const tx = tb.x + tb.width / 2, ty = tb.y + tb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 3, sy + 3, { steps: 3 }); // kick off drag → ghost
  await page.mouse.move(tx, ty, { steps: 18 });
  await page.mouse.move(tx, ty, { steps: 6 }); // settle so elementFromPoint locks on
  await page.mouse.up();
}

/* ============================ 2.2 affordance ============================= */
test.describe("2.2 — module-row affordance", () => {
  test("grip + up/down buttons exist with Thai tooltips on every module row", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const row = page.locator('#leftBody .modRow[data-nid="m-alpha"]'); // v1.0.4: rows addressed by data-nid (container id)
    await expect(row.locator(".modGrip")).toHaveAttribute("title", "ลากเพื่อย้ายโมดูล");
    await expect(row.locator('[data-act="modup"]')).toHaveAttribute("title", "เลื่อนโมดูลขึ้น");
    await expect(row.locator('[data-act="moddown"]')).toHaveAttribute("title", "เลื่อนโมดูลลง");
    // grip present on all three module rows
    await expect(page.locator("#leftBody .modRow .modGrip")).toHaveCount(3);
    await assertAligned(page, "affordance");
  });
});

/* ======================= 2.1 module drag reorder ======================== */
test.describe("2.1 — module drag & drop reorder", () => {
  test("drag a MAIN before and after another (both directions) + alignment", async ({ page }) => {
    await openTimeline(page, SEED_A());
    expect(await gridModNames(page)).toEqual(["Alpha", "Beta", "Gamma"]);

    // direction 1: drop Gamma BEFORE Alpha → [Gamma, Alpha, Beta]
    await dragModule(page, "Gamma", "Alpha", "before");
    await expect.poll(() => gridModNames(page)).toEqual(["Gamma", "Alpha", "Beta"]);
    await assertAligned(page, "after drag-before");

    // direction 2: drop Gamma AFTER Beta → [Alpha, Beta, Gamma]
    await dragModule(page, "Gamma", "Beta", "after");
    await expect.poll(() => gridModNames(page)).toEqual(["Alpha", "Beta", "Gamma"]);
    await assertAligned(page, "after drag-after");

    // persisted to localStorage
    const doc = await readDoc(page);
    expect(docModNames(doc)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  test("dragging a MAIN block carries its sub-modules as a unit", async ({ page }) => {
    await openTimeline(page, SEED_B());
    expect(await gridModNames(page)).toEqual([
      "Alpha", "Alpha Sub One", "Alpha Sub Two", "Beta", "Beta Sub",
    ]);
    // drop the whole Alpha block AFTER Beta
    await dragModule(page, "Alpha", "Beta", "after");
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Beta", "Beta Sub", "Alpha", "Alpha Sub One", "Alpha Sub Two"]);
    await assertAligned(page, "block carry");

    const doc = await readDoc(page);
    // subs still belong to Alpha (now nested as Alpha's container children — the whole node travelled)
    expect(docParentOf(doc, "m-a-sub1").id).toBe("m-alpha");
    expect(docParentOf(doc, "m-a-sub2").id).toBe("m-alpha");
    expect(docModNames(doc)).toEqual(["Beta", "Alpha"]); // root order: Beta subtree then Alpha subtree
  });

  // SPEC CHANGE (§4 + scope): module grip drag is SIBLINGS-ONLY in v1.0.4 — cross-level
  // re-parenting via drag is removed (it becomes the stage-2 indent/outdent buttons). A sub
  // dropped onto a non-sibling MAIN is now a NO-OP (was: re-parent in v1.0.3).
  test("dragging a SUB onto a non-sibling MAIN is a no-op (siblings-only drag)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const before = await gridModNames(page);
    await dragModule(page, "Alpha Sub Two", "Beta", "onto");
    await expect.poll(() => gridModNames(page)).toEqual(before); // unchanged
    await assertAligned(page, "sub-onto-main no-op");

    const doc = await readDoc(page);
    expect(docParentOf(doc, "m-a-sub2").id).toBe("m-alpha"); // parent unchanged
  });

  // SPEC CHANGE (§4): module drag reorders among SIBLINGS of the same parent. Reorder the two
  // Alpha sub-modules relative to each other (preserves the v1.0.3 "sub drag reorders" spirit,
  // within the siblings-only rule).
  test("dragging a SUB before its sibling SUB reorders them", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // drag "Alpha Sub Two" BEFORE "Alpha Sub One" (same parent) → swap order under Alpha
    await dragModule(page, "Alpha Sub Two", "Alpha Sub One", "before");
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Alpha", "Alpha Sub Two", "Alpha Sub One", "Beta", "Beta Sub"]);
    await assertAligned(page, "sub sibling reorder");

    const doc = await readDoc(page);
    expect(docParentOf(doc, "m-a-sub1").id).toBe("m-alpha"); // both stay under Alpha
    expect(docParentOf(doc, "m-a-sub2").id).toBe("m-alpha");
  });

  test("feature-row drag-reorder still works (no regression)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    expect(await gridFeatNames(page)).toEqual(["Alpha One", "Alpha Two", "Beta One", "Beta Two", "Gamma One"]);
    // move Alpha One below Alpha Two (within the same container), addressed by feature node id
    await dragFeature(page, "fa1", "fa2", "after");
    await expect
      .poll(() => gridFeatNames(page))
      .toEqual(["Alpha Two", "Alpha One", "Beta One", "Beta Two", "Gamma One"]);
    await assertAligned(page, "feature reorder");
  });
});

/* ===================== 2.1 up/down block move buttons ==================== */
test.describe("2.1 — modup / moddown buttons", () => {
  test("moddown/modup move a MAIN block past the adjacent MAIN block", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await clickModAct(page, "Alpha", "moddown"); // Alpha block swaps with Beta block
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Beta", "Beta Sub", "Alpha", "Alpha Sub One", "Alpha Sub Two"]);
    await assertAligned(page, "moddown block");

    await clickModAct(page, "Alpha", "modup"); // back
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Alpha", "Alpha Sub One", "Alpha Sub Two", "Beta", "Beta Sub"]);
    await assertAligned(page, "modup block");
  });

  test("modup swaps a SUB with its adjacent sibling only", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await clickModAct(page, "Alpha Sub Two", "modup"); // swaps with Alpha Sub One
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Alpha", "Alpha Sub Two", "Alpha Sub One", "Beta", "Beta Sub"]);
    await assertAligned(page, "sub sibling swap");
    const doc = await readDoc(page);
    // both remain Alpha's children
    expect(docParentOf(doc, "m-a-sub1").id).toBe("m-alpha");
    expect(docParentOf(doc, "m-a-sub2").id).toBe("m-alpha");
  });
});

/* ===================== 2.2.1 module / sub-module modal =================== */
test.describe("2.2.1 — module modal type + parent picker", () => {
  test("segmented control + parent select creates a sub under the chosen main", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await createSubViaModal(page, "New Sub", "m-beta");

    await expect.poll(() => gridModNames(page)).toEqual(["Alpha", "Beta", "New Sub", "Gamma"]);
    expect(await isSubMod(page, "New Sub")).toBe(true);
    await assertAligned(page, "created sub");

    const doc = await readDoc(page);
    const created = docFindByName(doc, "New Sub"); // now nested (Beta's child), not at root
    expect(created).toBeTruthy();
    expect(created.kind).toBe("container");
    expect(docParentOf(doc, created.id).id).toBe("m-beta");
  });

  test("editing a MAIN that has subs DISABLES the Sub-Module option with the Thai hint", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await clickModAct(page, "Alpha", "editmod");
    await expect(page.locator("#mm_name")).toHaveValue("Alpha");
    await expect(page.locator('#mm_kind button[data-k="sub"]')).toBeDisabled();
    await expect(page.locator(".mmKindHint")).toHaveText("มีโมดูลย่อยอยู่ — ย้ายหรือเลื่อนขั้นโมดูลย่อยก่อน");
  });

  test("parent <select> excludes the module being edited", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await clickModAct(page, "Beta", "editmod");
    await page.locator('#mm_kind button[data-k="sub"]').click();
    const opts = await page.$$eval("#mm_parent option", (o) => o.map((x) => x.textContent));
    expect(opts).toContain("Alpha");
    expect(opts).toContain("Gamma");
    expect(opts).not.toContain("Beta"); // self excluded as a parent candidate
  });

  // F3: editing a NESTED sub that has its own sub-containers has the Type control disabled. A plain
  // rename must keep its parent (the save must never change parentage unless the user changed it) —
  // the v1.0.3-carryover bug silently re-homed the whole subtree to root.
  test("renaming a nested sub-with-children keeps its parent (no silent reparent to root) [F3]", async ({ page }) => {
    await openTimeline(page, SEED_A());
    // build Alpha > Sub1 > Sub2 through the modal
    await createSubViaModal(page, "Sub1", "m-alpha");
    const sub1Id = docFindByName(await readDoc(page), "Sub1").id;
    await createSubViaModal(page, "Sub2", sub1Id); // Sub2 nested under Sub1 ⇒ Sub1 now holds a sub-container
    expect(docParentOf(await readDoc(page), docFindByName(await readDoc(page), "Sub2").id).id).toBe(sub1Id);

    await clickModAct(page, "Sub1", "editmod");
    await expect(page.locator("#mm_name")).toHaveValue("Sub1");
    await expect(page.locator('#mm_kind button[data-k="sub"]')).toBeDisabled(); // has sub-containers ⇒ Type locked
    await expect(page.locator('#mm_kind button[data-k="sub"]')).toHaveClass(/on/); // …but still displays "sub" (UI doesn't lie about the nested state)
    await page.locator("#mm_name").fill("Sub1 Renamed");
    await page.locator("#mm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();

    const doc = await readDoc(page);
    const renamed = docFindByName(doc, "Sub1 Renamed");
    expect(renamed).toBeTruthy();
    expect(docParentOf(doc, renamed.id).id).toBe("m-alpha"); // STILL under Alpha — not re-homed to root
    expect(docParentOf(doc, docFindByName(doc, "Sub2").id).id).toBe(renamed.id); // Sub2 still under Sub1 (order/subtree intact)
    expect(await gridModNames(page)).toEqual(["Alpha", "Sub1 Renamed", "Sub2", "Beta", "Gamma"]); // order unchanged
    await assertAligned(page, "F3 rename nested sub");
  });
});

/* ======================== 2.2.2 tree-line rails ========================== */
test.describe("2.2.2 — tree-line rails", () => {
  test("sub rows carry subMod/subScope/subEnd classes with visible pseudo-element rails", async ({ page }) => {
    await openTimeline(page, SEED_B());

    // classes present on the right rows
    await expect(page.locator("#leftBody .modRow.subMod")).toHaveCount(3); // 2 Alpha subs + 1 Beta sub
    await expect(page.locator("#leftBody .featRow.subScope")).toHaveCount(3); // one feat each
    await expect(page.locator("#leftBody .addFeat.subScope")).toHaveCount(3);
    await expect(page.locator("#leftBody .addFeat.subScope.subEnd")).toHaveCount(2); // last sub of each parent

    // computed rail on a sub modRow: a 2px vertical ::before + an elbow ::after
    const railBefore = await pseudo(page, "#leftBody .modRow.subMod", "::before");
    expect(railBefore.content).not.toBe("none");
    expect(railBefore.width).toBe("2px");
    expect(railBefore.backgroundColor).toMatch(/146,\s*65,\s*255/); // soft violet --rail
    const elbow = await pseudo(page, "#leftBody .modRow.subMod", "::after");
    expect(elbow.content).not.toBe("none");
    expect(elbow.height).toBe("2px");

    // a MAIN modRow has NO rail pseudo-element
    const mainBefore = await pseudo(page, '#leftBody .modRow:not(.subMod)', "::before");
    expect(mainBefore.content).toBe("none");
  });
});

/* ========================= 2.4 step indentation ========================= */
test.describe("2.4 — step indentation", () => {
  test("padding-left / chip offset grows one step per hierarchy level", async ({ page }) => {
    await openTimeline(page, SEED_B());

    const mainFeatPad = await pxProp(page, "#leftBody .featRow:not(.subScope) .cell.feat", "paddingLeft");
    const subFeatPad = await pxProp(page, "#leftBody .featRow.subScope .cell.feat", "paddingLeft");
    const mainChip = await pxProp(page, "#leftBody .modRow:not(.subMod) .chip", "marginLeft");
    const subChip = await pxProp(page, "#leftBody .modRow.subMod .chip", "marginLeft");

    // main feature indented one step (>0); sub feature indented a further step
    expect(mainFeatPad).toBeGreaterThan(0);
    expect(subFeatPad).toBeGreaterThan(mainFeatPad);
    expect(subFeatPad - mainFeatPad).toBeGreaterThanOrEqual(20); // ~one --step (24px)

    // sub modRow chip shifted one step; main chip not shifted
    expect(mainChip).toBe(0);
    expect(subChip).toBeGreaterThanOrEqual(20);
  });
});

/* ==================== consistency touchpoints (spec §) =================== */
test.describe("consistency touchpoints", () => {
  // SPEC CHANGE (D1 / R8): delete is a CASCADE with an explicit inside-count confirm — no
  // silent child-promotion. Confirm text: ลบ "X" และ N รายการข้างใน? (N = countAll).
  test("delete a container cascades (inside-count confirm; no child-promotion) [D1]", async ({ page }) => {
    await openTimeline(page, SEED_B());

    let dialogMsg = "";
    page.once("dialog", (d) => {
      dialogMsg = d.message();
      d.accept();
    });
    await clickModAct(page, "Alpha", "delmod");

    // countAll(Alpha) = 2 direct features + 2 sub-containers + 2 sub-features = 6
    expect(dialogMsg).toContain('ลบ "Alpha"');
    expect(dialogMsg).toContain("และ 6 รายการข้างใน");
    await expect.poll(() => gridModNames(page)).toEqual(["Beta", "Beta Sub"]); // whole Alpha subtree removed
    await assertAligned(page, "after cascade delete");

    const doc = await readDoc(page);
    expect(docFindNode(doc, "m-alpha")).toBeNull();  // container gone
    expect(docFindNode(doc, "m-a-sub1")).toBeNull(); // sub-containers cascaded (NOT promoted)
    expect(docFindNode(doc, "m-a-sub2")).toBeNull();
    expect(docFindNode(doc, "fs1")).toBeNull();      // their features gone too
    expect(docParentOf(doc, "m-b-sub1").id).toBe("m-beta"); // Beta subtree untouched
    expect(await isSubMod(page, "Beta Sub")).toBe(true);
  });

  // SPEC CHANGE (tree collapse): collapsing a container hides its ENTIRE subtree (features AND
  // sub-containers), not just its own features. Sibling subtrees are unaffected.
  test("collapsing a container hides its whole subtree; siblings stay visible", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click(); // collapse Alpha
    await expect.poll(() => gridFeatNames(page).then((n) => n.includes("Alpha One"))).toBe(false);
    const names = await gridModNames(page);
    expect(names).not.toContain("Alpha Sub One"); // sub-containers hidden with the subtree
    expect(names).not.toContain("Alpha Sub Two");
    expect(names).toContain("Alpha"); // the collapsed header itself remains
    expect(names).toContain("Beta");  // sibling subtree unaffected
    expect(await gridFeatNames(page)).toContain("Beta One");
    await assertAligned(page, "after collapse");
  });

  test("Excel Export button is present (intact)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const btn = page.locator("#btnExportXlsx");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("Export");
  });

  // SPEC CHANGE (§4): progress lists TOP-LEVEL containers only; the v1.0.3 "↳" sub rows are gone.
  test("progress panel lists TOP-LEVEL containers only (no ↳ sub rows)", async ({ page }) => {
    await openProject(page, SEED_B()); // summary tab (default) hosts the progress panel
    await page.locator("#progressPanel .progRow").first().waitFor();
    const names = await page.$$eval("#progressPanel .progRow .pmName", (els) => els.map((e) => e.textContent));
    expect(names).toEqual(["Alpha", "Beta"]);
    expect(names.some((n) => n.startsWith("↳"))).toBe(false);
  });
});

/* ===================== persistence round-trip / reload ================== */
test.describe("persistence — parentId + order survive reload", () => {
  test("create a sub, reload, and render order + tree structure are identical", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await createSubViaModal(page, "New Sub", "m-alpha");
    await expect.poll(() => gridModNames(page)).toEqual(["Alpha", "New Sub", "Beta", "Gamma"]);

    const before = await readDoc(page);
    const created = docFindByName(before, "New Sub"); // nested under Alpha
    expect(created).toBeTruthy();
    const createdId = created.id;
    expect(before.projects[0].modules.map((m) => m.name)).toEqual(["Alpha", "Beta", "Gamma"]); // roots
    expect(before.projects[0].docVer).toBe(2); // migration stamped the project
    expect(docParentOf(before, createdId).id).toBe("m-alpha");

    // reload — idempotent seed keeps the mutation; app re-reads localStorage + re-migrates (docVer>=2 ⇒ sanitize only)
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('.tabBtn[data-tab="timeline"]').click();
    await page.locator("#leftBody .modRow").first().waitFor();

    await expect.poll(() => gridModNames(page)).toEqual(["Alpha", "New Sub", "Beta", "Gamma"]);
    expect(await isSubMod(page, "New Sub")).toBe(true);
    await assertAligned(page, "after reload");

    const after = await readDoc(page);
    expect(after.projects[0].modules.map((m) => m.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(docParentOf(after, createdId).id).toBe("m-alpha"); // id stable across reload (not re-minted)
  });
});

/* ================= v1.0.4 stage-1 additions (F5): reveal / cross-container / rollups ================ */
test.describe("F5 — reveal-on-insert, cross-container drag, recursive rollups", () => {
  // ---- F5a: R6 reveal-on-insert (drop + modal-create both auto-expand a collapsed target) ----
  test("R6 — dropping a feature onto a COLLAPSED container header auto-expands it (front insert)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await page.locator('#leftBody .modRow[data-nid="m-gamma"] .caret').click(); // collapse Gamma (holds fg1)
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "m-gamma").collapsed)).toBe(true);
    await expect(page.locator('#leftBody .featRow[data-nid="fg1"]')).toHaveCount(0); // subtree hidden while collapsed

    await dragFeatureOnto(page, "fa1", page.locator('#leftBody .modRow[data-nid="m-gamma"]')); // drop onto the collapsed header

    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "m-gamma").collapsed)).toBe(false); // auto-expanded
    const doc = await readDoc(page);
    expect(docParentOf(doc, "fa1").id).toBe("m-gamma");
    expect(docFindNode(doc, "m-gamma").children[0].id).toBe("fa1"); // inserted at the FRONT
    await expect(page.locator('#leftBody .featRow[data-nid="fa1"]')).toBeVisible(); // the moved row is now visible
    await assertAligned(page, "reveal on drop");
  });

  test("R6 — creating a feature from a COLLAPSED container header auto-expands it on save", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await page.locator('#leftBody .modRow[data-nid="m-gamma"] .caret').click(); // collapse Gamma
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "m-gamma").collapsed)).toBe(true);

    const g = page.locator('#leftBody .modRow[data-nid="m-gamma"]');
    await g.hover();
    await g.locator('[data-act="addfeat"]').click(); // ＋ on the collapsed header opens the modal
    await expect(page.locator("#fm_name")).toBeVisible();
    await page.locator("#fm_name").fill("Gamma Fresh");
    await page.locator("#fm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();

    await expect.poll(() => gridFeatNames(page).then((n) => n.includes("Gamma Fresh"))).toBe(true);
    const doc = await readDoc(page);
    expect(docFindNode(doc, "m-gamma").collapsed).toBe(false); // auto-expanded on create (R6)
    expect(docParentOf(doc, docFindByName(doc, "Gamma Fresh").id).id).toBe("m-gamma");
    await assertAligned(page, "reveal on modal create");
  });

  // ---- F5b: cross-container feature drag (front on header, append on a nested add-zone) ----
  test("cross-container drag — onto another container's HEADER inserts at the FRONT", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await dragFeatureOnto(page, "fa1", page.locator('#leftBody .modRow[data-nid="m-beta"]')); // Alpha's fa1 → Beta header
    const doc = await readDoc(page);
    expect(docParentOf(doc, "fa1").id).toBe("m-beta");
    expect(docFindNode(doc, "m-beta").children.map((c) => c.id)).toEqual(["fa1", "fb1", "fb2"]); // FRONT
    await assertAligned(page, "cross-container front");
  });

  test("cross-container drag — onto a NESTED sub-container's add-zone APPENDS into it", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await dragFeatureOnto(page, "fa1", page.locator('#leftBody .addFeat[data-nid="m-a-sub1"]')); // Alpha's fa1 → Alpha Sub One add-zone
    const doc = await readDoc(page);
    expect(docParentOf(doc, "fa1").id).toBe("m-a-sub1"); // re-homed into the nested sub
    expect(docFindNode(doc, "m-a-sub1").children.map((c) => c.id)).toEqual(["fs1", "fa1"]); // APPENDED (order preserved)
    await assertAligned(page, "cross-container append (nested)");
  });

  // ---- F5c: progress rollup is recursive (a shallow walk would fail this) ----
  test("progress rollup is RECURSIVE — a container's total spans nested descendants", async ({ page }) => {
    await openProject(page, SEED_B()); // summary tab hosts the progress panel
    await page.locator("#progressPanel .progRow").first().waitFor();
    const alphaTip = await page.locator('#progressPanel .progRow[data-mid="m-alpha"] .kc-bar .pbar').getAttribute("title");
    expect(alphaTip).toContain("(4 งาน)"); // Alpha = fa1,fa2 + nested fs1,fs2 (a shallow walk reads 2 → fails)
    const betaTip = await page.locator('#progressPanel .progRow[data-mid="m-beta"] .kc-bar .pbar').getAttribute("title");
    expect(betaTip).toContain("(2 งาน)"); // Beta = fb1 + nested fbs1
  });

  // ---- F5e: cross-parent SUB drag is a no-op (siblings-only) ----
  test("cross-parent SUB drag is a NO-OP — order + parentage unchanged", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const before = await gridModNames(page);
    await dragModule(page, "Beta Sub", "Alpha Sub One", "before"); // non-siblings (Beta's child vs Alpha's child)
    await expect.poll(() => gridModNames(page)).toEqual(before); // unchanged
    const doc = await readDoc(page);
    expect(docParentOf(doc, "m-b-sub1").id).toBe("m-beta"); // parentage unchanged
    expect(docParentOf(doc, "m-a-sub1").id).toBe("m-alpha");
    await assertAligned(page, "cross-parent sub no-op");
  });

  // ---- F5f: progressOrder (custom order) survives migration ----
  test("progressOrder custom order survives v1→v2 migration (top-level containers)", async ({ page }) => {
    const doc = SEED_B();
    doc.projects[0].progressOrder = ["m-beta", "m-alpha"]; // reversed custom order on the RAW v1 doc
    await openProject(page, doc);
    await page.locator("#progressPanel .progRow").first().waitFor();
    const names = await page.$$eval("#progressPanel .progRow .pmName", (els) => els.map((e) => e.textContent));
    expect(names).toEqual(["Beta", "Alpha"]); // migrated containers listed in the persisted custom order
  });

  // ---- F5g: updateMeta counts recursively ----
  test("updateMeta counts modules + descendant features recursively", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const meta = await page.locator("#metaLine").textContent();
    expect(meta).toContain("2 โมดูล"); // 2 top-level containers
    expect(meta).toContain("6 ฟีเจอร์"); // 6 descendant features (fa1,fa2,fs1,fs2,fb1,fbs1)
  });
});

/* ============================ HARD SAFETY =============================== */
test.describe("safety — production API is blocked", () => {
  test("no request ever reaches the production Worker (all aborted)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    // force a Store.save() → debounced cloudPush attempt
    await page.locator('#leftBody .modRow[data-nid="m-alpha"] .caret').click(); // toggle collapse
    await page.waitForTimeout(1100); // > 800ms push debounce

    const prod = page._prod;
    // The app genuinely ATTEMPTS to reach production (cloudSync on load + cloudPush on
    // save); the safety guarantee is that every attempt is aborted and NONE reach it.
    expect(prod.attempts.length, "app should have attempted at least one prod sync").toBeGreaterThan(0);
    expect(prod.reached, `requests reached production: ${prod.reached.join(", ")}`).toEqual([]);
    expect(prod.failed.length, "every prod attempt must be aborted").toBe(prod.attempts.length);
  });
});
