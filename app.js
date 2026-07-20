"use strict";
/* ============================================================================
   ADEPTIO PROJECT TRACKING — Blueprint v2.2 (vanilla JS SPA)
   Adeptio Lab design system applied via styles.css (Comfortaa/Kanit, pink→
   violet gradient, violet/ruby/green tokens, pill radii). This file emits the
   exact class hooks styles.css defines.

   Features: dashboard (multi-project CRUD + per-project progress summary &
   per-module bars) · per-project Gantt with own URL/new window · Status &
   Summary (1,000 chars, update date on the title line) · Project Status
   progress panel (auto overall %, per-module bars, hide a module's graph,
   drag-reorder) · status column · add/delete + drag-reorder columns ·
   drag-reorder rows · resizable column pane · module-create modal · scroll
   toolbar · Excel/PNG. Local store (localStorage w/ safe fallback); PROD
   swaps the local Store for the Cloudflare Worker + D1 API.
   ========================================================================== */

/* ---------- palette / statuses (brand-derived) ---------- */
const PALETTE = [
  {chip:"#9241ff", fill:"#ece1ff", border:"#9241ff", ink:"#4f2a99"}, // violet
  {chip:"#4f98ff", fill:"#dcebff", border:"#4f98ff", ink:"#244e87"}, // blue
  {chip:"#ff4a7b", fill:"#ffdce6", border:"#ff4a7b", ink:"#8f2244"}, // ruby
  {chip:"#00ce83", fill:"#d4f6e8", border:"#00b676", ink:"#0a5e41"}, // green
  {chip:"#ff83e4", fill:"#ffe1f8", border:"#ff83e4", ink:"#8a3f78"}, // pink
  {chip:"#00d9ff", fill:"#d2f6ff", border:"#00b8d9", ink:"#0a5a68"}, // sky
  {chip:"#9a6cff", fill:"#e7defc", border:"#9a6cff", ink:"#4a338a"}, // light violet
  {chip:"#5f5f5f", fill:"#e6e6ea", border:"#5f5f5f", ink:"#333333"},  // grey
];
const STATUS = [
  {id:"not_started", th:"ยังไม่เริ่ม",     en:"Not Started", color:"#bbbbbb"},
  {id:"in_progress", th:"กำลังดำเนินการ", en:"In Progress", color:"#4f98ff"},
  {id:"at_risk",     th:"มีความเสี่ยง",    en:"At Risk",     color:"#ffab40"},
  {id:"blocked",     th:"ติดปัญหา",        en:"Blocked",     color:"#ff4a7b"},
  {id:"done",        th:"เสร็จสิ้น",       en:"Done",        color:"#00ce83"},
];
const stById = id => STATUS.find(s=>s.id===id) || STATUS[0];
function statusFromText(v){ const s=String(v||"").trim().toLowerCase(); const f=STATUS.find(x=>x.id===s||x.en.toLowerCase()===s||x.th===String(v).trim()); return f?f.id:"not_started"; }

/* ---------- ids / dates / helpers ---------- */
let _seq = 1;
const nid = () => "id_" + Math.random().toString(36).slice(2,8) + (_seq++);
const DAY = 86400000;
const TH_MON = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const EN_MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function parse(s){ if(s instanceof Date) return new Date(s.getFullYear(),s.getMonth(),s.getDate()); const [y,m,d]=String(s).split("-").map(Number); const dt=new Date(y,(m||1)-1,d||1); return isNaN(dt)?today():dt; } // guard against malformed dates (e.g. corrupt restored JSON) propagating NaN
function iso(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function daysBetween(a,b){ return Math.round((parse(b)-parse(a))/DAY); }
function startOfMonth(d){ return new Date(d.getFullYear(),d.getMonth(),1); }
function endOfMonth(d){ return new Date(d.getFullYear(),d.getMonth()+1,0); }
function today(){ const t=new Date(); return new Date(t.getFullYear(),t.getMonth(),t.getDate()); }
function nowIso(){ return new Date().toISOString(); }  // v1.0.5 F1: full datetime for last-edit stamps
/* v1.0.5 F1: render a last-edit stamp. Tolerates BOTH shapes in stored docs — legacy date-only
   "YYYY-MM-DD" (v1.0.4 and earlier wrote these; a stale tab may still write one during the LWW
   window) renders date-only; full ISO renders "DD/MM/YYYY HH:mm" in LOCAL time (spec §3, N3). */
function fmtStamp(s){
  if(!s) return "";
  const str=String(s);
  if(/^\d{4}-\d{2}-\d{2}$/.test(str)){ const p=str.split("-"); return p[2]+"/"+p[1]+"/"+p[0]; }
  const d=new Date(str); if(isNaN(d)) return "";
  const p2=n=>String(n).padStart(2,"0");
  return p2(d.getDate())+"/"+p2(d.getMonth()+1)+"/"+d.getFullYear()+" "+p2(d.getHours())+":"+p2(d.getMinutes());
}
const LS_UI = "adeptio_ptrack_ui";
/* v1.0.4 §1.8 / R12 — continuous Gantt zoom: px-per-day (PPD) ∈ [0.9,34], persisted per-device in
   `ui` (LS_UI), NEVER in the doc. The three legacy day/week/month presets survive only as shortcuts
   that set an exact PPD (Day→34, Week→11, Month→4.4, clamped into range). */
const PPD_MIN=0.9, PPD_MAX=34;
const PRESET_PPD={ day:34, week:11, month:4.4 };
function clampPpd(v){ v=+v; if(!isFinite(v)) v=PRESET_PPD.week; return Math.max(PPD_MIN, Math.min(PPD_MAX, v)); }
const THEME_MODES = ["auto","light","dark"];                                                            // §1.10/R12: theme mode set (sanitizer domain)
const ui = { cal:"CE", wrapTxt:false, colW:{}, ppd:PRESET_PPD.week, theme:"auto" };  // default zoom = week (11px/day), same as v1.0.3; default theme = auto (follow OS)
try{ const _u=JSON.parse(localStorage.getItem(LS_UI)||"{}"); if(_u && typeof _u==="object"){
  if("wrapTxt" in _u) ui.wrapTxt=!!_u.wrapTxt;
  if(_u.colW && typeof _u.colW==="object") ui.colW=_u.colW;
  if("ppd" in _u && _u.ppd!=null && isFinite(+_u.ppd)) ui.ppd=clampPpd(_u.ppd);                        // R12: restore continuous zoom, sanitized into [0.9,34]
  else if(typeof _u.zoom==="string" && PRESET_PPD[_u.zoom]!=null) ui.ppd=clampPpd(PRESET_PPD[_u.zoom]); // legacy: a stored preset string maps to its PPD ONCE (saveUi no longer writes `zoom`, so it drops next save)
  if(typeof _u.theme==="string" && THEME_MODES.includes(_u.theme)) ui.theme=_u.theme;                  // R12: restore theme, sanitized to {auto,light,dark}; anything else → default 'auto'
} }catch(e){}
/* FIX: colW is now namespaced per project ({pid:{key:w}}). Drop any legacy flat {key:w} (numeric top-level values) so old widths can't bleed across projects or corrupt the nested shape. */
if(ui.colW && Object.keys(ui.colW).some(k=>typeof ui.colW[k]==="number")) ui.colW={};
function saveUi(){ try{ localStorage.setItem(LS_UI, JSON.stringify({wrapTxt:!!ui.wrapTxt, colW:ui.colW||{}, ppd:clampPpd(ui.ppd), theme:(THEME_MODES.includes(ui.theme)?ui.theme:"auto")})); }catch(e){} } // R12: persist ppd + theme beside wrapTxt/colW; never the doc, and no legacy `zoom` key

/* ---------- THEME (v1.0.4 §1.10 / R12): Auto / Light / Dark ----------
   Per-device in `ui` (LS_UI), NEVER in the doc. 'auto' follows the OS prefers-color-scheme; explicit
   light/dark OVERRIDE it (both directions, §5.4). The EFFECTIVE theme is written as a CONCRETE
   'light'|'dark' onto document.documentElement[data-theme] — that attribute drives (a) the dark token
   block + scattered [data-theme="dark"] overrides in styles.css, and (b) the inline dark bar-fill branch
   in renderTimeline. A switch re-renders the board because bar fills are inline (not token-driven). */
function prefersDark(){ try{ return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches); }catch(e){ return false; } }
function effectiveTheme(){ const t=THEME_MODES.includes(ui.theme)?ui.theme:"auto"; return (t==="dark" || (t==="auto" && prefersDark())) ? "dark" : "light"; }
function syncThemeSeg(){ document.querySelectorAll("[data-theme-set]").forEach(b=> b.classList.toggle("on", b.dataset.themeSet===ui.theme)); } // segmented control reflects ui.theme
function applyTheme(){ document.documentElement.setAttribute("data-theme", effectiveTheme()); syncThemeSeg(); }                        // idempotent: (re)stamp the root + refresh the control
function domThemeDark(){ return document.documentElement.getAttribute("data-theme")==="dark"; }                                       // §1.10 T1: the DOM attribute is the SINGLE render-time authority — render code READS it; effectiveTheme() only decides what applyTheme()/export/print WRITE. So a forced-light export/print re-render is automatically consistent (no dark fills leak into the PNG/print).
function rerenderForTheme(){ if(el("leftBody")) renderBoard(); else if(el("rowsLayer")) renderTimeline(); }                           // rebuild inline bar fills (timeline tab only; summary/dashboard are pure-token → CSS handles them)
function setTheme(mode){                                                                                                              // control handler: persist + apply + re-render (NOT via apply() — no doc mutation)
  ui.theme = THEME_MODES.includes(mode) ? mode : "auto"; saveUi();
  applyTheme(); rerenderForTheme();
}
let _themeGuardWired=false, _themeFlipT=null;
function wireThemeGuard(){                                                                                                            // AUTO mode: re-apply the effective theme when the OS scheme flips (wired ONCE, like wireDragGuard/wireResizeGuard)
  if(_themeGuardWired) return; _themeGuardWired=true;
  try{ const mq=window.matchMedia("(prefers-color-scheme: dark)");
    const onFlip=()=>{
      if(ui.theme!=="auto") return;                                                                                                  // only auto follows the OS; explicit light/dark ignore the flip
      applyTheme();                                                                                                                  // T3: stamp the ATTRIBUTE immediately (cheap, CSS-correct) — even mid-edit; token-driven surfaces adapt at once, and the write is safe to interleave with an open contenteditable
      const rerender=()=>{ if(editingNow()){ _themeFlipT=setTimeout(rerender, 400); return; } _themeFlipT=null; rerenderForTheme(); }; // T3: defer the innerHTML rebuild while an edit is in flight (a mid-edit rebuild drops uncommitted contenteditable text — every other async re-render path defers via editingNow()); retry until idle, then re-render ONCE to the latest state
      clearTimeout(_themeFlipT); rerender();                                                                                         // reuse ONE handle so rapid OS flips never stack timers
    };
    if(mq.addEventListener) mq.addEventListener("change", onFlip); else if(mq.addListener) mq.addListener(onFlip);                    // addListener fallback for older engines
  }catch(e){}
}
/* §1.10 T2: PRINT while dark leaks the INLINE dark bar fills — the @media screen wrap reverts CSS tokens for
   print but inline styles survive. Wired ONCE (like wireThemeGuard). beforeprint runs BEFORE Chromium paints
   the print view, so stamping light + a synchronous renderBoard() rebuilds the inline fills as light pastels
   in time; afterprint restores the user's theme. Covers the menu Print button AND the Cmd-P/browser path. */
let _printGuardWired=false, _printForcedLight=false;
function wirePrintGuard(){
  if(_printGuardWired) return; _printGuardWired=true;
  window.addEventListener("beforeprint", ()=>{ if(domThemeDark()){ document.documentElement.setAttribute("data-theme","light"); renderBoard(); _printForcedLight=true; } }); // force light + rebuild inline fills synchronously
  window.addEventListener("afterprint",  ()=>{ if(_printForcedLight){ _printForcedLight=false; applyTheme(); rerenderForTheme(); } });                                        // restore the attribute + re-render the dark inline fills
}
/* Palette colour maths for the dark bar-fill branch (§1.10 item 6): a translucent chip fill over the dark
   board + a light chip-tint ink for legibility. Light theme keeps the pastel pc.fill / dark pc.ink as-is. */
