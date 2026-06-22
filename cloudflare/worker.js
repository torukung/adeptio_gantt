/* ============================================================================
   Adeptio Project Tracking — Cloudflare Worker API (+ D1 + scheduled backups)

   Data model: the app keeps one JSON document ({ projects:[...] }). This Worker
   stores that document in D1 (table `app_state`, one row per workspace), keeps a
   rolling history of snapshots (table `backups`), and on a daily/weekly cron
   uploads the current state to whichever cloud drives are configured
   (Google Drive / Dropbox / OneDrive). Restore can come from a D1 snapshot or
   from the latest file on a remote drive.

   Endpoints (all under /api, CORS-enabled, optional Bearer auth via API_TOKEN):
     GET    /api/state            -> { rev, updatedAt, doc }
     PUT    /api/state            -> body { doc }  ->  { rev, updatedAt }
     GET    /api/backups          -> [{ id, ts, period, size }]
     POST   /api/backups?period=manual -> snapshot now (+ push to remotes) -> { backup, remote }
     GET    /api/backups/latest   -> { id, ts, period, doc }
     GET    /api/backups/:id      -> { id, ts, period, doc }
     POST   /api/restore?id=latest|<id>  -> restore app_state from a D1 snapshot -> { rev }
     POST   /api/restore-remote?provider=dropbox|gdrive|onedrive
                                  -> pull latest file from a drive into app_state -> { provider, rev }
     GET    /api/remote/status    -> { dropbox, gdrive, onedrive }   (configured?)
     GET    /api/health           -> { ok:true }

   Bind a D1 database as `DB`. See wrangler.toml + schema.sql + README.md.
   ========================================================================== */

const FILE_LATEST = "adeptio-gantt-latest.json";
const KEEP_SNAPSHOTS = 30;

/* ---------------- helpers ---------------- */
function cors(extra = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,PUT,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
    "access-control-max-age": "86400",
    ...extra,
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors() },
  });
}
function authed(request, env) {
  if (!env.API_TOKEN) return true; // open if no token configured
  const url = new URL(request.url);
  const hdr = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const tok = hdr || url.searchParams.get("token") || "";
  return tok === env.API_TOKEN;
}
const wsOf = (url) => url.searchParams.get("ws") || "default";
const datedName = () => `adeptio-gantt-${new Date().toISOString().slice(0, 10)}.json`;

