// v1.0.5 F2 — Project NOTEs (per-project, two-column-as-tabs, date-sectioned rich-text).
// Reuses ./fixtures so the production-Worker block + pageerror/console guards are
// unconditional (see fixtures.js). Spec: docs/SPEC_v1.0.5.md §4, §5 (T-F2a..g + T-SAFE).
//
// Engine + DOM contract (app.js "PROJECT NOTES (v1.0.5 F2)" / "WORKER-SLOT"):
//   DB.notes[pid] = { business:[{date,html}], technical:[{date,html}], log:[{ts,action,col,date}] }
//   #notesOverlay (display:flex when open) › .notesModal › .tabBar (#notesTabBiz/#notesTabTech)
//     › #notesBody › .noteCol[data-col] (exactly one .active/visible) › .colToolbar (.fmtBtn ×4)
//       + .dateDiv[data-date](.dateChip + .binBtn) + .noteEdit[contenteditable][data-col][data-date]
//   Autosave: input → 600ms debounce → sanitize+collect → Store.save (stamps F1 + cloud-push).
const {
  test, expect,
  SEED_A,
  openProject, readDoc,
} = require("./fixtures");

/* ------------------------------- local helpers ------------------------------- */
const BIZ = '#notesOverlay .noteCol[data-col="business"]';
const TECH = '#notesOverlay .noteCol[data-col="technical"]';
const BIZ_TODAY = BIZ + " .noteEdit.today";
const TECH_TODAY = TECH + " .noteEdit.today";

async function todayIso(page) { return page.evaluate(() => window.iso(window.today())); }

async function openNotes(page) {
  await page.locator("#sumNotes").click();
  await expect(page.locator("#notesOverlay")).toBeVisible();
}

// Build a SEED_A doc with a pre-seeded notes section.
function docWithNotes(notes) { const d = SEED_A(); d.notes = notes; return d; }

// Type into a contenteditable region (click to focus, then keyboard).
async function typeInto(page, selector, text) {
  await page.locator(selector).click();
  await page.keyboard.type(text);
}

// Select the whole contents of a contenteditable region (execCommand needs a live selection;
// the toolbar buttons preserve it via mousedown-preventDefault).
async function selectAll(page, selector) {
  await page.evaluate((s) => {
    const ed = document.querySelector(s); ed.focus();
    const r = document.createRange(); r.selectNodeContents(ed);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  }, selector);
}

// Read a stored day-section's html for a column (or "" if absent).
async function storedHtml(page, col, date) {
  const doc = await readDoc(page);
  const arr = (doc.notes && doc.notes["test-proj"] && doc.notes["test-proj"][col]) || [];
  const hit = arr.find((s) => s && s.date === date);
  return hit ? hit.html : "";
}

/* ============================ T-F2a — open / close / editingNow ============================ */
test.describe("T-F2a — popup opens, business tab active, closes via Esc + backdrop", () => {
  test("T-F2a #notesOverlay opens with exactly one visible .noteCol; editingNow() true; Esc + backdrop close", async ({ page }) => {
    await openProject(page, SEED_A());
    await openNotes(page);

    // business tab active by default; exactly one column visible
    await expect(page.locator("#notesTabBiz")).toHaveClass(/on/);
    await expect(page.locator(BIZ)).toBeVisible();
    await expect(page.locator(TECH)).toBeHidden();
    expect(await page.locator("#notesOverlay .noteCol.active").count()).toBe(1);

    // editingNow() must be true while open (so a cloud pull never re-renders mid-typing — N5)
    expect(await page.evaluate(() => window.editingNow())).toBe(true);

    // Esc closes
    await page.keyboard.press("Escape");
    await expect(page.locator("#notesOverlay")).toBeHidden();

    // reopen → backdrop (overlay padding, outside the modal) click closes
    await openNotes(page);
    await page.locator("#notesOverlay").click({ position: { x: 6, y: 6 } });
    await expect(page.locator("#notesOverlay")).toBeHidden();
  });
});

