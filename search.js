
/* ═══════════════════════════════════════════════
   CONFIG
═══════════════════════════════════════════════ */
const DIRECTORY_SHEET_ID  = "15iii2nw4THbf-t-TdYNfj5WW2Aw4selhvfwu64YzisE";
const DIRECTORY_TAB_NAME  = "Sheet1";
const PAYMENT_SHEET_IDS   = { "2026":"1sPkVonPCAwM_avBVyQuJSSKRkx5wkB1XPHY1KiEulvU", "2025":"1U8uoiXbtvzdJxjDTV_IXxAjI7pvzXTFP" };
const WRITE_URL           = "https://script.google.com/macros/s/AKfycbwCnOleD2qsF3nJJe39X5dyvXJbIIndxxf4ZuTf48D-knyQU28FxoiaoF7j3rI9omjlcw/exec";
const WRITE_SECRET        = "MigSocietyPaymentWrite_2026_9xK4pL72Qz";

/* ═══════════════════════════════════════════════
   GLOBAL STATE
═══════════════════════════════════════════════ */
let directoryHeaders = [], directoryRows = [];
let allPaymentRecords = [];
let currentFlatData = null;
let paymentFiltered = [];
let editingPaymentIdx = -1; // index into paymentFiltered for editing
const MONTH_TABS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const MONTH_LABELS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* Temporary override cache kept for already-rendered modal values before a save refreshes data. */
const localOverrides = { owners:{}, tenants:{}, payments:{} };

/* ═══════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════ */
const esc  = v => String(v||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm = v => String(v||"").trim().toLowerCase();
const normPhone = v => String(v||"").replace(/[^\d]/g,"");
const blockDisp = v => { const d=String(v||"").match(/\d+/); return d?`Block-${Number(d[0])}`:String(v||""); };

function parseCSV(line){
  const result=[];let cur="",inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(c==='"'){inQ=!inQ}
    else if(c===','&&!inQ){result.push(cur.trim());cur="";}
    else{cur+=c;}
  }
  result.push(cur.trim());
  return result;
}

function hiIdx(pats){
  const nh=directoryHeaders.map(h=>norm(h));
  return pats.reduce((f,p)=>f>=0?f:nh.findIndex(h=>h.includes(p)),-1);
}
function personIdx(pri){
  const excPats=["vehicle","car","bike","scooter","number plate","veh","type","parking"];
  const nh=directoryHeaders.map(h=>norm(h));
  for(const p of pri){
    const i=nh.findIndex(h=>h.includes(p)&&!excPats.some(e=>h.includes(e)));
    if(i>=0)return i;
  }
  return -1;
}

/* ═══════════════════════════════════════════════
   THEME
═══════════════════════════════════════════════ */
const savedTheme = localStorage.getItem("society_dark_mode")==="1" || localStorage.getItem("mig_theme")==="dark";
if(savedTheme) document.body.classList.add("dark","dark-mode");

function toggleTheme(){
  const isDark=!document.body.classList.contains("dark-mode");
  document.body.classList.toggle("dark",isDark);
  document.body.classList.toggle("dark-mode",isDark);
  localStorage.setItem("mig_theme",isDark?"dark":"light");
  localStorage.setItem("society_dark_mode",isDark?"1":"0");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content",isDark?"#0f172a":"#ffffff");
}
document.getElementById("themeToggle")?.addEventListener("click",toggleTheme);
document.getElementById("mobThemeBtn")?.addEventListener("click",toggleTheme);
document.getElementById("themeToggleNew")?.addEventListener("click",toggleTheme);
document.getElementById("mobThemeBtnNew")?.addEventListener("click",toggleTheme);

/* ═══════════════════════════════════════════════
   DASHBOARD SHELL
═══════════════════════════════════════════════ */
const sidebar = document.getElementById("sidebar");
const mainContent = document.getElementById("mainContent");
const sidebarToggle = document.getElementById("sidebarToggle");
let sidebarCollapsed = localStorage.getItem("sb_collapsed") === "1";
function applySidebar(){
  if(sidebarCollapsed){ sidebar?.classList.add("collapsed"); mainContent?.classList.add("sidebar-collapsed"); }
  else{ sidebar?.classList.remove("collapsed"); mainContent?.classList.remove("sidebar-collapsed"); }
}
applySidebar();
sidebarToggle?.addEventListener("click",()=>{
  sidebarCollapsed=!sidebarCollapsed;
  localStorage.setItem("sb_collapsed",sidebarCollapsed?"1":"0");
  applySidebar();
});
const mobOverlay=document.getElementById("mobOverlay"),mobDrawer=document.getElementById("mobDrawer"),mobMenuBtn=document.getElementById("mobMenuBtn");
function openDrawer(){mobDrawer?.classList.add("open");mobOverlay?.classList.add("open");document.body.classList.add("modal-open")}
function closeDrawer(){mobDrawer?.classList.remove("open");mobOverlay?.classList.remove("open");document.body.classList.remove("modal-open")}
mobMenuBtn?.addEventListener("click",openDrawer);
mobOverlay?.addEventListener("click",closeDrawer);

/* ═══════════════════════════════════════════════
   TOAST
═══════════════════════════════════════════════ */
function showToast(msg){
  const t=document.getElementById("toast");
  t.textContent=msg;
  t.classList.add("show");
  setTimeout(()=>t.classList.remove("show"),2600);
}

/* ═══════════════════════════════════════════════
   LOAD DIRECTORY DATA
═══════════════════════════════════════════════ */
async function loadDirectory(){
  const urls=[
    `https://docs.google.com/spreadsheets/d/${DIRECTORY_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(DIRECTORY_TAB_NAME)}`,
    `https://docs.google.com/spreadsheets/d/${DIRECTORY_SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(DIRECTORY_TAB_NAME)}`,
  ];
  let csv="";
  for(const url of urls){
    try{
      const r=await fetch(url,{cache:"no-cache"});
      const t=await r.text();
      const p=t.trim().slice(0,200).toLowerCase();
      if(!t.trim()||p.startsWith("<!doctype")||p.includes("<html")||t.includes("File not found"))continue;
      csv=t;break;
    }catch(_){}
  }
  if(!csv)return;
  const lines=csv.split("\n").filter(Boolean);
  const rawH=parseCSV(lines[0]);
  const rawR=lines.slice(1).map(parseCSV);
  const ki=[];rawH.forEach((h,i)=>{if(String(h||"").trim())ki.push(i);});
  directoryHeaders=ki.map(i=>String(rawH[i]||"").trim());
  directoryRows=rawR.map(r=>ki.map(i=>r[i]||""));
  ["navResidents","navResidentsNew","drawerNavResidents"].forEach(id=>{
    const np=document.getElementById(id);
    if(np)np.textContent=directoryRows.length;
  });
  // Hero stats
  const heroFlats=document.getElementById("heroStatFlats");
  const heroOcc=document.getElementById("heroStatOccupied");
  if(heroFlats)heroFlats.textContent=directoryRows.length;
  if(heroOcc){
    const ocI=hiIdx(["occupied by","occupiedby"]);
    const occupiedCount=ocI>=0?directoryRows.filter(r=>String(r[ocI]||"").trim().toLowerCase()!=="vacant"&&String(r[ocI]||"").trim()!=="").length:directoryRows.length;
    heroOcc.textContent=occupiedCount;
  }
}

