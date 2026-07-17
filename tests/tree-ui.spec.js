// v1.0.4 tree-ui (Stage 2): grip menu (slide-open pill + content slide via measured --railW),
// shared predicates + guard matrix, indent/outdent/promote/demote/add/edit/delete through the menu,
// R6 reveal-and-flash, R7 promote/demote losslessness, R3 cancel-leaves-nothing, unified edit modal,
// stepped shading. Reuses ./fixtures so the production-Worker block + pageerror/console guards are
// unconditional (see fixtures.js). Alignment (assertAligned) is asserted after every mutation class.
const {
  test, expect,
  SEED_A, SEED_B, mkDoc, mkMod, mkFeat,
  openProject, openTimeline,
  readDoc, assertAligned,
  gridModNames, gridFeatNames,
  nidOf, featNid,
  docFindNode, docFindByName, docParentOf, docCountContainers, docCountFeatures,
  clickModAct, clickFeatAct, dragFeature,
} = require("./fixtures");

/* A fully-specified v2 feature (all feature fields incl. a custom column) for the R7 lossless test. */
function DOC_FULL() {
  return {
    projects: [{
      id: "test-proj", name: "Full", client: "QA", code: "TP", color: 0,
      createdAt: "2026-01-01", updatedAt: "2026-01-01",
      customCols: [{ id: "owner", label: "Owner", w: 120, kind: "text" }],
      colOrder: ["name", "description", "start", "end", "status", "remark", "c:owner"],
      progressOrder: [], summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
      docVer: 2,
      modules: [{
        id: "m-root", kind: "container", name: "Root", description: "", color: 0, collapsed: false,
        children: [
          { id: "feat-full", kind: "feature", fid: "FID-1", name: "Full Feature", description: "a desc",
            start: "2026-07-05", end: "2026-07-20", status: "in_progress", remark: "a remark", custom: { owner: "Keng" } },
          { id: "sib", kind: "feature", fid: "", name: "Sibling", description: "", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} },
        ],
      }],
    }],
  };
}

/* Read {pillW, shift(px translateX on .modMain), opacity} for a module row's grip menu. */
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
/* G2: same reader for a FEATURE row — the cell strip lives in .rowMain (mirrors .modMain). */
async function featMenuState(page, nid) {
  return page.evaluate((id) => {
    const row = document.querySelector(`#leftBody .featRow[data-nid="${id}"]`);
    const pill = row.querySelector(".gripPill"), main = row.querySelector(".rowMain");
    const tr = getComputedStyle(main).transform;
    let tx = 0;
    if (tr && tr !== "none") { const m = tr.match(/matrix\(([^)]+)\)/); if (m) tx = parseFloat(m[1].split(",")[4]); }
    return { pillW: pill.offsetWidth, shift: tx, opacity: +getComputedStyle(pill).opacity };
  }, nid);
}
/* L0 > L1 > L2 > deepFeat — deepFeat is a depth-3 feature (for the deep grip-menu click test). */
function DEEP_DOC() {
  return {
    projects: [{
      id: "test-proj", name: "Deep", client: "QA", code: "TP", color: 0,
      createdAt: "2026-01-01", updatedAt: "2026-01-01", customCols: [],
      colOrder: ["name", "description", "start", "end", "status", "remark"], progressOrder: [],
      summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
      docVer: 2,
      modules: [{
        id: "c0", kind: "container", name: "L0", color: 0, collapsed: false, children: [{
          id: "c1", kind: "container", name: "L1", color: 1, collapsed: false, children: [{
            id: "c2", kind: "container", name: "L2", color: 2, collapsed: false, children: [
              { id: "deepFeat", kind: "feature", fid: "", name: "Deep Feat", description: "", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} },
            ],
          }],
        }],
      }],
    }],
  };
}