function hex2rgb(h){ h=String(h==null?"":h).trim().replace(/^#/,""); if(h.length===3) h=h.split("").map(c=>c+c).join(""); const n=parseInt(h||"000000",16); return isNaN(n)?[0,0,0]:[(n>>16)&255,(n>>8)&255,n&255]; }
function hex2rgba(h,a){ const c=hex2rgb(h); return "rgba("+c[0]+","+c[1]+","+c[2]+","+a+")"; }
function lighten(h,amt){ const c=hex2rgb(h), m=x=>Math.round(x+(255-x)*amt); return "rgb("+m(c[0])+","+m(c[1])+","+m(c[2])+")"; } // mix toward white by amt∈[0,1]
function dispYear(d){ return ui.cal==="BE" ? d.getFullYear()+543 : d.getFullYear(); }
function monName(mi){ return ui.cal==="BE" ? TH_MON[mi] : EN_MON[mi]; }
function fmtThai(d){ return d.getDate()+" "+monName(d.getMonth())+" "+String(dispYear(d)).slice(-2); }
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
const el = id => document.getElementById(id);
function safeName(s){ return String(s||"export").replace(/[^A-Za-z0-9]+/g,"_").replace(/^_|_$/g,""); }

/* ---------- icons (Heroicons-style line, currentColor) ---------- */
function ic(p){ return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${p}</svg>`; }
const IC = {
  caret: ic('<path d="M9 6l6 6-6 6"/>'),
  plus:  ic('<path d="M12 5v14M5 12h14"/>'),
  trash: ic('<path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13a1 1 0 001 1h6a1 1 0 001-1l1-13"/>'),
  up:    ic('<path d="M12 19V6M6 11l6-6 6 6"/>'),
  down:  ic('<path d="M12 5v13M6 13l6 6 6-6"/>'),
  grip:  ic('<circle cx="9" cy="6" r="1.4"/><circle cx="15" cy="6" r="1.4"/><circle cx="9" cy="12" r="1.4"/><circle cx="15" cy="12" r="1.4"/><circle cx="9" cy="18" r="1.4"/><circle cx="15" cy="18" r="1.4"/>'),
  x:     ic('<path d="M6 6l12 12M18 6L6 18"/>'),
  edit:  ic('<path d="M4 20h4L20 8l-4-4L4 16v4z"/>'),
  open:  ic('<path d="M14 3h7v7M21 3l-9 9M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/>'),
  hist:  ic('<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v4h4"/><path d="M12 8v4l3 2"/>'),
  doc:   ic('<path d="M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'),
  gantt: ic('<rect x="3" y="5" width="10" height="3" rx="1"/><rect x="8" y="10.5" width="11" height="3" rx="1"/><rect x="5" y="16" width="8" height="3" rx="1"/>'),
  imp:   ic('<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>'),
  exp:   ic('<path d="M12 21V9m0 0l-4 4m4-4l4 4M4 7V5a2 2 0 012-2h12a2 2 0 012 2v2"/>'),
  arrow: ic('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  cloud: ic('<path d="M7 18a4 4 0 01-.5-7.97 5.5 5.5 0 0110.55-1.3A4 4 0 0117.5 18H7z"/>'),
  restore: ic('<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v3.5h3.5"/><path d="M12 8v4l3 2"/>'),
  link:  ic('<path d="M9 15l6-6M10.5 6.5l1-1a4 4 0 015.95 5.3l-1.2 1.2M13.5 17.5l-1 1a4 4 0 01-5.95-5.3l1.2-1.2"/>'),
  wrap:  ic('<path d="M3 6h18"/><path d="M3 12h15a3 3 0 010 6h-4"/><path d="M17 15l-3 3 3 3"/><path d="M3 18h6"/>'),
  indent:  ic('<path d="M4 6h16M4 12h9M4 18h16"/><path d="M15 8.5l3.5 3.5-3.5 3.5"/>'),   // ⇥ tuck under previous sibling (Indent)
  outdent: ic('<path d="M4 6h16M11 12h9M4 18h16"/><path d="M8.5 8.5L5 12l3.5 3.5"/>'),   // ⇤ lift to grandparent level (Outdent)
  promote: ic('<path d="M8 8l4-4 4 4M8 16l4 4 4-4"/>'),                                   // ⇄ convert Feature ⇆ Module (promote/demote)
  note:  ic('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>'),  // v1.0.5 F2: โน้ตโครงการ
};

/* =====================  STORE (local-first, optional cloud sync)  ===== */
const LS_KEY = "adeptio_ptrack_v2";
const LS_REV = "adeptio_ptrack_rev";
let MEM = null, DB = null, _lsWarned = false;
function safeGet(){ try{ return localStorage.getItem(LS_KEY); }catch(e){ return null; } }
function safeSet(v){ try{ localStorage.setItem(LS_KEY,v); return true; }catch(e){ return false; } }

/* ---- Cloud sync config (optional). Point API_BASE at your Cloudflare Worker to
   enable shared, cross-device persistence + server/drive backups. Leave empty and
   the app runs purely on localStorage (offline). API_TOKEN must match the Worker. */
const API_BASE  = "https://adeptio-gantt.pathom-bot.workers.dev"; // e.g. "https://adeptio-gantt.<your-subdomain>.workers.dev"
const API_TOKEN = "adeptiolab.com"; // must equal the Worker's API_TOKEN secret (if it sets one)       
const WORKSPACE = "default";
const cloudOn = () => !!API_BASE;
function apiUrl(path){ const sep = path.includes("?") ? "&" : "?"; return API_BASE.replace(/\/$/,"") + path + sep + "ws=" + encodeURIComponent(WORKSPACE); }
function apiHeaders(extra){ const h = { "content-type":"application/json", ...(extra||{}) }; if(API_TOKEN) h["authorization"] = "Bearer " + API_TOKEN; return h; }
function lsRev(){ try{ return (+(localStorage.getItem(LS_REV)||0))||0; }catch(e){ return 0; } }
function setLsRev(r){ try{ localStorage.setItem(LS_REV, String(r)); }catch(e){} }

const Store = {
  load(){
    const raw = safeGet();
    if(raw){ try{ DB = JSON.parse(raw); }catch(e){ DB=null; } }
    if(!DB){ DB = MEM || seedDB(); }
    migrateDB(DB);                                    // v1.0.4: flat modules+parentId → recursive node tree (idempotent, per project)
    MEM = DB; return DB;
  },
  save(){
    /* v1.0.5 F1 (N2): the ONE stamping point — every doc mutation funnels through here, so
       "any information edit/change" gets a last-edit datetime with zero per-call-site edits.
       PID is null on the dashboard (route() clears it), so an open project is never mis-stamped
       by dashboard-level saves; the project modal stamps its own target explicitly. */
    DB.updatedAt = nowIso();
    const P0 = PID ? proj() : null; if(P0) P0.updatedAt = nowIso();
    const s=JSON.stringify(DB); if(!safeSet(s)){ MEM=DB; if(!_lsWarned){ _lsWarned=true; toast("บันทึกลงเครื่องไม่สำเร็จ — พื้นที่จัดเก็บเต็มหรือถูกปิด"); } } if(cloudOn()) schedulePush(); // FIX: warn once when localStorage write fails (quota/private mode) instead of failing silently
    refreshStamps();
  }
};
function proj(){ return DB.projects.find(p=>p.id===PID) || null; }
/* v1.0.5 F1: LIGHT stamp refresh — updates the Project Status header stamp in place after a save
   (blur-saves and autosaves don't re-render, so the element must be touched directly). Never a
   re-render: typing mid-edit must not lose focus/selection. */
function refreshStamps(){
  const s=el("statusStamp"); if(!s) return;
  const P = PID ? proj() : null;
  if(P && P.updatedAt) s.textContent = "แก้ไขล่าสุด " + fmtStamp(P.updatedAt);
}

/* ---- cloud sync engine: local-first; the Worker's `rev` is the tiebreaker ---- */
let pushTimer=null, pushPending=false, pushFails=0;
/* Centralized drag guard (replaces the old per-handler interaction latch): while ANY
   pointer drag/resize is in flight, background cloud/storage sync must NOT re-render
   or adopt a remote doc (that would corrupt the drag). ONE capture-phase pointerdown
   latches _dragging when the press lands on a drag handle; a capture-phase pointerup/
   pointercancel ALWAYS fires (even under setPointerCapture) and clears it — so the
   guard can never stick and needs no self-heal. editingNow() consults it so cloudPull
   + the storage listener defer. Wired exactly once at startup (see wireDragGuard). */
let _dragging=false;
const _DRAG_SEL='.bar,.grip,.colHead,.colResize,#splitter,.pgrip,.modGrip';
function isInteracting(){ return _dragging; }                                         // compat shim (tests): true while a drag is live
function cloudSyncState(){ return { pushPending:pushPending, interacting:_dragging }; } // diagnostic surface (used by tests)
let _dragGuardWired=false;
function wireDragGuard(){                                                              // register ONCE; idempotent even if startup ran twice
  if(_dragGuardWired) return; _dragGuardWired=true;
  document.addEventListener('pointerdown', e=>{ if(e.target && e.target.closest && e.target.closest(_DRAG_SEL)) _dragging=true; }, true);
  const endDrag=()=>{ _dragging=false; };
  document.addEventListener('pointerup', endDrag, true);
  document.addEventListener('pointercancel', ()=>{ endDrag(); if(drag) drag._s=null; onBarUp(); }, true);   // R-E1d: a genuine cancel has NO trailing pointerup, so onBarUp never runs on its own → drive it here to tear the bar drag down (null _s ⇒ snap-back, not commit): it strips the window listeners + .dragging, clears userSelect, nulls drag, and hideTip(). Mirrors row/mod-drag's *Up self-heal; onBarUp self-guards (if(!drag) return) so module/row cancels just get its hideTip(). Leaving drag non-null would let the R-E1a hover guards kill every tooltip until the next full bar drag.
}
/* H2: the months-in-view readout depends on #rightScroll.clientWidth, which changes on a window resize
   with NO re-render. One debounced resize listener (wired once, like wireDragGuard) refreshes the readout
   only — never a re-render. */
let _resizeGuardWired=false, _resizeT=0;
function wireResizeGuard(){                                                            // register ONCE; idempotent even if startup ran twice
  if(_resizeGuardWired) return; _resizeGuardWired=true;
  window.addEventListener('resize', ()=>{ clearTimeout(_resizeT); _resizeT=setTimeout(()=>{ if(el("rightScroll")) syncZoomUI(); }, 150); }); // debounced ~150ms; readout refresh ONLY when the timeline is present
}
function schedulePush(){ pushPending=true; clearTimeout(pushTimer); pushTimer=setTimeout(cloudPush, 800); }
async function cloudPush(){
  if(!cloudOn()) return;
  try{
    const res = await fetch(apiUrl("/api/state"), { method:"PUT", headers:apiHeaders(), body:JSON.stringify({doc:DB}) });
    if(res.ok){ const j=await res.json(); if(j && typeof j.rev==="number") setLsRev(j.rev); pushPending=false; pushFails=0; return; }
    onPushFail();                                    // FIX: server rejected → clear latch + backoff retry (never leave pushPending stuck)
  }catch(e){ onPushFail(); }                          // FIX: offline/blocked → clear latch + backoff retry
}
function onPushFail(){                                // FIX: clearing pushPending stops a failed push from permanently blocking cloudPull adoption
  pushPending=false;
  const delay=Math.min(5000*(1<<Math.min(pushFails++,4)), 60000);
  clearTimeout(pushTimer); pushTimer=setTimeout(cloudPush, delay);
}
function editingNow(){
  if(_dragging) return true;                  // never adopt a remote doc while a drag/resize is in flight
  const a=document.activeElement;
  if(a && (a.tagName==="TEXTAREA" || a.tagName==="INPUT" || a.isContentEditable)) return true;
  if(el("modalRoot") && el("modalRoot").style.display==="block") return true;
  if(el("historyOverlay") && el("historyOverlay").style.display==="flex") return true;
  if(notesOpen()) return true;                 // v1.0.5 F2 (N5): never adopt a remote doc / re-render while the notes popup is open
  return false;
}
function adoptRemote(doc, rev){ DB=doc; migrateDB(DB); MEM=DB; safeSet(JSON.stringify(DB)); setLsRev(rev); route(); } // migrate a possibly-v1 remote doc BEFORE persisting/rendering (idempotent)
async function cloudPull(force){
  if(!cloudOn()) return false;
  try{
    const res = await fetch(apiUrl("/api/state"), { headers:apiHeaders() });
    if(!res.ok) return false;
    const j = await res.json();
    if(j && j.doc && typeof j.rev==="number"){
      if(force || (j.rev > lsRev() && !pushPending && !editingNow())){ adoptRemote(j.doc, j.rev); return true; }
    }
    return false;
  }catch(e){ return false; }
}
async function cloudSync(){
  if(!cloudOn()) return;
  try{
    const res = await fetch(apiUrl("/api/state"), { headers:apiHeaders() });
    if(res.ok){
      const j = await res.json();
      if(j && j.doc){                                  // server already has data
        if(j.rev > lsRev() || !safeGet()){ adoptRemote(j.doc, j.rev); toast("ซิงก์ข้อมูลจากคลาวด์แล้ว"); }
        else cloudPush();                              // local is ahead/equal → push up
      } else {
        cloudPush();                                   // server empty → seed it from local
      }
    }
  }catch(e){ /* offline → localStorage only */ }
}

/* =====================  SEED DATA  ===================== */
function mkFeat(fid,nm,desc,s,e,status,rmk,owner){ return {id:nid(),fid,name:nm,description:desc,start:s,end:e,status:status||"not_started",remark:rmk||"",custom:owner!==undefined?{owner}:{}}; }
function seedDB(){
  const ysc = {
    id:"ysc-inv-proc", name:"YSC — Inventory & Procurement", client:"Yongcharoen Group", code:"YSC-IP", color:0,
    createdAt:"2026-05-01", updatedAt:"2026-06-20",
    customCols:[{id:"owner", label:"ผู้รับผิดชอบ (Owner)", w:140, kind:"text"}],
    summary:{
      current:{id:nid(), date:"2026-06-20", text:"อยู่ระหว่างเตรียม Kickoff และยืนยันขอบเขต BRD (64 features) กับลูกค้า โครงสร้าง GCP Cloud Run + MongoDB Atlas พร้อมแล้ว ความเสี่ยงหลักคือ timeline ของ PRO-GR (Goods Receipt 4-way Matching) ซึ่งอยู่บน critical path และต้องเชื่อม ConX ERP ให้เสร็จก่อน SIT"},
      history:[
        {id:nid(), date:"2026-05-30", text:"สรุปขอบเขตรอบที่ 2: ตัด PRO-PAY, INV-MD-03 (Unit Conversion) และ INV-CT-03 (Stock Disposal) ออกจาก scope ยืนยัน 64 features (Section A 21 / Section B 43)"},
        {id:nid(), date:"2026-05-15", text:"เริ่มโครงการ — รวบรวม requirement เบื้องต้นจาก Sales (O2C) phase เดิม และวางแผน workshop 4 รอบตามกลุ่ม module"},
      ]
    },
    modules:[
      {id:nid(), name:"Project Setup & BRD", description:"Kickoff, BRD, สถาปัตยกรรม และ Wireframe", color:0, collapsed:false, features:[
        mkFeat("PRJ-01","Kickoff & Scope Confirmation","ยืนยันขอบเขตงานและจัด Workshop ร่วมกับลูกค้า (4 รอบ)","2026-07-01","2026-07-11","done","Workshop 4 รอบ","Preaw / Tip"),
        mkFeat("PRJ-02","BRD — Inventory & Procurement","จัดทำเอกสาร BRD ราย Feature ทั้ง Section A และ B","2026-07-07","2026-08-08","in_progress","64 features","Preaw"),
        mkFeat("PRJ-03","System Architecture & Environment","ออกแบบสถาปัตยกรรมและตั้งค่า GCP + MongoDB Atlas","2026-07-21","2026-08-22","in_progress","GCP / Mongo","Opor"),
        mkFeat("PRJ-04","UX/UI Wireframe (Figma)","ออกแบบ Wireframe และ Prototype หน้าจอหลัก","2026-08-01","2026-09-05","not_started","","Yee"),
      ]},
      {id:nid(), name:"Inventory Management (Section A)", description:"21 features — MD, Stock-In, Warehouse, Dispatch, Count", color:1, collapsed:false, features:[
        mkFeat("INV-MD","Master Data & Item Setup","ข้อมูลหลักสินค้า หน่วยนับ และโครงสร้างคลัง","2026-08-25","2026-09-20","not_started","","Keng"),
        mkFeat("INV-IN","Stock-In & Lot Costing","รับเข้าสินค้าและคำนวณต้นทุนระดับ Lot","2026-09-08","2026-10-10","not_started","","Keng"),
        mkFeat("INV-WH","Warehouse & Stock Valuation","ติดตามตำแหน่งสต็อกและตีมูลค่าคงคลัง","2026-09-22","2026-10-24","not_started","FEFO/FIFO","Keng"),
        mkFeat("INV-OUT","Dispatch / Shipping","ตัดจ่ายสินค้าออกและจัดส่ง","2026-10-06","2026-10-31","not_started","","Keng"),
        mkFeat("INV-CT","Stock Count & Variance","นับสต็อกและจัดการผลต่าง พร้อม Decision Flow","2026-10-20","2026-11-14","not_started","","Keng"),
      ]},
      {id:nid(), name:"Procurement P2P (Section B)", description:"43 features — PR, PO, GR (critical), Reports, User Mgmt", color:2, collapsed:false, features:[
        mkFeat("PRO-PR","Purchase Request & Auto-PR","ใบขอซื้อและ Logic การสร้าง PR อัตโนมัติ","2026-08-25","2026-09-26","not_started","","Keng"),
        mkFeat("PRO-PO","Purchase Order","ออกใบสั่งซื้อและอนุมัติตามลำดับชั้น","2026-09-15","2026-10-17","not_started","","Keng"),
        mkFeat("PRO-GR","Goods Receipt (4-way Matching)","รับสินค้าและจับคู่เอกสาร 4 ทาง + Auto Stock-In","2026-09-29","2026-11-07","at_risk","Critical path","Keng"),
        mkFeat("PRO-RPT","Reports & Demand/Supply Forecast","รายงานจัดซื้อและพยากรณ์อุปสงค์–อุปทาน","2026-10-20","2026-11-21","not_started","","Keng"),
        mkFeat("PRO-UM","User Management & Activity Log","จัดการผู้ใช้ สิทธิ์ และ Audit Log","2026-10-13","2026-11-07","not_started","","Keng"),
      ]},
      {id:nid(), name:"Integration & Interface", description:"เชื่อม ConX ERP (external) + Interface ภายใน", color:5, collapsed:false, features:[
        mkFeat("INT-01","ConX ERP Integration","เชื่อมต่อ ConX ผ่าน Webhook + HMAC + OAuth","2026-09-01","2026-10-31","not_started","Integration","Opor"),
        mkFeat("INT-02","Internal Module Interface","Interface ภายใน Inventory ↔ Procurement","2026-10-01","2026-11-07","not_started","Interface","Opor"),
      ]},
      {id:nid(), name:"Testing — SIT & UAT", description:"พ.ย. 2569 – ม.ค. 2570", color:3, collapsed:false, features:[
        mkFeat("TST-SIT","System Integration Test (SIT)","ทดสอบการเชื่อมต่อทั้งระบบ","2026-11-09","2026-12-19","not_started","พ.ย.–ธ.ค. 2569","Tae"),
        mkFeat("TST-UAT","User Acceptance Test (UAT)","ลูกค้าทดสอบและยอมรับระบบ","2026-12-14","2027-01-30","not_started","ธ.ค.69–ม.ค.70","Tae"),
        mkFeat("TST-FIX","Defect Fix & Regression","แก้ไขข้อบกพร่องและทดสอบซ้ำ","2026-12-21","2027-01-30","not_started","","Keng"),
      ]},
      {id:nid(), name:"Go-Live & Handover", description:"Target ก.พ. 2570 + เริ่ม MA", color:4, collapsed:false, features:[
        mkFeat("GO-01","Data Migration & Cutover","โอนย้ายข้อมูลและเตรียม Cutover","2027-01-19","2027-02-06","not_started","","Opor"),
        mkFeat("GO-02","Go-Live","เปิดใช้งานระบบจริง","2027-02-09","2027-02-13","not_started","Target ก.พ. 2570","Preaw"),
        mkFeat("GO-03","Warranty / MA Start","เริ่มระยะรับประกันและสัญญา MA","2027-02-16","2027-02-27","not_started","Bronze/Silver/Gold","Preaw"),
      ]},
    ]
  };
  const ecom = {
    id:"ysc-ecommerce", name:"YSC — E-commerce Platform", client:"Yongcharoen Group", code:"YSC-EC", color:5,
    createdAt:"2026-04-01", updatedAt:"2026-06-10",
    customCols:[{id:"owner", label:"Owner", w:130, kind:"text"}],
    summary:{ current:{id:nid(), date:"2026-06-10", text:"Storefront และ Order Management (FR-3 hub กลาง) อยู่ระหว่างพัฒนา ConX integration และ BG/Credit module เป็นงานที่ต้องเฝ้าระวัง"}, history:[] },
    modules:[
      {id:nid(), name:"Storefront (FR-1)", description:"Homepage, Product, Cart — Senior-friendly UX", color:0, collapsed:false, features:[
        mkFeat("FR-1.1","Homepage & Banners","Announcement bar, Hero, Brand carousel","2026-05-01","2026-06-06","done","","Keng"),
        mkFeat("FR-1.2","Product Card & List","แสดงราคาปกติ/ลด/% และสถานะสต็อก","2026-05-18","2026-06-20","in_progress","","Keng"),
        mkFeat("FR-1.5","Cart","ตะกร้าและสรุปคำสั่งซื้อ","2026-06-08","2026-07-04","not_started","","Keng"),
      ]},
      {id:nid(), name:"Order Management (FR-3)", description:"Central hub — มี dependency มากที่สุด", color:2, collapsed:false, features:[
        mkFeat("FR-3","Order Management Core","สถานะคำสั่งซื้อ, แก้ไขภายใต้กฎ D-009","2026-05-25","2026-07-11","at_risk","Central hub","Keng"),
        mkFeat("FR-4","Checkout & Payment","2C2P + เงื่อนไขชำระเงิน","2026-06-15","2026-07-18","not_started","2C2P","Keng"),
      ]},
      {id:nid(), name:"Integration & Go-Live", description:"ConX, LINE OA, UAT, Go-Live", color:3, collapsed:false, features:[
        mkFeat("INT-EC","ConX ERP Integration","Webhook + reconcile stock","2026-06-01","2026-07-25","not_started","Integration","Opor"),
        mkFeat("UAT-EC","UAT & Go-Live","ทดสอบและเปิดใช้งาน","2026-07-20","2026-08-22","not_started","","Tae"),
      ]},
    ]
  };
  const osi = {
    id:"osi-b2c", name:"O-si — B2C Growth Pilot", client:"O-si (o-si.co.th)", code:"OSI-B2C", color:4,
    createdAt:"2026-06-01", updatedAt:"2026-06-15",
    customCols:[],
    summary:{ current:{id:nid(), date:"2026-06-15", text:"แผน Pilot 90 วันสำหรับกลุ่ม Art & Craft Hobbyist รอความชัดเจนเรื่อง margin, กำลังทีม และงบประมาณก่อนเริ่ม"}, history:[] },
    modules:[
      {id:nid(), name:"Pilot Setup", description:"กลุ่ม Art & Craft Hobbyist", color:0, collapsed:false, features:[
        mkFeat("PIL-01","Segment & Offer Definition","นิยามกลุ่มเป้าหมายและข้อเสนอ","2026-07-01","2026-07-18","not_started",""),
        mkFeat("PIL-02","Channel & Content Plan","วางแผนช่องทางและคอนเทนต์","2026-07-14","2026-08-08","not_started",""),
        mkFeat("PIL-03","90-Day Pilot Run","ดำเนินการและวัดผล","2026-08-10","2026-11-08","not_started","90 days"),
      ]},
    ]
  };
  return { projects:[ysc, ecom, osi] };
}

/* =====================  PROGRESS MODEL  ===================== */
/* §4 consistency — stats roll up recursively: a container's stats span EVERY
   descendant feature (direct + nested sub-container features) via the shared
   containerFeatures() walk, so create/move/delete can never disagree with display. */
function moduleStats(m){
  const feats=containerFeatures(m); const total=feats.length; let done=0, started=0;
  feats.forEach(f=>{ if(f.status==="done") done++; else if(f.status!=="not_started") started++; });
  const ns=total-done-started, pc=n=> total? Math.round(n/total*100):0;
  return {total, done, started, notStarted:ns, donePct:pc(done), startedPct:pc(started), notPct:pc(ns)};
}
function aggregateStats(mods){
  let total=0, done=0, started=0;
  mods.forEach(m=> containerFeatures(m).forEach(f=>{ total++; if(f.status==="done") done++; else if(f.status!=="not_started") started++; }));
  const ns=total-done-started, pc=n=> total? Math.round(n/total*100):0;
  return {total, done, started, notStarted:ns, donePct:pc(done), startedPct:pc(started), notPct:pc(ns)};
}
function normalizeProgressOrder(P){
  let o=(P.progressOrder||[]).slice();
  P.modules.forEach(m=>{ if(!o.includes(m.id)) o.push(m.id); });
  const ids=new Set(P.modules.map(m=>m.id));
  o=o.filter(id=>ids.has(id));
  P.progressOrder=o; return o;
}
function progressModules(P){ return normalizeProgressOrder(P).map(id=>P.modules.find(m=>m.id===id)).filter(m=>m && !m.hideProgress); }
function barSeg(s){ return `<span class="bseg done" style="width:${s.donePct}%"></span><span class="bseg prog" style="width:${s.startedPct}%"></span>`; }
/* ----- per-module KPI: target vs actual + status detail/remark ----- */
function kpiOf(m){ if(!m.kpi||typeof m.kpi!=="object"){ m.kpi={target:null,actual:null,state:"auto",detail:"",remark:""}; } return m.kpi; }
function kpiState(m,s){
  const k=kpiOf(m); s=s||moduleStats(m);
  const eff=(k.actual==null?s.donePct:k.actual);
  let key=k.state;
  if(!key||key==="auto"){ if(k.target==null) key="none"; else if(eff>=100) key="done"; else if(eff>=k.target) key="ontrack"; else key="delay"; }
  const MAP={none:{cls:"k-none",label:"—"},ontrack:{cls:"k-ontrack",label:"ตามแผน"},delay:{cls:"k-delay",label:"ล่าช้า"},block:{cls:"k-block",label:"ติดปัญหา"},done:{cls:"k-done",label:"เสร็จ"}};
  return MAP[key]||MAP.none;
}
function onKpiChange(e){
  const inp=e.target, P=proj(), m=P.modules.find(x=>x.id===inp.dataset.mid); if(!m) return;
  const k=kpiOf(m), f=inp.dataset.f;
  if(f==="target"||f==="actual"){ const v=inp.value.trim(); if(v===""){ k[f]=null; } else { let n=Math.round(+v); if(isNaN(n)){ k[f]=null; inp.value=""; } else { n=Math.max(0,Math.min(100,n)); k[f]=n; inp.value=n; } } }
  else if(f==="state"){ k.state=inp.value; }
  else { k[f]=inp.value; }
  Store.save();
  const s=moduleStats(m), st=kpiState(m,s), badge=document.querySelector(`.kpiBadge[data-badge="${m.id}"]`);
  if(badge){ badge.className="kpiBadge "+st.cls; badge.textContent=st.label; }
}

/* =====================  ROUTING  ===================== */
let PID = null;
function readRoute(){
  // The app navigates purely via hash URLs (e.g. #project=<id>&view=history).
  const hash = location.hash.replace(/^#/,"");
  const hp = new URLSearchParams(hash.includes("=")?hash:"");
  return { pid: hp.get("project"), view: hp.get("view") };
}
function projectUrl(id, view){ return location.pathname + "#project=" + id + (view?("&view="+view):""); }
function openProjectWindow(id){
  const url = projectUrl(id);
  const w = window.open(url, "adeptio_proj_"+id, "width=1480,height=920");
  if(!w){ location.href = url; }
}
function route(){
  const {pid, view} = readRoute();
  closeModal(); hideHistory(); notesHardClose();     // v1.0.5 F2 audit fix: flush+close notes BEFORE PID changes (see notesHardClose)
  if(pid && DB.projects.some(p=>p.id===pid)){
    PID = pid; renderProject();
    if(view==="history") showHistory();
  } else { PID = null; renderDashboard(); }
}

/* =====================  DASHBOARD  ===================== */
function renderDashboard(){
  DB.projects.forEach(normalizeTree);
  const ps = DB.projects;
  const cards = ps.map(p=>{
    const pc = PALETTE[p.color%PALETTE.length];
    let mn=null, mx=null, nFeat=0;
    walkFeatures(p, f=>{ nFeat++; const s=parse(f.start),e=parse(f.end); if(!mn||s<mn)mn=s; if(!mx||e>mx)mx=e; }); // recursive: count every descendant feature + derive the date range
    const range = mn ? `${monName(mn.getMonth())} ${String(dispYear(mn)).slice(-2)} – ${monName(mx.getMonth())} ${String(dispYear(mx)).slice(-2)}` : "—";
    const cur = p.summary && p.summary.current;
    const vmods = progressModules(p);
    const agg = aggregateStats(vmods);
    const modBars = vmods.slice(0,5).map(m=>{ const s=moduleStats(m); return `<div class="cardMod"><span class="cm-name" title="${esc(m.name)}">${esc(m.name)}</span><span class="pbar" title="เสร็จ ${s.donePct}% · กำลังทำ ${s.startedPct}%">${barSeg(s)}</span><span class="cm-pct mono">${s.donePct}%</span></div>`; }).join("");
    return `<div class="card" data-open="${p.id}">
      <div class="stripe" style="background:${pc.chip}"></div>
      <div class="body">
        <div class="client">${esc(p.client||"")} ${p.code?("· "+esc(p.code)):""}</div>
        <h3>${esc(p.name)}</h3>
        <div class="stat"><span><b>${p.modules.length}</b> โมดูล</span><span><b>${nFeat}</b> ฟีเจอร์</span><span class="mono">${range}</span></div>
        ${cur ? `<div class="sumline"><div class="sumdate mono">อัปเดต ${esc(cur.date)}</div>${esc((cur.text||"").slice(0,150))}</div>` : ""}
        ${p.updatedAt ? `<div class="lastEdit mono">แก้ไขล่าสุด ${esc(fmtStamp(p.updatedAt))}</div>` : ""}
      </div>
      <div class="cardProg">
        <div class="cp-top"><span class="cp-lab">ความคืบหน้า</span><span class="grow"></span><span class="cp-pct mono">เสร็จ ${agg.donePct}% · ทำอยู่ ${agg.startedPct}%</span></div>
        <div class="pbar" title="เสร็จ ${agg.donePct}% · กำลังทำ ${agg.startedPct}% · ยังไม่เริ่ม ${agg.notPct}%">${barSeg(agg)}</div>
        ${vmods.length?`<div class="cardMods">${modBars}</div>`:""}
        ${vmods.length>5?`<div class="cardMore">+${vmods.length-5} โมดูลเพิ่มเติม</div>`:""}
      </div>
      <div class="foot">
        <span class="openhint">${IC.open} เปิดในหน้าต่างใหม่</span>
        <span class="grow"></span>
        <button class="iconbtn" data-act="editproj" data-id="${p.id}" title="แก้ไขโครงการ">${IC.edit}</button>
        <button class="iconbtn danger" data-act="delproj" data-id="${p.id}" title="ลบโครงการ">${IC.trash}</button>
      </div>
    </div>`;
  }).join("");

  el("app").innerHTML = `
    <div id="dash">
      <div class="dashHead">
        <img class="dashLogo" src="assets/logo-adeptio.png" alt="Adeptio" onerror="this.remove()"/>
        <div class="dashHeadText">
          <span class="eyebrow">Adeptio · Internal</span>
          <h1>Project Tracking</h1>
          <div class="sub">Dashboard กลางสำหรับทุกโครงการ — เปิดแต่ละโครงการเป็นหน้าต่าง/ลิงก์แยกเพื่อแชร์ให้ลูกค้า</div>
        </div>
      </div>
      <div class="dashWrap">
        <div class="dashBarRow">
          <button class="btn primary" id="btnNewProj">${IC.plus}<span>โครงการใหม่</span></button>
          <span class="count">${ps.length} โครงการ</span>
          <span class="grow"></span>
          <button class="btn" id="btnBackup">${IC.cloud}<span>สำรอง / กู้คืนข้อมูล</span></button>
        </div>
        <div class="grid">
          ${cards}
          <div class="card newCard" id="btnNewProj2"><div class="plus">${IC.plus}</div><div>สร้างโครงการใหม่</div></div>
        </div>
      </div>
    </div>`;

  el("btnNewProj").onclick = ()=>projectModal();
  el("btnNewProj2").onclick = ()=>projectModal();
  el("btnBackup").onclick = ()=>backupModal();
  document.querySelectorAll('.card[data-open]').forEach(c=>{
    c.addEventListener('click', e=>{ if(e.target.closest('[data-act]')) return; openProjectWindow(c.dataset.open); });
  });
  document.querySelectorAll('[data-act="editproj"]').forEach(b=> b.onclick = e=>{ e.stopPropagation(); projectModal(b.dataset.id); });
  document.querySelectorAll('[data-act="delproj"]').forEach(b=> b.onclick = e=>{
    e.stopPropagation();
    const p=DB.projects.find(x=>x.id===b.dataset.id);
    if(confirm(`ลบโครงการ “${p.name}” ทั้งหมด? การลบไม่สามารถย้อนกลับได้`)){
      if(DB.notes) delete DB.notes[b.dataset.id];  // v1.0.5 F2: prune the project's notes in the same mutation
      DB.projects = DB.projects.filter(x=>x.id!==b.dataset.id); Store.save(); renderDashboard(); toast("ลบโครงการแล้ว");
    }
  });
}

function projectModal(id){
  const editing = id ? DB.projects.find(p=>p.id===id) : null;
  let color = editing ? editing.color : (DB.projects.length % PALETTE.length);
  const sw = PALETTE.map((p,i)=>`<div class="swatch ${i===color?'on':''}" data-c="${i}" style="background:${p.chip}"></div>`).join("");
  openModal(`
    <h2>${editing?"แก้ไขโครงการ":"สร้างโครงการใหม่"}</h2>
    <div class="msub">${editing?"ปรับข้อมูลโครงการ":"โครงการใหม่จะมี Gantt และลิงก์แยกของตัวเอง"}</div>
    <div class="field"><label>ชื่อโครงการ · Project name</label><input type="text" id="pm_name" value="${editing?esc(editing.name):""}" placeholder="เช่น YSC — Inventory & Procurement"/></div>
    <div class="field"><label>ลูกค้า · Client</label><input type="text" id="pm_client" value="${editing?esc(editing.client||""):""}" placeholder="เช่น Yongcharoen Group"/></div>
    <div class="field"><label>รหัส · Code</label><input type="text" id="pm_code" value="${editing?esc(editing.code||""):""}" placeholder="เช่น YSC-IP"/></div>
    <div class="field"><label>สี · Colour</label><div class="swatches" id="pm_sw">${sw}</div></div>
    <div class="modActsRow"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" id="pm_save">${editing?"บันทึก":"สร้างโครงการ"}</button></div>`);
  el("modalRoot").querySelectorAll('#pm_sw .swatch').forEach(s=> s.onclick=()=>{ color=+s.dataset.c; el("modalRoot").querySelectorAll('#pm_sw .swatch').forEach(x=>x.classList.toggle('on',x===s)); });
  el("pm_save").onclick = ()=>{
    const name=el("pm_name").value.trim()||"โครงการใหม่", client=el("pm_client").value.trim(), code=el("pm_code").value.trim();
    if(editing){ editing.name=name; editing.client=client; editing.code=code; editing.color=color; editing.updatedAt=nowIso(); } // v1.0.5 F1: PID is null on the dashboard, so this modal stamps its own target
    else {
      const slug=(code||name).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||("proj-"+_seq);
      let pid=slug, n=2; while(DB.projects.some(p=>p.id===pid)){ pid=slug+"-"+n; n++; }
      DB.projects.push({ id:pid, name, client, code, color, createdAt:iso(today()), updatedAt:nowIso(),
        customCols:[], progressOrder:[], summary:{current:{id:nid(),date:iso(today()),text:""},history:[]}, modules:[], docVer:2 }); // v1.0.4: new projects are already tree-shaped
    }
    Store.save(); closeModal(); renderDashboard(); toast(editing?"บันทึกแล้ว":"สร้างโครงการแล้ว");
  };
}

/* =====================  PROJECT VIEW SHELL  ===================== */
function renderProject(){
  const P = proj();
  ui.tab = "summary"; // landing page
  el("app").innerHTML = `
  <div id="proj" data-tab="summary">
    <div id="topbar">
      <div class="brand">
        <img class="brandMark" src="assets/icon-adeptio.png" alt="" onerror="this.remove()"/>
        <div class="brandText"><h1 id="pName">${esc(P.name)}</h1><span class="meta" id="metaLine">—</span></div>
      </div>
      <nav class="tabNav" role="tablist">
        <button class="tabBtn" data-tab="summary" title="สถานะและสรุปโครงการ">${IC.doc}<span>สถานะและสรุป</span></button>
        <button class="tabBtn" data-tab="timeline" title="ไทม์ไลน์และ Gantt">${IC.gantt}<span>ไทม์ไลน์</span></button>
      </nav>
      <div class="spring"></div>
      <div class="toolgroup">
        <div class="seg" id="themeSeg" role="group" aria-label="ธีม">
          <span class="lbl">ธีม</span>
          <button data-theme-set="auto" title="อัตโนมัติ — ตามระบบ">อัตโนมัติ</button>
          <button data-theme-set="light" title="สว่าง">สว่าง</button>
          <button data-theme-set="dark" title="มืด">มืด</button>
        </div>
      </div>
      <div class="toolgroup tlOnly">
        <span class="gl">Scroll</span>
        <div class="seg"><button id="colLeft" title="เลื่อนคอลัมน์ซ้าย">◀</button><span class="lbl">Cols</span><button id="colRight" title="เลื่อนคอลัมน์ขวา">▶</button></div>
        <div class="seg"><button id="chLeft" title="เลื่อนชาร์ตซ้าย">◀</button><span class="lbl">Chart</span><button id="chRight" title="เลื่อนชาร์ตขวา">▶</button></div>
      </div>
      <div class="toolgroup tlOnly">
        <div class="seg"><span class="lbl">Zoom</span><button data-zoom="day">Day</button><button data-zoom="week">Week</button><button data-zoom="month">Month</button></div>
        <div class="seg zoomCtl"><button id="zoomOut" title="ซูมออก">−</button><span class="lbl" id="zoomReadout">— เดือน</span><button id="zoomIn" title="ซูมเข้า">+</button><button id="zoomFit" title="พอดี ~9 เดือน">พอดี</button></div>
        <div class="seg"><button data-cal="CE" class="on">ค.ศ.</button><button data-cal="BE">พ.ศ.</button></div>
        <button class="btn sm" id="btnToday">Today</button>
      </div>
      <div class="toolgroup">
        <span class="detailsWrap">
          <button class="btn sm details${P.detailsUrl?'':' gray'}" id="btnDetails" title="${P.detailsUrl?esc(P.detailsUrl):'ยังไม่ได้ตั้งค่า URL — คลิกเพื่อเพิ่มลิงก์'}">${IC.link}<span>รายละเอียด</span></button>
          <button class="iconbtn detailsEdit" id="btnDetailsEdit" title="แก้ไข / ตั้งค่า URL">${IC.edit}</button>
        </span>
      </div>
      <div class="toolgroup">
        <button class="btn sm" id="btnImport">${IC.imp}<span>Import</span></button>
        <button class="btn sm" id="btnExportXlsx">${IC.exp}<span>Export</span></button>
      </div>
      <div class="toolgroup tlOnly">
        <button class="btn sm" id="btnAddMod">${IC.plus}<span>Module</span></button>
        <button class="btn sm" id="btnAddCol">${IC.plus}<span>Column</span></button>
        <button class="btn sm" id="btnPrint">Print</button>
        <button class="btn sm primary" id="btnExportPng">PNG</button>
      </div>
      <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none" />
    </div>
    <div id="projBody"></div>
  </div>`;
  wireProjectControls();
  renderTab("summary");
}

/* board markup string (Timeline tab) */
function boardHtml(){
  return `
    <div id="board">
      <div id="leftScroll"><div class="headRow" id="leftHead"></div><div id="leftBody"></div></div>
      <div id="splitter" title="ลากเพื่อปรับความกว้างของคอลัมน์ (ดูรายละเอียดคอลัมน์)"></div>
      <div id="rightScroll">
        <div class="headRow"><div id="axis"></div></div>
        <div id="bars"><div id="gridLayer"></div><div id="rowsLayer"></div>
          <div id="empty">${ic('<path d="M4 6h10M4 12h7M4 18h13"/>')}<div>ยังไม่มีข้อมูล — กด <b>+ Module</b> เพื่อเริ่ม หรือ Import ไฟล์ Excel</div></div>
        </div>
      </div>
    </div>`;
}

/* switch between the two project pages */
function switchTab(tab){
  if(tab===ui.tab) return;
  if(ui.tab==="summary"){ // autosave the summary text before leaving
    const ta=el("sumText"); if(ta){ const P=proj(); P.summary.current.text=ta.value; const sd=el("sumDate"); if(sd&&sd.value) P.summary.current.date=sd.value; Store.save(); }
  }
  renderTab(tab);
}
function renderTab(tab){
  ui.tab = tab;
  const pr=el("proj"); if(pr) pr.dataset.tab=tab;
  document.querySelectorAll('.tabBtn').forEach(b=> b.classList.toggle('on', b.dataset.tab===tab));
  const body=el("projBody"); if(!body) return;
  if(tab==="timeline"){
    body.innerHTML = boardHtml();
    const P=proj(); if(P.leftW){ const ls=el("leftScroll"); if(ls) ls.style.width=P.leftW+"px"; }
    wireBoard();
    renderBoard();
    setTimeout(()=>{ const r=getRange(), t=today(), R=el("rightScroll"); if(R&&t>=r.start&&t<=r.end){ const x=daysBetween(r.start,t)*pxPerDay(); R.scrollLeft=Math.max(0,x-R.clientWidth/2);} },60);
  } else {
    body.innerHTML = `<div class="statusPage"><div class="statusInner"><div id="summaryPanel"></div></div></div>`;
    renderSummary();
  }
  updateMeta();
}
function wireBoard(){
  el("splitter").addEventListener('pointerdown', onSplitDown);
  const L=el("leftScroll"), R=el("rightScroll"); let syncing=false;
  L.onscroll=()=>{ hideTip(); if(syncing)return; syncing=true; R.scrollTop=L.scrollTop; syncing=false; };
  R.onscroll=()=>{ hideTip(); scheduleStickyLabels(); if(syncing)return; syncing=true; L.scrollTop=R.scrollTop; syncing=false; }; // rAF-throttled sliding labels + vertical pane sync
  const bd=el("board");
  if(bd){ bd.addEventListener('mouseover', onBoardOver); bd.addEventListener('mousemove', onBoardMove); bd.addEventListener('mouseleave', hideTip); }
}

function wireProjectControls(){
  document.querySelectorAll('.tabBtn').forEach(b=> b.onclick=()=> switchTab(b.dataset.tab));
  document.querySelectorAll('[data-theme-set]').forEach(b=> b.onclick=()=> setTheme(b.dataset.themeSet)); // §1.10 Auto/Light/Dark — persist + apply + re-render (theme applies globally via the root attribute)
  applyTheme();                                                                                          // re-stamp the root + light the active theme button for this freshly-built toolbar
  document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=> applyZoom(PRESET_PPD[b.dataset.zoom]));   // preset → exact PPD, centred; syncZoomUI drives the active state
  { const zi=el("zoomIn"), zo=el("zoomOut"), zf=el("zoomFit");
    if(zi) zi.onclick=()=> applyZoom(pxPerDay()*1.35);   // §1.8 step ×1.35, centred on the viewport midpoint
    if(zo) zo.onclick=()=> applyZoom(pxPerDay()/1.35);   // step ÷1.35
    if(zf) zf.onclick=()=> applyZoom(fitPpd()); }         // reset = fit ≈ 9 months
  document.querySelectorAll('[data-cal]').forEach(b=>b.onclick=()=>{ ui.cal=b.dataset.cal; document.querySelectorAll('[data-cal]').forEach(x=>x.classList.toggle('on',x===b)); updateMeta(); if(ui.tab==="timeline") renderTimeline(); });
  el("btnToday").onclick = ()=>{ const R=el("rightScroll"); if(!R) return; const r=getRange(), t=today(); if(t<r.start||t>r.end){ toast("วันนี้อยู่นอกช่วงของแผน"); return;} const x=daysBetween(r.start,t)*pxPerDay(); R.scrollTo({left:Math.max(0,x-R.clientWidth/2),behavior:'smooth'}); };
  el("colLeft").onclick = ()=>{ const e2=el("leftScroll"); if(e2) e2.scrollBy({left:-220,behavior:'smooth'}); };
  el("colRight").onclick = ()=>{ const e2=el("leftScroll"); if(e2) e2.scrollBy({left:220,behavior:'smooth'}); };
  el("chLeft").onclick = ()=>{ const e2=el("rightScroll"); if(e2) e2.scrollBy({left:-300,behavior:'smooth'}); };
  el("chRight").onclick = ()=>{ const e2=el("rightScroll"); if(e2) e2.scrollBy({left:300,behavior:'smooth'}); };
  el("btnAddMod").onclick = ()=> moduleModal();
  el("btnAddCol").onclick = ()=> columnModal();
  el("btnImport").onclick = ()=> el("fileInput").click();
  el("fileInput").onchange = onImportFile;
  el("btnExportXlsx").onclick = exportXlsx;
  el("btnExportPng").onclick = exportPng;
  el("btnPrint").onclick = ()=> window.print();
  const bd=el("btnDetails"); if(bd) bd.onclick=()=>{ const P=proj(); if(P.detailsUrl) window.open(P.detailsUrl,"_blank","noopener"); else detailsModal(); };
  const bde=el("btnDetailsEdit"); if(bde) bde.onclick=()=> detailsModal();
}

/* ----- vertical splitter: resize the column pane ----- */
let split=null;
function onSplitDown(e){
  e.preventDefault();
  const ls=el("leftScroll");
  split={ startX:e.clientX, startW:ls.getBoundingClientRect().width };
  el("splitter").classList.add('drag'); document.body.style.userSelect='none'; document.body.style.cursor='col-resize';
  window.addEventListener('pointermove', onSplitMove); window.addEventListener('pointerup', onSplitUp);
}
function onSplitMove(e){
  if(!split) return;
  const boardW=el("board").getBoundingClientRect().width;
  let w=split.startW + (e.clientX - split.startX);
  w=Math.max(260, Math.min(w, boardW-260));
  el("leftScroll").style.width=w+"px";
}
function onSplitUp(){
  window.removeEventListener('pointermove', onSplitMove); window.removeEventListener('pointerup', onSplitUp);
  if(!split) return;                                 // idempotent: a second invocation is a safe no-op
  document.body.style.userSelect=''; document.body.style.cursor=''; el("splitter").classList.remove('drag');
  const P=proj(); if(P){ P.leftW=Math.round(el("leftScroll").getBoundingClientRect().width); Store.save(); }
  split=null;
  syncZoomUI();                                      // H2: the splitter changes #rightScroll.clientWidth without a re-render → refresh the months-in-view readout (no re-render)
}

/* =====================  STATUS & SUMMARY  ===================== */
function renderSummary(){
  const P = proj(), cur = P.summary.current;
  el("summaryPanel").innerHTML = `
    <div class="sumGrid"><div class="sumLeft">
      <div class="sumHeadRow">
        <span class="eyebrow">Project Status</span>
        <span class="lab">สรุปสถานะโครงการ</span>
        <span class="grow"></span>
        <span class="sumDateWrap">วันที่อัปเดต <input type="date" id="sumDate" value="${esc(cur.date||iso(today()))}"/></span>
        <button class="btn sm" id="sumNotes" title="โน้ตโครงการ (ธุรกิจ / เทคนิค)">${IC.note}<span>โน้ต<span id="sumNotesBadge"${notesCount(P.id)?"":' style="display:none"'}> (<span id="sumNotesCount">${notesCount(P.id)}</span>)</span></span></button>
        <button class="btn sm" id="goTimeline" title="ไปหน้าไทม์ไลน์และ Gantt">ไทม์ไลน์โครงการ ${IC.arrow}</button>
      </div>
      <div class="sumStamp mono" id="statusStamp">${P.updatedAt ? "แก้ไขล่าสุด "+esc(fmtStamp(P.updatedAt)) : ""}</div>
      <textarea id="sumText" maxlength="1000" placeholder="พิมพ์สรุปสถานะล่าสุด (สูงสุด 1,000 ตัวอักษร)…">${esc(cur.text||"")}</textarea>
      <div class="sumMeta">
        <span class="counter" id="sumCount"></span>
        <span class="grow"></span>
        <button class="btn sm" id="sumSave">บันทึก</button>
        <button class="btn sm" id="sumNew" title="เก็บฉบับปัจจุบันเข้าประวัติ แล้วเริ่มฉบับใหม่">＋ อัปเดตใหม่</button>
        <button class="btn sm" id="sumHist">${IC.hist}<span>ประวัติ (${P.summary.history.length+1})</span></button>
      </div>
      <div id="progressPanel"></div>
    </div></div>`;
  const ta=el("sumText"), ctr=el("sumCount");
  const upd=()=>{ ctr.textContent=ta.value.length+" / 1000"; ctr.classList.toggle('warn', ta.value.length>=950); };
  upd(); ta.oninput=upd;
  ta.onblur = ()=>{ if(cur.text!==ta.value){ cur.text=ta.value; Store.save(); } }; // FIX: persist unsaved summary text on blur (no toast) so navigation never drops it
  el("sumSave").onclick = ()=>{ cur.text=ta.value; cur.date=el("sumDate").value||cur.date; Store.save(); toast("บันทึกสรุปแล้ว"); }; // v1.0.5 F1: manual date-only stamp dropped — Store.save() stamps centrally
  el("sumDate").onchange = ()=>{ cur.date=el("sumDate").value; Store.save(); };
  el("sumNew").onclick = ()=>{
    cur.text=ta.value; cur.date=el("sumDate").value||cur.date;
    P.summary.history.unshift({id:nid(), date:cur.date, text:cur.text});
    P.summary.current={id:nid(), date:iso(today()), text:""};
    Store.save(); renderSummary(); toast("เก็บเข้าประวัติแล้ว เริ่มอัปเดตใหม่");
  };
  el("sumHist").onclick = ()=>{ if(cur.text!==ta.value){ cur.text=ta.value; Store.save(); } location.hash="project="+PID+"&view=history"; }; // FIX: save current summary text before hash-nav to the history overlay
  const gt=el("goTimeline"); if(gt) gt.onclick=()=> switchTab("timeline");
  const nb=el("sumNotes"); if(nb) nb.onclick=()=>{ if(cur.text!==ta.value){ cur.text=ta.value; Store.save(); } openNotes(); }; // v1.0.5 F2: persist in-flight summary text before opening the popup
  renderProgress();
}

/* ----- Project Status: progress panel (overall % + per-module bars) ----- */
function renderProgress(){
  const box=el("progressPanel"); if(!box) return;
  const P=proj();
  const mods=progressModules(P);
  const agg=aggregateStats(mods);
  const hidden=P.modules.filter(m=>m.hideProgress);
  let html=`
    <div class="progHead"><span class="lab">ความคืบหน้า</span><span class="grow"></span><span class="mono" style="font-size:13px;font-weight:600;color:var(--ink)">${agg.donePct}%</span></div>
    <div class="progOverall">
      <div class="pbar big" title="เสร็จ ${agg.donePct}% · กำลังทำ ${agg.startedPct}% · ยังไม่เริ่ม ${agg.notPct}%">${barSeg(agg)}</div>
      <div class="progLegend">
        <span><span class="sw done"></span>เสร็จ <b>${agg.donePct}%</b> (${agg.done})</span>
        <span><span class="sw prog"></span>กำลังทำ <b>${agg.startedPct}%</b> (${agg.started})</span>
        <span><span class="sw track"></span>ยังไม่เริ่ม <b>${agg.notPct}%</b> (${agg.notStarted})</span>
        <span class="grow"></span><span>รวม <b>${agg.total}</b> งาน</span>
      </div>
    </div>`;
  if(mods.length){
    const head=`<div class="kpiRow kpiHead">
      <span class="kc kc-name">โมดูล</span>
      <span class="kc kc-bar">ความคืบหน้า (อัตโนมัติ)</span>
      <span class="kc kc-num">เป้าหมาย&nbsp;%</span>
      <span class="kc kc-num">จริง&nbsp;%</span>
      <span class="kc kc-state">สถานะ</span>
      <span class="kc kc-detail">รายละเอียดสถานะ</span>
      <span class="kc kc-remark">หมายเหตุ</span>
      <span class="kc kc-x"></span>
    </div>`;
    const rows=mods.map(m=>{
      const s=moduleStats(m), k=kpiOf(m), st=kpiState(m,s);
      const tip=`เสร็จ ${s.donePct}% · กำลังทำ ${s.startedPct}% · ยังไม่เริ่ม ${s.notPct}% (${s.total} งาน)`;
      // §4: progress lists TOP-LEVEL containers only (progressModules → root nodes); the v1.0.3 "↳" sub rows are gone.
      return `<div class="kpiRow progRow" data-mid="${m.id}">
        <span class="kc kc-name"><span class="pgrip" data-act="progdrag" title="ลากเพื่อจัดลำดับการแสดงผล">${IC.grip}</span><span class="pmName" title="${esc(m.name)}">${esc(m.name)}</span></span>
        <span class="kc kc-bar"><span class="pbar" title="${tip}">${barSeg(s)}</span><span class="kc-auto mono" title="${tip}">${s.donePct}%</span></span>
        <span class="kc kc-num"><input type="number" class="kpiNum" min="0" max="100" step="5" data-f="target" data-mid="${m.id}" value="${k.target==null?'':k.target}" placeholder="—"/></span>
        <span class="kc kc-num"><input type="number" class="kpiNum" min="0" max="100" step="5" data-f="actual" data-mid="${m.id}" value="${k.actual==null?'':k.actual}" placeholder="${s.donePct}"/></span>
        <span class="kc kc-state"><span class="kpiBadge ${st.cls}" data-badge="${m.id}">${st.label}</span><select class="kpiSel" data-f="state" data-mid="${m.id}"><option value="auto" ${k.state==='auto'?'selected':''}>อัตโนมัติ</option><option value="ontrack" ${k.state==='ontrack'?'selected':''}>ตามแผน</option><option value="delay" ${k.state==='delay'?'selected':''}>ล่าช้า</option><option value="block" ${k.state==='block'?'selected':''}>ติดปัญหา</option><option value="done" ${k.state==='done'?'selected':''}>เสร็จ</option></select></span>
        <span class="kc kc-detail"><input type="text" class="kpiText" data-f="detail" data-mid="${m.id}" value="${esc(k.detail||'')}" placeholder="รายละเอียดสถานะ…"/></span>
        <span class="kc kc-remark"><input type="text" class="kpiText" data-f="remark" data-mid="${m.id}" value="${esc(k.remark||'')}" placeholder="หมายเหตุ…"/></span>
        <span class="kc kc-x"><button class="pmDel" data-act="proghide" data-mid="${m.id}" title="ซ่อนโมดูลนี้">${IC.x}</button></span>
      </div>`;
    }).join("");
    html+=`<div class="kpiTableWrap"><div class="kpiTable">${head}${rows}</div></div>`;
  } else {
    html+=`<div class="progEmpty">ไม่มีโมดูลที่แสดง — ${hidden.length?"กดด้านล่างเพื่อแสดงอีกครั้ง":"เพิ่มโมดูลเพื่อดูความคืบหน้า"}</div>`;
  }
  if(hidden.length){
    html+=`<div class="progHidden"><span class="ph-lab">ซ่อนอยู่:</span>`+ hidden.map(m=>`<button class="ph-chip" data-act="progshow" data-mid="${m.id}" title="แสดงกราฟโมดูลนี้อีกครั้ง">${esc(m.name)} ${IC.x}</button>`).join("")+`</div>`;
  }
  box.innerHTML=html;
  box.querySelectorAll('[data-act="proghide"]').forEach(b=> b.onclick=()=>{ const m=P.modules.find(x=>x.id===b.dataset.mid); if(m){ m.hideProgress=true; Store.save(); renderProgress(); } });
  box.querySelectorAll('[data-act="progshow"]').forEach(b=> b.onclick=()=>{ const m=P.modules.find(x=>x.id===b.dataset.mid); if(m){ m.hideProgress=false; Store.save(); renderProgress(); } });
  box.querySelectorAll('.pgrip[data-act="progdrag"]').forEach(g=> g.addEventListener('pointerdown', onProgDragStart));
  box.querySelectorAll('.kpiNum,.kpiText,.kpiSel').forEach(inp=> inp.addEventListener('change', onKpiChange));
}

/* progress reorder (drag) */
let progDrag=null;
function clearProgMark(){ document.querySelectorAll('.progRow.pBefore,.progRow.pAfter').forEach(x=>x.classList.remove('pBefore','pAfter')); }
function mvProgGhost(e){ if(progDrag&&progDrag.ghost){ progDrag.ghost.style.left=(e.clientX+12)+"px"; progDrag.ghost.style.top=(e.clientY-10)+"px"; progDrag.ghost.style.pointerEvents='none'; } }
function onProgDragStart(e){
  e.preventDefault();
  const row=e.target.closest('.progRow'); if(!row) return;
  progDrag={ mid:row.dataset.mid, target:null, ghost:null };
  const g=document.createElement('div'); g.className='progGhost'; g.textContent=row.querySelector('.pmName').textContent;
  document.body.appendChild(g); progDrag.ghost=g; document.body.style.userSelect='none'; mvProgGhost(e);
  window.addEventListener('pointermove', onProgDragMove); window.addEventListener('pointerup', onProgDragUp);
}
function onProgDragMove(e){
  if(!progDrag) return; mvProgGhost(e);
  const under=document.elementFromPoint(e.clientX,e.clientY);
  const row=under&&under.closest?under.closest('.progRow'):null;
  clearProgMark(); progDrag.target=null;
  if(row && row.dataset.mid!==progDrag.mid){ const rc=row.getBoundingClientRect(); const before=e.clientY<rc.top+rc.height/2; progDrag.target={mid:row.dataset.mid,before}; row.classList.add(before?'pBefore':'pAfter'); }
}
function onProgDragUp(){
  window.removeEventListener('pointermove', onProgDragMove); window.removeEventListener('pointerup', onProgDragUp);
  if(!progDrag) return; document.body.style.userSelect=''; // idempotent: a second invocation is a safe no-op
  if(progDrag.ghost) progDrag.ghost.remove(); clearProgMark();
  const d=progDrag; progDrag=null; if(!d.target) return;
  const P=proj(); const order=normalizeProgressOrder(P).slice();
  const si=order.indexOf(d.mid); if(si<0) return; order.splice(si,1);
  let ti=order.indexOf(d.target.mid); if(ti<0) return; if(!d.target.before) ti+=1;
  order.splice(ti,0,d.mid); P.progressOrder=order; Store.save(); renderProgress();
}

/* history page (full overlay) */
function showHistory(){
  const P = proj();
  const entries=[{...P.summary.current,_cur:true}].concat(P.summary.history.map(h=>({...h})));
  const items=entries.map(e=>`
    <div class="histItem ${e._cur?'cur':''}" data-id="${e.id}" data-cur="${e._cur?1:0}">
      <div class="top">${e._cur?'<span class="badge">ปัจจุบัน</span>':''}<input type="date" value="${esc(e.date||'')}" data-f="date"/><span class="grow"></span>${e._cur?'':`<button class="iconbtn danger" data-act="delhist" title="ลบ">${IC.trash}</button>`}</div>
      <textarea maxlength="1000" data-f="text">${esc(e.text||"")}</textarea>
      <div class="row2"><span class="ctr"></span><span class="grow"></span><button class="btn sm" data-act="savehist">บันทึก</button></div>
    </div>`).join("");
  el("historyOverlay").innerHTML = `
    <div class="histHead"><div><h2>ประวัติสรุปสถานะ · Status History</h2><div class="sub">${esc(P.name)} — แก้ไขข้อความและวันที่ของแต่ละฉบับได้</div></div>
      <span class="spring"></span><button class="btn" id="histAdd">${IC.plus}<span>เพิ่มฉบับ</span></button><button class="btn primary" id="histClose">เสร็จสิ้น</button></div>
    <div class="histWrap"><div class="histList">${items}</div></div>`;
  el("historyOverlay").style.display="flex";
  el("historyOverlay").querySelectorAll('.histItem').forEach(it=>{
    const ta=it.querySelector('textarea'), ctr=it.querySelector('.ctr');
    const upd=()=>ctr.textContent=ta.value.length+" / 1000"; upd(); ta.oninput=upd;
    it.querySelector('[data-act="savehist"]').onclick=()=>{
      const id=it.dataset.id, isCur=it.dataset.cur==="1", date=it.querySelector('[data-f="date"]').value, text=ta.value;
      if(isCur){ P.summary.current.date=date; P.summary.current.text=text; }
      else { const h=P.summary.history.find(x=>x.id===id); if(h){ h.date=date; h.text=text; } }
      Store.save(); toast("บันทึกแล้ว");
    };
    const del=it.querySelector('[data-act="delhist"]');
    if(del) del.onclick=()=>{ P.summary.history=P.summary.history.filter(x=>x.id!==it.dataset.id); Store.save(); showHistory(); };
  });
  el("histAdd").onclick=()=>{ P.summary.history.unshift({id:nid(), date:iso(today()), text:""}); Store.save(); showHistory(); }; // newest-first, consistent with "＋ อัปเดตใหม่"
  el("histClose").onclick=()=>{ location.hash="project="+PID; };
}
function hideHistory(){ const h=el("historyOverlay"); if(h){ h.style.display="none"; h.innerHTML=""; } }

/* =====================  COLUMNS (order-driven) / RANGE  ===================== */
const BASE_COLDEFS = {
  name:        {key:"name",        label:"Feature",     w:190, kind:"feat"},
  description: {key:"description", label:"Description", w:200, kind:"text", ph:"เพิ่มคำอธิบาย…"},
  start:       {key:"start",       label:"Start",       w:116, kind:"date"},
  end:         {key:"end",         label:"End",         w:116, kind:"date"},
  status:      {key:"status",      label:"Status",      w:142, kind:"status"},
  remark:      {key:"remark",      label:"Remark",      w:150, kind:"text", ph:"หมายเหตุ…"},
};
const DEFAULT_ORDER = ["name","description","start","end","status","remark"];
function customKeys(){ return proj().customCols.map(c=>"c:"+c.id); }
function allCols(){
  const P=proj();
  let order = (P.colOrder && P.colOrder.length) ? P.colOrder.slice() : DEFAULT_ORDER.concat(customKeys());
  DEFAULT_ORDER.forEach(k=>{ if(!order.includes(k)) order.push(k); });
  customKeys().forEach(k=>{ if(!order.includes(k)) order.push(k); });
  const valid = new Set(DEFAULT_ORDER.concat(customKeys()));
  order = order.filter(k=>valid.has(k));
  P.colOrder = order;
  return order.map(k=>{
    let c;
    if(k.startsWith("c:")){ const cc=P.customCols.find(x=>("c:"+x.id)===k); c={key:k,label:cc.label,w:cc.w,kind:cc.kind,custom:cc.id,del:true}; }
    else c={...BASE_COLDEFS[k]};
    // local-only width override (ui.colW), namespaced per project — never written back to the doc/customCols
    const _pw=ui.colW && ui.colW[PID];               // FIX: read this project's widths only, so resizes don't bleed across projects
    if(_pw && _pw[k]!=null){ const ov=+_pw[k]; if(!isNaN(ov)) c.w=Math.max(60,Math.min(640,ov)); }
    return c;
  });
}
/* §1.8 continuous zoom. pxPerDay() is the SINGLE source of the day width (ui.ppd, clamped). tickMode()
   picks the axis/grid granularity from PPD so the axis stays legible across the whole range (the presets
   land on their old modes: 34→day, 11→week, 4.4→month). */
const pxPerDay = () => clampPpd(ui.ppd);
function tickMode(){ const p=pxPerDay(); return p>=18 ? "day" : (p>=6.2 ? "week" : "month"); }
/* §1.9 bar-label font curve: clamp(6.4, 6.2 + PPD×0.55, 11.5)px; the label is HIDDEN (status-dot only)
   when its computed size < 7.5px OR the bar is narrower than 34px. */
function barLabelPx(ppd){ ppd=(ppd==null?pxPerDay():ppd); return Math.max(6.4, Math.min(11.5, 6.2 + ppd*0.55)); }
function labelHidden(ppd, barW){ return barLabelPx(ppd) < 7.5 || barW < 34; }
/* §1.8 readout: months in view = viewportWidth / (PPD × 30.4). */
function monthsInView(){ const R=el("rightScroll"); const cw=R?R.clientWidth:0; return cw>0 ? cw/(pxPerDay()*30.4) : 0; }
function fitPpd(){ const R=el("rightScroll"); const cw=R?R.clientWidth:0; return cw>0 ? cw/(9*30.4) : PRESET_PPD.month; } // reset = fit ≈ 9 months
/* Refresh the zoom readout (Thai-first "N.N เดือน") + the preset buttons' active state for the current PPD. */
function syncZoomUI(){
  const ro=el("zoomReadout"); if(ro){ const m=monthsInView(); ro.textContent = m>0 ? (Math.round(m*10)/10).toFixed(1)+" เดือน" : "— เดือน"; }
  const ppd=pxPerDay();
  document.querySelectorAll('[data-zoom]').forEach(b=>{ const pv=PRESET_PPD[b.dataset.zoom]; b.classList.toggle('on', pv!=null && Math.abs(clampPpd(pv)-ppd)<1e-6); });
}
/* Centre-preserving zoom (§1.8): the date at the horizontal centre of #rightScroll stays centred after the
   re-render — newScrollLeft = centreDay×newPPD − clientWidth/2 (clamped ≥0). Used by −/+, the presets and
   reset. renderTimeline rebuilds bars, so label transforms start clean (R10); we re-apply them post-scroll. */
function applyZoom(targetPpd){
  if(_dragging) return;                                // H3a: a zoom re-render mid bar-drag would rebuild #rowsLayer and detach the dragged .bar → ignore zoom while a drag/resize is live
  const R=el("rightScroll"), oldPpd=pxPerDay(); let centreDay=null, cw=0;
  if(R){ cw=R.clientWidth; centreDay=(R.scrollLeft+cw/2)/oldPpd; }
  ui.ppd=clampPpd(targetPpd); saveUi();
  renderTimeline();                                    // rebuilds axis/grid/bars at the new PPD (and calls syncZoomUI)
  if(R && centreDay!=null){ R.scrollLeft=Math.max(0, centreDay*pxPerDay() - cw/2); updateStickyLabels(); } // re-centre, then re-apply post-shift sticky labels
}
function getRange(){
  let mn=null,mx=null;
  walkFeatures(proj(), f=>{ const s=parse(f.start),e=parse(f.end); if(!mn||s<mn)mn=s; if(!mx||e>mx)mx=e; }); // recursive over the whole tree
  if(!mn){ const t=today(); return {start:startOfMonth(addDays(t,-15)), end:endOfMonth(addDays(t,45))}; }
  return { start:startOfMonth(addDays(mn,-3)), end:endOfMonth(addDays(mx,3)) };
}
function updateMeta(){
  const P=proj(); if(!P) return; let nFeat=0; walkFeatures(P, ()=>nFeat++); const nMod=P.modules.length, r=getRange(); // nMod = top-level containers; nFeat = every descendant feature
  const ml=el("metaLine"); if(ml) ml.textContent=`${esc(P.client||"")} · ${nMod} โมดูล · ${nFeat} ฟีเจอร์ · ${monName(r.start.getMonth())} ${dispYear(r.start)} – ${monName(r.end.getMonth())} ${dispYear(r.end)}`;
}

/* =====================  RECURSIVE NODE TREE (v1.0.4)  =====================
   The v1.0.3 flat `P.modules[] + parentId + features[]` model is replaced by ONE
   recursive tree. Every node is a container or a feature:
     container := { id, kind:'container', name, description, color, collapsed, children:[node], ...unknown }
     feature   := { id, kind:'feature', name, description, fid, start, end, status, remark, custom:{}, ...unknown }
   `P.modules` holds root CONTAINERS only. `P.docVer===2` is stamped by migration.
   Every mutation flows through apply() (R2); rows/bars are addressed by data-nid (R1);
   both panes render from a single flatten(P) (R9). */

/* ---- MIGRATION (R-spec §2): v1 flat modules → recursive tree. Idempotent, one place. ---- */
function migrateDB(DB){
  if(DB && typeof DB==="object" && (!DB.notes || typeof DB.notes!=="object" || Array.isArray(DB.notes))) DB.notes={}; // v1.0.5 F2: additive, idempotent, NO docVer bump (spec §4.7)
  if(DB && Array.isArray(DB.projects)) DB.projects.forEach(migrateDoc);
  return DB;
}
function v1FeatureToNode(f){
  // Keep the existing (uid-minted) unique feature id as the node id; keep ALL unknown fields.
  const n = Object.assign({}, f);
  delete n.children;                                  // a v1 feature never has children
  n.kind = "feature";
  if(!n.id || typeof n.id!=="string") n.id = nid();   // mint only if missing (D5: features carry uid()-scheme nids)
  if(!n.custom || typeof n.custom!=="object") n.custom = {};
  return n;
}
function v1ModuleToContainer(m, childrenNodes){
  const n = Object.assign({}, m);
  delete n.features; delete n.parentId;               // features → children; parentId is dissolved into the tree
  n.kind = "container";
  n.collapsed = !!m.collapsed;
  n.children = childrenNodes;
  if(!n.id || typeof n.id!=="string") n.id = nid();   // D5: containers keep their existing v1.0.3 module id (progressOrder stays valid)
  return n;
}
function migrateDoc(P){
  if(!P || typeof P!=="object") return P;
  const mods = Array.isArray(P.modules)?P.modules:[];
  // Already v2 (stamped) OR already tree-shaped (kind/children present, e.g. a new project or a
  // stamp-less re-adopt): sanitize only. Re-running the v1 path here would drop `children`.
  if(P.docVer>=2 || mods.some(m=> m && (m.kind==="container" || m.kind==="feature" || Array.isArray(m.children)))){
    P.docVer=2; normalizeTree(P); return P;
  }
  // Sanitize parentId exactly like v1.0.3 normalizeModules step 1 (missing / self / sub-of-sub ⇒ treated as main).
  const ids=new Set(mods.map(m=>m&&m.id)), hadParent=new Set(mods.filter(m=>m&&m.parentId!=null).map(m=>m.id));
  const parentOf = m => { const pid=m.parentId; if(pid==null) return null; if(!ids.has(pid)||pid===m.id||hadParent.has(pid)) return null; return pid; };
  const roots=[];
  // Root modules keep display order; each root's features become feature children first, then
  // its parentId-children become container children (after the parent's own features).
  mods.forEach(m=>{ if(m && parentOf(m)===null) roots.push(m); });
  const out = roots.map(root=>{
    const featChildren = (Array.isArray(root.features)?root.features:[]).map(v1FeatureToNode);
    const subChildren = mods.filter(s=> s && parentOf(s)===root.id)
      .map(sub=> v1ModuleToContainer(sub, (Array.isArray(sub.features)?sub.features:[]).map(v1FeatureToNode)));
    return v1ModuleToContainer(root, featChildren.concat(subChildren));
  });
  P.modules = out;
  P.docVer = 2;                                         // stamp
  normalizeTree(P);                                     // enforce invariants (unique ids etc.)
  return P;
}

/* ---- NORMALIZE (R4): unique ids, kind sanity, root=containers, order-preserving single pass. ---- */
function normalizeTree(P){
  if(!P || typeof P!=="object") return P;
  if(!Array.isArray(P.modules)) P.modules=[];
  const seen=new Set();
  function fix(node){
    if(!node || typeof node!=="object") return;
    if(!node.id || typeof node.id!=="string" || seen.has(node.id)) node.id=nid();  // dupes / missing → re-id
    seen.add(node.id);
    if(node.kind!=="feature" && node.kind!=="container"){
      // F1: infer kind for a node lacking a valid one, in priority order (§2 transition compatibility):
      //   1) children[] present     → container (mirror nodes carry BOTH children+features — children WIN; the features mirror is never authority)
      //   2) else features[] present → v1-shape module injected by a still-open old tab: LIFT features[] → children (order preserved), consume the array
      //   3) else                   → leaf feature (as before)
      if(Array.isArray(node.children)) node.kind="container";
      else if(Array.isArray(node.features)){ node.kind="container"; node.children=node.features.map(v1FeatureToNode); delete node.features; } // consume features ONLY on this lift path
      else node.kind="feature";
    }
    if(node.kind==="feature"){
      if(Array.isArray(node.children) && node.children.length){                     // feature with children ⇒ becomes a container
        console.warn('normalizeTree: feature "'+(node.name||node.id)+'" had children — converting to container');
        node.kind="container";
      } else { if("children" in node) delete node.children; if(!node.custom||typeof node.custom!=="object") node.custom={}; }
    }
    if(node.kind==="container"){
      if(!Array.isArray(node.children)) node.children=[];
      node.collapsed=!!node.collapsed;
      node.children.forEach(fix);
    }
  }
  P.modules.forEach(fix);
  // F1: ROOT re-homing — a root node still carrying parentId whose target resolves to an existing
  // container ELSEWHERE in the tree is moved INTO that container's children (append) + parentId deleted;
  // any remaining parentId anywhere is deleted (the field is dissolved in v2). Order-preserving, idempotent.
  const contById=new Map(); walkTree(P.modules, n=>{ if(n && n.kind==="container") contById.set(n.id, n); });
  const rootsAfter=[];
  P.modules.forEach(node=>{
    const pid=node.parentId;
    if(pid!=null && pid!==node.id){
      const tgt=contById.get(pid);
      if(tgt && tgt!==node && !subtreeHas(node, tgt)){ delete node.parentId; tgt.children.push(node); return; } // re-homed → drops out of the root list (no cycle: tgt is not within node's own subtree)
    }
    if("parentId" in node) delete node.parentId;                              // root node with an unresolvable parentId → strip
    rootsAfter.push(node);
  });
  P.modules=rootsAfter;
  walkTree(P.modules, n=>{ if(n && "parentId" in n) delete n.parentId; });    // dissolve parentId anywhere else in the tree
  // Root holds containers ONLY: a stray root feature is wrapped into a recovery container (never dropped).
  const finalRoots=[]; let recovery=null;
  P.modules.forEach(node=>{
    if(node.kind==="container"){ finalRoots.push(node); }
    else {
      if(!recovery){ recovery={id:nid(),kind:"container",name:"(กู้คืน)",description:"",color:0,collapsed:false,children:[]}; seen.add(recovery.id); finalRoots.push(recovery); }
      recovery.children.push(node);
    }
  });
  P.modules=finalRoots;
  return P;
}

/* v1.0.5 F0: the v1.0.4 dual-write `features[]` mirror is GONE (it existed only so a still-open
   v1.0.3 tab could render a v2 doc during the transition). Stale `features` keys already stored
   in docs stay inert — the load path ignores them under docVer>=2 and the migration lift still
   consumes v1-shape docs restored from old backups (spec v1.0.5 §2, N1). */

/* ---- TREE WALK / ADDRESSING (R1) ---- */
function walkTree(nodes, fn, parent){ (nodes||[]).forEach((n,i)=>{ fn(n,parent||null,i); if(n && n.kind==="container") walkTree(n.children||[], fn, n); }); }
function subtreeHas(root, cand){ let f=false; walkTree([root], n=>{ if(n===cand) f=true; }); return f; } // true when cand is root itself or a descendant of root (cycle guard for re-homing)
function findNode(P, id){ if(!P||id==null) return null; let hit=null; walkTree(P.modules, n=>{ if(n && n.id===id) hit=n; }); return hit; }
function findParent(P, id){ if(!P||id==null) return null; let par=null, found=false; walkTree(P.modules, (n,parent)=>{ if(n && n.id===id){ par=parent; found=true; } }); return found?par:null; } // null parent ⇒ node is a root
function siblingsOf(P, id){ const par=findParent(P,id); return par ? par.children : P.modules; }
function walkFeatures(P, fn){ if(!P) return; (function rec(nodes){ (nodes||[]).forEach(n=>{ if(!n) return; if(n.kind==="feature") fn(n); else if(n.kind==="container") rec(n.children||[]); }); })(P.modules||[]); }
function containerFeatures(node){ const out=[]; if(!node) return out; (function rec(n){ (n.children||[]).forEach(c=>{ if(!c) return; if(c.kind==="feature") out.push(c); else if(c.kind==="container") rec(c); }); })(node); return out; } // every DESCENDANT feature
function directFeatures(node){ return node && Array.isArray(node.children) ? node.children.filter(c=>c && c.kind==="feature") : []; }
function countAll(node){ let n=0; if(node && node.kind==="container") walkTree(node.children||[], ()=>{ n++; }); return n; } // descendant node count (containers + features), for the cascade-delete confirm
function removeNode(P, id){ const par=siblingsOf(P,id); const i=par.findIndex(n=>n && n.id===id); if(i>=0){ const [g]=par.splice(i,1); return g; } return null; }
function revealInto(container){ if(container && container.kind==="container") container.collapsed=false; } // R6: inserting INTO a container auto-expands it
function prevSibling(P, id){ const sibs=siblingsOf(P,id); const i=sibs.findIndex(n=>n&&n.id===id); return i>0?sibs[i-1]:null; }
function nodeDepth(P, id){ let d=0, cur=findParent(P,id); while(cur){ d++; cur=findParent(P,cur.id); } return d; }

/* ---- SHARED PREDICATES (R5): ONE source of truth for BOTH the grip-menu disabled-states
   AND the hard guards inside every mutator. The menu only REFLECTS; the mutators re-check. ---- */
function canIndent(P, id){ const p=prevSibling(P,id); return !!(p && p.kind==="container"); }          // needs a previous SIBLING that is a container
function canOutdent(P, id){                                                                            // needs a parent, and NOT a feature at depth 1 (root holds containers only)
  const par=findParent(P,id); if(!par) return false;                                                   // already at root
  const node=findNode(P,id);
  if(node && node.kind==="feature" && !findParent(P,par.id)) return false;                             // depth-1 feature → outdent would land at root (illegal)
  return true;
}
function canDemote(P, id){ const n=findNode(P,id); return !!(n && n.kind==="container" && (!n.children || n.children.length===0) && findParent(P,id)!==null); } // G1: childless container AND non-root (root holds containers only — a root demote would be re-wrapped into a "(กู้คืน)" recovery container)
function canPromote(P, id){ const n=findNode(P,id); return !!(n && n.kind==="feature"); }              // any feature
function canAddChild(P, id){ const n=findNode(P,id); return !!(n && n.kind==="container"); }           // containers only

/* ---- SINGLE MUTATION GATE (R2) ----
   mutator(P) → normalizeTree(P) → Store.save() → renderBoard(). Returns the mutator's
   focus/flash descriptor (a nid) if it provides one. EVERY tree create/move/edit/delete
   goes through here — no direct Store.save() in ported tree paths. */
function apply(mutator, opts){
  const P=proj(); if(!P) return null;
  const r = mutator ? mutator(P) : null;
  normalizeTree(P);
  Store.save();
  if(opts && opts.fields && el("leftBody") && el("rowsLayer")){ // F2: non-structural FIELD edit → LIGHT render. Keep #leftBody (the focused editor + its listeners survive); refresh chart + meta + progress only.
    renderTimeline();                                  // recomputes flatten; runs applyWrap()/syncRowHeights() (reads the live grid) + updateStickyLabels()
    updateMeta();
    if(el("progressPanel")) renderProgress();
  } else {
    renderBoard();                                     // structural mutation (create/move/delete/promote/…) → full rebuild
  }
  if(r && r.focus) focusNode(r.focus);                 // focus a freshly-created feature's name cell
  if(r && r.flash) flashNode(r.flash);                 // R6: reveal-and-flash the moved/created row in BOTH panes
  return r || null;
}
function focusNode(id){
  const row = el("leftBody") && el("leftBody").querySelector('.featRow[data-nid="'+cssEsc(id)+'"]');
  if(row){ const tx=row.querySelector('.cell.feat .txt'); if(tx){ tx.focus(); if(window.getSelection){ const s=window.getSelection(); const rg=document.createRange(); rg.selectNodeContents(tx); rg.collapse(false); s.removeAllRanges(); s.addRange(rg); } } }
}
function cssEsc(s){ return String(s).replace(/["\\]/g,"\\$&"); }
/* R6 reveal-and-flash: after a structural render, pulse a transient violet highlight on the
   moved/created row in the LEFT pane AND its chart row (addressed by data-nid); removed on animationend. */
function flashNode(id){
  if(id==null) return; const sel='[data-nid="'+cssEsc(id)+'"]';
  const lb=el("leftBody"), rl=el("rowsLayer");
  const targets=[
    lb && lb.querySelector('.modRow'+sel), lb && lb.querySelector('.featRow'+sel),
    rl && rl.querySelector('.modBarRow'+sel), rl && rl.querySelector('.bar'+sel),
  ];
  targets.forEach(elm=>{ if(!elm) return; elm.classList.remove('flashRow'); void elm.offsetWidth; elm.classList.add('flashRow');
    elm.addEventListener('animationend', ()=>elm.classList.remove('flashRow'), {once:true}); });
}

/* ---- FLATTEN (R9): ONE visible-row list feeds BOTH panes. Row kinds:
   'container' (46px modRow/modBarRow) · 'feature' (42px featRow/barRow) · 'add' (32px addFeat/spacer).
   depth = tree depth (root containers 0). lastChild = node is the last child of a non-root parent. ---- */
function flatten(P){
  const rows=[];
  (function rec(nodes, depth, parent){
    (nodes||[]).forEach((n,idx)=>{
      if(!n) return;
      const lastChild = !!parent && idx===nodes.length-1;
      if(n.kind==="feature"){ rows.push({type:"feature", node:n, depth, parent, lastChild}); }
      else {
        rows.push({type:"container", node:n, depth, parent, lastChild});
        if(!n.collapsed){ rec(n.children||[], depth+1, n); rows.push({type:"add", node:n, depth, parent, lastChild}); }
      }
    });
  })(P.modules||[], 0, null);
  return rows;
}

/* =====================  RENDER BOARD  ===================== */
function renderBoard(){
  const P=proj(); if(!P) return;
  normalizeTree(P);
  if(!el("leftBody")){ if(el("progressPanel")) renderProgress(); updateMeta(); return; } // not on the timeline tab → refresh panels only
  const rows=flatten(P);                                // R9: compute the visible-row list ONCE, feed BOTH panes
  renderGrid(rows); renderTimeline(rows); updateMeta();
  if(el("progressPanel")) renderProgress();
}

/* ---- GRIP MENU (spec §1.1, D7): the slide-open pill REPLACES the v1.0.3 hover clusters
   (.modActs / .rowActs). It opens on GRIP hover / focus-within only (never plain row hover),
   slides open to the right, and its buttons only REFLECT the shared predicates (R5) — the
   mutators re-decide. The grip keeps its drag data-act (moddrag/rowdrag) + _DRAG_SEL class. ---- */
/* G6a/§1.9 stepped shading: set INLINE per row (no lvl1..6 class clamp — the spec formula is unbounded).
   §1.10 theme channel: emit BOTH the light and dark shade inline; styles.css resolves --shade:var(--shade-l)
   by default and --shade:var(--shade-d) under [data-theme="dark"], so pane-parity holds in BOTH themes
   with NO re-render on switch. Light = rgba(146,65,255, .03×depth) · Dark = rgba(169,112,255, .055×depth).
   depth 0 ⇒ no tint (falls back to the CSS default --shade-l/-d: transparent). */
function shadeVar(v){
  const d=Math.max(0, v|0); if(d<=0) return "";
  const la=3*d, da=55*d;                                                           // light .03×depth · dark .055×depth (thousandths for the dark channel avoid float drift)
  const lv=la>=100 ? "1" : "."+String(la).padStart(2,"0");
  const dv=da>=1000 ? "1" : "."+String(da).padStart(3,"0");
  return "--shade-l:rgba(146,65,255,"+lv+");--shade-d:rgba(169,112,255,"+dv+");";
}
function gmBtn(act, icon, title, o){ o=o||{}; return `<button type="button" class="gm${o.danger?" danger":""}" data-act="${act}" title="${esc(title)}"${o.disabled?" disabled":""}>${icon}</button>`; }
function gripMenu(P, node, depth){
  const id=node.id, ind=canIndent(P,id), outd=canOutdent(P,id);
  if(node.kind==="container"){
    const editT = depth===0 ? "แก้ไขโมดูล" : "แก้ไขโมดูลย่อย";                                          // depth naming (§1.2)
    return `<div class="gripMenu">`
      + `<span class="modGrip" data-act="moddrag" title="ลากเพื่อย้ายโมดูล">${IC.grip}</span>`
      + `<div class="gripPill" role="toolbar">`
        + gmBtn("modup",  IC.up,      "เลื่อนโมดูลขึ้น")
        + gmBtn("moddown",IC.down,    "เลื่อนโมดูลลง")
        + `<span class="gsep"></span>`
        + gmBtn("outdent",IC.outdent, "เลื่อนออก (Outdent)", {disabled:!outd})
        + gmBtn("indent", IC.indent,  "เลื่อนเข้า (Indent)",  {disabled:!ind})
        + `<span class="gsep"></span>`
        + gmBtn("addfeat",IC.plus,    "เพิ่มฟีเจอร์")
        + gmBtn("promote",IC.promote, "เปลี่ยนเป็นฟีเจอร์ (Demote)", {disabled:!canDemote(P,id)})
        + gmBtn("editmod",IC.edit,    editT)
        + gmBtn("delmod", IC.trash,   "ลบโมดูล", {danger:true})
      + `</div></div>`;
  }
  return `<div class="gripMenu">`
    + `<span class="grip" data-act="rowdrag" title="ลากเพื่อย้ายแถว">${IC.grip}</span>`
    + `<div class="gripPill" role="toolbar">`
      + gmBtn("up",     IC.up,      "เลื่อนขึ้น")
      + gmBtn("down",   IC.down,    "เลื่อนลง")
      + `<span class="gsep"></span>`
      + gmBtn("outdent",IC.outdent, "เลื่อนออก (Outdent)", {disabled:!outd})
      + gmBtn("indent", IC.indent,  "เลื่อนเข้า (Indent)",  {disabled:!ind})
      + `<span class="gsep"></span>`
      + gmBtn("promote",IC.promote, "เปลี่ยนเป็นโมดูล (Promote)")
      + gmBtn("editfeat",IC.edit,   "แก้ไขฟีเจอร์")
      + gmBtn("delfeat",IC.trash,   "ลบฟีเจอร์", {danger:true})
    + `</div></div>`;
}
/* Measure each rendered pill's real width → per-row --railW (the exact distance the row content
   slides right so the open menu never overlays it). Batched reads then writes to avoid layout thrash. */
function sizeGripRails(){
  const lb=el("leftBody"); if(!lb) return;
  const pills=[...lb.querySelectorAll('.gripPill')];
  const ws=pills.map(p=>p.offsetWidth);
  pills.forEach((p,i)=>{ const row=p.closest('.modRow,.featRow'); if(row) row.style.setProperty('--railW', ws[i]+'px'); });
}

function renderGrid(rows){
  const P=proj(), cols=allCols();
  rows = rows || flatten(P);
  el("leftHead").innerHTML = cols.map(c=>{
    const wrapBtn = c.key==="description" ? `<button class="colTool wrapToggle ${ui.wrapTxt?'on':''}" data-act="wraptoggle" data-tip="ตัดข้อความ (Wrap) — คลิกเพื่อสลับ">${IC.wrap}</button>` : "";
    const delBtn = c.del ? `<button class="delcol" data-act="delcol" data-col="${c.custom}" title="ลบคอลัมน์">${IC.x}</button>` : "";
    return `<div class="colHead${c.key==="description"?" hasTool":""}${c.del?" hasDel":""}" data-key="${c.key}" style="width:${c.w}px" data-tip="ลากเพื่อย้ายคอลัมน์ · ลากขอบขวาเพื่อปรับความกว้าง"><span class="colLabel">${esc(c.label)}</span>${wrapBtn}${delBtn}<span class="colResize" data-act="colresize" data-tip="ลากเพื่อปรับความกว้างคอลัมน์"></span></div>`;
  }).join("");
  const gw = cols.reduce((a,c)=>a+c.w,0);
  let html="";
  rows.forEach(row=>{
    const n=row.node, depth=row.depth;
    if(row.type==="container"){
      const p=PALETTE[(n.color||0)%PALETTE.length];
      const isSub=depth>=1;                                             // any depth ≥1 is a "sub-module" visually
      const subEndCls=(isSub && row.lastChild && n.collapsed)?" subEnd":""; // collapsed last child → its modRow is the rail terminus
      const modCls="modRow"+(n.collapsed?" collapsed":"")+(isSub?" subMod":"")+subEndCls;
      html += `<div class="${modCls}" style="width:${gw}px;--lvl:${depth};${shadeVar(depth)}" data-nid="${esc(n.id)}">
      ${gripMenu(P, n, depth)}
      <div class="modMain">
        <span class="caret" data-act="toggle">${IC.caret}</span>
        <span class="chip" style="background:${p.chip}"></span>
        <span class="modText"><span class="modName" contenteditable="true" data-field="modname" spellcheck="false">${esc(n.name)}</span>${n.description?`<span class="modDesc" data-tip="${esc(n.description)}">${esc(n.description)}</span>`:""}</span>
        <span class="count">${containerFeatures(n).length}</span>
      </div></div>`;
    } else if(row.type==="feature"){
      const f=n, isSub=depth>=2;                                        // feature under a sub-container (depth ≥2) → subScope
      // G2: featRow mirrors modRow — the grip menu is a DIRECT child at the row front (hover anchor +
      // drag handle, never overlaid), and .rowMain (the WHOLE cell strip) slides right by the measured
      // --railW when the menu opens. The pill occupies the vacated space to the left; nothing overlaps.
      html += `<div class="featRow${isSub?' subScope':''}" style="--lvl:${depth};${shadeVar(depth)}" data-nid="${esc(f.id)}">`;
      html += gripMenu(P, f, depth);
      html += `<div class="rowMain">`;
      cols.forEach(c=>{
        if(c.kind==="feat"){
          html += `<div class="cell feat" style="width:${c.w}px"><span class="txt" contenteditable="true" data-field="name" spellcheck="false" data-ph="ตั้งชื่อฟีเจอร์…">${f.fid?`<span class="fid">${esc(f.fid)}</span>`:""}${esc(f.name)}</span></div>`;
        } else if(c.kind==="date"){
          const dval=c.custom?((f.custom&&f.custom[c.custom])||""):(f[c.key]||"");
          html += `<div class="cell" style="width:${c.w}px"><input type="date" value="${esc(dval)}" data-nid="${esc(f.id)}" data-field="${c.key}" /></div>`;
        } else if(c.kind==="status"){
          const st=stById(f.status);
          const opts=STATUS.map(s=>`<option value="${s.id}" ${s.id===f.status?'selected':''}>${s.th}</option>`).join("");
          html += `<div class="cell" style="width:${c.w}px"><select class="statusSel" data-nid="${esc(f.id)}" data-field="status" style="box-shadow:inset 4px 0 0 ${st.color}">${opts}</select></div>`;
        } else {
          const val=c.custom?((f.custom&&f.custom[c.custom])||""):(f[c.key]||"");
          html += `<div class="cell" style="width:${c.w}px"><span class="txt" contenteditable="true" data-field="${c.key}" spellcheck="false" data-ph="${esc(c.ph||"…")}">${esc(val)}</span></div>`;
        }
      });
      html += `</div></div>`;                                          // close .rowMain, then .featRow
    } else { // add-feature zone for this container (one per non-collapsed container, at any depth)
      const isSub=depth>=1, subEndCls=(isSub && row.lastChild)?" subEnd":"";
      html += `<div class="addFeat${isSub?' subScope':''}${subEndCls}" style="--lvl:${depth+1};${shadeVar(depth+1)}" data-nid="${esc(n.id)}" data-act="addfeat">${IC.plus}<span>เพิ่มฟีเจอร์ในโมดูลนี้</span></div>`;
    }
  });
  el("leftBody").innerHTML = html;
  bindGrid();
  sizeGripRails();                                     // measure each pill → per-row --railW (content-slide distance)
}

function renderTimeline(rows){
  const P=proj(), r=getRange(), ppd=pxPerDay();
  const dark=domThemeDark();                            // §1.10 item 6 / T1: read the DOM attribute (single authority) — NOT effectiveTheme(). So export/print force html[data-theme]=light + re-render → these inline fills capture as light pastels (no dark leak).
  rows = rows || flatten(P);                            // R9: reuse renderBoard's flatten, or recompute for standalone calls
  const totalDays=daysBetween(r.start,r.end)+1, W=totalDays*ppd;
  let months="", cur=new Date(r.start);
  while(cur<=r.end){
    const mEnd=endOfMonth(cur), segEnd=mEnd<r.end?mEnd:r.end, days=daysBetween(cur,segEnd)+1, w=days*ppd;
    const showYear=(cur.getMonth()===0)||(cur.getTime()===r.start.getTime());
    months += `<div class="monthBand" style="width:${w}px">${monName(cur.getMonth())} ${showYear?dispYear(cur):"’"+String(dispYear(cur)).slice(-2)}</div>`;
    cur=startOfMonth(addDays(mEnd,1));
  }
  const tm=tickMode();                                  // §1.8: axis/grid granularity derived from the continuous PPD (was ui.zoom)
  let ticks="";
  if(tm==="day"){ for(let i=0;i<totalDays;i++){ const d=addDays(r.start,i),wd=d.getDay(); ticks+=`<div class="tick ${(wd===0||wd===6)?'wkend':''} ${d.getDate()===1?'mstart':''}" style="width:${ppd}px">${d.getDate()}</div>`; } }
  else if(tm==="week"){ for(let i=0;i<totalDays;i+=7){ const d=addDays(r.start,i),w=Math.min(7,totalDays-i)*ppd; ticks+=`<div class="tick" style="width:${w}px">${d.getDate()}/${d.getMonth()+1}</div>`; } }
  else { for(let i=0;i<totalDays;i+=7){ const w=Math.min(7,totalDays-i)*ppd; ticks+=`<div class="tick" style="width:${w}px"></div>`; } }
  el("axis").innerHTML=`<div id="axisMonths" style="width:${W}px">${months}</div><div id="axisTicks" style="width:${W}px">${ticks}</div>`;

  let grid="";
  if(tm==="day"){
    for(let i=0;i<=totalDays;i++){ const d=addDays(r.start,i),x=i*ppd; grid+=`<div class="vline ${d.getDate()===1?'month':''}" style="left:${x}px"></div>`; if(i<totalDays){ const wd=d.getDay(); if(wd===0||wd===6) grid+=`<div class="wband" style="left:${x}px;width:${ppd}px"></div>`; } }
  } else {
    for(let i=0;i<=totalDays;i++){ const d=addDays(r.start,i); if(d.getDate()===1||i===0||i===totalDays) grid+=`<div class="vline month" style="left:${i*ppd}px"></div>`; else if(tm==="week"&&daysBetween(r.start,d)%7===0) grid+=`<div class="vline" style="left:${i*ppd}px"></div>`; }
  }
  const t=today();
  if(t>=r.start&&t<=r.end){ const x=daysBetween(r.start,t)*ppd+ppd/2; grid+=`<div id="todayLine" style="left:${x}px"></div><div id="todayFlag" style="left:${x}px">วันนี้ ${fmtThai(t)}</div>`; }
  el("gridLayer").style.width=W+"px"; el("gridLayer").innerHTML=grid;

  let rowsHtml="", altCount=0;
  rows.forEach(row=>{
    const n=row.node, sh=shadeVar(row.depth);           // §1.6 right-pane shading: SAME shadeVar(depth) as the row's left twin (frame-sync made visible)
    if(row.type==="container"){
      const p=PALETTE[(n.color||0)%PALETTE.length];
      let ms=null,me=null; containerFeatures(n).forEach(f=>{ const s=parse(f.start),e=parse(f.end); if(!ms||s<ms)ms=s; if(!me||e>me)me=e; }); // R7 / §5.3: span derives from ALL descendant features at any depth; empty container ⇒ no bar
      let modBar="";
      if(ms){ const left=daysBetween(r.start,ms)*ppd, w=(daysBetween(ms,me)+1)*ppd; modBar=`<div class="modBar" style="left:${left}px;width:${w}px"><div class="cap l" style="background:${p.border}"></div><div class="span" style="background:${p.border}"></div><div class="cap r" style="background:${p.border}"></div></div>`; }
      rowsHtml += `<div class="modBarRow" style="width:${W}px;${sh}" data-nid="${esc(n.id)}">${modBar}</div>`;
    } else if(row.type==="feature"){
      const f=n, pc=PALETTE[((row.parent&&row.parent.color)||0)%PALETTE.length]; // bar colour = parent container's palette (as v1.0.3)
      const barFill=dark?hex2rgba(pc.chip,.22):pc.fill, barInk=dark?lighten(pc.chip,.62):pc.ink; // §1.10 item 6: dark = chip@.22 fill + pale chip-tint ink; light = pastel pc.fill / dark pc.ink (byte-identical to v1.0.3)
      const left=daysBetween(r.start,f.start)*ppd, w=Math.max(ppd,(daysBetween(f.start,f.end)+1)*ppd);
      const alt=(altCount++ %2)===1?"alt":""; const dur=daysBetween(f.start,f.end)+1; const st=stById(f.status);
      const tip=`${f.fid?f.fid+" · ":""}${f.name}\n${fmtThai(parse(f.start))} → ${fmtThai(parse(f.end))} (${dur} วัน)\nสถานะ: ${st.th}${f.remark?"\nหมายเหตุ: "+f.remark:""}`;
      const fs=barLabelPx(ppd), hide=labelHidden(ppd, w);   // §1.9 label font curve + hide (status-dot only) at small size/width
      const lblStyle=`font-size:${fs.toFixed(2)}px${hide?';display:none':''}`;
      const bw=Math.max(2, w-2);                            // H1: at PPD<2 a short bar's (w-2) goes NEGATIVE → invalid CSS → the width declaration drops and the .bar auto-sizes to its content (handles+dot+label). Floor at 2px (keeps the −2 inset for normal widths). Dates stay safe: the drag commits day deltas (onBarMove reads drag.oS/oE, never bar.style.width). .bar has overflow:hidden so the dot/handles stay clipped inside the 2px box.
      rowsHtml += `<div class="barRow ${alt}" style="width:${W}px;${sh}" data-nid="${esc(f.id)}"><div class="bar" data-nid="${esc(f.id)}" data-tip="${esc(tip)}" style="left:${left+1}px;width:${bw}px;background:${barFill};border-color:${pc.border};color:${barInk}"><div class="handle l" data-mode="l"></div><span class="sdot" style="background:${st.color}"></span><span class="blabel" style="${lblStyle}">${esc(f.name)}</span><div class="handle r" data-mode="r"></div></div></div>`;
    } else { // add-zone → 32px spacer aligned with the left addFeat row (1:1 panes); shade uses depth+1 to match the left addFeat
      rowsHtml += `<div class="barRow" style="width:${W}px;height:32px;border-bottom:1px solid var(--line);${shadeVar(row.depth+1)}" data-nid="${esc(n.id)}"></div>`;
    }
  });
  el("rowsLayer").style.width=W+"px"; el("rowsLayer").innerHTML=rowsHtml;
  el("bars").style.width=W+"px";
  el("empty").style.display=P.modules.length?"none":"flex";
  bindBars();
  applyWrap();
  updateStickyLabels();                                 // apply the sliding-label shift for the current scroll (fresh bars start at transform:'')
  syncZoomUI();                                         // refresh the months-in-view readout + preset active-state for the current PPD
}

/* ---- Wrap Txt: sync chart row heights with (possibly wrapped) left rows ---- */
function applyWrap(){
  const bd=el("board"); if(!bd) return;
  bd.classList.toggle('wrapon', !!ui.wrapTxt);
  syncRowHeights();
}
function syncRowHeights(){
  const rl=el("rowsLayer"), lb=el("leftBody"); if(!rl||!lb) return;
  const on = !!ui.wrapTxt;
  lb.querySelectorAll('.featRow').forEach(fr=>{
    const bar = rl.querySelector('.bar[data-nid="'+cssEsc(fr.dataset.nid)+'"]');
    if(!bar) return;
    const barRow = bar.closest('.barRow'); if(!barRow) return;
    if(on){
      const h = fr.offsetHeight;
      barRow.style.height = h + 'px';
      const bh = bar.offsetHeight || 26;
      bar.style.top = Math.max(4, (h - bh) / 2) + 'px';
    } else {
      barRow.style.height = '';
      bar.style.top = '';
    }
  });
}

/* =====================  FLOATING TOOLTIP (shared)  ===================== */
let _tipEl=null;
function tipEl(){
  // Reuse any existing .floatTip already in the DOM and strip out duplicates so
  // exactly ONE dark floatTip node ever exists (guards against stray/second nodes).
  const existing=document.querySelectorAll('.floatTip');
  if(existing.length){ _tipEl=existing[0]; for(let i=1;i<existing.length;i++) existing[i].remove(); }
  if(!_tipEl || !_tipEl.isConnected){ _tipEl=document.createElement('div'); _tipEl.className='floatTip'; document.body.appendChild(_tipEl); }
  return _tipEl;
}
function showTip(text,x,y){ const t=tipEl(); t.classList.remove('dragDates'); t.textContent=text; t.style.display='block'; positionTip(x,y); }
function showDragTip(html,x,y){ const t=tipEl(); t.classList.add('dragDates'); t.innerHTML=html; t.style.display='block'; positionTip(x,y); } // E1 (R-E1b): live date readout on the SAME singleton tip; html is fmtThai dates + static Thai labels only (no user text)
function positionTip(x,y){ const t=_tipEl; if(!t) return; const pad=14, w=t.offsetWidth, h=t.offsetHeight; let tx=x+pad, ty=y+pad; if(tx+w>innerWidth-8) tx=x-w-pad; if(ty+h>innerHeight-8) ty=y-h-pad; t.style.left=Math.max(6,tx)+'px'; t.style.top=Math.max(6,ty)+'px'; }
function hideTip(){ if(_tipEl){ _tipEl.style.display='none'; _tipEl.classList.remove('dragDates'); } } // R-E1b: drop the drag accent so the next hover tip is a plain tip
/* True when `inner` is partially or fully outside the horizontal visible box of
   its scroll container (i.e. scrolled off the left/right edge). */
function isClipped(inner, container){
  if(!inner || !container) return false;
  const ir=inner.getBoundingClientRect(), cr=container.getBoundingClientRect();
  return ir.left < cr.left - 0.5 || ir.right > cr.right + 0.5;
}
/* A bar label needs the floatTip when its text can't be fully read in place. Two cases:
   (a) it is truncated inside its own box (ellipsis — small bar too narrow for the name);
   (b) after a sticky shift (updateStickyLabels) the label box is clipped by the bar's
       right edge OR by the chart viewport edge (scrolled so far the name can't stay in
       view). The check is on the POST-shift rendered rects: the visible slice is the
       intersection of the bar's box (overflow:hidden) and #rightScroll's viewport. */
function labelNeedsTip(lbl){
  if(!lbl) return false;
  if(lbl.style.display==='none') return true;                // §1.9: a zoom-hidden label (small size/width) always qualifies for the hover bubble
  if((lbl.scrollWidth - lbl.clientWidth) > 1) return true;   // truncated inside its own box (ellipsis)
  const bar=lbl.closest('.bar'), R=el('rightScroll');
  if(!bar || !R) return isClipped(lbl, el('rightScroll'));   // fallback: viewport-only clip
  const lr=lbl.getBoundingClientRect(), br=bar.getBoundingClientRect(), rr=R.getBoundingClientRect();
  const clipLeft=Math.max(br.left, rr.left), clipRight=Math.min(br.right, rr.right);
  return lr.left < clipLeft - 0.5 || lr.right > clipRight + 0.5;
}
/* ---- Sliding (sticky-within-bar) Gantt labels ----------------------------------------
   While a bar's START scrolls off the LEFT edge of #rightScroll but the bar is still
   partly visible, translate its .blabel RIGHT so the task name stays pinned just inside
   the visible left edge (you can still read which task the bar is). Clamp once the label
   would leave the bar's RIGHT edge — past that it clips and labelNeedsTip()'s hover bubble
   takes over. Small bars (label wider than the bar) clamp to shift 0 and keep today's
   ellipsis + hover-bubble behavior. Cheap: one pass over the bars, safe on every rAF frame.
   .blabel has pointer-events:none, so the transform never affects drag hit-testing, and no
   bar geometry / left|width is touched. */
function updateStickyLabels(){
  const R=el('rightScroll'); if(!R) return;
  const layer=el('rowsLayer'); if(!layer) return;
  const vpLeft=R.scrollLeft, vpRight=vpLeft+R.clientWidth, PAD=9;   // PAD matches .bar's left padding
  layer.querySelectorAll('.bar').forEach(bar=>{
    const lbl=bar.querySelector('.blabel'); if(!lbl) return;
    if(lbl.style.display==='none'){ if(lbl.style.transform) lbl.style.transform=''; return; } // §1.9: hidden label → no sticky slide (skip while invisible)
    const barLeft=parseFloat(bar.style.left)||0;
    const barW=parseFloat(bar.style.width)||bar.offsetWidth;
    if(barLeft+barW < vpLeft || barLeft > vpRight){ if(lbl.style.transform) lbl.style.transform=''; return; } // fully off-viewport
    const labelW=lbl.scrollWidth;
    let shift=vpLeft-barLeft;                                       // move the label start to the viewport-left edge
    shift=Math.max(0, Math.min(shift, barW-labelW-2*PAD));         // never before bar start; never past bar's right edge
    lbl.style.transform = shift>0 ? ('translateX('+shift+'px)') : '';
  });
}
let _stickyRAF=0;
function scheduleStickyLabels(){                                    // coalesce a scroll burst into one update per frame
  if(_stickyRAF) return;
  _stickyRAF=requestAnimationFrame(()=>{ _stickyRAF=0; updateStickyLabels(); });
}
function onBoardOver(e){
  if(drag) return;                                       // R-E1a: while a bar drag is live the drag readout owns the tip — hover logic must not fight it
  const t=e.target;
  const bar = t.closest && t.closest('.bar');
  if(bar){ const lbl=bar.querySelector('.blabel'); if(labelNeedsTip(lbl)){ showTip(lbl.textContent, e.clientX, e.clientY); } else hideTip(); return; }
  const txt = t.closest && t.closest('.cell .txt');
  if(txt){
    const cell = txt.closest('.cell');
    const isTarget = cell.classList.contains('feat') || txt.dataset.field==='description';
    if(isTarget && document.activeElement!==txt && ((txt.scrollWidth - txt.clientWidth) > 1 || isClipped(txt, el('leftScroll')))){ showTip(cellTipText(txt), e.clientX, e.clientY); } else hideTip();
    return;
  }
  // module description row — floatTip on truncation (replaces the old native title)
  const md = t.closest && t.closest('.modDesc');
  if(md){ if(document.activeElement!==md && (md.scrollWidth - md.clientWidth) > 1){ showTip((md.getAttribute('data-tip')||md.textContent||'').trim(), e.clientX, e.clientY); } else hideTip(); return; }
  // column header + its controls — floatTip from data-tip (replaces the old native title)
  const ch = t.closest && t.closest('.colHead');
  if(ch){
    const inner = (t.closest && (t.closest('.colTool')||t.closest('.colResize')));
    const src = inner || (t.closest('.delcol') ? null : ch);
    const tip = src && src.getAttribute('data-tip');
    if(tip){ showTip(tip, e.clientX, e.clientY); } else hideTip();
    return;
  }
  hideTip();
}
function cellTipText(txt){
  const fid = txt.querySelector('.fid');
  if(!fid) return txt.textContent.trim();
  const name = (txt.textContent||'').slice(fid.textContent.length).trim();
  return (fid.textContent.trim() + ' · ' + name).trim();
}
function onBoardMove(e){
  if(drag) return;                                       // R-E1a
  const bar = e.target && e.target.closest && e.target.closest('.bar');
  if(bar){ const lbl=bar.querySelector('.blabel'); if(labelNeedsTip(lbl)) showTip(lbl.textContent, e.clientX, e.clientY); else hideTip(); return; }
  if(_tipEl && _tipEl.style.display==='block') positionTip(e.clientX, e.clientY);
}

/* =====================  GRID INTERACTIONS  ===================== */
function bindGrid(){
  const lb=el("leftBody");
  lb.querySelectorAll('[contenteditable]').forEach(x=>{ x.addEventListener('blur', onTextBlur); x.addEventListener('keydown', e=>{ if(e.key==='Enter'&&x.dataset.field!=='description'){ e.preventDefault(); x.blur(); } }); });
  lb.querySelectorAll('input[type=date]').forEach(x=> x.addEventListener('change', onDateChange));
  lb.querySelectorAll('select.statusSel').forEach(x=> x.addEventListener('change', onStatusChange));
  lb.querySelectorAll('[data-act]').forEach(b=> b.addEventListener('click', onGridAction));
  lb.querySelectorAll('.grip[data-act="rowdrag"]').forEach(g=> g.addEventListener('pointerdown', onRowDragStart));
  lb.querySelectorAll('.modGrip[data-act="moddrag"]').forEach(g=> g.addEventListener('pointerdown', onModDragStart));
  const lh=el("leftHead");
  lh.querySelectorAll('[data-act="delcol"]').forEach(b=> b.addEventListener('click', onGridAction));
  lh.querySelectorAll('.colHead').forEach(h=> h.addEventListener('pointerdown', onColDragStart));
  lh.querySelectorAll('.colResize').forEach(h=> h.addEventListener('pointerdown', onColResizeStart));
  lh.querySelectorAll('.wrapToggle').forEach(b=>{ b.addEventListener('pointerdown', e=>e.stopPropagation()); b.addEventListener('click', onWrapToggle); });
}
function onTextBlur(e){
  const x=e.target, field=x.dataset.field;
  if(field==="modname"){                                             // R1: resolve container via findNode(data-nid)
    const id=x.closest('.modRow').dataset.nid, val=x.textContent.trim();
    const n=findNode(proj(), id); if(!n || n.name===val) return;     // F2: dirty-check — unchanged ⇒ no save/render (DOM identity preserved)
    apply(P=>{ const t=findNode(P,id); if(t) t.name=val; }, {fields:true}); // container name affects meta/progress/export only; grid cell already shows the text → light render
    return;
  }
  const row=x.closest('.featRow'); if(!row) return;
  const id=row.dataset.nid; const f0=findNode(proj(), id); if(!f0) return;
  let val=x.textContent, key, newVal, curVal;
  if(field==="name"){ if(f0.fid && val.startsWith(f0.fid)) val=val.slice(f0.fid.length); key="name"; newVal=val.trim(); curVal=f0.name||""; }
  else if(field.startsWith("c:")){ key=field.slice(2); newVal=val.trim(); curVal=(f0.custom&&f0.custom[key])||""; }
  else { key=field; newVal=val.trim(); curVal=f0[field]||""; }
  if(newVal===(curVal||"")) return;                                  // F2: dirty-check — unchanged ⇒ no apply (no save, no render)
  apply(P=>{ const f=findNode(P,id); if(!f) return;
    if(field==="name") f.name=newVal;
    else if(field.startsWith("c:")){ if(!f.custom) f.custom={}; f.custom[key]=newVal; }
    else f[field]=newVal;
  }, {fields:true});                                                 // FIELD edit: renderTimeline refreshes the .blabel; #leftBody untouched
}
function onDateChange(e){
  const inp=e.target, id=inp.dataset.nid, field=inp.dataset.field, v=inp.value;
  const f=findNode(proj(), id); if(!f) return;
  if(field.startsWith("c:")){ const cid=field.slice(2); if(!v){ inp.value=(f.custom&&f.custom[cid])||""; return; } apply(P=>{ const t=findNode(P,id); if(t){ if(!t.custom) t.custom={}; t.custom[cid]=v; } }, {fields:true}); return; } // custom date column → store on f.custom, independent of the feature's schedule
  if(!v){ inp.value=f[field]||""; return; }                            // empty ⇒ revert (no mutation)
  apply(P=>{ const t=findNode(P,id); if(!t) return; if(field==="start"){ t.start=v; if(parse(t.end)<parse(v)) t.end=v; } else { t.end=v; if(parse(v)<parse(t.start)) t.start=v; } }, {fields:true});
  // F2: the grid is NOT rebuilt on a field edit → manually reconcile the paired schedule input if the clamp moved it (v1.0.3 patch)
  const f2=findNode(proj(), id), row=inp.closest('.featRow'); if(!f2 || !row) return;
  const si=row.querySelector('input[data-field="start"]'), ei=row.querySelector('input[data-field="end"]');
  if(si && si.value!==f2.start) si.value=f2.start; if(ei && ei.value!==f2.end) ei.value=f2.end;
}
function onStatusChange(e){
  const s=e.target, id=s.dataset.nid;
  apply(P=>{ const f=findNode(P,id); if(f) f.status=s.value; }, {fields:true}); // FIELD edit: renderTimeline refreshes the bar .sdot + progress roll-up
  const st=stById(s.value); if(st) s.style.boxShadow="inset 4px 0 0 "+st.color;  // F2: grid not rebuilt → patch the select's status colour inline (v1.0.3 style)
}
/* All grip-menu (and legacy) actions funnel here. delcol/addfeat keep their own targeting;
   every other act is node-scoped and resolves the row's data-nid (container OR feature). */
function onGridAction(e){
  const b=e.currentTarget, act=b.dataset.act, P=proj();
  if(act==="delcol"){ const cid=b.dataset.col; if(confirm("ลบคอลัมน์นี้และข้อมูลในคอลัมน์?")){ apply(P2=>{ P2.customCols=(P2.customCols||[]).filter(c=>c.id!==cid); walkFeatures(P2, f=>{ if(f.custom) delete f.custom[cid]; }); }); } return; }
  if(act==="addfeat"){ const host=b.closest('.modRow')||b.closest('.addFeat'); const cid=(host?host.dataset.nid:null)||b.dataset.nid; if(cid) featureModal(cid); return; } // R3: opens the modal pre-targeted; nothing is inserted until save
  const rowEl=b.closest('.modRow')||b.closest('.featRow'); if(!rowEl) return;   // grips (moddrag/rowdrag) fall through to no-op
  const id=rowEl.dataset.nid;
  switch(act){
    case "toggle":   apply(P2=>{ const n=findNode(P2,id); if(n) n.collapsed=!n.collapsed; }); return;
    case "editmod":
    case "editfeat": nodeModal(id); return;                                     // D8: unified edit modal for ANY node
    case "modup":
    case "up":       moveNodeUpDown(id,-1); return;
    case "moddown":
    case "down":     moveNodeUpDown(id,1); return;
    case "indent":   indent(id);  return;
    case "outdent":  outdent(id); return;
    case "promote":  togglePromoteDemote(id); return;                           // ⇄ feature→container OR childless container→feature
    case "delmod": {                                                            // D1: cascade delete (no silent child-promotion)
      const node=findNode(P,id); if(!node) return;
      const n=countAll(node), msg = n>0 ? `ลบ "${node.name}" และ ${n} รายการข้างใน?` : `ลบ "${node.name}"?`;
      if(confirm(msg)) apply(P2=>{ removeNode(P2,id); });
      return;
    }
    case "delfeat": { const f=findNode(P,id); if(!f) return; if(confirm(`ลบ "${f.name}"?`)) apply(P2=>{ removeNode(P2,id); }); return; } // a feature has no descendants → plain confirm (N=0)
  }
}
/* up/down: swap a node with its adjacent SIBLING inside its parent's children (or the root
   list). Unifies feature reorder AND module reorder-among-siblings (§4). Boundary ⇒ no-op. */
function moveNodeUpDown(id, dir){
  const sibs=siblingsOf(proj(), id); const i=sibs.findIndex(n=>n&&n.id===id);
  if(i<0) return; const j=i+dir; if(j<0||j>=sibs.length) return;              // at an edge → no save/render
  apply(P=>{ const sb=siblingsOf(P,id); const a=sb.findIndex(n=>n&&n.id===id), b2=a+dir; if(a<0||b2<0||b2>=sb.length) return; const t=sb[a]; sb[a]=sb[b2]; sb[b2]=t; });
}

/* ---- STRUCTURE MOVES (spec §5.2) — all through apply() (full render), each returns {flash:id}.
   Every mutator RE-CHECKS its shared predicate (R5) and no-ops when illegal (the menu only reflects). ---- */
function indent(id){                                                          // tuck under the previous sibling container (R6 reveal)
  if(!canIndent(proj(),id)) return;
  apply(P=>{ if(!canIndent(P,id)) return; const prev=prevSibling(P,id); if(!prev||prev.kind!=="container") return;
    const g=removeNode(P,id); if(!g) return; if(!Array.isArray(prev.children)) prev.children=[]; prev.children.push(g); revealInto(prev); return {flash:id}; });
}
function outdent(id){                                                         // lift into the grandparent's list, right AFTER the former parent
  if(!canOutdent(proj(),id)) return;
  apply(P=>{ if(!canOutdent(P,id)) return; const par=findParent(P,id); if(!par) return; const gp=findParent(P,par.id);
    const g=removeNode(P,id); if(!g) return; const list=gp?gp.children:P.modules;
    let idx=list.findIndex(n=>n&&n.id===par.id); if(idx<0) idx=list.length-1; list.splice(idx+1,0,g); return {flash:id}; });
}
/* R5/G5: pure node transforms — the SINGLE implementation of the feature⇄container conversion,
   shared by promote()/demote() AND nodeModal's save. Callers own the legality decision
   (canPromote/canDemote); these just transform. R7: promote keeps ALL feature fields dormant on
   the node; demote revives them. A demoted node carries NO container-only keys (children/collapsed/
   features/color) — a feature has no colour of its own (renders with its parent's palette, D8b). */
function promoteCore(nd){ if(!nd) return; nd.kind="container"; nd.children=[]; nd.collapsed=false; }
function demoteCore(nd){
  if(!nd) return;
  nd.kind="feature"; delete nd.children; delete nd.collapsed; delete nd.features; delete nd.color;
  if(!nd.custom||typeof nd.custom!=="object") nd.custom={};
  if(nd.fid==null) nd.fid=""; if(nd.remark==null) nd.remark=""; if(!nd.status) nd.status="not_started";
  if(!nd.start||!nd.end){ const t=today(); if(!nd.start) nd.start=iso(t); if(!nd.end) nd.end=iso(addDays(t,7)); }
  if(parse(nd.end)<parse(nd.start)) nd.end=nd.start;
}
function promote(id){                                                         // feature → container (R7: ALL feature fields stay dormant on the node)
  if(!canPromote(proj(),id)) return;
  apply(P=>{ if(!canPromote(P,id)) return; promoteCore(findNode(P,id)); return {flash:id}; }); // R5: the mutator re-decides inside apply, not the menu
}
function demote(id){                                                          // childless NON-ROOT container → feature (dormant fields revive; mirror dropped)
  if(!canDemote(proj(),id)) return;
  apply(P=>{ if(!canDemote(P,id)) return; demoteCore(findNode(P,id)); return {flash:id}; }); // R5+G1: root / has-children demote no-ops here even when forced via evaluate
}
function togglePromoteDemote(id){ const n=findNode(proj(),id); if(!n) return; if(n.kind==="feature") promote(id); else demote(id); }

/* feature modal — CREATE-ONLY (D8: the unified nodeModal owns all EDIT paths). The grip ＋ / add-zone
   opens this pre-targeted at a container; R3: creation happens ON SAVE ONLY (nothing inserted before). */
function featureModal(containerId){
  const P=proj(), M=findNode(P,containerId); if(!canAddChild(P,containerId)) return;    // R5: containers only (shared predicate — the single legality source)
  const t=today();
  const f = {fid:"",name:"",description:"",start:iso(t),end:iso(addDays(t,7)),status:"not_started",remark:""};
  const opts=STATUS.map(s=>`<option value="${s.id}" ${s.id===f.status?'selected':''}>${esc(s.th)}</option>`).join("");
  openModal(`
    <h2>เพิ่มฟีเจอร์</h2>
    <div class="msub">โมดูล: ${esc(M.name)}</div>
    <div class="field2">
      <div class="field"><label>รหัส · ID</label><input type="text" id="fm_fid" value="${esc(f.fid||"")}" placeholder="เช่น PRO-PR-01"/></div>
      <div class="field"><label>สถานะ · Status</label><select id="fm_status">${opts}</select></div>
    </div>
    <div class="field"><label>ชื่อฟีเจอร์ · Feature name</label><input type="text" id="fm_name" value="${esc(f.name||"")}" placeholder="ตั้งชื่อฟีเจอร์…"/></div>
    <div class="field"><label>คำอธิบาย · Description</label><textarea id="fm_desc" placeholder="อธิบายสั้น ๆ (ไม่บังคับ)">${esc(f.description||"")}</textarea></div>
    <div class="field2">
      <div class="field"><label>วันเริ่ม · Start</label><input type="date" id="fm_start" value="${esc(f.start||iso(t))}"/></div>
      <div class="field"><label>วันสิ้นสุด · End</label><input type="date" id="fm_end" value="${esc(f.end||iso(addDays(t,7)))}"/></div>
    </div>
    <div class="field"><label>หมายเหตุ · Remark</label><input type="text" id="fm_remark" value="${esc(f.remark||"")}" placeholder="หมายเหตุ (ไม่บังคับ)"/></div>
    <div class="modActsRow"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" id="fm_save">เพิ่มฟีเจอร์</button></div>`);
  el("fm_name").focus();
  el("fm_save").onclick=()=>{
    const name=el("fm_name").value.trim()||"ฟีเจอร์ใหม่";
    let s=el("fm_start").value||iso(t), e=el("fm_end").value||s; if(parse(e)<parse(s)) e=s;
    const data={ fid:el("fm_fid").value.trim(), name, description:el("fm_desc").value.trim(), start:s, end:e, status:el("fm_status").value, remark:el("fm_remark").value.trim() };
    apply(P2=>{ if(!canAddChild(P2,containerId)) return; const C=findNode(P2,containerId); if(!Array.isArray(C.children)) C.children=[]; const node={ id:nid(), kind:"feature", ...data, custom:{} }; C.children.push(node); revealInto(C); return {focus:node.id, flash:node.id}; }); // R5 re-check + R6: expand the container, focus AND flash the new row (G6c: create flashes, same as move)
    closeModal(); toast("เพิ่มฟีเจอร์แล้ว");
  };
}

/* UNIFIED NODE EDIT MODAL (spec §1.5, D8) — ✎ opens this for ANY node. Replaces the EDIT paths of
   featureModal/moduleModal. Type Feature/Container is wired to promote/demote through the SAME
   predicates (R5) — locked when a container has children (canDemote false). Parentage changes happen
   ONLY via indent/outdent/drag (no parent picker here). Cancel leaves the doc byte-identical (R3).
   D8b: colour is editable on CONTAINERS only (features render with the parent container's palette). */
function nodeModal(id){
  const P=proj(), node=findNode(P,id); if(!node) return;
  const startFeature = node.kind==="feature";
  const depth = nodeDepth(P,id);
  const typeLocked = !startFeature && !canDemote(P,id);                       // container with children → cannot become a feature
  const subOf = k => k==="feature" ? "ฟีเจอร์ · Feature" : (depth===0 ? "โมดูล · Module" : "โมดูลย่อย · Sub-Module"); // depth naming (§1.2)
  const t=today();
  const stOpts=STATUS.map(s=>`<option value="${s.id}" ${s.id===node.status?'selected':''}>${esc(s.th)}</option>`).join("");
  let color=(node.color!=null?node.color:0)%PALETTE.length;
  const sw=PALETTE.map((p,i)=>`<div class="swatch ${i===color?'on':''}" data-c="${i}" style="background:${p.chip}"></div>`).join("");
  const hasKids = !startFeature && Array.isArray(node.children) && node.children.length>0;
  // G1: the Type lock has TWO causes (canDemote false). Has-children ⇒ "remove the children first";
  // childless ROOT container ⇒ it can never become a feature (root holds containers only).
  const lockHint = hasKids
    ? "มีรายการย่อยอยู่ — ต้องไม่มีรายการข้างในจึงจะเปลี่ยนเป็นฟีเจอร์ได้"
    : "โมดูลระดับบนสุดเปลี่ยนเป็นฟีเจอร์ไม่ได้";
  const h2Title = startFeature ? "แก้ไขฟีเจอร์" : (depth===0 ? "แก้ไขโมดูล" : "แก้ไขโมดูลย่อย"); // §1.2 depth naming, consistent with the grip tooltip
  openModal(`
    <h2>${h2Title}</h2>
    <div class="msub" id="nm_sub">${esc(subOf(node.kind))}</div>
    <div class="field2" id="nm_fidRow" style="${startFeature?'':'display:none'}">
      <div class="field"><label>รหัส · ID</label><input type="text" id="nm_fid" value="${esc(node.fid||"")}" placeholder="เช่น PRO-PR-01"/></div>
      <div class="field"><label>สถานะ · Status</label><select id="nm_status">${stOpts}</select></div>
    </div>
    <div class="field"><label>ประเภท · Type</label>
      <div class="seg" id="nm_type">
        <button type="button" data-t="feature" class="${startFeature?'on':''}" ${typeLocked?'disabled':''}>ฟีเจอร์ · Feature</button>
        <button type="button" data-t="container" class="${startFeature?'':'on'}" ${typeLocked?'disabled':''}>โมดูล · Container</button>
      </div>
      ${typeLocked?`<div class="mmKindHint" id="nm_lockHint">${esc(lockHint)}</div>`:""}
    </div>
    <div class="field"><label>ชื่อ · Name</label><input type="text" id="nm_name" value="${esc(node.name||"")}" placeholder="ตั้งชื่อ…"/></div>
    <div class="field"><label>คำอธิบาย · Description</label><textarea id="nm_desc" placeholder="อธิบายสั้น ๆ (ไม่บังคับ)">${esc(node.description||"")}</textarea></div>
    <div class="field" id="nm_colorRow" style="${startFeature?'display:none':''}"><label>สี · Colour</label><div class="swatches" id="nm_sw">${sw}</div></div>
    <div class="field2" id="nm_dateRow" style="${startFeature?'':'display:none'}">
      <div class="field"><label>วันเริ่ม · Start</label><input type="date" id="nm_start" value="${esc(node.start||iso(t))}"/></div>
      <div class="field"><label>วันสิ้นสุด · End</label><input type="date" id="nm_end" value="${esc(node.end||iso(addDays(t,7)))}"/></div>
    </div>
    <div class="field" id="nm_remarkRow" style="${startFeature?'':'display:none'}"><label>หมายเหตุ · Remark</label><input type="text" id="nm_remark" value="${esc(node.remark||"")}" placeholder="หมายเหตุ (ไม่บังคับ)"/></div>
    <div class="modActsRow"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" id="nm_save">บันทึก</button></div>`);
  el("modalRoot").querySelectorAll('#nm_sw .swatch').forEach(s=> s.onclick=()=>{ color=+s.dataset.c; el("modalRoot").querySelectorAll('#nm_sw .swatch').forEach(x=>x.classList.toggle('on',x===s)); });
  let selType = startFeature ? "feature" : "container";
  const typeSeg=el("nm_type");
  const applyTypeUI=()=>{
    const feat = selType==="feature";
    el("nm_fidRow").style.display    = feat?'':'none';
    el("nm_dateRow").style.display   = feat?'':'none';
    el("nm_remarkRow").style.display = feat?'':'none';
    el("nm_colorRow").style.display  = feat?'none':'';   // colour on containers only (D8b)
    el("nm_sub").textContent = subOf(feat?"feature":"container");
  };
  typeSeg.querySelectorAll('button').forEach(b=> b.onclick=()=>{ if(b.disabled) return; selType=b.dataset.t; typeSeg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); applyTypeUI(); });
  el("nm_name").focus();
  el("nm_save").onclick=()=>{
    const name=el("nm_name").value.trim()||node.name||"ไม่มีชื่อ", desc=el("nm_desc").value.trim();
    const wantContainer=(selType==="container");
    let s=el("nm_start").value||node.start||iso(t), e=el("nm_end").value||s; if(parse(e)<parse(s)) e=s;
    const fid=el("nm_fid").value.trim(), status=el("nm_status").value, remark=el("nm_remark").value.trim();
    apply(P2=>{
      const nd=findNode(P2,id); if(!nd) return;
      nd.name=name; nd.description=desc;
      if(wantContainer){
        if(nd.kind==="feature"){ if(!canPromote(P2,id)) return; promoteCore(nd); }                       // G5: promote via the shared core (R5 re-check, not the UI)
        nd.color=color;
      } else {
        if(nd.kind==="container"){ if(!canDemote(P2,id)) return; demoteCore(nd); }                        // G5: demote via the shared core (R5+G1 re-check: childless NON-root only)
        if(!nd.custom||typeof nd.custom!=="object") nd.custom={};
        nd.fid=fid; nd.start=s; nd.end=e; nd.status=status; nd.remark=remark;                            // feature field edits (end≥start clamped above)
      }
      return {flash:id};
    });
    closeModal(); toast("บันทึกแล้ว");
  };
}

/* module modal — CREATE-ONLY (D8: nodeModal owns all EDIT paths; a container's parentage now
   changes ONLY via indent/outdent/drag). Creates a root container ("main") or a child container
   under a chosen parent ("sub"); optional picker moves existing features into the new module. */
function moduleModal(){
  const P=proj();
  let color=(P.modules.length%PALETTE.length);
  const sw=PALETTE.map((p,i)=>`<div class="swatch ${i===color?'on':''}" data-c="${i}" style="background:${p.chip}"></div>`).join("");
  const parents=[]; walkTree(P.modules, n=>{ if(n.kind==="container") parents.push(n); });    // any container can be a parent
  const canSub=parents.length>0;
  let kind="main";
  let parentId=parents[0]?parents[0].id:"";
  const parentOpts=parents.map(m=>`<option value="${esc(m.id)}" ${m.id===parentId?'selected':''}>${esc(m.name)}</option>`).join("");
  const kindHint=parents.length===0 ? "ยังไม่มีโมดูลหลักอื่นให้สังกัด — สร้างโมดูลหลักก่อน" : "";
  /* optional picker to MOVE existing features (from any container) into the new module */
  let pickerHtml="";
  let totalFeats=0; walkFeatures(P, ()=>totalFeats++);
  if(totalFeats===0){
    pickerHtml=`<div class="field"><label>ย้ายฟีเจอร์เข้าโมดูลนี้ · Move features into this module (ไม่บังคับ)</label><div class="mpEmpty">ยังไม่มีฟีเจอร์ให้ย้าย — สร้างฟีเจอร์ในโมดูลอื่นก่อน</div></div>`;
  }else{
    const grp=[]; walkTree(P.modules, n=>{ if(n.kind==="container"){ const df=directFeatures(n); if(df.length) grp.push({m:n,feats:df}); } });
    const groups=grp.map(({m,feats})=>{
      const p=PALETTE[(m.color||0)%PALETTE.length];
      const rows=feats.map(f=>`<label class="mpFeat"><input type="checkbox" class="mpChk" data-featid="${esc(f.id)}"/>${f.fid?`<span class="fid">${esc(f.fid)}</span>`:""}<span class="mpFeatName">${esc(f.name)}</span></label>`).join("");
      return `<div class="mpGroup"><label class="mpHead"><input type="checkbox" class="mpAll"/><span class="chip" style="background:${p.chip}"></span><span class="mpModName">${esc(m.name)}</span><span class="count">${feats.length}</span></label>${rows}</div>`;
    }).join("");
    pickerHtml=`<div class="field"><label>ย้ายฟีเจอร์เข้าโมดูลนี้ · Move features into this module (ไม่บังคับ)</label><div class="mpList" id="mm_pick">${groups}</div><div class="mpCounter" id="mm_pickCount">เลือกแล้ว 0 ฟีเจอร์</div></div>`;
  }
  openModal(`
    <h2>สร้างโมดูล</h2>
    <div class="msub">โมดูลคือกลุ่มของฟีเจอร์ในแผนงาน</div>
    <div class="field"><label>ชื่อโมดูล · Module name</label><input type="text" id="mm_name" value="" placeholder="เช่น Procurement P2P (Section B)"/></div>
    <div class="field"><label>คำอธิบายสั้น · Short description</label><textarea id="mm_desc" placeholder="อธิบายสั้น ๆ เช่น 43 features — PR, PO, GR, Reports"></textarea></div>
    <div class="field"><label>ประเภท · Type</label>
      <div class="seg" id="mm_kind">
        <button type="button" data-k="main" class="${kind==='main'?'on':''}">โมดูลหลัก · Module</button>
        <button type="button" data-k="sub" class="${kind==='sub'?'on':''}" ${canSub?'':'disabled'}>โมดูลย่อย · Sub-Module</button>
      </div>
      ${kindHint?`<div class="mmKindHint">${esc(kindHint)}</div>`:""}
    </div>
    <div class="field" id="mm_parentField" style="${kind==='sub'?'':'display:none'}"><label>สังกัดโมดูลหลัก · Parent module</label><select id="mm_parent" ${canSub?'':'disabled'}>${parentOpts}</select></div>
    <div class="field"><label>สี · Colour</label><div class="swatches" id="mm_sw">${sw}</div></div>
    ${pickerHtml}
    <div class="modActsRow"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" id="mm_save">สร้างโมดูล</button></div>`);
  el("modalRoot").querySelectorAll('#mm_sw .swatch').forEach(s=> s.onclick=()=>{ color=+s.dataset.c; el("modalRoot").querySelectorAll('#mm_sw .swatch').forEach(x=>x.classList.toggle('on',x===s)); });
  const kindSeg=el("mm_kind"), parentField=el("mm_parentField");
  kindSeg.querySelectorAll('button').forEach(b=> b.onclick=()=>{ if(b.disabled) return; kind=b.dataset.k; kindSeg.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); if(parentField) parentField.style.display=(kind==='sub')?'':'none'; });
  const pick=el("mm_pick");
  if(pick){
    const updateCount=()=>{
      pick.querySelectorAll('.mpGroup').forEach(g=>{
        const all=g.querySelector('.mpAll'), chks=g.querySelectorAll('.mpChk'), on=g.querySelectorAll('.mpChk:checked').length;
        if(all){ all.checked = on>0 && on===chks.length; all.indeterminate = on>0 && on<chks.length; }
      });
      const n=pick.querySelectorAll('.mpChk:checked').length;
      el("mm_pickCount").textContent=`เลือกแล้ว ${n} ฟีเจอร์`;
    };
    pick.querySelectorAll('.mpAll').forEach(a=> a.addEventListener('change', ()=>{ const g=a.closest('.mpGroup'); g.querySelectorAll('.mpChk').forEach(c=> c.checked=a.checked); updateCount(); }));
    pick.querySelectorAll('.mpChk').forEach(c=> c.addEventListener('change', updateCount));
    updateCount();
  }
  el("mm_save").onclick=()=>{
    const name=el("mm_name").value.trim()||"โมดูลใหม่", desc=el("mm_desc").value.trim();
    const pSel=el("mm_parent");
    const newParentId=(kind==='sub' && pSel && pSel.value) ? pSel.value : null;   // null ⇒ root container; set ⇒ child of that container
    let selIds=[]; const pk=el("mm_pick"); if(pk) selIds=Array.from(pk.querySelectorAll('.mpChk:checked')).map(c=>c.dataset.featid);
    let moved=0;
    apply(P2=>{
      const node={id:nid(),kind:"container",name,description:desc,color,collapsed:false,children:[]};
      const np=newParentId?findNode(P2,newParentId):null;
      if(np && np.kind==="container"){ if(!Array.isArray(np.children)) np.children=[]; np.children.push(node); revealInto(np); }
      else P2.modules.push(node);
      selIds.forEach(fid=>{ const f=findNode(P2,fid); if(f && f.kind==="feature"){ const g=removeNode(P2,fid); if(g){ node.children.push(g); moved++; } } }); // move picked features in (preserve object ref)
      return {flash:node.id};                                                    // G6c: create flashes the new module row (same reveal-and-flash rule as a move, R6)
    });
    closeModal();
    toast(moved>0 ? `สร้างโมดูลแล้ว · ย้าย ${moved} ฟีเจอร์เข้าโมดูล` : "สร้างโมดูลแล้ว");
  };
}

/* column modal */
function columnModal(){
  const P=proj(); let kind="text";
  openModal(`
    <h2>เพิ่มคอลัมน์</h2>
    <div class="msub">คอลัมน์ที่เพิ่มเองจะถูกส่งออก/นำเข้า Excel ด้วย · ลากหัวคอลัมน์เพื่อย้ายตำแหน่งได้</div>
    <div class="field"><label>ชื่อคอลัมน์ · Column name</label><input type="text" id="cm_name" placeholder="เช่น % Complete / Priority / Sprint"/></div>
    <div class="field"><label>ชนิด · Type</label><div class="seg" id="cm_kind"><button data-k="text" class="on">Text</button><button data-k="date">Date</button></div></div>
    <div class="modActsRow"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" id="cm_save">เพิ่มคอลัมน์</button></div>`);
  el("cm_kind").querySelectorAll('button').forEach(b=> b.onclick=()=>{ kind=b.dataset.k; el("cm_kind").querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b)); });
  el("cm_save").onclick=()=>{ const label=el("cm_name").value.trim(); if(!label){ toast("กรุณาใส่ชื่อคอลัมน์"); return; } P.customCols.push({id:"c"+(_seq++),label,w:150,kind}); Store.save(); renderBoard(); closeModal(); toast("เพิ่มคอลัมน์แล้ว"); };
}

