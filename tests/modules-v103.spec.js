// v1.0.3 module features — DnD reorder, up/down block moves, sub-modules (parentId),
// tree-line rails, step indentation, delete-promote, has-subs guard, progress ↳,
// Excel button, localStorage round-trip, and left/right alignment after EVERY mutation.
const {
  test, expect,
  SEED_A, SEED_B,
  openProject, openTimeline,
  readDoc, docModNames, docModById,
  gridModNames, gridFeatNames, miOf,
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

/* ============================ 2.2 affordance ============================= */
test.describe("2.2 — module-row affordance", () => {
  test("grip + up/down buttons exist with Thai tooltips on every module row", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const row = page.locator('#leftBody .modRow[data-mi="0"]');
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
    // subs still belong to Alpha, contiguous right after it
    expect(docModById(doc, "m-a-sub1").parentId).toBe("m-alpha");
    expect(docModById(doc, "m-a-sub2").parentId).toBe("m-alpha");
    expect(docModNames(doc)).toEqual(["Beta", "Beta Sub", "Alpha", "Alpha Sub One", "Alpha Sub Two"]);
  });

  test("dragging a SUB onto a MAIN row re-parents it as that main's first sub", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // drag "Alpha Sub Two" onto the Beta MAIN row → becomes Beta's first sub
    await dragModule(page, "Alpha Sub Two", "Beta", "onto");
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Alpha", "Alpha Sub One", "Beta", "Alpha Sub Two", "Beta Sub"]);
    await assertAligned(page, "sub re-parent onto main");

    const doc = await readDoc(page);
    expect(docModById(doc, "m-a-sub2").parentId).toBe("m-beta"); // adopted new parent
    expect(await isSubMod(page, "Alpha Sub Two")).toBe(true); // still a sub visually
  });

  test("dragging a SUB next to another SUB adopts that sub's parent", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // drag "Beta Sub" BEFORE "Alpha Sub One" → adopts Alpha's parentId
    await dragModule(page, "Beta Sub", "Alpha Sub One", "before");
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Alpha", "Beta Sub", "Alpha Sub One", "Alpha Sub Two", "Beta"]);
    await assertAligned(page, "sub next to sub");

    const doc = await readDoc(page);
    expect(docModById(doc, "m-b-sub1").parentId).toBe("m-alpha");
  });

  test("feature-row drag-reorder still works (no regression)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    expect(await gridFeatNames(page)).toEqual(["Alpha One", "Alpha Two", "Beta One", "Beta Two", "Gamma One"]);
    // move Alpha One below Alpha Two (within the same module)
    await dragFeature(page, 0, 0, 0, 1, "after");
    await expect
      .poll(() => page.$$eval('#leftBody .featRow[data-mi="0"] .cell.feat .txt', (e) => e.map((x) => x.textContent.trim())))
      .toEqual(["Alpha Two", "Alpha One"]);
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
    // both remain Alpha's subs
    expect(docModById(doc, "m-a-sub1").parentId).toBe("m-alpha");
    expect(docModById(doc, "m-a-sub2").parentId).toBe("m-alpha");
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
    const created = doc.projects[0].modules.find((m) => m.name === "New Sub");
    expect(created).toBeTruthy();
    expect(created.parentId).toBe("m-beta");
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
  test("delete a MAIN with subs → confirm text + subs promoted to main", async ({ page }) => {
    await openTimeline(page, SEED_B());

    let dialogMsg = "";
    page.once("dialog", (d) => {
      dialogMsg = d.message();
      d.accept();
    });
    await clickModAct(page, "Alpha", "delmod");

    expect(dialogMsg).toContain("โมดูลย่อยจะถูกเลื่อนขั้นเป็นโมดูลหลัก");
    await expect
      .poll(() => gridModNames(page))
      .toEqual(["Alpha Sub One", "Alpha Sub Two", "Beta", "Beta Sub"]);
    await assertAligned(page, "after delete-promote");

    const doc = await readDoc(page);
    expect(docModById(doc, "m-alpha")).toBeUndefined(); // main gone
    expect(docModById(doc, "m-a-sub1").parentId ?? null).toBeNull(); // promoted
    expect(docModById(doc, "m-a-sub2").parentId ?? null).toBeNull();
    expect(docModById(doc, "m-b-sub1").parentId).toBe("m-beta"); // untouched
    // promoted ex-subs are no longer rendered as subMod
    expect(await isSubMod(page, "Alpha Sub One")).toBe(false);
    expect(await isSubMod(page, "Beta Sub")).toBe(true);
  });

  test("collapsing a MAIN hides only its own features; subs stay visible", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // collapse Alpha via its caret
    await page.locator('#leftBody .modRow[data-mi="0"] .caret').click();
    await expect.poll(() => gridFeatNames(page).then((n) => n.includes("Alpha One"))).toBe(false);
    // subs and their features remain
    const names = await gridModNames(page);
    expect(names).toContain("Alpha Sub One");
    expect(names).toContain("Alpha Sub Two");
    expect(await gridFeatNames(page)).toContain("Sub One Feat");
    await assertAligned(page, "after collapse");
  });

  test("Excel Export button is present (intact)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const btn = page.locator("#btnExportXlsx");
    await expect(btn).toBeVisible();
    await expect(btn).toContainText("Export");
  });

  test("progress panel prefixes sub-module rows with ↳", async ({ page }) => {
    await openProject(page, SEED_B()); // summary tab (default) hosts the progress panel
    await page.locator("#progressPanel .progRow").first().waitFor();
    const names = await page.$$eval("#progressPanel .progRow .pmName", (els) => els.map((e) => e.textContent));
    const subs = names.filter((n) => n.startsWith("↳ "));
    expect(subs.length).toBe(3); // 3 sub-modules
    expect(subs).toEqual(expect.arrayContaining(["↳ Alpha Sub One", "↳ Alpha Sub Two", "↳ Beta Sub"]));
    // mains are NOT prefixed
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });
});

