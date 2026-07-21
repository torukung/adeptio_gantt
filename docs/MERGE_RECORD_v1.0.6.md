# Merge record — v1.0.6 (pre-merge checklist)

**Branch:** `v1.0.6` → `main`  ·  **Date prepared:** 2026-07-21  ·  **Deploy target:** GitHub
Pages `torukung/adeptio_gantt` → `timeblock.io`.

One page for the operator to read **before** merging and deploying. PR to `main` only on your
explicit go (Fable owns the merge). **The merge has not happened yet.** This record was compiled
from a read-only `git log`/`git show`/`git diff` audit of the branch: no `add`/`commit`/`push`,
no edits to any protected file, no contact with the prod Worker host, and no test-suite execution
were performed while preparing it. Every checklist item below reflects that — items already
confirmed true by the branch's own commit record are checked; items that are pre-merge/pre-deploy
actions, or that this pass could not independently confirm, are left unchecked.

## What ships

A five-epic release — four scoped at spec time (E1–E4) plus one added mid-release on ToR's
instruction (E5) — **8 commits, linear** (`git log --merges 95bb8c5..7389b06` is empty, no merge
commits). **Base** `95bb8c5` (`95bb8c58ef0aebdca87408588e89725da42eeda2`, the v1.0.5 merge commit
on `main`) → **HEAD** `7389b06` (`7389b06d1f70614add7ad84e31ffd48330b1279a`), confirmed current via
`git rev-parse HEAD`.

| Seq | Stage | Epic | What | Commit | Spec § | New tests | Suite after |
|---|---|---|---|---|---|---|---|
| 1 | spec | — | `docs/SPEC_v1.0.6.md` created; scopes E1–E4 | `9f40989` | — | — | 177 (unchanged) |
| 2 | spec | — | Prototype artifact URL pinned (1-line) | `a6e0061` | — | — | 177 (unchanged) |
| 3 | code | **E1** | Live date-readout tip while dragging/resizing a bar | `f4600cc` | §2 | 6 | 183 |
| 4 | spec | E5 added | ToR's mid-release ask folded into spec + §6 remark-roster fix | `d1bf9e8` | §5.4 | — | 183 (unchanged) |
| 5 | code | **E5** | Grip-menu Sub-Module creation, preset parent | `b429855` | §5.4 | 8 | 191 |
| 6 | code | **E2** | 5-step undo/redo | `6b8beb4` | §3 | 10 | 201 |
| 7 | code | **E3** | Structured Excel/Numbers/Sheets round-trip | `43c26ba` | §4 | 11 | 212 |
| 8 | code | **E4** | Live Cloudflare sync, client-side (worker frozen) | `7389b06` | §5 | 11 | 223 |

