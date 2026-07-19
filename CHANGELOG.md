# Changelog

## v1.0.5 — 2026-07-19 — Last-edit timestamps, Project NOTEs, mirror removal

A fix-first minor release: the v1.0.4 compatibility mirror is retired, every doc mutation now
stamps a last-edit datetime, and projects gain a tabbed NOTEs popup for running business/technical
commentary. Spec revised four times on user feedback before the UI commit landed; every interaction
was approved on the prototype first.

### Fix — dual-write mirror removed (F0)

- **`features[]` compatibility mirror deleted.** The v1.0.4 transition shim — every container
  writing a legacy `features[]` array alongside `children` so a stale open v1.0.3 tab could still
  render — is gone (`writeMirror()` and its two call sites in `Store.save()` / `adoptRemote()`).
  Stale `features` keys already sitting in stored docs are left inert (ignored on load under
  `docVer ≥ 2`); the v1→v2 migration read-path is untouched, so a pre-v1.0.4 backup still migrates.

### Feature — last-edit timestamps, แก้ไขล่าสุด (F1)

- **One central stamping point.** `Store.save()` now stamps `DB.updatedAt` and the open project's
  `updatedAt` with a full ISO datetime on every doc mutation, so "any information edit/change" is
  covered with zero per-call-site edits. UI-only state (theme, zoom, wrap) never touches the doc and
  never stamps.
- **Display.** Dashboard cards show `แก้ไขล่าสุด <date>` under the existing update-date line; the
  Project Status header shows the same stamp, refreshed in place after each save (no re-render
  mid-edit). `fmtStamp()` renders legacy date-only values as `DD/MM/YYYY` and full-ISO values as
  `DD/MM/YYYY HH:mm` local time — old v1.0.4-and-earlier date-only stamps are tolerated, not
  reformatted or upgraded. The redundant manual date-only stamp in the status-save handler is
  dropped in favour of the central stamp.

### Feature — Project NOTEs popup (F2)

- **`โน้ต` button** on the Project Status header opens a dedicated notes popup, tabbed
  **ธุรกิจ · BUSINESS** / **เทคนิค · TECHNICAL** (one panel visible at a time; both stay mounted so
  switching preserves in-flight edits and flushes any pending save first), each tab showing a live
  non-empty-section count.
- **Date-sectioned notepad.** Each tab's content is a newest-first list of per-day sections behind a
  dashed date divider; today's section is created lazily on the first keystroke rather than littering
  empty sections on open.
- **Autosave.** Typing debounces 600ms, sanitizes, and writes through `Store.save()` (which also
  applies the F1 stamp and schedules the cloud push) — a `กำลังบันทึก… / บันทึกแล้ว ✓` chip tracks
  state; also flushed on tab switch, blur, and popup close.
- **Delete with two-click arm-confirm.** Each date divider carries a bin button; the first click
  arms it and shows a light-red apple-glass confirm popover beside the bin (auto-flips side to avoid
  clipping, auto-disarms ~3.2s, no native `confirm()`, no bottom toast); the second click (or a click
  on the popover) deletes the whole day section including its divider. Every deletion is appended to
  a per-project action log (capped at 200 entries), viewable via a `log (n)` chip that toggles a
  compact strip below the tab bar.
- **Rich text.** Bold / italic / bullet-list toolbar plus a 6-swatch text-colour palette and a
  light-yellow (`#fff3a8`) highlighter with clean toggle-off (DOM-inspection based, not
  `hiliteColor('transparent')`, which was found to nest a see-through span over the yellow one).
  Paste is forced to plain text.
- **Storage.** `DB.notes[pid] = { business:[], technical:[], log:[] }` is a **separate top-level
  section of the doc**, deliberately outside `projects[]` — it rides every D1 snapshot and every
  `prod_state_snapshot_*.json` backup automatically without a schema/Worker change. `migrateDB`
  ensures `DB.notes` exists on old docs (idempotent, no `docVer` bump); project delete prunes the
  project's notes in the same mutation.
- **Sanitizer hardening.** `sanitizeNoteHtml()` / `stripNoteText()` whitelist-gate stored HTML on
  both save and render (tags `B STRONG I EM SPAN DIV P BR FONT UL LI`; only `color` /
  `background-color` style, `script`/`style`/`iframe` dropped entirely) — the XSS gate for HTML that
  round-trips through the doc/cloud.