async function ensureSchema(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS app_state (
       id TEXT PRIMARY KEY, doc TEXT NOT NULL,
       rev INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS backups (
       id TEXT PRIMARY KEY, ws TEXT NOT NULL, ts TEXT NOT NULL,
       period TEXT NOT NULL, doc TEXT NOT NULL )`
  ).run();
}

/* ---------------- state (D1) ---------------- */
async function getState(env, ws) {
  const row = await env.DB.prepare("SELECT doc, rev, updated_at FROM app_state WHERE id=?").bind(ws).first();
  if (!row) return { rev: 0, updatedAt: null, doc: null };
  let doc = null;
  try { doc = JSON.parse(row.doc); } catch (e) {}
  return { rev: row.rev, updatedAt: row.updated_at, doc };
}
async function putState(env, ws, doc) {
  const now = new Date().toISOString();
  const cur = await env.DB.prepare("SELECT rev FROM app_state WHERE id=?").bind(ws).first();
  const rev = (cur ? cur.rev : 0) + 1;
  await env.DB
    .prepare(`INSERT INTO app_state (id,doc,rev,updated_at) VALUES (?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET doc=excluded.doc, rev=excluded.rev, updated_at=excluded.updated_at`)
    .bind(ws, JSON.stringify(doc), rev, now)
    .run();
  return { rev, updatedAt: now };
}

/* ---------------- backups (D1 history) ---------------- */
async function snapshot(env, ws, period) {
  const st = await getState(env, ws);
  if (st.doc == null) return null;
  const now = new Date().toISOString();
  const id = `${ws}-${now.replace(/[^0-9]/g, "").slice(0, 14)}-${period}`;
  await env.DB.prepare("INSERT OR REPLACE INTO backups (id, ws, ts, period, doc) VALUES (?,?,?,?,?)")
    .bind(id, ws, now, period, JSON.stringify(st.doc)).run();
  await env.DB.prepare(
    `DELETE FROM backups WHERE ws=? AND id NOT IN
       (SELECT id FROM backups WHERE ws=? ORDER BY ts DESC LIMIT ?)`
  ).bind(ws, ws, KEEP_SNAPSHOTS).run();
  return { id, ts: now, period, doc: st.doc };
}
async function listBackups(env, ws) {
  const rs = await env.DB.prepare(
    "SELECT id, ts, period, length(doc) AS size FROM backups WHERE ws=? ORDER BY ts DESC LIMIT 100"
  ).bind(ws).all();
  return rs.results || [];
}
async function getBackup(env, ws, id) {
  const row = id === "latest"
    ? await env.DB.prepare("SELECT id, ts, period, doc FROM backups WHERE ws=? ORDER BY ts DESC LIMIT 1").bind(ws).first()
    : await env.DB.prepare("SELECT id, ts, period, doc FROM backups WHERE ws=? AND id=?").bind(ws, id).first();
  if (!row) return null;
  let doc = null;
  try { doc = JSON.parse(row.doc); } catch (e) {}
  return { id: row.id, ts: row.ts, period: row.period, doc };
}

/* ============================================================================
   Remote drives — each provider: token() + upload(name,content) + downloadLatest()
   Configure via Worker secrets (see README). A provider is skipped if unset.
   ========================================================================== */

/* ----- Dropbox (DROPBOX_TOKEN, or refresh-token trio) ----- */
async function dbxToken(env) {
  if (env.DROPBOX_TOKEN) return env.DROPBOX_TOKEN;
  if (env.DROPBOX_REFRESH_TOKEN && env.DROPBOX_CLIENT_ID && env.DROPBOX_CLIENT_SECRET) {
    const r = await fetch("https://api.dropbox.com/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: env.DROPBOX_REFRESH_TOKEN,
        client_id: env.DROPBOX_CLIENT_ID, client_secret: env.DROPBOX_CLIENT_SECRET,
      }),
    });
    if (r.ok) return (await r.json()).access_token;
  }
  return null;
}
async function dbxUpload(env, name, content) {
  const tok = await dbxToken(env); if (!tok) return false;
  const r = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      authorization: "Bearer " + tok,
      "Dropbox-API-Arg": JSON.stringify({ path: "/" + name, mode: "overwrite", mute: true }),
      "content-type": "application/octet-stream",
    },
    body: content,
  });
  return r.ok;
}
async function dbxDownloadLatest(env) {
  const tok = await dbxToken(env); if (!tok) return null;
  const r = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: { authorization: "Bearer " + tok, "Dropbox-API-Arg": JSON.stringify({ path: "/" + FILE_LATEST }) },
  });
  return r.ok ? await r.text() : null;
}

/* ----- Google Drive (GDRIVE_REFRESH_TOKEN + GDRIVE_CLIENT_ID + GDRIVE_CLIENT_SECRET) ----- */
async function gdToken(env) {
  if (!(env.GDRIVE_REFRESH_TOKEN && env.GDRIVE_CLIENT_ID && env.GDRIVE_CLIENT_SECRET)) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: env.GDRIVE_REFRESH_TOKEN,
      client_id: env.GDRIVE_CLIENT_ID, client_secret: env.GDRIVE_CLIENT_SECRET,
    }),
  });
  return r.ok ? (await r.json()).access_token : null;
}
async function gdFindId(tok, name) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&spaces=appDataFolder&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`,
    { headers: { authorization: "Bearer " + tok } }
  );
  if (!r.ok) return null;
  const j = await r.json();
  return j.files && j.files[0] ? j.files[0].id : null;
}
async function gdUpload(env, name, content) {
  const tok = await gdToken(env); if (!tok) return false;
  const id = await gdFindId(tok, name);
  const boundary = "adpt" + Math.random().toString(36).slice(2);
  const meta = id ? { name } : { name, parents: ["appDataFolder"] };
  const body =
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\ncontent-type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
  const url = id
    ? `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
  const r = await fetch(url, {
    method: id ? "PATCH" : "POST",
    headers: { authorization: "Bearer " + tok, "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return r.ok;
}
async function gdDownloadLatest(env) {
  const tok = await gdToken(env); if (!tok) return null;
  const id = await gdFindId(tok, FILE_LATEST); if (!id) return null;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { authorization: "Bearer " + tok },
  });
  return r.ok ? await r.text() : null;
}

/* ----- OneDrive / Microsoft Graph (ONEDRIVE_REFRESH_TOKEN + ONEDRIVE_CLIENT_ID + ONEDRIVE_CLIENT_SECRET) ----- */
async function odToken(env) {
  if (!(env.ONEDRIVE_REFRESH_TOKEN && env.ONEDRIVE_CLIENT_ID && env.ONEDRIVE_CLIENT_SECRET)) return null;
  const r = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: env.ONEDRIVE_REFRESH_TOKEN,
      client_id: env.ONEDRIVE_CLIENT_ID, client_secret: env.ONEDRIVE_CLIENT_SECRET,
      scope: "Files.ReadWrite offline_access",
    }),
  });
  return r.ok ? (await r.json()).access_token : null;
}
async function odUpload(env, name, content) {
  const tok = await odToken(env); if (!tok) return false;
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(name)}:/content`,
    { method: "PUT", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: content }
  );
  return r.ok;
}
async function odDownloadLatest(env) {
  const tok = await odToken(env); if (!tok) return null;
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(FILE_LATEST)}:/content`,
    { headers: { authorization: "Bearer " + tok } }
  );
  return r.ok ? await r.text() : null;
}

/* ----- provider registry ----- */
function providers(env) {
  return [
    { key: "dropbox",  on: !!(env.DROPBOX_TOKEN || env.DROPBOX_REFRESH_TOKEN), up: dbxUpload, down: dbxDownloadLatest },
    { key: "gdrive",   on: !!env.GDRIVE_REFRESH_TOKEN,                          up: gdUpload,  down: gdDownloadLatest },
    { key: "onedrive", on: !!env.ONEDRIVE_REFRESH_TOKEN,                        up: odUpload,  down: odDownloadLatest },
  ];
}
function remoteStatus(env) {
  const s = {};
  providers(env).forEach((p) => (s[p.key] = p.on));
  return s;
}
async function uploadRemotes(env, content) {
  const out = {};
  for (const p of providers(env)) {
    if (!p.on) { out[p.key] = "skip"; continue; }
    try {
      const a = await p.up(env, FILE_LATEST, content);
      const b = await p.up(env, datedName(), content);
      out[p.key] = a && b ? "ok" : a || b ? "partial" : "fail";
    } catch (e) { out[p.key] = "error"; }
  }
  return out;
}
async function downloadRemoteLatest(env, prefer) {
  let list = providers(env).filter((p) => p.on);
  if (prefer) list = list.sort((a, b) => (a.key === prefer ? 0 : 1) - (b.key === prefer ? 0 : 1));
  for (const p of list) {
    try {
      const txt = await p.down(env);
      if (txt) { try { return { provider: p.key, doc: JSON.parse(txt) }; } catch (e) {} }
    } catch (e) {}
  }
  return null;
}

/* ============================================================================
   HTTP router
   ========================================================================== */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });
    if (path === "/" || path === "/api" || path === "/api/health") return json({ ok: true, service: "adeptio-gantt" });

    if (!authed(request, env)) return json({ error: "unauthorized" }, 401);
    try {
      await ensureSchema(env);
      const ws = wsOf(url);

      if (path === "/api/state" && request.method === "GET") return json(await getState(env, ws));
      if (path === "/api/state" && request.method === "PUT") {
        const body = await request.json().catch(() => null);
        const doc = body && body.doc !== undefined ? body.doc : body;
        if (!doc || typeof doc !== "object") return json({ error: "bad doc" }, 400);
        return json(await putState(env, ws, doc));
      }

      if (path === "/api/backups" && request.method === "GET") return json(await listBackups(env, ws));
      if (path === "/api/backups" && request.method === "POST") {
        const period = url.searchParams.get("period") || "manual";
        const snap = await snapshot(env, ws, period);
        if (!snap) return json({ error: "no state to back up" }, 400);
        const remote = await uploadRemotes(env, JSON.stringify(snap.doc));
        return json({ backup: { id: snap.id, ts: snap.ts, period: snap.period }, remote });
      }
      if (path.startsWith("/api/backups/") && request.method === "GET") {
        const id = decodeURIComponent(path.slice("/api/backups/".length));
        const b = await getBackup(env, ws, id);
        return b ? json(b) : json({ error: "not found" }, 404);
      }

      if (path === "/api/restore" && request.method === "POST") {
        const id = url.searchParams.get("id") || "latest";
        const b = await getBackup(env, ws, id);
        if (!b) return json({ error: "no snapshot" }, 404);
        return json(await putState(env, ws, b.doc));
      }
      if (path === "/api/restore-remote" && request.method === "POST") {
        const prefer = url.searchParams.get("provider") || "";
        const got = await downloadRemoteLatest(env, prefer);
        if (!got) return json({ error: "no remote backup found / no provider configured" }, 404);
        const res = await putState(env, ws, got.doc);
        return json({ provider: got.provider, ...res });
      }

      if (path === "/api/remote/status" && request.method === "GET") return json(remoteStatus(env));

      return json({ error: "not found" }, 404);
    } catch (err) {
      return json({ error: "server", detail: String(err && err.message || err) }, 500);
    }
  },

  /* Cron: snapshot + push to remotes. Period derived from which schedule fired. */
  async scheduled(event, env, ctx) {
    const task = (async () => {
      await ensureSchema(env);
      const ws = "default";
      const weekly = (env.WEEKLY_CRON && event.cron === env.WEEKLY_CRON) || /\*\s+\*\s+[0-7]$/.test(event.cron || "");
      const period = weekly ? "weekly" : "daily";
      const snap = await snapshot(env, ws, period);
      if (snap) await uploadRemotes(env, JSON.stringify(snap.doc));
    })();
    ctx.waitUntil(task);
  },
};