/* ============================ T-F2b — typing autosaves + persists ============================ */
test.describe("T-F2b — typing debounce-saves into DB.notes, badge + chip update, survives reload", () => {
  test("T-F2b business today typing → DB.notes[pid].business[0] (today), chip saved, count++, reload persists", async ({ page }) => {
    await openProject(page, SEED_A());
    await openNotes(page);
    const tIso = await todayIso(page);

    await typeInto(page, BIZ_TODAY, "First business note");

    // after the 600ms debounce the localStorage doc holds a business[0] for today with our html
    await expect.poll(() => storedHtml(page, "business", tIso)).toContain("First business note");
    const doc = await readDoc(page);
    expect(doc.notes["test-proj"].business[0].date).toBe(tIso);

    // chip flips to saved; the Project Status count badge increments to 1
    await expect(page.locator("#notesChip")).toHaveText("บันทึกแล้ว ✓");
    await expect(page.locator("#notesChip")).toHaveClass(/saved/);
    await expect(page.locator("#sumNotesCount")).toHaveText("1");

    // reload → reopen → the stored today section renders back into the lazy today region
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#sumNotes").waitFor();
    await openNotes(page);
    await expect(page.locator(BIZ_TODAY)).toContainText("First business note");
  });
});

/* ============================ T-F2c — rich text round-trip + sanitizer ============================ */
test.describe("T-F2c — formatting survives round-trip; sanitizer strips XSS on render AND save", () => {
  test("T-F2c bold/italic/bullets/colour → sanitizer keeps ul>li + strips attrs (round-trip)", async ({ page }) => {
    await openProject(page, SEED_A());
    await openNotes(page);
    const tIso = await todayIso(page);
    const fmt = page.locator(BIZ + " .colToolbar .fmtBtn"); // 0=B 1=I 2=bullets 3=highlight

    await typeInto(page, BIZ_TODAY, "hello world");
    // bold + italic FIRST (styleWithCSS default false → real <b>/<i> tags that survive the whitelist)
    await selectAll(page, BIZ_TODAY); await fmt.nth(0).click(); // bold
    await selectAll(page, BIZ_TODAY); await fmt.nth(1).click(); // italic
    await selectAll(page, BIZ_TODAY); await fmt.nth(2).click(); // bullets → ul>li
    // colour LAST (foreColor via styleWithCSS → span style="color:…")
    await selectAll(page, BIZ_TODAY);
    await page.locator(BIZ + " .swatchRow .swatch").nth(1).click(); // #9241ff → rgb(146,65,255)

    await expect.poll(() => storedHtml(page, "business", tIso).then((h) => /<(b|strong)\b/i.test(h))).toBe(true);
    const html = await storedHtml(page, "business", tIso);
    expect(html, "italic tag kept").toMatch(/<(i|em)\b/i);
    expect(html, "bullet list kept as ul").toMatch(/<ul\b/i);
    expect(html, "list item kept as li").toMatch(/<li\b/i);
    expect(html, "foreColor stored as an inline colour").toContain("146, 65, 255");
    expect(html, "no class attrs survive the sanitizer").not.toContain("class=");
    expect(html, "no contenteditable leaks into stored html").not.toContain("contenteditable");
  });

  test("T-F2c injected <script>/<img onerror>/onclick stripped on RENDER and on SAVE; <b>ok</b> kept", async ({ page }) => {
    await openProject(page, SEED_A());
    await openNotes(page);
    const tIso = await todayIso(page);
    const PAYLOAD = '<script>alert(1)</script><b onclick="x()">ok</b><img src=x onerror="y()">';

    // Parsing the raw payload — even into the sanitizer's DETACHED div — starts the <img src=x> load;
    // its async onerror would call the undefined y() and trip the fixture's pageerror guard. Serve /x
    // a valid 1×1 gif so the image LOADS (onerror never fires). Harness-only: the assertions below
    // prove the SANITIZER removes the img/script/handlers from both the rendered DOM and the saved doc.
    await page.route(/\/x(\?.*)?$/, (r) => r.fulfill({
      status: 200, contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
    }));

    // --- sanitize on RENDER: inject a raw payload into a stored PAST section, re-render, inspect DOM ---
    await page.evaluate((html) => {
      const n = window.notesOf("test-proj");
      n.business = [{ date: "2020-01-15", html }];
      window.renderNotesBody();
      window.notesApplyTab();       // re-mark the business panel .active after the rebuild
    }, PAYLOAD);

    const rendered = await page.locator(BIZ + ' .noteEdit[data-date="2020-01-15"]').evaluate((e) => e.innerHTML);
    expect(rendered, "script dropped on render").not.toMatch(/<script/i);
    expect(rendered, "img dropped on render").not.toMatch(/<img/i);
    expect(rendered, "onclick stripped on render").not.toContain("onclick");
    expect(rendered, "onerror stripped on render").not.toContain("onerror");
    expect(rendered.toLowerCase(), "safe <b>ok</b> content kept").toContain("ok");
    expect(rendered).toMatch(/<b>ok<\/b>/i);

    // --- sanitize on SAVE: put the raw payload into the LIVE today editor, then flush ---
    // (the point under test is that the SANITIZER strips it from the persisted html on save.)
    await page.evaluate((html) => {
      const ed = document.querySelector('#notesOverlay .noteEdit.today[data-col="business"]');
      ed.focus(); ed.innerHTML = html;
      ed.dispatchEvent(new Event("input", { bubbles: true }));
    }, PAYLOAD);

    await expect.poll(() => storedHtml(page, "business", tIso)).toContain("ok");
    const saved = await storedHtml(page, "business", tIso);
    expect(saved, "script dropped on save").not.toMatch(/<script/i);
    expect(saved, "img dropped on save").not.toMatch(/<img/i);
    expect(saved, "onclick stripped on save").not.toContain("onclick");
    expect(saved, "onerror stripped on save").not.toContain("onerror");
    expect(saved, "safe <b>ok</b> kept on save").toMatch(/<b>ok<\/b>/i);
  });
});

