const API_BASE  = "https://adeptio-gantt.pathom-bot.workers.dev";
const API_TOKEN = "adeptiolab.com";
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
   swaps Store -> Turso API.
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
function parse(s){ if(s instanceof Date) return new Date(s.getFullYear(),s.getMonth(),s.getDate()); const [y,m,d]=String(s).split("-").map(Number); return new Date(y,(m||1)-1,d||1); }
function iso(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function daysBetween(a,b){ return Math.round((parse(b)-parse(a))/DAY); }
function startOfMonth(d){ return new Date(d.getFullYear(),d.getMonth(),1); }
function endOfMonth(d){ return new Date(d.getFullYear(),d.getMonth()+1,0); }
function today(){ const t=new Date(); return new Date(t.getFullYear(),t.getMonth(),t.getDate()); }
const ui = { zoom:"week", cal:"CE" };
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
};

/* =====================  STORE (local-first, optional cloud sync)  ===== */
const LS_KEY = "adeptio_ptrack_v2";
const LS_REV = "adeptio_ptrack_rev";
let MEM = null, DB = null;
function safeGet(){ try{ return localStorage.getItem(LS_KEY); }catch(e){ return null; } }
function safeSet(v){ try{ localStorage.setItem(LS_KEY,v); return true; }catch(e){ return false; } }

/* ---- Cloud sync config (optional). Point API_BASE at your Cloudflare Worker to
   enable shared, cross-device persistence + server/drive backups. Leave empty and
   the app runs purely on localStorage (offline). API_TOKEN must match the Worker. */
const API_BASE  = "";          // e.g. "https://adeptio-gantt.<your-subdomain>.workers.dev"
const API_TOKEN = "";          // must equal the Worker's API_TOKEN secret (if it sets one)
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
    MEM = DB; return DB;
  },
  save(){ const s=JSON.stringify(DB); if(!safeSet(s)){ MEM=DB; } if(cloudOn()) schedulePush(); }
};
function proj(){ return DB.projects.find(p=>p.id===PID) || null; }

