// v1.0.6 E5 — grip-menu Sub-Module creation (spec §5.4, binding R-E5a/R-E5b/R-E5c).
// The container grip pill gains a "เพิ่มโมดูลย่อย" button (right after ＋ addfeat) that opens the
// EXISTING สร้างโมดูล modal preset to Sub-Module with the clicked container pre-selected as parent.
// No new modal, no doc-schema change. Host is blocked by fixtures (zero prod requests asserted).
const {
  test, expect,
  SEED_A, SEED_B,
  openTimeline,
  readDoc, nidOf, featNid,
  docFindByName, docFindNode, docParentOf, docCountContainers,
  clickModAct,
} = require("./fixtures");

/* Read {pillW, shift(px translateX on .modMain), opacity} for a module row's grip menu
   (mirror of tree-ui.spec's reader — the R-E5c rail-slide contract). */
async function menuState(page, nid) {
  return page.evaluate((id) => {
    const row = document.querySelector(`#leftBody .modRow[data-nid="${id}"]`);
    const pill = row.querySelector(".gripPill"), main = row.querySelector(".modMain");
    const tr = getComputedStyle(main).transform;
    let tx = 0;
    if (tr && tr !== "none") { const m = tr.match(/matrix\(([^)]+)\)/); if (m) tx = parseFloat(m[1].split(",")[4]); }
    return { pillW: pill.offsetWidth, shift: tx, opacity: +getComputedStyle(pill).opacity };
  }, nid);
}
// Open a container's grip menu (hover the modGrip), return the [data-act] button locator.
async function modMenuBtn(page, name, act) {
  const nid = await nidOf(page, name);
  expect(nid, `container "${name}" not found`).not.toBeNull();
  const row = page.locator(`#leftBody .modRow[data-nid="${nid}"]`);
  await row.locator(".modGrip").hover();
  return row.locator(`.gripPill [data-act="${act}"]`);
}

/* ===================== R-E5a — the addsub button (containers only) ===================== */
test.describe("E5 §5.4 — grip-menu addsub button placement (R-E5a)", () => {
  test("addsub is present on container pills at depth 0 AND depth ≥1, absent on feature pills", async ({ page }) => {
    await openTimeline(page, SEED_B()); // Alpha[fa1,fa2, AlphaSub1[fs1], AlphaSub2[fs2]] · Beta[fb1, BetaSub[fbs1]]

    // depth-0 container (Alpha) — exactly one addsub, with the R-E5a tooltip
    const atRoot = await modMenuBtn(page, "Alpha", "addsub");
    await expect(atRoot, "depth-0 container pill has addsub").toHaveCount(1);
    await expect(atRoot).toBeVisible();
    await expect(atRoot).toHaveAttribute("title", "เพิ่มโมดูลย่อยในโมดูลนี้");

    // depth-1 container (Alpha Sub One) — also has addsub (sub-modules can nest further)
    const atSub = await modMenuBtn(page, "Alpha Sub One", "addsub");
    await expect(atSub, "depth-1 container pill has addsub").toHaveCount(1);
    await expect(atSub).toBeVisible();

    // R-E5a: it sits DIRECTLY AFTER the ＋ addfeat button in the container pill
    const order = await page.evaluate((id) => {
      const pill = document.querySelector(`#leftBody .modRow[data-nid="${id}"] .gripPill`);
      const acts = [...pill.querySelectorAll("button.gm")].map((b) => b.dataset.act);
      const i = acts.indexOf("addfeat");
      return { after: acts[i + 1], hasAddfeat: i >= 0 };
    }, await nidOf(page, "Alpha"));
    expect(order.hasAddfeat).toBe(true);
    expect(order.after, "addsub is directly after addfeat").toBe("addsub");

    // feature pills carry NO addsub (feature branch untouched)
    const fnid = await featNid(page, "Alpha One");
    const frow = page.locator(`#leftBody .featRow[data-nid="${fnid}"]`);
    await frow.locator('.grip[data-act="rowdrag"]').hover();
    await expect(frow.locator('.gripPill [data-act="addsub"]'), "feature pill has no addsub").toHaveCount(0);
    // sanity: the feature pill still offers its own actions (promote), so the pill did open
    await expect(frow.locator('.gripPill [data-act="promote"]')).toBeVisible();
  });
});