/* ============================ T-F2d — tabs preserve + flush ============================ */
test.describe("T-F2d — tabs: one panel at a time, unsaved edit survives a switch, per-tab counts", () => {
  test("T-F2d switch shows exactly one panel; flush-on-switch persists; edit survives round-trip; counts + single divider", async ({ page }) => {
    await openProject(page, SEED_A());
    await openNotes(page);
    const tIso = await todayIso(page);

    // business default; type but DON'T wait for the debounce — the tab switch must flush it
    await expect(page.locator(BIZ)).toBeVisible();
    await typeInto(page, BIZ_TODAY, "biz text one");
    await page.locator("#notesTabTech").click();

    // exactly one panel visible after the switch
    await expect(page.locator(TECH)).toBeVisible();
    await expect(page.locator(BIZ)).toBeHidden();

    // flush-on-switch already persisted the business edit
    await expect.poll(() => storedHtml(page, "business", tIso)).toContain("biz text one");

    // type in technical, switch back
    await typeInto(page, TECH_TODAY, "tech text two");
    await page.locator("#notesTabBiz").click();
    await expect(page.locator(BIZ)).toBeVisible();
    await expect(page.locator(TECH)).toBeHidden();

    // the in-flight business edit survived the round-trip (both panels stay mounted)
    await expect(page.locator(BIZ_TODAY)).toContainText("biz text one");

    // per-tab counts are live "(n)"
    await expect(page.locator("#notesTabCountBiz")).toHaveText("(1)");
    await expect(page.locator("#notesTabCountTech")).toHaveText("(1)");

    // exactly one date divider per day per tab (today's, now revealed by content)
    expect(await page.locator(BIZ + ' .dateDiv[data-date="' + tIso + '"]').count()).toBe(1);
    expect(await page.locator(TECH + ' .dateDiv[data-date="' + tIso + '"]').count()).toBe(1);
  });
});

