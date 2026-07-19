# ADEPTIO Gantt v1.0.5 — Architect Spec (Fable)

Branch: `v1.0.5` (from main `fd0008f`, the v1.0.4 merge).
Prototype (NOTEs popup + timestamps, pending user approval): https://claude.ai/code/artifact/02358dff-84ba-448d-9772-1dcfc59e4eaf (local copy: `v1.0.5 - Dev/prototype/PROTO_v1.0.5_notes_timestamp.html` in the vault).
Operating model: **Fable** orchestrates / architects / audits / stages; **Opus 4.8 max** workers implement, write, and document; Fable re-tasks on error or stall. Workers never run git — Fable owns commits.

**HARD SAFETY RULES (unchanged, non-negotiable)**
- Never touch `worker.js`, `schema.sql`, `wrangler.toml`, `index.html`, `cloudflare/`, `preview/`, `CNAME`.
- Every Playwright/browser context MUST block `https://adeptio-gantt.pathom-bot.workers.dev/**` before page scripts run (the app pushes the full doc to production D1 on every save). Reuse `tests/fixtures.js`; keep the zero-prod-requests assertion.
- Local test/self-check servers on ports 4173 (suite) / 4192–4199 (scratch); kill on exit; after any killed/stalled worker, sweep for leftover processes and check load averages before trusting suite timings.
- Match compact vanilla-JS style, Thai-first UI strings, existing `IC` icon system and `styles.css` token conventions (light + dark token sets exist since v1.0.4 — every new surface must define both).
- Before any push: `python3 isolation_check.py .` from the vault root must print CLEAN.

---
## 1. Scope — a minor release, three items, fixes first

- **F0 (fix, first code commit)** — remove the v1.0.4 dual-write `features[]` compatibility mirror.
- **F1** — automatic **last-edit timestamp** stamped on any information edit/change, displayed on the dashboard card and the Project Status header.
- **F2** — **Project NOTEs**: a `โน้ต` button beside วันที่อัปเดต on the Project Status page opening a popup with a two-column rich-text notepad (left = business, right = technical), auto-saved, sectioned by date, stored in a **separate top-level section of the doc**.

Out of scope: worker/API/schema changes (frozen files), Excel/PNG export of notes, tree drag-and-drop re-parenting, KPI changes.

---
## 2. F0 — remove the dual-write mirror (committed v1.0.4 backlog)

Per `docs/MERGE_RECORD_v1.0.4.md` §"Reminder for v1.0.5" and the `REMOVE IN v1.0.5` marker in `app.js`:

- Delete `writeMirror()` (app.js ~line 1029) and its two call sites: `Store.save()` (~177) and `adoptRemote()` (~232).
- Do **not** strip existing `features:[]` mirror keys from stored docs — leave stale keys inert (they are ignored on load under `docVer ≥ 2`; an active cleanup pass adds LWW risk for zero benefit). **(N1)**
- Migration read-path (`migrateDoc`, v1→v2) is UNTOUCHED — a pre-v1.0.4 doc restored from an old backup must still migrate.
- Tests: drop/adjust any test asserting mirror presence; add one asserting a saved v2 doc gains **no new** `features` keys on containers created after this change.

---
## 3. F1 — last-edit timestamp ("แก้ไขล่าสุด")

### Data
- `p.updatedAt` upgrades from date-only (`"2026-06-26"`, set only by the status-save button today) to **full ISO datetime** (`new Date().toISOString()`).
- New doc-level `DB.updatedAt` (ISO datetime).
- **ONE stamping point** — inside `Store.save()`, before serialize: `DB.updatedAt = nowIso()`, and `if (PID && proj()) proj().updatedAt = nowIso()`. Every doc mutation in the app already funnels through `Store.save()`, so this covers "any information edit/change" with zero per-call-site edits. **(N2)**
- UI-only state (`saveUi()`: theme, ppd, colW, wrapTxt) does NOT stamp — it never touches the doc. `P.leftW` (splitter) DOES go through `Store.save()` and therefore stamps; accepted (it is doc data).
- Remove the now-redundant manual `P.updatedAt=iso(today())` in `sumSave.onclick` (~line 705) — the central stamp supersedes it.
- Back-compat: existing values are date-only strings; old v1.0.4 tabs may still write date-only during the LWW window. Display must handle both. No `docVer` bump — additive/format-tolerant change. **(N3)**