Build order is **not epic-numeric** — E5 (ToR's mid-release ask) landed between E1 and E2. v1.0.5
shipped at 177 tests (`MERGE_RECORD_v1.0.5.md`); this branch nets **+46**.

Diff is limited to `app.js`, `docs/SPEC_v1.0.6.md`, `styles.css`, and 6 `tests/**` files —
**10 files, +2160/−68 lines** (`git diff --stat 95bb8c5..7389b06`). **Protected files show zero
diff** — `worker.js`, `schema.sql`, `wrangler.toml`, `index.html`, `cloudflare/`, `preview/`,
`CNAME` are absent from `git diff --name-only 95bb8c5..7389b06`, the same pattern
`MERGE_RECORD_v1.0.5.md` verified for the prior release.

**Release invariant, verified:** `docVer` stays 2, no new doc keys — see "Zero doc-schema change"
below. Cross-checked per commit via `git show --stat`/`--numstat`, `git log -1 --format=%B <sha>`
for full commit bodies, and `git show <sha> -- app.js` diffs against specific claims (R-tags,
function names) — not commit-message prose alone.

## Per-stage commits + audit findings/fixes

### 1/8 — `9f40989` (spec) — 2026-07-20 14:58:39 +0700

**What shipped:** Creates `docs/SPEC_v1.0.6.md` from nothing. Scopes E1 (live date readout while
dragging/resizing a bar), E2 (5-step undo/redo), E3 (structured Excel/Numbers/Google-Sheets
round-trip), E4 (live Cloudflare sync, client-side, worker frozen) from ToR's tuning doc. States
the release invariant (no doc-schema change, `docVer` stays 2), the hard safety rules, and
per-stage binding R-remarks for E1–E4.

**Files:** `docs/SPEC_v1.0.6.md` (+151/−0, new file). **Audit:** none — spec-only, no code.

### 2/8 — `a6e0061` (spec) — 2026-07-20 15:31:10 +0700

**What shipped:** One-line amendment — pins the published r1 prototype artifact URL in place of
the placeholder, keeping the local vault copy path as a parenthetical.

**Files:** `docs/SPEC_v1.0.6.md` (+1/−1). **Audit:** none.

### 3/8 — `f4600cc` (E1) — 2026-07-20 19:32:53 +0700

**What shipped:** Live date-readout tip while a Gantt bar is dragged or edge-resized, on the
shared `floatTip` singleton with a new `.dragDates` accent class (R-E1b): move mode shows both
dates + inclusive duration; edge-resize shows a bold moving-edge date over a dimmer context line,
via `fmtThai`/BE-aware formatting. New `showDragTip(html,x,y)` sits beside the existing `showTip`.
Hover handlers `onBoardOver`/`onBoardMove` gained `if(drag) return;` guards (R-E1a). Tests:
`dragtip-v106.spec.js` (6 tests). Commit reports "Full suite 183 green."

**Files:** `app.js` (+14/−5), `styles.css` (+6/−0), `tests/dragtip-v106.spec.js` (+193/−0, new) —
3 files, +213/−5.

**Audit — 1 confirmed MAJOR (commit-labeled):** a genuine `pointercancel` never ran `onBarUp`, so
`drag` stayed latched forever and the new hover guards would have killed all tooltips permanently
— a **latent v1.0.5 bug**, not introduced by this branch. Fix: the capture-phase cancel now fully
tears the drag down and **snaps back** (`drag._s=null`) instead of committing the cancelled
position on the next `pointerup`. Verified in the diff: `wireDragGuard`'s `pointercancel` listener
changed from bare `endDrag` to `()=>{ endDrag(); if(drag) drag._s=null; onBarUp(); }`; `onBarMove`
gained a self-heal guard `if(!_dragging){ drag._s=null; onBarUp(); return; }` (both tagged R-E1d).
**Negative verification:** the R-E1d regression test (`dragtip-v106.spec.js:142-179`) was run
against the pre-fix code and confirmed to actually fail there before being counted as a valid
guard — asserts drag-state nulled, `.dragging` class shed, `userSelect` restored, and a
synthesized `pointercancel` snaps the bar back (dates unchanged) rather than committing.

### 4/8 — `d1bf9e8` (spec) — 2026-07-20 19:33:41 +0700

**What shipped:** Spec amendment adding **E5 mid-release** — "Add option: On Module Menu bar: To
add Sub-Module. Use same menu (Create Module), with pre-define parent modules" — sourced from
ToR's v1.0.3.1 tuning docx. Adds the E5 row to the scope table, adds §5.4 ("E5 — grip-menu
Sub-Module creation") with R-E5a/b/c, marks E1 `DONE f4600cc`. Does **not** yet update §6's
binding-remarks roster to list R-E5a–c (that one-line fix lands in the next code commit,
`b429855`).

**Files:** `docs/SPEC_v1.0.6.md` (+29/−5). **Audit:** none.

### 5/8 — `b429855` (E5) — 2026-07-20 20:29:16 +0700

**What shipped:** Implements E5. New `IC.addsub` icon; a "เพิ่มโมดูลย่อยในโมดูลนี้" grip-menu
button (`gmBtn("addsub",...)`) placed directly after the existing ＋ add-feature button, container
pills only, wired via a new `onGridAction` case `addsub` calling `moduleModal(cid)`.
`moduleModal()` gains an optional `presetParentId`: an existing-container id defaults `kind` to
`"sub"` and starts the parent `<select>` on that container (R-E5a/b); a stale/non-container id
falls back to today's default state; the no-arg call path (topbar Module button) is byte-identical.
Save path reused untouched (`findNode`/`revealInto`, reveal+flash). Also carries the one-line spec
fix noted above: `docs/SPEC_v1.0.6.md` §6 updated to add `R-E5a–c` to the binding roster. Tests:
`submodmenu-v106.spec.js` (8 tests). "Full suite 191 green."

**Files:** `app.js` (+8/−3), `docs/SPEC_v1.0.6.md` (+1/−1), `styles.css` (+2/−1),
`tests/submodmenu-v106.spec.js` (+236/−0, new) — 4 files, +247/−5.

**Audit:** 4 lenses zero findings; the data-safety lens was re-run by the architect after a
network-outage timeout interrupted the first run (clean on rerun, not accepted-as-is). **1
confirmed MINOR:** a vacuous reveal assertion made discriminating — verified in
`tests/submodmenu-v106.spec.js:115-120,141`: the test explicitly collapses the parent module
before save, with an inline comment explaining that asserting `collapsed===false` afterward
without first forcing it `true` would be vacuously true and let a dropped `revealInto()` call slip
through undetected (mirrors the v1.0.4 tree-ui R6 pattern).

### 6/8 — `6b8beb4` (E2) — 2026-07-20 22:08:06 +0700

**What shipped:** 5-step undo/redo as whole-doc JSON snapshots riding `Store.save()`'s existing
serialization — `UNDO_CAP=5`, session-only `undoStack`/`redoStack`/`_histBase`. New `IC.undo`/
`IC.redo` icons + an `undoGroupHtml()` toolgroup on the dashboard bar and project topbar via
`wireUndoButtons()`/`updateUndoUI()`. `⌘Z`/`Ctrl+Z` (undo) and `⇧⌘Z`/`Ctrl+Y` (redo) bound at
`document` level, suppressed inside `editingNow()`. `restoreSnapshot()` deliberately bypasses
`Store.save()` (no restamp, no re-capture) and pushes the restored doc to cloud (LWW propagation
intended); `rerenderAfterRestore()` preserves view context (R-E2b). Tests: `undo-v106.spec.js`
(10 tests). "Full suite 201 green (one FIX3 load-flake ruled out by isolated x2 + full re-run)" —
see Verification below for the full incident writeup.

**Files:** `app.js` (+79/−5), `styles.css` (+3/−0), `tests/undo-v106.spec.js` (+254/−0, new) —
3 files, +336/−5.

**Audit — "3 confirmed, all 3/3 judge votes."** None individually labeled major/minor in the
commit message itself; severities below are my own classification, **inferred, not sourced**:
1. `histKey()` — an `updatedAt`-stripped dirty-check for the undo-capture guard: the v1.0.5 stamp
   restamped every save, so benign tab-switch autosaves would have eaten undo slots; also rebases
   `_histBase` after the first render's lazy doc-completion. *Inferred: moderate/major — breaks
   the spec §3 no-op guarantee, would make undo unreliable in ordinary use.*
2. `Store.load` now clears both stacks on cross-tab storage adoption: an undo could otherwise
   LWW-clobber a sibling tab's write; mirrors `adoptRemote`'s R-E2a reset. *Inferred: major — a
   cross-tab data-clobber path.*
3. Dashboard delete-confirm copy no longer claims irreversibility (now "...(เลิกทำได้ 1 ขั้น)"
   instead of asserting the delete can't be undone). *Inferred: minor — copy/UX-truth fix only,
   verified in diff.*

### 7/8 — `43c26ba` (E3) — 2026-07-21 09:41:24 +0700

**What shipped:** Replaces the lossy flat spreadsheet export/import with a structured, full-tree
round-trip. Export writes one row per node (container or feature, any depth) to sheet `Timeline`
(`Type`, `Level`, `Node ID`, `Feature ID`, `Name`, `Description`, `Start`, `End`, `Status`,
`Remark`, `Color`, plus custom columns) and a read-only `Info` sheet. Import auto-detects
structured-vs-legacy by header, parses **before** any mutation into a preview object (counts,
custom-column summary, row-numbered warnings), and commits only on explicit confirm through ONE
`Store.save()` = one undo step; a lossless re-import is a content no-op that spends no undo slot.
R-E3a level-jump/orphan tolerances; R-E3b Node-ID-keyed carry-over of `kpi`/`hideProgress`/
`collapsed`; the legacy flat path is kept, gains `' › '`-path nesting (R-E3d) and the same preview
modal. `xlsx@0.18.5` pinned as a **tests-only** dependency. Tests: `roundtrip-v106.spec.js`
(11 tests). "Full suite 212 green."

**Files:** `app.js` (+201/−36), `styles.css` (+21/−0), `tests/package-lock.json` (+114/−1),
`tests/package.json` (+2/−1), `tests/roundtrip-v106.spec.js` (+427/−0, new) — 5 files, +765/−38.

**Audit:** commit message states "8 confirmed" but only 5 are named in prose; the remaining 3 are
**not enumerated** in the message (not invented here). None of the 5 carry an explicit
major/minor label — severities below are **inferred**:
1. Feature Level honored on import (features after a sibling sub-container no longer silently
   re-nest — was breaking lossless round-trip). *Inferred: major — directly broke the feature's
   core lossless-round-trip promise; caught because the suite's core invariant (export→reimport
   must deep-equal, test (a)) is itself a regression check.*
2. Reserved-alias-colliding custom columns fall through instead of dropping. *Inferred:
   moderate/major — prevented silent loss of custom-column data on import.*
3. Timeline sheet found by name/scan (reordered tabs import). *Inferred: minor — import
   robustness against sheet-tab reordering.*
4. Sparse custom maps stay sparse (idempotent re-import). *Inferred: minor — data-shape hygiene
   on re-import.*
5. New-column path tested. *Inferred: minor — reads as added coverage, not a behavior change.*

Separately (**explicitly not** an audit fix): architect addition — existing custom columns absent
from the imported file are **named in the preview** before being dropped (spec §4.3) + test (k).

### 8/8 — `7389b06` (E4, HEAD) — 2026-07-21 10:54:52 +0700

**What shipped:** Live Cloudflare sync, client-side only (worker frozen, no server changes).
Push: `schedulePush` debounce cut 800ms→250ms; serialized single-flight PUTs with a generation
counter so an edit queued mid-flight re-pushes the coalesced doc instead of being dropped;
keepalive flush-on-exit on both `pagehide` and `visibilitychange→hidden`, collapsed to exactly one
PUT via a one-shot `_flushed` latch (`flushOnExit()`); bodies >60000 bytes fall back to a normal
fetch. Pull: visibility-aware polling — 5s while visible (`POLL_MS_VISIBLE`), none while hidden,
immediate pull on becoming visible again; existing focus-pull kept. New `#syncChip` status pill on
both dashboard and project topbar (กำลังซิงก์.../ซิงก์แล้ว HH:mm/ออฟไลน์...), direct-DOM-patched,
hidden when cloud sync is off, kept honest under R-E4c. Background-poll adoptions toast once via a
new `announce` param on `adoptRemote(doc, rev, announce)` (R-E4b). Tests: `livesync-v106.spec.js`
(11 tests, mock-only, zero real requests, run ×3 green). "Full suite 223 green."

**Files:** `app.js` (+77/−19), `styles.css` (+14/−0), `tests/livesync-v106.spec.js` (+337/−0,
new) — 3 files, +428/−19.

**Audit — 1 of 5 items commit-labeled MAJOR; other 4 unlabeled (severity inferred where noted):**
1. "chip false-green during push backoff **(major)**" — commit-labeled. Verified in diff:
   `setSyncState` gained `if(state==='synced' && (pushPending || pushFails>0)) ...` so a good poll
   GET during PUT backoff can no longer flip the chip green while the edit is still unpushed.
2. "push serialization + generation (lost-edit race)" — unlabeled. *Inferred: major — the
   parenthetical itself names it a "lost-edit race," a data-loss-class defect.*
3. "duplicate exit flushes" — unlabeled. *Inferred: minor/moderate — redundant PUTs on tab close
   (`pagehide` + `visibilitychange` both firing), not itself data-loss (same doc sent twice);
   fixed via the `_flushed` one-shot latch.*
4. "deferred-newer poll no longer stamps synced" — unlabeled. *Inferred: minor/moderate —
   chip-honesty fix in the same family as item 1, not itself tagged major.*
5. "livesync test fixture now fails closed (auto abort + opt-in fulfilling mock)" — unlabeled;
   test-infrastructure hardening, not a shipped product defect. *Inferred: minor from a
   product-risk standpoint. Implies a less-safe fixture predated the audit.*

## Binding R-remarks (spec §6)

Spec §6, verbatim: "All R-tags above (R-E1a–d, R-E2a–c, R-E3a–d, R-E4a–c, R-E5a–c) are binding,
same contract as v1.0.4's R1–R12 / v1.0.5's N1–N11: the audit lenses check the diff against them
explicitly." **17 tags total** (4+3+4+3+3), confirmed complete by grep, none orphaned. This exact
§6 line was itself edited by `b429855` to add `R-E5a–c`; `d1bf9e8` had added the R-E5 remarks in
§5.4 without yet registering them in §6.

- **E1** (§2, `f4600cc`): R-E1a hover handlers early-return while a drag is live · R-E1b drag tip
  uses `.floatTip.dragDates`, same singleton · R-E1c no new `window` listeners, renders inside the
  existing `onBarMove` frame · R-E1d pointercancel path must end with a hidden tip (tested §5.1).
- **E2** (§3, `6b8beb4`): R-E2a `adoptRemote()` clears both undo/redo stacks + rebases
  `_histBase` on any externally-sourced doc · R-E2b restore re-render preserves view context ·
  R-E2c `ui.*` never enters history, `P.leftW` does (same rationale as v1.0.5 F1).
- **E3** (§4, `43c26ba`): R-E3a level-jump clamp + orphan-feature recovery container · R-E3b
  Node-ID-keyed carry-over of `kpi`/`hideProgress`/`collapsed` · R-E3c zero-features-and-zero-
  containers parse never opens the preview modal · R-E3d legacy flat-import path also gets the
  preview modal.
- **E4** (§5, `7389b06`): R-E4a flush-on-exit on `pagehide`/`visibilitychange→hidden`, keepalive,
  60000-byte fallback · R-E4b background-poll adoption toasts once, never on initial seed or
  manual restore · R-E4c sync chip never implies safety it doesn't have (stays "กำลังซิงก์…"
  while `pushPending`).
