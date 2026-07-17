# ADEPTIO Gantt v1.0.4 — Architect Spec (Fable)

Branch: `v1.0.4` (from main `446dae1`, which is v1.0.3 + CNAME `timeblock.io`).
Prototype (user-approved interactions): https://claude.ai/code/artifact/a1e75bb4-7ac8-4d46-b1d1-3b49841388bf
Operating model: **Fable** orchestrates / architects / audits / stages; **Opus 4.8 max** workers implement, write, and document; Fable re-tasks on error or stall. Workers never run git — Fable owns commits.

**HARD SAFETY RULES (unchanged from v1.0.3, non-negotiable)**
- Never touch `worker.js`, `schema.sql`, `wrangler.toml`, `index.html`, `cloudflare/`, `preview/`, `CNAME`.
- Every Playwright/browser context MUST block `https://adeptio-gantt.pathom-bot.workers.dev/**` before page scripts run (the app pushes the full doc to production D1 on every save). Reuse `tests/fixtures.js`.
- Local test/self-check servers on ports 4173 (suite) / 4192–4199 (scratch); kill on exit.
- Match compact vanilla-JS style, Thai-first UI strings, existing `IC` icon system and `styles.css` token conventions.

---
## 1. Scope (user-approved via prototype)

1. **Grip menu** on every row (module / sub-module / feature): minimised grip `⠿` at the row front; opens by pointing at the **grip only** (never row hover); slides open to the right; **row content slides right** by the measured pill width (never overlaid). Buttons: `↑ ↓ | ⇤(outdent) ⇥(indent) | +(add feature, containers only) ⇄(promote/demote) ✎(edit) 🗑(delete)`. Staggered reveal, focus-within for keyboard, disabled-state rules below.
2. **Indent / outdent as structure moves**: indent tucks a row under the row above (must be a container); outdent lifts to grandparent level after the parent. Depth defines the label: level 0 = Module, deeper = Sub-Module.
3. **Promote / demote**: Feature → Sub-Module (gains children capability); Sub-Module → Feature only when it has no children. Lossless: feature fields (fid/start/end/status/owner/remark/custom) are preserved through promote so demote restores them.
4. **Multi-level sub-modules**: sub-modules can contain sub-modules, unlimited depth. Sub-modules can sit **between features** at any level (free ordering of mixed children).
5. **Edit modal** for any node: ID, Type (Feature/Container — Type locked while a container has children), name, description, colour; feature-only: start/end, status, owner, remark.
6. **Stepped indent shading** in BOTH panes: per-level tint `rgba(146,65,255,.030 × depth)` light / `rgba(169,112,255,.055 × depth)` dark, applied to the tree row AND its chart row (identical values — this is the frame-sync guarantee made visible).
7. **Tree guides**: per-row vertical rail segments + elbow into each child row (wrap-safe, per-row ::before/::after as in v1.0.3).
8. **Gantt zoom**: continuous px-per-day `PPD ∈ [0.9, 34]` replacing the fixed day/week/month presets (keep the presets as shortcuts that set PPD). Toolbar: `− / readout / + / reset`; readout shows **months in view** (`viewportWidth / (PPD×30.4)`); reset = fit ≈ 9 months. In/out steps ×1.35 centred on the viewport midpoint. Persist PPD in `ui` (LS_UI).
9. **Bar text at zoom**: label font `clamp(6.4, 6.2 + PPD×0.55, 11.5)px`; hide label when computed size < 7.5px OR bar width < 34px → status dot only; hover shows the floating bubble (reuse `.floatTip`). Verified curve: ≈9 months → ~7.7px visible; ≈6.7 → 8.2px; past ~11 months → hidden. **Interacts with v1.0.3 sliding sticky labels: sticky slide applies only while the label is visible; the clip/bubble fallback logic must use post-shift rects (already the case in `labelNeedsTip`).**
10. **Theme: Auto / Light / Dark** segmented control in the project toolbar. Light = current tokens (unchanged). Dark = second token set (from the prototype: ink `#eceaf3`, surface `#131218`, panel `#1b1a22`, line `#2b2934`/`#3a3747`, primary `#a970ff`, rail `rgba(169,112,255,.45)`, modRow gradient `#232030→#1d1b26`, shadows deepened). Auto = follow `prefers-color-scheme`. Persist in `ui`. **Exports (PNG print) force light** during capture, then restore. PALETTE chips/bars and STATUS colours stay as-is (verified legible on both grounds); bar fill alpha may need a dark variant (`hex2rgba(c,.16)` light / `.22` dark — worker judgement with screenshots).