/* details external link (รายละเอียด) */
function refreshDetailsBtn(){ const b=el("btnDetails"); if(!b) return; const P=proj(); const has=!!(P&&P.detailsUrl); b.classList.toggle('gray', !has); b.title=has?P.detailsUrl:'ยังไม่ได้ตั้งค่า URL — คลิกเพื่อเพิ่มลิงก์'; }
function detailsModal(){
  const P=proj();
  openModal(`
    <h2>รายละเอียด · ลิงก์ภายนอก</h2>
    <div class="msub">ลิงก์ออกไปยังเอกสาร/ระบบภายนอก เช่น BRD, Google Drive, Figma — เปิดในแท็บใหม่</div>
    <div class="field"><label>URL</label><input type="url" id="du_url" value="${esc(P.detailsUrl||"")}" placeholder="https://…"/></div>
    <div class="modActsRow">${P.detailsUrl?`<button class="btn danger" id="du_clear">ลบลิงก์</button>`:""}<span class="grow"></span><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" id="du_save">บันทึก</button></div>`);
  el("du_url").focus();
  el("du_save").onclick=()=>{ let u=el("du_url").value.trim(); if(u&&!/^https?:\/\//i.test(u)) u="https://"+u; P.detailsUrl=u; Store.save(); closeModal(); refreshDetailsBtn(); toast(u?"บันทึกลิงก์แล้ว":"ลบลิงก์แล้ว"); };
  const c=el("du_clear"); if(c) c.onclick=()=>{ P.detailsUrl=""; Store.save(); closeModal(); refreshDetailsBtn(); toast("ลบลิงก์แล้ว"); };
}

/* =====================  BARS — DRAG / RESIZE  ===================== */
let drag=null;
function bindBars(){ el("rowsLayer").querySelectorAll('.bar').forEach(bar=> bar.addEventListener('pointerdown', onBarDown)); }
function onBarDown(e){
  const bar=e.currentTarget, mode=e.target.dataset.mode||'move', P=proj();
  const id=bar.dataset.nid, f=findNode(P,id); if(!f) return; const r=getRange(), ppd=pxPerDay();
  drag={bar,mode,id,ppd,rStart:r.start,startX:e.clientX,oS:daysBetween(r.start,f.start),oE:daysBetween(r.start,f.end)};
  bar.classList.add('dragging'); bar.setPointerCapture(e.pointerId); document.body.style.userSelect='none';
  window.addEventListener('pointermove', onBarMove); window.addEventListener('pointerup', onBarUp); e.preventDefault();
}
function onBarMove(e){
  if(!drag) return; if(!_dragging){ drag._s=null; onBarUp(); return; }  // R-E1d self-heal: a capture-phase pointercancel cleared the guard mid-drag → abort the whole bar drag via onBarUp (null _s ⇒ snap-back, no commit), never just half-heal the tip on a stray frame
  const delta=Math.round((e.clientX-drag.startX)/drag.ppd); let s=drag.oS, en=drag.oE;
  if(drag.mode==='move'){ s+=delta; en+=delta; } else if(drag.mode==='l'){ s=Math.min(drag.oS+delta,en); } else { en=Math.max(drag.oE+delta,s); }
  drag.bar.style.left=(s*drag.ppd+1)+"px"; drag.bar.style.width=((en-s+1)*drag.ppd-2)+"px";
  const ns=iso(addDays(drag.rStart,s)), ne=iso(addDays(drag.rStart,en));
  const si=el("leftBody").querySelector('input[data-nid="'+cssEsc(drag.id)+'"][data-field="start"]');
  const ei=el("leftBody").querySelector('input[data-nid="'+cssEsc(drag.id)+'"][data-field="end"]');
  if(si) si.value=ns; if(ei) ei.value=ne; drag._s=ns; drag._e=ne;
  const a=fmtThai(parse(ns)), b=fmtThai(parse(ne)), dur=en-s+1;  // dur = inclusive day count (same math as the bar tooltip: daysBetween+1)
  const html = drag.mode==='l' ? `เริ่ม ${a}<span class="dim">→ ${b} · ${dur} วัน</span>`
             : drag.mode==='r' ? `สิ้นสุด ${b}<span class="dim">${a} → · ${dur} วัน</span>`
             :                   `${a} → ${b} · ${dur} วัน`;
  showDragTip(html, e.clientX, e.clientY);  // E1 (R-E1c): readout renders inside this existing frame — no new window listeners, no extra layout reads
}
function onBarUp(){ window.removeEventListener('pointermove', onBarMove); window.removeEventListener('pointerup', onBarUp); hideTip(); if(!drag) return; document.body.style.userSelect=''; const d=drag; drag=null; d.bar.classList.remove('dragging'); if(d._s){ apply(P=>{ const f=findNode(P,d.id); if(f){ f.start=d._s; f.end=d._e; } }); } else renderTimeline(); } // commit through apply() (R2); a no-move drag just re-renders to snap back. E1: hideTip() covers both the commit and no-move paths

/* =====================  ROW DRAG-REORDER  ===================== */
let rowDrag=null;
function clearDrop(){ document.querySelectorAll('.dropBefore,.dropAfter,.dropInto').forEach(x=>x.classList.remove('dropBefore','dropAfter','dropInto')); }
function onRowDragStart(e){
  e.preventDefault();
  const featEl=e.target.closest('.featRow'); if(!featEl) return;
  rowDrag={ snid:featEl.dataset.nid, target:null, lastX:e.clientX, lastY:e.clientY, raf:0 };
  const g=featEl.cloneNode(true); g.classList.add('rowGhost'); g.style.pointerEvents='none'; g.style.width=featEl.offsetWidth+"px"; g.style.left=(e.clientX-18)+"px"; g.style.top=(e.clientY-14)+"px";
  document.body.appendChild(g); rowDrag.ghost=g; document.body.style.userSelect='none';
  rowDrag.raf=requestAnimationFrame(rowDragAutoScroll);
  window.addEventListener('pointermove', onRowDragMove); window.addEventListener('pointerup', onRowDragUp);
}
/* §4 feature-drag: over a featRow → insert before/after it in ITS parent's children;
   over a container header (.modRow) → insert at the FRONT of that container's children;
   over the "เพิ่มฟีเจอร์" add-zone → APPEND into that container. Targets = containers at any depth. */
function rowDragEval(x,y){
  if(!rowDrag) return;
  clearDrop(); rowDrag.target=null;
  const under=document.elementFromPoint(x,y); if(!under||!under.closest) return;
  const row=under.closest('.featRow');
  if(row){ const rc=row.getBoundingClientRect(); const before=y<rc.top+rc.height/2; rowDrag.target={kind:'feat', refId:row.dataset.nid, before}; row.classList.add(before?'dropBefore':'dropAfter'); return; }
  const add=under.closest('.addFeat');
  if(add){ rowDrag.target={kind:'into', containerId:add.dataset.nid}; add.classList.add('dropInto'); return; }        // append into
  const mod=under.closest('.modRow');
  if(mod){ rowDrag.target={kind:'into', containerId:mod.dataset.nid, front:true}; mod.classList.add('dropInto'); }   // insert at front
}
function onRowDragMove(e){
  if(!rowDrag) return;
  rowDrag.lastX=e.clientX; rowDrag.lastY=e.clientY;
  rowDrag.ghost.style.left=(e.clientX-18)+"px"; rowDrag.ghost.style.top=(e.clientY-14)+"px";
  rowDragEval(e.clientX, e.clientY);
}
/* While dragging near the top/bottom edge of the left table viewport, scroll it
   (and keep the right pane in vertical sync) so distant modules stay reachable. */
function rowDragAutoScroll(){
  if(!rowDrag) return;
  if(!_dragging){ rowDrag.target=null; onRowDragUp(); return; }  // drag cancelled (e.g. pointercancel): abort + tear down, stop autoscroll
  const ls=el('leftScroll');
  if(ls){
    const r=ls.getBoundingClientRect(), EDGE=52, MAX=20, y=rowDrag.lastY; let dv=0;
    if(y<r.top+EDGE) dv=-Math.ceil(MAX*Math.min(1,(r.top+EDGE-y)/EDGE));
    else if(y>r.bottom-EDGE) dv=Math.ceil(MAX*Math.min(1,(y-(r.bottom-EDGE))/EDGE));
    if(dv){
      const prev=ls.scrollTop, max=ls.scrollHeight-ls.clientHeight;
      ls.scrollTop=Math.max(0, Math.min(max, prev+dv));
      if(ls.scrollTop!==prev){ const rs=el('rightScroll'); if(rs) rs.scrollTop=ls.scrollTop; rowDragEval(rowDrag.lastX, rowDrag.lastY); }
    }
  }
  rowDrag.raf=requestAnimationFrame(rowDragAutoScroll);
}
function onRowDragUp(){
  window.removeEventListener('pointermove', onRowDragMove); window.removeEventListener('pointerup', onRowDragUp);
  if(!rowDrag) return; document.body.style.userSelect=''; // idempotent: a second invocation is a safe no-op
  if(rowDrag.raf) cancelAnimationFrame(rowDrag.raf);
  if(rowDrag.ghost) rowDrag.ghost.remove(); clearDrop();
  const d=rowDrag; rowDrag=null; if(!d.target) return;
  moveFeature(d.snid, d.target);
}
function moveFeature(srcId, target){
  if(target.kind==='feat' && target.refId===srcId) return;                    // dropped on itself → no-op
  apply(P=>{
    const feat=findNode(P,srcId); if(!feat || feat.kind!=="feature") return;
    if(target.kind==='feat'){
      const refPar=findParent(P,target.refId); const arr=refPar?refPar.children:P.modules;
      if(arr.findIndex(n=>n&&n.id===target.refId)<0) return;                   // F4: validate the drop ref BEFORE removing src (mirror the 'into' branch) — invalid ref ⇒ tree untouched
      removeNode(P,srcId);
      let idx=arr.findIndex(n=>n&&n.id===target.refId); if(idx<0) return;      // re-locate after removal (index may have shifted)
      if(!target.before) idx+=1; if(idx<0) idx=0; if(idx>arr.length) idx=arr.length;
      arr.splice(idx,0,feat);
      if(refPar) revealInto(refPar);
    } else { // into a container
      const C=findNode(P,target.containerId); if(!C || C.kind!=="container") return;
      removeNode(P,srcId);
      if(!Array.isArray(C.children)) C.children=[];
      if(target.front) C.children.unshift(feat); else C.children.push(feat);
      revealInto(C);                                                          // R6: expand the container we dropped INTO
    }
    return {flash:srcId};
  });
}

/* =====================  MODULE DRAG-REORDER (siblings only, §4)  =====================
   v1.0.4 module grip drag reorders among SIBLINGS of the same parent ONLY (cross-level moves
   are the stage-2 indent/outdent buttons). A dragged container moves as a whole node — its
   subtree travels with it. Reuses elementFromPoint hit-testing + edge auto-scroll. */
let modDrag=null;
function clearModDrop(){ document.querySelectorAll('.modDropBefore,.modDropAfter,.dropBefore,.dropAfter').forEach(x=>x.classList.remove('modDropBefore','modDropAfter','dropBefore','dropAfter')); }
/* Climb from a hovered node to the ancestor that is a SIBLING of the dragged node (shares its
   parent). Returns that sibling id, or null when the hover sits in a different subtree/level. */
function siblingAncestor(P, hoverId, draggedId){
  const dpar=findParent(P,draggedId), dparId=dpar?dpar.id:null;
  let cur=hoverId;
  while(cur){
    const par=findParent(P,cur), parId=par?par.id:null;
    if(parId===dparId) return cur;                        // cur shares dragged's parent ⇒ a sibling
    if(!par) return null;                                 // reached a root whose parent differs ⇒ different subtree
    cur=par.id;
  }
  return null;
}
function onModDragStart(e){
  e.preventDefault();
  const modEl=e.target.closest('.modRow'); if(!modEl) return;
  const P=proj(), id=modEl.dataset.nid; if(!findNode(P,id)) return;
  modDrag={ id, target:null, lastX:e.clientX, lastY:e.clientY, raf:0, ghost:null };
  const g=modEl.cloneNode(true); g.classList.add('modGhost'); g.style.pointerEvents='none'; g.style.width=modEl.offsetWidth+"px"; g.style.left=(e.clientX-18)+"px"; g.style.top=(e.clientY-14)+"px";
  document.body.appendChild(g); modDrag.ghost=g; document.body.style.userSelect='none';
  modDrag.raf=requestAnimationFrame(modDragAutoScroll);
  window.addEventListener('pointermove', onModDragMove); window.addEventListener('pointerup', onModDragUp);
}
function onModDragMove(e){
  if(!modDrag) return;
  modDrag.lastX=e.clientX; modDrag.lastY=e.clientY;
  modDrag.ghost.style.left=(e.clientX-18)+"px"; modDrag.ghost.style.top=(e.clientY-14)+"px";
  modDragEval(e.clientX, e.clientY);
}
/* Mark a drop target ONLY when the hovered row resolves to a SIBLING of the dragged node. */
function modDragEval(x,y){
  if(!modDrag) return;
  clearModDrop(); modDrag.target=null;
  const P=proj(); const under=document.elementFromPoint(x,y); if(!under||!under.closest) return;
  const rowEl=under.closest('.modRow,.featRow,.addFeat'); if(!rowEl||!rowEl.dataset.nid) return;
  const sibId=siblingAncestor(P, rowEl.dataset.nid, modDrag.id); if(!sibId || sibId===modDrag.id) return;
  const rc=rowEl.getBoundingClientRect(), before=y<rc.top+rc.height/2;
  modDrag.target={sibId, before};
  const sibRow=el("leftBody").querySelector('.modRow[data-nid="'+cssEsc(sibId)+'"], .featRow[data-nid="'+cssEsc(sibId)+'"]');
  const mark=sibRow||rowEl;
  if(mark.classList.contains('modRow')) mark.classList.add(before?'modDropBefore':'modDropAfter');
  else mark.classList.add(before?'dropBefore':'dropAfter');
}
/* Edge auto-scroll the left pane while dragging; keep the right pane's scrollTop mirrored. */
function modDragAutoScroll(){
  if(!modDrag) return;
  if(!_dragging){ modDrag.target=null; onModDragUp(); return; }  // drag cancelled (e.g. pointercancel): abort + tear down, stop autoscroll
  const ls=el('leftScroll');
  if(ls){
    const r=ls.getBoundingClientRect(), EDGE=52, MAX=20, y=modDrag.lastY; let dv=0;
    if(y<r.top+EDGE) dv=-Math.ceil(MAX*Math.min(1,(r.top+EDGE-y)/EDGE));
    else if(y>r.bottom-EDGE) dv=Math.ceil(MAX*Math.min(1,(y-(r.bottom-EDGE))/EDGE));
    if(dv){
      const prev=ls.scrollTop, max=ls.scrollHeight-ls.clientHeight;
      ls.scrollTop=Math.max(0, Math.min(max, prev+dv));
      if(ls.scrollTop!==prev){ const rs=el('rightScroll'); if(rs) rs.scrollTop=ls.scrollTop; modDragEval(modDrag.lastX, modDrag.lastY); }
    }
  }
  modDrag.raf=requestAnimationFrame(modDragAutoScroll);
}
function onModDragUp(){
  window.removeEventListener('pointermove', onModDragMove); window.removeEventListener('pointerup', onModDragUp);
  if(!modDrag) return; document.body.style.userSelect=''; // idempotent: a second invocation is a safe no-op
  if(modDrag.raf) cancelAnimationFrame(modDrag.raf);
  if(modDrag.ghost) modDrag.ghost.remove(); clearModDrop();
  const d=modDrag; modDrag=null; if(!d.target) return;
  moveNodeBeside(d.id, d.target.sibId, d.target.before);
}
/* Reorder `id` before/after a SIBLING (`sibId`) within their shared parent's children (or the
   root list). Drop-in-place ⇒ no-op (no save/render). */
function moveNodeBeside(id, sibId, before){
  if(!id || !sibId || id===sibId) return;
  const P=proj();
  const par=findParent(P,id), spar=findParent(P,sibId);
  if((par?par.id:null)!==(spar?spar.id:null)) return;                         // siblings-only guard
  const arr=par?par.children:P.modules;
  const from=arr.findIndex(n=>n&&n.id===id), ref=arr.findIndex(n=>n&&n.id===sibId);
  if(from<0||ref<0) return;
  let to=ref+(before?0:1); if(from<to) to-=1;                                 // account for the removal shift
  if(to===from) return;                                                       // already in place
  apply(P2=>{ const a=findParent(P2,id), list=a?a.children:P2.modules; const g=removeNode(P2,id); if(!g) return; let t=list.findIndex(n=>n&&n.id===sibId); if(t<0){ list.push(g); return {flash:id}; } if(!before) t+=1; list.splice(t,0,g); return {flash:id}; }); // R6: flash the reordered module
}

/* =====================  COLUMN DRAG-REORDER  ===================== */
let colDrag=null;
function clearColMark(){ document.querySelectorAll('.colHead.insL,.colHead.insR').forEach(x=>x.classList.remove('insL','insR')); }
function onColDragStart(e){
  if(e.target.closest('.delcol')||e.target.closest('.colResize')||e.target.closest('.colTool')) return;
  const head=e.currentTarget; if(!head.dataset.key) return;
  colDrag={ key:head.dataset.key, head, target:null, ghost:null, startX:e.clientX, moved:false };
  document.body.style.userSelect='none';
  window.addEventListener('pointermove', onColDragMove); window.addEventListener('pointerup', onColDragUp);
}
function onColDragMove(e){
  if(!colDrag) return;
  if(!colDrag.moved && Math.abs(e.clientX-colDrag.startX)<4) return;
  colDrag.moved=true;
  if(!colDrag.ghost){ const g=colDrag.head.cloneNode(true); g.classList.add('colGhost'); g.style.width=colDrag.head.offsetWidth+"px"; document.body.appendChild(g); colDrag.ghost=g; }
  colDrag.ghost.style.left=(e.clientX-30)+"px"; colDrag.ghost.style.top=(e.clientY-14)+"px"; colDrag.ghost.style.pointerEvents='none';
  const under=document.elementFromPoint(e.clientX,e.clientY);
  const head=under&&under.closest?under.closest('.colHead'):null;
  clearColMark(); colDrag.target=null;
  if(head && head.dataset.key && head.dataset.key!==colDrag.key){
    const rc=head.getBoundingClientRect(); const before=e.clientX<rc.left+rc.width/2;
    colDrag.target={key:head.dataset.key,before}; head.classList.add(before?'insL':'insR');
  }
}
function onColDragUp(){
  window.removeEventListener('pointermove', onColDragMove); window.removeEventListener('pointerup', onColDragUp);
  if(!colDrag) return; document.body.style.userSelect=''; // idempotent: a second invocation is a safe no-op
  if(colDrag.ghost) colDrag.ghost.remove(); clearColMark();
  const d=colDrag; colDrag=null; if(!d.moved||!d.target) return;
  moveColumn(d.key, d.target.key, d.target.before);
}
function moveColumn(srcKey, tgtKey, before){
  const P=proj(); const order=(P.colOrder||[]).slice();
  const si=order.indexOf(srcKey); if(si<0) return; order.splice(si,1);
  let ti=order.indexOf(tgtKey); if(ti<0) return; if(!before) ti+=1;
  order.splice(ti,0,srcKey); P.colOrder=order; Store.save(); renderBoard();
}

/* =====================  COLUMN RESIZE (local-only widths)  ===================== */
/* Widths live in ui.colW (localStorage) only — never written to proj()/customCols/doc. */
let colResize=null;
function onColResizeStart(e){
  e.stopPropagation(); e.preventDefault();           // don't let the header start a reorder drag
  const head=e.target.closest('.colHead'); if(!head||!head.dataset.key) return;
  const lh=el("leftHead"); const idx=[...lh.children].indexOf(head);
  colResize={ key:head.dataset.key, head, idx, handle:e.target, startX:e.clientX, startW:head.getBoundingClientRect().width, w:0 };
  e.target.classList.add('dragging');
  document.body.style.userSelect='none'; document.body.style.cursor='col-resize'; hideTip();
  window.addEventListener('pointermove', onColResizeMove); window.addEventListener('pointerup', onColResizeUp);
}
function onColResizeMove(e){
  if(!colResize) return;
  let w=Math.round(colResize.startW + (e.clientX-colResize.startX));
  w=Math.max(60, Math.min(640, w)); colResize.w=w;
  colResize.head.style.width=w+'px';                 // live: header
  const lb=el("leftBody");
  lb.querySelectorAll('.featRow .rowMain').forEach(rm=>{ const cell=rm.children[colResize.idx]; if(cell) cell.style.width=w+'px'; }); // live: every cell in this column (G2: cells now live inside .rowMain, not as direct featRow children)
  const total=[...el("leftHead").children].reduce((a,h)=>a+h.getBoundingClientRect().width,0);
  lb.querySelectorAll('.modRow').forEach(r=> r.style.width=total+'px'); // keep module bands spanning full width
  if(ui.wrapTxt) syncRowHeights();                   // content-driven row height follows the new width live
}
function onColResizeUp(){
  window.removeEventListener('pointermove', onColResizeMove); window.removeEventListener('pointerup', onColResizeUp);
  if(!colResize) return;                             // idempotent: a second invocation is a safe no-op
  document.body.style.userSelect=''; document.body.style.cursor='';
  if(colResize.handle) colResize.handle.classList.remove('dragging');
  const w=colResize.w || Math.round(colResize.head.getBoundingClientRect().width);
  if(w){ ui.colW=ui.colW||{}; (ui.colW[PID]=ui.colW[PID]||{})[colResize.key]=w; saveUi(); } // FIX: write width under the current project id (per-project namespace)
  colResize=null;
  renderGrid(); renderTimeline(); applyWrap();        // settle: re-render both panes and re-sync heights
}
function onWrapToggle(e){
  e.stopPropagation();
  ui.wrapTxt=!ui.wrapTxt; saveUi(); hideTip();
  const b=e.currentTarget; if(b) b.classList.toggle('on', ui.wrapTxt);
  applyWrap();
}

/* =====================  EXCEL EXPORT / IMPORT  ===================== */
function exportXlsx(){
  if(typeof XLSX==="undefined"){ toast("ไลบรารี Excel โหลดไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)"); return; }
  const P=proj(), customLabels=P.customCols.map(c=>c.label);
  const header=["Module","Feature ID","Feature","Description","Start","End","Status","Remark",...customLabels];
  const aoa=[header];
  // §4: rows in flatten order; Module column = full container path "A › B › C".
  const path=[];
  (function rec(nodes){
    (nodes||[]).forEach(n=>{
      if(!n) return;
      if(n.kind==="container"){ path.push(n.name); rec(n.children||[]); path.pop(); }
      else aoa.push([path.join(" › "),n.fid||"",n.name,n.description||"",n.start,n.end,stById(n.status).en,n.remark||"",...P.customCols.map(c=>(n.custom&&n.custom[c.id])||"")]);
    });
  })(P.modules);
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=[{wch:26},{wch:11},{wch:30},{wch:40},{wch:12},{wch:12},{wch:13},{wch:18},...customLabels.map(()=>({wch:18}))];
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Timeline");
  XLSX.writeFile(wb, safeName(P.code||P.name)+"_Timeline.xlsx"); toast("ส่งออก Excel แล้ว");
}
function onImportFile(e){
  const file=e.target.files[0]; if(!file) return;
  if(typeof XLSX==="undefined"){ toast("ไลบรารี Excel โหลดไม่สำเร็จ"); return; }
  const reader=new FileReader();
  reader.onload=ev=>{ try{ importWorkbook(ev.target.result); }catch(err){ console.error(err); toast("อ่านไฟล์ไม่สำเร็จ — ตรวจหัวคอลัมน์อีกครั้ง"); } el("fileInput").value=""; };
  reader.readAsArrayBuffer(file);
}
const ALIASES={
  module:["module","โมดูล","ระบบ","ระบบ (system)","system","section","หมวด"],
  fid:["feature id","fid","id","รหัส","feature_id"],
  name:["feature","feature name","ชื่อฟีเจอร์","ฟีเจอร์","รายการ","task","งาน","ชื่อ"],
  description:["description","คำอธิบาย","รายละเอียด","desc"],
  start:["start","start date","เริ่ม","วันเริ่ม","วันที่เริ่ม","start_date","begin"],
  end:["end","end date","สิ้นสุด","วันสิ้นสุด","วันที่สิ้นสุด","finish","end_date"],
  status:["status","สถานะ"],
  remark:["remark","remarks","หมายเหตุ","note","notes"],
};
function matchKey(h){ const k=String(h).trim().toLowerCase(); for(const std in ALIASES){ if(ALIASES[std].includes(k)) return std; } return null; }
function toISO(v){
  if(v==null||v==="") return "";
  if(v instanceof Date) return iso(new Date(v.getFullYear(),v.getMonth(),v.getDate()));
  if(typeof v==="number"){ const d=new Date(Math.round((v-25569)*DAY)); return iso(new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())); }
  let s=String(v).trim();
  let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); if(m){ let y=+m[1]; if(y>2400)y-=543; return y+"-"+String(+m[2]).padStart(2,"0")+"-"+String(+m[3]).padStart(2,"0"); }
  m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); if(m){ let y=+m[3]; if(y<100)y+=2000; if(y>2400)y-=543; return y+"-"+String(+m[2]).padStart(2,"0")+"-"+String(+m[1]).padStart(2,"0"); }
  const d=new Date(s); return isNaN(d)?"":iso(new Date(d.getFullYear(),d.getMonth(),d.getDate()));
}
function importWorkbook(buf){
  const wb=XLSX.read(buf,{type:"array"}), ws=wb.Sheets[wb.SheetNames[0]];
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:""});
  let hi=-1; for(let i=0;i<Math.min(aoa.length,8);i++){ if(aoa[i].filter(c=>matchKey(c)).length>=2){ hi=i; break; } }
  if(hi<0){ toast("ไม่พบหัวคอลัมน์ที่รองรับ"); return; }
  const headers=aoa[hi], map={}, customDefs=[];
  headers.forEach((h,ci)=>{ if(String(h).trim()==="") return; const k=matchKey(h); if(k) map[k]=ci; else customDefs.push({id:"c"+(_seq++),label:String(h).trim(),w:150,kind:"text",col:ci}); });
  if(map.name==null){ toast("ต้องมีคอลัมน์ Feature/ชื่อ"); return; }
  const groups=new Map();
  for(let i=hi+1;i<aoa.length;i++){
    const row=aoa[i]; if(!row||row.every(c=>String(c).trim()==="")) continue;
    const modName=(map.module!=null?String(row[map.module]).trim():"")||"Imported";
    const name=String(row[map.name]).trim(); if(!name) continue;
    let s=map.start!=null?toISO(row[map.start]):"", e=map.end!=null?toISO(row[map.end]):"";
    if(!s&&!e){ const t=today(); s=iso(t); e=iso(addDays(t,7)); } else if(!e) e=s; else if(!s) s=e;
    const f={id:nid(),kind:"feature",fid:map.fid!=null?String(row[map.fid]).trim():"",name,description:map.description!=null?String(row[map.description]).trim():"",start:s,end:e,status:map.status!=null?statusFromText(row[map.status]):"not_started",remark:map.remark!=null?String(row[map.remark]).trim():"",custom:{}};
    customDefs.forEach(cd=> f.custom[cd.id]=String(row[cd.col]??"").trim());
    if(!groups.has(modName)) groups.set(modName,[]); groups.get(modName).push(f);
  }
  const P=proj();
  P.customCols=customDefs.map(({id,label,w,kind})=>({id,label,w,kind}));
  P.colOrder=DEFAULT_ORDER.concat(P.customCols.map(c=>"c:"+c.id));
  P.modules=[]; let ci=0;
  // import stays flat (path strings arrive as container names; no round-trip parsing) — build root containers
  groups.forEach((feats,name)=>{ P.modules.push({id:nid(),kind:"container",name,description:"",color:ci++%PALETTE.length,collapsed:false,children:feats}); });
  P.docVer=2; P.progressOrder=P.modules.map(m=>m.id);
  normalizeTree(P); Store.save(); renderTab(ui.tab);
  toast(`นำเข้าแล้ว: ${P.modules.length} โมดูล · ${[...groups.values()].reduce((a,b)=>a+b.length,0)} ฟีเจอร์`);
}