/* ===================== grip-menu mechanics (§1.1) ===================== */
test.describe("grip menu — open/close mechanics", () => {
  test("grip hover opens the pill (buttons revealed); plain row hover does NOT open", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const nid = await nidOf(page, "Alpha");
    const row = page.locator(`#leftBody .modRow[data-nid="${nid}"]`);

    // closed at rest
    expect((await menuState(page, nid)).opacity).toBeLessThan(0.05);

    // plain row hover (over the name, NOT the grip) must NOT open the menu
    await row.locator(".modName").hover();
    expect((await menuState(page, nid)).opacity, "plain row hover keeps the menu closed").toBeLessThan(0.05);

    // grip hover opens it
    await row.locator(".modGrip").hover();
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);
    // a menu button is now actually clickable (receives events)
    await expect(row.locator('.gripPill [data-act="modup"]')).toBeVisible();
    await assertAligned(page, "menu open");
  });

  test("row content (.modMain) slides right by EXACTLY the measured pill width", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const nid = await nidOf(page, "Alpha");
    const row = page.locator(`#leftBody .modRow[data-nid="${nid}"]`);
    const closed = await menuState(page, nid);
    expect(closed.shift, "no shift while closed").toBeLessThanOrEqual(1);

    await row.locator(".modGrip").hover();
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);
    const pillW = (await menuState(page, nid)).pillW;
    expect(pillW, "pill has real measured width").toBeGreaterThan(40);
    // the shift transitions over .2s → poll until it settles at the measured pill width
    await expect
      .poll(() => menuState(page, nid).then((s) => Math.abs(s.shift - s.pillW)))
      .toBeLessThanOrEqual(2);
  });

  test("focus-within keeps the menu open; blur closes it", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const nid = await nidOf(page, "Alpha");
    // focus a pill button via keyboard path (JS focus) → :focus-within opens the pill even without hover
    await page.evaluate((id) => document.querySelector(`#leftBody .modRow[data-nid="${id}"] .gripPill [data-act="editmod"]`).focus(), nid);
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);
    expect((await menuState(page, nid)).shift, "content shifted while focus-within").toBeGreaterThan(40);
    // blur → closes
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeLessThan(0.05);
  });

  test("close on leave — moving off the grip closes the menu", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const nid = await nidOf(page, "Alpha");
    const row = page.locator(`#leftBody .modRow[data-nid="${nid}"]`);
    await row.locator(".modGrip").hover();
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);
    await page.locator("#pName").hover(); // move well away (topbar)
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeLessThan(0.05);
  });
});

/* ===================== guard matrix (R5 shared predicates) ===================== */
test.describe("guard matrix — menu disabled-states reflect the shared predicates", () => {
  // SEED_B: Alpha[fa1,fa2, AlphaSub1[fs1], AlphaSub2[fs2]] · Beta[fb1, BetaSub[fbs1]]
  async function menuBtn(page, sel, act) {
    // open the row's grip menu, return its [data-act] button locator
    const isFeat = sel.startsWith("feat:");
    const nid = isFeat ? sel.slice(5) : await nidOf(page, sel);
    const row = page.locator(`#leftBody .${isFeat ? "featRow" : "modRow"}[data-nid="${nid}"]`);
    await row.locator(isFeat ? '.grip[data-act="rowdrag"]' : ".modGrip").hover();
    return row.locator(`.gripPill [data-act="${act}"]`);
  }

  test("first child cannot indent (no previous sibling)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await expect(await menuBtn(page, "feat:fa1", "indent"), "fa1 is Alpha's first child").toBeDisabled();
  });

  test("a node whose previous sibling is a FEATURE cannot indent; one after a CONTAINER can", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // AlphaSub1's previous sibling is fa2 (a feature) → indent disabled
    await expect(await menuBtn(page, "Alpha Sub One", "indent")).toBeDisabled();
    // AlphaSub2's previous sibling is AlphaSub1 (a container) → indent ENABLED
    await expect(await menuBtn(page, "Alpha Sub Two", "indent")).toBeEnabled();
  });

  test("a feature at depth 1 cannot outdent (root holds containers only)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await expect(await menuBtn(page, "feat:fa1", "outdent"), "fa1 sits directly under a root container").toBeDisabled();
    // a depth-2 feature CAN outdent
    await expect(await menuBtn(page, "feat:fs1", "outdent")).toBeEnabled();
  });

  test("a container WITH children cannot demote (menu ⇄ disabled AND modal Type lock)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await expect(await menuBtn(page, "Alpha", "promote"), "Alpha has children → demote disabled").toBeDisabled();
    // and the same guard in the unified edit modal
    await clickModAct(page, "Alpha", "editmod");
    await expect(page.locator('#nm_type button[data-t="feature"]')).toBeDisabled();
    await expect(page.locator("#nm_lockHint")).toBeVisible();
  });

  test("a feature row has NO ＋ add-feature button (canAddChild false)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const row = page.locator('#leftBody .featRow[data-nid="fa1"]');
    await row.locator('.grip[data-act="rowdrag"]').hover();
    await expect(row.locator('.gripPill [data-act="addfeat"]')).toHaveCount(0);
    // …but it DOES offer promote (feature → module)
    await expect(row.locator('.gripPill [data-act="promote"]')).toBeEnabled();
  });
});