Out of scope for v1.0.4: drag & drop re-parenting across tree levels (grip drag keeps v1.0.3 semantics: reorder among siblings + feature-drag between containers; full tree-drag lands in v1.0.5), KPI panel changes, worker/API changes.

---
## 2. Data model — THE structural change

v1.0.3: flat `P.modules[]` + one-level `module.parentId`, features in `module.features[]`, addressed by array indices `mi`/`fi`.
v1.0.4: **one recursive tree**.

```
node := {
  id, kind: 'container' | 'feature',
  name, description, color, fid,
  // container:
  collapsed, children: [node],
  // feature:
  start, end, status, remark, custom:{}, owner? (via custom col as today)
}
P.modules = [container, ...]   // root holds containers ONLY
P.docVer = 2                   // stamped by migration
```

### Migration (load-time, idempotent, in ONE place)
`migrateDoc(P)` runs in `Store.load()` AND `adoptRemote()` AND `restoreFromObject()`:
- If `docVer >= 2`: sanitize only.
- Else: for each module (in `normalizeModules` display order): root container; its `features[]` → feature children (in order); modules with `parentId` → container children of their parent (after the parent's features). Delete `parentId`, keep all unknown fields. Stamp `docVer:2`.

### Transition compatibility (LWW clobber window)
GitHub Pages deploys atomically, but an **already-open old tab** can push a v1-shape doc after v1.0.4 ships. Mitigations (all required):
1. Migration is idempotent and tolerant — adopting a v1 doc mid-flight just re-migrates.
2. **Dual-write mirror during v1.0.4**: on save, each container also writes `features: [direct feature children]` (mirror only, ignored on load when `docVer>=2`). An old tab that adopts a v2 doc then still renders top-level modules + their direct features instead of an empty board, and its own saves keep `children` intact (v1.0.3 preserves unknown fields — verified behaviour). Remove the mirror in v1.0.5.
3. Merge record must tell the user to close old tabs after deploy.

---
## 3. Creation ↔ moving sync audit (the requested recheck — REMARKS)

The class of bug to design out: creation paths and moving paths maintaining invariants **differently**. Findings, each with its resolution baked into this spec:

| # | Finding | Where seen | Resolution in v1.0.4 |
|---|---------|-----------|----------------------|
| R1 | **Index addressing breaks under nesting.** `mi`/`fi` array indices (used by every handler: `onTextBlur`, `onDateChange`, `onStatusChange`, `onGridAction`, drags, bars) are ambiguous in a tree and go stale after any structural move. | app.js throughout (`data-mi`/`data-fi`) | **Node-id addressing everywhere**: rows and bars carry `data-nid`; handlers resolve via `findNode(id)`. `mi/fi` are deleted, not shimmed — a half-shim is how creation/moving drift starts. |
| R2 | **Two mutation disciplines.** v1.0.3 creation (`addFeature`, `featureModal` save, `moduleModal` save/picker) and moves (`moveFeature`, `commitModuleMove`, `moveModuleUpDown`, delete-promote) each separately remember to call `normalizeModules` + `Store.save()` + `renderBoard()` — some call sites render more than they must, and any new path can forget one. | app.js 1120–1520 | **Single mutation gate**: `apply(mutator)` = `mutator(P)` → `normalizeTree(P)` → `Store.save()` → `renderBoard()` (+ returns the focus/flash nid). EVERY create/move/edit/delete/promote/indent goes through it. No direct `Store.save` outside `apply` in tree code. |
| R3 | **Create-then-edit leak** (prototype defect, do NOT copy): prototype `addChild`/`addModule` push a node then open the modal — cancel strands a placeholder node. v1.0.3's modal-save-creates is correct. | prototype `addChild()` | Creation happens **on modal save only** (as v1.0.3 `featureModal`/`moduleModal` do). The grip `+` opens the feature modal pre-targeted at the container; nothing is inserted until save. |
| R4 | **Normalizer scope changes.** v1.0.3 `normalizeModules` (sanitize parentId, group subs after parent) is obsolete; its invariants must be re-expressed for the tree or moves/creates will disagree about legality. | app.js 796–815 | `normalizeTree(P)`: (a) unique ids (dupes re-id'd), (b) `kind` sanity — feature ⇒ no `children` (if found: convert to container, remark in console), container ⇒ `children[]` array + `collapsed` bool, (c) root = containers only (stray root feature → wrapped into a recovery container `"(กู้คืน)"` rather than dropped), (d) depth-stable, order-preserving, single pass. |
| R5 | **Move legality must equal create legality.** Indent uses "row above is a container"; the modal's Type select and promote/demote change what *is* a container. If guards live in the UI layer twice they will diverge. | prototype `canIndent/canOutdent/togglePromote` | One predicate module used by BOTH the menu (disabled states) and the mutators (hard guards): `canIndent(id)`, `canOutdent(id)` (feature at depth 1 cannot outdent — root holds containers only), `canDemote(id)` (container with children ⇒ false), `canAddChild(id)` (container only). Mutators re-check; UI merely reflects. |
| R6 | **Moving into a collapsed container hides the moved row** — user thinks it vanished. Prototype's `indent()` auto-expands (`prev.collapsed=false`); creation via `featureModal` also expands (v1.0.3 sets `M.collapsed=false`). | both | Rule: any mutation that inserts INTO a container auto-expands that container and flashes the moved row. Same rule for create and move — one helper `revealInto(container)`. |
| R7 | **Promote/demote losslessness.** If promote strips feature fields, demote after moving children out silently loses dates/status — creation (new sub-module) and conversion (promoted feature) would produce different shapes. | prototype `togglePromote` | Promote keeps ALL feature fields on the node (they're inert while container); demote revives them. Container span on the chart derives from descendants (empty container ⇒ no bar), NEVER from the dormant fields. |
| R8 | **Delete semantics differ by depth in v1.0.3** (delete main-with-subs promotes subs; delete feature just splices). In a tree, "promote grandchildren" is surprising. | app.js delmod path | v1.0.4 delete = **cascade** with explicit confirm: `ลบ "X" และ N รายการข้างใน?` (count via `countAll`). No silent promote. (Promote-children remains available manually via outdent before delete.) |
| R9 | **Both panes must render from ONE flatten.** v1.0.3 renders left (`renderGrid`) and right (`renderTimeline`) from the same `P.modules` loop — keep that 1:1 by deriving BOTH from a single `flatten(P.modules)` (visible rows only, with depth/lines/last metadata). Any pane building its own traversal is a frame-alignment bug factory. | renderBoard | `renderBoard()` computes `const rows = flatten(P)` ONCE and passes it to both `renderGrid(rows)` and `renderTimeline(rows)`. `syncRowHeights`, sticky labels, and the alignment tests key off `data-nid`, not indices. |
| R10 | **Sticky labels + zoom text + wrap heights interplay** (frame–txt–alignment recheck): three systems now touch bar label geometry — sliding `translateX` (v1.0.3), zoom font-size/hide (new), wrap row-height sync (v1.0.2). Order of operations per render: heights first (`syncRowHeights`), then `updateStickyLabels()` (reads post-height geometry), then tip logic reads post-shift rects. Zoom re-render resets transforms before re-measuring (v1.0.3 already resets on re-render — keep). | renderTimeline tail | Explicit call order in `renderBoard`: grid → timeline → `applyWrap()`/`syncRowHeights()` → `updateStickyLabels()`. A Playwright test asserts label rect ⊆ bar rect ∩ viewport at three zoom levels, wrap on/off. |
| R11 | **Row-height parity across panes at every depth**: modRow (46px) / featRow (42px) must hold for containers/features at ANY depth; indent is padding-inside-row, never row margin/height. Wrap mode measures per-row. | styles | Keep `--modH`/`--rowH` for container/feature rows regardless of depth. Alignment assertion (`assertAligned`) runs after EVERY mutation in tests — extended to cover indent/outdent/promote/zoom/theme switches. |
| R12 | **UI-store keys**: zoom PPD + theme go into `ui` (LS_UI) beside `wrapTxt`/`colW` — per-device, never into the doc (same discipline as colW in v1.0.3 FIX6). | LS_UI | `ui = { wrapTxt, colW, ppd, theme:'auto'|'light'|'dark' }`, `saveUi()` extended; legacy `ui.zoom` presets map to PPD on first load. |

---
## 4. Consistency touchpoints

- **Progress panel** (`renderProgress`): lists TOP-LEVEL modules; stats roll up recursively (`moduleStats` walks the subtree). Sub-module drill-down is out of scope; `↳` prefix rows are gone (top-level only, cleaner than v1.0.3's mixed list). `progressOrder` stays id-based.
- **Excel export** (`exportXlsx`): Module column = full path `A › B › C`; rows in flatten order. Import (`importWorkbook`) unchanged — creates flat modules (path strings arrive as names; no round-trip parsing).
- **Dashboard cards / updateMeta / getRange**: counts and date-ranges become recursive walks (one shared `walkFeatures(P, fn)` helper).
- **Feature-row drag (kept from v1.0.3)**: targets are containers at any depth (drop into = append; before/after a feature = insert at that position in its parent's children). Module grip drag: reorder among SIBLINGS only in v1.0.4 (before/after rows of the same parent; the indent/outdent buttons are the level-change mechanism this round).
- **Cloud sync/guard**: no changes — centralized `_dragging` guard covers all pointer drags automatically; `editingNow()` untouched.

---
## 5. Delivery plan (commit sequence, Fable-audited between each)

1. **`core-tree`** — migrateDoc + docVer + dual-write mirror + normalizeTree + apply() gate + id addressing (rows render, edit-in-place works, old handlers ported). Tests: migration (v1→v2 shapes incl. parentId docs, seed, prod snapshot copy), normalize invariants, mirror write.
2. **`tree-ui`** — grip menu (slide-open + row-content slide via measured `--railW`), indent/outdent/promote/demote/add/edit/delete with shared predicates, tree guides + stepped shading (left), reveal-and-flash rule. Tests: every menu action + guard matrix + R3 cancel-leaves-nothing.
3. **`timeline`** — stepped shading (right), container span bars at depth, continuous zoom + controls + readout + persistence + preset mapping, label font curve + hide + bubble, sticky-label integration (R10 ordering). Tests: zoom sweep table, alignment at 3 zooms × wrap on/off, label/bubble thresholds.
4. **`theme`** — dark token set behind `data-theme` + Auto/Light/Dark segmented control + persistence + export-forces-light. Tests: token swap smoke, override both directions, export capture returns light, contrast spot-checks.
5. **`docs`** — CHANGELOG v1.0.4, this spec updated with as-built deltas (Opus documents; Fable reviews).

Full regression (v1.0.3 suite must stay green — sliding labels, fixes, guard) + new suites at every step. Isolation check before any push. Branch pushes to `origin/v1.0.4`; PR to main only on user's explicit go.

---
## 6. Definition of done

- All §1 behaviours demonstrably working on the real app with real-token styling, both themes.
- Full Playwright suite green ×2 consecutive runs (old 40 + new; zero prod-host requests; pageerror fails tests).
- `assertAligned` (row parity + per-row heights, keyed by `data-nid`) passes after every mutation class: create, edit, delete, up/down, indent, outdent, promote, demote, collapse, zoom, theme, wrap.
- Migration proven on: seed doc, a real v1.0.2/v1.0.3 production snapshot copy (`Codes Backup/prod_state_snapshot_2026-07-11.json` — READ ONLY, copy it), and a synthetic parentId doc with subs.
- `git diff` limited to `app.js`, `styles.css`, `CHANGELOG.md`, `docs/**`, `tests/**`, `.gitignore`.
- Protected files zero-diff. Isolation check CLEAN.