async function fetchCsv(sheetId,tabName){
  const urls=[
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${encodeURIComponent(tabName)}`,
  ];
  for(const url of urls){
    try{
      const r=await fetch(url,{cache:"no-cache"});
      const t=await r.text();
      const lc=t.trim().slice(0,200).toLowerCase();
      if(!t.trim()||lc.startsWith("<!doctype")||lc.includes("<html")||lc.includes("google.visualization.query.setresponse")||t.includes("File not found")||t.includes("error"))continue;
      return t;
    }catch(_){}
  }
  return "";
}

/* ═══════════════════════════════════════════════
   LOAD PAYMENT DATA
   FIXED: Normalize block+flat keys for reliable matching
═══════════════════════════════════════════════ */
async function loadPayments(){
  allPaymentRecords = [];
  const jobs=[];
  Object.entries(PAYMENT_SHEET_IDS).forEach(([year,sid])=>{
    MONTH_TABS.forEach((tab,monthIndex)=>{
      if(year==="2025" && monthIndex<5)return;
      jobs.push({year,sid,tab,monthIndex});
    });
  });
  const batchSize=8;
  for(let i=0;i<jobs.length;i+=batchSize){
    const batch=jobs.slice(i,i+batchSize);
    const rows=await Promise.all(batch.map(async job=>{
      const csv=await fetchCsv(job.sid,job.tab);
      return csv?{...job,csv}:null;
    }));
    rows.filter(Boolean).forEach(job=>parsePaymentTab(job));
  }
}

/* Normalize a block value to a canonical form like "block-1" for matching */
function normBlock(v){
  const s=String(v||"").trim().toLowerCase();
  // Extract just the number
  const m=s.match(/\d+/);
  return m?`block-${Number(m[0])}`:"";
}
/* Normalize flat number: trim, lowercase */
function normFlat(v){
  return String(v||"").trim().toLowerCase();
}

function parsePaymentTab({year,tab,monthIndex,csv}){
  const lines=csv.split("\n").filter(Boolean);
  if(lines.length<2)return;
  const headers=parseCSV(lines[0]).map(h=>norm(h));
  const fallback={block:0,flat:1,amount:2,mode:3,date:4,status:5,receivedBy:6,remarks:7,paidMonths:8};
  const idx=(patterns,fb)=>{const found=headers.findIndex(h=>patterns.some(p=>h.includes(p)));return found>=0?found:fb;};
  const blockIdx=idx(["block"],fallback.block);
  const flatIdx=idx(["flat","house","apartment"],fallback.flat);
  const amtIdx=idx(["amount","amt"],fallback.amount);
  const modeIdx=idx(["mode","method"],fallback.mode);
  const dateIdx=idx(["date"],fallback.date);
  const statusIdx=idx(["status","done","paid"],fallback.status);
  const receivedByIdx=idx(["received","collected by","received by"],fallback.receivedBy);
  const remarksIdx=idx(["remark","note","description"],fallback.remarks);
  const paidMonthsIdx=idx(["paid month","month paid"],fallback.paidMonths);

  lines.slice(1).forEach(line=>{
    const cols=parseCSV(line);
    if(!cols.some(c=>c.trim()))return;
    const rawBlock=blockIdx>=0?String(cols[blockIdx]||"").trim():"";
    const rawFlat=flatIdx>=0?String(cols[flatIdx]||"").trim():"";
    if(!rawBlock&&!rawFlat)return;

    const amount=amtIdx>=0?Number(String(cols[amtIdx]||"0").replace(/[^\d.]/g,""))||0:0;
    const paymentDate=dateIdx>=0?String(cols[dateIdx]||"").trim():"";
    const paymentMode=modeIdx>=0?String(cols[modeIdx]||"").trim():"";
    const rawStatus=statusIdx>=0?String(cols[statusIdx]||"").trim().toUpperCase():"";
    const remarks=remarksIdx>=0?String(cols[remarksIdx]||"").trim():"";
    const paidMonths=paidMonthsIdx>=0?String(cols[paidMonthsIdx]||"").trim():"";
    const receivedBy=receivedByIdx>=0?String(cols[receivedByIdx]||"").trim():"";

    const month=MONTH_LABELS[monthIndex] || tab;

    let status=rawStatus;
    if(!status){
      if(amount>0&&paymentDate)status="PAID";
      else if(amount>0)status="PARTIAL";
      else status="PENDING";
    }
    if(status==="DONE"||status==="YES"||status==="Y")status="PAID";
    if(!["PAID","PENDING","PARTIAL","OVERDUE"].includes(status)){
      if(amount>0&&paymentDate)status="PAID";
      else if(amount>0)status="PARTIAL";
      else status="PENDING";
    }

    // Store both display and normalized keys for matching
    allPaymentRecords.push({
      tabName:tab,month,year,monthIndex,
      block:blockDisp(rawBlock),        // display form e.g. "Block-1"
      flat:rawFlat,                      // raw flat from payment sheet
      blockNorm:normBlock(rawBlock),     // normalized e.g. "block-1"
      flatNorm:normFlat(rawFlat),        // normalized flat
      amount,paymentDate,paymentMode,status,remarks,paidMonths,receivedBy
    });
  });
}

/* ═══════════════════════════════════════════════
   SEARCH & SUGGESTIONS
═══════════════════════════════════════════════ */
const mainSearch=document.getElementById("mainSearch");
const sugWrap=document.getElementById("suggestionsWrap");
const searchClear=document.getElementById("searchClear");

function getSearchCandidates(q){
  if(!q||q.length<2)return[];
  const bI=hiIdx(["block"]);
  const fI=hiIdx(["flat","house","apartment"]);
  const oI=personIdx(["owner name","owner"]);
  const tI=personIdx(["tenant name","tenant"]);
  const ocI=hiIdx(["occupied by","occupiedby"]);
  const moI=hiIdx(["owner contact","owner mobile","owner phone"]);
  const mtI=hiIdx(["tenant contact","tenant mobile","tenant phone"]);
  const results=[];
  directoryRows.forEach(r=>{
    const bv=blockDisp(r[bI]||"");
    const fv=String(r[fI]||"").trim();
    const flatKey=`${bv}-${fv}`.toLowerCase();
    const blockShort=bv.replace("Block-","B").toLowerCase();
    const compactKeys=[flatKey,`${blockShort}-${fv}`,`${blockShort}${fv}`,`${bv.replace(/[^0-9]/g,"")}-${fv}`].map(norm);
    const ov=oI>=0?String(r[oI]||"").trim():"";
    const tv=tI>=0?String(r[tI]||"").trim():"";
    const oMob=moI>=0?normPhone(r[moI]):"";
    const tMob=mtI>=0?normPhone(r[mtI]):"";
    const occ=ocI>=0?String(r[ocI]||"").trim().toLowerCase():"";
    let score=0;
    if(compactKeys.some(k=>k.includes(q))||bv.toLowerCase().includes(q)||fv.toLowerCase().includes(q))score+=10;
    if(norm(ov).includes(q))score+=8;
    if(norm(tv).includes(q))score+=8;
    if(oMob.includes(q)||normPhone(q)&&oMob.includes(normPhone(q)))score+=9;
    if(tMob.includes(q)||normPhone(q)&&tMob.includes(normPhone(q)))score+=9;
    if(score>0)results.push({score,bv,fv,ov,tv,occ,row:r});
  });
  return results.sort((a,b)=>b.score-a.score).slice(0,8);
}

function renderSuggestions(q){
  const items=getSearchCandidates(q);
  if(!q||q.length<2){sugWrap.classList.remove("open");return;}
  if(!items.length){
    sugWrap.innerHTML=`<div class="sug-no-results"><div class="sug-no-results-icon"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="9" cy="9" r="6"/><line x1="14" y1="14" x2="19" y2="19"/><line x1="6" y1="9" x2="12" y2="9"/></svg></div>No flats found for <strong>"${esc(q)}"</strong><div style="font-size:0.72rem;color:var(--ink-4);margin-top:2px">Try flat number, name, or mobile</div></div>`;
    sugWrap.classList.add("open");return;
  }
  const html=`<div class="sug-header">Matching Flats <span class="sug-header-count">${items.length}</span></div>`+items.map(it=>{
    const label=it.occ==="tenant"?"tenant":it.occ==="owner"?"owner":"vacant";
    const names=[it.ov&&`Owner: ${it.ov}`,it.tv&&`Tenant: ${it.tv}`].filter(Boolean).join(" · ")||"No resident data";
    const blockShort=it.bv.replace("Block-","B");
    return`<div class="sug-item" data-block="${esc(it.bv)}" data-flat="${esc(it.fv)}">
      <div class="sug-avatar ${label}">${esc(blockShort)}</div>
      <div class="sug-info">
        <div class="sug-flat">${esc(it.bv)} · Flat <strong>${esc(it.fv)}</strong></div>
        <div class="sug-names">${esc(names)}</div>
      </div>
      <span class="sug-badge ${label}">${label.charAt(0).toUpperCase()+label.slice(1)}</span>
    </div>`;
  }).join("");
  sugWrap.innerHTML=html;
  sugWrap.classList.add("open");
}

mainSearch.addEventListener("input",()=>{
  const q=norm(mainSearch.value);
  searchClear.classList.toggle("visible",!!mainSearch.value);
  renderSuggestions(q);
});

mainSearch.addEventListener("keydown",e=>{
  if(e.key==="Enter"){
    sugWrap.classList.remove("open");
    const q=norm(mainSearch.value);
    const items=getSearchCandidates(q);
    if(items.length===1){openProfile(items[0].bv,items[0].fv);}
    else if(items.length>1){
      const exact=items.find(it=>{
        const bs=it.bv.replace("Block-","B").toLowerCase();
        return it.fv.toLowerCase()===q||`${it.bv.toLowerCase()}-${it.fv.toLowerCase()}`===q||`${bs}-${it.fv.toLowerCase()}`===q||`${bs}${it.fv.toLowerCase()}`===q;
      });
      if(exact)openProfile(exact.bv,exact.fv);
    }
  }
});

searchClear.addEventListener("click",()=>{
  mainSearch.value="";searchClear.classList.remove("visible");
  sugWrap.classList.remove("open");
});

document.getElementById("searchBtn")?.addEventListener("click",()=>{
  sugWrap.classList.remove("open");
  const q=norm(mainSearch.value);
  const items=getSearchCandidates(q);
  if(items.length>=1)openProfile(items[0].bv,items[0].fv);
});

sugWrap.addEventListener("click",e=>{
  const item=e.target.closest(".sug-item");
  if(!item)return;
  const{block,flat}=item.dataset;
  sugWrap.classList.remove("open");
  openProfile(block,flat);
});

document.addEventListener("click",e=>{
  if(!e.target.closest(".search-box-wrap"))sugWrap.classList.remove("open");
});

/* ═══════════════════════════════════════════════
   OPEN PROFILE
═══════════════════════════════════════════════ */
function openProfile(block,flat){
  const bI=hiIdx(["block"]);
  const fI=hiIdx(["flat","house","apartment"]);
  const row=directoryRows.find(r=>blockDisp(r[bI]||"")===block&&String(r[fI]||"").trim()===String(flat||"").trim());
  if(!row)return;

  currentFlatData={block,flat,row};
  mainSearch.value=`${block} · Flat ${flat}`;
  searchClear.classList.add("visible");

  document.getElementById("searchPrompt").style.display="none";
  const panel=document.getElementById("profilePanel");
  panel.classList.add("visible");

  document.getElementById("flatIdText").textContent=`${block.replace("Block-","B")}-${flat}`;
  document.getElementById("flatTitle").textContent=`${block} / Flat ${flat}`;
  document.getElementById("flatSub").textContent="Loading complete profile…";

  document.getElementById("loadingCards").style.display="grid";
  document.getElementById("infoSections").style.display="none";
  document.getElementById("paySection").style.display="none";
  document.getElementById("payKpiStrip").style.display="none";
  document.getElementById("vehicleCard").style.display="none";
  document.getElementById("payAlerts").innerHTML="";

  setTimeout(()=>renderProfile(block,flat,row),200);
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}

/* ═══════════════════════════════════════════════
   RENDER PROFILE
═══════════════════════════════════════════════ */
function renderProfile(block,flat,row){
  document.getElementById("loadingCards").style.display="none";
  document.getElementById("infoSections").style.display="grid";
  document.getElementById("paySection").style.display="block";
  document.getElementById("payKpiStrip").style.display="grid";

  // Index helpers
  const bI=hiIdx(["block"]);
  const fI=hiIdx(["flat","house","apartment"]);
  const floorI=hiIdx(["floor","storey"]);
  const typeI=hiIdx(["type","bhk","unit type"]);
  const areaI=hiIdx(["area","sqft","sq ft"]);
  const parkI=hiIdx(["parking","park slot"]);
  const vehI=hiIdx(["vehicle type","veh type","vehicle"]);
  const vehNoI=hiIdx(["vehicle no","number plate","registration"]);
  const occI=hiIdx(["occupied by","occupiedby"]);

  const oNameI=personIdx(["owner name","owner"]);
  const oMobI=hiIdx(["owner contact","owner mobile","owner phone","owner whatsapp"]);
  const oEmailI=hiIdx(["owner email","owner mail"]);
  const oCityI=hiIdx(["owner city","owner location","owner address"]);

  const tNameI=personIdx(["tenant name","tenant"]);
  const tMobI=hiIdx(["tenant contact","tenant mobile","tenant phone","tenant whatsapp"]);
  const tEmailI=hiIdx(["tenant email","tenant mail"]);
  const tSinceI=hiIdx(["tenant since","rent since","move in","joining date"]);

  // Flat info (no vehicle here anymore)
  const flatRows=[
    {k:"Block",v:blockDisp(row[bI]||"")},
    {k:"Flat No.",v:row[fI]||"—"},
    floorI>=0&&{k:"Floor",v:row[floorI]||"—"},
    typeI>=0&&{k:"Type",v:row[typeI]||"—"},
    areaI>=0&&{k:"Area",v:row[areaI]||"—"},
    parkI>=0&&{k:"Parking",v:row[parkI]||"—"},
    occI>=0&&{k:"Status",v:row[occI]||"—"},
  ].filter(Boolean);

  document.getElementById("flatInfoRows").innerHTML=flatRows.map(r=>cardRow(r.k,r.v)).join("");
  document.getElementById("flatInfoSub").textContent=`${row[fI]||""} · ${blockDisp(row[bI]||"")}`;

  // Owner info (with local override support)
  const oKey=`${block}_${flat}`;
  const ov=localOverrides.owners[oKey]||{};
  const oName=ov.name!==undefined?ov.name:(oNameI>=0?String(row[oNameI]||"").trim():"");
  const oMob=ov.mobile!==undefined?ov.mobile:(oMobI>=0?String(row[oMobI]||"").trim():"");
  const oEmail=ov.email!==undefined?ov.email:(oEmailI>=0?String(row[oEmailI]||"").trim():"");
  const oCity=ov.city!==undefined?ov.city:(oCityI>=0?String(row[oCityI]||"").trim():"");

  const ownerRows=[
    {k:"Name",v:oName||"—"},
    {k:"Mobile",v:oMob?phoneVal(oMob):"—",html:true},
    {k:"Email",v:oEmail||"—"},
    {k:"City/Location",v:oCity||"—"},
  ];
  document.getElementById("ownerInfoRows").innerHTML=ownerRows.map(r=>cardRow(r.k,r.v,r.html)).join("");
  document.getElementById("ownerSub").textContent=oName||"No owner data";

  // Tenant info (with local override support)
  const tv=localOverrides.tenants[oKey]||{};
  const tName=tv.name!==undefined?tv.name:(tNameI>=0?String(row[tNameI]||"").trim():"");
  const tMob=tv.mobile!==undefined?tv.mobile:(tMobI>=0?String(row[tMobI]||"").trim():"");
  const tEmail=tv.email!==undefined?tv.email:(tEmailI>=0?String(row[tEmailI]||"").trim():"");
  const tSince=tv.since!==undefined?tv.since:(tSinceI>=0?String(row[tSinceI]||"").trim():"");
  const vehNo=tv.vehicleNo!==undefined?tv.vehicleNo:(vehNoI>=0?String(row[vehNoI]||"").trim():"");
  const vehType=tv.vehicleType!==undefined?tv.vehicleType:(vehI>=0?String(row[vehI]||"").trim():"");

  const tenantRows=tName?[
    {k:"Name",v:tName},
    {k:"Mobile",v:tMob?phoneVal(tMob):"—",html:true},
    {k:"Email",v:tEmail||"—"},
    {k:"Tenant Since",v:tSince||"—"},
  ]:[{k:"Status",v:"No Tenant Currently"}];
  document.getElementById("tenantInfoRows").innerHTML=tenantRows.map(r=>cardRow(r.k,r.v,r.html)).join("");
  document.getElementById("tenantSub").textContent=tName?`Occupied by ${tName}`:"Vacant";

  // Vehicle details — always shown as 4th card in 2×2 grid
  const hasVehicle=vehNo||vehType;
  const vehicleCard=document.getElementById("vehicleCard");
  const vehicleSub=document.getElementById("vehicleSub");
  vehicleCard.style.display="flex";
  if(hasVehicle){
    const vehicleRows=[
      vehNo&&{k:"Vehicle No.",v:vehNo},
      vehType&&{k:"Vehicle Type",v:vehType},
    ].filter(Boolean);
    document.getElementById("vehicleInfoRows").innerHTML=vehicleRows.map(r=>cardRow(r.k,r.v)).join("");
    if(vehicleSub)vehicleSub.textContent=vehNo||vehType;
  } else {
    document.getElementById("vehicleInfoRows").innerHTML=`<div class="empty-state" style="padding:24px 16px"><div class="empty-icon"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="1" y="7" width="18" height="9" rx="2"/><path d="M5 7l2-4h6l2 4"/><circle cx="5.5" cy="16" r="1.5"/><circle cx="14.5" cy="16" r="1.5"/></svg></div><div class="empty-title">No Vehicle Details</div><div class="empty-sub">No vehicle registered for this flat</div></div>`;
    if(vehicleSub)vehicleSub.textContent="Not registered";
  }

  // Payment history for this flat — FIXED matching logic
  // We need to match payment block/flat with directory block/flat
  const dirBlockNorm=normBlock(block);        // e.g. "block-1"
  const dirFlatNorm=normFlat(flat);           // e.g. "101"

  const nowDate=new Date();
  const nowYear=nowDate.getFullYear();
  const nowMonthIdx=nowDate.getMonth(); // 0-based, Jan=0

  const flatPayments=allPaymentRecords.filter(p=>{
    // Match using normalized keys for reliable comparison
    const pBlockNorm=p.blockNorm||normBlock(p.block);
    const pFlatNorm=p.flatNorm||normFlat(p.flat);
    // Primary: normalized match
    const blockMatch=pBlockNorm===dirBlockNorm&&pFlatNorm===dirFlatNorm;
    // Fallback: display form match
    const fallbackMatch=norm(p.block)===norm(block)&&norm(p.flat)===norm(flat);
    if(!blockMatch&&!fallbackMatch)return false;
    // Only show records up to and including the current month/year
    const pYear=Number(p.year)||0;
    if(pYear>nowYear)return false;
    if(pYear===nowYear&&p.monthIndex>nowMonthIdx)return false;
    return true;
  });

  // Sort: latest first
  const monthOrder={"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"june":6,"jun":6,"july":7,"jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12};
  flatPayments.sort((a,b)=>{
    const ya=Number(a.year)||0,yb=Number(b.year)||0;
    if(ya!==yb)return yb-ya;
    return(monthOrder[norm(b.month)]||0)-(monthOrder[norm(a.month)]||0);
  });

  paymentFiltered=flatPayments;

  // Payment summary KPI strip
  const paid=flatPayments.filter(p=>p.status==="PAID").length;
  const pending=flatPayments.filter(p=>p.status==="PENDING").length;
  const partial=flatPayments.filter(p=>p.status==="PARTIAL").length;
  const overdue=flatPayments.filter(p=>p.status==="OVERDUE").length;
  document.getElementById("sumPaid").textContent=paid;
  document.getElementById("sumPending").textContent=pending+overdue;
  document.getElementById("sumPartial").textContent=partial;
  document.getElementById("sumTotal").textContent=flatPayments.length;

  // Alerts
  let alertsHtml="";
  if(overdue>0)alertsHtml+=`<div class="pay-alert danger"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="10" r="8"/><line x1="10" y1="6" x2="10" y2="10"/><circle cx="10" cy="14" r="0.5" fill="currentColor"/></svg>${overdue} overdue payment${overdue>1?"s":""} — immediate attention required</div>`;
  if(pending>0)alertsHtml+=`<div class="pay-alert warning"><svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 2l8 15H2z"/><line x1="10" y1="9" x2="10" y2="13"/><circle cx="10" cy="16" r="0.5" fill="currentColor"/></svg>${pending} pending payment${pending>1?"s":""} need to be collected</div>`;
  document.getElementById("payAlerts").innerHTML=alertsHtml;

  // Populate year filter
  const years=[...new Set(flatPayments.map(p=>p.year).filter(Boolean))].sort((a,b)=>Number(b)-Number(a));
  const yf=document.getElementById("payYearFilter");
  yf.innerHTML=`<option value="">All Years</option>`+years.map(y=>`<option value="${y}">${y}</option>`).join("");

  document.getElementById("payStatusFilter").value="";
  renderPaymentTable(flatPayments);

  document.getElementById("flatSub").textContent=`${flatPayments.length} payment record${flatPayments.length!==1?"s":""} · ${oName||"No owner"} · ${tName?`Tenant: ${tName}`:"Unoccupied"}`;
}

function cardRow(k,vRaw,isHtml=false){
  return`<div class="card-row"><span class="card-key">${esc(k)}</span><span class="card-val">${isHtml?vRaw:esc(vRaw)}</span></div>`;
}
function phoneVal(v){
  const clean=normPhone(v);
  return clean?`<a href="tel:${clean}">☎ ${esc(v)}</a>`:esc(v);
}

/* ═══════════════════════════════════════════════
   WRITE HELPERS
═══════════════════════════════════════════════ */
function submitWriteJsonp(action,payload,timeout=20000){
  return new Promise((resolve,reject)=>{
    const cb=`flatSaveCb_${Date.now()}_${Math.floor(Math.random()*1e5)}`;
    let scr,tid;
    const clean=()=>{
      delete window[cb];
      if(scr?.parentNode)scr.parentNode.removeChild(scr);
      if(tid)clearTimeout(tid);
    };
    window[cb]=result=>{ clean(); resolve(result||{ok:false,error:"Empty response."}); };
    const q=new URLSearchParams({action,callback:cb,payload:JSON.stringify(payload),_:String(Date.now())});
    scr=document.createElement("script");
    scr.src=`${WRITE_URL}?${q}`;
    scr.onerror=()=>{ clean(); reject(new Error("Save service unreachable.")); };
    tid=setTimeout(()=>{ clean(); reject(new Error("Save service timed out.")); },timeout);
    document.body.appendChild(scr);
  });
}

function setButtonBusy(id,busy,label="Saving…"){
  const btn=document.getElementById(id);
  if(!btn)return;
  if(busy){
    btn.dataset.label=btn.textContent;
    btn.textContent=label;
    btn.disabled=true;
  }else{
    btn.textContent=btn.dataset.label||"Save Changes";
    btn.disabled=false;
    delete btn.dataset.label;
  }
}

async function persistResidentRow(rowValues){
  const payload={
    action:"saveResident",
    secret:WRITE_SECRET,
    headers:directoryHeaders.slice(),
    rowValues
  };
  const result=await submitWriteJsonp("saveResident",payload,15000);
  if(!result.ok)throw new Error(result.error||"Resident save failed.");
  return result;
}

function applyResidentRowValues(row,rowValues){
  rowValues.forEach((value,index)=>{ row[index]=value; });
}

function todayInputDate(){
  const n=new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`;
}

function fmtSheetDate(inputDate){
  const [y,m,d]=String(inputDate||"").split("-");
  return y&&m&&d?`${m}/${d}/${y}`:"";
}

function paymentMonthCode(value){
  const raw=norm(value).replace(/[^a-z]/g,"");
  const idx=MONTH_TABS.findIndex((name,i)=>{
    const full=name.toLowerCase();
    const short=MONTH_LABELS[i].toLowerCase();
    return raw===full||raw===short||full.startsWith(raw)||short.startsWith(raw);
  });
  return idx>=0?MONTH_TABS[idx].slice(0,3):String(value||"").trim().toUpperCase();
}

function paidMonthsForRecord(record){
  const raw=String(record?.paidMonths||"").trim();
  const parts=raw.split(/[,;|/]+|\s+/).map(v=>v.trim()).filter(Boolean);
  if(parts.length)return parts.map(paymentMonthCode).filter(Boolean);
  const fallback=paymentMonthCode(record?.month||"");
  return fallback?[fallback]:[];
}

function toPaymentInputDate(value,record={}){
  const raw=String(value||"").trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
  const parts=raw.split(/[/-]/).map(v=>Number(v));
  if(parts.length!==3||parts.some(v=>!Number.isFinite(v)))return "";
  let [a,b,y]=parts;
  if(y<100)y+=2000;
  const targetMonth=Number(record.monthIndex)+1;
  let month=a,day=b;
  if(targetMonth>=1&&targetMonth<=12){
    if(a===targetMonth){ month=a; day=b; }
    else if(b===targetMonth){ month=b; day=a; }
  }
  if(month<1||month>12||day<1||day>31)return "";
  return `${y}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
}

/* ═══════════════════════════════════════════════
   PAYMENT TABLE RENDER
═══════════════════════════════════════════════ */
function renderPaymentTable(records){
  const tbody=document.getElementById("payTableBody");
  const cardList=document.getElementById("payCardList");
  document.getElementById("payCountBadge").textContent=`${records.length} record${records.length!==1?"s":""}`;

  if(!records.length){
    const noData=`<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--ink-3);font-size:0.82rem">No payment records found for this flat</td></tr>`;
    tbody.innerHTML=noData;
    cardList.innerHTML=`<div class="empty-state"><div class="empty-icon"><svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="2" y="4" width="16" height="13" rx="2.5"/><line x1="2" y1="9" x2="18" y2="9"/></svg></div><div class="empty-title">No Payment Records</div><div class="empty-sub">No payment history found for this flat</div></div>`;
    return;
  }

  tbody.innerHTML=records.map((p,idx)=>{
    const badge=statusBadge(p.status);
    const amt=p.amount?`₹${p.amount.toLocaleString("en-IN")}`:"—";
    const realIdx=paymentFiltered.indexOf(p);
    return`<tr data-pay-idx="${realIdx>=0?realIdx:idx}" class="pay-row-editable" title="Click to edit this record">
      <td class="month-col">${esc(p.month)} ${esc(p.year)}</td>
      <td class="amount-col">${esc(amt)}</td>
      <td class="mono">${esc(p.paymentDate)||"—"}</td>
      <td>${esc(p.paymentMode)||"—"}</td>
      <td style="max-width:140px;font-size:0.75rem;color:var(--ink-3)">${esc(p.paidMonths||"—")}</td>
      <td style="max-width:160px;font-size:0.75rem;color:var(--ink-3)">${esc(p.remarks||"—")}</td>
      <td>${badge}</td>
      <td><div class="pay-row-actions">
        <button class="pay-row-edit-btn" data-action="edit" type="button" title="Edit">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M11 2l3 3L5 14l-4 1 1-4z"/><line x1="9" y1="4" x2="12" y2="7"/></svg>
        </button>
        <button class="pay-row-del-btn" data-action="delete" type="button" title="Delete">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="2,4 4,4 14,4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M13 4l-1 9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2L3 4"/><line x1="7" y1="7" x2="7" y2="11"/><line x1="9" y1="7" x2="9" y2="11"/></svg>
        </button>
      </div></td>
    </tr>`;
  }).join("");

  // Row click → edit; individual buttons handled separately
  tbody.querySelectorAll("tr[data-pay-idx]").forEach(tr=>{
    tr.addEventListener("click",e=>{
      if(e.target.closest("[data-action]"))return;
      openPaymentEditModal(Number(tr.dataset.payIdx));
    });
    tr.querySelector("[data-action='edit']")?.addEventListener("click",e=>{
      e.stopPropagation();
      openPaymentEditModal(Number(tr.dataset.payIdx));
    });
    tr.querySelector("[data-action='delete']")?.addEventListener("click",e=>{
      e.stopPropagation();
      openConfirmDeleteDirect(Number(tr.dataset.payIdx));
    });
  });

  cardList.innerHTML=records.map((p,idx)=>{
    const amt=p.amount?`₹${p.amount.toLocaleString("en-IN")}`:"—";
    const realIdx=paymentFiltered.indexOf(p);
    const dateChip=p.paymentDate
      ?`<span class="pay-card-chip"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="5" y1="1" x2="5" y2="4"/><line x1="11" y1="1" x2="11" y2="4"/><line x1="2" y1="7" x2="14" y2="7"/></svg>${esc(p.paymentDate)}</span>`:"";
    const modeChip=p.paymentMode
      ?`<span class="pay-card-chip"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="1" y="3" width="14" height="10" rx="2"/><line x1="1" y1="7" x2="15" y2="7"/></svg>${esc(p.paymentMode)}</span>`:"";
    const monthsChip=p.paidMonths
      ?`<span class="pay-card-chip"><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="3,8 6,11 13,5"/></svg>${esc(p.paidMonths)}</span>`:"";
    return`<div class="pay-card" data-pay-idx="${realIdx>=0?realIdx:idx}" data-status="${esc(p.status||'PENDING')}" style="cursor:pointer">
      <div class="pay-card-top">
        <div class="pay-card-month-wrap">
          <div class="pay-card-month">${esc(p.month)}</div>
          <div class="pay-card-year">${esc(p.year)}</div>
        </div>
        <div class="pay-card-amount">${esc(amt)}</div>
      </div>
      ${(dateChip||modeChip||monthsChip)?`<div class="pay-card-meta">${dateChip}${modeChip}${monthsChip}</div>`:""}
      <div class="pay-card-footer">
        ${statusBadge(p.status)}
        <div class="pay-card-actions">
          <button class="pay-row-edit-btn" data-action="edit" type="button" title="Edit">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M11 2l3 3L5 14l-4 1 1-4z"/><line x1="9" y1="4" x2="12" y2="7"/></svg>
          </button>
          <button class="pay-row-del-btn" data-action="delete" type="button" title="Delete">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><polyline points="2,4 4,4 14,4"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M13 4l-1 9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2L3 4"/><line x1="7" y1="7" x2="7" y2="11"/><line x1="9" y1="7" x2="9" y2="11"/></svg>
          </button>
        </div>
      </div>
    </div>`;
  }).join("");

  cardList.querySelectorAll(".pay-card[data-pay-idx]").forEach(card=>{
    card.addEventListener("click",e=>{
      if(e.target.closest("[data-action]"))return;
      openPaymentEditModal(Number(card.dataset.payIdx));
    });
    card.querySelector("[data-action='edit']")?.addEventListener("click",e=>{
      e.stopPropagation();
      openPaymentEditModal(Number(card.dataset.payIdx));
    });
    card.querySelector("[data-action='delete']")?.addEventListener("click",e=>{
      e.stopPropagation();
      openConfirmDeleteDirect(Number(card.dataset.payIdx));
    });
  });
}

function statusBadge(status){
  const map={PAID:"status-paid",PENDING:"status-pending",PARTIAL:"status-partial",OVERDUE:"status-overdue"};
  const cls=map[status]||"status-pending";
  const label=status?status.charAt(0)+status.slice(1).toLowerCase():"Unknown";
  return`<span class="status-badge ${cls}" role="status" aria-label="Payment status: ${label}">${label}</span>`;
}

/* ═══════════════════════════════════════════════
   PAYMENT FILTERS
═══════════════════════════════════════════════ */
function applyPaymentFilters(){
  if(!currentFlatData)return;
  const year=document.getElementById("payYearFilter").value;
  const status=document.getElementById("payStatusFilter").value;
  let filtered=paymentFiltered;
  if(year)filtered=filtered.filter(p=>p.year===year);
  if(status)filtered=filtered.filter(p=>p.status===status);
  renderPaymentTable(filtered);
}
document.getElementById("payYearFilter").addEventListener("change",applyPaymentFilters);
document.getElementById("payStatusFilter").addEventListener("change",applyPaymentFilters);

/* ═══════════════════════════════════════════════
   EDIT MODALS — OWNER
═══════════════════════════════════════════════ */
function openOwnerEditModal(){
  if(!currentFlatData)return;
  const{block,flat,row}=currentFlatData;
  const oNameI=personIdx(["owner name","owner"]);
  const oMobI=hiIdx(["owner contact","owner mobile","owner phone","owner whatsapp"]);
  const oEmailI=hiIdx(["owner email","owner mail"]);
  const oCityI=hiIdx(["owner city","owner location","owner address"]);
  const oKey=`${block}_${flat}`;
  const ov=localOverrides.owners[oKey]||{};

  document.getElementById("editOwnerName").value=ov.name!==undefined?ov.name:(oNameI>=0?row[oNameI]:"");
  document.getElementById("editOwnerMobile").value=ov.mobile!==undefined?ov.mobile:(oMobI>=0?row[oMobI]:"");
  document.getElementById("editOwnerEmail").value=ov.email!==undefined?ov.email:(oEmailI>=0?row[oEmailI]:"");
  document.getElementById("editOwnerCity").value=ov.city!==undefined?ov.city:(oCityI>=0?row[oCityI]:"");

  openModal("ownerModal");
}

async function saveOwnerEdit(){
  if(!currentFlatData)return;
  const{block,flat,row}=currentFlatData;
  const oKey=`${block}_${flat}`;
  const oNameI=personIdx(["owner name","owner"]);
  const oMobI=hiIdx(["owner contact","owner mobile","owner phone","owner whatsapp"]);
  const oEmailI=hiIdx(["owner email","owner mail"]);
  const oCityI=hiIdx(["owner city","owner location","owner address"]);
  const rowValues=directoryHeaders.map((_,i)=>row[i]||"");
  if(oNameI>=0)rowValues[oNameI]=document.getElementById("editOwnerName").value.trim();
  if(oMobI>=0)rowValues[oMobI]=document.getElementById("editOwnerMobile").value.trim();
  if(oEmailI>=0)rowValues[oEmailI]=document.getElementById("editOwnerEmail").value.trim();
  if(oCityI>=0)rowValues[oCityI]=document.getElementById("editOwnerCity").value.trim();

  setButtonBusy("ownerModalSave",true);
  try{
    await persistResidentRow(rowValues);
    applyResidentRowValues(row,rowValues);
    delete localOverrides.owners[oKey];
    closeModal("ownerModal");
    renderProfile(block,flat,row);
    showToast("Owner details saved ✓");
  }catch(ex){
    showToast(ex.message||"Unable to save owner details");
  }finally{
    setButtonBusy("ownerModalSave",false);
  }
}

document.getElementById("editOwnerBtn").addEventListener("click",openOwnerEditModal);
document.getElementById("ownerModalSave").addEventListener("click",saveOwnerEdit);
document.getElementById("ownerModalClose").addEventListener("click",()=>closeModal("ownerModal"));
document.getElementById("ownerModalCancel").addEventListener("click",()=>closeModal("ownerModal"));

/* ═══════════════════════════════════════════════
   EDIT MODALS — TENANT
═══════════════════════════════════════════════ */
function openTenantEditModal(){
  if(!currentFlatData)return;
  const{block,flat,row}=currentFlatData;
  const tNameI=personIdx(["tenant name","tenant"]);
  const tMobI=hiIdx(["tenant contact","tenant mobile","tenant phone","tenant whatsapp"]);
  const tEmailI=hiIdx(["tenant email","tenant mail"]);
  const tSinceI=hiIdx(["tenant since","rent since","move in","joining date"]);
  const vehNoI=hiIdx(["vehicle no","number plate","registration"]);
  const vehI=hiIdx(["vehicle type","veh type","vehicle"]);
  const oKey=`${block}_${flat}`;
  const tv=localOverrides.tenants[oKey]||{};

  document.getElementById("editTenantName").value=tv.name!==undefined?tv.name:(tNameI>=0?row[tNameI]:"");
  document.getElementById("editTenantMobile").value=tv.mobile!==undefined?tv.mobile:(tMobI>=0?row[tMobI]:"");
  document.getElementById("editTenantEmail").value=tv.email!==undefined?tv.email:(tEmailI>=0?row[tEmailI]:"");
  document.getElementById("editTenantSince").value=tv.since!==undefined?tv.since:(tSinceI>=0?row[tSinceI]:"");
  document.getElementById("editVehicleNo").value=tv.vehicleNo!==undefined?tv.vehicleNo:(vehNoI>=0?row[vehNoI]:"");
  document.getElementById("editVehicleType").value=tv.vehicleType!==undefined?tv.vehicleType:(vehI>=0?row[vehI]:"");

  openModal("tenantModal");
}

async function saveTenantEdit(){
  if(!currentFlatData)return;
  const{block,flat,row}=currentFlatData;
  const oKey=`${block}_${flat}`;
  const tNameI=personIdx(["tenant name","tenant"]);
  const tMobI=hiIdx(["tenant contact","tenant mobile","tenant phone","tenant whatsapp"]);
  const tEmailI=hiIdx(["tenant email","tenant mail"]);
  const tSinceI=hiIdx(["tenant since","rent since","move in","joining date"]);
  const vehNoI=hiIdx(["vehicle no","number plate","registration"]);
  const vehI=hiIdx(["vehicle type","veh type","vehicle"]);
  const rowValues=directoryHeaders.map((_,i)=>row[i]||"");
  if(tNameI>=0)rowValues[tNameI]=document.getElementById("editTenantName").value.trim();
  if(tMobI>=0)rowValues[tMobI]=document.getElementById("editTenantMobile").value.trim();
  if(tEmailI>=0)rowValues[tEmailI]=document.getElementById("editTenantEmail").value.trim();
  if(tSinceI>=0)rowValues[tSinceI]=document.getElementById("editTenantSince").value.trim();
  if(vehNoI>=0)rowValues[vehNoI]=document.getElementById("editVehicleNo").value.trim();
  if(vehI>=0)rowValues[vehI]=document.getElementById("editVehicleType").value.trim();

  setButtonBusy("tenantModalSave",true);
  try{
    await persistResidentRow(rowValues);
    applyResidentRowValues(row,rowValues);
    delete localOverrides.tenants[oKey];
    closeModal("tenantModal");
    renderProfile(block,flat,row);
    showToast("Tenant details saved ✓");
  }catch(ex){
    showToast(ex.message||"Unable to save tenant details");
  }finally{
    setButtonBusy("tenantModalSave",false);
  }
}

document.getElementById("editTenantBtn").addEventListener("click",openTenantEditModal);
document.getElementById("tenantModalSave").addEventListener("click",saveTenantEdit);
document.getElementById("tenantModalClose").addEventListener("click",()=>closeModal("tenantModal"));
document.getElementById("tenantModalCancel").addEventListener("click",()=>closeModal("tenantModal"));

/* ═══════════════════════════════════════════════
   EDIT MODALS — PAYMENT (ENHANCED)
═══════════════════════════════════════════════ */

/* ── Month picker helpers ── */
const PAY_MONTH_LBLS = ["JAN","FEB","MAR","APR","MAY","JUNE","JULY","AUG","SEP","OCT","NOV","DEC"];

function buildPayMonthPicker(){
  const grid=document.getElementById("payMonthOptionsGrid");
  if(grid.children.length)return;
  grid.innerHTML=PAY_MONTH_LBLS.map(m=>`<label class="pay-month-option"><input type="checkbox" value="${m}"><span>${m}</span></label>`).join("");
  grid.addEventListener("change",updatePayMonthTrigger);
}
function updatePayMonthTrigger(){
  const sel=getSelectedPayMonths();
  document.getElementById("payMonthPickerTrigger").textContent=sel.length?sel.join(", "):"Select months";
}
function getSelectedPayMonths(){
  return Array.from(document.querySelectorAll("#payMonthOptionsGrid input:checked")).map(i=>i.value);
}
function setPayMonthPickerOpen(o){
  const w=document.getElementById("payMonthPickerWrap"),t=document.getElementById("payMonthPickerTrigger");
  w.classList.toggle("open",o); t.setAttribute("aria-expanded",o?"true":"false");
}
function setPayMonthOptions(selected=[]){
  buildPayMonthPicker();
  const normPay=v=>{
    const raw=String(v||"").trim().toUpperCase();
    const i=MONTH_TABS.findIndex(m=>m===raw||m.substring(0,3)===raw.substring(0,3));
    return i>=0?PAY_MONTH_LBLS[i]:raw;
  };
  const s=new Set(selected.map(normPay));
  document.querySelectorAll("#payMonthOptionsGrid .pay-month-option").forEach(opt=>{
    const inp=opt.querySelector("input"); if(!inp)return;
    const active=s.has(inp.value);
    inp.checked=active; opt.classList.toggle("selected",active);
  });
  updatePayMonthTrigger();
}

/* Sync checkbox → visual class */
document.addEventListener("change",e=>{
  if(e.target.closest("#payMonthOptionsGrid")){
    const opt=e.target.closest(".pay-month-option");
    if(opt)opt.classList.toggle("selected",e.target.checked);
  }
});

/* Month picker trigger */
document.getElementById("payMonthPickerTrigger").addEventListener("click",e=>{
  e.stopPropagation();
  setPayMonthPickerOpen(!document.getElementById("payMonthPickerWrap").classList.contains("open"));
});
document.getElementById("payMonthPickerDropdown").addEventListener("click",e=>e.stopPropagation());
document.addEventListener("click",e=>{
  if(!e.target.closest("#payMonthPickerWrap"))setPayMonthPickerOpen(false);
});

function setPayFormMsg(msg,ok=false){
  const el=document.getElementById("payFormMsg");
  el.textContent=msg;
  el.className="pay-form-msg"+(ok?" success":"");
}

function openPaymentEditModal(idx){
  const records=paymentFiltered;
  if(idx<0||idx>=records.length)return;
  editingPaymentIdx=idx;
  const p=records[idx];

  buildPayMonthPicker();
  setPayFormMsg("");
  setPayMonthPickerOpen(false);

  /* Pre-fill read-only flat context */
  document.getElementById("editPayBlock").value=p.block||"";
  document.getElementById("editPayFlat").value=p.flat||"";

  /* Pre-fill editable fields */
  document.getElementById("editPayAmount").value=p.amount||"";
  document.getElementById("editPayMode").value=(p.paymentMode||"ONLINE").toUpperCase()==="CASH"?"CASH":"ONLINE";
  document.getElementById("editPayDate").value=toPaymentInputDate(p.paymentDate,p)||todayInputDate();
  document.getElementById("editPayDate").max=todayInputDate();
  document.getElementById("editPayRemarks").value=p.remarks||"";

  /* Pre-fill month picker from existing record */
  const pm=paidMonthsForRecord(p);
  setPayMonthOptions(pm.length?pm:[p.month||""]);

  openModal("paymentModal");
}

async function savePaymentEdit(){
  if(editingPaymentIdx<0)return;
  const records=paymentFiltered;
  if(editingPaymentIdx>=records.length)return;
  const p=records[editingPaymentIdx];

  const amount=Number(document.getElementById("editPayAmount").value);
  const payDate=document.getElementById("editPayDate").value;
  const mode=document.getElementById("editPayMode").value;
  const paidMonths=getSelectedPayMonths();
  const rawRemarks=document.getElementById("editPayRemarks").value.trim();
  // Build audit note: "Payment added on DD/MM/YYYY for amount ₹XXX"
  const auditDate=(()=>{
    if(!payDate)return "";
    const [y,m,d]=payDate.split("-");
    return`${d}/${m}/${y}`;
  })();
  const auditNote=auditDate?`Payment added on ${auditDate} for amount ₹${amount}`:"";
  const remarks=rawRemarks?(rawRemarks+(auditNote?` | ${auditNote}`:"")):auditNote;

  if(!Number.isInteger(amount)||amount<=0){ setPayFormMsg("Please enter a valid whole number amount."); return; }
  if(!payDate){ setPayFormMsg("Please select a valid payment date."); return; }
  if(payDate>todayInputDate()){ setPayFormMsg("Payment date cannot be in the future."); return; }
  if(!paidMonths.length){ setPayFormMsg("Please select at least one month."); return; }

  const payload={
    secret:WRITE_SECRET,
    actionType:"update",
    block:p.block,
    flatNo:p.flat,
    amount,
    paymentMode:mode,
    receivedBy:p.receivedBy||"",
    paymentDate:fmtSheetDate(payDate),
    paymentDateInput:payDate,
    paymentMonthSheet:paymentMonthCode(document.getElementById("editPayDate").value),
    paidMonths,
    notes:remarks,
    paymentStatus:"DONE"
  };

  setButtonBusy("paymentModalSave",true);
  setPayFormMsg("Saving…");
  try{
    const result=await submitWriteJsonp("savePayment",payload,20000);
    if(!result.ok)throw new Error(result.error||"Payment save failed.");
    await loadPayments();
    setPayFormMsg("Saved!",true);
    setTimeout(()=>{
      closeModal("paymentModal");
      if(currentFlatData)renderProfile(currentFlatData.block,currentFlatData.flat,currentFlatData.row);
      showToast("Payment updated ✓");
      editingPaymentIdx=-1;
    },600);
  }catch(ex){
    setPayFormMsg(ex.message||"Unable to save payment record");
  }finally{
    setButtonBusy("paymentModalSave",false);
  }
}

async function deletePaymentRecord(){
  if(editingPaymentIdx<0)return;
  const records=paymentFiltered;
  if(editingPaymentIdx>=records.length)return;
  const p=records[editingPaymentIdx];

  // Build payload directly from the record object (no modal field dependency)
  const payDate=toPaymentInputDate(p.paymentDate,p)||todayInputDate();
  const paidMonths=paidMonthsForRecord(p).length?paidMonthsForRecord(p):[p.month||""];

  const payload={
    secret:WRITE_SECRET,
    actionType:"delete",
    block:p.block,
    flatNo:p.flat,
    amount:p.amount||0,
    paymentMode:(p.paymentMode||"ONLINE").toUpperCase(),
    receivedBy:p.receivedBy||"",
    paymentDate:fmtSheetDate(payDate),
    paymentDateInput:payDate,
    paymentMonthSheet:paymentMonthCode(payDate),
    paidMonths,
    notes:p.remarks||"",
    paymentStatus:"DONE"
  };

  setButtonBusy("confirmDeleteConfirm",true);
  try{
    const result=await submitWriteJsonp("savePayment",payload,20000);
    if(!result.ok)throw new Error(result.error||"Delete failed.");
    await loadPayments();
    closeConfirmDelete();
    if(currentFlatData)renderProfile(currentFlatData.block,currentFlatData.flat,currentFlatData.row);
    showToast("Payment deleted ✓");
    editingPaymentIdx=-1;
  }catch(ex){
    closeConfirmDelete();
    showToast(ex.message||"Unable to delete payment");
  }finally{
    setButtonBusy("confirmDeleteConfirm",false);
  }
}

function openConfirmDeleteDirect(idx){
  editingPaymentIdx=idx;
  openConfirmDelete();
}

function openConfirmDelete(){
  const p=paymentFiltered[editingPaymentIdx];
  if(!p)return;
  const desc=`Block: ${p.block || "—"}, Flat: ${p.flat || "—"}, Amount: ₹${p.amount||0}, Month: ${p.month||"—"} ${p.year||""}`;
  document.getElementById("confirmDeleteBody").innerHTML=`Are you sure you want to delete this payment record?<br><br><strong>${desc}</strong><br><br>This action is permanent and cannot be undone.`;
  const ov=document.getElementById("confirmDeleteOverlay");
  ov.classList.add("open");
  requestAnimationFrame(()=>{
    const btn=document.getElementById("confirmDeleteCancel");
    if(btn)btn.focus();
  });
}
function closeConfirmDelete(){
  document.getElementById("confirmDeleteOverlay").classList.remove("open");
}

document.getElementById("editPaymentBtn").addEventListener("click",()=>{
  if(paymentFiltered.length>0)openPaymentEditModal(0);
  else showToast("No payment records to edit");
});
document.getElementById("paymentModalSave").addEventListener("click",savePaymentEdit);
document.getElementById("paymentModalClose").addEventListener("click",()=>closeModal("paymentModal"));
document.getElementById("paymentModalCancel").addEventListener("click",()=>closeModal("paymentModal"));
document.getElementById("confirmDeleteConfirm").addEventListener("click",deletePaymentRecord);
document.getElementById("confirmDeleteCancel").addEventListener("click",closeConfirmDelete);
document.getElementById("confirmDeleteOverlay").addEventListener("click",e=>{
  if(e.target===document.getElementById("confirmDeleteOverlay"))closeConfirmDelete();
});

/* ═══════════════════════════════════════════════
   MODAL HELPERS — with focus trap (WCAG 2.1 §2.1.2)
═══════════════════════════════════════════════ */
const FOCUSABLE='a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let _modalReturnFocus=null;

function openModal(id){
  const m=document.getElementById(id);
  if(!m)return;
  _modalReturnFocus=document.activeElement;
  m.classList.add("open");
  document.body.classList.add("modal-open");
  // Move focus to first focusable element
  requestAnimationFrame(()=>{
    const first=m.querySelector(FOCUSABLE);
    if(first)first.focus();
  });
  // Attach focus trap
  m._trapHandler=e=>{
    if(e.key!=="Tab")return;
    const els=[...m.querySelectorAll(FOCUSABLE)].filter(el=>!el.closest('[style*="display:none"]'));
    if(!els.length)return;
    const first=els[0],last=els[els.length-1];
    if(e.shiftKey){if(document.activeElement===first){e.preventDefault();last.focus();}}
    else{if(document.activeElement===last){e.preventDefault();first.focus();}}
  };
  m.addEventListener("keydown",m._trapHandler);
}
function closeModal(id){
  const m=document.getElementById(id);
  if(!m)return;
  m.classList.remove("open");
  document.body.classList.remove("modal-open");
  if(m._trapHandler){m.removeEventListener("keydown",m._trapHandler);delete m._trapHandler;}
  // Return focus to trigger element
  if(_modalReturnFocus&&typeof _modalReturnFocus.focus==="function"){
    _modalReturnFocus.focus();
    _modalReturnFocus=null;
  }
}
// Close modal on overlay click
document.querySelectorAll(".modal-overlay").forEach(ov=>{
  ov.addEventListener("click",e=>{
    if(e.target===ov)closeModal(ov.id);
  });
});
// Close on Escape
document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    document.querySelectorAll(".modal-overlay.open").forEach(m=>closeModal(m.id));
  }
});