/* ===================== every action through the menu ===================== */
test.describe("menu actions — structure moves + edit/delete (each with doc-shape + alignment)", () => {
  test("indent tucks a node under its previous-sibling container (then outdent restores)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // AlphaSub2 → indent under AlphaSub1
    await clickModAct(page, "Alpha Sub Two", "indent");
    await expect.poll(() => readDoc(page).then((d) => docParentOf(d, "m-a-sub2").id)).toBe("m-a-sub1");
    await assertAligned(page, "after indent");

    // outdent AlphaSub2 back to Alpha, positioned right after its former parent (AlphaSub1)
    await clickModAct(page, "Alpha Sub Two", "outdent");
    await expect.poll(() => readDoc(page).then((d) => docParentOf(d, "m-a-sub2").id)).toBe("m-alpha");
    const alpha = docFindNode(await readDoc(page), "m-alpha");
    const kids = alpha.children.map((c) => c.id);
    expect(kids.indexOf("m-a-sub2")).toBe(kids.indexOf("m-a-sub1") + 1); // inserted right AFTER the former parent
    await assertAligned(page, "after outdent");
  });

  test("promote a feature → container, then demote it back → feature", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const cBefore = docCountContainers(await readDoc(page));
    await clickFeatAct(page, "fa1", "promote");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").kind)).toBe("container");
    expect(docCountContainers(await readDoc(page))).toBe(cBefore + 1);
    await assertAligned(page, "after promote");

    // fa1 is now a childless container named "Alpha One" → demote via the ⇄ button
    await clickModAct(page, "Alpha One", "promote");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").kind)).toBe("feature");
    await assertAligned(page, "after demote");
  });

  test("add-feature via the menu ＋ opens the create modal (creation on save only, R3)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await clickModAct(page, "Beta", "addfeat");
    await expect(page.locator("#fm_name")).toBeVisible();
    await page.locator("#fm_name").fill("Menu Made");
    await page.locator("#fm_save").click();
    await expect.poll(() => gridFeatNames(page).then((n) => n.includes("Menu Made"))).toBe(true);
    expect(docParentOf(await readDoc(page), docFindByName(await readDoc(page), "Menu Made").id).id).toBe("m-beta");
    await assertAligned(page, "after add via menu");
  });

  test("edit via the menu ✎ opens the unified modal and saves the rename", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await clickModAct(page, "Alpha", "editmod");
    await expect(page.locator("#nm_name")).toHaveValue("Alpha");
    await page.locator("#nm_name").fill("Alpha Renamed");
    await page.locator("#nm_save").click();
    await expect.poll(() => gridModNames(page)).toEqual(["Alpha Renamed", "Beta", "Gamma"]);
    await assertAligned(page, "after edit via menu");
  });

  test("delete via the menu 🗑 cascades with the inside-count confirm", async ({ page }) => {
    await openTimeline(page, SEED_B());
    let msg = "";
    page.once("dialog", (d) => { msg = d.message(); d.accept(); });
    await clickModAct(page, "Alpha", "delmod");
    expect(msg).toContain('ลบ "Alpha"');
    expect(msg).toContain("และ 6 รายการข้างใน");
    await expect.poll(() => gridModNames(page)).toEqual(["Beta", "Beta Sub"]);
    await assertAligned(page, "after delete via menu");
  });

  test("up/down via the menu reorders a feature (with alignment)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await clickFeatAct(page, "fa1", "down");
    await expect.poll(() => gridFeatNames(page).then((n) => n.indexOf("Alpha Two") < n.indexOf("Alpha One"))).toBe(true);
    await assertAligned(page, "after menu down");
  });
});

/* ===================== R7 — promote/demote losslessness ===================== */
test.describe("R7 — feature fields survive promote → add child → delete child → demote", () => {
  test("byte-identical field restoration (FULL node, no container-only keys)", async ({ page }) => {
    await openTimeline(page, DOC_FULL());
    // Hardening #2: snapshot the FULL node JSON (no destructuring) so a leaked container-only key
    // (children/collapsed/features/color) or any mutated field is caught, not silently dropped.
    const before = JSON.stringify(docFindNode(await readDoc(page), "feat-full"));

    // promote (feature → container) — all feature fields stay DORMANT on the node
    await clickFeatAct(page, "feat-full", "promote");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "feat-full").kind)).toBe("container");

    // add a child into it (via its now-visible ＋), then delete that child
    await clickModAct(page, "Full Feature", "addfeat");
    await page.locator("#fm_name").fill("Temp Child");
    await page.locator("#fm_save").click();
    await expect.poll(() => gridFeatNames(page).then((n) => n.includes("Temp Child"))).toBe(true);
    const childNid = await featNid(page, "Temp Child");
    page.once("dialog", (d) => d.accept());
    await clickFeatAct(page, childNid, "delfeat");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "feat-full").children.length)).toBe(0);

    // demote the (again childless) container → feature; dormant fields revive verbatim
    await clickModAct(page, "Full Feature", "promote");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "feat-full").kind)).toBe("feature");

    const node = docFindNode(await readDoc(page), "feat-full");
    expect("children" in node, "no dangling children key").toBe(false);
    expect("collapsed" in node, "no dangling collapsed key").toBe(false);
    expect("features" in node, "no dangling features (mirror) key").toBe(false);
    expect("color" in node, "a feature carries no colour of its own").toBe(false);
    expect(JSON.stringify(node), "FULL node byte-identical after the round-trip").toBe(before);
    await assertAligned(page, "R7 round-trip");
  });

  // Hardening #3: the MODAL Type control must be exactly as lossless as the menu ⇄ path.
  test("modal-path Type round-trip restores the feature byte-identically", async ({ page }) => {
    await openTimeline(page, DOC_FULL());
    const before = JSON.stringify(docFindNode(await readDoc(page), "feat-full"));

    // feature → container via the modal Type control
    await clickFeatAct(page, "feat-full", "editfeat");
    await page.locator('#nm_type button[data-t="container"]').click();
    await page.locator("#nm_save").click();
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "feat-full").kind)).toBe("container");

    // container → feature via the modal Type control (childless, non-root ⇒ allowed)
    await clickModAct(page, "Full Feature", "editmod");
    await expect(page.locator('#nm_type button[data-t="feature"]')).toBeEnabled();
    await page.locator('#nm_type button[data-t="feature"]').click();
    await page.locator("#nm_save").click();
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "feat-full").kind)).toBe("feature");

    const node = docFindNode(await readDoc(page), "feat-full");
    expect("children" in node).toBe(false);
    expect("collapsed" in node).toBe(false);
    expect("color" in node, "a demoted feature carries no colour").toBe(false);
    expect(JSON.stringify(node), "modal Type round-trip byte-identical (same rigor as the menu path)").toBe(before);
    await assertAligned(page, "modal R7 round-trip");
  });
});