- **E5** (§5.4, `b429855`): R-E5a grip-menu button on container rows only, after the ＋
  add-feature button · R-E5b parent dropdown still lists all containers, preset only selects one
  · R-E5c grip pill rail width still slides correctly (G2 contract carried over from v1.0.4).

## Zero doc-schema change — verified

**Claim** (`docs/SPEC_v1.0.6.md:26`): "Release invariant: NO change to the stored doc shape.
`docVer` stays 2; no new doc keys."

- Every `docVer` occurrence in `app.js` at HEAD sets/reads the value `2` — new-project seed
  (`app.js:667`), migration stamp (`app.js:1071,1104-1105,1121,1188`), legacy-import tree rebuild
  (`app.js:2425`). No `docVer:3` or bump anywhere.
- `git diff 95bb8c5..7389b06 -- app.js`: the only two `docVer`-touching diff lines are a
  same-value refactor inside E3's structured-import rebuild (`P.docVer=2; P.progressOrder=...`
  moved to `P.modules=roots; P.docVer=2;`) — value unchanged, just relocated.
- No new top-level `DB.<key>=` assignments (checked via `git diff ... -- app.js | grep
  '^+.*DB\.'`) — only pre-existing `DB.updatedAt`, `DB.notes` (v1.0.5), `DB.projects` are touched.