### Display
- Helper `fmtStamp(s)`: date-only string → `DD/MM/YYYY`; ISO datetime → `DD/MM/YYYY HH:mm` (24h, local time). Render in `mono`, dim ink.
- **Dashboard card** (`renderDashboard`, ~line 437): under the existing `อัปเดต <summary date>` line, add `<div class="lastEdit mono">แก้ไขล่าสุด <fmtStamp(p.updatedAt)></div>` (omit when unset).
- **Project Status header** (`renderSummary` sumHeadRow): small dim `แก้ไขล่าสุด <stamp>` element under/beside the date row; refreshed by a light `syncStamp()` DOM update after each save on that page (no full re-render mid-typing).
- Both themes: `.lastEdit` colour from an ink token (e.g. `var(--ink3)`/muted), NOT a hard-coded hex.

---
## 4. F2 — Project NOTEs (per-project, two-column, date-sectioned)

### 4.1 Entry point
`renderSummary()` sumHeadRow, between `sumDateWrap` and `#goTimeline`:
`<button class="btn sm" id="sumNotes" title="โน้ตโครงการ">${IC.note} โน้ต</button>` (add an `IC.note` SVG consistent with the icon set). Button shows a small count badge when notes exist (total sections both columns, e.g. `โน้ต (3)`).