/* =====================  PNG EXPORT  ===================== */
async function exportPng(){
  if(typeof html2canvas==="undefined"){ toast("ไลบรารี PNG โหลดไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)"); return; }
  const board=el("board"), L=el("leftScroll"), R=el("rightScroll");
  const pl=L.scrollTop, pr=R.scrollLeft; L.scrollTop=R.scrollTop=0; R.scrollLeft=0;
  /* §1.10: exports FORCE LIGHT — stamp data-theme=light + re-render synchronously so the inline bar fills
     capture as their light pastels (the dark tokens + dark bar branch never leak into the PNG). Restored in
     `finally`. renderBoard re-runs the full R10 order (grid → timeline → wrap/heights → sticky labels). */
  const root=document.documentElement, prevTheme=root.getAttribute("data-theme"), forcedLight=prevTheme!=="light";
  if(forcedLight){ root.setAttribute("data-theme","light"); renderBoard(); L.scrollTop=R.scrollTop=0; R.scrollLeft=0; }
  updateStickyLabels();                                 // scroll is reset to 0 → clears sliding-label shifts so the snapshot shows labels at bar starts
  board.classList.add('exporting');
  const w=board.scrollWidth, h=Math.max(el("leftBody").scrollHeight, el("bars").scrollHeight)+el("leftHead").offsetHeight+4;
  toast("กำลังสร้างภาพ PNG…");
  try{
    const c=await html2canvas(board,{backgroundColor:"#ffffff",scale:2,width:w,height:h,windowWidth:w+40,windowHeight:h+40,scrollX:0,scrollY:0,logging:false});
    const a=document.createElement('a'); a.download=safeName(proj().code||proj().name)+"_Timeline.png"; a.href=c.toDataURL("image/png"); a.click(); toast("ส่งออก PNG แล้ว");
  }catch(err){ console.error(err); toast("สร้าง PNG ไม่สำเร็จ"); }
  finally{
    board.classList.remove('exporting');
    if(forcedLight){ root.setAttribute("data-theme", prevTheme||effectiveTheme()); renderBoard(); } // restore the user's theme + re-render the inline bar fills
    L.scrollTop=R.scrollTop=pl; R.scrollLeft=pr; updateStickyLabels();                              // restore scroll → re-apply the slide immediately
  }
}

