# Adeptio Project Tracking

A multi-project Gantt dashboard. The main **dashboard** lists every project; each
project opens as its **own Gantt view with its own URL** (shareable with a client),
in a **new window**. Built as a static SPA with an optional **Netlify + Turso** back end.

```
adeptio-project-tracking/
├── public/
│   ├── index.html        # shell (loads styles.css + app.js, Comfortaa/Kanit, brand favicon)
│   ├── styles.css        # all styling — Adeptio Lab design system applied
│   ├── adeptio-ds.css    # brand token reference (colours_and_type, Adeptio Lab)
│   ├── assets/           # brand logos, icons, sparkle (star.png)
│   └── app.js            # all logic (dashboard, Gantt, summary/history, progress)
├── netlify/functions/
│   └── api.mjs           # REST API -> Turso (Netlify Functions v2)
├── db/
│   └── schema.sql        # Turso/libSQL schema + small seed
├── changelog/
│   └── CHANGELOG.md      # blueprint change history
├── netlify.toml          # publish=public, functions dir, /p/* SPA redirect
├── package.json          # @libsql/client, ESM, node>=18
└── .env.example          # TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
```

## Run locally (no back end needed)
Open `public/index.html` in a browser, **or** serve the folder:
```bash
cd public && python3 -m http.server 8080   # http://localhost:8080
```
Data persists in `localStorage` (with a safe in-memory fallback). Excel/PNG export
need an internet connection (SheetJS + html2canvas load from CDN).

## Feature map (per the request)
| Request | Where |
|---|---|
| "Project Status and Summary" text box (1,000 chars) + date before the Gantt | summary panel above the board; `renderSummary()` |
| Calendar-editable date per summary | date input in the panel and in each history entry |
| History page to view/edit summary text & date | "ประวัติ" → `&view=history` full page; `showHistory()` |
| Add / delete columns | toolbar **+ Column** (modal) / × on column header |
| Reorder columns by dragging headers | drag a column header left/right; `onColDragStart` → `moveColumn` (order stored in `project.colOrder`) |
| Status column before Remark | base column `status`, 5 states, colour cue + bar dot |
| Two project tabs: **Status & Summary** (landing) and **Timeline** | `renderProject()` shell + `renderTab()`/`switchTab()`; lands on Status & Summary |
| Link from Status & Summary → Timeline | "ไทม์ไลน์โครงการ →" button in the page header + the tab nav |
| `+ Module` / `+ Column` / `PNG` / `Print` / Zoom / Scroll / Today on Timeline only; `Import` / `Export` on both | toolbar groups marked `.tlOnly` (hidden on the Status tab via `#proj[data-tab="summary"] .tlOnly`) |
| Project Status header = eyebrow + Thai only | `renderSummary()` (English "Project Status and Summary" removed) |
| Per-module progress bars + auto overall % (done vs in-progress over not-started) | `#progressPanel`; `renderProgress()`, `moduleStats()`/`aggregateStats()` |
| Hide / restore a module's progress graph | hide control per row → `module.hideProgress`; restore chips |
| Drag-reorder the progress graphs | grip handle → `onProgDrag*` (order in `project.progressOrder`) |
| Dashboard: per-project overall progress + per-module mini-bars | each card's `.cardProg` / `.cardMods` in `renderDashboard()` |
| Adeptio Lab design system | tokens in `styles.css` / `adeptio-ds.css`: Comfortaa·Kanit, pink→violet gradient, violet/ruby/green, pill radii, brand logos, no emoji |
| Resize column pane to see column detail | drag the vertical **splitter** between panes; `onSplitDown` (width stored in `project.leftW`) |
| Add / edit / delete features in a module | "เพิ่มฟีเจอร์ในโมดูลนี้" row (add) · inline edit · always-visible row actions ▲▼ + delete |
| Mouse drag rows up/down | row grip → `onRowDragStart` (within & across modules) |
| Create-module pop-up with short description | **+ Module** → `moduleModal()` |
| Toolbar to scroll columns & chart left/right | **Scroll** group (Cols ◀▶ / Chart ◀▶) |
| Multi-project dashboard (create/edit/delete) | dashboard route; `renderDashboard()` |
| Separate Gantt path per project, opens new window | `#project=<id>` / `/p/<id>`; `openProjectWindow()` |
| Project view has no back-link to dashboard | project shell omits any dashboard nav |

## Deploy to Netlify + Turso

### 1. Create the Turso database
```bash
curl -sSfL https://get.tur.so/install.sh | bash      # install CLI
turso db create adeptio-ptrack
turso db shell adeptio-ptrack < db/schema.sql        # load schema + seed
turso db show --url adeptio-ptrack                    # -> TURSO_DATABASE_URL
turso db tokens create adeptio-ptrack                 # -> TURSO_AUTH_TOKEN
```

### 2. Deploy the site
Push this folder to Git and "Add new site" in Netlify (build command empty,
publish dir `public`), then set the two env vars (Site settings → Environment
variables): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`. Or use the CLI:
```bash
npm i && npm i -g netlify-cli
netlify env:set TURSO_DATABASE_URL "libsql://...turso.io"
netlify env:set TURSO_AUTH_TOKEN  "..."
netlify deploy --prod
```
The API is then live at `/api/*` (e.g. `GET /api/projects`).

### Connecting the front end to the API (the "Store seam")
The SPA ships with a local `Store` so it works with zero back end. To go live,
replace `Store` in `public/app.js` with an async client and `await` its calls:
```js
const Store = {
  async getProject(id){ return (await fetch('/api/projects/'+id)).json(); },
  async patchFeature(id, patch){
    await fetch('/api/features/'+id, { method:'PATCH', headers:{'content-type':'application/json'}, body: JSON.stringify(patch) });
  },
  // ...projects/modules/columns/summaries per netlify/functions/api.mjs
};
```
`GET /api/projects/:id` already returns the exact shape the renderers expect
(modules → features, `customCols`, `summary.current` + `summary.history`),
so the mapping is direct.

## Change logging
- `changelog/CHANGELOG.md` — human history of blueprint releases.
- `audit_log` table (`db/schema.sql`) — automatic per-action log written by the API;
  read with `GET /api/audit?project=<id>`.

## MCP status (rechecked)
- **Netlify** connector is present but returned **"No approval received"** for the
  coding-context call during this build, so the back end uses standard Netlify
  Functions v2 conventions. Authorize the Netlify connector to deploy from chat
  (create project, set env vars, initialize DB, deploy) — happy to do that on request.
- **Turso** has no first-party connector in this workspace; it's integrated directly
  via `@libsql/client` + env vars (no MCP needed).