/* ===================== persistence round-trip / reload ================== */
test.describe("persistence — parentId + order survive reload", () => {
  test("create a sub, reload, and render order + parentId are identical", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await createSubViaModal(page, "New Sub", "m-alpha");
    await expect.poll(() => gridModNames(page)).toEqual(["Alpha", "New Sub", "Beta", "Gamma"]);

    const before = await readDoc(page);
    const createdId = before.projects[0].modules.find((m) => m.name === "New Sub").id;
    expect(before.projects[0].modules.map((m) => m.name)).toEqual(["Alpha", "New Sub", "Beta", "Gamma"]);
    expect(docModById(before, createdId).parentId).toBe("m-alpha");

    // reload — idempotent seed keeps the mutation; app re-reads localStorage
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('.tabBtn[data-tab="timeline"]').click();
    await page.locator("#leftBody .modRow").first().waitFor();

    await expect.poll(() => gridModNames(page)).toEqual(["Alpha", "New Sub", "Beta", "Gamma"]);
    expect(await isSubMod(page, "New Sub")).toBe(true);
    await assertAligned(page, "after reload");

    const after = await readDoc(page);
    expect(after.projects[0].modules.map((m) => m.name)).toEqual(["Alpha", "New Sub", "Beta", "Gamma"]);
    expect(docModById(after, createdId).parentId).toBe("m-alpha");
  });
});

/* ============================ HARD SAFETY =============================== */
test.describe("safety — production API is blocked", () => {
  test("no request ever reaches the production Worker (all aborted)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    // force a Store.save() → debounced cloudPush attempt
    await page.locator('#leftBody .modRow[data-mi="0"] .caret').click(); // toggle collapse
    await page.waitForTimeout(1100); // > 800ms push debounce

    const prod = page._prod;
    // The app genuinely ATTEMPTS to reach production (cloudSync on load + cloudPush on
    // save); the safety guarantee is that every attempt is aborted and NONE reach it.
    expect(prod.attempts.length, "app should have attempted at least one prod sync").toBeGreaterThan(0);
    expect(prod.reached, `requests reached production: ${prod.reached.join(", ")}`).toEqual([]);
    expect(prod.failed.length, "every prod attempt must be aborted").toBe(prod.attempts.length);
  });
});
