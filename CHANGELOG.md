# Changelog

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