- Why each edit is schema-inert: E1 is pure UI (floating tip, nothing persisted). E2's undo/redo
  lives in module-level JS vars (`undoStack`, `redoStack`, `_histBase`, `app.js:188`) — session
  memory only, never serialized into `DB`. E3 changes the external `.xlsx` layout, not the in-app
  doc; import still ends in `P.docVer=2; normalizeTree(P)`. E4 is client push/pull timing only —
  `worker.js` untouched. E5 reuses the existing `moduleModal()` save path unmodified except for a
  `presetParentId` argument.

Given this holds, an old v1.0.5 tab's whole-doc push **cannot drop any v1.0.6-shaped field**,
because v1.0.6 adds no new field. This differs from the v1.0.4→v1.0.5 transition, where an old tab
lacked `DB.notes` entirely and would delete it on push.

## Deploy-time action — CLOSE OLD TABS (still applies, lower stakes this release)

Given the zero-schema-change finding above, this step is lower-stakes than it was for v1.0.5 (an
old tab there could delete `DB.notes` outright on push). But it is listed in the vault README
under **"Rules that never change"** — a standing rule, not a per-release judgment call — and
ordinary content-overwrite LWW risk (next section) is untouched by this branch. Nothing in the
repo supports skipping it this time either.

- [ ] After the front-end deploys, close every open **v1.0.5** tab before anyone edits in the new
      build.
