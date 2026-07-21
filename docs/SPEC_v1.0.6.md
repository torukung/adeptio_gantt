# ADEPTIO Gantt v1.0.6 — Architect Spec (Fable)

Branch: `v1.0.6` (from main `95bb8c5`, the v1.0.5 merge).
Source of scope: ToR's tuning doc `20 Jul - Adeptio Gantt - v.1.0.3 - Tuning.docx` (2026-07-20) — four edits.
Prototype (r1, pending ToR approval): https://claude.ai/code/artifact/d6aa9e86-33aa-4cad-b675-fd31d42c21c6 (local copy: `v1.0.6 - Dev/prototype/PROTO_v1.0.6_four_edits.html` in the vault — standalone, zero network).
Operating model: **Fable** orchestrates / architects / audits / stages; **Opus 4.8 max** workers implement, write, and document; Fable re-tasks on error or stall. Workers never run git — Fable owns commits.

**HARD SAFETY RULES (unchanged, non-negotiable)**
- Never touch `worker.js`, `schema.sql`, `wrangler.toml`, `index.html`, `cloudflare/`, `preview/`, `CNAME`.
- Every Playwright/browser context MUST block `https://adeptio-gantt.pathom-bot.workers.dev/**` before page scripts run (the app pushes the full doc to production D1 on every save). Reuse `tests/fixtures.js`; keep the zero-prod-requests assertion. E4 sync tests use a **mock-only** route (fulfill, never pass through) — see §5.4.
- Local test/self-check servers on ports 4173 (suite) / 4192–4199 (scratch); kill on exit; after any killed/stalled worker, sweep for leftover processes and check load averages before trusting suite timings.
- Match compact vanilla-JS style, Thai-first UI strings, existing `IC` icon system and `styles.css` token conventions (light + dark token sets — every new surface must define both).
- Before any push: `python3 isolation_check.py .` from the vault root must print CLEAN.

---
## 1. Scope — four edits from the tuning doc, ZERO doc-schema change

| # | Edit (ToR's words) | What ships |
|---|---|---|
| **E1** | "Once Click and hold, and expand or minimize the bar, please show the date data at position" | Live date readout (floating tip) while a Gantt bar is moved or edge-resized |
| **E2** | "Undo/redo Button for 5 Steps" | 5-step undo/redo — toolbar buttons on dashboard + project topbar, ⌘Z/⇧⌘Z |
| **E3** | "MS Excel, Apple Numbers, Google sheets Alignment … back-up and editable and upload back, in structure and consistency" | Structured spreadsheet round-trip: export the FULL tree (modules at every depth + features + custom cols) to .xlsx, edit externally, re-import losslessly with an import-preview confirm |
| **E4** | "Make system LIVE sync with Cloudflare. Locale store or cache for performance basis, but without delay" | Live sync: faster push (250ms debounce + flush-on-hide), visible-tab polling every 5s, sync-status chip. Local-first storage unchanged |
| **E5** | "Add option: On Module Menu bar: To add Sub-Module. Use same menu (Create Module), with pre-define parent modules" — added 2026-07-20 from ToR's v1.0.3.1 tuning docx | New grip-menu button on containers that opens the existing สร้างโมดูล modal pre-set to Sub-Module with the clicked container pre-selected as parent |