/* ===================== R6 — reveal-and-flash ===================== */
test.describe("R6 — reveal-and-flash", () => {
  test("indent into a COLLAPSED previous-sibling container auto-expands it + flashes the moved row", async ({ page }) => {
    // Build Alpha[fa1, Sub1[], Sub2[]] then collapse Sub1; indent Sub2 into the collapsed Sub1.
    const doc = mkDoc([
      mkMod("m-alpha", "Alpha", { features: [mkFeat("fa1", "Alpha One")] }),
      mkMod("m-s1", "Sub One", { parentId: "m-alpha" }),
      mkMod("m-s2", "Sub Two", { parentId: "m-alpha" }),
    ]);
    await openTimeline(page, doc);
    // collapse Sub1 (the previous sibling that Sub2 will indent into)
    await page.locator('#leftBody .modRow[data-nid="m-s1"] .caret').click();
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "m-s1").collapsed)).toBe(true);

    await clickModAct(page, "Sub Two", "indent");
    // auto-expanded (R6) + re-parented
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "m-s1").collapsed)).toBe(false);
    expect(docParentOf(await readDoc(page), "m-s2").id).toBe("m-s1");
    // the moved row carries the transient flash class (added synchronously by apply→flashNode)
    const flashed = await page.evaluate(() => {
      const l = document.querySelector('#leftBody .modRow[data-nid="m-s2"]');
      const r = document.querySelector('#rowsLayer .modBarRow[data-nid="m-s2"]');
      return { left: !!l && l.classList.contains("flashRow"), right: !!r && r.classList.contains("flashRow") };
    });
    expect(flashed.left, "left row flashes").toBe(true);
    expect(flashed.right, "chart row flashes").toBe(true);
    await assertAligned(page, "reveal on indent");
  });

  test("a feature drag also flashes the moved row", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await dragFeature(page, "fa1", "fa2", "after");
    const flashed = await page.evaluate(() => {
      const l = document.querySelector('#leftBody .featRow[data-nid="fa1"]');
      const r = document.querySelector('#rowsLayer .bar[data-nid="fa1"]');
      return { left: !!l && l.classList.contains("flashRow"), right: !!r && r.classList.contains("flashRow") };
    });
    expect(flashed.left).toBe(true);
    expect(flashed.right).toBe(true);
  });
});

/* ===================== R3 — cancel leaves the doc byte-identical ===================== */
test.describe("R3 — open + cancel the grip modals changes nothing", () => {
  test("the unified EDIT modal cancel is a no-op", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const before = JSON.stringify(await readDoc(page));
    await clickModAct(page, "Alpha", "editmod");
    await expect(page.locator("#nm_name")).toBeVisible();
    // change a field then cancel — nothing persists
    await page.locator("#nm_name").fill("SHOULD NOT SAVE");
    await page.locator('#modalRoot [data-act="cancel"]').click();
    await expect(page.locator("#modalRoot")).toBeHidden();
    expect(JSON.stringify(await readDoc(page)), "edit-modal cancel byte-identical").toBe(before);
  });

  test("the CREATE (＋) modal cancel is a no-op", async ({ page }) => {
    await openTimeline(page, SEED_B());
    const before = JSON.stringify(await readDoc(page));
    await clickModAct(page, "Alpha", "addfeat");
    await expect(page.locator("#fm_name")).toBeVisible();
    await page.locator("#fm_name").fill("ghost");
    await page.locator('#modalRoot [data-act="cancel"]').click();
    await expect(page.locator("#modalRoot")).toBeHidden();
    expect(JSON.stringify(await readDoc(page)), "create-modal cancel byte-identical").toBe(before);
  });
});