/* ============================ T-F2e — delete prune + additive migrate ============================ */
test.describe("T-F2e — project delete prunes DB.notes[pid]; migrateDB adds DB.notes (docVer stays 2)", () => {
  test("T-F2e deleting a project drops its notes; a doc without DB.notes gains it on load, idempotently", async ({ page }) => {
    const doc = docWithNotes({ "test-proj": { business: [{ date: "2020-01-15", html: "<b>x</b>" }], technical: [], log: [] } });
    await openProject(page, doc);
    // sanity: the notes are present before deletion
    expect((await readDoc(page)).notes["test-proj"]).toBeTruthy();

    // delete the project from the dashboard (confirm() accepted) → notes pruned in the same mutation
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.locator('.card[data-open="test-proj"]').waitFor();
    page.once("dialog", (d) => d.accept());
    await page.locator('[data-act="delproj"][data-id="test-proj"]').click();
    await expect.poll(() => readDoc(page).then((d) => !!(d.notes && d.notes["test-proj"]))).toBe(false);

    // migrateDB is additive + idempotent: a doc WITHOUT DB.notes gains {} and docVer stays 2
    const mig = await page.evaluate(() => {
      const d = { projects: [{ id: "p1", name: "P", docVer: 2, modules: [{ id: "c", kind: "container", name: "C", children: [] }] }] };
      window.migrateDB(d);
      const first = JSON.stringify(d);
      window.migrateDB(d);
      return {
        hasNotes: !!d.notes && typeof d.notes === "object" && !Array.isArray(d.notes),
        docVer: d.projects[0].docVer,
        idempotent: first === JSON.stringify(d),
      };
    });
    expect(mig.hasNotes, "migrateDB creates DB.notes when absent").toBe(true);
    expect(mig.docVer, "no docVer bump").toBe(2);
    expect(mig.idempotent, "migrateDB is idempotent").toBe(true);
  });
});

/* ============================ T-F2f — bin arm-confirm + action log ============================ */
test.describe("T-F2f — two-click bin: arm → auto-disarm → confirm delete + log; today clears + re-hides", () => {
  test("T-F2f arm (no delete), auto-disarm ~3.2s, second click removes section + logs; today delete clears + re-creates", async ({ page }) => {
    const doc = docWithNotes({ "test-proj": { business: [{ date: "2020-01-15", html: "<b>past biz</b>" }], technical: [], log: [] } });
    await openProject(page, doc);
    await openNotes(page);
    const tIso = await todayIso(page);
    const divSel = BIZ + ' .dateDiv[data-date="2020-01-15"]';
    const bin = page.locator(divSel + " .binBtn");

    // FIRST click arms — red bin + glass confirm popover, NO deletion
    await bin.click();
    await expect(bin).toHaveClass(/armed/);
    await expect(page.locator(divSel + " .delPop")).toBeVisible();
    await expect(page.locator(divSel + " .delPop")).toHaveClass(/show/);
    expect(await page.locator(divSel).count(), "section still present while armed").toBe(1);
    expect((await storedHtml(page, "business", "2020-01-15")).length, "no deletion on arm").toBeGreaterThan(0);

    // AUTO-DISARM ~3.2s (still no deletion)
    await page.waitForTimeout(3600);
    await expect(bin).not.toHaveClass(/armed/);
    await expect(page.locator(divSel + " .delPop")).toHaveCount(0);
    expect(await page.locator(divSel).count(), "section survives auto-disarm").toBe(1);

    // RE-ARM then a SECOND bin click confirms → whole day section (divider + editor) removed
    await bin.click();
    await expect(bin).toHaveClass(/armed/);
    await bin.click();
    await expect(page.locator(divSel)).toHaveCount(0);

    // persisted: the section is gone, a delete log entry is kept (newest-first), chip shows 1
    await expect.poll(async () => {
      const d = await readDoc(page); const L = d.notes["test-proj"].log;
      return L.length && L[0].action === "delete" && L[0].col === "business" && L[0].date === "2020-01-15" && !!L[0].ts;
    }).toBeTruthy();
    expect(await storedHtml(page, "business", "2020-01-15")).toBe("");
    await expect(page.locator("#notesLogCount")).toHaveText("1");

    // TODAY-section delete: type → divider reveals; delete clears content + re-hides divider (not removed)
    const todayDiv = page.locator(BIZ + ' .dateDiv[data-date="' + tIso + '"]');
    await typeInto(page, BIZ_TODAY, "today note");
    await expect(todayDiv).toBeVisible();
    const todayBin = todayDiv.locator(".binBtn");
    await todayBin.click();          // arm
    await todayBin.click();          // confirm
    await expect(page.locator(BIZ_TODAY)).toHaveText("");
    await expect(todayDiv).toBeHidden();
    await expect.poll(async () => (await readDoc(page)).notes["test-proj"].log[0].date).toBe(tIso);
    await expect(page.locator("#notesLogCount")).toHaveText("2");

    // typing again re-creates today's divider
    await typeInto(page, BIZ_TODAY, "back again");
    await expect(todayDiv).toBeVisible();

    // reload → the deleted past section stays gone, the log is kept
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator("#sumNotes").waitFor();
    await openNotes(page);
    expect(await page.locator(BIZ + ' .dateDiv[data-date="2020-01-15"]').count()).toBe(0);
    await expect(page.locator("#notesLogCount")).toHaveText("2");
  });
});