### UI polish

- **Feature text aligns with its module name.** In the left tree pane, feature rows (including the
  fid prefix) now start exactly at their parent module's name x-position at every depth
  (`.cell.feat` base indent 4px → 51px, `.addFeat` 6px → 53px; the per-level step ladder is
  unchanged). User-approved on a cloud-disabled demo before landing.

### Testing

- **176 Playwright tests, green ×3 consecutive runs** — the 163-test v1.0.4 baseline plus 13 new
  spec-§5 tests (`stamps-v105.spec.js`: T-F0, T-F1a–c; `notes-v105.spec.js`: T-F2a–g, T-SAFE). Every
  browser context still blocks the production Worker host — zero prod-host requests.
- **Sanitizer hardening found via T-F2c.** Parsing untrusted HTML by assigning it into a
  live-document detached `div` still starts `<img>` fetches and fires inline `onerror` handlers
  *during* sanitization. `sanitizeNoteHtml()` and `stripNoteText()` now parse in an inert `DOMParser`
  document instead — nothing loads, nothing fires — before the whitelist strip runs.

## v1.0.4 — 2026-07-18 — Multi-level tree, grip menu, continuous zoom & themes

The module structure becomes a full **multi-level tree** — modules nest sub-modules to
any depth — with a new per-row grip menu, continuous timeline zoom, and Auto/Light/Dark
themes. Built as four Fable-audited stages on the v1.0.3 baseline; every interaction was
approved on the prototype first.

### Multi-level tree & data model (core-tree)

- **One recursive node tree.** `P.modules` is now a single container/feature tree — every
  module can hold sub-modules to unlimited depth, and sub-modules can sit freely between
  features at any level. The flat `parentId` / array-index model is gone; both panes render
  from one `flatten()`, so the left grid and the Gantt chart can never drift out of alignment.
- **Cascade delete.** Deleting a container removes it **and everything inside it**, after an
  explicit Thai confirm — `ลบ "X" และ N รายการข้างใน?` (N = the count of everything nested
  under it). Replaces v1.0.3's silent "promote the sub-modules to the top" behaviour.
- **Every change goes through one gate.** Create, move, edit, delete, promote, indent — all
  pass through a single mutation gate (normalize → save → render), so no path can leave the
  tree half-updated. Inline field edits (name / date / status) take a lighter render that keeps
  your cursor and the cell you are typing in alive.

### Grip menu & tree editing (tree-ui)

- **Grip menu `⠿` on every row** replaces the v1.0.3 hover clusters. It opens only when you
  point at (or keyboard-focus) the grip — never on plain row hover — and slides open to the
  right while the row content slides over by the exact pill width, so nothing is ever hidden
  underneath. Staggered reveal; `Esc` closes it.
- **Restructure by indent / outdent.** Indent (`⇥`) tucks a row under the container above it;
  outdent (`⇤`) lifts it to the grandparent level. Depth sets the label: level 0 = Module,
  deeper = Sub-Module.
- **Promote / demote, lossless.** Feature ⇆ Sub-Module (`⇄`): promoting a feature keeps all of
  its fields (start/end/status/owner/remark/custom) dormant, so a later demote restores them
  unchanged. A container that still has children cannot demote.
- **One edit modal for any node** — id, type (Feature/Container), name, description, colour, and
  for features start/end/status/owner/remark. The Type toggle is locked with a Thai hint when
  the change is illegal, and there is no parent picker any more, so a rename can no longer
  silently re-home a nested sub-module.
- **Tree guides + stepped indent shading** in the left grid: a rail + elbow into each child row,
  and a per-depth violet tint on every row — the same tint appears on the matching chart row.

### Timeline zoom & shading (timeline)

- **Continuous zoom** replaces the fixed Day/Week/Month steps: a smooth px-per-day range driven
  by a `−  N.N เดือน  +  พอดี` toolbar (the readout shows months in view; **พอดี** fits about
  9 months). Day / Week / Month stay as one-tap shortcuts. The zoom level is remembered per
  device — never written into the shared document.