/* =====================  MODAL / TOAST  ===================== */
function openModal(html){
  const r=el("modalRoot"); r.innerHTML=`<div class="overlay" id="ovl"><div class="modal">${html}</div></div>`; r.style.display="block";
  el("ovl").addEventListener('mousedown', e=>{ if(e.target.id==="ovl") closeModal(); });
  r.querySelectorAll('[data-act="cancel"]').forEach(b=> b.onclick=closeModal);
}
function closeModal(){ const r=el("modalRoot"); if(r){ r.style.display="none"; r.innerHTML=""; } }
let toastT;
function toast(m){ const t=el("toast"); t.textContent=m; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),2400); }

/* =====================  BACKUP / RESTORE  ===================== */
function downloadBackupFile(){
  const blob = new Blob([JSON.stringify(DB,null,2)], {type:"application/json"});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = "adeptio-gantt-backup-" + iso(today()) + ".json"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 3000); toast("ดาวน์โหลดไฟล์สำรองแล้ว");
}
function restoreFromObject(obj, label){
  if(!obj || !Array.isArray(obj.projects)){ toast("ไฟล์สำรองไม่ถูกต้อง"); return; }
  if(!confirm("กู้คืนข้อมูล" + (label?(" จาก"+label):"") + "? ข้อมูลปัจจุบันทั้งหมดจะถูกแทนที่")) return;
  DB = obj; migrateDB(DB); MEM = DB; Store.save();      // migrate a possibly-v1 backup → tree, then persist (+ mirror) + cloud push
  PID = null; closeModal(); location.hash = ""; route(); toast("กู้คืนข้อมูลเรียบร้อย");
}
function restoreBackupFile(file){
  const r = new FileReader();
  r.onload = e=>{ try{ restoreFromObject(JSON.parse(e.target.result), "ไฟล์"); }catch(err){ toast("อ่านไฟล์ไม่สำเร็จ"); } };
  r.readAsText(file);
}
function fmtTs(ts){ try{ return new Date(ts).toLocaleString(); }catch(e){ return ts; } }