/* ===================== R-E5a/R-E5b — clicking addsub presets the modal ===================== */
test.describe("E5 §5.4 — addsub opens the create-module modal preset to Sub-Module (R-E5a/R-E5b)", () => {
  test("depth-0 container: modal opens with Sub-Module active + that container pre-selected", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const alphaNid = await nidOf(page, "Alpha");

    await clickModAct(page, "Alpha", "addsub");

    // same สร้างโมดูล modal — no new modal (#modalRoot is a 0-height block hosting a position:fixed
    // overlay, so we gate on a modal FIELD being visible, per the suite convention)
    await expect(page.locator("#mm_kind")).toBeVisible();
    await expect(page.locator("#modalRoot h2")).toHaveText("สร้างโมดูล");

    // ประเภท preset to โมดูลย่อย · Sub-Module
    await expect(page.locator('#mm_kind button[data-k="sub"]'), "Sub-Module segment active").toHaveClass(/on/);
    await expect(page.locator('#mm_kind button[data-k="main"]'), "Module segment NOT active").not.toHaveClass(/on/);

    // parent field shown, Alpha pre-selected
    await expect(page.locator("#mm_parentField")).toBeVisible();
    await expect(page.locator("#mm_parent")).toHaveValue(alphaNid);

    // R-E5b: the dropdown still lists ALL containers (SEED_B has 5), preset only changes the selected one
    await expect(page.locator("#mm_parent option")).toHaveCount(5);
  });

  test("depth-1 container: addsub presets that sub-module as the parent", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const subNid = await nidOf(page, "Alpha Sub One");

    await clickModAct(page, "Alpha Sub One", "addsub");

    await expect(page.locator('#mm_kind button[data-k="sub"]')).toHaveClass(/on/);
    await expect(page.locator("#mm_parent")).toHaveValue(subNid);
    // parent may still be switched — the preset is not locked (R-E5a): every container is selectable
    await expect(page.locator("#mm_parent option")).toHaveCount(5);
  });
});

/* ===================== R-E5b — saving nests the sub-container correctly ===================== */
test.describe("E5 §5.4 — saving the preset modal creates the sub-container under the parent (R-E5b)", () => {
  test("new container lands as a CHILD of the clicked parent, revealed + flashed", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const alphaNid = await nidOf(page, "Alpha");

    // Collapse Alpha FIRST so the post-save reveal is discriminating: SEED_B's Alpha is created
    // collapsed:false (mkMod default), so asserting collapsed===false without this would be vacuous —
    // a regression dropping revealInto(np) from the addsub save path would slip through. With Alpha
    // genuinely collapsed, collapsed===false after save PROVES revealInto ran (mirrors tree-ui R6).
    await page.locator(`#leftBody .modRow[data-nid="${alphaNid}"] .caret`).click();
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, alphaNid).collapsed)).toBe(true);

    await clickModAct(page, "Alpha", "addsub");
    await page.locator("#mm_name").fill("New Child Mod");
    await page.locator("#mm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();

    // it appears in the grid…
    await expect.poll(() =>
      page.$$eval("#leftBody .modRow .modName", (els) => els.map((e) => e.textContent)).then((n) => n.includes("New Child Mod"))
    ).toBe(true);

    // …as a CONTAINER, nested under Alpha (assert via the stored tree)
    const d = await readDoc(page);
    const node = docFindByName(d, "New Child Mod");
    expect(node, "new node saved").not.toBeNull();
    expect(node.kind, "created as a container (sub-module)").toBe("container");
    expect(docParentOf(d, node.id).id, "parent is the clicked container").toBe(alphaNid);
    expect(docCountContainers(d), "container count grew by exactly one (5 → 6)").toBe(6);

    // R6 reveal: Alpha was collapsed above; saving a sub-module into it must revealInto → re-expand it
    expect(docFindNode(d, alphaNid).collapsed, "collapsed parent revealed on save (revealInto ran)").toBe(false);

    // depth ≥1 ⇒ renders as a sub-module row
    const newNid = node.id;
    await expect(page.locator(`#leftBody .modRow[data-nid="${newNid}"]`)).toHaveClass(/subMod/);

    // G6c flash: the new row pulses in BOTH panes (added synchronously by apply→flashNode)
    const flashed = await page.evaluate((id) => {
      const l = document.querySelector(`#leftBody .modRow[data-nid="${id}"]`);
      const r = document.querySelector(`#rowsLayer .modBarRow[data-nid="${id}"]`);
      return { left: !!l && l.classList.contains("flashRow"), right: !!r && r.classList.contains("flashRow") };
    }, newNid);
    expect(flashed.left, "new sub-module row flashes (left)").toBe(true);
    expect(flashed.right, "new sub-module bar-row flashes (chart)").toBe(true);
  });

  test("the preset parent can be overridden before save (not locked)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const betaNid = await nidOf(page, "Beta");

    await clickModAct(page, "Alpha", "addsub");      // preset = Alpha …
    await page.locator("#mm_name").fill("Retargeted Sub");
    await page.selectOption("#mm_parent", betaNid);  // …user switches parent to Beta
    await page.locator("#mm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();

    await expect.poll(async () => {
      const d = await readDoc(page);
      const n = docFindByName(d, "Retargeted Sub");
      return n ? docParentOf(d, n.id).id : null;
    }).toBe(betaNid);
  });
});