/* ============================ T-F2g — highlight apply / toggle / dark ============================ */
test.describe("T-F2g — highlight: apply survives save; toggle-off (selection + caret); dark ink", () => {
  test("T-F2g apply yellow, toggle-off two ways, dark theme renders highlighted run in dark ink", async ({ page }) => {
    await openProject(page, SEED_A());
    await openNotes(page);
    const tIso = await todayIso(page);
    const hiBtn = page.locator(BIZ + " .colToolbar .fmtBtn").nth(3); // highlight
    const isHi = () => page.evaluate((s) => {
      const ed = document.querySelector(s);
      return [...ed.querySelectorAll("*")].some((e) => getComputedStyle(e).backgroundColor === "rgb(255, 243, 168)");
    }, BIZ_TODAY);

    await typeInto(page, BIZ_TODAY, "highlight me");

    // APPLY → a span with the light-yellow highlight background exists
    await selectAll(page, BIZ_TODAY); await hiBtn.click();
    expect(await isHi()).toBe(true);
    // …and survives the sanitizer on save
    await expect.poll(() => storedHtml(page, "business", tIso)).toContain("255, 243, 168");

    // TOGGLE-OFF with a FULL selection removes it (no nested transparent span)
    await selectAll(page, BIZ_TODAY); await hiBtn.click();
    expect(await isHi()).toBe(false);

    // TOGGLE-OFF with a CARET INSIDE also removes the whole run
    await selectAll(page, BIZ_TODAY); await hiBtn.click();
    expect(await isHi()).toBe(true);
    await page.evaluate((s) => {
      const ed = document.querySelector(s);
      const span = [...ed.querySelectorAll("*")].find((e) => e.style.backgroundColor);
      const tn = span.firstChild;
      const r = document.createRange(); r.setStart(tn, 2); r.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }, BIZ_TODAY);
    await hiBtn.click();
    expect(await isHi()).toBe(false);

    // DARK theme: a highlighted run's computed ink is forced dark (rgb(22,24,29))
    await selectAll(page, BIZ_TODAY); await hiBtn.click();
    expect(await isHi()).toBe(true);
    const color = await page.evaluate((s) => {
      document.documentElement.setAttribute("data-theme", "dark");
      const ed = document.querySelector(s);
      const span = [...ed.querySelectorAll("*")].find((e) => getComputedStyle(e).backgroundColor === "rgb(255, 243, 168)");
      return span ? getComputedStyle(span).color : null;
    }, BIZ_TODAY);
    expect(color).toBe("rgb(22, 24, 29)");
  });
});

/* ============================ T-SAFE — production Worker never reached ============================ */
test.describe("T-SAFE — production API is blocked (notes saves never reach prod D1)", () => {
  test("T-SAFE no request ever reaches the production Worker while editing notes (all aborted)", async ({ page }) => {
    await openProject(page, SEED_A());
    await openNotes(page);
    // typing → 600ms debounce → Store.save() → schedulePush → cloudPush ATTEMPT (must be aborted)
    await typeInto(page, BIZ_TODAY, "safety probe");
    await page.waitForTimeout(1600); // > 600ms debounce + 800ms push debounce

    const prod = page._prod;
    expect(prod.attempts.length, "app should have attempted at least one prod sync").toBeGreaterThan(0);
    expect(prod.reached, `requests reached production: ${prod.reached.join(", ")}`).toEqual([]);
    expect(prod.failed.length, "every prod attempt must be aborted").toBe(prod.attempts.length);
  });
});