async function backupModal(){
  const cloud = cloudOn();
  openModal(`
    <h2>สำรอง / กู้คืนข้อมูล</h2>
    <div class="msub">Backup &amp; Restore — ${cloud?"เชื่อมต่อคลาวด์ (Cloudflare) แล้ว":"โหมดไฟล์ · ยังไม่ได้ตั้งค่าคลาวด์"}</div>

    <div class="bkSection">
      <div class="bkHd">สำรองข้อมูล</div>
      <div class="bkRow">
        <button class="btn sm" id="bk_download">${IC.exp}<span>ดาวน์โหลดไฟล์สำรอง (.json)</span></button>
        ${cloud?`<button class="btn sm primary" id="bk_now">${IC.cloud}<span>สำรองขึ้นคลาวด์ + ไดรฟ์ตอนนี้</span></button>`:""}
      </div>
      <div class="bkHint">บันทึกไฟล์ .json ไว้บน Google Drive / Dropbox / OneDrive ได้ด้วยตนเอง${cloud?" · หรือให้เซิร์ฟเวอร์อัปโหลดอัตโนมัติ (รายวัน/รายสัปดาห์)":""}</div>
    </div>

    <div class="bkSection">
      <div class="bkHd">กู้คืนข้อมูล</div>
      <div class="bkRow">
        <button class="btn sm" id="bk_pick">${IC.imp}<span>กู้คืนจากไฟล์ (.json)</span></button>
        ${cloud?`<button class="btn sm" id="bk_remote">${IC.restore}<span>กู้คืนไฟล์ล่าสุดจากไดรฟ์</span></button>`:""}
        <input type="file" id="bk_file" accept="application/json,.json" style="display:none"/>
      </div>
      ${cloud
        ? `<div class="bkHd2">ประวัติสำรองบนเซิร์ฟเวอร์</div><div id="bk_list" class="bkList"><div class="bkEmpty">กำลังโหลด…</div></div>`
        : `<div class="bkHint">ตั้งค่า <b>API_BASE</b> ใน app.js ให้ชี้ไปที่ Cloudflare Worker เพื่อเปิดการสำรองอัตโนมัติและการกู้คืนจากไดรฟ์</div>`}
    </div>

    <div class="modActsRow"><button class="btn" data-act="cancel">ปิด</button></div>`);

  el("bk_download").onclick = downloadBackupFile;
  el("bk_pick").onclick = ()=> el("bk_file").click();
  el("bk_file").onchange = e=>{ const f=e.target.files[0]; if(f) restoreBackupFile(f); };

  if(cloud){
    el("bk_now").onclick = async ()=>{
      el("bk_now").disabled = true; toast("กำลังสำรองข้อมูล…");
      try{
        await cloudPush();
        const res = await fetch(apiUrl("/api/backups?period=manual"), { method:"POST", headers:apiHeaders() });
        const j = res.ok ? await res.json() : null;
        if(j){ const r=j.remote||{}; const ok=Object.keys(r).filter(k=>r[k]==="ok"); toast("สำรองแล้ว"+(ok.length?(" → "+ok.join(", ")):" (เซิร์ฟเวอร์)")); }
        else toast("สำรองไม่สำเร็จ");
      }catch(e){ toast("สำรองไม่สำเร็จ"); }
      backupModal();
    };
    el("bk_remote").onclick = async ()=>{
      if(!confirm("กู้คืนจากไฟล์ล่าสุดบนไดรฟ์? ข้อมูลปัจจุบันจะถูกแทนที่")) return;
      toast("กำลังกู้คืนจากไดรฟ์…");
      try{
        const res = await fetch(apiUrl("/api/restore-remote"), { method:"POST", headers:apiHeaders() });
        if(res.ok){ await cloudPull(true); closeModal(); toast("กู้คืนจากไดรฟ์แล้ว"); }
        else toast("กู้คืนไม่สำเร็จ · ไม่พบไฟล์หรือยังไม่ได้ตั้งค่าผู้ให้บริการ");
      }catch(e){ toast("กู้คืนไม่สำเร็จ"); }
    };
    try{
      const res = await fetch(apiUrl("/api/backups"), { headers:apiHeaders() });
      const rows = res.ok ? await res.json() : [];
      const box = el("bk_list");
      if(box){
        box.innerHTML = rows.length
          ? rows.map(b=>`<div class="bkItem"><span class="bkMeta"><b>${esc(b.period)}</b> · ${esc(fmtTs(b.ts))}</span><span class="grow"></span><button class="btn sm" data-bid="${esc(b.id)}">กู้คืน</button></div>`).join("")
          : `<div class="bkEmpty">ยังไม่มีการสำรองบนเซิร์ฟเวอร์</div>`;
        box.querySelectorAll('[data-bid]').forEach(btn=> btn.onclick = async ()=>{
          if(!confirm("กู้คืนข้อมูลจากสำรองนี้? ข้อมูลปัจจุบันจะถูกแทนที่")) return;
          const r2 = await fetch(apiUrl("/api/restore?id="+encodeURIComponent(btn.dataset.bid)), { method:"POST", headers:apiHeaders() });
          if(r2.ok){ await cloudPull(true); closeModal(); toast("กู้คืนแล้ว"); } else toast("กู้คืนไม่สำเร็จ");
        });
      }
    }catch(e){ const box=el("bk_list"); if(box) box.innerHTML = `<div class="bkEmpty">โหลดประวัติไม่สำเร็จ</div>`; }
  }
}