- **Bar labels adapt to zoom.** Label text shrinks along a curve, and once a bar gets too small
  or too narrow it collapses to a status dot with the full label on hover. The v1.0.3 sliding
  sticky labels still work on top of this.
- **Right-pane stepped shading** now mirrors the left pane exactly on every row — the frame-sync
  guarantee made visible — and container bars span all of their descendant features at any depth.

### Themes (theme)

- **Auto / Light / Dark** segmented control (`อัตโนมัติ / สว่าง / มืด`) in the project toolbar.
  Auto follows the operating-system setting and flips live; if the OS flips while you are editing,
  the redraw waits until you are idle so nothing you are typing is lost.
- **Dark mode** ships a full dark palette; Light is byte-unchanged from v1.0.3. **PNG export and
  Print always render on the light ground**, whatever theme is on screen, so shared images and
  printouts look the same as before. Text contrast was checked against WCAG in-test.

### Migration

- Documents are migrated to **`docVer: 2`** at every load path (local, cloud adopt, restore).
  Migration is **idempotent** and tree-shape aware, so re-opening or re-adopting a document just
  re-migrates safely; the old one-level `parentId` structure is preserved (features first, then
  sub-containers). A stray root-level feature is wrapped into a `(กู้คืน)` recovery container
  rather than dropped.
- **Compatibility mirror for open v1.0.3 tabs.** While v1.0.4 rolls out, each container also
  writes a legacy `features[]` mirror so a still-open v1.0.3 tab renders sanely instead of a blank
  board; it is ignored on load under `docVer ≥ 2`. **This mirror is temporary — REMOVE IN v1.0.5.**
- **After deploying, close any old v1.0.3 tabs before editing.** The app pushes the whole document
  to production on every save (last-write-wins), so a stale open tab could overwrite a migrated
  document. Closing old tabs first avoids that window (see the merge record / spec §2).

### Testing

- **163 Playwright tests, green ×3 consecutive runs** — the v1.0.3 regression suite ported to the
  new node addressing, plus new tree, timeline, theme, and migration suites (migration proven on
  the seed doc, a synthetic `parentId` document, and a copy of a real production snapshot). Every
  browser context blocks the production Worker host, so no test run can write to production D1 —
  the standing safety harness. Protected files stay zero-diff.

## v1.0.3 — Module hierarchy & drag-and-drop

New module-management features (built on top of the integrity fixes above):

- **Move modules (2.1):** grip handle + up/down buttons on every module row;
  pointer drag-and-drop reorders modules. Main modules move as a whole block
  (carrying their sub-modules); the new drag latches `isInteracting` so cloud
  sync never fires mid-drag.
- **Module edit/delete on the row (2.2):** edit, add-feature, and delete
  actions live on the module line.
- **Sub-modules (2.2.1):** a module can be set as a Sub-Module of a main module
  via a Module / Sub-Module toggle + parent picker (one level deep). Deleting a
  parent promotes its sub-modules to main.
- **Tree lines (2.2.2):** sub-modules render a connector rail + elbow from their
  parent in the left grid.
- **Sliding bar labels:** a timeline bar whose start scrolls off the left keeps its
  label pinned to the visible left edge (sliding as you scroll); when the visible
  slice is too small for the label, the hover floating bubble takes over. Bars too
  small to ever fit their label keep the hover bubble.
- **Step indentation (2.4):** features under modules and sub-modules are indented
  by hierarchy level. Excel export shows `Parent › Sub`; the progress panel
  prefixes sub-modules with `↳`.

## v1.0.3 — Integrity fixes (pre-feature hardening)

Security & data-safety fixes applied to the v1.0.2 baseline **before** the new
module features, each confirmed by adversarial verification and covered by a
Playwright regression test:

- **XSS (major):** date values interpolated into `value="…"` are now `esc()`-escaped
  at all five sinks (grid date cell, feature modal start/end, summary date, history
  date). Blocks stored/DOM XSS from a restored or cloud-synced document.
- **Summary loss (major):** the Status & Summary textarea now autosaves on blur and
  before navigating to History, so typed text is never dropped.
- **Mid-drag latch hardening (major):** the interaction latch now also clears on
  `pointercancel` / `lostpointercapture` for all seven drag lifecycles, self-heals on
  the next render, and `.bar`/`.colHead`/`#splitter` get `touch-action:none` — so a
  cancelled touch/trackpad drag can never freeze cloud sync.