/* ===================== unified edit modal (§1.5) ===================== */
test.describe("unified edit modal — container fields, feature clamp, Type round-trip", () => {
  test("container: rename + description + colour all persist", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await clickModAct(page, "Alpha", "editmod");
    await page.locator("#nm_name").fill("Alpha X");
    await page.locator("#nm_desc").fill("new description");
    await page.locator("#nm_sw .swatch").nth(3).click(); // pick colour index 3
    await page.locator("#nm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();
    const n = docFindByName(await readDoc(page), "Alpha X");
    expect(n).toBeTruthy();
    expect(n.description).toBe("new description");
    expect(n.color).toBe(3);
    await assertAligned(page, "container edit");
  });

  test("feature: an end < start is clamped to start on save", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await clickFeatAct(page, "fa1", "editfeat");
    await expect(page.locator("#nm_start")).toBeVisible();
    await page.locator("#nm_start").fill("2026-08-01");
    await page.locator("#nm_end").fill("2026-07-01"); // before start
    await page.locator("#nm_save").click();
    await expect(page.locator("#modalRoot")).toBeHidden();
    const f = docFindNode(await readDoc(page), "fa1");
    expect(f.start).toBe("2026-08-01");
    expect(f.end).toBe("2026-08-01"); // clamped up to start
    await assertAligned(page, "feature clamp");
  });

  test("Type round-trip: feature → container → (childless) → feature via the modal", async ({ page }) => {
    await openTimeline(page, SEED_A());
    // feature fa1 → container via the Type control
    await clickFeatAct(page, "fa1", "editfeat");
    await page.locator('#nm_type button[data-t="container"]').click();
    await page.locator("#nm_save").click();
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").kind)).toBe("container");
    // it is now a childless container "Alpha One" → Type control unlocked → back to feature
    await clickModAct(page, "Alpha One", "editmod");
    await expect(page.locator('#nm_type button[data-t="feature"]')).toBeEnabled();
    await page.locator('#nm_type button[data-t="feature"]').click();
    await page.locator("#nm_save").click();
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "fa1").kind)).toBe("feature");
    await assertAligned(page, "type round-trip");
  });
});

/* ===================== stepped indent shading (left pane, §1.9) ===================== */
// --shade is a custom property (raw token stream, NOT normalised by getComputedStyle) → resolve it
// through a probe element's background-color, which IS normalised, then compare.
async function shadeRGB(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s); if (!el) return null;
    const raw = getComputedStyle(el).getPropertyValue("--shade").trim();
    const probe = document.createElement("span"); probe.style.backgroundColor = raw; document.body.appendChild(probe);
    const norm = getComputedStyle(probe).backgroundColor; probe.remove(); return norm;
  }, sel);
}
test.describe("stepped indent shading — --shade grows per depth (holds at depth ≥3)", () => {
  test("depth 0 has no tint; depth-1 rows carry rgba(146,65,255, .03)", async ({ page }) => {
    await openTimeline(page, SEED_B());
    // depth-0 root container → transparent
    expect(await shadeRGB(page, '#leftBody .modRow[data-nid="m-alpha"]')).toBe("rgba(0, 0, 0, 0)");
    // depth-1 sub-container → .03
    expect(await shadeRGB(page, '#leftBody .modRow[data-nid="m-a-sub1"]')).toBe("rgba(146, 65, 255, 0.03)");
    // depth-1 feature (fa1 under root Alpha) → .03
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="fa1"]')).toBe("rgba(146, 65, 255, 0.03)");
    // depth-2 feature (fs1 under Alpha Sub One) → .06
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="fs1"]')).toBe("rgba(146, 65, 255, 0.06)");
  });

  test("shading + rail ladder hold at depth ≥3", async ({ page }) => {
    // L0[ L1[ L2[ deepFeat ] ] ] — deepFeat is depth 3.
    const doc = {
      projects: [{
        id: "test-proj", name: "Deep", client: "QA", code: "TP", color: 0,
        createdAt: "2026-01-01", updatedAt: "2026-01-01", customCols: [],
        colOrder: ["name", "description", "start", "end", "status", "remark"], progressOrder: [],
        summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
        docVer: 2,
        modules: [{
          id: "c0", kind: "container", name: "L0", color: 0, collapsed: false, children: [{
            id: "c1", kind: "container", name: "L1", color: 1, collapsed: false, children: [{
              id: "c2", kind: "container", name: "L2", color: 2, collapsed: false, children: [
                { id: "deepFeat", kind: "feature", fid: "", name: "Deep Feat", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} },
              ],
            }],
          }],
        }],
      }],
    };
    await openTimeline(page, doc);
    expect(await shadeRGB(page, '#leftBody .modRow[data-nid="c2"]'), "depth-2 container").toBe("rgba(146, 65, 255, 0.06)");
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="deepFeat"]'), "depth-3 feature").toBe("rgba(146, 65, 255, 0.09)");
    // the depth-3 feature shows an ancestor rail ladder — its resolved band width is one --step (24px).
    const bgSize = await page.evaluate(() => getComputedStyle(document.querySelector('#leftBody .featRow[data-nid="deepFeat"]')).backgroundSize);
    expect(bgSize.startsWith("24px"), `ladder band width (backgroundSize=${bgSize}) resolves to one step`).toBe(true);
    await assertAligned(page, "deep shading");
  });
});