/* =====================  PROJECT NOTES (v1.0.5 F2) =====================
   Storage (spec §4.7): DB.notes[pid] = { business:[{date,html}], technical:[{date,html}], log:[{ts,action,col,date}] }
   — a SEPARATE top-level doc section (never inside projects[]), so every D1 snapshot backs it up.
   DOM CONTRACT between this core and renderNotesBody() (UI):
   - each column panel:   .noteCol[data-col="business"|"technical"]  (exactly one .active at a time)
   - each day's editor:   .noteEdit[contenteditable][data-col][data-date="YYYY-MM-DD"] (+ data-today="1" on the lazy today region)
   - each divider:        .dateDiv[data-date] holding .dateChip + .binBtn
   The engine below owns persistence; the UI owns rendering + toolbars + bin/popover/highlight. */
const NOTE_TAGS = new Set(["B","STRONG","I","EM","SPAN","DIV","P","BR","FONT","UL","LI"]);
const NOTE_HI = "#fff3a8";                       // highlight yellow (N11)
const NOTE_SECTION_CAP = 20000;                  // stored-html chars per day section
let notesTab = "business", _notesSaveT = null, _notesCapWarned = false;

/* Sanitizer (N6) — the XSS gate for html round-tripped through the doc/cloud. Runs on SAVE and on RENDER.
   Parses in an INERT DOMParser document: assigning untrusted html to a live-document detached div still
   starts <img src> fetches and fires their inline onerror DURING sanitization — an adopted hostile doc
   must never execute anything before the strip. DOMParser documents load nothing and fire no handlers. */