- **Mid-drag sync (major):** an interaction latch (`isInteracting`) defers cloud
  pull / cross-tab adoption while any drag or resize is in flight, preventing a
  background sync from corrupting an in-progress drag.
- **Push retry (minor):** a failed cloud push no longer latches `pushPending`; it
  clears and retries with capped backoff.
- **Silent storage failure (minor):** a `localStorage` write failure now surfaces a
  toast instead of losing data silently.
- **Column-width bleed (minor):** column widths are namespaced per project, so a
  resize in one project no longer changes another.
 — Adeptio Project Tracking

All notable changes to the blueprint are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); dates in CE.

> This file is a human-written history of blueprint releases (design/feature level).
> There is no automatic per-action audit log — the Worker persists the whole app
> document in D1 and keeps rolling snapshots in the `backups` table (see
> `schema.sql` / `worker.js`).

---

## [1.0.2] — 2026-07-09
Timeline & table polish (tuning pass), plus a read-only preview build.

### Changed
- **Timeline header** — month-year label (e.g. "Jul '26") is now **centered** within
  its month band (`.monthBand` `justify-content:center`), was left-aligned.
- **Gantt bar tooltips** — hovering a bar whose label is truncated now shows a
  **floating tooltip** with the full text; if the label already fits, no tooltip
  appears. Replaces the native `title` attribute with a shared `.floatTip`
  mechanism (delegated `mouseover`/`mousemove` on `#board`); bar date/status
  info moved to `data-tip`.
- **Left table** — new **"Wrap Txt"** toggle (seg button in the Timeline toolbar,
  persisted to `localStorage` under `adeptio_ptrack_ui`, default **OFF**).
  - **ON** — Feature & Description cells wrap to multiple lines; chart rows
    auto-sync heights (`applyWrap` / `syncRowHeights`) so bars stay aligned and
    vertically centered.
  - **OFF** — current ellipsis behavior, plus a floating tooltip with the full
    text (format "FID · Name" for feature cells) when a cell is truncated.

### Added
- **Read-only PREVIEW copy** under `preview/` — namespaced `_preview`
  localStorage keys, all `PUT`/`POST`/`PATCH`/`DELETE` API calls neutralized
  (`GET` reads still hit live data), "PREVIEW · read-only" ribbon. No changes
  to `worker.js`, `schema.sql`, `wrangler.toml`, the D1 database, or user
  content.

### Round 2 (same day, after review)
Same-day follow-up fixes from user feedback on the tuning pass above.

- **Fixed duplicate tooltip** — module-description rows (`.modDesc`) still carried a
  native `title` attribute alongside the dark `.floatTip`, so a truncated description
  showed both the gray browser tooltip and the floating one at once; the column-header
  drag hint had the same issue. Both now use `data-tip` and route through the shared
  floatTip, which gained a singleton guard (reuses/removes any existing `.floatTip`
  node) so only one can ever be on screen.
- **Wrap Txt toggle relocated** — moved off the Timeline toolbar and onto a compact
  icon button on the Description column header itself (styled like the other header
  controls, shows an "on" state when active); the toolbar seg button was removed.
  Setting still persists to `localStorage` (`adeptio_ptrack_ui`) as before. In the
  preview build, the "PREVIEW · read-only" ribbon moved to the bottom-right so it no
  longer covers the toolbar.
- **All left-table columns are now drag-resizable** — a small handle on each header's
  right edge resizes that column (min 60px / max 640px); with Wrap Txt on, row heights
  and the matching Gantt bar rows follow the content live during the drag. Widths
  persist locally under `adeptio_ptrack_ui` → `colW` — browser `localStorage` only,
  never written to the cloud document/database. Column drag-to-reorder is unchanged.

### Round 3 (same day)
Same-day addition to the tuning pass, from further user feedback.

