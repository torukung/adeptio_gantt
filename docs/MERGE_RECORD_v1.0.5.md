# Merge record — v1.0.5 (pre-merge checklist)

**Branch:** `v1.0.5` → `main`  ·  **Date prepared:** 2026-07-19  ·  **Deploy target:** GitHub
Pages `torukung/adeptio_gantt` → `timeblock.io`.

One page for the operator to read **before** merging and deploying. PR to `main` only on your
explicit go (Fable owns the merge).

## What ships

A fix-first minor release, four code commits plus spec, each Fable-audited:

1. **F0 (fix)** — `195700e` — remove the v1.0.4 dual-write `features[]` compatibility mirror
   (`writeMirror()` and its two call sites in `Store.save()` / `adoptRemote()`). Stale `features`
   keys already in stored docs stay inert; the v1→v2 migration read-path is untouched.
2. **F1** — `97cc99e` — central last-edit timestamp (แก้ไขล่าสุด): one stamping point inside
   `Store.save()` upgrades `DB.updatedAt` and the open project's `updatedAt` to full ISO datetimes
   on every doc mutation; `fmtStamp()` renders both legacy date-only and full-ISO values.
3. **F2** — `ef6975c` — Project NOTEs popup: tabbed ธุรกิจ/เทคนิค notepad, 600ms autosave,
   date-sectioned, bin + glass-confirm delete with an action log, bullets + light-yellow
   highlighter, `DB.notes` as a separate top-level doc section.
4. **Tests + hardening** — `8362000` — `stamps-v105.spec.js` + `notes-v105.spec.js` (13 new
   spec-§5 tests); `sanitizeNoteHtml`/`stripNoteText` moved to an inert `DOMParser` parse.
5. **Audit fixes** — `1825118` — 8 confirmed findings from the 5-lens adversarial audit resolved
   (majors: document-global `styleWithCSS` leak stripping bold/italic after colour/highlight;
   `route()`/Back-button notes-overlay teardown that could flush one project's notes into another).
   +1 test (T-F2d2 empty-section prune) → 177 total.
6. **UI polish** — `ba2d69d` — feature text aligned to the parent module's name at every tree depth
   (CSS-only, user-approved on a cloud-disabled demo).

Spec commits `cb8a641` (architect spec), `8eabdba`, `2d42818` (spec r2), `a820335` (spec r3),
`2c4faf2` (spec r4) precede the code commits and record the interaction revisions the prototype
went through before F2 was approved. Full range: `fd0008f..HEAD` (`fd0008f` = the v1.0.4 merge
commit on `main`).

Diff is limited to `app.js`, `styles.css`, `CHANGELOG.md`, `docs/**`, `tests/**`.

## Deploy-time action — CLOSE OLD TABS (do not skip)

The app pushes the **whole document** to production D1 on every save, arbitrated last-write-wins.
GitHub Pages deploys atomically, but **this release removes the v1.0.4 dual-write mirror AND adds
`DB.notes`, a brand-new top-level doc section.** A still-open **v1.0.4 tab** saving after v1.0.5
deploys will push its in-memory document — which has no `DB.notes` key at all — over the live D1
document under whole-doc LWW, **dropping every note anyone has entered since deploy.** This is the
single biggest operator risk in this release; the mirror-removal itself is comparatively low-risk
(stale `features[]` keys were already ignored on load).

- [ ] After the front-end deploys, **close every open v1.0.4 tab before anyone edits notes** in the
      new build. There is no dual-write shim this time — an old tab is not "stale but safe," it is
      actively destructive to `DB.notes`.
- [ ] Warn active users directly (Slack/DM) if any v1.0.4 tabs are known to be open — do not rely on
      them noticing the deploy on their own.

## Pre-merge manual D1 snapshot (do not skip)

- [ ] **Take a manual snapshot before merge** — dashboard → *Backup / Restore* → *Back up now*
      (`POST /api/backups?period=manual`), so there is a labelled pre-v1.0.5 restore point that the
      rolling window cannot age out during rollout, and `DB.notes` has a recovery point from the very
      first save that includes it.

## D1 backup expectation

- The Worker keeps **30 rolling snapshots** per workspace (`KEEP_SNAPSHOTS = 30`, `worker.js`,
  unchanged this release) plus daily/weekly cron copies to the configured cloud drive. `DB.notes`
  rides the same whole-document snapshot as everything else — no new backup plumbing was needed
  because notes were deliberately kept as a section of the existing doc rather than a new D1 table
  (spec §4.7, N8).

## Verification state

- [x] FULL SUITE: **177 tests green ×3 consecutive** at `1825118` (8.0m / 6.4m / 7.8m,
      2026-07-19, load checked before runs) **+ ×1 at tip `ba2d69d`** (6.7m; the only delta from
      the certified commit is the CSS-only indent polish). Every context blocks the prod Worker
      host; zero prod requests, no pageerrors.
- [x] Adversarial audit: 5 Opus lenses over `fd0008f..HEAD`, 11 findings → **8 confirmed** by
      3-vote judge panels (3 rejected as style nitpicks), **all 8 resolved** in `1825118`.
- [x] **Protected files zero-diff** — verified `git diff --name-only fd0008f..HEAD` touches only
      `app.js`, `styles.css`, `CHANGELOG.md`, `docs/**`, `tests/**`; `worker.js`, `schema.sql`,
      `wrangler.toml`, `index.html`, `cloudflare/`, `preview/`, `CNAME` untouched.
- [x] **Isolation check CLEAN** — `isolation_check.py` run from the vault root before every push
      of this branch (last: pre-ship push, 2026-07-19).

## Merge steps (Fable, on your go)

1. Confirm all boxes above are checked.
2. Merge `v1.0.5` → `main`; GitHub Pages deploys the front-end to `timeblock.io` immediately on
   merge — there is no separate deploy step to trigger.
3. Post-deploy: close old tabs (above, non-negotiable this release), smoke-test the NOTEs popup and
   the last-edit stamp on two devices, verify cloud sync carries `DB.notes` through a pull.
