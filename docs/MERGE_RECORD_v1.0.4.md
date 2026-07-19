# Merge record — v1.0.4 (pre-merge checklist)

**Branch:** `v1.0.4` → `main`  ·  **Date prepared:** 2026-07-18  ·  **Deploy target:** GitHub
Pages `torukung/adeptio_gantt` → `timeblock.io`.

One page for the operator to read **before** merging and deploying. PR to `main` only on your
explicit go (Fable owns the merge).

## What ships

A four-stage feature release, each stage Fable-audited:

1. **core-tree** — `P.modules` becomes one recursive container/feature tree; `docVer 2`
   migration at every load path; single `apply()` mutation gate; node-id addressing; cascade
   delete with confirm.
2. **tree-ui** — grip menu `⠿` on every row (replaces v1.0.3 hover clusters); indent/outdent,
   promote/demote, unified edit modal; tree guides + stepped indent shading (left).
3. **timeline** — continuous px-per-day zoom with `−  N.N เดือน  +  พอดี` toolbar (presets kept
   as shortcuts); label font curve + hide-to-dot + hover bubble; right-pane stepped shading;
   container span bars at depth.
4. **theme** — Auto/Light/Dark control (`อัตโนมัติ / สว่าง / มืด`); dark token set; PNG export and
   print forced to the light ground.

Diff is limited to `app.js`, `styles.css`, `CHANGELOG.md`, `docs/**`, `tests/**`, `.gitignore`.

## Deploy-time action — CLOSE OLD TABS (do not skip)

The app pushes the **whole document** to production D1 on every save, arbitrated last-write-wins.
GitHub Pages deploys atomically, but an **already-open v1.0.3 tab** can push a v1-shape document
after v1.0.4 is live and clobber a migrated doc (spec §2, LWW clobber window).

- [ ] After the front-end deploys, **close every old v1.0.3 tab before editing** in the new build.
- A dual-write `features[]` mirror is in place so a stale tab still renders sanely in the meantime,
  but it does not remove the clobber risk — closing the tab does.

## Reminder for v1.0.5 — remove the compatibility mirror

- [ ] **Remove the dual-write `features[]` mirror** (each container currently writes a legacy
      `features[]` alongside `children`; ignored on load under `docVer ≥ 2`). It exists only to keep
      open v1.0.3 tabs alive during the transition. Search `REMOVE IN v1.0.5` in `app.js`.

## D1 backup expectation

- The Worker keeps **30 rolling snapshots** per workspace (`KEEP_SNAPSHOTS = 30`, `worker.js`) plus
  daily/weekly cron copies to the configured cloud drive.
- [ ] **Take a manual snapshot before merge** — dashboard → *Backup / Restore* → *Back up now*
      (`POST /api/backups?period=manual`), so there is a labelled pre-v1.0.4 restore point that the
      30-slot rolling window cannot age out during rollout.

## Verification state

- [ ] **163 Playwright tests green ×3 consecutive runs** (v1.0.3 regression ported to node addressing
      + new tree/timeline/theme/migration suites). Every browser context blocks the production Worker
      host `adeptio-gantt.pathom-bot.workers.dev/**` — **zero prod-host requests**, no `pageerror`.
- [ ] **Migration proven** on the seed doc, a synthetic `parentId` document, and a copy of a real
      production snapshot.
- [ ] **Protected files zero-diff** — `worker.js`, `schema.sql`, `wrangler.toml`, `index.html`,
      `cloudflare/`, `preview/`, `CNAME` untouched.
- [ ] **Isolation check CLEAN** — run `isolation_check.py` from the vault root (Adeptio deliverables
      carry no Fortinet intel); confirmed CLEAN through the tree-ui stage, re-run after docs land.

## Merge steps (Fable, on your go)

1. Confirm all boxes above are checked.
2. Merge `v1.0.4` → `main`; deploy the front-end to `torukung/adeptio_gantt`.
3. Post-deploy: close old tabs (above), smoke-test on two devices, verify cloud sync adopts the
   migrated (`docVer 2`) document.