- **Move features into a new module at creation time** — the "สร้างโมดูล" (Create
  Module) modal gained an optional picker, "ย้ายฟีเจอร์เข้าโมดูลนี้ · Move features
  into this module (ไม่บังคับ)": a scrollable (max-height) list of every existing
  module, each shown as a group header (colour chip + name + feature count + a
  per-module "select all" checkbox, with indeterminate state) and its features as
  individual checkbox rows (checkbox + fid badge + name), plus a live "เลือกแล้ว N
  ฟีเจอร์" counter. On save, any checked features are **moved** — not copied — out
  of their source module and into the new module; the feature object itself
  (id/fid/dates/status/custom fields) is left untouched, only its parent module
  changes, and emptied source modules are left in place. The success toast becomes
  "สร้างโมดูลแล้ว · ย้าย N ฟีเจอร์เข้าโมดูล" when N > 0. Creating a module with
  nothing selected, and editing an existing module, behave exactly as before.

### Round 4 (same day)
Same-day fixes to feature drag & drop and Gantt bar tooltips, from annotated
screenshots in further user feedback.

- **Fixed cross-module feature drag & drop** — dragging a feature row's grip now
  reliably moves it into **any** module, not just ones already visible on screen.
  Root cause: hit-testing and the move itself worked fine when source and
  destination were both on screen, but there was no auto-scroll, so a destination
  module scrolled out of the left-table viewport was simply unreachable mid-drag.
  Dragging near the top/bottom edge of the left pane now auto-scrolls it (right
  pane stays vertically synced) while continuously re-evaluating the drop target,
  so far-away modules scroll into reach. Also added drop-on-module-header (inserts
  at the top of that module), drop-on-a-collapsed-module, and drop-on-the-
  "เพิ่มฟีเจอร์" zone (appends at the end of that module), plus stronger
  insertion indicators. The moved feature's Gantt bar automatically recolors to
  the destination module's palette colour; the feature object itself
  (id/fid/dates/status/custom fields) is preserved untouched.
- **Floating tooltip on scrolled-out-of-view bar labels** — the bar tooltip now
  also appears when a Gantt bar's label has scrolled outside the visible chart
  area (e.g. a wide bar whose label extends past the left edge of `#rightScroll`),
  not only when the label is truncated inside a narrow bar. Fully visible,
  untruncated labels still show no tooltip.

---

## [2.3.0] — 2026-06-21
Two-page project view.

### Added
- **Two project tabs** in the top bar:
  1. **สถานะและสรุป (Status & Summary)** — the status note + update date + history, grouped
     on one page with the module **progress bars** and overall %.
  2. **ไทม์ไลน์ (Timeline)** — the detailed status grid (columns) + the Gantt chart.
- **Landing on Status & Summary** whenever a project opens, with a **"ไทม์ไลน์โครงการ →"**
  link in the page header (in addition to the tab) to jump to the Timeline page.

### Changed
- **Tab-scoped toolbar.** `+ Module`, `+ Column`, `PNG`, `Print`, Zoom, Scroll, Today and the
  ค.ศ./พ.ศ. toggle now appear **only on the Timeline page**. **Import** and **Export (.xlsx)**
  appear on **both** pages. Importing from the Status page refreshes that page in place.
- Project shell is now `#topbar` + `#projBody`; the active tab renders into `#projBody`
  (`renderTab()` / `switchTab()`), and the summary text auto-saves when you leave the page.

---

## [2.2.0] — 2026-06-21
Adeptio Lab design system + module progress.

### Added
- **Adeptio Lab design system applied** — tokens lifted 1:1 from `colors_and_type.css`
  (adeptiolab.com): Comfortaa headings / Kanit body, the pink→violet brand gradient on
  primary buttons and "done" progress, violet `#9241ff` primary, ruby `#ff4a7b` today
  marker, green `#3ef2b1` reserved for active/hover states only, pill radii, brand
  elevation. Brand logo/icon in the dashboard and project headers; favicon set. No emoji
  (Heroicons-style line icons + the 4-point sparkle only).
- **Project Status → progress panel** — auto-calculated **overall %** plus a per-module
  stacked bar showing *done* (gradient) and *in-progress* (started but not done: in-progress
  + at-risk + blocked) over a *not-started* track. Percentages recompute live on any status
  change.
- **Hide a module's graph** — each module bar has a hide control; hidden modules drop out of
  both the list and the overall %, and can be restored from the "ซ่อนอยู่" chips.
- **Drag-reorder the module graphs** — grip handle reorders the progress rows independently
  of the Gantt order (persisted as `progressOrder`).