/* ===================== G2 — feature rows: grip at the front, cells slide, never overlaid ===================== */
test.describe("G2 — feature-row grip menu behaves like a container row (no overlay)", () => {
  test("closed: feature cell x-positions line up with the header columns", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const geo = await page.evaluate(() => {
      const heads = [...document.querySelectorAll("#leftHead .colHead")].map((h) => Math.round(h.getBoundingClientRect().left));
      const row = document.querySelector('#leftBody .featRow[data-nid="fa1"]');
      const cells = [...row.querySelectorAll(".rowMain > .cell")].map((c) => Math.round(c.getBoundingClientRect().left));
      return { heads, cells };
    });
    expect(geo.cells.length, "one cell per header column").toBe(geo.heads.length);
    for (let i = 0; i < geo.heads.length; i++) {
      expect(Math.abs(geo.cells[i] - geo.heads[i]), `feature cell ${i} x must equal header ${i} x (closed-state geometry unchanged)`).toBeLessThanOrEqual(1);
    }
  });

  test("closed: the grip menu adds no horizontal flow (rowMain not shifted at rest)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    expect((await featMenuState(page, "fa1")).shift, "no shift while closed").toBeLessThanOrEqual(1);
    expect((await featMenuState(page, "fa1")).opacity, "pill closed at rest").toBeLessThan(0.05);
  });

  test("open: the pill never overlays a cell (pill right edge <= shifted rowMain left edge +2px)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const row = page.locator('#leftBody .featRow[data-nid="fa1"]');
    await row.locator('.grip[data-act="rowdrag"]').hover();
    await expect.poll(() => featMenuState(page, "fa1").then((s) => s.opacity)).toBeGreaterThan(0.9);
    // the pill has a real measured width, and the cell strip slid right to clear it
    expect((await featMenuState(page, "fa1")).pillW, "pill has real measured width").toBeGreaterThan(40);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const r = document.querySelector('#leftBody .featRow[data-nid="fa1"]');
          const pill = r.querySelector(".gripPill"), main = r.querySelector(".rowMain");
          return Math.round(pill.getBoundingClientRect().right - main.getBoundingClientRect().left);
        })
      )
      .toBeLessThanOrEqual(2);
  });

  test("a pill button click works on a DEPTH-3 feature row", async ({ page }) => {
    await openTimeline(page, DEEP_DOC());
    // clicking ✎ on the depth-3 feature must hit the button (not the front grip) → opens the edit modal
    await clickFeatAct(page, "deepFeat", "editfeat");
    await expect(page.locator("#nm_name")).toHaveValue("Deep Feat");
  });

  test("column resize live-updates feature cells inside .rowMain (onColResizeMove retarget)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const cellSel = '#leftBody .featRow[data-nid="fa1"] .rowMain > .cell.feat';
    const wBefore = await page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().width), cellSel);
    const rz = await page.locator('.colHead[data-key="name"] .colResize').boundingBox();
    await page.mouse.move(rz.x + rz.width / 2, rz.y + rz.height / 2);
    await page.mouse.down();
    await page.mouse.move(rz.x + 70, rz.y + rz.height / 2, { steps: 8 });
    // DURING the drag (before mouseup/settle) the cell already grew — only true if the retarget hits .rowMain children
    const wDuring = await page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().width), cellSel);
    await page.mouse.up();
    expect(wDuring, "feature cell live-resized via .rowMain retarget").toBeGreaterThan(wBefore + 40);
    await assertAligned(page, "after live resize");
  });
});

