# Adeptio Project Tracking — Cloud backend (Cloudflare Worker + D1)

This adds **shared, cross-device storage** and **automated backups** to the app.
The browser keeps working offline on `localStorage`; when `API_BASE` is set it also
syncs to a Cloudflare Worker backed by a D1 database, and a daily/weekly cron pushes
a copy to your cloud drive (Google Drive / Dropbox / OneDrive).

```
app (browser)  ──PUT/GET /api/state──►  Worker  ──►  D1 (app_state + backups)
      │                                   │
   localStorage (offline fallback)        └─cron(daily/weekly)─► Drive/Dropbox/OneDrive
```

## What's here
| File | Purpose |
|---|---|
| `worker.js` | The API + scheduled backup logic |
| `schema.sql` | D1 tables (`app_state`, `backups`) |
| `wrangler.toml` | Worker config: D1 binding + daily/weekly cron |

## 1. Deploy the Worker + D1
You need Node.js and a (free) Cloudflare account.

```bash
cd cloudflare
npm i -g wrangler            # or: npx wrangler ...
wrangler login

# create the database, then paste the printed database_id into wrangler.toml
wrangler d1 create adeptio-gantt

# create the tables
wrangler d1 execute adeptio-gantt --remote --file=./schema.sql

# protect the API with a shared token (recommended)
wrangler secret put API_TOKEN        # type any long random string

wrangler deploy
```
Wrangler prints your Worker URL, e.g. `https://adeptio-gantt.<subdomain>.workers.dev`.
Check it: visiting `…/api/health` should return `{"ok":true,…}`.

## 2. Connect the app
In `public/app.js`, near the top of the STORE section, set:
```js
const API_BASE  = "https://adeptio-gantt.<subdomain>.workers.dev";
const API_TOKEN = "the-same-token-you-set-above";
```
Re-deploy the front-end (e.g. re-copy `index.html`, `app.js`, `styles.css`, `assets/`
into the GitHub Pages repo `torukung/adeptio_gantt`). Done — open the app on two
devices and edits sync. If the Worker is unreachable, the app silently falls back to
`localStorage`.

> The **Backup / Restore** button (dashboard, top-right) works in both modes. Without
> a Worker it offers JSON file download/restore (save the file to any drive yourself).
> With a Worker it adds *Back up now*, server snapshot history, and *Restore latest
> from drive*.

## 3. (Optional) Automated backups to a cloud drive
The cron in `wrangler.toml` runs daily (18:00 UTC) and weekly (Sun 18:30 UTC). Each run
snapshots D1 **and** uploads `adeptio-gantt-latest.json` (+ a dated copy) to whichever
providers you've configured below. Any provider whose secrets are missing is skipped.
*Restore latest from drive* reads `adeptio-gantt-latest.json` back.

Set credentials with `wrangler secret put <NAME>` (never commit them):

### Dropbox — simplest (one secret)
```bash
wrangler secret put DROPBOX_TOKEN     # an access token from the Dropbox App Console
```
For long-lived auto-refresh instead, set `DROPBOX_REFRESH_TOKEN`,
`DROPBOX_CLIENT_ID`, `DROPBOX_CLIENT_SECRET`.

### Google Drive — needs an OAuth app + refresh token
Create an OAuth client (Desktop) in Google Cloud Console, enable the Drive API,
grant scope `drive.appdata`, and generate a refresh token (e.g. via the OAuth
Playground using your own client id/secret). Then:
```bash
wrangler secret put GDRIVE_REFRESH_TOKEN
wrangler secret put GDRIVE_CLIENT_ID
wrangler secret put GDRIVE_CLIENT_SECRET
```
Files are stored in the hidden, app-private **appDataFolder**.

### OneDrive — needs an Entra (Azure AD) app + refresh token
Register an app, add delegated `Files.ReadWrite` + `offline_access`, and obtain a
refresh token. Then:
```bash
wrangler secret put ONEDRIVE_REFRESH_TOKEN
wrangler secret put ONEDRIVE_CLIENT_ID
wrangler secret put ONEDRIVE_CLIENT_SECRET
```
Files are stored in the app folder (`approot`).

**Honest note:** Dropbox works with a single token. Google Drive and OneDrive require
you to register your own OAuth app and produce a refresh token — that's a provider
requirement (so the Worker can write to *your* drive securely), not something the code
can skip. Configure one provider or all three; the rest are skipped automatically.

## API reference
| Method & path | Does |
|---|---|
| `GET /api/state` | returns `{ rev, updatedAt, doc }` |
| `PUT /api/state` | body `{ doc }` → saves, returns `{ rev, updatedAt }` |
| `GET /api/backups` | list snapshots `[{ id, ts, period, size }]` |
| `POST /api/backups?period=manual` | snapshot now + upload to drives → `{ backup, remote }` |
| `GET /api/backups/latest` · `GET /api/backups/:id` | fetch a snapshot's doc |
| `POST /api/restore?id=latest|<id>` | restore a D1 snapshot into live state |
| `POST /api/restore-remote?provider=` | pull latest drive file into live state |
| `GET /api/remote/status` | which providers are configured |
| `GET /api/health` | liveness |

All `/api/*` calls accept `?ws=<workspace>` (default `default`) and require
`Authorization: Bearer <API_TOKEN>` when that secret is set. CORS is open (`*`) so the
static front-end on any origin can call it.

### Sync model
Last-write-wins, arbitrated by a server `rev` counter: the app pushes on save (debounced),
and pulls on load, on window focus, and every 30s — adopting the server copy when its
`rev` is newer and you're not mid-edit. Fine for a small team; it is not multi-user
operational-transform merging.