**Release invariant: NO change to the stored doc shape.** `docVer` stays 2; no new doc keys. Undo history is session-only memory; sync tuning is client behavior; E1 is pure UI; E3 changes file formats, not the doc. Consequence: the v1.0.5↔v1.0.6 LWW window carries **no schema risk** (an old tab's save cannot drop new-shape data — there is none).

Out of scope: worker/API changes (frozen — no rev-only endpoint, no WebSocket/SSE; live sync is client-side polling), notes/KPI changes, merge-mode import (import stays replace-with-confirm; undo E2 is the recovery path).

---
## 2. E1 — live date readout while dragging/resizing a bar

Today `onBarMove()` (app.js ~1823) already computes the candidate ISO dates every frame (`drag._s`, `drag._e`) and mirrors them into the left-pane date inputs — but those inputs are usually off-screen while the user is on the chart. Show the dates at the pointer.

### Behavior
- On every `onBarMove` frame, show the shared floating tip (`showTip`/`positionTip` machinery, reused) near the cursor with mode-dependent content:
  - mode `move`: `22 ก.ค. 26 → 26 ส.ค. 26 · 36 วัน`
  - mode `l` (left handle): `เริ่ม 22 ก.ค. 26` on the first line, `→ 26 ส.ค. 26 · 36 วัน` dimmer beneath
  - mode `r` (right handle): `สิ้นสุด 26 ส.ค. 26` first line, `22 ก.ค. 26 → · 36 วัน` dimmer beneath
- Dates format via `fmtThai(parse(iso))` — BE/CE aware like every other chart date. Duration = inclusive day count (same math as the bar tooltip).
- Tip appears on the FIRST move frame (not on plain pointerdown — a click without movement never flashes a tip) and hides in `onBarUp` (both commit and no-move paths).
- **(R-E1a)** While `drag` is live, `onBoardOver`/`onBoardMove` (the hover-tip handlers) must early-return so hover logic can't fight the drag readout. Guard: `if(drag) return;` at the top of both.
- **(R-E1b)** The drag tip uses a distinct class `.floatTip.dragDates` (violet border accent, slightly larger mono date text; both themes) so it reads as "live data", not a hover hint. Same singleton element — just toggle the class; `hideTip()` must remove it.
- **(R-E1c)** No new listeners on `window` — the readout renders inside the existing `onBarMove` frame. No layout reads beyond what `positionTip` already does (it measures the tip itself only).
- **(R-E1d)** `hideTip()` is already called by scroll/leave paths; verify the pointercancel path (`wireDragGuard`'s capture-phase `pointercancel` → `endDrag`) also ends with a hidden tip: `onBarUp` runs on `pointerup` only, so add tip-hide to the drag-guard's cancel path or make `onBarMove`'s guard self-heal (`if(!drag) hideTip()`). Implementer picks; test §5.1 asserts no orphan tip after a cancelled drag.

---
## 3. E2 — undo / redo, 5 steps

### Model — whole-doc snapshots, session-only, capped at 5
Every doc mutation already funnels through `Store.save()` (v1.0.5 F1's "ONE stamping point"), which already produces `s = JSON.stringify(DB)`. History rides that exact string — zero extra serialization work.

```
const UNDO_CAP = 5;
let undoStack = [], redoStack = [], _histBase = null;  // _histBase = serialized CURRENT state
```
- `Store.load()` end: `_histBase = JSON.stringify(DB)` (post-migrate).
- `Store.save()` (after building `s`, before/after safeSet — implementer's choice, but capture must happen on EVERY save incl. failed-LS saves): `if(_histBase !== null && _histBase !== s){ undoStack.push(_histBase); if(undoStack.length > UNDO_CAP) undoStack.shift(); redoStack.length = 0; } _histBase = s;`
  - The `!==` dirty-check means a no-op save (same serialization) never spends a history slot.
- `undo()`: pop `undoStack` → push `_histBase` onto `redoStack` → restore (below). `redo()` mirror-image.
- **Restore path (shared by undo/redo)** — must NOT call `Store.save()` (it would restamp `updatedAt` and re-capture history): `DB = JSON.parse(s); migrateDB(DB); MEM = DB; safeSet(s); _histBase = s;` then `if(cloudOn()) schedulePush();` then re-render (below) + `updateUndoUI()`. The restored snapshot keeps its own `updatedAt` — an undo shows the stamp of the state you went back to. Cloud push of the older doc is intended (LWW; that IS the undo propagating).
- **(R-E2a)** `adoptRemote()` clears both stacks and resets `_histBase` to the adopted serialization. Undoing across another device's write would silently clobber their work via LWW — never allow it.
- **(R-E2b)** Restore re-render preserves context: if `PID` set and the project still exists in the restored doc → `renderProject()`, then if the previous `ui.tab` was `"timeline"` → `renderTab("timeline")` (renderProject lands on summary). If `PID` is gone (undid a project-create) → `location.hash=""` + `route()`. Dashboard → `renderDashboard()`.
- **(R-E2c)** UI-only state (`ui.*` — theme/zoom/colW/wrap) never enters history (it never passes Store.save). The splitter width `P.leftW` DOES (doc data) — accepted, same rationale as v1.0.5 F1.

### UI
- Two `iconbtn`s (new `IC.undo` / `IC.redo` — counterclockwise/clockwise arc arrows, Heroicons-line style) in BOTH surfaces:
  - Dashboard `dashBarRow`, left of the backup button.
  - Project topbar, its own `toolgroup` right after the theme seg (visible on both tabs — NOT `tlOnly`).
- Disabled state reflects stack emptiness; `updateUndoUI()` runs after every save/undo/redo/adopt and inside `renderDashboard`/`renderProject` (fresh DOM). Tooltips: `เลิกทำ (สูงสุด 5 ขั้น)` / `ทำซ้ำ`.
- Keyboard: `⌘Z`/`Ctrl+Z` → undo, `⇧⌘Z`/`Ctrl+Y` → redo — **suppressed while text-editing** (`activeElement` is INPUT/TEXTAREA/contentEditable, or notes popup open, or any modal open): the browser's native text undo must win there. Buttons are the contract; keys are convenience.
- After an undo/redo, `toast("เลิกทำแล้ว")` / `toast("ทำซ้ำแล้ว")`.

---
## 4. E3 — spreadsheet round-trip (Excel / Numbers / Google Sheets)

### 4.1 Why the current one fails ToR's ask
`exportXlsx` flattens containers into a `Module` path string; `importWorkbook` rebuilds ONE level of root containers keyed by that string, re-mints every id, wipes `customCols` ids, loses module colour/description/KPI/hidden flags and all nesting. Not a backup; not consistent.

### 4.2 Export — sheet `Timeline`, one row per NODE (containers AND features), tree order
Columns (fixed order, then customs):
`Type | Level | Node ID | Feature ID | Name | Description | Start | End | Status | Remark | Color | <one column per custom col label…>`
- `Type`: `Module` (containers at any depth) / `Feature`. Thai not used in the file — spreadsheet formulas stay ASCII-stable; the UI copy stays Thai.
- `Level`: 1-based depth. A container at root = 1; its children (feature or sub-module) = 2; etc. Features carry their own level (parent depth + 1).
- `Node ID`: the node's `id`. THIS is what makes re-import lossless (identity, `progressOrder`, KPI carry-over).
- Container rows: `Name`, `Description`, `Color` (palette index 0–7); Feature ID/Start/End/Status/Remark/customs left blank.
- Feature rows: `Feature ID` = `fid`, dates ISO `YYYY-MM-DD` (as strings — no Excel date serials on export; import accepts both), `Status` = EN label (`Not Started`…, `statusFromText` reads it back), customs by their column.
- Sheet 2 `Info` (read-only convenience, ignored on import): project name, client, code, exported-at stamp, app version, row counts.
- `!cols` widths tuned; freeze row 1 (`ws['!freeze']` isn't standard SheetJS community — use `wb.Workbook.Views`/skip if the lib build lacks it; nice-to-have only).
- Numbers/Google Sheets: both open and re-export .xlsx losslessly for text/number cells — no special-casing. CSV import continues to work via the existing `XLSX.read` path.

### 4.3 Import — structured path (new) + legacy path (kept)
Detection: header row contains `Type` AND `Level` AND `Name` (aliases below) → **structured**; else → **legacy** (current alias-driven flat import, with one upgrade: a `Module` cell containing the `" › "` separator now splits into nested containers instead of becoming one literally-named module).

Structured parse (tolerant — users edit these files by hand):
- Header aliases (case-insensitive trim): `type` (+`ประเภท`), `level` (+`ระดับ`, `depth`), `node id` (+`id`, `nodeid`, `nid`), plus all existing `ALIASES`. Unknown headers → custom columns **by label match**: a label equal (trim, case-sensitive) to an existing `customCols[].label` reuses that col's id; otherwise a new custom col is created. `Color` (+`สี`) maps to the palette index.
- Row classification: `Type` cell matched case-insensitively (`module`/`m`/`โมดูล` → container; `feature`/`f`/`ฟีเจอร์` → feature). Blank Type + blank Name → skipped. Blank Type with a Name → feature (the common "user appended a row" case).
- Tree reconstruction via a container stack: a container row at level L pops the stack to depth L−1 and pushes itself; a feature row attaches to the current stack top. Tolerances **(R-E3a)**: level jump > +1 clamps to (stack depth + 1); a feature with no container above it goes into an auto `(นำเข้า)` recovery container at root; level ≤ 0 or non-numeric → treated as 1 for containers / stack-top for features.
- `Node ID` kept when non-empty; duplicates/missing → `nid()` mint (then `normalizeTree` enforces uniqueness anyway).
- Dates through the existing `toISO` (Excel serials, BE years, `d/m/y` all handled); feature with no dates → today+7 default (as now); `end<start` → clamp `end=start`.
- **Carry-over by Node ID (R-E3b)**: for each imported container whose `Node ID` matches an existing container, copy the fields the sheet does NOT carry — `kpi`, `hideProgress`, `collapsed` — from the old node. Features carry everything in the sheet (custom values included), nothing hidden to preserve. `progressOrder` is left as-is and self-heals via `normalizeProgressOrder` (matching ids keep their order slots).
- After build: `P.docVer=2`, `normalizeTree(P)` — then the ONE mutation lands through a single `Store.save()`; render via `renderTab(ui.tab)`.

### 4.4 Import preview (replaces today's silent wipe)
Parsing happens BEFORE mutation into a plain result `{mods, feats, customsNew:[labels], customsReused:[labels], warnings:[strings], build()}`. A modal shows: `นำเข้า: N โมดูล · M ฟีเจอร์` + custom-column summary + up to ~8 warnings (`แถว 17: level ข้ามขั้น — ปรับเป็นระดับ 2`, …) + the hard truth line `การนำเข้าจะแทนที่โครงสร้างปัจจุบันทั้งหมดของโครงการนี้ (เลิกทำได้ 1 ขั้น)` with `ยกเลิก` / `นำเข้าแทนที่` (primary, danger-tinted). Confirm → ONE `apply`-style mutation + toast. Cancel → doc untouched, file input reset. E2 makes the replace recoverable — say so in the modal because it is true.
- **(R-E3c)** A parse that yields zero features AND zero containers never opens the preview — toast the first warning instead (`ไม่พบข้อมูลที่นำเข้าได้ …`).
- **(R-E3d)** The legacy path ALSO gets the preview modal (same counts/warnings surface). No import path silently replaces a project anymore.

---
## 5. E4 — LIVE sync with Cloudflare (client-side; worker frozen)

Facts that bound the design: prod doc ≈ 59 KB (rev 2027); `GET /api/state` returns the full `{rev, doc}` (no rev-only endpoint, no ETag, no push channel); LWW by rev at the worker; `editingNow()` already defers adoption during edits/drags; same-browser tabs already sync via the `storage` event.

### Push — "without delay"
- `schedulePush` debounce 800ms → **250ms** (burst-coalescing kept; a drag commit is still one push).
- **Flush-on-exit (R-E4a)**: on `pagehide` AND on `visibilitychange→hidden`, if `pushPending`, fire `cloudPush` immediately with `fetch(..., {keepalive:true})` so the last edit survives tab close/switch. Implementation: `cloudPush(opts)` gains an optional `{keepalive:true}`; the flush cancels the pending timer first. keepalive bodies are limited (~64KB) — at 59KB we're inside it, but **if `body.length > 60000`, fall back to a normal fetch attempt** (may be dropped by the browser on close — accepted; localStorage still has the doc and next open pushes it).
- Failure/backoff machinery (`onPushFail`) unchanged.

### Pull — "LIVE"
- Visible tab: poll `cloudPull(false)` every **5s** (const `POLL_MS_VISIBLE=5000`). Hidden tab: **no polling** (clear the interval on `visibilitychange→hidden`); on becoming visible → immediate `cloudPull(false)` + restart interval. The existing `focus` pull stays. Net cost ≈ 12 × 59KB/min per visible tab — fine for Workers/D1.
- Adoption rules unchanged (`rev > lsRev() && !pushPending && !editingNow()`); E2's R-E2a clears undo history on adoption.
- **(R-E4b)** When a poll adopts a remote doc, toast once (`อัปเดตจากเครื่องอื่นแล้ว`) — silent UI swaps confuse users mid-read. Reuse the existing `route()` adoption path; the toast rides `adoptRemote` ONLY when triggered from a background poll (not initial `cloudSync` seed, not manual restore).

### Sync-status chip (the visible "LIVE")
- Small pill `#syncChip` on BOTH surfaces (dashboard `dashBarRow` + project topbar, beside the undo group): dot + label.
  - `กำลังซิงก์…` (violet, pulsing dot) while `pushPending` or a push/poll is in flight after a local edit;
  - `ซิงก์แล้ว HH:mm` (green dot) after a successful push or up-to-date poll (`lastSyncAt` session var);
  - `ออฟไลน์ · จะซิงก์อัตโนมัติ` (grey/red dot) after a failed push/poll — cleared by the next success;
  - hidden entirely when `!cloudOn()`.
- Driven by a tiny `setSyncState(state)` called from `schedulePush`, `cloudPush` success/fail, `cloudPull` success, and the visibility handlers. No re-render — direct DOM patch like `refreshStamps()`. Both themes tokenized.
- **(R-E4c)** The chip must never imply safety it doesn't have: while `pushPending` is latched the label is "กำลังซิงก์…" even if a poll succeeded meanwhile.

---
## 5.4 E5 — grip-menu Sub-Module creation (ToR v1.0.3.1 docx, added mid-release)

ToR's screenshots show the intent exactly: the container grip pill (image 1, the circled ＋) gains a
**เพิ่มโมดูลย่อย** option; it opens the EXISTING `moduleModal()` (image 2) with ประเภท pre-set to
โมดูลย่อย · Sub-Module and สังกัดโมดูลหลัก pre-selected to the clicked container. No new modal.

- `moduleModal(presetParentId)` — optional arg. When set AND the id resolves to a container:
  `kind` starts as `"sub"`, the parent `<select>` starts on that container, everything else
  (name/desc/type toggle/colour/feature picker/save path) is byte-identical. The user may still
  switch type or parent — pre-defined, not locked. No arg = today's behavior exactly.
- **(R-E5a)** New grip-menu button on CONTAINER rows only, placed directly after the ＋ addfeat
  button, icon = a container/folder-plus variant consistent with the IC set, tooltip
  `เพิ่มโมดูลย่อยในโมดูลนี้`. It passes the row's data-nid as presetParentId. Features' pills unchanged.
- **(R-E5b)** The parent dropdown lists ALL containers (as today); the preset merely selects one.
  Save path already handles nested parents via `findNode` + `revealInto` — do not duplicate it.
- **(R-E5c)** The grip pill's rail width is measured (`sizeGripRails`) — verify the wider pill still
  slides correctly and doesn't overlay row content (G2 contract from v1.0.4).
- Tests `submodmenu-v106.spec.js`: button present on container pills at depth 0 AND ≥1, absent on
  feature pills; opens the modal with Sub-Module active + correct parent pre-selected; saving
  creates the sub-container under that parent (flash + reveal); no-arg moduleModal (topbar
  + Module button) unchanged; rail-slide still clears row content (R-E5c).

## 5.5 Commit plan (staged, audited, fixes-first n/a — no open fixes)

1. `E1` drag date readout (+ CSS both themes) + tests — DONE `f4600cc`
2. `E5` grip-menu sub-module creation + tests (inserted 2026-07-20 on ToR's instruction — build alongside the original four, before final audit/docs)
3. `E2` undo/redo engine + buttons + keys + tests
4. `E3` structured export/import + preview modal + tests
5. `E4` live sync (push/pull/chip/flush) + tests
6. docs: CHANGELOG + merge record skeleton

Each stage: Opus-max implementer → 5-lens adversarial audit (spec / refute / data-safety / tests / style, 3-vote judge panels) → fix worker → Fable reads the full diff + runs the suite → commit. Suite must stay green (177 at branch point) and grow per §5.x below.

## 5.x Test plan (Playwright, host blocked; new spec files)
1. **E1 `dragtip-v106.spec.js`**: move-drag shows the tip with both dates; left/right resize shows เริ่ม/สิ้นสุด lines; tip content matches the committed doc dates on pointerup; tip gone after pointerup AND after a synthesized pointercancel; hover-tip suppressed mid-drag.
2. **E2 `undo-v106.spec.js`**: 6 edits → exactly 5 undos land (oldest dropped); redo replays; a fresh edit clears redo; buttons' disabled states; no-op save spends no slot; adoptRemote (simulated via storage-event/injection) clears stacks; keyboard suppressed while typing in a cell; undo of a project-delete restores it on the dashboard.
3. **E3 `roundtrip-v106.spec.js`**: export → re-import the SAME workbook (drive `importWorkbook` with the generated buffer in-page) → tree deep-equals (ids, nesting, customs, colours) and `kpi`/`hideProgress`/`collapsed` carried; hand-mangled workbook (level jump, blank type, dup ids, BE dates) imports with the specified tolerances + warnings; legacy flat file still imports; `" › "` module paths nest; preview cancel leaves the doc byte-identical; preview confirm is ONE undo step.
4. **E4 `livesync-v106.spec.js`**: dedicated fixture that **fulfills** the worker URL with a scripted mock (never passes through; keep the global zero-real-request assertion): edit → PUT arrives ≤ ~1s; poll cadence ~5s while visible, none while hidden (CDP visibility emulation), immediate on visible; remote rev bump → adoption + toast + undo stacks cleared; push fail → chip offline → recovery on next success; pagehide flush issues a keepalive PUT.
5. Regression: full existing suite stays green ×3.

## 6. Binding remarks
All R-tags above (R-E1a–d, R-E2a–c, R-E3a–d, R-E4a–c, R-E5a–c) are binding, same contract as v1.0.4's R1–R12 / v1.0.5's N1–N11: the audit lenses check the diff against them explicitly.