/* ---- cloud sync engine: local-first; the Worker's `rev` is the tiebreaker ---- */
let pushTimer=null, pushPending=false;
function schedulePush(){ pushPending=true; clearTimeout(pushTimer); pushTimer=setTimeout(cloudPush, 800); }
async function cloudPush(){
  if(!cloudOn()) return;
  try{
    const res = await fetch(apiUrl("/api/state"), { method:"PUT", headers:apiHeaders(), body:JSON.stringify({doc:DB}) });
    if(res.ok){ const j=await res.json(); if(j && typeof j.rev==="number") setLsRev(j.rev); pushPending=false; }
  }catch(e){ /* offline → localStorage holds the change; retried on next save */ }
}
function editingNow(){
  const a=document.activeElement;
  if(a && (a.tagName==="TEXTAREA" || a.tagName==="INPUT" || a.isContentEditable)) return true;
  if(el("modalRoot") && el("modalRoot").style.display==="block") return true;
  if(el("historyOverlay") && el("historyOverlay").style.display==="flex") return true;
  return false;
}
function adoptRemote(doc, rev){ DB=doc; MEM=DB; safeSet(JSON.stringify(DB)); setLsRev(rev); route(); }
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
function moduleStats(m){
  let total=m.features.length, done=0, started=0;
  m.features.forEach(f=>{ if(f.status==="done") done++; else if(f.status!=="not_started") started++; });
  const ns=total-done-started, pc=n=> total? Math.round(n/total*100):0;
  return {total, done, started, notStarted:ns, donePct:pc(done), startedPct:pc(started), notPct:pc(ns)};
}
function aggregateStats(mods){
  let total=0, done=0, started=0;
  mods.forEach(m=> m.features.forEach(f=>{ total++; if(f.status==="done") done++; else if(f.status!=="not_started") started++; }));
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

/* =====================  ROUTING  ===================== */
let PID = null;
function readRoute(){
  const hash = location.hash.replace(/^#/,"");
  const hp = new URLSearchParams(hash.includes("=")?hash:"");
  const url = new URL(location.href);
  const pathM = location.pathname.match(/\/p\/([^/?#]+)/);
  const pid = url.searchParams.get("project") || hp.get("project") || (pathM?pathM[1]:null);
  const view = url.searchParams.get("view") || hp.get("view") || null;
  return { pid, view };
}
function projectUrl(id, view){ return location.pathname + "#project=" + id + (view?("&view="+view):""); }
function openProjectWindow(id){
  const url = projectUrl(id);
  const w = window.open(url, "adeptio_proj_"+id, "width=1480,height=920");
  if(!w){ location.href = url; }
}
function route(){
  const {pid, view} = readRoute();
  closeModal(); hideHistory();
  if(pid && DB.projects.some(p=>p.id===pid)){
    PID = pid; renderProject();
    if(view==="history") showHistory();
  } else { PID = null; renderDashboard(); }
}

/* =====================  DASHBOARD  ===================== */
function renderDashboard(){
  const ps = DB.projects;
  const cards = ps.map(p=>{
    const pc = PALETTE[p.color%PALETTE.length];
    let mn=null, mx=null, nFeat=0;
    p.modules.forEach(m=>m.features.forEach(f=>{ nFeat++; const s=parse(f.start),e=parse(f.end); if(!mn||s<mn)mn=s; if(!mx||e>mx)mx=e; }));
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
    if(editing){ editing.name=name; editing.client=client; editing.code=code; editing.color=color; editing.updatedAt=iso(today()); }
    else {
      const slug=(code||name).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||("proj-"+_seq);
      let pid=slug, n=2; while(DB.projects.some(p=>p.id===pid)){ pid=slug+"-"+n; n++; }
      DB.projects.push({ id:pid, name, client, code, color, createdAt:iso(today()), updatedAt:iso(today()),
        customCols:[], progressOrder:[], summary:{current:{id:nid(),date:iso(today()),text:""},history:[]}, modules:[] });
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
      <div class="toolgroup tlOnly">
        <span class="gl">Scroll</span>
        <div class="seg"><button id="colLeft" title="เลื่อนคอลัมน์ซ้าย">◀</button><span class="lbl">Cols</span><button id="colRight" title="เลื่อนคอลัมน์ขวา">▶</button></div>
        <div class="seg"><button id="chLeft" title="เลื่อนชาร์ตซ้าย">◀</button><span class="lbl">Chart</span><button id="chRight" title="เลื่อนชาร์ตขวา">▶</button></div>
      </div>
      <div class="toolgroup tlOnly">
        <div class="seg"><span class="lbl">Zoom</span><button data-zoom="day">Day</button><button data-zoom="week" class="on">Week</button><button data-zoom="month">Month</button></div>
        <div class="seg"><button data-cal="CE" class="on">ค.ศ.</button><button data-cal="BE">พ.ศ.</button></div>
        <button class="btn sm" id="btnToday">Today</button>
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
  L.onscroll=()=>{ if(syncing)return; syncing=true; R.scrollTop=L.scrollTop; syncing=false; };
  R.onscroll=()=>{ if(syncing)return; syncing=true; L.scrollTop=R.scrollTop; syncing=false; };
}

function wireProjectControls(){
  document.querySelectorAll('.tabBtn').forEach(b=> b.onclick=()=> switchTab(b.dataset.tab));
  document.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{ ui.zoom=b.dataset.zoom; document.querySelectorAll('[data-zoom]').forEach(x=>x.classList.toggle('on',x===b)); renderTimeline(); });
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
}

/* ----- vertical splitter: resize the column pane ----- */
let split=null;
function onSplitDown(e){
  e.preventDefault();
  const ls=el("leftScroll");
  split={ startX:e.clientX, startW:ls.getBoundingClientRect().width };
  el("splitter").classList.add('drag'); document.body.style.userSelect='none'; document.body.style.cursor='col-resize';
  window.addEventListener('pointermove', onSplitMove); window.addEventListener('pointerup', onSplitUp, {once:true});
}
function onSplitMove(e){
  if(!split) return;
  const boardW=el("board").getBoundingClientRect().width;
  let w=split.startW + (e.clientX - split.startX);
  w=Math.max(260, Math.min(w, boardW-260));
  el("leftScroll").style.width=w+"px";
}
function onSplitUp(){
  if(!split) return; window.removeEventListener('pointermove', onSplitMove);
  document.body.style.userSelect=''; document.body.style.cursor=''; el("splitter").classList.remove('drag');
  const P=proj(); if(P){ P.leftW=Math.round(el("leftScroll").getBoundingClientRect().width); Store.save(); }
  split=null;
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
        <span class="sumDateWrap">วันที่อัปเดต <input type="date" id="sumDate" value="${cur.date||iso(today())}"/></span>
        <button class="btn sm" id="goTimeline" title="ไปหน้าไทม์ไลน์และ Gantt">ไทม์ไลน์โครงการ ${IC.arrow}</button>
      </div>
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
  el("sumSave").onclick = ()=>{ cur.text=ta.value; cur.date=el("sumDate").value||cur.date; P.updatedAt=iso(today()); Store.save(); toast("บันทึกสรุปแล้ว"); };
  el("sumDate").onchange = ()=>{ cur.date=el("sumDate").value; Store.save(); };
  el("sumNew").onclick = ()=>{
    cur.text=ta.value; cur.date=el("sumDate").value||cur.date;
    P.summary.history.unshift({id:nid(), date:cur.date, text:cur.text});
    P.summary.current={id:nid(), date:iso(today()), text:""};
    Store.save(); renderSummary(); toast("เก็บเข้าประวัติแล้ว เริ่มอัปเดตใหม่");
  };
  el("sumHist").onclick = ()=>{ location.hash="project="+PID+"&view=history"; };
  const gt=el("goTimeline"); if(gt) gt.onclick=()=> switchTab("timeline");
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
    html+=`<div class="progModules">`+ mods.map(m=>{
      const s=moduleStats(m);
      const tip=`เสร็จ ${s.donePct}% · กำลังทำ ${s.startedPct}% · ยังไม่เริ่ม ${s.notPct}% (${s.total} งาน)`;
      return `<div class="progRow" data-mid="${m.id}">
        <span class="pgrip" data-act="progdrag" title="ลากเพื่อจัดลำดับการแสดงผล">${IC.grip}</span>
        <span class="pmName" title="${esc(m.name)}">${esc(m.name)}</span>
        <span class="pbar" title="${tip}">${barSeg(s)}</span>
        <span class="pmPct" title="${tip}">${s.donePct}% · ${s.startedPct}%</span>
        <button class="pmDel" data-act="proghide" data-mid="${m.id}" title="ซ่อนกราฟโมดูลนี้">${IC.x}</button>
      </div>`;
    }).join("")+`</div>`;
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
  window.addEventListener('pointermove', onProgDragMove); window.addEventListener('pointerup', onProgDragUp, {once:true});
}
function onProgDragMove(e){
  if(!progDrag) return; mvProgGhost(e);
  const under=document.elementFromPoint(e.clientX,e.clientY);
  const row=under&&under.closest?under.closest('.progRow'):null;
  clearProgMark(); progDrag.target=null;
  if(row && row.dataset.mid!==progDrag.mid){ const rc=row.getBoundingClientRect(); const before=e.clientY<rc.top+rc.height/2; progDrag.target={mid:row.dataset.mid,before}; row.classList.add(before?'pBefore':'pAfter'); }
}
function onProgDragUp(){
  if(!progDrag) return; window.removeEventListener('pointermove', onProgDragMove); document.body.style.userSelect='';
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
      <div class="top">${e._cur?'<span class="badge">ปัจจุบัน</span>':''}<input type="date" value="${e.date||''}" data-f="date"/><span class="grow"></span>${e._cur?'':`<button class="iconbtn danger" data-act="delhist" title="ลบ">${IC.trash}</button>`}</div>
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
  el("histAdd").onclick=()=>{ P.summary.history.push({id:nid(), date:iso(today()), text:""}); Store.save(); showHistory(); };
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
    if(k.startsWith("c:")){ const c=P.customCols.find(x=>("c:"+x.id)===k); return {key:k,label:c.label,w:c.w,kind:c.kind,custom:c.id,del:true}; }
    return {...BASE_COLDEFS[k]};
  });
}
const PX = { day:38, week:11, month:4.4 };
const pxPerDay = () => PX[ui.zoom];
function getRange(){
  let mn=null,mx=null;
  proj().modules.forEach(m=>m.features.forEach(f=>{ const s=parse(f.start),e=parse(f.end); if(!mn||s<mn)mn=s; if(!mx||e>mx)mx=e; }));
  if(!mn){ const t=today(); return {start:startOfMonth(addDays(t,-15)), end:endOfMonth(addDays(t,45))}; }
  return { start:startOfMonth(addDays(mn,-3)), end:endOfMonth(addDays(mx,3)) };
}
function updateMeta(){
  const P=proj(); if(!P) return; const nMod=P.modules.length, nFeat=P.modules.reduce((a,m)=>a+m.features.length,0), r=getRange();
  const ml=el("metaLine"); if(ml) ml.textContent=`${esc(P.client||"")} · ${nMod} โมดูล · ${nFeat} ฟีเจอร์ · ${monName(r.start.getMonth())} ${dispYear(r.start)} – ${monName(r.end.getMonth())} ${dispYear(r.end)}`;
}

/* =====================  RENDER BOARD  ===================== */
function renderBoard(){ renderGrid(); renderTimeline(); updateMeta(); if(el("progressPanel")) renderProgress(); }

function renderGrid(){
  const P=proj(), cols=allCols();
  el("leftHead").innerHTML = cols.map(c=>`<div class="colHead" data-key="${c.key}" style="width:${c.w}px" title="ลากเพื่อย้ายคอลัมน์">${esc(c.label)}${c.del?`<button class="delcol" data-act="delcol" data-col="${c.custom}" title="ลบคอลัมน์">${IC.x}</button>`:""}</div>`).join("");
  const gw = cols.reduce((a,c)=>a+c.w,0);
  let html="";
  P.modules.forEach((m,mi)=>{
    const p=PALETTE[m.color%PALETTE.length];
    html += `<div class="modRow ${m.collapsed?'collapsed':''}" style="width:${gw}px" data-mi="${mi}">
      <span class="caret" data-act="toggle">${IC.caret}</span>
      <span class="chip" style="background:${p.chip}"></span>
      <span class="modText"><span class="modName" contenteditable="true" data-field="modname" spellcheck="false">${esc(m.name)}</span>${m.description?`<span class="modDesc" title="${esc(m.description)}">${esc(m.description)}</span>`:""}</span>
      <span class="count">${m.features.length}</span>
      <span class="modActs">
        <button class="iconbtn" data-act="editmod" title="แก้ไขโมดูล">${IC.edit}</button>
        <button class="iconbtn" data-act="addfeat" title="เพิ่มฟีเจอร์">${IC.plus}</button>
        <button class="iconbtn danger" data-act="delmod" title="ลบโมดูล">${IC.trash}</button>
      </span></div>`;
    if(!m.collapsed){
      m.features.forEach((f,fi)=>{
        html += `<div class="featRow" data-mi="${mi}" data-fi="${fi}">`;
        cols.forEach(c=>{
          if(c.kind==="feat"){
            html += `<div class="cell feat" style="width:${c.w}px">
              <span class="grip" data-act="rowdrag" title="ลากเพื่อย้ายแถว">${IC.grip}</span>
              <span class="txt" contenteditable="true" data-field="name" spellcheck="false" data-ph="ตั้งชื่อฟีเจอร์…">${f.fid?`<span class="fid">${esc(f.fid)}</span>`:""}${esc(f.name)}</span>
              <span class="rowActs"><button class="iconbtn" data-act="up" title="เลื่อนขึ้น">${IC.up}</button><button class="iconbtn" data-act="down" title="เลื่อนลง">${IC.down}</button><button class="iconbtn danger" data-act="delfeat" title="ลบฟีเจอร์">${IC.trash}</button></span></div>`;
          } else if(c.kind==="date"){
            html += `<div class="cell" style="width:${c.w}px"><input type="date" value="${f[c.key]||""}" data-mi="${mi}" data-fi="${fi}" data-field="${c.key}" /></div>`;
          } else if(c.kind==="status"){
            const st=stById(f.status);
            const opts=STATUS.map(s=>`<option value="${s.id}" ${s.id===f.status?'selected':''}>${s.th}</option>`).join("");
            html += `<div class="cell" style="width:${c.w}px"><select class="statusSel" data-mi="${mi}" data-fi="${fi}" data-field="status" style="box-shadow:inset 4px 0 0 ${st.color}">${opts}</select></div>`;
          } else {
            const val=c.custom?(f.custom[c.custom]||""):(f[c.key]||"");
            html += `<div class="cell" style="width:${c.w}px"><span class="txt" contenteditable="true" data-field="${c.key}" spellcheck="false" data-ph="${esc(c.ph||"…")}">${esc(val)}</span></div>`;
          }
        });
        html += `</div>`;
      });
      html += `<div class="addFeat" data-mi="${mi}" data-act="addfeat">${IC.plus}<span>เพิ่มฟีเจอร์ในโมดูลนี้</span></div>`;
    }
  });
  el("leftBody").innerHTML = html;
  bindGrid();
}

function renderTimeline(){
  const P=proj(), r=getRange(), ppd=pxPerDay();
  const totalDays=daysBetween(r.start,r.end)+1, W=totalDays*ppd;
  let months="", cur=new Date(r.start);
  while(cur<=r.end){
    const mEnd=endOfMonth(cur), segEnd=mEnd<r.end?mEnd:r.end, days=daysBetween(cur,segEnd)+1, w=days*ppd;
    const showYear=(cur.getMonth()===0)||(cur.getTime()===r.start.getTime());
    months += `<div class="monthBand" style="width:${w}px">${monName(cur.getMonth())} ${showYear?dispYear(cur):"’"+String(dispYear(cur)).slice(-2)}</div>`;
    cur=startOfMonth(addDays(mEnd,1));
  }
  let ticks="";
  if(ui.zoom==="day"){ for(let i=0;i<totalDays;i++){ const d=addDays(r.start,i),wd=d.getDay(); ticks+=`<div class="tick ${(wd===0||wd===6)?'wkend':''} ${d.getDate()===1?'mstart':''}" style="width:${ppd}px">${d.getDate()}</div>`; } }
  else if(ui.zoom==="week"){ for(let i=0;i<totalDays;i+=7){ const d=addDays(r.start,i),w=Math.min(7,totalDays-i)*ppd; ticks+=`<div class="tick" style="width:${w}px">${d.getDate()}/${d.getMonth()+1}</div>`; } }
  else { for(let i=0;i<totalDays;i+=7){ const w=Math.min(7,totalDays-i)*ppd; ticks+=`<div class="tick" style="width:${w}px"></div>`; } }
  el("axis").innerHTML=`<div id="axisMonths" style="width:${W}px">${months}</div><div id="axisTicks" style="width:${W}px">${ticks}</div>`;

  let grid="";
  if(ui.zoom==="day"){
    for(let i=0;i<=totalDays;i++){ const d=addDays(r.start,i),x=i*ppd; grid+=`<div class="vline ${d.getDate()===1?'month':''}" style="left:${x}px"></div>`; if(i<totalDays){ const wd=d.getDay(); if(wd===0||wd===6) grid+=`<div class="wband" style="left:${x}px;width:${ppd}px"></div>`; } }
  } else {
    for(let i=0;i<=totalDays;i++){ const d=addDays(r.start,i); if(d.getDate()===1||i===0||i===totalDays) grid+=`<div class="vline month" style="left:${i*ppd}px"></div>`; else if(ui.zoom==="week"&&daysBetween(r.start,d)%7===0) grid+=`<div class="vline" style="left:${i*ppd}px"></div>`; }
  }
  const t=today();
  if(t>=r.start&&t<=r.end){ const x=daysBetween(r.start,t)*ppd+ppd/2; grid+=`<div id="todayLine" style="left:${x}px"></div><div id="todayFlag" style="left:${x}px">วันนี้ ${fmtThai(t)}</div>`; }
  el("gridLayer").style.width=W+"px"; el("gridLayer").innerHTML=grid;

  let rows="", altCount=0;
  P.modules.forEach((m,mi)=>{
    const p=PALETTE[m.color%PALETTE.length];
    let ms=null,me=null; m.features.forEach(f=>{ const s=parse(f.start),e=parse(f.end); if(!ms||s<ms)ms=s; if(!me||e>me)me=e; });
    let modBar="";
    if(ms){ const left=daysBetween(r.start,ms)*ppd, w=(daysBetween(ms,me)+1)*ppd; modBar=`<div class="modBar" style="left:${left}px;width:${w}px"><div class="cap l" style="background:${p.border}"></div><div class="span" style="background:${p.border}"></div><div class="cap r" style="background:${p.border}"></div></div>`; }
    rows += `<div class="modBarRow" style="width:${W}px">${modBar}</div>`;
    if(!m.collapsed){
      m.features.forEach((f,fi)=>{
        const left=daysBetween(r.start,f.start)*ppd, w=Math.max(ppd,(daysBetween(f.start,f.end)+1)*ppd);
        const alt=(altCount++ %2)===1?"alt":""; const dur=daysBetween(f.start,f.end)+1; const st=stById(f.status);
        const tip=`${f.fid?f.fid+" · ":""}${f.name}\n${fmtThai(parse(f.start))} → ${fmtThai(parse(f.end))} (${dur} วัน)\nสถานะ: ${st.th}${f.remark?"\nหมายเหตุ: "+f.remark:""}`;
        rows += `<div class="barRow ${alt}" style="width:${W}px"><div class="bar" data-mi="${mi}" data-fi="${fi}" title="${esc(tip)}" style="left:${left+1}px;width:${w-2}px;background:${p.fill};border-color:${p.border};color:${p.ink}"><div class="handle l" data-mode="l"></div><span class="sdot" style="background:${st.color}"></span><span class="blabel">${esc(f.name)}</span><div class="handle r" data-mode="r"></div></div></div>`;
      });
      rows += `<div class="barRow" style="width:${W}px;height:32px;border-bottom:1px solid var(--line)"></div>`;
    }
  });
  el("rowsLayer").style.width=W+"px"; el("rowsLayer").innerHTML=rows;
  el("bars").style.width=W+"px";
  el("empty").style.display=P.modules.length?"none":"flex";
  bindBars();
}

/* =====================  GRID INTERACTIONS  ===================== */
function bindGrid(){
  const lb=el("leftBody");
  lb.querySelectorAll('[contenteditable]').forEach(x=>{ x.addEventListener('blur', onTextBlur); x.addEventListener('keydown', e=>{ if(e.key==='Enter'&&x.dataset.field!=='description'){ e.preventDefault(); x.blur(); } }); });
  lb.querySelectorAll('input[type=date]').forEach(x=> x.addEventListener('change', onDateChange));
  lb.querySelectorAll('select.statusSel').forEach(x=> x.addEventListener('change', onStatusChange));
  lb.querySelectorAll('[data-act]').forEach(b=> b.addEventListener('click', onGridAction));
  lb.querySelectorAll('.grip[data-act="rowdrag"]').forEach(g=> g.addEventListener('pointerdown', onRowDragStart));
  const lh=el("leftHead");
  lh.querySelectorAll('[data-act="delcol"]').forEach(b=> b.addEventListener('click', onGridAction));
  lh.querySelectorAll('.colHead').forEach(h=> h.addEventListener('pointerdown', onColDragStart));
}
function onTextBlur(e){
  const x=e.target, field=x.dataset.field, P=proj();
  if(field==="modname"){ const mi=+x.closest('.modRow').dataset.mi; P.modules[mi].name=x.textContent.trim(); Store.save(); updateMeta(); return; }
  const row=x.closest('.featRow'); if(!row) return;
  const f=P.modules[+row.dataset.mi].features[+row.dataset.fi];
  let val=x.textContent;
  if(field==="name"){ if(f.fid&&val.startsWith(f.fid)) val=val.slice(f.fid.length); f.name=val.trim(); const bl=el("rowsLayer").querySelector(`.bar[data-mi="${row.dataset.mi}"][data-fi="${row.dataset.fi}"] .blabel`); if(bl) bl.textContent=f.name; }
  else if(field.startsWith("c:")){ f.custom[field.slice(2)]=val.trim(); }
  else f[field]=val.trim();
  Store.save();
}
function onDateChange(e){
  const inp=e.target, P=proj(), f=P.modules[+inp.dataset.mi].features[+inp.dataset.fi], field=inp.dataset.field, v=inp.value;
  if(!v){ inp.value=f[field]; return; }
  if(field==="start"){ f.start=v; if(parse(f.end)<parse(v)) f.end=v; } else { f.end=v; if(parse(v)<parse(f.start)) f.start=v; }
  Store.save(); renderTimeline();
}
function onStatusChange(e){
  const s=e.target, P=proj(), f=P.modules[+s.dataset.mi].features[+s.dataset.fi];
  f.status=s.value; const st=stById(f.status); s.style.boxShadow="inset 4px 0 0 "+st.color; Store.save();
  const dot=el("rowsLayer").querySelector(`.bar[data-mi="${s.dataset.mi}"][data-fi="${s.dataset.fi}"] .sdot`); if(dot) dot.style.background=st.color;
  renderProgress();
}
function onGridAction(e){
  const b=e.currentTarget, act=b.dataset.act, P=proj();
  if(act==="delcol"){ const cid=b.dataset.col; if(confirm("ลบคอลัมน์นี้และข้อมูลในคอลัมน์?")){ P.customCols=P.customCols.filter(c=>c.id!==cid); P.modules.forEach(m=>m.features.forEach(f=>{ delete f.custom[cid]; })); Store.save(); renderBoard(); } return; }
  const modEl=b.closest('.modRow');
  if(modEl && (act==="toggle"||act==="addfeat"||act==="delmod"||act==="editmod")){
    const mi=+modEl.dataset.mi;
    if(act==="toggle"){ P.modules[mi].collapsed=!P.modules[mi].collapsed; Store.save(); renderBoard(); return; }
    if(act==="addfeat"){ addFeature(mi); return; }
    if(act==="editmod"){ moduleModal(mi); return; }
    if(act==="delmod"){ if(confirm(`ลบโมดูล “${P.modules[mi].name}” และฟีเจอร์ทั้งหมด?`)){ P.modules.splice(mi,1); Store.save(); renderBoard(); } return; }
  }
  const featEl=b.closest('.featRow'); if(!featEl) return;
  const mi=+featEl.dataset.mi, fi=+featEl.dataset.fi, feats=P.modules[mi].features;
  if(act==="delfeat"){ if(confirm(`ลบฟีเจอร์ “${feats[fi].name}”?`)){ feats.splice(fi,1); Store.save(); renderBoard(); } }
  else if(act==="up"&&fi>0){ [feats[fi-1],feats[fi]]=[feats[fi],feats[fi-1]]; Store.save(); renderBoard(); }
  else if(act==="down"&&fi<feats.length-1){ [feats[fi+1],feats[fi]]=[feats[fi],feats[fi+1]]; Store.save(); renderBoard(); }
}
function addFeature(mi){
  const P=proj(), t=today();
  P.modules[mi].features.push({id:nid(),fid:"",name:"ฟีเจอร์ใหม่",description:"",start:iso(t),end:iso(addDays(t,7)),status:"not_started",remark:"",custom:{}});
  P.modules[mi].collapsed=false; Store.save(); renderBoard();
  const rows=el("leftBody").querySelectorAll(`.featRow[data-mi="${mi}"]`); const last=rows[rows.length-1]; if(last){ const tx=last.querySelector('.txt'); tx&&tx.focus(); }
}

/* module modal (with short description) */
function moduleModal(mi){
  const P=proj(), editing=(mi!=null)?P.modules[mi]:null;
  let color=editing?editing.color:(P.modules.length%PALETTE.length);
  const sw=PALETTE.map((p,i)=>`<div class="swatch ${i===color?'on':''}" data-c="${i}" style="background:${p.chip}"></div>`).join("");
  openModal(`
    <h2>${editing?"แก้ไขโมดูล":"สร้างโมดูล"}</h2>
    <div class="msub">โมดูลคือกลุ่มของฟีเจอร์ในแผนงาน</div>
    <div class="field"><label>ชื่อโมดูล · Module name</label><input type="text" id="mm_name" value="${editing?esc(editing.name):""}" placeholder="เช่น Procurement P2P (Section B)"/></div>
    <div class="field"><label>คำอธิบายสั้น · Short description</label><textarea id="mm_desc" placeholder="อธิบายสั้น ๆ เช่น 43 features — PR, PO, GR, Reports">${editing?esc(editing.description||""):""}</textarea></div>
    <div class="field"><label>สี · Colour</label><div class="swatches" id="mm_sw">${sw}</div></div>
    <div class="modActsRow"><button class="btn" data-act="cancel">ยกเลิก</button><button class="btn primary" id="mm_save">${editing?"บันทึก":"สร้างโมดูล"}</button></div>`);
  el("modalRoot").querySelectorAll('#mm_sw .swatch').forEach(s=> s.onclick=()=>{ color=+s.dataset.c; el("modalRoot").querySelectorAll('#mm_sw .swatch').forEach(x=>x.classList.toggle('on',x===s)); });
  el("mm_save").onclick=()=>{
    const name=el("mm_name").value.trim()||"โมดูลใหม่", desc=el("mm_desc").value.trim();
    if(editing){ editing.name=name; editing.description=desc; editing.color=color; }
    else P.modules.push({id:nid(),name,description:desc,color,collapsed:false,features:[]});
    Store.save(); closeModal(); renderBoard(); toast(editing?"บันทึกโมดูลแล้ว":"สร้างโมดูลแล้ว");
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

/* =====================  BARS — DRAG / RESIZE  ===================== */
let drag=null;
function bindBars(){ el("rowsLayer").querySelectorAll('.bar').forEach(bar=> bar.addEventListener('pointerdown', onBarDown)); }
function onBarDown(e){
  const bar=e.currentTarget, mode=e.target.dataset.mode||'move', P=proj();
  const mi=+bar.dataset.mi, fi=+bar.dataset.fi, f=P.modules[mi].features[fi], r=getRange(), ppd=pxPerDay();
  drag={bar,mode,mi,fi,f,ppd,rStart:r.start,startX:e.clientX,oS:daysBetween(r.start,f.start),oE:daysBetween(r.start,f.end)};
  bar.classList.add('dragging'); bar.setPointerCapture(e.pointerId); document.body.style.userSelect='none';
  window.addEventListener('pointermove', onBarMove); window.addEventListener('pointerup', onBarUp, {once:true}); e.preventDefault();
}
function onBarMove(e){
  if(!drag) return; const delta=Math.round((e.clientX-drag.startX)/drag.ppd); let s=drag.oS, en=drag.oE;
  if(drag.mode==='move'){ s+=delta; en+=delta; } else if(drag.mode==='l'){ s=Math.min(drag.oS+delta,en); } else { en=Math.max(drag.oE+delta,s); }
  drag.bar.style.left=(s*drag.ppd+1)+"px"; drag.bar.style.width=((en-s+1)*drag.ppd-2)+"px";
  const ns=iso(addDays(drag.rStart,s)), ne=iso(addDays(drag.rStart,en));
  const si=el("leftBody").querySelector(`input[data-mi="${drag.mi}"][data-fi="${drag.fi}"][data-field="start"]`);
  const ei=el("leftBody").querySelector(`input[data-mi="${drag.mi}"][data-fi="${drag.fi}"][data-field="end"]`);
  if(si) si.value=ns; if(ei) ei.value=ne; drag._s=ns; drag._e=ne;
}
function onBarUp(){ if(!drag) return; window.removeEventListener('pointermove', onBarMove); document.body.style.userSelect=''; if(drag._s){ drag.f.start=drag._s; drag.f.end=drag._e; Store.save(); } drag.bar.classList.remove('dragging'); drag=null; renderTimeline(); }

/* =====================  ROW DRAG-REORDER  ===================== */
let rowDrag=null;
function clearDrop(){ document.querySelectorAll('.dropBefore,.dropAfter,.dropInto').forEach(x=>x.classList.remove('dropBefore','dropAfter','dropInto')); }
function onRowDragStart(e){
  e.preventDefault();
  const featEl=e.target.closest('.featRow'); if(!featEl) return;
  rowDrag={ smi:+featEl.dataset.mi, sfi:+featEl.dataset.fi, target:null };
  const g=featEl.cloneNode(true); g.classList.add('rowGhost'); g.style.width=featEl.offsetWidth+"px"; g.style.left=e.clientX+"px"; g.style.top=e.clientY+"px";
  document.body.appendChild(g); rowDrag.ghost=g; document.body.style.userSelect='none';
  window.addEventListener('pointermove', onRowDragMove); window.addEventListener('pointerup', onRowDragUp, {once:true});
}
function onRowDragMove(e){
  if(!rowDrag) return;
  rowDrag.ghost.style.left=(e.clientX-18)+"px"; rowDrag.ghost.style.top=(e.clientY-14)+"px"; rowDrag.ghost.style.pointerEvents='none';
  const under=document.elementFromPoint(e.clientX,e.clientY); clearDrop(); rowDrag.target=null;
  const row=under&&under.closest?under.closest('.featRow'):null;
  if(row){ const rc=row.getBoundingClientRect(); const before=e.clientY<rc.top+rc.height/2; rowDrag.target={mi:+row.dataset.mi,fi:+row.dataset.fi,before}; row.classList.add(before?'dropBefore':'dropAfter'); return; }
  const mod=under&&under.closest?under.closest('.modRow'):null;
  if(mod){ rowDrag.target={mi:+mod.dataset.mi,fi:0,before:true}; mod.classList.add('dropInto'); }
}
function onRowDragUp(){
  if(!rowDrag) return; window.removeEventListener('pointermove', onRowDragMove); document.body.style.userSelect='';
  if(rowDrag.ghost) rowDrag.ghost.remove(); clearDrop();
  const d=rowDrag; rowDrag=null; if(!d.target) return;
  moveFeature(d.smi,d.sfi,d.target.mi,d.target.fi,d.target.before);
}
function moveFeature(smi,sfi,tmi,tfi,before){
  const P=proj(); const feat=P.modules[smi].features[sfi];
  P.modules[smi].features.splice(sfi,1);
  let idx=tfi; if(smi===tmi && sfi<tfi) idx=tfi-1; if(!before) idx+=1;
  if(idx<0) idx=0; if(idx>P.modules[tmi].features.length) idx=P.modules[tmi].features.length;
  P.modules[tmi].features.splice(idx,0,feat);
  Store.save(); renderBoard();
}

/* =====================  COLUMN DRAG-REORDER  ===================== */
let colDrag=null;
function clearColMark(){ document.querySelectorAll('.colHead.insL,.colHead.insR').forEach(x=>x.classList.remove('insL','insR')); }
function onColDragStart(e){
  if(e.target.closest('.delcol')) return;
  const head=e.currentTarget; if(!head.dataset.key) return;
  colDrag={ key:head.dataset.key, head, target:null, ghost:null, startX:e.clientX, moved:false };
  document.body.style.userSelect='none';
  window.addEventListener('pointermove', onColDragMove); window.addEventListener('pointerup', onColDragUp, {once:true});
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
  if(!colDrag) return; window.removeEventListener('pointermove', onColDragMove); document.body.style.userSelect='';
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

/* =====================  EXCEL EXPORT / IMPORT  ===================== */
function exportXlsx(){
  if(typeof XLSX==="undefined"){ toast("ไลบรารี Excel โหลดไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)"); return; }
  const P=proj(), customLabels=P.customCols.map(c=>c.label);
  const header=["Module","Feature ID","Feature","Description","Start","End","Status","Remark",...customLabels];
  const aoa=[header];
  P.modules.forEach(m=> m.features.forEach(f=>{
    aoa.push([m.name,f.fid||"",f.name,f.description||"",f.start,f.end,stById(f.status).en,f.remark||"",...P.customCols.map(c=>f.custom[c.id]||"")]);
  }));
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
    const f={id:nid(),fid:map.fid!=null?String(row[map.fid]).trim():"",name,description:map.description!=null?String(row[map.description]).trim():"",start:s,end:e,status:map.status!=null?statusFromText(row[map.status]):"not_started",remark:map.remark!=null?String(row[map.remark]).trim():"",custom:{}};
    customDefs.forEach(cd=> f.custom[cd.id]=String(row[cd.col]??"").trim());
    if(!groups.has(modName)) groups.set(modName,[]); groups.get(modName).push(f);
  }
  const P=proj();
  P.customCols=customDefs.map(({id,label,w,kind})=>({id,label,w,kind}));
  P.colOrder=DEFAULT_ORDER.concat(P.customCols.map(c=>"c:"+c.id));
  P.modules=[]; let ci=0;
  groups.forEach((feats,name)=>{ P.modules.push({id:nid(),name,description:"",color:ci++%PALETTE.length,collapsed:false,features:feats}); });
  P.progressOrder=P.modules.map(m=>m.id);
  Store.save(); renderTab(ui.tab);
  toast(`นำเข้าแล้ว: ${P.modules.length} โมดูล · ${[...groups.values()].reduce((a,b)=>a+b.length,0)} ฟีเจอร์`);
}

/* =====================  PNG EXPORT  ===================== */
async function exportPng(){
  if(typeof html2canvas==="undefined"){ toast("ไลบรารี PNG โหลดไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต)"); return; }
  const board=el("board"), L=el("leftScroll"), R=el("rightScroll");
  const pl=L.scrollTop, pr=R.scrollLeft; L.scrollTop=R.scrollTop=0; R.scrollLeft=0;
  board.classList.add('exporting');
  const w=board.scrollWidth, h=Math.max(el("leftBody").scrollHeight, el("bars").scrollHeight)+el("leftHead").offsetHeight+4;
  toast("กำลังสร้างภาพ PNG…");
  try{
    const c=await html2canvas(board,{backgroundColor:"#ffffff",scale:2,width:w,height:h,windowWidth:w+40,windowHeight:h+40,scrollX:0,scrollY:0,logging:false});
    const a=document.createElement('a'); a.download=safeName(proj().code||proj().name)+"_Timeline.png"; a.href=c.toDataURL("image/png"); a.click(); toast("ส่งออก PNG แล้ว");
  }catch(err){ console.error(err); toast("สร้าง PNG ไม่สำเร็จ"); }
  finally{ board.classList.remove('exporting'); L.scrollTop=R.scrollTop=pl; R.scrollLeft=pr; }
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
  DB = obj; MEM = DB; Store.save();      // persists locally + pushes to cloud if enabled
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

/* =====================  INIT  ===================== */
Store.load();
route();
window.addEventListener('hashchange', route);
window.addEventListener('storage', e=>{ if(e.key===LS_KEY){ Store.load(); route(); } });
if(cloudOn()){ cloudSync(); window.addEventListener('focus', ()=>cloudPull(false)); setInterval(()=>cloudPull(false), 30000); }
document.addEventListener('keydown', e=>{
  if(e.key==="Escape"){
    if(el("modalRoot").style.display==="block") closeModal();
    else if(el("historyOverlay").style.display==="flex" && PID) location.hash="project="+PID;
  }
});