/* ═══════════════════════════════════════════════
   CLOSE PROFILE PANEL
═══════════════════════════════════════════════ */
document.getElementById("panelCloseBtn").addEventListener("click",()=>{
  document.getElementById("profilePanel").classList.remove("visible");
  document.getElementById("searchPrompt").style.display="block";
  document.getElementById("payKpiStrip").style.display="none";
  mainSearch.value="";searchClear.classList.remove("visible");
  currentFlatData=null;
});

/* ═══════════════════════════════════════════════
   DROPDOWN / PROFILE / LOGOUT
═══════════════════════════════════════════════ */
function setupDD(tId,dId){
  const t=document.getElementById(tId),d=document.getElementById(dId);
  if(!t||!d)return;
  t.addEventListener("click",e=>{e.stopPropagation();d.classList.toggle("open");});
}
setupDD("profileTogDesk","pdDesk");
setupDD("profileTogMob","pdMob");
setupDD("profileTogDeskNew","pdDeskNew");
document.addEventListener("click",()=>document.querySelectorAll(".profile-dropdown").forEach(d=>d.classList.remove("open")));

["logoutDesk","logoutMob","logoutDeskNew","logoutDeskMenuNew","drawerLogoutBtn"].forEach(id=>{
  const b=document.getElementById(id);
  if(b)b.addEventListener("click",()=>{sessionStorage.removeItem(AUTH_KEY);window.location.href="index.html";});
});

/* ═══════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════ */
(async()=>{
  await Promise.all([loadDirectory(),loadPayments()]);
  const heroPayments=document.getElementById("heroStatPayments");
  if(heroPayments)heroPayments.textContent=allPaymentRecords.length;
})();