- **Dashboard progress** — every project card now shows an overall progress bar + % and
  compact per-module mini-bars.

### Changed
- Project Status header trimmed to the eyebrow **Project Status** + Thai **สรุปสถานะโครงการ**
  (removed the redundant "· Project Status and Summary").

### Data
- Project gains `progressOrder: string[]`; modules gain optional `hideProgress: boolean`.
  Both are backward-compatible (absent → derived). Reflected in `db/schema.sql`
  (`modules.hide_progress`, `projects.progress_order`).

---

## [2.1.0] — 2026-06-21
Refinements after first review.

### Added
- **Resizable column pane** — drag the vertical splitter between the table and the
  timeline to widen/narrow the column area to read column detail (width remembered
  per project, in `project.leftW`).
- **Drag-to-reorder columns** — drag any column header left/right to change column
  order (stored in `project.colOrder`; base and custom columns alike).
- Feature **edit / delete surfaced** per row — inline edit plus always-visible row
  actions (▲ ▼ + delete), alongside the existing "เพิ่มฟีเจอร์ในโมดูลนี้" add row.
  Delete now asks for confirmation.

### Changed
- **Update date** ("วันที่อัปเดต") moved onto the "สรุปสถานะโครงการ · Project Status and
  Summary" title line, right-aligned in the corner.

### Removed
- **Page-break feature** removed entirely — toolbar button, draggable break rows,
  CSS, the `page_breaks` table, and its API route.

---

## [2.0.0] — 2026-06-21
Major rework: from a single YSC Gantt file (v1) to a multi-project app with a
dashboard, per-project shareable views, and a Netlify + Turso back end.

### Added
- **Multi-project dashboard** ("Adeptio Project Tracking") — create / edit / delete
  projects. YSC is seeded as one project among others.
- **Per-project Gantt** with its own URL (`#project=<id>` or `/p/<id>`). Opening a
  project from the dashboard launches a **new window**; the project view has **no
  back-link** to the dashboard (safe to share with a client).
- **Project Status and Summary** panel above each Gantt — free text up to **1,000
  characters** with live counter, plus an **editable date** (calendar) per summary.
- **Status history page** — "ประวัติ" opens a full page (`&view=history`) listing all
  past summaries; each entry's **text and date are editable**, and entries can be deleted.
- **Status column** (5 states: Not Started / In Progress / At Risk / Blocked / Done)
  placed **before the Remark column**, with a colour cue in the grid and a status dot
  on each Gantt bar.
- **Add / delete columns** — custom columns (text or date) via a modal; delete via the
  column header's × button. Custom columns are included in Excel export/import.
- **Movable page breaks** — insert a page break, **drag it** to re-anchor after any row,
  or remove it. Print/PDF respects breaks (`break-after: page`).
- **Mouse drag-reorder of rows** — drag the row grip to reorder within a module or move
  a feature to another module (▲▼ buttons retained as a fallback).
- **Module-create modal with short description** (replaces the old prompt()); the
  description shows under the module name.
- **Scroll toolbar** — buttons to nudge the **columns** pane and the **chart** pane
  left/right, in addition to native scrolling (panes stay vertically synced).
- **Back end scaffold**: Turso schema (`db/schema.sql`), Netlify Function REST API
  (`netlify/functions/api.mjs`), `netlify.toml`, `package.json`, `.env.example`.

### Changed
- Split the single HTML file into `public/index.html` + `public/styles.css` +
  `public/app.js` (cleaner, and ready for Netlify static hosting).
- Persistence now uses `localStorage` with a safe in-memory fallback, and a documented
  seam to swap the local `Store` for the Turso-backed `/api/*` endpoints.
- Excel export/import extended to carry the **Status** column.

### Notes
- The Netlify MCP connector returned "No approval received" during this build, so the
  back end was scaffolded with standard Netlify Functions v2 conventions instead of via
  MCP. Authorize the Netlify connector to deploy directly from chat (see README).

---

## [1.0.0] — earlier
- Initial single-file YSC Gantt blueprint: module/feature rows, drag-to-move/resize
  bars, ค.ศ./พ.ศ. toggle, Day/Week/Month zoom, Excel & PNG export, today marker.