/* ===================== no-arg path unchanged (topbar Module button) ===================== */
test.describe("E5 §5.4 — the no-arg moduleModal path is byte-identical to today", () => {
  test("the topbar Module button opens the modal in default main-module state (no preset)", async ({ page }) => {
    await openTimeline(page, SEED_B()); // containers exist, yet no arg ⇒ still defaults to main

    await page.locator("#btnAddMod").click();
    await expect(page.locator("#mm_kind")).toBeVisible();
    await expect(page.locator('#mm_kind button[data-k="main"]'), "default is Module").toHaveClass(/on/);
    await expect(page.locator('#mm_kind button[data-k="sub"]')).not.toHaveClass(/on/);
    await expect(page.locator("#mm_parentField"), "parent field hidden while main").toBeHidden();
  });

  test("no-arg create still makes a ROOT (depth-0) module", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await page.locator("#btnAddMod").click();
    await page.locator("#mm_name").fill("Fresh Root");
    await page.locator("#mm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();

    await expect.poll(async () => {
      const d = await readDoc(page);
      const n = docFindByName(d, "Fresh Root");
      return n ? docParentOf(d, n.id) : "missing"; // root ⇒ parent null
    }).toBeNull();
  });
});

/* ===================== R-E5c — the wider pill still slides content clear ===================== */
test.describe("E5 §5.4 — R-E5c rail-slide: the +1-button pill never overlays row content", () => {
  test("with the container menu open, .modMain slides right by the measured pill width (name clears)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const nid = await nidOf(page, "Alpha");
    const row = page.locator(`#leftBody .modRow[data-nid="${nid}"]`);

    // closed at rest → no shift
    expect((await menuState(page, nid)).shift, "no shift while closed").toBeLessThanOrEqual(1);

    // open the menu
    await row.locator(".modGrip").hover();
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);

    const st = await menuState(page, nid);
    expect(st.pillW, "pill measured to a real width (adapts to the extra button)").toBeGreaterThan(40);

    // G2 contract: content slides right by EXACTLY the measured pill width (sizeGripRails adapted automatically)
    await expect
      .poll(() => menuState(page, nid).then((s) => Math.abs(s.shift - s.pillW)))
      .toBeLessThanOrEqual(2);

    // geometric no-overlay proof: the shifted content strip starts at/after the open pill's right edge
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const r = document.querySelector(`#leftBody .modRow[data-nid="${id}"]`);
          const pill = r.querySelector(".gripPill").getBoundingClientRect();
          const main = r.querySelector(".modMain").getBoundingClientRect();
          return main.left - pill.right; // ≥ ~0 when content clears the pill
        }, nid)
      )
      .toBeGreaterThanOrEqual(-2);
  });
});