/* ===================== G1 — root containers can never demote ===================== */
test.describe("G1 — a root container never demotes into a recovery wrapper", () => {
  function ROOT_DOC() {
    return mkDoc([
      mkMod("m-empty", "Empty Root"), // childless ROOT container
      mkMod("m-beta", "Beta", { features: [mkFeat("fb1", "Beta One")] }),
    ]);
  }
  test("menu ⇄ is disabled for a childless ROOT container", async ({ page }) => {
    await openTimeline(page, ROOT_DOC());
    const row = page.locator('#leftBody .modRow[data-nid="m-empty"]');
    await row.locator(".modGrip").hover();
    await expect(row.locator('.gripPill [data-act="promote"]'), "root ⇄ disabled").toBeDisabled();
  });

  test("nodeModal Type is locked (with the root hint) for a childless ROOT container", async ({ page }) => {
    await openTimeline(page, ROOT_DOC());
    await clickModAct(page, "Empty Root", "editmod");
    await expect(page.locator('#nm_type button[data-t="feature"]')).toBeDisabled();
    await expect(page.locator('#nm_type button[data-t="container"]')).toBeDisabled();
    await expect(page.locator("#nm_lockHint")).toHaveText("โมดูลระดับบนสุดเปลี่ยนเป็นฟีเจอร์ไม่ได้");
  });

  test("forced demote of a root container leaves the doc byte-identical", async ({ page }) => {
    await openTimeline(page, ROOT_DOC());
    const before = JSON.stringify(await readDoc(page));
    await page.evaluate(() => window.demote("m-empty"));
    expect(JSON.stringify(await readDoc(page)), "root demote is a no-op (byte-identical)").toBe(before);
    expect(docFindNode(await readDoc(page), "m-empty").kind, "still a container").toBe("container");
    // and no "(กู้คืน)" recovery wrapper was ever created
    expect(docFindByName(await readDoc(page), "(กู้คืน)"), "no recovery container").toBeFalsy();
  });

  test("a depth-1 childless container still CAN demote", async ({ page }) => {
    const doc = mkDoc([
      mkMod("m-alpha", "Alpha", { features: [mkFeat("fa1", "Alpha One")] }),
      mkMod("m-sub", "Lonely Sub", { parentId: "m-alpha" }), // childless sub at depth 1
    ]);
    await openTimeline(page, doc);
    const row = page.locator('#leftBody .modRow[data-nid="m-sub"]');
    await row.locator(".modGrip").hover();
    await expect(row.locator('.gripPill [data-act="promote"]'), "depth-1 childless ⇄ enabled").toBeEnabled();
    await clickModAct(page, "Lonely Sub", "promote");
    await expect.poll(() => readDoc(page).then((d) => docFindNode(d, "m-sub").kind)).toBe("feature");
    await assertAligned(page, "after depth-1 demote");
  });
});

/* ===================== G3 — hover / drag-mark keep the ladder + shade layers ===================== */
test.describe("G3 — hover/drag-mark tints do not wipe the layered background", () => {
  const bgImg = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).backgroundImage, sel);

  test("hovering a depth-2 feature row keeps its repeating-linear-gradient", async ({ page }) => {
    await openTimeline(page, SEED_B()); // fs1 is a depth-2 feature
    await page.locator('#leftBody .featRow[data-nid="fs1"]').hover();
    expect(await bgImg(page, '#leftBody .featRow[data-nid="fs1"]')).toContain("repeating-linear-gradient");
  });

  test("a dropBefore-marked feature row keeps its repeating-linear-gradient", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await page.evaluate(() => document.querySelector('#leftBody .featRow[data-nid="fs1"]').classList.add("dropBefore"));
    expect(await bgImg(page, '#leftBody .featRow[data-nid="fs1"]')).toContain("repeating-linear-gradient");
  });

  test("a modDropAfter-marked sub-container row keeps its repeating-linear-gradient", async ({ page }) => {
    await openTimeline(page, SEED_B());
    await page.evaluate(() => document.querySelector('#leftBody .modRow[data-nid="m-a-sub1"]').classList.add("modDropAfter"));
    expect(await bgImg(page, '#leftBody .modRow[data-nid="m-a-sub1"]')).toContain("repeating-linear-gradient");
  });
});

/* ===================== G4 — Esc closes hover-opened grip menus ===================== */
test.describe("G4 — Esc force-closes a hover-opened menu (and focus-opened)", () => {
  test("hover-open → Esc closes while pointer stays on the grip; move away + re-hover reopens", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const nid = await nidOf(page, "Alpha");
    const row = page.locator(`#leftBody .modRow[data-nid="${nid}"]`);
    await row.locator(".modGrip").hover();
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);
    // Esc with the pointer still over the grip → the menu closes (gmSuppress suppresses the :hover open)
    await page.keyboard.press("Escape");
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeLessThan(0.05);
    // move well away (clears gmSuppress on pointerleave), then re-hover → opens again
    await page.locator("#pName").hover();
    await row.locator(".modGrip").hover();
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);
  });

  test("Esc also closes a hover-opened FEATURE-row menu", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const row = page.locator('#leftBody .featRow[data-nid="fa1"]');
    await row.locator('.grip[data-act="rowdrag"]').hover();
    await expect.poll(() => featMenuState(page, "fa1").then((s) => s.opacity)).toBeGreaterThan(0.9);
    await page.keyboard.press("Escape");
    await expect.poll(() => featMenuState(page, "fa1").then((s) => s.opacity)).toBeLessThan(0.05);
  });

  test("focus-open → Esc closes (blur path preserved)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const nid = await nidOf(page, "Alpha");
    await page.evaluate((id) => document.querySelector(`#leftBody .modRow[data-nid="${id}"] .gripPill [data-act="editmod"]`).focus(), nid);
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeGreaterThan(0.9);
    await page.keyboard.press("Escape");
    await expect.poll(() => menuState(page, nid).then((s) => s.opacity)).toBeLessThan(0.05);
  });
});