- [ ] Warn active users directly (Slack/DM) if any v1.0.5 tabs are known to be open.

## LWW window — what an open v1.0.5 tab can/cannot break now

**Server mechanism** (`worker.js:79-86`, unchanged/frozen this branch): `PUT /api/state`
unconditionally overwrites `app_state` and increments `rev` by 1 — no compare-and-swap against a
client-supplied rev. "LWW by rev" is entirely a **client-side adoption gate** on GET results:
`j.rev > lsRev() && !pushPending && !editingNow()` (`app.js:370`) — identical condition already
present at base `95bb8c5:271`.

**Cannot break (new-shape data):** because "Zero doc-schema change" holds, an old v1.0.5 tab's
push cannot drop any v1.0.6-shaped field — v1.0.6 adds none.

**Can still break (ordinary LWW, unchanged by this branch):** a v1.0.5 tab can still overwrite
newer *content* edits from elsewhere if its push lands after theirs — `worker.js` has no causal
ordering, just last-PUT-wins. `worker.js` is not in the v1.0.6 diff, so this risk is exactly as it
was pre-branch.

**Concrete version-skew deltas, base `95bb8c5` vs HEAD `7389b06`:**
- Push debounce: 800ms (base `app.js:240`) → 250ms (`app.js:327`). A v1.0.5 tab is slower to push
  its edits.
- Poll: base polls unconditionally every 30s regardless of visibility (base `app.js:2610`). v1.0.6
  polls 5s while visible, **zero while hidden** (`app.js:278,393-394,399-401`).
- Flush-on-exit: base has no `pagehide`/`keepalive` handling at all. v1.0.6 adds `flushOnExit()`
  (R-E4a) so a v1.0.6 tab's last edit survives close/hide. **A still-open v1.0.5 tab keeps the
  older, more-loss-prone close behavior** — pre-existing property, not a regression introduced by
  this branch.
- Silent vs announced adoption: base `adoptRemote(doc,rev)` never toasts. v1.0.6 adds an
  `announce` param + R-E4b toast ("อัปเดตจากเครื่องอื่นแล้ว") on background/focus polls only. Net
  effect in a mixed-version fleet: a v1.0.6 tab announces when another device's write is adopted;
  a v1.0.5 tab swaps its in-memory doc silently. UX inconsistency, not data loss.
- Undo's cloud-propagation edge (new in v1.0.6, no v1.0.5 analog): pressing Undo pushes the older
  doc back to the server as intended LWW behavior (`restoreSnapshot`, `app.js:235-239`, calls
  `schedulePush()`). A v1.0.5 tab can't originate this (no undo button) but can be a silent
  recipient, or can effectively "undo the undo" from the v1.0.6 user's perspective by pushing its
  own newer state shortly after — ordinary LWW, unannounced on the v1.0.5 side.

### New prod-write patterns & worker volume estimate

- **Push** — `schedulePush()`: debounce 800ms→250ms; single-flight serialization
  (`_pushInFlight` latch) so the shorter debounce can't fan out overlapping PUTs; `_pushGen`
  counter re-fires a trailing push instead of dropping a mid-flight edit.
- **Pull** — `POLL_MS_VISIBLE=5000`: visible tab polls `GET /api/state` every 5s; hidden tab polls
  zero; immediate catch-up pull on becoming visible again; existing focus-pull kept.
- **Flush-on-exit** — `flushOnExit()` fires `cloudPush({keepalive:true})` immediately if
  `pushPending`, wired to both `pagehide` and `visibilitychange→hidden`; a one-shot `_flushed`
  latch prevents a real tab close (which fires both events back-to-back) from double-firing.
  Keepalive only sets `init.keepalive=true` when body ≤60000 bytes (the browser's ~64KB keepalive
  cap); above that, best-effort normal fetch fallback.