### 4.2 Popup
- Dedicated overlay `#notesOverlay` (sibling pattern of `#historyOverlay`; add the div in `app.js` bootstrapping if absent — `index.html` is frozen, so the overlay root must be created by JS at startup like other dynamic roots, or reuse `historyOverlay`'s creation pattern. **(N4: do NOT edit index.html.)**
- Open: fade/scale-in, `85vw × 82vh` max `1100px` wide; ≤860px viewport → columns stack vertically, popup goes near-fullscreen.
- Close: `×` button, `Esc`, click on the backdrop. Closing flushes any pending save synchronously.
- `editingNow()` must return `true` while `#notesOverlay` is open (add to its overlay checks) so a cloud pull never adopts/re-renders mid-typing. **(N5)**
- Print: overlay hidden under `@media print`.

### 4.3 Layout — TABBED, one section at a time (user revision 2026-07-19, prototype r2)
Header: `โน้ตโครงการ · <project name>` + auto-save state chip (`กำลังบันทึก… / บันทึกแล้ว ✓`) + `×`.
Below the header, a **tab bar** (pill tabs, active = primary fill):
- Tab 1 — `ธุรกิจ · BUSINESS (n)` — default active
- Tab 2 — `เทคนิค · TECHNICAL (n)`
`(n)` = that tab's non-empty section count, live. Only ONE tab panel is visible/editable at a time; BOTH panels stay mounted in the DOM so switching preserves in-flight edits, and switching flushes any pending auto-save first. (The original two-columns-side-by-side layout was rejected by the user after prototype r1 — it stacked upper/lower on their screen.)
Each tab panel: sticky mini-toolbar `[B] [I] [• bullets] [6-swatch text-colour palette]` + scrollable section list.

### 4.4 Date sections ("cut-sectioned line by date")
- A column's content = array of day sections, rendered **newest-first**, each: dashed divider line with a centred date chip (`— 19/07/2026 —`) followed by that day's contenteditable region.
- Today's section is created lazily on the **first keystroke** of the day (no empty-section litter on open). Older sections stay editable in place; editing any section stamps F1 timestamps as usual.
- Empty sections (all content deleted) are pruned on save.
- **Section delete + action log (user revision r3, 2026-07-19):** every date divider carries a **bin button** behind the date chip (subtle at rest, red when armed). Two-click arm-confirm — first click arms for ~2.6s with a toast, second click deletes the WHOLE day section including the divider ("delete all evidences"; today's section clears content and re-hides its divider). No native confirm() dialogs. Each deletion appends `{ts: ISO, action:'delete', col, date}` to the project's notes **log** (cap 200, trim oldest). The log is viewable via a `log (n)` chip in the popup header that toggles a compact mono strip (`19/07/2026 13:27 · ลบโน้ตธุรกิจ 15/07/2026`); log entries are NOT removable from the UI. **(N10)**

### 4.5 Rich text + safety
- `contenteditable` regions; toolbar drives `document.execCommand('bold' | 'italic' | 'insertUnorderedList' | 'foreColor')` on the focused section (deprecated-but-universal; acceptable for this scope — wrap in a tiny `fmt()` helper so a future Selection-API swap is one function). Bullets render as `ul { padding-left:22px }` / `li { margin:2px 0 }` inside the note region.
- **Highlight (user revision r3):** toolbar marker button applies light-yellow `#fff3a8` via `hiliteColor`. Toggle-off must NOT use `hiliteColor 'transparent'` (nests a see-through span over the yellow one — verified failure in the prototype); instead detect highlighted state by DOM inspection (any intersecting element with a background) and strip `background-color` from every element the selection touches, whole-run. Dark theme forces readable dark ink on highlighted runs (`html[data-theme="dark"]` rule matching the highlight colour). **(N11)**
- **Sanitizer (mandatory, both on save and on render of stored html):** whitelist tags `B STRONG I EM SPAN DIV P BR FONT UL LI`, attributes only `style="color:…"` / `style="background-color:…"` (highlight; drop `transparent` leftovers) / `color`; strip everything else (tags unwrapped to text, `script/style/iframe` dropped entirely). This is the XSS gate for html round-tripped through the doc/cloud. **(N6)**
- Paste is forced to plain text (`insertText`).
- Per-section stored-html cap 20,000 chars — over-cap saves are trimmed with a one-time toast warning.

### 4.6 Auto-save
- `input` → debounce **600ms** → sanitize → write section → `Store.save()` (which also stamps F1). Chip shows `กำลังบันทึก…` while dirty, `บันทึกแล้ว ✓` after. Also flush on column blur and on close.
- Chain check: notes debounce 600ms then `schedulePush` 800ms — typing bursts coalesce into one cloud push; no new sync machinery. **(N7)**

### 4.7 Storage — "DB backup altogether, but in separate section/table"
```
DB.notes = {
  [projectId]: {
    business:  [{ date:"YYYY-MM-DD", html:"…" }],   // newest-first
    technical: [{ date:"YYYY-MM-DD", html:"…" }],
    log:       [{ ts:"ISO", action:"delete", col:"business|technical", date:"YYYY-MM-DD" }]  // newest-first, cap 200
  }
}
```
- A **separate top-level section of the doc** — deliberately NOT inside `projects[]`. It rides the same D1 document, so every rolling/manual D1 snapshot and every `prod_state_snapshot_*.json` backs notes up automatically, while staying a cleanly separable section (ready to graduate to its own D1 table whenever `worker.js`/`schema.sql` are next unfrozen — out of scope now). **(N8)**
- `migrateDB`: ensure `DB.notes` object exists (idempotent, additive; NO `docVer` bump).
- Project delete → prune `DB.notes[pid]` in the same mutation.
- **LWW hazard (unchanged pattern):** a still-open v1.0.4 tab saving after v1.0.5 ships will drop `DB.notes` (whole-doc last-write-wins). Mitigation identical to v1.0.4: merge record orders CLOSE OLD TABS after deploy; D1 rolling snapshots cover recovery. **(N9)**

---
## 5. Tests (extend the 163-green suite; keep everything green ×3)

1. **T-F0** saved v2 doc: containers created post-mirror-removal carry no `features` key; v1-shape doc still migrates.
2. **T-F1a** editing a feature name → `p.updatedAt` becomes full-ISO "now"; card + status header render the stamp.
3. **T-F1b** ui-only changes (theme switch, zoom) do NOT change `updatedAt`.
4. **T-F1c** `fmtStamp` renders date-only legacy values without `NaN`/time garbage.
5. **T-F2a** open/close popup via button, Esc, backdrop; `editingNow()` true while open.
6. **T-F2b** typing → after debounce, localStorage doc has `DB.notes[pid].business[0]` with today's date; reload → persists; count badge updates.
7. **T-F2c** bold/italic/bullets/colour round-trip (bullets → `ul>li` kept by sanitizer, attrs stripped); injected `<script>`/`<img onerror>` stripped by sanitizer on save AND on render.
8. **T-F2d** tabs: business default; switching shows exactly one panel, preserves the other panel's unsaved edit (pending save flushed on switch), per-tab counts correct; one date divider per day per tab; empty section pruned.
9. **T-F2e** project delete prunes its notes; `migrateDB` creates `DB.notes` on old docs.
10. **T-F2f** section delete: first bin click arms (no delete), auto-disarms ~2.6s; second click removes divider + content, appends a log entry, persists (reload: section gone, log kept); today-section delete clears + re-hides divider, typing again re-creates.
11. **T-F2g** highlight: apply → yellow span survives sanitize; toggle-off with full-selection AND caret-inside both remove it (no nested-transparent-span failure); dark theme renders highlighted text in dark ink.
12. **T-SAFE** zero requests to the prod Worker host (existing fixture assertion, re-affirmed).

---
## 6. Delivery — audited commits on `v1.0.5`

1. `spec` — this document. *(committed by Fable)*
2. `fix: remove dual-write mirror` (F0) — fixes BEFORE features, per standing order.
3. `feat: last-edit timestamps` (F1).
4. `feat: project NOTEs popup` (F2) — **only after the user approves the interaction prototype**.
5. `docs + tests`: CHANGELOG, as-built spec deltas, `MERGE_RECORD_v1.0.5.md` (must repeat the CLOSE-OLD-TABS ritual and the pre-merge manual D1 snapshot step).

Each code commit: Opus-max worker implements → adversarial audit (spec/refute/safety/tests/style lenses) → fix worker → Fable reads the diff, runs the suite, commits. Merge to main only on the user's explicit "merge now".
