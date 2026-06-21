# Changelog — Adeptio Project Tracking

All notable changes to the blueprint are recorded here.
Format follows [Keep a Changelog](https://keepachangelog.com/); dates in CE.

> **Two kinds of "log of change" in this project**
> 1. **This file** — human-written history of blueprint releases (design/feature level).
> 2. **`audit_log` table** (see `db/schema.sql`) — automatic, per-action runtime log
>    (create/update/delete/reorder of any project, module, feature, column, or
>    summary) written by the API. Read it via `GET /api/audit?project=<id>`.

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