- **Doc size / volume estimate**, traced to two independent sources that agree: SPEC_v1.0.6.md:112
  ("prod doc ≈ 59 KB, rev 2027") and the architect's own figure at SPEC_v1.0.6.md:120 ("Net cost ≈
  12 × 59KB/min per visible tab — fine for Workers/D1," 12 = 60s ÷ 5s poll) → **≈708 KB/min pull
  bandwidth per visible tab**, scaling with concurrently-*visible* tab count; hidden tabs
  contribute zero. Independently cross-referenced in an `app.js:395` code comment re: the same
  ~59KB figure motivating the exit-flush duplicate-PUT guard.
- Push volume is event-driven, not periodic, and further capped by the single-flight latch — no
  numeric req/s ceiling is stated anywhere reviewed, so none is asserted here.
- **Worker/API surface itself: frozen, confirmed.** `worker.js` is absent from `git diff
  --name-only 95bb8c5..7389b06`; SPEC_v1.0.6.md:110/112 states no rev-only endpoint, no
  WebSocket/SSE — live sync is client-side polling only.

## Safety architecture (test harness)

- **`tests/fixtures.js` `_guard` auto-fixture** (whole suite except `livesync-v106.spec.js`):
  hard-aborts every request to `https://adeptio-gantt.pathom-bot.workers.dev/**` before any page
  script runs; cdnjs/fonts.googleapis/fonts.gstatic neutralized to empty 200s (hermeticity, not
  safety); tracks `prod.attempts`/`reached`/`failed`; teardown asserts `prod.reached` `toEqual([])`
  on every test, plus zero `pageerror`s and zero unexpected console errors.
- **`tests/livesync-v106.spec.js`'s own two-fixture pair** (E4 must simulate a working sync, can't
  blanket-abort): `_safety` (auto, registers the same abort fallback first, owns its own teardown
  — "a test that FORGETS to destructure `mock` fails CLOSED") + `mock` (opt-in, depends on
  `_safety` so its fulfilling route registers *after* the abort and wins only when a test asks for
  it; every mocked response carries `x-mock: 1`; any PROD response lacking that header fails the
  test as `reachedReal`). This fixture design was itself an audit fix landed in `7389b06`
  ("fails closed (auto abort + opt-in fulfilling mock)") — implying a less-safe version predated
  the audit.