/* ===================== G6c — creating a row flashes it in BOTH panes ===================== */
test.describe("G6c — create flashes the new row (same reveal rule as a move)", () => {
  test("add-feature via the menu ＋ flashes the new feature row (left + chart)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await clickModAct(page, "Beta", "addfeat");
    await page.locator("#fm_name").fill("Flashy");
    await page.locator("#fm_save").click();
    await expect.poll(() => gridFeatNames(page).then((n) => n.includes("Flashy"))).toBe(true);
    const nid = await featNid(page, "Flashy");
    const flashed = await page.evaluate((id) => {
      const l = document.querySelector(`#leftBody .featRow[data-nid="${id}"]`);
      const r = document.querySelector(`#rowsLayer .bar[data-nid="${id}"]`);
      return { left: !!l && l.classList.contains("flashRow"), right: !!r && r.classList.contains("flashRow") };
    }, nid);
    expect(flashed.left, "new feature row flashes (left)").toBe(true);
    expect(flashed.right, "new feature bar flashes (chart)").toBe(true);
  });

  test("create a module via the toolbar flashes the new module row (left + chart)", async ({ page }) => {
    await openTimeline(page, SEED_A());
    await page.locator("#btnAddMod").click();
    await page.locator("#mm_name").fill("New Mod");
    await page.locator("#mm_save").click();
    await expect.poll(() => gridModNames(page).then((n) => n.includes("New Mod"))).toBe(true);
    const nid = await nidOf(page, "New Mod");
    const flashed = await page.evaluate((id) => {
      const l = document.querySelector(`#leftBody .modRow[data-nid="${id}"]`);
      const r = document.querySelector(`#rowsLayer .modBarRow[data-nid="${id}"]`);
      return { left: !!l && l.classList.contains("flashRow"), right: !!r && r.classList.contains("flashRow") };
    }, nid);
    expect(flashed.left, "new module row flashes (left)").toBe(true);
    expect(flashed.right, "new module bar-row flashes (chart)").toBe(true);
  });
});

/* ===================== R5 — forced illegal mutators no-op (guard de-vacuity) ===================== */
test.describe("R5 — forcing an illegal structure move via evaluate is byte-identical", () => {
  test("forced indent on a first child (no previous sibling) changes nothing", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const before = JSON.stringify(await readDoc(page));
    await page.evaluate(() => window.indent("fa1")); // fa1 is Alpha's first child ⇒ canIndent false
    expect(JSON.stringify(await readDoc(page))).toBe(before);
  });

  test("forced outdent on a depth-1 feature changes nothing", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const before = JSON.stringify(await readDoc(page));
    await page.evaluate(() => window.outdent("fa1")); // depth-1 feature ⇒ canOutdent false (root holds containers only)
    expect(JSON.stringify(await readDoc(page))).toBe(before);
  });

  test("forced demote on a container WITH children changes nothing", async ({ page }) => {
    await openTimeline(page, SEED_A());
    const before = JSON.stringify(await readDoc(page));
    await page.evaluate(() => window.demote("m-alpha")); // has children ⇒ canDemote false
    expect(JSON.stringify(await readDoc(page))).toBe(before);
  });
});

/* ===================== G6a — inline --shade paints the two gradient layers (unbounded) ===================== */
test.describe("G6a — inline stepped shading paints, unbounded past depth 6", () => {
  // L0..L7 nested chain — deepest feature is at depth 7.
  function DEEP7_DOC() {
    let child = { id: "deep7", kind: "feature", fid: "", name: "Deep7", description: "", start: "2026-07-01", end: "2026-07-10", status: "not_started", remark: "", custom: {} };
    for (let d = 6; d >= 0; d--) child = { id: "cc" + d, kind: "container", name: "C" + d, color: d % 8, collapsed: false, children: [child] };
    return {
      projects: [{
        id: "test-proj", name: "Deep7", client: "QA", code: "TP", color: 0,
        createdAt: "2026-01-01", updatedAt: "2026-01-01", customCols: [],
        colOrder: ["name", "description", "start", "end", "status", "remark"], progressOrder: [],
        summary: { current: { id: "s", date: "2026-01-01", text: "" }, history: [] },
        docVer: 2, modules: [child],
      }],
    };
  }
  test("a depth-7 row carries --shade rgba(146,65,255,0.21) — no lvl6 clamp", async ({ page }) => {
    await openTimeline(page, DEEP7_DOC());
    expect(await shadeRGB(page, '#leftBody .featRow[data-nid="deep7"]')).toBe("rgba(146, 65, 255, 0.21)");
  });
  test("the shade AND rail ladder are both real background-image layers (paint-side, not probe-only)", async ({ page }) => {
    await openTimeline(page, DEEP7_DOC());
    const bgi = await page.evaluate(() => getComputedStyle(document.querySelector('#leftBody .featRow[data-nid="deep7"]')).backgroundImage);
    // two gradient layers: the repeating rail ladder + the linear stepped-shade fill
    expect(bgi, "rail ladder layer present").toContain("repeating-linear-gradient");
    expect((bgi.match(/gradient/g) || []).length, "both the ladder and the shade layers paint").toBeGreaterThanOrEqual(2);
  });
});