function sanitizeNoteHtml(html){
  const box=new DOMParser().parseFromString(String(html==null?"":html), "text/html").body;
  (function clean(node){
    [...node.childNodes].forEach(c=>{
      if(c.nodeType===3) return;                                   // text → keep
      if(c.nodeType!==1){ c.remove(); return; }                    // comments etc. → drop
      const tag=c.tagName.toUpperCase();
      if(tag==="SCRIPT"||tag==="STYLE"||tag==="IFRAME"){ c.remove(); return; }  // dropped WITH content
      if(!NOTE_TAGS.has(tag)){                                     // disallowed → unwrap, keep cleaned children
        clean(c);
        const par=c.parentNode; while(c.firstChild) par.insertBefore(c.firstChild, c);
        par.removeChild(c); return;
      }
      const color=c.style?c.style.color:"", bg=c.style?c.style.backgroundColor:"";
      const fontColor=(tag==="FONT")?c.getAttribute("color"):null;
      [...c.attributes].forEach(a=>c.removeAttribute(a.name));     // kills on*, class, href, data-*, …
      if(color) c.style.color=color;
      if(bg && bg!=="transparent" && bg!=="rgba(0, 0, 0, 0)") c.style.backgroundColor=bg;  // keep highlight, drop un-highlight leftovers
      if(fontColor) c.setAttribute("color",fontColor);
      clean(c);
    });
  })(box);
  return box.innerHTML;
}
function stripNoteText(html){ return (new DOMParser().parseFromString(String(html||""), "text/html").body.textContent||"").trim(); } // inert parse — counts/badges must never materialize stored html either

/* ---- data accessors ---- */
function notesOf(pid){
  if(!DB.notes || typeof DB.notes!=="object" || Array.isArray(DB.notes)) DB.notes={};
  let n=DB.notes[pid]; if(!n || typeof n!=="object") n=DB.notes[pid]={};
  if(!Array.isArray(n.business)) n.business=[];
  if(!Array.isArray(n.technical)) n.technical=[];
  if(!Array.isArray(n.log)) n.log=[];
  return n;
}
function notesCount(pid){ const n=notesOf(pid), c=a=>a.filter(s=>s && stripNoteText(s.html).length).length; return c(n.business)+c(n.technical); }
function notesLogAdd(pid, entry){ const n=notesOf(pid); n.log.unshift(entry); if(n.log.length>200) n.log.length=200; }
function notesOpen(){ const ov=el("notesOverlay"); return !!(ov && ov.style.display==="flex"); }

/* ---- autosave engine: input → 600ms debounce → sanitize+collect → Store.save (which stamps F1 + cloud-pushes) ---- */
function collectNotesFromDom(){
  const out={business:[],technical:[]};
  document.querySelectorAll("#notesOverlay .noteEdit").forEach(ed=>{
    if(!(ed.textContent||"").trim()) return;                       // empty sections prune on save
    let html=sanitizeNoteHtml(ed.innerHTML);
    if(html.length>NOTE_SECTION_CAP){ html=html.slice(0,NOTE_SECTION_CAP); if(!_notesCapWarned){ _notesCapWarned=true; toast("โน้ตเกิน "+NOTE_SECTION_CAP.toLocaleString()+" ตัวอักษรต่อวัน — ตัดส่วนเกินออก"); } }
    const col=ed.dataset.col, date=ed.dataset.date;
    if(out[col] && date) out[col].push({date, html});
  });
  const newestFirst=(a,b)=> a.date<b.date?1:(a.date>b.date?-1:0);
  out.business.sort(newestFirst); out.technical.sort(newestFirst);
  return out;
}
function notesMarkDirty(){ notesChip("saving"); clearTimeout(_notesSaveT); _notesSaveT=setTimeout(notesFlush, 600); }
function notesFlush(){
  clearTimeout(_notesSaveT); _notesSaveT=null;
  if(!PID || !notesOpen()) return;
  const n=notesOf(PID), got=collectNotesFromDom();
  n.business=got.business; n.technical=got.technical;
  Store.save();
  notesChip("saved"); notesSyncCounts();
}
function notesChip(state){
  const c=el("notesChip"); if(!c) return;
  if(state==="saving"){ c.textContent="กำลังบันทึก…"; c.className="saveChip"; }
  else { c.textContent="บันทึกแล้ว ✓"; c.className="saveChip saved"; }
}
function notesSyncCounts(){
  if(PID){ const cnt=notesCount(PID), num=el("sumNotesCount"), wrap=el("sumNotesBadge");
    if(num) num.textContent=cnt;
    if(wrap) wrap.style.display=cnt?"":"none"; }     // spec §4.1: badge only when notes exist — never "โน้ต (0)"
  const n=PID?notesOf(PID):null; if(!n) return;
  const c=a=>a.filter(s=>s && stripNoteText(s.html).length).length;
  const liveCol=col=>{ let k=0; document.querySelectorAll('#notesOverlay .noteEdit[data-col="'+col+'"]').forEach(ed=>{ if((ed.textContent||"").trim()) k++; }); return k; };
  const b=el("notesTabCountBiz"), t=el("notesTabCountTech");
  if(b) b.textContent="("+(notesOpen()?liveCol("business"):c(n.business))+")";
  if(t) t.textContent="("+(notesOpen()?liveCol("technical"):c(n.technical))+")";
}

/* ---- deletion + action log (N10): the UI's bin-confirm calls this AFTER removing the section's DOM ---- */
function notesDeleteSection(col, date){
  if(!PID) return;
  notesLogAdd(PID, {ts:nowIso(), action:"delete", col:col, date:date});
  notesFlush(); renderNotesLog();
  toast("ลบโน้ตแล้ว · บันทึกลง log");
}
function renderNotesLog(){
  const c=el("notesLogCount"), s=el("notesLogStrip"); if(!c||!s||!PID) return;
  const L=notesOf(PID).log;
  c.textContent=L.length;
  s.innerHTML=L.length
    ? L.map(e=> esc(fmtStamp(e.ts))+" · ลบโน้ต"+(e.col==="business"?"ธุรกิจ":"เทคนิค")+" "+esc(fmtStamp(e.date))).join("<br>")
    : "ยังไม่มีการลบ";
}

/* ---- overlay shell: root DIV is CREATED BY JS (index.html is frozen — N4) ---- */
function ensureNotesRoot(){ if(!el("notesOverlay")){ const d=document.createElement("div"); d.id="notesOverlay"; document.body.appendChild(d); } }
function openNotes(){
  if(!PID) return;
  ensureNotesRoot();
  const ov=el("notesOverlay"), P=proj(); if(!P) return;
  notesTab="business";
  ov.innerHTML=`
    <div class="notesModal" role="dialog" aria-modal="true" aria-label="โน้ตโครงการ">
      <div class="notesHead">
        <span class="notesTitle">โน้ตโครงการ · ${esc(P.name)}</span>
        <span class="saveChip saved" id="notesChip">บันทึกแล้ว ✓</span>
        <button class="logChip" id="notesLogChip" title="ประวัติการลบ (action log)">log (<span id="notesLogCount">0</span>)</button>
        <button class="closeX" id="notesClose" aria-label="ปิด">${IC.x}</button>
      </div>
      <div class="tabBar" role="tablist">
        <button class="tabBtn on" id="notesTabBiz" role="tab" aria-selected="true" data-col="business">ธุรกิจ · BUSINESS <span class="tabCount" id="notesTabCountBiz"></span></button>
        <button class="tabBtn" id="notesTabTech" role="tab" aria-selected="false" data-col="technical">เทคนิค · TECHNICAL <span class="tabCount" id="notesTabCountTech"></span></button>
      </div>
      <div class="logStrip" id="notesLogStrip"></div>
      <div class="notesBody" id="notesBody"></div>
    </div>`;
  ov.style.display="flex";
  requestAnimationFrame(()=>ov.classList.add("open"));
  el("notesClose").onclick=closeNotes;
  ov.onclick=e=>{ if(e.target===ov) closeNotes(); };
  el("notesTabBiz").onclick =()=>notesSwitchTab("business");
  el("notesTabTech").onclick=()=>notesSwitchTab("technical");
  el("notesLogChip").onclick=()=>{ renderNotesLog(); el("notesLogStrip").classList.toggle("open"); };
  renderNotesBody();
  notesApplyTab();
  renderNotesLog();
  notesSyncCounts();
}
function closeNotes(){
  if(_notesSaveT) notesFlush();                     // never lose a pending edit on close
  const ov=el("notesOverlay"); if(!ov || ov.style.display!=="flex") return;
  ov.classList.remove("open");
  setTimeout(()=>{ ov.style.display="none"; ov.innerHTML=""; }, 180);
  notesSyncCounts();
}
/* AUDIT FIX (major): route() knew nothing about the body-level overlay — browser Back/Forward while
   the popup was open orphaned it, dropped the pending debounce (PID already null), or worse flushed
   THIS project's DOM into the project the hash moved to. Called by route() BEFORE PID is reassigned,
   so the flush lands under the project the notes belong to; teardown is instant (no animation). */
function notesHardClose(){
  if(!notesOpen()) return;
  if(_notesSaveT) notesFlush();
  const ov=el("notesOverlay"); ov.classList.remove("open"); ov.style.display="none"; ov.innerHTML="";
}
function notesSwitchTab(col){
  if(col===notesTab) return;
  if(_notesSaveT) notesFlush();                     // pending edit flushes BEFORE the other panel shows
  notesTab=col; notesApplyTab();
}
function notesApplyTab(){
  document.querySelectorAll("#notesBody .noteCol").forEach(cEl=> cEl.classList.toggle("active", cEl.dataset.col===notesTab));
  [["notesTabBiz","business"],["notesTabTech","technical"]].forEach(([id,col])=>{
    const b=el(id); if(!b) return;
    b.classList.toggle("on", col===notesTab);
    b.setAttribute("aria-selected", col===notesTab ? "true" : "false");
  });
}

/* ===== WORKER-SLOT (v1.0.5 F2 UI): renderNotesBody =====
   Renders BOTH .noteCol panels into #notesBody per the DOM contract above, porting the approved
   prototype r4: sticky toolbar (B / I / bullets / highlight NOTE_HI / 6 foreColor swatches),
   newest-first date sections with dashed dividers, lazy today section, bin + glass confirm
   popover (calls notesDeleteSection(col,date) AFTER removing the section's DOM), plain-text
   paste, input → notesMarkDirty(). Private helpers are prefixed notesUi*. */
const NOTES_UI_COLORS = [                                   // toolbar text-colour palette (default = live ink token)
  {css:"var(--ink)", val:"__ink__"}, {css:"#9241ff", val:"#9241ff"}, {css:"#4f98ff", val:"#4f98ff"},
  {css:"#00ce83", val:"#00ce83"}, {css:"#ff9500", val:"#ff9500"}, {css:"#ff4a7b", val:"#ff4a7b"}
];
const notesUiInk = () => (getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#16181d");
const notesUiPd  = e => e.preventDefault();                 // mousedown-preventDefault keeps the editor selection alive when a toolbar control is pressed

function renderNotesBody(){
  const body=el("notesBody"); if(!body) return;
  body.innerHTML="";
  const n = PID ? notesOf(PID) : {business:[], technical:[]};
  body.appendChild(notesUiColumn("business",  "BUSINESS",  "โน้ตธุรกิจ", n.business  || []));   // business first (engine toggles .active)
  body.appendChild(notesUiColumn("technical", "TECHNICAL", "โน้ตเทคนิค", n.technical || []));
}
function notesUiColumn(col, eyebrow, label, arr){
  const wrap=document.createElement("div"); wrap.className="noteCol"; wrap.dataset.col=col;
  const head=document.createElement("div"); head.className="noteColHead";
  head.innerHTML='<span class="eyebrow">'+esc(eyebrow)+'</span><span class="noteColLab">'+esc(label)+'</span>';
  wrap.appendChild(head);
  const scroll=document.createElement("div"); scroll.className="colScroll";
  scroll.appendChild(notesUiToolbar());
  const tIso=iso(today());
  /* AUDIT FIX: flush() replaces the stored arrays with whatever the DOM holds, so EVERY stored
     section must render or it is silently deleted on the first autosave. Merge duplicates by date
     (join with <br>) and fold date-less/malformed strays into today — never drop content. */
  const byDate=new Map();
  arr.forEach(s=>{
    if(!s) return;
    const d=(s.date && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date))) ? s.date : tIso;
    const h=s.html||"";
    if(!byDate.has(d)) byDate.set(d, h);
    else if(stripNoteText(h).length) byDate.set(d, byDate.get(d) + (stripNoteText(byDate.get(d)).length?"<br>":"") + h);
  });
  const tHtml=byDate.get(tIso)||""; byDate.delete(tIso);
  const tDiv=notesUiDivider(col, tIso, true); tDiv.hidden = stripNoteText(tHtml).length===0;      // today divider hidden until there is content
  scroll.appendChild(tDiv);
  scroll.appendChild(notesUiEditor(col, tIso, tHtml, true));
  [...byDate.keys()].sort().reverse()                                                             // newest-first
     .forEach(d=>{ scroll.appendChild(notesUiDivider(col, d, false)); scroll.appendChild(notesUiEditor(col, d, byDate.get(d), false)); });
  wrap.appendChild(scroll);
  return wrap;
}
function notesUiToolbar(){
  const bar=document.createElement("div"); bar.className="colToolbar";
  const mkText=(label,cmd,italic)=>{ const b=document.createElement("button"); b.type="button"; b.className="fmtBtn"; b.textContent=label; b.style.fontWeight="700"; if(italic) b.style.fontStyle="italic"; b.addEventListener("mousedown", notesUiPd); b.onclick=()=>notesUiFmt(cmd); return b; };
  const bull=document.createElement("button"); bull.type="button"; bull.className="fmtBtn"; bull.title="รายการหัวข้อ (bullets)";
  bull.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>';
  bull.addEventListener("mousedown", notesUiPd); bull.onclick=()=>notesUiFmt("insertUnorderedList");
  const hi=document.createElement("button"); hi.type="button"; hi.className="fmtBtn"; hi.title="ไฮไลต์ (เหลืองอ่อน)";
  hi.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14"><rect x="3" y="18" width="18" height="4" rx="1.5" fill="#f2d21f"/><path d="m8.5 14.5 7-7a2 2 0 0 1 2.8 2.8l-7 7-3.6.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  hi.addEventListener("mousedown", notesUiPd); hi.onclick=notesUiHighlight;
  bar.append(mkText("B","bold",false), mkText("I","italic",true), bull, hi);
  const row=document.createElement("div"); row.className="swatchRow";
  NOTES_UI_COLORS.forEach(c=>{ const s=document.createElement("button"); s.type="button"; s.className="swatch"; s.style.background=c.css; s.title="สีตัวอักษร"; s.addEventListener("mousedown", notesUiPd); s.onclick=()=>notesUiColor(c.val==="__ink__"?notesUiInk():c.val); row.appendChild(s); });
  bar.appendChild(row);
  return bar;
}
function notesUiEditor(col, date, html, isToday){
  const ed=document.createElement("div");
  ed.className="noteEdit"+(isToday?" today":"");
  ed.contentEditable="true"; ed.spellcheck=false; ed.dataset.col=col; ed.dataset.date=date;       // data-date on EVERY editor — collectNotesFromDom() collects by it
  if(isToday){ ed.dataset.today="1"; ed.dataset.ph="วันนี้ — พิมพ์โน้ตที่นี่…"; }
  ed.innerHTML=sanitizeNoteHtml(html);                                                             // sanitize on render too (N6)
  ed.addEventListener("input", notesUiInput);
  ed.addEventListener("paste", notesUiPastePlain);
  return ed;
}
function notesUiDivider(col, date, isToday){
  const d=document.createElement("div"); d.className="dateDiv"; d.dataset.date=date;
  d.innerHTML='<span class="dateChip">— '+esc(fmtStamp(date))+' —</span>';
  const bin=document.createElement("button"); bin.type="button"; bin.className="binBtn"; bin.title="ลบโน้ตวันที่ "+fmtStamp(date); bin.innerHTML=IC.trash;
  let disarmT=null, pop=null;
  const disarm=()=>{ bin.classList.remove("armed"); if(pop){ const p=pop; pop=null; p.classList.remove("show"); setTimeout(()=>p.remove(),200); } };
  const confirmDel=()=>{ clearTimeout(disarmT); disarm(); notesUiRemoveSection(col, date, d, isToday); };
  bin.onclick=()=>{
    if(bin.classList.contains("armed")){ confirmDel(); return; }                                   // second bin click confirms
    bin.classList.add("armed");
    pop=document.createElement("div"); pop.className="delPop";
    pop.textContent="ลบโน้ต "+fmtStamp(date)+" ทั้งหมด? — คลิกเพื่อยืนยัน";
    pop.onclick=e=>{ e.stopPropagation(); confirmDel(); };                                          // clicking the popover also confirms
    d.appendChild(pop);
    const left=bin.offsetLeft+bin.offsetWidth+8; pop.style.left=left+"px";                          // right of the bin…
    requestAnimationFrame(()=>{ if(left+pop.offsetWidth > d.clientWidth-4){ pop.style.left=""; pop.style.right=(d.clientWidth-bin.offsetLeft+8)+"px"; } pop.classList.add("show"); });  // …flip left when it would clip the column edge
    disarmT=setTimeout(disarm, 3200);                                                               // auto-disarm ~3.2s
  };
  d.appendChild(bin);
  return d;
}
function notesUiRemoveSection(col, date, divEl, isToday){
  const ed=divEl.nextElementSibling;                                                               // the editor always directly follows its divider
  if(isToday || (ed && ed.dataset && ed.dataset.today)){ if(ed) ed.innerHTML=""; divEl.hidden=true; }  // today: clear content + re-hide divider (typing re-reveals it)
  else { if(ed) ed.remove(); divEl.remove(); }                                                     // else remove the WHOLE day section
  notesDeleteSection(col, date);                                                                   // engine appends the log entry + flushes + toasts (AFTER the DOM is gone)
}
function notesUiInput(e){
  const ed=e.currentTarget;
  if(ed.dataset.today){                                                                            // reveal / hide today's divider lazily
    const has=(ed.textContent||"").trim().length>0;
    const div=ed.previousElementSibling;
    if(div && div.classList.contains("dateDiv")) div.hidden=!has;
  }
  notesSyncCounts(); notesMarkDirty();
}
function notesUiPastePlain(e){                                                                      // force plain-text paste (nothing foreign reaches the sanitizer)
  e.preventDefault();
  const t=(e.clipboardData||window.clipboardData).getData("text/plain");
  document.execCommand("insertText", false, t);
}
/* AUDIT FIX (major): styleWithCSS is a DOCUMENT-GLOBAL, session-persistent execCommand mode. Setting
   it for colour/highlight and never restoring it made every later bold/italic emit style-spans whose
   font-weight/font-style the sanitizer strips — silently losing emphasis after the first colour use.
   Every command goes through this wrapper, which ALWAYS restores the flag to false. */
function notesUiExec(cmd, val, styleWithCss){
  try{ document.execCommand("styleWithCSS", false, !!styleWithCss); }catch(e){}
  document.execCommand(cmd, false, val==null?null:val);
  try{ document.execCommand("styleWithCSS", false, false); }catch(e){}
}
function notesUiFmt(cmd){ notesUiExec(cmd, null, false); notesMarkDirty(); }
function notesUiColor(val){ notesUiExec("foreColor", val, true); notesMarkDirty(); }
function notesUiHighlight(){                                                                        // N11: detect highlighted state by DOM inspection (queryCommandValue is unreliable across the wrapping span)
  const sel=window.getSelection(); if(!sel || !sel.rangeCount) return;
  const range=sel.getRangeAt(0);
  let anc=range.commonAncestorContainer; if(anc.nodeType!==1) anc=anc.parentElement;
  const scope=(anc && anc.closest && anc.closest(".noteEdit")) || anc; if(!scope) return;
  const hits=[...scope.querySelectorAll('[style*="background"]')].filter(n=> range.intersectsNode(n));
  const ancsWithBg=[];
  for(let p=anc; p && p!==scope.parentElement; p=p.parentElement){ if(p.style && p.style.backgroundColor) ancsWithBg.push(p); if(p===scope) break; }
  if(!hits.length && !ancsWithBg.length){ notesUiExec("hiliteColor", NOTE_HI, true); }  // apply (wrapper restores styleWithCSS)
  else { hits.forEach(n=> n.style.backgroundColor=""); ancsWithBg.forEach(n=> n.style.backgroundColor=""); }                                                             // whole-run removal (no partial splits)
  notesMarkDirty();
}

/* =====================  INIT  ===================== */
Store.load();
applyTheme();                                          // §1.10: stamp html[data-theme] from ui.theme BEFORE the first render (no light→dark flash)
route();
wireDragGuard();                                       // one centralized capture-phase pointerdown/up/cancel guard for background-sync deferral
wireResizeGuard();                                     // H2: one debounced window-resize listener → refreshes the months-in-view readout (no re-render)
wireThemeGuard();                                      // §1.10: AUTO mode re-applies the effective theme when the OS prefers-color-scheme flips (wired once)
wirePrintGuard();                                      // §1.10 T2: force light + re-render inline bar fills on beforeprint, restore on afterprint (wired once; covers the Print button AND Cmd-P)
window.addEventListener('hashchange', route);
window.addEventListener('storage', e=>{ if(e.key===LS_KEY && !editingNow()){ Store.load(); route(); } }); // FIX: don't reload/re-render from a cross-tab write while a drag/resize or edit is in flight
if(cloudOn()){ cloudSync(); window.addEventListener('focus', ()=>cloudPull(false)); setInterval(()=>cloudPull(false), 30000); }
document.addEventListener('keydown', e=>{
  if(e.key==="Escape"){
    if(el("modalRoot").style.display==="block") closeModal();
    else if(notesOpen()) closeNotes();                              // v1.0.5 F2: notes popup closes before the overlays below it
    else if(el("historyOverlay").style.display==="flex" && PID) location.hash="project="+PID;
    else {
      const a=document.activeElement; if(a && a.closest && a.closest('.gripMenu')) a.blur();  // keyboard-opened menu: releases :focus-within
      // G4: a HOVER-opened menu has no focus to blur → force it shut with .gmSuppress (CSS suppresses
      // the :hover open even while the pointer stays on the grip), auto-cleared on pointerleave so a
      // later move-away + re-hover opens it again.
      document.querySelectorAll('.gripMenu:hover').forEach(gm=>{ gm.classList.add('gmSuppress'); gm.addEventListener('pointerleave', ()=>gm.classList.remove('gmSuppress'), {once:true}); });
    }
  }
});