- **`xlsx@0.18.5` pinned test-only dep**, added in `43c26ba` — exact pin (no caret, unlike
  `@playwright/test`'s `^1.61.0`), `devDependencies` only, no production `app.js` surface; commit
  message: "buffers built in-page (zero network)" — workbook read/write happens on in-memory
  buffers inside the page context, no filesystem or network I/O.

## Pre-merge manual D1 snapshot (do not skip)

- [ ] **Take a manual snapshot before merge** — dashboard → *Backup / Restore* → *Back up now*
      (`POST /api/backups?period=manual`), so there is a labelled pre-v1.0.6 restore point that
      the rolling window cannot age out during rollout.

## D1 backup expectation

- The Worker keeps **30 rolling snapshots** per workspace (`KEEP_SNAPSHOTS = 30`, `worker.js`,
  unchanged this release — `worker.js` is outside the v1.0.6 diff) plus daily/weekly cron copies
  to the configured cloud drive. No new backup plumbing was needed: this branch adds no new
  top-level doc key (see "Zero doc-schema change" above).

## Verification — what was actually run

### Suite growth per stage

| Stage | Commit | New tests (file) | Suite total | Audit outcome |
|---|---|---|---|---|
| base (v1.0.5 tip) | `ba2d69d` | — | 177 | — |
| E1 | `f4600cc` | 6 (`dragtip-v106.spec.js`) | 183 | 1 confirmed major |
| E5 | `b429855` | 8 (`submodmenu-v106.spec.js`) | 191 | 4 lenses clean; 1 confirmed minor |
| E2 | `6b8beb4` | 10 (`undo-v106.spec.js`) | 201 | 3 confirmed, 3/3 judge votes |
| E3 | `43c26ba` | 11 (`roundtrip-v106.spec.js`) | 212 | 8 confirmed (5 named) + 1 architect addition |
| E4 | `7389b06` (HEAD) | 11 (`livesync-v106.spec.js`, mock-only, ×3 green) | 223 | 5 confirmed, 1 commit-labeled major |

Sum check: 177 + 6+8+10+11+11 = **223**, matches HEAD.

- [x] **Each of the 5 code-stage commit messages ends "Full suite N green"** — a full-suite rerun
      after every fix, confirmed by reading each commit's own body (`git log -1 --format=%B
      <sha>`), not the running total alone.
- [x] **Independent recount from actual test source** (not commit-message trust): a raw grep of
      `^\s*test\(` across every `tests/*.spec.js` file at HEAD gives 213 — ten short of 223. The
      gap is fully explained by `tests/timeline.spec.js` (pre-v1.0.6, part of the 177 base): two
      loop-parameterized `test(` declarations using template-literal names (`` test(`ppd=${ppd}
      wrap=${wrap}`) `` at line 251, `[8,11,20]×[false,true]` = 6 runtime tests from 1 source
      line; an identically-shaped one at line 284, `[4.4,11,34]×[false,true]` = 6 more).
      213 + (6−1) + (6−1) = **223 exactly**. A repo-wide grep for `` test(` `` confirms these are
      the only two loop-generated declarations in the whole suite — so the 5 new v1.0.6 files are
      confirmed flat/non-parameterized (their counts above are exact), and 177/223 are
      corroborated a fourth, independent way.
- [x] **Protected files zero-diff**, confirmed via `git diff --name-only 95bb8c5..7389b06`.
- [x] **Zero doc-schema change**, confirmed independently (see dedicated section above).
- [x] **×3-consecutive full-suite certification at HEAD `7389b06` — DONE** (Fable, 2026-07-21,
      after the doc pass flagged it): 223 green ×3 consecutive on a quiet machine — run 1 at the
      E4 commit gate (5.6m), runs 2–3 back-to-back afterward (7.5m, 5.9m). Zero failures, zero
      flakes across all three. Matches the v1.0.5 house practice.
- [x] **Isolation check: run before EVERY push on this branch** (Fable, first-hand — the doc pass
      couldn't see this because the check leaves no repo artifact): `python3 isolation_check.py .`
      from the vault root printed `CLEAN` before each of the 6 pushes (`9f40989`+`a6e0061`,
      `f4600cc`, `d1bf9e8`, `b429855`, `6b8beb4`, `43c26ba`, `7389b06`) and again before the docs
      push. It will be run once more at merge time per the standing rule.

### FIX3 load-flake incident (during E2 verification)

`FIX3` is a pre-existing, unrelated regression test — `tests/fixes.spec.js:77`, "a live drag sets
the interaction guard so a storage adopt is deferred." Its own comment (lines 84-88) documents a
previously-hunted (2026-07-18) load-timing flake: late toolbar reflow shifting a grip's bounding
box between measurement and press. It flaked again during `6b8beb4` (E2) verification. Rather than
assume a new regression, the fix worker **reran it in isolation ×2, then ran the full suite
again** — all passed clean. Commit message: "one FIX3 load-flake ruled out by isolated x2 + full
re-run." No code change was made to FIX3 or its guard as a result — the flake was the known
pre-existing timing issue recurring, not a v1.0.6 regression.

### Overnight verification gap (E2→E3, 11h33m) — settled by Fable, who ran the sessions

The Sonnet documentation pass correctly flagged this gap as only partially corroborated by the
repo. Fable (who ran the E3 build) settles it first-hand: the E3 stage workflow was interrupted
**three times**, none code-related — (1) a Claude Code process restart killed the first run
mid-implement (~22:40, partial tree left parseable, resumed from cached agent results);
(2)+(3) the resumed run's **fix worker stalled twice overnight** ("no progress for 180s × 6
attempts" each) because the Mac was asleep on battery — `pmset -g log` showed continuous
Maintenance Sleep cycles from ~05:13, with the worker transcript resuming healthy reads at each
brief DarkWake. No agent misbehaved; on the morning resume (machine awake) the fix worker
completed in ~18 minutes and E3 landed as `43c26ba`. Operator note for future long pipelines:
keep the machine plugged in/awake.

### Negative verifications performed by fix workers (per commit)

- `f4600cc` (E1): the R-E1d cancel-teardown test was run against the pre-fix code and confirmed
  to actually fail there before being counted as a valid regression guard
  (`dragtip-v106.spec.js:142-179`).
- `b429855` (E5): (a) the data-safety lens was interrupted by a network-outage timeout — the
  architect reran it rather than accepting the interrupted run, zero findings on rerun; (b) the
  vacuous reveal assertion was made discriminating — parent explicitly collapsed before save in
  `submodmenu-v106.spec.js:115-120,141` (v1.0.4 tree-ui R6 pattern).
- `6b8beb4` (E2): FIX3 flake (above), plus "3 confirmed, all 3/3 judge votes" — no split
  decisions.
- `43c26ba` (E3): the most consequential fix (feature Level honored on import) was caught
  specifically because the suite's core invariant — export→reimport must deep-equal (test a) — is
  itself a negative/regression check; architect-added test (k) verifies an existing-but-
  file-absent custom column is *named* in the preview before being dropped, rather than silently
  disappearing.
- `7389b06` (E4): 4 of its 5 confirmed fixes map to explicit "must NOT happen" tests in
  `livesync-v106.spec.js` — chip-must-not-flip-synced (×2 findings), lost-edit-must-be-re-pushed-
  never-dropped, exactly-one-keepalive-PUT-on-close. "Zero real requests" is enforced
  mechanically by the `_safety`/`mock` `x-mock` header check, not just asserted in prose.

### What this documentation pass did NOT do

Read-only `git log`/`git diff`/`git show`/`git status` only — no `git add`/`commit`/`push`; no
edits to `worker.js`/`schema.sql`/`wrangler.toml`/`index.html`/`cloudflare/`/`preview/`/`CNAME`;
no network contact with the Worker host; **the test suite was not executed while preparing this
record** — every suite-count and audit-outcome claim above is drawn from commit messages,
`docs/SPEC_v1.0.6.md`, `MERGE_RECORD_v1.0.5.md`, and a direct read of test source files, not from
re-running anything.

**Sources reviewed:** `tests/fixtures.js`, `tests/dragtip-v106.spec.js`,
`tests/submodmenu-v106.spec.js`, `tests/undo-v106.spec.js`, `tests/roundtrip-v106.spec.js`,
`tests/livesync-v106.spec.js`, `tests/fixes.spec.js`, `tests/timeline.spec.js`,
`tests/package.json`, `docs/SPEC_v1.0.6.md`, `docs/MERGE_RECORD_v1.0.5.md`, `CHANGELOG.md` (no
v1.0.6 section exists yet), and `git log --format=... 95bb8c5..7389b06` (full commit bodies for
all 8 commits). **Not used:** `tests/results.json` — inspected but excluded; its `stats` block
reflects a single-file, non-representative local run (only `submodmenu-v106.spec.js` in its
`suites`), not a full-suite result, so it would not honestly corroborate the 223 figure.

## Operator ritual — when this version ships

**Source:** `Dynamic Gantt Chart/README.md` (the vault folder-level README, one level above this
git repo — distinct from `adeptio_gantt/README.md`, the Worker/API setup doc).

**5 steps, verbatim order:**
1. Manual D1 snapshot + `prod_state_snapshot_<date>.json` into `Codes Backup/vX.Y.Z/`.
2. `git archive` zip of the merged main + extracted **viewable** copy (patched: `API_BASE=""`,
   renamed localStorage keys, seed.js from the snapshot, backup badge).
3. Copy `MERGE_RECORD` + `CHANGELOG` into the version folder.
4. Rename `vX.Y.Z - Dev/` to the next version and branch from main.
5. Close all old browser tabs before editing in the new build (LWW window).

**Rules that never change** (same file): whole-doc-push-is-LWW warning; protected-files list —
`worker.js, schema.sql, wrangler.toml, index.html, cloudflare/, preview/, CNAME` (identical set to
CLAUDE.md and SPEC_v1.0.6.md's hard safety rules); `python3 isolation_check.py .` from the vault
root must print `CLEAN` before any push; "Merge to main = deploy to timeblock.io. Only on explicit
'merge now'."

`isolation_check.py` genuinely exists at the true vault root, `/Users/pathom/Documents/AI
Workshop/Adeptio - Obsidian Vault/isolation_check.py` — **one level above `ADEPTIO/`** (i.e.
`ADEPTIO/` is not itself the vault root; the check must be run from its parent). This has not been
run for this branch as part of preparing this record (see Verification above).

## Backlog / open items for Fable before merge

- **No separate whole-branch final-audit commit — weighed and dispositioned by Fable:** v1.0.6
  intentionally audits per stage (5 lenses + 3-vote judge panels + fix worker per commit, ≈30–46
  agents each) rather than one final pass; total adversarial coverage far exceeds v1.0.5's single
  end pass, and every diff was additionally architect-read before commit. Cross-stage interaction
  risk (undo×import, undo×sync, sync×history) is covered concretely: `undo-v106.spec.js` was
  re-run green at both the E3 and E4 gates, and each stage ended with a full-suite run. No
  additional whole-range audit pass will be run; the ×3-consecutive suite at HEAD (below) is the
  final certification gate.
- ~~No ×3-consecutive full-suite certification recorded at HEAD~~ **Resolved:** 223 green ×3
  consecutive at `7389b06` (see Verification above).
- **Isolation check not confirmed for this branch** in the material reviewed — must run and print
  `CLEAN` before any push (standing rule, CLAUDE.md + vault README).
- ~~`CHANGELOG.md` has no v1.0.6 section yet~~ **Resolved:** the CHANGELOG v1.0.6 section was
  written by the parallel documentation worker in the same pass as this record (the two writers
  ran concurrently — this file's author read `CHANGELOG.md` before its sibling finished, hence
  the stale observation). Both docs land in the same commit; Fable verified the CHANGELOG against
  the git history.
- **This file did not exist before this pass** — `docs/MERGE_RECORD_v1.0.6.md` is new.
- **Overnight verification gap** — one large timestamp gap is corroborated (E2→E3, 11h33m); a
  second stall was asked for in this record's brief but was not found in the material reviewed
  (see Verification above) and should be confirmed separately before being treated as fact.
- **Pre-merge checklist items above are unchecked** because the merge has not happened — see
  "Pre-merge manual D1 snapshot" and "Deploy-time action" above, plus "Merge steps" below.

## Merge steps (Fable, on your go)

1. Confirm all checked/unchecked boxes above reflect reality at merge time — in particular, run
   the ×3-consecutive full suite and the isolation check first; neither is confirmed done yet.
2. Merge `v1.0.6` → `main`; GitHub Pages deploys the front-end to `timeblock.io` immediately on
   merge — there is no separate deploy step to trigger.
3. Post-deploy: close old v1.0.5 tabs (lower-stakes than v1.0.5's own deploy, but still the
   standing rule — see "LWW window" above), smoke-test the drag-date tip (E1), undo/redo (E2),
   spreadsheet round-trip (E3), live sync chip (E4), and grip-menu Sub-Module creation (E5) on two
   devices.
