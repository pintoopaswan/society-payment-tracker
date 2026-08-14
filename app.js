/* app.js — shared logic for every MIG-1 Society dashboard page.
   Loaded on every page alongside payment-months.js and payments-data.js.
   bootPage() (bottom of this file) reads <body data-page="..."> to run
   only the initializer the current page needs. */
// ── STATE ──
const S={
  expenseData:null,emergencyData:null,
  expFiltered:[],expPage:1,expRowsPerPage:15,
  emgSections:{},emgActiveFilter:'ALL',
  vehicleData:null,vehFiltered:[],vehPage:1,vehRowsPerPage:15,
  fullData:null,currentYear:null,
  trendChart:null,blockChart:null,expenseChart:null,
  payMatrixCache:{}, // "2026" -> flats[] from PaymentsData.buildMatrix, cached per year — shared by payments page + dashboard
  payHistoryCache:{} // "2026" -> raw DONE payment rows for that year, cached per year — used by the Payment History page
};
const MONTHS_KEYS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const NOW=new Date();
const CUR_YEAR=String(NOW.getFullYear());
const CUR_MONTH_IDX=NOW.getMonth(); // 0-based

// Chart theme defaults — dark mode baseline
const CD={
  grid:'rgba(255,255,255,.07)',
  tick:{color:'#56647e',font:{family:"'Outfit',sans-serif",size:10,weight:'500'}},
  tooltip:{
    backgroundColor:'#1e2333',borderColor:'rgba(255,255,255,.11)',borderWidth:1,
    titleColor:'#e8edf7',bodyColor:'#94a3c0',padding:12,cornerRadius:10,
    titleFont:{family:"'Outfit',sans-serif",weight:'700',size:12},
    bodyFont:{family:"'Outfit',sans-serif",size:11},
    displayColors:true,boxPadding:4
  }
};

// ── HELPERS ──
function fmt(n){return '₹'+(Number(n)||0).toLocaleString('en-IN')}
function fmtK(v){if(v>=100000)return '₹'+Math.round(v/1000)+'K';return '₹'+(v||0).toLocaleString('en-IN')}
function showLoader(t='Loading…'){try{document.getElementById('loaderTxt').childNodes[0].textContent=t;}catch(e){}document.getElementById('loader').classList.add('on')}
function hideLoader(){document.getElementById('loader').classList.remove('on')}
function openSidebar(){document.getElementById('sidebar').classList.add('open');document.getElementById('overlay').classList.add('open')}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('open')}

// ── BILL MODAL ──
function openBillModal(url,title){
  document.getElementById('billModalTitle').textContent=title||'Bill / Receipt';
  // Try iframe first; many URLs block iframes so we open in new tab as fallback
  const iframe=document.getElementById('billIframe');
  iframe.src=url;
  document.getElementById('billOpenLink').href=url;
  document.getElementById('billFallbackLink').href=url;
  document.getElementById('billModal').classList.add('open');
  // After a short delay, check if iframe loaded; if blocked show fallback
  iframe.onload=function(){
    const fb=document.getElementById('billFallback');
    try{
      // If iframe loaded same-origin content, hide fallback
      fb.style.display='none';
    }catch(e){fb.style.display='flex';}
  };
  iframe.onerror=function(){document.getElementById('billFallback').style.display='flex';};
}
function closeBillModal(e){if(e.target===document.getElementById('billModal'))closeBillModalDirect()}
function closeBillModalDirect(){document.getElementById('billModal').classList.remove('open');document.getElementById('billIframe').src='about:blank';document.getElementById('billFallback').style.display='none';}

// ── NAVIGATION ──
// ── PAGE BOOT DISPATCH ──
// This is now a real multi-page site (one HTML file per sidebar item)
// instead of a single-page app with hidden sections, so there is no more
// client-side view-switching. Each page's <body data-page="..."> tells
// this shared script which page it is, and bootPage() runs only the
// initializer that page actually needs.

// ── DATA LOADERS ──
async function bootPage(){
  // Both the payments page and the dashboard are now fully client-side —
  // they read the guard-payment spreadsheets directly (payments-data.js),
  // no PHP/API involved. Only expense/emergency/vehicles still go through
  // index.php for now.
  const page=document.body.dataset.page;
  if(page==='dashboard'){
    buildDashYearDropdown();
    await updateDashboard();
    loadExpenseForDashboard();
  } else if(page==='payments'){
    buildPayYearDropdown();
    renderPayments();
  } else if(page==='payment-history'){
    initPaymentHistory();
  } else if(page==='payments-overview'){
    renderPaymentsOverview();
  } else if(page==='expense'){
    initExpense();
  } else if(page==='emergency'){
    initEmergency();
  } else if(page==='notices'){
    renderNoticesPage();
  } else if(page==='vehicles'){
    initVehicles();
  }
}

// ── EXPENSE LEDGER — reads directly from the Google Sheet (see
// fund-ledger.html reference project), replacing the old /api/expense
// backend call. Column names are auto-detected from the header row so the
// sheet can be re-ordered/renamed without breaking this parser.
const EXP_SHEET_ID='1uiD2QymMUl04uNB9N-RrJ9gbT45u2Nm7Vt69E1DJBvo';
const EXP_SHEET_TABS=['Sheet1'];

// Proper CSV line parser (handles quoted fields, embedded commas/quotes,
// AND empty cells — e.g. a blank "Bill" column — which a naive regex
// split would silently drop, shifting every later column left by one).
function expParseCsvLine(line){
  const result=[];
  let cur='',inQuotes=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(inQuotes){
      if(ch==='"'){
        if(line[i+1]==='"'){cur+='"';i++;}
        else inQuotes=false;
      }else cur+=ch;
    }else{
      if(ch==='"')inQuotes=true;
      else if(ch===','){result.push(cur.trim());cur='';}
      else cur+=ch;
    }
  }
  result.push(cur.trim());
  return result;
}
function expToDisplayDate(iso){
  const p=String(iso||'').split('-');
  if(p.length!==3)return iso||'';
  return `${p[2]}/${p[1]}/${p[0]}`;
}
function expToIsoDate(display){
  if(!display)return '';
  const s=String(display).trim();
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;
  const MONTH_MAP={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
    january:1,february:2,march:3,april:4,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
  const mDay=s.match(/^(\d{1,2})[\s-]+([A-Za-z]+)[\s-]+(\d{2,4})$/);
  if(mDay){
    const day=Number(mDay[1]);
    const mon=MONTH_MAP[mDay[2].toLowerCase()]||MONTH_MAP[mDay[2].toLowerCase().slice(0,3)]||0;
    const yr=mDay[3].length===2?2000+Number(mDay[3]):Number(mDay[3]);
    if(mon&&day&&yr)return `${yr}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const mMon=s.match(/^([A-Za-z]+)[\s,-]+(\d{1,2})[,\s]+(\d{2,4})$/);
  if(mMon){
    const mon=MONTH_MAP[mMon[1].toLowerCase()]||MONTH_MAP[mMon[1].toLowerCase().slice(0,3)]||0;
    const day=Number(mMon[2]);
    const yr=mMon[3].length===2?2000+Number(mMon[3]):Number(mMon[3]);
    if(mon&&day&&yr)return `${yr}-${String(mon).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const a=s.split('/');
  if(a.length===3){
    const n0=Number(a[0]),n1=Number(a[1]);
    let day,month,year;
    year=a[2].length===4?Number(a[2]):2000+Number(a[2]);
    if(n0>12){day=n0;month=n1;} else if(n1>12){day=n1;month=n0;} else {day=n0;month=n1;}
    return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  }
  const b=s.split('-');
  if(b.length===3&&b[0].length<=2&&/^\d+$/.test(b[0])&&/^\d+$/.test(b[1])&&/^\d+$/.test(b[2])){
    const year=b[2].length===4?Number(b[2]):2000+Number(b[2]);
    return `${year}-${b[1].padStart(2,'0')}-${b[0].padStart(2,'0')}`;
  }
  return s;
}
function expCompareDates(a,b){return new Date(a.isoDate)-new Date(b.isoDate)}

async function expFetchSheetCsv(){
  const urls=EXP_SHEET_TABS.flatMap(tab=>[
    `https://docs.google.com/spreadsheets/d/${EXP_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`,
    `https://docs.google.com/spreadsheets/d/${EXP_SHEET_ID}/export?format=csv&sheet=${encodeURIComponent(tab)}`,
  ]);
  for(const url of urls){
    try{
      const r=await fetch(url,{cache:'no-cache'});
      const csv=await r.text();
      const preview=csv.trim().slice(0,200).toLowerCase();
      if(!csv.trim()||preview.startsWith('<!doctype html')||preview.includes('google.visualization.query.setresponse')||csv.includes('File not found'))continue;
      return csv;
    }catch(_){}
  }
  return '';
}

// Sheet column schema (0-based), auto-detected by header name with these
// as fallback positions: 0 DATE, 1 AMOUNT, 2 PAYMENT MODE, 3 DESCRIPTION,
// 4 TYPE (CREDIT/DEBIT), 5 PAID BY, 6 BILL (receipt URL), 7 BALANCE.
function expParseEntries(csv){
  const lines=csv.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2)return [];
  const headerRaw=expParseCsvLine(lines[0]).map(h=>h.toLowerCase().trim());
  const colIdx=(pats,fallback)=>{
    const i=headerRaw.findIndex(h=>pats.some(p=>h.includes(p)));
    return i>=0?i:fallback;
  };
  const C={
    date:colIdx(['transaction date','date','dt'],0),
    type:colIdx(['transaction type','txn type','payment type','type'],4),
    desc:colIdx(['description','desc','particulars','narration','detail'],3),
    amt:colIdx(['amount','amt','sum','inr','rs','rupee'],1),
    paymode:colIdx(['payment mode','pay mode','mode','payment method'],2),
    closebal:colIdx(['closing balance','close bal','closing','balance'],7),
    paidby:colIdx(['paid by','paidby','paid_by','received by','collector'],5),
    bill:colIdx(['bill','receipt','ref','attachment','link','url'],6),
  };
  const entries=[];
  lines.slice(1).forEach((line,idx)=>{
    const cols=expParseCsvLine(line);
    if(!cols.length||cols.every(c=>!c.trim()))return;
    const rawDate=cols[C.date]||'';
    const rawType=String(cols[C.type]||'').trim().toUpperCase();
    const rawAmt=parseFloat(String(cols[C.amt]||'').replace(/[^0-9.-]/g,''))||0;
    if(!rawDate&&!rawAmt)return;
    const isoDate=expToIsoDate(rawDate)||'';
    const type=rawType.startsWith('C')?'CREDIT':rawType.startsWith('D')?'DEBIT':(rawType||'CREDIT');
    const sheetBal=parseFloat(String(cols[C.closebal]||'').replace(/[^0-9.-]/g,''))||null;
    entries.push({
      rowId:idx+2,
      isoDate,
      dateDisplay:expToDisplayDate(isoDate),
      description:cols[C.desc]||'',
      category:cols[C.paymode]||'',
      type:(type==='CREDIT'||type==='DEBIT')?type:'CREDIT',
      amount:rawAmt,
      paidBy:cols[C.paidby]||'',
      bill:cols[C.bill]||'',
      balance:sheetBal!==null?sheetBal:0,
      _sheetBal:sheetBal,
    });
  });
  return entries;
}

function expComputeBalances(entries){
  const sorted=[...entries].sort(expCompareDates);
  const hasSheetBalance=sorted.some(e=>e._sheetBal!==null&&e._sheetBal!==undefined);
  if(hasSheetBalance){
    let runningBal=0;
    sorted.forEach(e=>{
      if(e._sheetBal!==null&&e._sheetBal!==undefined){e.balance=e._sheetBal;runningBal=e._sheetBal;}
      else{runningBal+=e.type==='CREDIT'?e.amount:-e.amount;e.balance=runningBal;}
    });
  }else{
    let balance=0;
    sorted.forEach(e=>{balance+=e.type==='CREDIT'?e.amount:-e.amount;e.balance=balance;});
  }
  return sorted;
}

async function fetchExpenseData(){
  const csv=await expFetchSheetCsv();
  const entries=expComputeBalances(expParseEntries(csv));
  const columns=['TRANSACTION DATE','DESCRIPTION','PAYMENT MODE','PAID BY','TRANSACTION TYPE','AMOUNT','CLOSING BALANCE','BILL'];
  const rowData=entries.map(e=>({
    'TRANSACTION DATE':e.dateDisplay,
    'DESCRIPTION':e.description,
    'PAYMENT MODE':e.category,
    'PAID BY':e.paidBy,
    'TRANSACTION TYPE':e.type,
    'AMOUNT':e.amount,
    'CLOSING BALANCE':e.balance,
    'BILL':e.bill,
  }));
  return {columns,rowData};
}

async function loadExpenseForDashboard(){
  if(S.expenseData)return;
  try{
    S.expenseData=await fetchExpenseData();
    const admEntries=admBuildExpenseEntries();
    admRenderExpenseChart(admEntries);
    admRenderRecentExpenses(admEntries);
    updateDashboardBalance();
  }catch(e){console.error('Expense dash load error:',e)}
}

async function refreshData(){
  S.expenseData=null;S.emergencyData=null;S.payMatrixCache={};S.payHistoryCache={};S.vehicleData=null;
  NOTICES=[];MEETINGS_DATA=[];
  const id=document.body.dataset.page;
  if(id==='dashboard'){
    buildDashYearDropdown();
    await updateDashboard();
    loadExpenseForDashboard();
  }
  if(id==='payments')renderPayments();
  if(id==='payment-history'){
    const wrap=document.getElementById('phResultsWrap');
    if(wrap&&wrap.dataset.searched==='1')searchPaymentHistory();
  }
  if(id==='payments-overview')renderPaymentsOverview();
  if(id==='expense'){S.expenseData=null;initExpense();}
  if(id==='emergency'){S.emergencyData=null;initEmergency();}
  if(id==='notices')renderNoticesPage();
  if(id==='vehicles'){S.vehicleData=null;initVehicles();}
}

// ── YEAR DROPDOWNS ──
/* Dashboard reads the exact same two guard-payment spreadsheets as the
   payments page (see payments-data.js) — its year list comes from
   PaymentsData.SHEET_IDS_BY_YEAR too, not from a PHP-backed sheet list. */
function buildDashYearDropdown(){
  const yrs=Object.keys(PaymentsData.SHEET_IDS_BY_YEAR).sort();
  S.currentYear=yrs.includes(CUR_YEAR)?CUR_YEAR:(yrs.length?yrs[yrs.length-1]:null);
  const el=document.getElementById('dashYearDropdown');
  el.innerHTML='<option value="">All Years</option>'+yrs.map(y=>`<option value="${y}"${y===S.currentYear?' selected':''}>${y}</option>`).join('');
}

/* Payments page reads its own two spreadsheets client-side (see
   payments-data.js) — same year list as the dashboard, both driven by
   PaymentsData.SHEET_IDS_BY_YEAR now. */
function buildPayYearDropdown(){
  const yrs=Object.keys(PaymentsData.SHEET_IDS_BY_YEAR).sort();
  const defaultYear=yrs.includes(String(PaymentsData.CURRENT_YEAR))?String(PaymentsData.CURRENT_YEAR):(yrs.length?yrs[yrs.length-1]:null);

  const yEl=document.getElementById('payYearFilter');
  yEl.innerHTML='<option value="">All Years</option>'+yrs.map(y=>`<option value="${y}"${y===defaultYear?' selected':''}>${y}</option>`).join('');

  // Default month filter to current month name
  const curMonthName=MONTHS_KEYS[PaymentsData.CURRENT_MONTH_INDEX];
  const mEl=document.getElementById('payMonthFilter');
  const opt=[...mEl.options].find(o=>o.value===curMonthName);
  if(opt)mEl.value=curMonthName;
}

function onDashYearChange(){
  S.currentYear=document.getElementById('dashYearDropdown').value||null;
  updateDashboard();
}

function onPayYearChange(){
  renderPayments();
}

function onPayMonthChange(){
  renderPayments();
}

// ── DASHBOARD — aggregate data across selected year's sheets ──
async function updateDashboard(){
  const yr=document.getElementById('dashYearDropdown').value||null;
  const years=yr?[yr]:Object.keys(PaymentsData.SHEET_IDS_BY_YEAR).sort();

  showLoader('Updating dashboard…');
  try{ await Promise.all(years.map(loadPayYear)); }
  catch(e){ console.error('Dashboard load error:',e); }
  hideLoader();

  // Aggregate across all selected years' matrices. A flat's "collected"
  // total includes every month with real money recorded — paid, partial
  // (the part that did come in), and locked-paid — plus any not-yet-
  // linked (unattributed) transactions. Pure "due"/"locked"(no payment)
  // months contribute nothing, same as the old sheet's model.
  let totalCollection=0;
  const blockTotals={}; // blockName -> total amount across selected years
  const monthlyMap={};  // "Jan".."Dec" -> total across selected years (for the trend chart)

  // Extra aggregates feeding the admin-style dashboard charts
  const monthTotalsArr=new Array(12).fill(0);
  const monthCountsArr=new Array(12).fill(0);
  const admBlockTotals=new Map();
  const admBlockMonthTotals=new Map();
  const admModeTotals=new Map();
  const admAllBlocks=new Set();

  years.forEach(y=>{
    const flats=S.payMatrixCache[y]||[];
    flats.forEach(f=>{
      admAllBlocks.add(f.block);
      if(!blockTotals[f.block])blockTotals[f.block]=0;
      if(!admBlockTotals.has(f.block))admBlockTotals.set(f.block,0);
      let flatSum=f.unattributed||0;
      (f.unattributedTxns||[]).forEach(c=>{
        const mode=(c.mode||'').trim()||'Unknown';
        admModeTotals.set(mode,(admModeTotals.get(mode)||0)+(c.amount||0));
      });
      f.months.forEach((m,mi)=>{
        const amt=m.amount||0;
        if(amt<=0)return;
        flatSum+=amt;
        const key=MONTHS_KEYS[mi];
        monthlyMap[key]=(monthlyMap[key]||0)+amt;
        monthTotalsArr[mi]+=amt;
        monthCountsArr[mi]+=(m.contribs&&m.contribs.length)?m.contribs.length:1;
        const bmKey=`${f.block}:${mi}`;
        admBlockMonthTotals.set(bmKey,(admBlockMonthTotals.get(bmKey)||0)+amt);
        (m.contribs||[]).forEach(c=>{
          const mode=(c.mode||'').trim()||'Unknown';
          admModeTotals.set(mode,(admModeTotals.get(mode)||0)+(c.amount||0));
        });
      });
      blockTotals[f.block]+=flatSum;
      admBlockTotals.set(f.block,(admBlockTotals.get(f.block)||0)+flatSum);
      totalCollection+=flatSum;
    });
  });

  // KPI: highest paid block
  const blockEntries=Object.entries(blockTotals).filter(([,v])=>v>0);
  let highestBlock='—',highestAmt=0;
  blockEntries.forEach(([name,amt])=>{
    if(amt>highestAmt){highestAmt=amt;highestBlock=name;}
  });

  // KPI: current calendar month's total collection — always reflects
  // "now", independent of the dashboard's year filter, so make sure the
  // real current year's matrix is loaded even if a different year is
  // selected above.
  const curYearKey=String(PaymentsData.CURRENT_YEAR);
  if(!S.payMatrixCache[curYearKey] && PaymentsData.SHEET_IDS_BY_YEAR[curYearKey]){
    await loadPayYear(curYearKey);
  }
  let currentMonthTotal=0;
  (S.payMatrixCache[curYearKey]||[]).forEach(f=>{
    const m=f.months[PaymentsData.CURRENT_MONTH_INDEX];
    if(m&&m.amount>0)currentMonthTotal+=m.amount;
  });

  // Render KPIs
  document.getElementById('kpi-total').textContent=fmt(totalCollection);
  document.getElementById('kpi-total-sub').textContent=yr?`Year ${yr}`:'All years';
  document.getElementById('kpi-highest-amt').textContent=fmt(highestAmt);
  document.getElementById('kpi-highest-block').textContent=highestBlock;
  document.getElementById('kpi-month').textContent=fmt(currentMonthTotal);
  document.getElementById('kpi-month-sub').textContent=PaymentsData.MDISP[PaymentsData.CURRENT_MONTH_INDEX]+' '+curYearKey;
  setTimeout(()=>document.getElementById('kpi-total-bar').style.width='78%',100);
  setTimeout(()=>{document.getElementById('kpi-month-bar').style.width=(currentMonthTotal>0?'78%':'0%');},100);

  // Admin-style charts: Monthly Collection Trend, Collection by Block,
  // Payment Modes, Block Collection Performance
  _admCachedAllBlocks=admAllBlocks;
  _admCachedBlockTotals=admBlockTotals;
  _admCachedBlockMonthTotals=admBlockMonthTotals;
  admRenderTrend(monthTotalsArr,monthCountsArr);
  admRenderBlocksFiltered(_admBlockMonth);
  admRenderModes(admModeTotals);
  admRenderBlockCmpChart(admAllBlocks,admBlockMonthTotals);
  admRenderVehicleTypes();

  updateDashboardBalance();
  if(S.expenseData){
    const admEntries=admBuildExpenseEntries();
    admRenderExpenseChart(admEntries);
    admRenderRecentExpenses(admEntries);
  }
}

function updateDashboardBalance(){
  if(!S.expenseData)return;
  const rows=S.expenseData.rowData||[];
  let cr=0,db=0;
  rows.forEach(r=>{
    const t=(r['TRANSACTION TYPE']||'').toUpperCase();
    const a=Number(r['AMOUNT'])||0;
    if(t==='CREDIT')cr+=a; else if(t==='DEBIT')db+=a;
  });
  const bal=cr-db;
  document.getElementById('kpi-balance').textContent=fmt(bal);
  const badge=document.getElementById('kpi-balance-trend');
  if(bal>=0){badge.textContent='Positive';badge.className='kpi-trend-badge up';}
  else{badge.textContent='Negative';badge.className='kpi-trend-badge down';}
  setTimeout(()=>document.getElementById('kpi-balance-bar').style.width=(bal>0?Math.min(100,Math.round(cr>0?bal/cr*100:50)):10)+'%',100);
}

// ── ADMIN-STYLE DASHBOARD CHARTS ──
// Ported 1:1 (markup, CSS, canvas drawing & colors) from the admin
// dashboard. Only the data-prep layer differs, since this app's data
// comes from the guard-payment sheet matrix (S.payMatrixCache) rather
// than the admin's raw payments CSV.
const MONTHS_S_ADM=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL_ADM=['January','February','March','April','May','June','July','August','September','October','November','December'];
const BLOCK_COLORS_ADM={
  "Block-1":{hex:"#2563eb",light:"rgba(37,99,235,0.1)",grad:"linear-gradient(90deg,#2563eb,#60a5fa)"},
  "Block-2":{hex:"#059669",light:"rgba(5,150,105,0.1)",grad:"linear-gradient(90deg,#059669,#34d399)"},
  "Block-3":{hex:"#7c3aed",light:"rgba(124,58,237,0.1)",grad:"linear-gradient(90deg,#7c3aed,#a78bfa)"},
  "Block-4":{hex:"#d97706",light:"rgba(217,119,6,0.1)",grad:"linear-gradient(90deg,#d97706,#fbbf24)"},
  "Block-5":{hex:"#e11d48",light:"rgba(225,29,72,0.1)",grad:"linear-gradient(90deg,#e11d48,#fb7185)"},
  "Block-6":{hex:"#0891b2",light:"rgba(8,145,178,0.1)",grad:"linear-gradient(90deg,#0891b2,#22d3ee)"},
  "Block-7":{hex:"#65a30d",light:"rgba(101,163,13,0.1)",grad:"linear-gradient(90deg,#65a30d,#a3e635)"},
  "Block-8":{hex:"#9333ea",light:"rgba(147,51,234,0.1)",grad:"linear-gradient(90deg,#9333ea,#c084fc)"},
  "Block-9":{hex:"#ea580c",light:"rgba(234,88,12,0.1)",grad:"linear-gradient(90deg,#ea580c,#fb923c)"},
};
const FALLBACK_COLORS_ADM=["#2563eb","#059669","#7c3aed","#d97706","#e11d48","#0891b2","#65a30d","#9333ea","#ea580c"];
function getBlockColorAdm(blockName,idx=0){
  return BLOCK_COLORS_ADM[blockName]||{hex:FALLBACK_COLORS_ADM[idx%FALLBACK_COLORS_ADM.length],light:`rgba(0,0,0,0.06)`,grad:`linear-gradient(90deg,${FALLBACK_COLORS_ADM[idx%FALLBACK_COLORS_ADM.length]},${FALLBACK_COLORS_ADM[(idx+1)%FALLBACK_COLORS_ADM.length]})`};
}
function hexToRgbAdm(hex){const r=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);return r?{r:parseInt(r[1],16),g:parseInt(r[2],16),b:parseInt(r[3],16)}:{r:37,g:99,b:235};}

const _ttAdm={
  el:null,label:null,amount:null,indicator:null,_hideTimer:null,
  init(){if(this.el)return;this.el=document.getElementById("admChartTooltip");this.label=document.getElementById("admCttLabel");this.amount=document.getElementById("admCttAmount");this.indicator=document.getElementById("admCttIndicator");},
  show(clientX,clientY,monthLabel,value,accentColor){
    this.init();if(!this.el)return;clearTimeout(this._hideTimer);
    this.label.textContent=monthLabel;
    this.amount.textContent=Number(value||0).toLocaleString("en-IN");
    this.indicator.style.background=accentColor||"#2563eb";
    this.el.style.display="block";
    requestAnimationFrame(()=>{
      const tw=this.el.offsetWidth||160,th=this.el.offsetHeight||72,MARGIN=12;
      let left=clientX-tw/2,top=clientY-th-14;
      if(left<MARGIN)left=MARGIN;if(left+tw>window.innerWidth-MARGIN)left=window.innerWidth-tw-MARGIN;
      if(top<MARGIN)top=clientY+22;
      this.el.style.left=left+"px";this.el.style.top=top+"px";
      this.el.classList.add("visible");
    });
  },
  hide(){this.init();if(!this.el)return;this.el.classList.remove("visible");this._hideTimer=setTimeout(()=>{if(this.el)this.el.style.display="none";},220);}
};

function admRenderTrend(totals,counts){
  counts=counts||new Array(12).fill(0);
  const canvas=document.getElementById("admTrendChart");if(!canvas)return;
  const dpr=window.devicePixelRatio||1;
  const rect=canvas.parentElement.getBoundingClientRect();
  const W=rect.width||560,H=rect.height||210;
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
  canvas.style.width=W+"px";canvas.style.height=H+"px";
  const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
  const pad={t:24,r:12,b:30,l:56};
  const chartW=W-pad.l-pad.r,chartH=H-pad.t-pad.b;
  const max=Math.max(...totals,1);
  const barW=Math.max(8,(chartW/12)*0.58);
  const step=chartW/12;
  const accent="#2563eb";
  const rgb=hexToRgbAdm(accent);

  function drawAll(activeIdx){
    ctx.clearRect(0,0,W,H);
    const gridLines=4;
    for(let i=0;i<=gridLines;i++){
      const y=pad.t+chartH-(chartH/gridLines*i);
      ctx.strokeStyle=i===0?"#e2e8f0":"rgba(226,232,240,0.6)";
      ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+chartW,y);ctx.stroke();
      const val=Math.round(max*(i/gridLines));
      ctx.fillStyle="#94a3b8";
      ctx.font=`500 10px 'DM Mono',monospace`;
      ctx.textAlign="right";
      ctx.fillText(val>=1000?`₹${(val/1000).toFixed(0)}k`:`₹${val}`,pad.l-6,y+4);
    }
    totals.forEach((v,i)=>{
      const x=pad.l+step*i+(step-barW)/2;
      const barH=v>0?Math.max(5,(v/max)*chartH):4;
      const y=pad.t+chartH-barH;
      const isActive=i===activeIdx;
      const alphaMul=activeIdx>=0&&!isActive?0.3:1;
      if(v===0){
        ctx.fillStyle=`rgba(226,232,240,${0.8*alphaMul})`;
        ctx.beginPath();ctx.roundRect(x,y,barW,barH,3);ctx.fill();
      } else {
        const grd=ctx.createLinearGradient(x,y,x,y+barH);
        if(isActive){
          grd.addColorStop(0,`rgba(${rgb.r},${rgb.g},${rgb.b},1)`);
          grd.addColorStop(1,`rgba(${rgb.r},${rgb.g},${rgb.b},0.55)`);
        } else {
          grd.addColorStop(0,`rgba(${rgb.r},${rgb.g},${rgb.b},${0.85*alphaMul})`);
          grd.addColorStop(1,`rgba(${rgb.r},${rgb.g},${rgb.b},${0.38*alphaMul})`);
        }
        ctx.fillStyle=grd;
        ctx.beginPath();ctx.roundRect(x,y,barW,barH,[5,5,2,2]);ctx.fill();
        if(isActive){
          const capGrd=ctx.createLinearGradient(x,y,x+barW,y);
          capGrd.addColorStop(0,"rgba(147,197,253,0.9)");
          capGrd.addColorStop(1,"rgba(96,165,250,0.7)");
          ctx.fillStyle=capGrd;
          ctx.beginPath();ctx.roundRect(x,y,barW,4,[5,5,0,0]);ctx.fill();
          ctx.fillStyle=accent;
          ctx.font=`700 9px 'DM Sans',sans-serif`;
          ctx.textAlign="center";
          const label=v>=1000?`₹${(v/1000).toFixed(0)}k`:`₹${v}`;
          ctx.fillText(label,x+barW/2,y-14);
          const cnt=counts[i]||0;
          ctx.fillStyle="rgba(99,102,241,0.85)";
          ctx.font=`600 8px 'DM Sans',sans-serif`;
          ctx.fillText(`(${cnt})`,x+barW/2,y-4);
        } else if(v>0&&activeIdx<0){
          ctx.fillStyle="rgba(148,163,184,0.8)";
          ctx.font=`500 8px 'DM Sans',sans-serif`;
          ctx.textAlign="center";
          const lbl=v>=1000?`₹${(v/1000).toFixed(0)}k`:`₹${v}`;
          ctx.fillText(lbl,x+barW/2,y-14);
          const cnt=counts[i]||0;
          if(cnt>0){
            ctx.fillStyle="rgba(148,163,184,0.6)";
            ctx.font=`500 7.5px 'DM Sans',sans-serif`;
            ctx.fillText(`(${cnt})`,x+barW/2,y-4);
          }
        }
      }
      ctx.fillStyle=isActive?accent:"#94a3b8";
      ctx.font=isActive?`700 9.5px 'DM Sans',sans-serif`:`500 9.5px 'DM Sans',sans-serif`;
      ctx.textAlign="center";
      ctx.fillText(MONTHS_S_ADM[i],x+barW/2,H-5);
    });
  }
  drawAll(-1);
  canvas._trendHandlers?.forEach(({type,fn})=>canvas.removeEventListener(type,fn));
  canvas._trendHandlers=[];
  function addHandler(type,fn){canvas.addEventListener(type,fn,{passive:true});canvas._trendHandlers.push({type,fn});}
  function getHit(clientX){const r2=canvas.getBoundingClientRect();const mx=clientX-r2.left;let hit=-1;totals.forEach((_,i)=>{const x=pad.l+step*i+(step-barW)/2;if(mx>=x-4&&mx<=x+barW+4)hit=i;});return hit;}
  let _activeIdx=-1;
  function showTip(clientX,clientY,i){
    const cnt=counts[i]||0;
    const label=`${MONTHS_FULL_ADM[i]} · ${cnt} payment${cnt===1?"":"s"}`;
    _ttAdm.show(clientX,clientY,label,totals[i],accent);
  }
  addHandler("mousemove",e=>{const hit=getHit(e.clientX);if(hit!==_activeIdx){_activeIdx=hit;drawAll(hit);}if(hit>=0)showTip(e.clientX,e.clientY,hit);else _ttAdm.hide();});
  addHandler("mouseleave",()=>{_activeIdx=-1;drawAll(-1);_ttAdm.hide();});
  addHandler("touchstart",e=>{const t=e.touches[0];const hit=getHit(t.clientX);_activeIdx=hit;drawAll(hit);if(hit>=0)showTip(t.clientX,t.clientY,hit);});
  addHandler("touchmove",e=>{const t=e.touches[0];const hit=getHit(t.clientX);if(hit!==_activeIdx){_activeIdx=hit;drawAll(hit);}if(hit>=0)showTip(t.clientX,t.clientY,hit);});
  addHandler("touchend",()=>{setTimeout(()=>{_activeIdx=-1;drawAll(-1);_ttAdm.hide();},600);});
  const total=totals.reduce((s,v)=>s+v,0);
  const totalCount=counts.reduce((s,v)=>s+v,0);
  const trendMetaEl=document.getElementById("trendMeta");
  if(trendMetaEl)trendMetaEl.textContent=`${fmt(total)} · ${totalCount} payments across 12 months`;
}

/* ── Collection by Block (rank list) ── */
let _admCachedAllBlocks=null,_admCachedBlockTotals=null,_admCachedBlockMonthTotals=null,_admBlockMonth=-1;
function admRenderBlocksFiltered(monthIdx){
  const allBlocks=_admCachedAllBlocks,blockTotals=_admCachedBlockTotals,blockMonthTotals=_admCachedBlockMonthTotals;
  if(!allBlocks)return;
  let data;
  const labelEl=document.getElementById("admBlockFilterLabel");
  if(monthIdx<0){
    data=[...allBlocks].map(b=>({name:b,val:blockTotals.get(b)||0}));
    if(labelEl)labelEl.textContent="Full year — all blocks";
  } else {
    data=[...allBlocks].map(b=>({name:b,val:blockMonthTotals.get(`${b}:${monthIdx}`)||0}));
    if(labelEl)labelEl.textContent=MONTHS_FULL_ADM[monthIdx];
  }
  data.sort((a,b)=>b.val-a.val);
  const maxVal=Math.max(...data.map(d=>d.val),1);
  const el=document.getElementById("admBlockList");if(!el)return;
  if(!data.length){el.innerHTML='<div class="empty-state">No block data.</div>';el.classList.remove("sk");return;}
  el.innerHTML=data.map((d,i)=>{
    const pct=Math.round((d.val/maxVal)*100);
    const bc=getBlockColorAdm(d.name,i);
    const isTop=i===0&&d.val>0;
    return`<div class="rank-item" style="--blk-color:${bc.hex}">
      <div class="rank-top">
        <div class="rank-left">
          <div class="rank-dot"></div>
          <span class="rank-name">${d.name}</span>
          ${isTop?`<span class="rank-badge">Top</span>`:""}
        </div>
        <span class="rank-amt">${fmt(d.val)}</span>
      </div>
      <div class="rank-track"><div class="rank-bar" data-w="${pct}" style="background:${bc.grad}"></div></div>
    </div>`;
  }).join("");
  el.classList.remove("sk");
  requestAnimationFrame(()=>{
    el.querySelectorAll(".rank-bar").forEach((b,i)=>{
      setTimeout(()=>{b.style.width=b.dataset.w+"%";},60+i*70);
    });
  });
}
function admOnMonthChange(val){
  _admBlockMonth=parseInt(val);
  admRenderBlocksFiltered(_admBlockMonth);
  document.querySelectorAll("#admMonthPills .month-pill").forEach(p=>{p.classList.toggle("active",parseInt(p.dataset.month)===_admBlockMonth);});
  const bms=document.getElementById("admBlockMonthMob");if(bms)bms.value=val;
}
document.getElementById("admMonthPills")?.addEventListener("click",e=>{
  const pill=e.target.closest(".month-pill");if(!pill)return;
  admOnMonthChange(pill.dataset.month);
});
document.getElementById("admBlockMonthMob")?.addEventListener("change",e=>admOnMonthChange(e.target.value));

/* ── Payment modes ── */
function admRenderModes(modeTotals){
  const el=document.getElementById("admModeList");if(!el)return;
  const sorted=[...modeTotals.entries()].sort((a,b)=>b[1]-a[1]);
  const maxMode=Math.max(...sorted.map(([,v])=>v),1);
  const total=sorted.reduce((s,[,v])=>s+v,0);
  const modeColors=["#2563eb","#059669","#7c3aed","#d97706","#e11d48","#0891b2"];
  if(!sorted.length){el.innerHTML='<div class="empty-state">No payment data.</div>';el.classList.remove("sk");return;}
  el.innerHTML=sorted.map(([mode,val],i)=>{
    const pct=total>0?Math.round((val/total)*100):0;
    const c=modeColors[i%modeColors.length];
    return`<div class="mode-row"><span class="mode-label" style="color:${c};border-color:${c}30;background:${c}0e">${mode}</span><div class="mode-track"><div class="mode-bar" data-w="${pct}" style="background:linear-gradient(90deg,${c},${c}88)"></div></div><span class="mode-pct">${pct}%</span></div>`;
  }).join("");
  el.classList.remove("sk");
  requestAnimationFrame(()=>{el.querySelectorAll(".mode-bar").forEach((b,i)=>{setTimeout(()=>{b.style.width=b.dataset.w+"%";},80+i*65);});});
}

/* ── Vehicle Types (Cars / Bikes / Scootys / Other) ── */
async function admRenderVehicleTypes(){
  const el=document.getElementById("admVehList");if(!el)return;
  await ensureVehicleData();
  const vehicles=(S.vehicleData&&S.vehicleData.vehicles)||[];
  const counts=new Map();
  vehicles.forEach(v=>{
    const t=normVehType(v.vehicleType);
    const label=t==='CAR'?'Cars':t==='BIKE'?'Bikes':t==='SCOOTY'?'Scootys':'Other';
    counts.set(label,(counts.get(label)||0)+1);
  });
  const order=['Cars','Bikes','Scootys','Other'];
  const sorted=order.filter(l=>counts.has(l)).map(l=>[l,counts.get(l)])
    .concat([...counts.entries()].filter(([l])=>!order.includes(l)));
  const total=vehicles.length;
  const vehColors={Cars:"#2563eb",Bikes:"#e11d48",Scootys:"#d97706",Other:"#64748b"};
  const metaEl=document.getElementById("admVehMeta");
  if(metaEl)metaEl.textContent=total>0?`${total} registered vehicle${total===1?"":"s"}`:"Registered vehicles by type";
  if(!sorted.length){el.innerHTML='<div class="empty-state">No vehicle data.</div>';el.classList.remove("sk");return;}
  el.innerHTML=sorted.map(([label,val])=>{
    const pct=total>0?Math.round((val/total)*100):0;
    const c=vehColors[label]||"#64748b";
    return`<div class="mode-row"><span class="mode-label" style="color:${c};border-color:${c}30;background:${c}0e">${label}</span><div class="mode-track"><div class="mode-bar" data-w="${pct}" style="background:linear-gradient(90deg,${c},${c}88)"></div></div><span class="mode-pct">${val}</span></div>`;
  }).join("");
  el.classList.remove("sk");
  requestAnimationFrame(()=>{el.querySelectorAll(".mode-bar").forEach((b,i)=>{setTimeout(()=>{b.style.width=b.dataset.w+"%";},80+i*65);});});
}

/* ── Recent Expenses ── */
function admRenderRecentExpenses(entries){
  const el=document.getElementById("admRecentExpList");if(!el)return;
  const rows=entries.slice().sort((a,b)=>{
    const pa=String(a.date||'').split(/[\/\-]/),pb=String(b.date||'').split(/[\/\-]/);
    const da=pa.length===3?new Date(pa[2],pa[1]-1,pa[0]):new Date(0);
    const db=pb.length===3?new Date(pb[2],pb[1]-1,pb[0]):new Date(0);
    return db-da;
  }).slice(0,10);
  if(!rows.length){el.innerHTML='<div class="empty-state">No expense entries.</div>';el.classList.remove("sk");return;}
  el.innerHTML=rows.map(e=>{
    const isDebit=e.type==='DEBIT';
    const sign=isDebit?'-':'+';
    const cls=isDebit?'debit':'credit';
    const desc=PaymentsData.escapeHtml(e.description||'—');
    const mode=e.paymode?`<span class="pill-inline">${PaymentsData.escapeHtml(e.paymode)}</span> · `:'';
    const dateTxt=PaymentsData.escapeHtml(e.date||'');
    return`<div class="act-item"><div class="act-top"><span class="act-name">${desc}</span><span class="act-amt ${cls}">${sign}${fmt(e.amount)}</span></div><div class="act-sub">${mode}${dateTxt}</div></div>`;
  }).join("");
  el.classList.remove("sk");
}

/* ── Monthly Expenses ── */
function admBuildExpenseEntries(){
  const rows=(S.expenseData&&S.expenseData.rowData)||[];
  return rows.map(r=>({
    date:r['TRANSACTION DATE']||'',
    description:r['DESCRIPTION']||'',
    type:(r['TRANSACTION TYPE']||'').toUpperCase()==='DEBIT'?'DEBIT':'CREDIT',
    amount:Number(r['AMOUNT'])||0,
    paymode:r['PAYMENT MODE']||'',
  })).filter(e=>e.amount>0);
}
function admRenderExpenseChart(entries){
  const totals=new Array(12).fill(0);
  entries.filter(e=>e.type==="DEBIT").forEach(e=>{
    const parts=e.date?e.date.split(/[\/\-]/):[]; let month=-1;
    if(parts.length===3){const m1=parseInt(parts[1],10)-1,m2=parseInt(parts[0],10)-1;
      if(m1>=0&&m1<=11)month=m1;else if(m2>=0&&m2<=11)month=m2;}
    if(month>=0)totals[month]+=e.amount;
  });
  const totalExp=totals.reduce((s,v)=>s+v,0);
  const max=Math.max(...totals,1);
  const peakIdx=totals.indexOf(max);
  const avg=totalExp/totals.filter(v=>v>0).length||0;
  const sp=document.getElementById("admExpSummary");
  if(sp&&totalExp>0){
    sp.innerHTML=`<div class="exp-pill total"><span class="exp-pill-dot"></span>Total: ${fmt(Math.round(totalExp))}</div><div class="exp-pill peak"><span class="exp-pill-dot"></span>Peak: ${MONTHS_S_ADM[peakIdx]} (${fmt(Math.round(max))})</div><div class="exp-pill avg"><span class="exp-pill-dot"></span>Avg: ${fmt(Math.round(avg))}/mo</div>`;
  }
  const metaEl=document.getElementById("admExpChartMeta");
  if(metaEl)metaEl.textContent=totalExp>0?`${fmt(Math.round(totalExp))} total debits`:"No expense data";
  const canvas=document.getElementById("admExpenseChart");if(!canvas)return;
  const dpr=window.devicePixelRatio||1;const rect=canvas.parentElement.getBoundingClientRect();
  const W=rect.width||460,H=rect.height||200;
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
  canvas.style.width=W+"px";canvas.style.height=H+"px";
  const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);
  const pad={t:10,r:10,b:28,l:50};
  const chartW=W-pad.l-pad.r,chartH=H-pad.t-pad.b;
  const barW=Math.max(5,(chartW/12)*0.55);const step=chartW/12;
  const expColor="#f43f5e";
  const expRgb=hexToRgbAdm(expColor);
  function drawExpAll(activeIdx){
    ctx.clearRect(0,0,W,H);
    for(let i=0;i<=4;i++){
      const y=pad.t+chartH-(chartH/4*i);
      ctx.strokeStyle=i===0?"#e2e8f0":"rgba(226,232,240,0.6)";ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+chartW,y);ctx.stroke();
      const val=Math.round(max*(i/4));
      ctx.fillStyle="#94a3b8";ctx.font="500 9px 'DM Mono',monospace";
      ctx.textAlign="right";ctx.fillText(val>=1000?`₹${(val/1000).toFixed(0)}k`:`₹${val}`,pad.l-5,y+4);
    }
    if(avg>0&&totalExp>0){
      const avgY=pad.t+chartH-(avg/max)*chartH;
      ctx.save();ctx.setLineDash([5,4]);ctx.strokeStyle="rgba(245,158,11,0.5)";ctx.lineWidth=1.5;
      ctx.beginPath();ctx.moveTo(pad.l,avgY);ctx.lineTo(pad.l+chartW,avgY);ctx.stroke();ctx.restore();
    }
    totals.forEach((v,i)=>{
      const x=pad.l+step*i+(step-barW)/2;const barH=v>0?Math.max(4,(v/max)*chartH):4;const y=pad.t+chartH-barH;
      const isPeak=i===peakIdx&&v>0;const isActive=i===activeIdx;const alphaMul=activeIdx>=0&&!isActive?0.28:1;
      if(v===0){ctx.fillStyle=`rgba(226,232,240,${0.8*alphaMul})`;ctx.beginPath();ctx.roundRect(x,y,barW,barH,2);ctx.fill();}
      else{
        const grd=ctx.createLinearGradient(x,y,x,y+barH);
        const r2=isPeak?hexToRgbAdm("#be123c"):expRgb;
        grd.addColorStop(0,`rgba(${r2.r},${r2.g},${r2.b},${(isActive?1:0.85)*alphaMul})`);
        grd.addColorStop(1,`rgba(${r2.r},${r2.g},${r2.b},${(isActive?0.5:0.35)*alphaMul})`);
        ctx.fillStyle=grd;ctx.beginPath();ctx.roundRect(x,y,barW,barH,[5,5,2,2]);ctx.fill();
        if(isPeak){
          ctx.strokeStyle=`rgba(${r2.r},${r2.g},${r2.b},0.4)`;ctx.lineWidth=1;
          ctx.beginPath();ctx.roundRect(x+0.5,y+0.5,barW-1,barH-1,[5,5,2,2]);ctx.stroke();
        }
      }
      ctx.fillStyle=isActive?expColor:"#94a3b8";
      ctx.font=isActive?`700 9px 'DM Sans',sans-serif`:`500 9px 'DM Sans',sans-serif`;
      ctx.textAlign="center";ctx.fillText(MONTHS_S_ADM[i],x+barW/2,H-4);
    });
  }
  drawExpAll(-1);
  canvas._expHandlers?.forEach(({type,fn})=>canvas.removeEventListener(type,fn));
  canvas._expHandlers=[];
  function addH2(type,fn){canvas.addEventListener(type,fn,{passive:true});canvas._expHandlers.push({type,fn});}
  function getHitExp(cx){const r2=canvas.getBoundingClientRect();const mx=cx-r2.left;let hit=-1;totals.forEach((_,i)=>{const x=pad.l+step*i+(step-barW)/2;if(mx>=x-4&&mx<=x+barW+4)hit=i;});return hit;}
  let _expIdx=-1;
  addH2("mousemove",e=>{const hit=getHitExp(e.clientX);if(hit!==_expIdx){_expIdx=hit;drawExpAll(hit);}if(hit>=0)_ttAdm.show(e.clientX,e.clientY,MONTHS_FULL_ADM[hit],totals[hit],expColor);else _ttAdm.hide();});
  addH2("mouseleave",()=>{_expIdx=-1;drawExpAll(-1);_ttAdm.hide();});
  addH2("touchstart",e=>{const t=e.touches[0];const hit=getHitExp(t.clientX);_expIdx=hit;drawExpAll(hit);if(hit>=0)_ttAdm.show(t.clientX,t.clientY,MONTHS_FULL_ADM[hit],totals[hit],expColor);});
  addH2("touchend",()=>{setTimeout(()=>{_expIdx=-1;drawExpAll(-1);_ttAdm.hide();},600);});
}

/* ── Block Collection Performance (current vs last month) ── */
function admRenderBlockCmpChart(allBlocks, blockMonthTotals){
  const canvas=document.getElementById("admBlockCmpChart");if(!canvas)return;
  const now=new Date();
  const curMi=now.getMonth();
  const lastMi=curMi===0?11:curMi-1;
  const blocks=[...allBlocks].sort();
  const curData=blocks.map(b=>blockMonthTotals.get(`${b}:${curMi}`)||0);
  const lastData=blocks.map(b=>blockMonthTotals.get(`${b}:${lastMi}`)||0);
  const curLabel=MONTHS_FULL_ADM[curMi],lastLabel=MONTHS_FULL_ADM[lastMi];
  const metaEl=document.getElementById("admBlockCmpMeta");
  if(metaEl)metaEl.textContent=`${curLabel} vs ${lastLabel} · all blocks`;

  const dpr=window.devicePixelRatio||1;
  const rect=canvas.parentElement.getBoundingClientRect();
  const W=rect.width||560,H=rect.height||220;
  canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);
  canvas.style.width=W+"px";canvas.style.height=H+"px";
  const ctx=canvas.getContext("2d");ctx.scale(dpr,dpr);

  const n=blocks.length||1;
  const pad={t:14,r:14,b:42,l:56};
  const chartW=W-pad.l-pad.r,chartH=H-pad.t-pad.b;
  const groupW=chartW/n;
  const gap=groupW*0.14;
  const barW=(groupW-gap*3)/2;
  const maxVal=Math.max(...curData,...lastData,1);

  const BLUE="#2563eb",GRAY="#94a3b8";
  const blueRgb=hexToRgbAdm(BLUE),grayRgb=hexToRgbAdm(GRAY);

  function drawAll(hoverGroup,hoverBar){
    ctx.clearRect(0,0,W,H);
    const gridLines=4;
    for(let i=0;i<=gridLines;i++){
      const y=pad.t+chartH-(chartH/gridLines*i);
      ctx.strokeStyle=i===0?"#e2e8f0":"rgba(226,232,240,0.55)";
      ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+chartW,y);ctx.stroke();
      const val=Math.round(maxVal*(i/gridLines));
      ctx.fillStyle="#94a3b8";ctx.font="500 9.5px 'DM Mono',monospace";
      ctx.textAlign="right";
      ctx.fillText(val>=1000?`₹${(val/1000).toFixed(0)}k`:`₹${val}`,pad.l-6,y+4);
    }
    blocks.forEach((block,gi)=>{
      const gx=pad.l+gi*groupW;
      const x0=gx+gap;
      const x1=x0+barW+gap;
      [
        {x:x0,val:curData[gi],color:BLUE,rgb:blueRgb,isCur:true},
        {x:x1,val:lastData[gi],color:GRAY,rgb:grayRgb,isCur:false}
      ].forEach((bar,bi)=>{
        const barH=bar.val>0?Math.max(3,(bar.val/maxVal)*chartH):2;
        const y=pad.t+chartH-barH;
        const isActive=gi===hoverGroup&&bi===hoverBar;
        const alphaMul=hoverGroup>=0&&!isActive?0.35:1;
        const grd=ctx.createLinearGradient(bar.x,y,bar.x,y+barH);
        grd.addColorStop(0,`rgba(${bar.rgb.r},${bar.rgb.g},${bar.rgb.b},${(isActive?1:0.85)*alphaMul})`);
        grd.addColorStop(1,`rgba(${bar.rgb.r},${bar.rgb.g},${bar.rgb.b},${(isActive?0.6:0.4)*alphaMul})`);
        ctx.fillStyle=bar.val>0?grd:`rgba(226,232,240,${0.8*alphaMul})`;
        ctx.beginPath();ctx.roundRect(bar.x,y,barW,barH,[4,4,1,1]);ctx.fill();
      });
      ctx.fillStyle=hoverGroup===gi?"#0f172a":"#94a3b8";
      ctx.font=hoverGroup===gi?`700 9.5px 'DM Sans',sans-serif`:`500 9.5px 'DM Sans',sans-serif`;
      ctx.textAlign="center";
      ctx.fillText(block.replace('Block-','B-'),gx+groupW/2,H-pad.b+16);
    });
  }
  drawAll(-1,-1);
  canvas._cmpHandlers?.forEach(({type,fn})=>canvas.removeEventListener(type,fn));
  canvas._cmpHandlers=[];
  function addH3(type,fn){canvas.addEventListener(type,fn,{passive:true});canvas._cmpHandlers.push({type,fn});}
  function getHitCmp(clientX){
    const r2=canvas.getBoundingClientRect();const mx=clientX-r2.left;
    let group=-1,bar=-1;
    blocks.forEach((_,gi)=>{
      const gx=pad.l+gi*groupW;
      const x0=gx+gap,x1=x0+barW+gap;
      if(mx>=x0-3&&mx<=x0+barW+3){group=gi;bar=0;}
      else if(mx>=x1-3&&mx<=x1+barW+3){group=gi;bar=1;}
    });
    return{group,bar};
  }
  let _hg=-1,_hb=-1;
  addH3("mousemove",e=>{
    const{group,bar}=getHitCmp(e.clientX);
    if(group!==_hg||bar!==_hb){_hg=group;_hb=bar;drawAll(_hg,_hb);}
    if(group>=0){
      const val=bar===0?curData[group]:lastData[group];
      const label=`${blocks[group]} · ${bar===0?curLabel:lastLabel}`;
      _ttAdm.show(e.clientX,e.clientY,label,val,bar===0?BLUE:GRAY);
    }else _ttAdm.hide();
  });
  addH3("mouseleave",()=>{_hg=-1;_hb=-1;drawAll(-1,-1);_ttAdm.hide();});
  addH3("touchstart",e=>{const t=e.touches[0];const{group,bar}=getHitCmp(t.clientX);_hg=group;_hb=bar;drawAll(_hg,_hb);if(group>=0){const val=bar===0?curData[group]:lastData[group];_ttAdm.show(t.clientX,t.clientY,`${blocks[group]} · ${bar===0?curLabel:lastLabel}`,val,bar===0?BLUE:GRAY);}});
  addH3("touchend",()=>{setTimeout(()=>{_hg=-1;_hb=-1;drawAll(-1,-1);_ttAdm.hide();},600);});
}

window.addEventListener("resize",()=>{
  clearTimeout(window._admResizeTimer);
  window._admResizeTimer=setTimeout(()=>{
    if(_admCachedAllBlocks&&_admCachedBlockMonthTotals){
      admRenderBlockCmpChart(_admCachedAllBlocks,_admCachedBlockMonthTotals);
    }
  },200);
});

// ── PAYMENTS PAGE ──
// Reads the two per-year guard-payment spreadsheets directly in the
// browser (payments-data.js + payment-months.js) — no PHP/API involved.
// Each month cell for a flat ends up as one of:
//   due | paid | partial | irregular | locked | locked-paid | future
// "partial" = a payment covering this month ran short of the ₹fee after
// filling earlier months in full (a genuine pending balance, shown in
// yellow). "irregular" = duplicate/overpaid transactions on the same
// month (needs a human look). See payments-data.js for the exact rules.

async function loadPayYear(year){
  const yr=String(year);
  if(S.payMatrixCache[yr])return S.payMatrixCache[yr];
  const rawRows=await PaymentsData.loadRawRows(Number(yr));
  const flats=PaymentsData.buildMatrix(Number(yr), rawRows);
  S.payMatrixCache[yr]=flats;
  return flats;
}

function payYearsInScope(){
  const yr=document.getElementById('payYearFilter').value;
  return yr?[yr]:Object.keys(PaymentsData.SHEET_IDS_BY_YEAR).sort();
}

/* Whole-year status for a flat, when no month filter is active — a money
   problem (irregular or partial) is always surfaced over a plain "still
   due", and "locked" only shows when nothing else needs attention. */
function payFlatStatusBucket(f){
  const hasIrregular=f.months.some(m=>m.type==='irregular');
  const hasPartial=f.months.some(m=>m.type==='partial');
  const hasDue=f.months.some(m=>m.type==='due');
  const hasLocked=f.months.some(m=>m.type==='locked'||m.type==='locked-paid');
  if(hasIrregular)return 'irregular';
  if(hasPartial)return 'partial';
  if(hasDue)return 'due';
  if(hasLocked)return 'locked';
  return 'ok';
}

/* Maps a fine-grained matrix type (or whole-year bucket) down to the
   tile/CSS states the payments page renders. */
function payTileClass(type){
  if(type==='paid'||type==='ok')return 'paid';
  if(type==='partial')return 'partial';
  if(type==='irregular')return 'review';
  if(type==='locked'||type==='locked-paid')return 'locked';
  return 'unpaid'; // due / future
}
function payTileTag(cls){
  return {paid:'paid',partial:'pending',review:'review',locked:'locked',unpaid:'unpaid'}[cls]||cls;
}

// The status filter dropdown still only has Paid / Unpaid / Locked —
// "Unpaid" covers due, partial and review alike (anything not fully
// settled and not locked), while the tile itself still shows the
// finer-grained colour and label.
function payFilterMatches(cls, filterVal){
  if(!filterVal)return true;
  if(filterVal==='paid')return cls==='paid';
  if(filterVal==='locked')return cls==='locked';
  if(filterVal==='unpaid')return cls==='unpaid'||cls==='partial'||cls==='review';
  return true;
}

async function renderPayments(){
  const years=payYearsInScope();
  showLoader('Loading payment ledger…');
  try{ await Promise.all(years.map(loadPayYear)); }
  catch(e){ console.error('Payments load error:',e); }
  hideLoader();

  // Populate block filter from whichever years are in scope
  const blockSet=new Set();
  years.forEach(y=>(S.payMatrixCache[y]||[]).forEach(f=>blockSet.add(f.block)));
  const bEl=document.getElementById('payBlockFilter');
  const cur=bEl.value;
  const blocks=[...blockSet].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  bEl.innerHTML='<option value="">All Blocks</option>'+blocks.map(b=>`<option value="${b}">${b.toUpperCase()}</option>`).join('');
  if(cur&&[...bEl.options].some(o=>o.value===cur))bEl.value=cur;

  await filterPayments();
}

async function filterPayments(){
  const block=document.getElementById('payBlockFilter').value;
  const status=document.getElementById('payStatusFilter').value;
  const q=(document.getElementById('paySearch').value||'').toLowerCase();
  const moName=document.getElementById('payMonthFilter').value; // "" or "Jan".."Dec"
  const moIdx=moName?MONTHS_KEYS.indexOf(moName):-1;
  const years=payYearsInScope();

  const missing=years.filter(y=>!S.payMatrixCache[y]);
  if(missing.length){
    showLoader('Loading payment ledger…');
    try{ await Promise.all(missing.map(loadPayYear)); }
    catch(e){ console.error('Payments load error:',e); }
    hideLoader();
  }

  if(years.every(y=>!(S.payMatrixCache[y]||[]).length)){
    document.getElementById('payBlocksWrap').innerHTML='<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg><p>No data available</p><span>Try selecting a different month or year</span></div>';
    return;
  }

  // Aggregate blocks across all selected years. Most of the time only one
  // year is in scope; "All Years" merges both spreadsheets, summing a
  // flat's amount across years and keeping whichever status is most
  // severe if the same flat number shows up in both.
  const severity={irregular:4,partial:3,due:2,locked:1,paid:0};
  const aggregated={}; // blockName -> {flats:[{flat,cls,amt,year,mi}], years:Set}

  years.forEach(yr=>{
    const flats=S.payMatrixCache[yr]||[];
    flats.forEach(f=>{
      if(block&&f.block!==block)return;
      if(!aggregated[f.block])aggregated[f.block]={flats:[],years:new Set()};
      aggregated[f.block].years.add(yr);

      let type,amt;
      if(moIdx>=0){
        const cell=f.months[moIdx];
        type=cell.type;
        amt=cell.amount||0;
      }else{
        type=payFlatStatusBucket(f);
        amt=f.months.reduce((s,m)=>s+(m.amount||0),0)+(f.unattributed||0);
      }
      const cls=payTileClass(type);

      const existing=aggregated[f.block].flats.find(x=>x.flat===f.flat);
      if(existing){
        existing.amt+=amt;
        if((severity[cls]||0)>(severity[existing.cls]||0)){existing.cls=cls;existing.year=yr;existing.mi=moIdx;}
      }else{
        aggregated[f.block].flats.push({flat:f.flat,cls,amt,year:yr,mi:moIdx});
      }
    });
  });

  let kpiTotal=0,kpiPaid=0,kpiUnpaid=0,kpiLocked=0;
  let html='<div class="blocks-wrap">';

  Object.entries(aggregated).forEach(([name,{flats,years:yrSet}])=>{
    const filtered=flats.filter(f=>{
      if(!payFilterMatches(f.cls,status))return false;
      if(q&&!(String(f.flat).toLowerCase().includes(q)||name.toLowerCase().includes(q)))return false;
      return true;
    });
    if(!filtered.length)return;

    let paid=0,partialC=0,reviewC=0,blockTotal=0,lockedC=0;
    filtered.forEach(f=>{
      blockTotal+=f.amt;
      if(f.cls==='locked'){lockedC++;return;}
      if(f.cls==='paid')paid++;
      else if(f.cls==='partial')partialC++;
      else if(f.cls==='review')reviewC++;
    });

    const activeFlats=filtered.length-lockedC;
    const unpaidBucket=activeFlats-paid-partialC-reviewC; // plain "still due", for the pill count only
    kpiTotal+=blockTotal;kpiPaid+=paid;kpiUnpaid+=(activeFlats-paid);kpiLocked+=lockedC;
    const pct=activeFlats?Math.round(paid/activeFlats*100):0;
    const yearLabel=[...yrSet].join(', ');

    const blockId='blk-'+name.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'');
    html+=`<div class="block-card" id="${blockId}">
      <div class="block-card-head" onclick="toggleBlock('${blockId}')" role="button" aria-expanded="false" aria-controls="${blockId}-body">
        <div class="block-card-main">
          <div class="block-title-row">
            <div class="block-name">${name.toUpperCase()}</div>
            <span class="block-sheet-tag">${yearLabel}</span>
          </div>
          <div class="block-stat"><strong>${fmt(blockTotal)}</strong> collected &nbsp;·&nbsp; ${filtered.length} flats</div>
          <div class="block-status-pills">
            <span class="bsp bsp-paid">✓ ${paid} paid</span>
            ${unpaidBucket>0?`<span class="bsp bsp-unpaid">✗ ${unpaidBucket} unpaid</span>`:''}
            ${partialC>0?`<span class="bsp bsp-partial">◐ ${partialC} pending</span>`:''}
            ${reviewC>0?`<span class="bsp bsp-review">! ${reviewC} review</span>`:''}
            ${lockedC>0?`<span class="bsp bsp-locked">🔒 ${lockedC} locked</span>`:''}
          </div>
          <div class="progress-bar block-progress-inline" style="margin-top:8px"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div class="block-card-metric">
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="block-pct">${pct}%</div>
          <div class="block-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
        </div>
      </div>
      <div class="block-body" id="${blockId}-body">
        <div class="block-body-inner">
          <div class="flats-grid">${filtered.map(f=>{
            const amtDisplay=f.amt>0?fmt(f.amt):(f.cls==='locked'?'🔒':'—');
            const flatArg=String(f.flat).replace(/'/g,"\\'");
            return `<div class="flat-tile ${f.cls}" title="${f.flat}${f.amt>0?' · '+fmt(f.amt):''} — click for details" onclick="openPayFlatModal('${f.year}','${name}','${flatArg}',${f.mi})">
              <div class="flat-no">${f.flat}</div>
              <div class="flat-amt-wrap"><div class="flat-amt">${amtDisplay}</div></div>
              <div class="flat-tag tag-${f.cls}">${payTileTag(f.cls)}</div>
            </div>`;
          }).join('')}</div>
          <div class="flats-legend">
            <div class="flats-legend-item"><div class="flats-legend-dot paid"></div>Paid</div>
            <div class="flats-legend-item"><div class="flats-legend-dot unpaid"></div>Unpaid</div>
            <div class="flats-legend-item"><div class="flats-legend-dot partial"></div>Pending</div>
            <div class="flats-legend-item"><div class="flats-legend-dot review"></div>Review</div>
            <div class="flats-legend-item"><div class="flats-legend-dot locked"></div>Locked</div>
          </div>
        </div>
      </div>
    </div>`;
  });

  html+='</div>';
  document.getElementById('payBlocksWrap').innerHTML=(html==='<div class="blocks-wrap"></div>')
    ?'<div class="empty-state"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg><p>No data found</p><span>Try a different filter</span></div>'
    :html;

  // ── KPI tiles with percentages & progress bars (unchanged UI) ──
  const totalFlats = kpiPaid + kpiUnpaid + kpiLocked;
  const activeFlatsTotal = kpiPaid + kpiUnpaid;

  const collectionPct = activeFlatsTotal > 0 ? Math.round(kpiPaid / activeFlatsTotal * 100) : 0;
  document.getElementById('pay-kpi-total').textContent = fmt(kpiTotal);
  document.getElementById('pay-kpi-total-badge').textContent = collectionPct + '% Collected';
  document.getElementById('pay-kpi-total-sublabel').textContent = activeFlatsTotal > 0
    ? kpiPaid + ' of ' + activeFlatsTotal + ' active flats paid'
    : 'no active flats';
  setTimeout(()=>{ document.getElementById('pay-kpi-total-bar').style.width = collectionPct + '%'; }, 80);

  const paidPct = totalFlats > 0 ? Math.round(kpiPaid / totalFlats * 100) : 0;
  document.getElementById('pay-kpi-paid').textContent = kpiPaid;
  document.getElementById('pay-kpi-paid-badge').textContent = paidPct + '%';
  document.getElementById('pay-kpi-paid-sublabel').textContent = 'of ' + totalFlats + ' total flats';
  setTimeout(()=>{ document.getElementById('pay-kpi-paid-bar').style.width = paidPct + '%'; }, 120);

  const unpaidPct = totalFlats > 0 ? Math.round(kpiUnpaid / totalFlats * 100) : 0;
  document.getElementById('pay-kpi-unpaid').textContent = kpiUnpaid;
  document.getElementById('pay-kpi-unpaid-badge').textContent = unpaidPct + '%';
  document.getElementById('pay-kpi-unpaid-sublabel').textContent = 'of ' + totalFlats + ' total flats';
  setTimeout(()=>{ document.getElementById('pay-kpi-unpaid-bar').style.width = unpaidPct + '%'; }, 160);

  const lockedPct = totalFlats > 0 ? Math.round(kpiLocked / totalFlats * 100) : 0;
  document.getElementById('pay-kpi-locked').textContent = kpiLocked;
  document.getElementById('pay-kpi-locked-badge').textContent = lockedPct + '%';
  document.getElementById('pay-kpi-locked-sublabel').textContent = 'of ' + totalFlats + ' total flats';
  setTimeout(()=>{ document.getElementById('pay-kpi-locked-bar').style.width = lockedPct + '%'; }, 200);
}

// ── PAYMENT DETAIL MODAL — new functionality: click any flat tile to
//    see exactly which months are covered and by which transaction. ──
const PAY_MONTH_TYPE_LABEL={paid:'Paid',partial:'Pending',irregular:'Needs Review',locked:'Locked',
  'locked-paid':'Locked',due:'Due',future:'Not Due Yet'};

function openPayFlatModal(year, block, flat, mi){
  const flats=S.payMatrixCache[year]||[];
  const f=flats.find(x=>x.block===block && String(x.flat)===String(flat));
  if(!f)return;
  document.getElementById('payModalTitle').textContent=`${block.toUpperCase()} · Flat ${flat} · ${year}`;
  const miNum=Number(mi);
  if(!isNaN(miNum) && miNum>=0) renderPayMonthDetail(year, block, flat, miNum);
  else renderPayFlatGrid(year, block, flat);
  document.getElementById('payModal').classList.add('open');
}

function renderPayFlatGrid(year, block, flat){
  const flats=S.payMatrixCache[year]||[];
  const f=flats.find(x=>x.block===block && String(x.flat)===String(flat));
  if(!f)return;
  const flatArg=String(flat).replace(/'/g,"\\'");
  let html=`<div class="pmb-head"><div class="pmb-head-main">Tap any month to see its transaction details.</div></div>`;
  if(f.unattributed>0){
    html+=`<div class="pmb-unattr" onclick="renderPayUnattributed('${year}','${block}','${flatArg}')">⚠ ${PaymentsData.fmt$(f.unattributed)} received but not yet linked to a month — tap to see these transactions.</div>`;
  }
  html+=`<div class="pmb-month-grid">${f.months.map((m,i)=>{
    const cls=m.type;
    const label=PaymentsData.MDISP[i];
    const amt=m.amount?PaymentsData.fmt$(m.amount):(cls==='locked'?'🔒':'—');
    const clickable=cls!=='future';
    return `<div class="pmb-chip ${cls}" ${clickable?`onclick="renderPayMonthDetail('${year}','${block}','${flatArg}',${i})"`:''}>
      <div class="pmb-chip-month">${label}</div>
      <div class="pmb-chip-amt">${amt}</div>
      <div class="pmb-chip-tag">${PAY_MONTH_TYPE_LABEL[cls]||cls}</div>
    </div>`;
  }).join('')}</div>`;
  document.getElementById('payModalBody').innerHTML=html;
}

function renderPayMonthDetail(year, block, flat, mi){
  const flats=S.payMatrixCache[year]||[];
  const f=flats.find(x=>x.block===block && String(x.flat)===String(flat));
  if(!f)return;
  const m=f.months[mi];
  const flatArg=String(flat).replace(/'/g,"\\'");
  const backBtn=`<button class="pmb-back" onclick="renderPayFlatGrid('${year}','${block}','${flatArg}')"><svg viewBox="0 0 16 16"><polyline points="10,3 5,8 10,13"/></svg>All months</button>`;

  if(m.type==='due'||m.type==='future'){
    document.getElementById('payModalBody').innerHTML=`${backBtn}
      <div class="pmb-detail-status due">${m.type==='future'?'Not Due Yet':'Due'}</div>
      <div class="pmb-row"><div class="pmb-row-label">Month</div><div class="pmb-row-val">${m.monthLabel}</div></div>
      <div class="pmb-row"><div class="pmb-row-label">Amount due</div><div class="pmb-row-val">${PaymentsData.fmt$(PaymentsData.FEE)}</div></div>
      <div class="pmb-note">${m.type==='future'?"This month hasn't arrived yet.":'No payment has been recorded for this month yet.'}</div>`;
    return;
  }
  if(m.type==='locked'){
    document.getElementById('payModalBody').innerHTML=`${backBtn}
      <div class="pmb-detail-status locked">Locked</div>
      <div class="pmb-row"><div class="pmb-row-label">Month</div><div class="pmb-row-val">${m.monthLabel}</div></div>
      <div class="pmb-note">${PaymentsData.escapeHtml(m.reason||'Marked locked by admin.')}</div>`;
    return;
  }

  // paid / partial / irregular / locked-paid — all carry contribs
  const statusLabel={paid:'Paid',partial:'Pending Balance',irregular:'Needs Review','locked-paid':'Locked (Paid)'}[m.type]||m.type;
  let html=`${backBtn}<div class="pmb-detail-status ${m.type}">${statusLabel}</div>
    <div class="pmb-row"><div class="pmb-row-label">Month</div><div class="pmb-row-val">${m.monthLabel}</div></div>
    <div class="pmb-row"><div class="pmb-row-label">Total recorded</div><div class="pmb-row-val">${PaymentsData.fmt$(m.amount)}</div></div>`;
  if(m.type==='partial'){
    html+=`<div class="pmb-row"><div class="pmb-row-label">Still pending</div><div class="pmb-row-val">${PaymentsData.fmt$(m.remaining)}</div></div>`;
  }
  if(m.type==='locked-paid'){
    html+=`<div class="pmb-note warn">${PaymentsData.escapeHtml(m.reason||'Marked locked by admin.')}</div>`;
  }
  html+=(m.contribs||[]).map((c,i)=>{
    const alsoCovers=(c.covered||[]).filter(x=>x!==m.monthLabel);
    return `<div class="pmb-txn-card">
      <div class="pmb-row"><div class="pmb-row-label">Transaction ${i+1}</div><div class="pmb-row-val">${PaymentsData.fmt$(c.amount)}</div></div>
      <div class="pmb-row"><div class="pmb-row-label">Date</div><div class="pmb-row-val">${PaymentsData.escapeHtml(c.date)}</div></div>
      <div class="pmb-row"><div class="pmb-row-label">Mode</div><div class="pmb-row-val">${PaymentsData.escapeHtml(c.mode)}</div></div>
      <div class="pmb-row"><div class="pmb-row-label">Received by</div><div class="pmb-row-val">${PaymentsData.escapeHtml(c.receivedBy)||'—'}</div></div>
      ${c.txnAmount!==c.amount?`<div class="pmb-row"><div class="pmb-row-label">Full payment amount</div><div class="pmb-row-val">${PaymentsData.fmt$(c.txnAmount)}</div></div>`:''}
      ${alsoCovers.length?`<div class="pmb-row"><div class="pmb-row-label">Also covers</div><div class="pmb-row-val">${PaymentsData.escapeHtml(alsoCovers.join(', '))}</div></div>`:''}
    </div>`;
  }).join('');
  if(m.note) html+=`<div class="pmb-note ${m.type==='paid'?'':'warn'}">${PaymentsData.escapeHtml(m.note)}</div>`;
  document.getElementById('payModalBody').innerHTML=html;
}

function renderPayUnattributed(year, block, flat){
  const flats=S.payMatrixCache[year]||[];
  const f=flats.find(x=>x.block===block && String(x.flat)===String(flat));
  if(!f)return;
  const flatArg=String(flat).replace(/'/g,"\\'");
  const backBtn=`<button class="pmb-back" onclick="renderPayFlatGrid('${year}','${block}','${flatArg}')"><svg viewBox="0 0 16 16"><polyline points="10,3 5,8 10,13"/></svg>All months</button>`;
  let html=`${backBtn}<div class="pmb-detail-status partial">Unlinked Payments</div>
    <div class="pmb-note warn">These transactions were marked DONE but had no month recorded against them, so they aren't reflected in any month above yet.</div>`;
  html+=(f.unattributedTxns||[]).map((c,i)=>`<div class="pmb-txn-card">
      <div class="pmb-row"><div class="pmb-row-label">Transaction ${i+1}</div><div class="pmb-row-val">${PaymentsData.fmt$(c.amount)}</div></div>
      <div class="pmb-row"><div class="pmb-row-label">Date</div><div class="pmb-row-val">${PaymentsData.escapeHtml(c.date)}</div></div>
      <div class="pmb-row"><div class="pmb-row-label">Mode</div><div class="pmb-row-val">${PaymentsData.escapeHtml(c.mode)}</div></div>
      <div class="pmb-row"><div class="pmb-row-label">Received by</div><div class="pmb-row-val">${PaymentsData.escapeHtml(c.receivedBy)||'—'}</div></div>
    </div>`).join('');
  document.getElementById('payModalBody').innerHTML=html;
}

function closePayModal(e){
  if(!e || e.target===document.getElementById('payModal')) closePayModalDirect();
}
function closePayModalDirect(){
  document.getElementById('payModal').classList.remove('open');
}

// Direct entry point to the "unlinked payments" view (used by the warning
// icon next to a flat number, both here and on the Payments Overview page).
function openPayUnattributedModal(year, block, flat){
  const flats=S.payMatrixCache[year]||[];
  const f=flats.find(x=>x.block===block && String(x.flat)===String(flat));
  if(!f)return;
  document.getElementById('payModalTitle').textContent=`${block.toUpperCase()} · Flat ${flat} · ${year}`;
  renderPayUnattributed(year, block, flat);
  document.getElementById('payModal').classList.add('open');
}

// ── PAYMENT HISTORY PAGE ──
// A flat search over the raw guard-payment transaction rows (not the
// aggregated flat × month matrix used by Payments / Payments Overview) —
// lets someone look up exactly which transactions match a year, month
// (the sheet tab it was recorded in), block and/or flat number.

function buildPhYearDropdown(){
  const yEl=document.getElementById('phYearFilter');
  if(yEl.options.length)return; // build once
  const years=Object.keys(PaymentsData.SHEET_IDS_BY_YEAR).sort((a,b)=>b-a);
  const defaultYear=years.includes(CUR_YEAR)?CUR_YEAR:(years[0]||'');
  yEl.innerHTML='<option value="">All Years</option>'+years.map(y=>`<option value="${y}"${y===defaultYear?' selected':''}>${y}</option>`).join('');
}

function initPaymentHistory(){
  buildPhYearDropdown();
  const wrap=document.getElementById('phResultsWrap');
  if(wrap&&!wrap.dataset.searched){
    wrap.innerHTML=`<div class="empty-state">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      <p>Search payment history</p><span>Choose a year, month, block or flat number above and click Search</span>
    </div>`;
  }
}

/* Raw rows for one year, filtered down to rows actually filed under that
   year's own tabs (PaymentsData.loadRawRows also pulls in the adjacent
   years to support cross-year month coverage, which Payment History
   doesn't need — it's listing literal transactions, not month coverage). */
async function loadPayHistoryYear(year){
  const yr=String(year);
  if(S.payHistoryCache[yr])return S.payHistoryCache[yr];
  const rows=await PaymentsData.loadRawRows(Number(yr));
  const ownRows=rows.filter(r=>r.rowYear===Number(yr));
  S.payHistoryCache[yr]=ownRows;
  return ownRows;
}

async function searchPaymentHistory(){
  const yearVal=document.getElementById('phYearFilter').value;
  const years=yearVal?[yearVal]:Object.keys(PaymentsData.SHEET_IDS_BY_YEAR).sort();
  const monthName=document.getElementById('phMonthFilter').value; // "" or "Jan".."Dec"
  const monthIdx=monthName?MONTHS_KEYS.indexOf(monthName):-1;
  const block=document.getElementById('phBlockFilter').value;
  const flatQ=(document.getElementById('phFlatSearch').value||'').trim().toLowerCase();

  showLoader('Searching payment history…');
  try{ await Promise.all(years.map(loadPayHistoryYear)); }
  catch(e){ console.error('Payment history load error:',e); }
  hideLoader();

  let rows=[];
  years.forEach(y=>{ rows=rows.concat(S.payHistoryCache[y]||[]); });

  rows=rows.filter(r=>{
    if(r.status!=='DONE'||!(r.amount>0))return false;
    if(monthIdx>=0 && r.rowMonthIndex!==monthIdx)return false;
    if(block && r.block!==block)return false;
    if(flatQ && !String(r.flat).toLowerCase().includes(flatQ))return false;
    return true;
  });

  renderPaymentHistoryTable(rows);
}

/* Classify a free-text payment mode into one of a handful of buckets so it
   can get a consistent, color-coded pill wherever it's shown. */
function phModeCategory(mode){
  const m=String(mode||'').toUpperCase();
  if(m.includes('CASH'))return 'cash';
  if(m.includes('UPI'))return 'upi';
  if(m.includes('CHEQUE')||m.includes('CHECK'))return 'cheque';
  if(m.includes('BANK')||m.includes('NEFT')||m.includes('IMPS')||m.includes('RTGS')||m.includes('TRANSFER'))return 'bank';
  if(m.includes('ONLINE')||m.includes('CARD')||m.includes('NET'))return 'online';
  return 'other';
}
function phModePillClass(mode){ return 'pill-mode-'+phModeCategory(mode); }
// "Digital" for the collected-mix KPI = anything that isn't physical cash.
function phIsDigitalMode(mode){ return phModeCategory(mode)!=='cash'; }

function renderPhKpis(rows){
  const strip=document.getElementById('phKpiStrip');
  if(!rows.length){ strip.style.display='none'; return; }
  strip.style.display='';

  const fmt=PaymentsData.fmt$;
  const totalAmt=rows.reduce((s,r)=>s+(Number(r.amount)||0),0);
  const txnCount=rows.length;
  const avgAmt=txnCount?totalAmt/txnCount:0;

  const digitalAmt=rows.filter(r=>phIsDigitalMode(r.mode)).reduce((s,r)=>s+(Number(r.amount)||0),0);
  const digitalPct=totalAmt>0?Math.round(digitalAmt/totalAmt*100):0;
  const cashPct=100-digitalPct;

  const flatCounts=new Map();
  const blockSet=new Set();
  rows.forEach(r=>{
    const key=r.block+'|'+r.flat;
    flatCounts.set(key,(flatCounts.get(key)||0)+1);
    blockSet.add(r.block);
  });
  const uniqueFlats=flatCounts.size;
  const repeatFlats=Array.from(flatCounts.values()).filter(c=>c>1).length;
  const repeatPct=uniqueFlats>0?Math.round(repeatFlats/uniqueFlats*100):0;
  const avgPerFlat=uniqueFlats>0?totalAmt/uniqueFlats:0;

  let maxRow=rows[0];
  rows.forEach(r=>{ if((Number(r.amount)||0)>(Number(maxRow.amount)||0)) maxRow=r; });
  const maxAmt=Number(maxRow.amount)||0;
  const maxSharePct=totalAmt>0?Math.round(maxAmt/totalAmt*100):0;

  document.getElementById('ph-kpi-total').textContent=fmt(totalAmt);
  document.getElementById('ph-kpi-total-badge').textContent=digitalPct+'% Digital';
  document.getElementById('ph-kpi-total-sublabel').textContent='Avg '+fmt(avgAmt)+'/txn · '+cashPct+'% Cash';
  setTimeout(()=>{ document.getElementById('ph-kpi-total-bar').style.width=digitalPct+'%'; },80);

  document.getElementById('ph-kpi-count').textContent=txnCount;
  document.getElementById('ph-kpi-count-badge').textContent=uniqueFlats+(uniqueFlats===1?' flat':' flats');
  document.getElementById('ph-kpi-count-sublabel').textContent=blockSet.size+(blockSet.size===1?' block':' blocks')+' covered';
  setTimeout(()=>{ document.getElementById('ph-kpi-count-bar').style.width=Math.min(100,txnCount)+'%'; },120);

  document.getElementById('ph-kpi-flats').textContent=uniqueFlats;
  document.getElementById('ph-kpi-flats-badge').textContent=repeatPct+'% repeat';
  document.getElementById('ph-kpi-flats-sublabel').textContent='Avg '+fmt(avgPerFlat)+'/flat';
  setTimeout(()=>{ document.getElementById('ph-kpi-flats-bar').style.width=repeatPct+'%'; },160);

  document.getElementById('ph-kpi-max').textContent=fmt(maxAmt);
  document.getElementById('ph-kpi-max-badge').textContent=PaymentsData.escapeHtml(maxRow.mode)||'—';
  document.getElementById('ph-kpi-max-sublabel').textContent=PaymentsData.escapeHtml(maxRow.block)+' · Flat '+PaymentsData.escapeHtml(String(maxRow.flat));
  setTimeout(()=>{ document.getElementById('ph-kpi-max-bar').style.width=maxSharePct+'%'; },200);
}

function renderPaymentHistoryTable(rows){
  const wrap=document.getElementById('phResultsWrap');
  wrap.dataset.searched='1';

  renderPhKpis(rows);

  if(!rows.length){
    wrap.innerHTML=`<div class="empty-state">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r="0.6" fill="currentColor"/></svg>
      <p>No payments found</p><span>Try adjusting the year, month, block, or flat number and search again</span>
    </div>`;
    return;
  }

  const PM=window.PaymentMonths;
  const esc=PaymentsData.escapeHtml;
  const sorted=rows.slice().sort((a,b)=>
    (b.rowYear-a.rowYear) ||
    (b.rowMonthIndex-a.rowMonthIndex) ||
    a.block.localeCompare(b.block,undefined,{numeric:true}) ||
    String(a.flat).localeCompare(String(b.flat),undefined,{numeric:true})
  );

  const items=sorted.map((r,i)=>{
    const keys=PM.parseField(r.paidMonthsRaw,r.rowYear,r.rowMonthIndex);
    const monthsLabel=keys.length?esc(PM.formatList(keys).join(', ')):(r.paidMonthsRaw?esc(r.paidMonthsRaw):'—');
    return {i,r,monthsLabel};
  });

  let html=`<div class="table-wrap">
    <table>
      <thead><tr>
        <th>Sl No</th><th>Block</th><th>Flat</th><th>Amount</th><th>Mode</th><th>Date</th><th>Received By</th><th>Paid Months</th>
      </tr></thead>
      <tbody>
        ${items.map(({i,r,monthsLabel})=>`<tr class="row-credit">
          <td>${i+1}</td>
          <td>${esc(r.block)}</td>
          <td>${esc(r.flat)}</td>
          <td style="font-weight:700;font-family:'Fira Code',monospace">${PaymentsData.fmt$(r.amount)}</td>
          <td><span class="pill ${phModePillClass(r.mode)}">${esc(r.mode)||'—'}</span></td>
          <td>${esc(r.date)||'—'}</td>
          <td>${esc(r.receivedBy)||'—'}</td>
          <td>${monthsLabel}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="pagination"><span>${rows.length} payment${rows.length!==1?'s':''} found</span></div>
  </div>

  <div class="exp-mobile-cards">
    ${items.map(({r,monthsLabel})=>`<div class="exp-card card-credit">
      <div class="exp-card-top">
        <div class="exp-card-desc">${esc(r.block)} · Flat ${esc(r.flat)}</div>
        <div class="exp-card-amt credit">${PaymentsData.fmt$(r.amount)}</div>
      </div>
      <div class="exp-card-meta">
        <div class="exp-card-date"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${esc(r.date)||'—'}</div>
        <span class="pill ${phModePillClass(r.mode)}">${esc(r.mode)||'—'}</span>
      </div>
      <div class="exp-card-balance">Received by: <strong>${esc(r.receivedBy)||'—'}</strong></div>
      <div class="exp-card-balance">Paid months: <strong>${monthsLabel}</strong></div>
    </div>`).join('')}
  </div>`;

  wrap.innerHTML=html;
}

// ── PAYMENTS OVERVIEW PAGE ──
// Full flat × month matrix for one year at a time — same underlying data
// (payments-data.js, shared with the Payments/Dashboard pages) and same
// status rules as the payments-overview.html reference project, ported
// into this app's own visual style. Always exactly one year in view
// (like the reference), since the grid itself is inherently per-year.
const svgPovLockIco=`<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="6.5" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`;
const svgPovWarnIco=`<svg viewBox="0 0 16 16"><path d="M8 1L1 14h14L8 1z"/><line x1="8" y1="6" x2="8" y2="9.5"/><circle cx="8" cy="11.8" r="0.6" fill="currentColor"/></svg>`;

let povCollapsedBlocks=new Set();
let povAllCollapsed=false;

/* Whole-flat status bucket for the Overview page's filter/KPIs — matches
   the reference project exactly: "due" already folds in "partial" here
   (the per-month chip still shows Pending distinctly; this bucket is
   just for the flat-level filter dropdown and KPI counts). */
function povFlatStatusBucket(f){
  const hasIrregular=f.months.some(m=>m.type==='irregular');
  const hasDue=f.months.some(m=>m.type==='due'||m.type==='partial');
  const hasLocked=f.months.some(m=>m.type==='locked'||m.type==='locked-paid');
  if(hasIrregular)return 'irregular';
  if(hasDue)return 'due';
  if(hasLocked)return 'locked';
  return 'ok';
}

function povComputeKpis(flats){
  let totalCollected=0,fullyPaid=0,withDues=0,needsReview=0,lockedFlats=0;
  flats.forEach(f=>{
    let flatTotal=f.unattributed||0,hasDue=false,hasIrregular=false,hasLocked=false;
    f.months.forEach(m=>{
      if(m.type==='paid'||m.type==='irregular'||m.type==='locked-paid'||m.type==='partial')flatTotal+=m.amount;
      if(m.type==='irregular')hasIrregular=true;
      if(m.type==='due'||m.type==='partial')hasDue=true;
      if(m.type==='locked'||m.type==='locked-paid')hasLocked=true;
    });
    totalCollected+=flatTotal;
    if(hasIrregular)needsReview++;
    else if(hasDue)withDues++;
    if(hasLocked)lockedFlats++;
    if(!hasIrregular&&!hasDue)fullyPaid++;
  });
  return {totalCollected,fullyPaid,withDues,needsReview,lockedFlats,totalFlats:flats.length};
}

function povComputeBlockStats(bf){
  let collected=0,paidCount=0,unpaidCount=0,lockedCount=0;
  const monthSums=PaymentsData.MDISP.map(()=>0);
  bf.forEach(f=>{
    const total=f.months.reduce((s,m)=>s+(m.amount||0),0)+(f.unattributed||0);
    collected+=total;
    const bucket=povFlatStatusBucket(f);
    if(bucket==='ok')paidCount++;
    else if(bucket==='locked')lockedCount++;
    else unpaidCount++;
    f.months.forEach((m,mi)=>{
      if(m.type==='paid'||m.type==='partial'||m.type==='irregular'||m.type==='locked-paid')monthSums[mi]+=(m.amount||0);
    });
  });
  return {collected,paidCount,unpaidCount,lockedCount,monthSums};
}

// "Block-1" / "Block 1" / "1" → "1" — just the block's number/letter part,
// so flat labels can read "1-101" (block-flat) instead of just "101".
function povBlockNum(b){
  const v=String(b==null?'':b).trim();
  return v.replace(/^block[\s-]?/i,'')||v;
}

function povRenderChip(year,block,flat,mi,m){
  const flatArg=String(flat).replace(/'/g,"\\'");
  const clickAttr=m.type==='future'?'':`onclick="openPayFlatModal('${year}','${block}','${flatArg}',${mi})"`;
  if(m.type==='future')return `<span class="pov-chip future">—</span>`;
  if(m.type==='due')return `<span class="pov-chip due" ${clickAttr}>Due</span>`;
  if(m.type==='locked')return `<span class="pov-chip locked" ${clickAttr}>${svgPovLockIco}<span class="pov-chip-sub">Locked</span></span>`;
  if(m.type==='locked-paid')return `<span class="pov-chip locked-paid" ${clickAttr}>${fmt(m.amount)}<span class="pov-chip-sub">Locked</span></span>`;
  if(m.type==='paid')return `<span class="pov-chip paid" ${clickAttr}>${fmt(m.amount)}</span>`;
  if(m.type==='partial')return `<span class="pov-chip partial" ${clickAttr}>${fmt(m.amount)}<span class="pov-chip-sub">Pending</span></span>`;
  if(m.type==='irregular')return `<span class="pov-chip irregular" ${clickAttr}>${fmt(m.amount)}<span class="pov-chip-sub">Review</span></span>`;
  return '—';
}

function renderPaymentsOverview(){
  const yEl=document.getElementById('povYearFilter');
  if(!yEl.options.length){
    const years=Object.keys(PaymentsData.SHEET_IDS_BY_YEAR).sort((a,b)=>b-a);
    const defaultYear=years.includes(String(PaymentsData.CURRENT_YEAR))?String(PaymentsData.CURRENT_YEAR):(years[0]||'');
    yEl.innerHTML=years.map(y=>`<option value="${y}"${y===defaultYear?' selected':''}>${y}</option>`).join('');
  }
  povLoadAndRender();
}

async function povLoadAndRender(){
  const year=document.getElementById('povYearFilter').value;
  if(!year)return;
  showLoader('Loading payment ledger…');
  try{ await loadPayYear(year); }
  catch(e){ console.error('Payments overview load error:',e); }
  hideLoader();

  const flats=S.payMatrixCache[year]||[];
  const bEl=document.getElementById('povBlockFilter');
  const cur=bEl.value;
  const blocks=[...new Set(flats.map(f=>f.block))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  bEl.innerHTML='<option value="">All Blocks</option>'+blocks.map(b=>`<option value="${b}">${b.toUpperCase()}</option>`).join('');
  if(cur&&blocks.includes(cur))bEl.value=cur;

  filterPaymentsOverview();
}

function filterPaymentsOverview(){
  const year=document.getElementById('povYearFilter').value;
  const flats=S.payMatrixCache[year]||[];
  const block=document.getElementById('povBlockFilter').value;
  const status=document.getElementById('povStatusFilter').value;
  const q=(document.getElementById('povSearch').value||'').trim().toLowerCase();

  const filtered=flats.filter(f=>{
    if(block&&f.block!==block)return false;
    if(status&&povFlatStatusBucket(f)!==status)return false;
    if(q&&!String(f.flat).toLowerCase().includes(q))return false;
    return true;
  });

  // KPIs
  const k=povComputeKpis(flats.length?flats:filtered); // KPIs reflect the whole year, not the filtered subset — matches reference
  const rate=k.totalFlats?Math.round((k.fullyPaid/k.totalFlats)*100):0;
  document.getElementById('pov-kpi-total-label').textContent=`Total Collected · ${year}`;
  document.getElementById('pov-kpi-total').textContent=fmt(k.totalCollected);
  document.getElementById('pov-kpi-total-sublabel').textContent=`Across ${k.totalFlats} flats`;
  document.getElementById('pov-kpi-paid').textContent=k.fullyPaid;
  document.getElementById('pov-kpi-paid-sublabel').textContent=rate+'% collection rate to date';
  document.getElementById('pov-kpi-dues').textContent=k.withDues;
  document.getElementById('pov-kpi-dues-sublabel').textContent=k.needsReview+' also need review';
  document.getElementById('pov-kpi-locked').textContent=k.lockedFlats;

  povRenderMatrix(year,filtered);
}

function povRenderMatrix(year,flats){
  const wrap=document.getElementById('povBlocksWrap');
  if(!flats.length){
    wrap.innerHTML=`<div class="empty-state"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><circle cx="12" cy="16" r="0.6" fill="currentColor"/></svg><p>No flats match these filters</p><span>Try clearing the search or status filter</span></div>`;
    return;
  }

  const byBlock={};
  flats.forEach(f=>{ (byBlock[f.block]=byBlock[f.block]||[]).push(f); });
  const blockNames=Object.keys(byBlock).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const curMonthIdx=PaymentsData.CURRENT_MONTH_INDEX,curYear=PaymentsData.CURRENT_YEAR;

  wrap.innerHTML=blockNames.map(bn=>{
    const bf=byBlock[bn];
    const paidCount=bf.filter(f=>povFlatStatusBucket(f)==='ok').length;
    const pct=Math.round((paidCount/bf.length)*100);
    const collapsed=povCollapsedBlocks.has(bn);
    const stats=povComputeBlockStats(bf);
    const blockId='pov-blk-'+bn.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'');

    return `<div class="block-card pov-block-card${collapsed?' collapsed':''}" id="${blockId}">
      <div class="block-card-head" onclick="togglePovBlock('${blockId}','${bn}')">
        <div class="block-card-main">
          <div class="block-title-row">
            <div class="block-name">${bn}</div>
          </div>
          <div class="block-stat">${bf.length} flats &nbsp;·&nbsp; <strong>${fmt(stats.collected)}</strong> collected</div>
        </div>
        <div class="block-card-metric">
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
          <div class="block-pct">${pct}%</div>
          <div class="block-chevron"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
        </div>
      </div>
      <div class="block-body">
        <div class="pov-table-wrap">
          <table class="pov-matrix">
            <thead><tr>
              <th class="pov-flat-col">Flat</th>
              ${PaymentsData.MDISP.map((m,i)=>{
                const s=stats.monthSums[i];
                const isCur=i===curMonthIdx&&Number(year)===curYear;
                return `<th class="${isCur?'pov-current':''}"><span class="pov-th-month">${m}</span><span class="pov-month-sum${s?'':' zero'}">${s?fmt(s):'—'}</span></th>`;
              }).join('')}
              <th class="pov-total-col">Total</th>
            </tr></thead>
            <tbody>
              ${bf.map(f=>{
                const total=f.months.reduce((s,m)=>s+(m.amount||0),0)+(f.unattributed||0);
                const dueCount=f.months.filter(m=>m.type==='due'||m.type==='partial').length;
                const flatArg=String(f.flat).replace(/'/g,"\\'");
                return `<tr>
                  <td class="pov-flat-cell">
                    <div class="pov-flat-num">${povBlockNum(f.block)}-${f.flat}${f.unattributed?`<span class="pov-warn-ico" onclick="event.stopPropagation();openPayUnattributedModal('${year}','${f.block}','${flatArg}')" title="${fmt(f.unattributed)} unlinked to any month">${svgPovWarnIco}</span>`:''}</div>
                  </td>
                  ${f.months.map((m,mi)=>`<td>${povRenderChip(year,f.block,flatArg,mi,m)}</td>`).join('')}
                  <td class="pov-total-col">
                    <div class="pov-total-chip">${fmt(total)}<span class="pov-total-sub">${dueCount?dueCount+' due':'up to date'}</span></div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Mobile card view — same flats, shown instead of the matrix under 700px -->
        <div class="pov-mobile-cards">
          ${bf.map(f=>{
            const total=f.months.reduce((s,m)=>s+(m.amount||0),0)+(f.unattributed||0);
            const dueCount=f.months.filter(m=>m.type==='due'||m.type==='partial').length;
            const flatArg=String(f.flat).replace(/'/g,"\\'");
            const bucket=povFlatStatusBucket(f);
            const statusCls=bucket==='ok'?'ok':bucket==='locked'?'locked':bucket==='irregular'?'review':'due';
            const statusLabel=bucket==='ok'?'Up to date':bucket==='irregular'?'Needs review':bucket==='locked'?'Locked':'Has dues';
            return `<div class="pov-mob-card">
              <div class="pov-mob-card-head">
                <div class="pov-flat-num">${povBlockNum(f.block)}-${f.flat}${f.unattributed?`<span class="pov-warn-ico" onclick="event.stopPropagation();openPayUnattributedModal('${year}','${f.block}','${flatArg}')" title="${fmt(f.unattributed)} unlinked to any month">${svgPovWarnIco}</span>`:''}</div>
                <div class="pov-mob-total">
                  <div class="pov-mob-total-val">${fmt(total)}</div>
                  <div class="pov-mob-total-sub">${dueCount?dueCount+' due':'up to date'}</div>
                  <div class="pov-mob-status ${statusCls}">${statusLabel}</div>
                </div>
              </div>
              <div class="pov-mob-strip">
                ${f.months.map((m,mi)=>`<div class="pov-mob-cell"><span class="pov-mob-cell-month">${PaymentsData.MDISP[mi]}</span>${povRenderChip(year,f.block,flatArg,mi,m)}</div>`).join('')}
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
  }).join('');
}

function togglePovBlock(blockId,bn){
  if(povCollapsedBlocks.has(bn))povCollapsedBlocks.delete(bn);
  else povCollapsedBlocks.add(bn);
  const card=document.getElementById(blockId);
  if(card)card.classList.toggle('collapsed');
}

function togglePovCollapseAll(){
  povAllCollapsed=!povAllCollapsed;
  const year=document.getElementById('povYearFilter').value;
  const flats=S.payMatrixCache[year]||[];
  if(povAllCollapsed){
    flats.forEach(f=>povCollapsedBlocks.add(f.block));
  }else{
    povCollapsedBlocks.clear();
  }
  document.getElementById('povCollapseLabel').textContent=povAllCollapsed?'Expand all':'Collapse all';
  document.getElementById('povCollapseBtn').classList.toggle('all-collapsed',povAllCollapsed);
  document.querySelectorAll('.pov-block-card').forEach(card=>card.classList.toggle('collapsed',povAllCollapsed));
}

// ── EXPENSE PAGE ──
async function initExpense(){
  if(!S.expenseData){
    showLoader('Loading expenses…');
    try{
      S.expenseData=await fetchExpenseData();
    }catch(e){
      console.error('Expense fetch error:',e);
      hideLoader();
      document.getElementById('expBody').innerHTML=`<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--rose)">Failed to load expense data.</td></tr>`;
      return;
    }
    hideLoader();
  }
  if(!S.expenseData||!S.expenseData.rowData){
    document.getElementById('expBody').innerHTML=`<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text3)">No expense data available.</td></tr>`;
    return;
  }
  const cols=S.expenseData.columns||[];
  const rows=(S.expenseData.rowData||[]).slice().reverse();
  S.expFiltered=rows;
  const displayCols=cols.filter(c=>c&&c.toUpperCase()!=='BILL');
  document.getElementById('expHead').innerHTML=`<tr>${displayCols.map(c=>`<th>${c}</th>`).join('')}<th>BILL</th></tr>`;
  let cr=0,db=0;
  rows.forEach(r=>{
    const t=(r['TRANSACTION TYPE']||r['TYPE']||'').toUpperCase();
    const a=Number(r['AMOUNT'])||0;
    if(t==='CREDIT')cr+=a; else if(t==='DEBIT')db+=a;
  });
  document.getElementById('exp-credit').textContent=fmt(cr);
  document.getElementById('exp-debit').textContent=fmt(db);
  const bal=cr-db;
  const bEl=document.getElementById('exp-balance');
  bEl.textContent=fmt(bal);
  const card=document.getElementById('expBalanceCard');
  card.className='kpi-card '+(bal>=0?'kpi-emerald':'kpi-rose');

  // ── Enhanced KPI percentage insights ──
  const total=cr+db;

  // Credit: % of total cash flow
  const creditPct = total>0 ? Math.round(cr/total*100) : 0;
  const creditBadgeEl=document.getElementById('exp-credit-badge');
  if(creditBadgeEl){
    creditBadgeEl.textContent=creditPct+'% of flow';
    creditBadgeEl.className='kpi-trend-badge up';
    document.getElementById('exp-credit-sub').textContent='₹'+cr.toLocaleString('en-IN')+' of ₹'+total.toLocaleString('en-IN')+' total';
    setTimeout(()=>{ document.getElementById('exp-credit-bar').style.width=creditPct+'%'; },80);
  }

  // Debit: % of total cash flow
  const debitPct = total>0 ? Math.round(db/total*100) : 0;
  const debitBadgeEl=document.getElementById('exp-debit-badge');
  if(debitBadgeEl){
    debitBadgeEl.textContent=debitPct+'% of flow';
    debitBadgeEl.className='kpi-trend-badge down';
    document.getElementById('exp-debit-sub').textContent='₹'+db.toLocaleString('en-IN')+' spent of ₹'+cr.toLocaleString('en-IN')+' income';
    setTimeout(()=>{ document.getElementById('exp-debit-bar').style.width=debitPct+'%'; },120);
  }

  // Balance: retention % (balance as % of credit)
  const retentionPct = cr>0 ? Math.round(Math.max(0,bal)/cr*100) : 0;
  const balBadgeEl=document.getElementById('exp-balance-badge');
  if(balBadgeEl){
    if(bal>=0){
      balBadgeEl.textContent=retentionPct+'% Retained';
      balBadgeEl.className='kpi-trend-badge up';
      document.getElementById('exp-balance-sub').textContent=retentionPct+'% of income remaining';
    } else {
      const overPct=cr>0?Math.round(Math.abs(bal)/cr*100):0;
      balBadgeEl.textContent=overPct+'% Overspent';
      balBadgeEl.className='kpi-trend-badge down';
      document.getElementById('exp-balance-sub').textContent='Deficit: overspent by '+overPct+'%';
    }
    const barW=cr>0?Math.min(100,Math.round(Math.abs(bal)/cr*100)):0;
    setTimeout(()=>{ document.getElementById('exp-balance-bar').style.width=barW+'%'; },160);
  }

  renderExpTable();
}

function filterExpense(){
  if(!S.expenseData)return;
  const q=(document.getElementById('expSearch').value||'').toLowerCase();
  const typ=(document.getElementById('expTypeFilter').value||'').toUpperCase();
  const rows=(S.expenseData.rowData||[]).slice().reverse();
  S.expFiltered=rows.filter(r=>{
    if(typ&&(r['TRANSACTION TYPE']||r['TYPE']||'').toUpperCase()!==typ)return false;
    if(q){const line=Object.values(r).join(' ').toLowerCase();if(!line.includes(q))return false;}
    return true;
  });
  S.expPage=1;
  renderExpTable();
}

function expChangeRows(){S.expRowsPerPage=parseInt(document.getElementById('expRowsPerPage').value)||15;S.expPage=1;renderExpTable()}

function renderExpTable(){
  const rows=S.expFiltered;
  const rpp=S.expRowsPerPage;
  const pages=Math.ceil(rows.length/rpp)||1;
  const p=Math.min(S.expPage,pages);
  const slice=rows.slice((p-1)*rpp,p*rpp);
  const allCols=S.expenseData?.columns||[];
  const displayCols=allCols.filter(c=>c&&c.toUpperCase()!=='BILL');
  const body=document.getElementById('expBody');

  if(!slice.length){
    body.innerHTML=`<tr><td colspan="${displayCols.length+1}" style="text-align:center;padding:40px;color:var(--text3)">No records found</td></tr>`;
    document.getElementById('expPagination').innerHTML='';
    // Also clear mobile cards
    const mc=document.getElementById('expMobileCards');
    if(mc)mc.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">No records found</div>';
    return;
  }

  // Desktop table rows
  body.innerHTML=slice.map(r=>{
    const t=(r['TRANSACTION TYPE']||r['TYPE']||'').toUpperCase();
    const cls=t==='CREDIT'?'row-credit':t==='DEBIT'?'row-debit':'';
    const cells=displayCols.map(c=>{
      let v=r[c]??'';
      if(c==='TRANSACTION TYPE'||c==='TYPE'){v=`<span class="pill ${t==='CREDIT'?'pill-credit':'pill-debit'}">${t||v}</span>`;}
      return `<td>${v}</td>`;
    }).join('');
    const bill=r['BILL']||r['bill']||r['RECEIPT']||'';
    const desc=(r['DESCRIPTION']||r['NARRATION']||r['PARTICULARS']||'').replace(/'/g,"\\'");
    const viewBtn=bill
      ?`<button class="view-bill-btn" onclick="openBillModal('${bill.replace(/'/g,"\\'")}','Bill – ${desc}')"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View Bill</button>`
      :`<span style="color:var(--text3);font-size:11px">—</span>`;
    return `<tr class="${cls}">${cells}<td>${viewBtn}</td></tr>`;
  }).join('');

  // Mobile cards
  const mc=document.getElementById('expMobileCards');
  if(mc){
    mc.innerHTML=slice.map(r=>{
      const t=(r['TRANSACTION TYPE']||r['TYPE']||'').toUpperCase();
      const a=Number(r['AMOUNT'])||0;
      const desc=r['DESCRIPTION']||r['NARRATION']||r['PARTICULARS']||'—';
      const date=r['TRANSACTION DATE']||'';
      const bill=r['BILL']||r['bill']||r['RECEIPT']||'';
      const closingBal=r['CLOSING BALANCE']!==undefined?Number(r['CLOSING BALANCE']):null;
      const sign=t==='CREDIT'?'+':t==='DEBIT'?'-':'';
      const typeClass=t==='CREDIT'?'credit':'debit';
      const safeDesc=desc.replace(/'/g,"\\'");
      const safeBill=(bill||'').replace(/'/g,"\\'");
      return `<div class="exp-card card-${typeClass}">
        <div class="exp-card-top">
          <div class="exp-card-desc">${desc}</div>
          <div class="exp-card-amt ${typeClass}">${sign}₹${a.toLocaleString('en-IN')}</div>
        </div>
        <div class="exp-card-meta">
          <div class="exp-card-date"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${date}</div>
          <span class="exp-card-pill ${typeClass}">${t||'—'}</span>
        </div>
        ${closingBal!==null?`<div class="exp-card-balance">Balance: <strong>₹${closingBal.toLocaleString('en-IN')}</strong></div>`:''}
        ${bill?`<div class="exp-card-bill"><button class="view-bill-btn" onclick="openBillModal('${safeBill}','Bill – ${safeDesc}')"><svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>View Bill</button></div>`:''}
      </div>`;
    }).join('');
  }

  const pEl=document.getElementById('expPagination');
  const start=(p-1)*rpp+1,end=Math.min(p*rpp,rows.length);
  let pg=`<span>Showing ${start}–${end} of ${rows.length}</span><div class="page-btns">`;
  pg+=`<button class="page-btn" onclick="expGoPage(${p-1})" ${p<=1?'disabled':''}>‹</button>`;
  const range=pageRange(p,pages);
  range.forEach(x=>pg+=x==='…'?`<span class="page-btn" style="cursor:default;opacity:.4">…</span>`:`<button class="page-btn${x===p?' active':''}" onclick="expGoPage(${x})">${x}</button>`);
  pg+=`<button class="page-btn" onclick="expGoPage(${p+1})" ${p>=pages?'disabled':''}>›</button></div>`;
  pEl.innerHTML=pg;
}

function expGoPage(p){S.expPage=p;renderExpTable()}
function pageRange(cur,tot){
  if(tot<=7)return Array.from({length:tot},(_,i)=>i+1);
  const r=[1];if(cur>3)r.push('…');
  for(let i=Math.max(2,cur-1);i<=Math.min(tot-1,cur+1);i++)r.push(i);
  if(cur<tot-2)r.push('…');r.push(tot);return r;
}

// ── VEHICLE SEARCH PAGE ──
function normVehType(t){
  const u=(t||'').toUpperCase().trim();
  if(u==='CAR'||u==='CARS')return 'CAR';
  if(u==='BIKE'||u==='BIKES'||u==='MOTORCYCLE')return 'BIKE';
  if(u==='SCOOTY'||u==='SCOOTER'||u==='SCOOTERS')return 'SCOOTY';
  return u||'OTHER';
}
function vehTypeIcon(t){
  if(t==='CAR')return `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7"/><path d="M6 11h.01M10 11h.01"/></svg>`;
  if(t==='BIKE')return `<svg viewBox="0 0 24 24"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm-3 11.5L9.5 10.5h6L17 9M9.5 10.5L7 14h7.5"/></svg>`;
  if(t==='SCOOTY')return `<svg viewBox="0 0 24 24"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M5.5 17.5L9 8.5h5l2 4.5h2.5M9 8.5h2.5"/></svg>`;
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>`;
}
function vehTypePillClass(t){
  if(t==='CAR')return 'pill-credit';      // emerald
  if(t==='BIKE')return 'pill-debit';      // rose — reused for visual variety
  return 'pill-veh-amber';
}
function vehColorStyle(c){
  // name -> {bg, text} — bg is the pill fill, text is chosen for contrast
  const map={
    white:    {bg:'#f5f5f5', text:'#52525b', border:'#d4d4d8'},
    black:    {bg:'#27272a', text:'#fafafa', border:'#27272a'},
    silver:   {bg:'#d4d4d8', text:'#3f3f46', border:'#a1a1aa'},
    grey:     {bg:'#9ca3af', text:'#fff',    border:'#9ca3af'},
    gray:     {bg:'#9ca3af', text:'#fff',    border:'#9ca3af'},
    red:      {bg:'#dc2626', text:'#fff',    border:'#dc2626'},
    blue:     {bg:'#2563eb', text:'#fff',    border:'#2563eb'},
    green:    {bg:'#16a34a', text:'#fff',    border:'#16a34a'},
    yellow:   {bg:'#facc15', text:'#713f12', border:'#eab308'},
    orange:   {bg:'#ea580c', text:'#fff',    border:'#ea580c'},
    brown:    {bg:'#7c4a25', text:'#fff',    border:'#7c4a25'},
    maroon:   {bg:'#7f1d1d', text:'#fff',    border:'#7f1d1d'},
    gold:     {bg:'#d4a72c', text:'#422006', border:'#b8860b'},
    beige:    {bg:'#d8c9a3', text:'#57534e', border:'#c4b48a'},
    purple:   {bg:'#7c3aed', text:'#fff',    border:'#7c3aed'},
    pink:     {bg:'#ec4899', text:'#fff',    border:'#ec4899'},
    navy:     {bg:'#1e3a5f', text:'#fff',    border:'#1e3a5f'},
    cyan:     {bg:'#0891b2', text:'#fff',    border:'#0891b2'},
    teal:     {bg:'#0d9488', text:'#fff',    border:'#0d9488'},
  };
  const key=(c||'').toLowerCase().trim();
  return map[key]||{bg:'rgba(156,163,175,.15)', text:'#71717a', border:'rgba(156,163,175,.4)'};
}
function vehColorPill(c){
  if(!c)return '—';
  const s=vehColorStyle(c);
  return `<span class="pill" style="background:${s.bg};color:${s.text};border:1px solid ${s.border}">${c}</span>`;
}
function formatBlock(b){
  const v=(b==null?'':String(b)).trim();
  if(!v)return '—';
  // Already formatted like "Block-1" / "Block 1" → leave as-is
  if(/^block[\s-]?/i.test(v))return v;
  return 'Block-'+v;
}

async function ensureVehicleData(){
  if(S.vehicleData)return S.vehicleData;
  try{
    // Same directory spreadsheet as Emergency Contacts, "vehicles" tab —
    // see vehicles.html reference project (DIR_ID/DIR_TAB_NAME there).
    const csv=await PaymentsData.fetchCsv(EMERGENCY_SHEET_ID, 'vehicles');
    if(!csv)throw new Error('Could not load the vehicle directory.');
    const lines=csv.split(/\r?\n/).filter(l=>l.trim()!=='');
    if(!lines.length){
      S.vehicleData={vehicles:[]};
    }else{
      const headers=PaymentsData.parseCSV(lines[0]);
      const colIdx=detectVehicleColumns(headers);
      if(colIdx.block<0||colIdx.flatNo<0||colIdx.type<0||colIdx.vehicle<0){
        throw new Error('Could not find Block / Flat No / Vehicle Type / Vehicle No columns in the sheet header.');
      }
      const vehicles=lines.slice(1)
        .map(line=>rowToVehicleObj(PaymentsData.parseCSV(line),colIdx))
        .filter(v=>v.block||v.flatNo||v.vehicleType||v.vehicleNo);
      S.vehicleData={vehicles};
    }
  }catch(e){
    console.error('Vehicle data fetch error:',e);
    S.vehicleData={vehicles:[]};
  }
  return S.vehicleData;
}

async function initVehicles(){
  if(!S.vehicleData){
    showLoader('Loading vehicles…');
    await ensureVehicleData();
    hideLoader();
  }
  if(!S.vehicleData||!Array.isArray(S.vehicleData.vehicles)){
    document.getElementById('vehBody').innerHTML=`<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3)">No vehicle data available.</td></tr>`;
    return;
  }

  S.vehFiltered=S.vehicleData.vehicles;
  renderVehicleKpis();
  renderVehTable();
}

/* Header-name detection + row mapping — same rules as the vehicles.html
   reference project, so both read the "vehicles" tab identically even if
   the sheet's column order or exact header wording ever shifts. */
function detectVehicleColumns(headers){
  const H=headers.map(h=>String(h||'').trim().toUpperCase());
  function find(...patterns){
    for(let i=0;i<H.length;i++){ if(patterns.includes(H[i]))return i; }
    return -1;
  }
  return {
    block:   find('BLOCK'),
    flatNo:  find('FLAT NO','FLAT NO.','FLAT_NO','FLAT NUMBER'),
    type:    find('VEHICLE TYPE','VEHICLE_TYPE','TYPE'),
    vehicle: find('VEHICLE NO','VEHICLE NO.','VEHICLE_NO','VEHICLE NUMBER'),
    brand:   find('BRAND','VEHICLE BRAND','MAKE'),
    model:   find('MODEL','VEHICLE MODEL'),
    color:   find('COLOR','COLOUR','VEHICLE COLOR','VEHICLE COLOUR'),
  };
}
function rowToVehicleObj(cols,colIdx){
  const get=(i)=>i>=0&&i<cols.length?String(cols[i]||'').trim():'';
  return {
    block:       get(colIdx.block),
    flatNo:      get(colIdx.flatNo),
    vehicleType: get(colIdx.type),
    vehicleNo:   get(colIdx.vehicle),
    brand:       get(colIdx.brand),
    model:       get(colIdx.model),
    color:       get(colIdx.color),
  };
}

function renderVehicleKpis(){
  const vehicles=S.vehicleData.vehicles||[];
  const total=vehicles.length;
  let cars=0,bikes=0,scooty=0;
  vehicles.forEach(v=>{
    const t=normVehType(v.vehicleType);
    if(t==='CAR')cars++; else if(t==='BIKE')bikes++; else if(t==='SCOOTY')scooty++;
  });

  document.getElementById('veh-total').textContent=total.toLocaleString('en-IN');
  document.getElementById('veh-cars').textContent=cars.toLocaleString('en-IN');
  document.getElementById('veh-bikes').textContent=bikes.toLocaleString('en-IN');
  document.getElementById('veh-scooty').textContent=scooty.toLocaleString('en-IN');

  const carsPct=total>0?Math.round(cars/total*100):0;
  const bikesPct=total>0?Math.round(bikes/total*100):0;
  const scootyPct=total>0?Math.round(scooty/total*100):0;

  document.getElementById('veh-cars-badge').textContent=carsPct+'%';
  document.getElementById('veh-cars-badge').className='kpi-trend-badge up';
  document.getElementById('veh-cars-sub').textContent=carsPct+'% of total vehicles';

  document.getElementById('veh-bikes-badge').textContent=bikesPct+'%';
  document.getElementById('veh-bikes-badge').className='kpi-trend-badge up';
  document.getElementById('veh-bikes-sub').textContent=bikesPct+'% of total vehicles';

  document.getElementById('veh-scooty-badge').textContent=scootyPct+'%';
  document.getElementById('veh-scooty-badge').className='kpi-trend-badge up';
  document.getElementById('veh-scooty-sub').textContent=scootyPct+'% of total vehicles';

  setTimeout(()=>{
    document.getElementById('veh-total-bar').style.width='100%';
    document.getElementById('veh-cars-bar').style.width=carsPct+'%';
    document.getElementById('veh-bikes-bar').style.width=bikesPct+'%';
    document.getElementById('veh-scooty-bar').style.width=scootyPct+'%';
  },100);
}

function filterVehicles(){
  if(!S.vehicleData)return;
  const q=(document.getElementById('vehSearch').value||'').toLowerCase().trim();
  const typ=(document.getElementById('vehTypeFilter').value||'').toUpperCase();
  const vehicles=S.vehicleData.vehicles||[];
  S.vehFiltered=vehicles.filter(v=>{
    if(typ&&normVehType(v.vehicleType)!==typ)return false;
    if(q){
      const line=[v.block,v.flatNo,v.vehicleType,v.vehicleNo,v.brand,v.model,v.color].join(' ').toLowerCase();
      if(!line.includes(q))return false;
    }
    return true;
  });
  S.vehPage=1;
  renderVehTable();
}

function vehChangeRows(){
  S.vehRowsPerPage=parseInt(document.getElementById('vehRowsPerPage').value)||15;
  S.vehPage=1;
  renderVehTable();
}

function renderVehTable(){
  const rows=S.vehFiltered||[];
  const rpp=S.vehRowsPerPage;
  const pages=Math.ceil(rows.length/rpp)||1;
  const p=Math.min(S.vehPage,pages);
  const slice=rows.slice((p-1)*rpp,p*rpp);
  const body=document.getElementById('vehBody');

  if(!slice.length){
    body.innerHTML=`<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--text3)">No vehicles found</td></tr>`;
    document.getElementById('vehPagination').innerHTML='';
    const mc=document.getElementById('vehMobileCards');
    if(mc)mc.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);font-size:13px">No vehicles found</div>';
    return;
  }

  // Desktop table rows
  body.innerHTML=slice.map(v=>{
    const t=normVehType(v.vehicleType);
    return `<tr>
      <td>${formatBlock(v.block)}</td>
      <td>${v.flatNo||'—'}</td>
      <td><span class="pill ${vehTypePillClass(t)}">${v.vehicleType||t}</span></td>
      <td style="font-family:'Fira Code',monospace;font-weight:700;letter-spacing:.02em">${v.vehicleNo||'—'}</td>
      <td>${v.brand||'—'}</td>
      <td>${v.model||'—'}</td>
      <td>${vehColorPill(v.color)}</td>
    </tr>`;
  }).join('');

  // Mobile cards
  const mc=document.getElementById('vehMobileCards');
  if(mc){
    mc.innerHTML=slice.map(v=>{
      const t=normVehType(v.vehicleType);
      const bm=[v.brand,v.model].filter(Boolean).join(' ');
      return `<div class="exp-card veh-card-${t.toLowerCase()}">
        <div class="exp-card-top">
          <div class="exp-card-desc" style="font-family:'Fira Code',monospace;letter-spacing:.02em">${v.vehicleNo||'—'}</div>
          <span class="exp-card-pill veh-pill-${t.toLowerCase()}">${v.vehicleType||t}</span>
        </div>
        ${bm||v.color?`<div class="veh-card-bmcolor" style="font-size:13px;font-weight:600;color:var(--text2);margin-bottom:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">${bm?`<span>${bm}</span>`:''}${v.color?vehColorPill(v.color):''}</div>`:''}
        <div class="exp-card-meta">
          <div class="exp-card-date"><svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>${formatBlock(v.block)}</div>
          <div class="exp-card-date"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg>Flat ${v.flatNo||'—'}</div>
        </div>
      </div>`;
    }).join('');
  }

  const pEl=document.getElementById('vehPagination');
  const start=(p-1)*rpp+1,end=Math.min(p*rpp,rows.length);
  let pg=`<span>Showing ${start}–${end} of ${rows.length}</span><div class="page-btns">`;
  pg+=`<button class="page-btn" onclick="vehGoPage(${p-1})" ${p<=1?'disabled':''}>‹</button>`;
  const range=pageRange(p,pages);
  range.forEach(x=>pg+=x==='…'?`<span class="page-btn" style="cursor:default;opacity:.4">…</span>`:`<button class="page-btn${x===p?' active':''}" onclick="vehGoPage(${x})">${x}</button>`);
  pg+=`<button class="page-btn" onclick="vehGoPage(${p+1})" ${p>=pages?'disabled':''}>›</button></div>`;
  pEl.innerHTML=pg;
}

function vehGoPage(p){S.vehPage=p;renderVehTable()}

// ── EMERGENCY PAGE ──
// Reads the emergency-contacts spreadsheet directly in the browser (the
// same sheet + parsing rules as the emergency-contact.html reference
// project) — no PHP/API involved.
const EMERGENCY_SHEET_ID='15iii2nw4THbf-t-TdYNfj5WW2Aw4selhvfwu64YzisE';
const EMERGENCY_TAB_NAME='emergency-contacts';
const EMG_SECTION_ORDER=['SECURITY GUARD','HOUSING BOARD & NRDA','EMERGENCY HELPLINE','HOSPITALS','DAILY HELPS'];

const EMG_SECTIONS=[
  {key:'SECURITY GUARD',label:'Security Guards',icon:'🛡️',color:'rgba(79,98,216,.13)',accentColor:'#4f62d8'},
  {key:'HOUSING BOARD & NRDA',label:'Housing Board & NRDA',icon:'🏛️',color:'rgba(123,97,209,.13)',accentColor:'#7b61d1'},
  {key:'EMERGENCY HELPLINE',label:'Emergency Helpline',icon:'🚨',color:'rgba(216,63,99,.13)',accentColor:'#d83f63'},
  {key:'HOSPITALS',label:'Hospitals',icon:'🏥',color:'rgba(15,159,120,.13)',accentColor:'#0f9f78'},
  {key:'DAILY HELPS',label:'Daily Helps',icon:'🤝',color:'rgba(199,122,22,.13)',accentColor:'#c77a16'}
];

/* Parses a single CSV line, handling quoted fields with embedded commas
   and escaped "" quotes — same logic as the emergency-contact.html
   reference project. */
function emgParseCSVLine(line){
  const cols=[];let cur='',inQ=false;
  for(let i=0;i<line.length;i++){
    const c=line[i],n=line[i+1];
    if(c==='"'&&inQ&&n==='"'){cur+='"';i++;}
    else if(c==='"')inQ=!inQ;
    else if(c===','&&!inQ){cols.push(cur);cur='';}
    else cur+=c;
  }
  cols.push(cur);
  return cols.map(s=>s.trim());
}

/* Maps whatever text is in the "section header" rows (SECURITY GUARD,
   HOUSING BOARD & NRDA, etc. — including loose variants like "Police"
   or "Ambulance") onto one of the five canonical sections. Same rules
   as the reference project so both read the sheet identically. */
function emgCanonicalSection(v,fallback){
  const h=String(v||'').trim().toUpperCase();
  if(!h)return fallback||EMG_SECTION_ORDER[0];
  if(h.includes('SECURITY'))return 'SECURITY GUARD';
  if(h.includes('HOUSING')||h.includes('NRDA')||h.includes('CGSPDCL'))return 'HOUSING BOARD & NRDA';
  if(h.includes('EMERGENCY')||h.includes('POLICE')||h.includes('FIRE'))return 'EMERGENCY HELPLINE';
  if(h.includes('HOSPITAL')||h.includes('AMBULANCE')||h.includes('BALCO'))return 'HOSPITALS';
  if(h.includes('DAILY'))return 'DAILY HELPS';
  return fallback||h;
}

/* A row with a value in column 1 (work/category) but nothing in columns
   2-3 (number/name) is a section-header row, not a contact — everything
   after it belongs to that section until the next header row. */
function emgBuildSections(rows){
  const map={};
  EMG_SECTION_ORDER.forEach(t=>{map[t]=[];});
  let cur=EMG_SECTION_ORDER[0];
  rows.forEach(cols=>{
    while(cols.length<3)cols.push('');
    const work=(cols[0]||'').trim(),number=(cols[1]||'').trim(),name=(cols[2]||'').trim();
    if(!work&&!number&&!name)return; // blank spacer row
    if(work&&!number&&!name){ cur=emgCanonicalSection(work,cur); return; } // section header row
    const sec=emgCanonicalSection(cur,cur);
    if(!map[sec])map[sec]=[];
    map[sec].push({work,number,name});
  });
  return map;
}

async function initEmergency(){
  if(!S.emergencyData){
    showLoader('Loading contacts…');
    try{
      const csv=await PaymentsData.fetchCsv(EMERGENCY_SHEET_ID, EMERGENCY_TAB_NAME);
      if(!csv)throw new Error('Unable to load sheet.');
      const allRows=csv.split(/\r?\n/).filter(l=>l.trim()).map(emgParseCSVLine);
      if(allRows.length<2)throw new Error('Sheet appears empty.');
      S.emergencyData={sections:emgBuildSections(allRows.slice(1))};
    }catch(e){
      console.error('Emergency fetch error:',e);
      hideLoader();
      renderEmergencySections({});
      return;
    }
    hideLoader();
  }
  const sections=S.emergencyData.sections;
  S.emgSections=sections;
  S.emgActiveFilter='ALL';
  buildEmgFilterChips(sections);
  if(document.getElementById('emgBadge'))document.getElementById('emgBadge').style.display='inline';
  renderEmergencySections(sections);
}

function buildEmgFilterChips(sections){
  const total=Object.values(sections).reduce((a,v)=>a+v.length,0);
  let html=`<button class="emg-filter-chip active" onclick="setEmgFilter('ALL',this)">All <span class="chip-count">${total}</span></button>`;
  EMG_SECTIONS.forEach(sec=>{
    const cnt=(sections[sec.key]||[]).length;
    if(!cnt)return;
    html+=`<button class="emg-filter-chip" onclick="setEmgFilter('${sec.key}',this)">${sec.label} <span class="chip-count">${cnt}</span></button>`;
  });
  document.getElementById('emgFilterChips').innerHTML=html;
}

function setEmgFilter(key,btn){
  S.emgActiveFilter=key;
  document.querySelectorAll('.emg-filter-chip').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  filterEmergency();
}

function filterEmergency(){
  const q=(document.getElementById('emgSearch').value||'').toLowerCase();
  const filtered={};
  EMG_SECTIONS.forEach(s=>{
    let items=S.emgSections[s.key]||[];
    if(S.emgActiveFilter!=='ALL'&&S.emgActiveFilter!==s.key){filtered[s.key]=[];return;}
    if(q)items=items.filter(c=>Object.values(c).join(' ').toLowerCase().includes(q));
    filtered[s.key]=items;
  });
  renderEmergencySections(filtered);
}

function renderEmergencySections(sections){
  const wrap=document.getElementById('emgWrap');
  const allEmpty=EMG_SECTIONS.every(s=>!(sections[s.key]||[]).length);
  if(allEmpty){
    wrap.innerHTML=`<div class="empty-state">
      <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.67 11a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.58 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
      <p>No contacts found</p><span>Try adjusting the search or filter</span>
    </div>`;
    return;
  }
  let html='';
  EMG_SECTIONS.forEach(sec=>{
    const items=sections[sec.key]||[];
    if(!items.length)return;

    // Mobile cards HTML
    const mobileCards=items.map(c=>{
      const cleanNum=(c.number||'').replace(/\s/g,'');
      const displayName=c.name||c.work||'—';
      const displayRole=c.name?c.work:'';
      return `<div class="emg-contact-card">
        <div class="emg-contact-avatar" style="background:${sec.color}">${sec.icon}</div>
        <div class="emg-contact-info">
          <div class="emg-contact-name">${displayName}</div>
          ${displayRole?`<div class="emg-contact-role">${displayRole}</div>`:''}
          ${cleanNum?`<div class="emg-contact-role" style="color:var(--cyan);font-family:'Fira Code',monospace;font-size:12px;margin-top:2px">${c.number}</div>`:''}
        </div>
        ${cleanNum
          ?`<a href="tel:${cleanNum}" class="emg-contact-call"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.67 11a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.58 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>`
          :`<div class="emg-contact-no-call"></div>`
        }
      </div>`;
    }).join('');

    html+=`<div class="emg-section">
      <div class="emg-section-hd">
        <div class="emg-section-icon" style="background:${sec.color}">${sec.icon}</div>
        <div>
          <div class="emg-section-title">${sec.label}</div>
        </div>
        <div class="emg-section-count">${items.length} contact${items.length!==1?'s':''}</div>
      </div>
      <div class="emg-table-wrap">
        <table class="emg-table">
          <thead>
            <tr>
              <th>Role / Work</th>
              <th>Name</th>
              <th>Contact Number</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(c=>{
              const cleanNum=(c.number||'').replace(/\s/g,'');
              return `<tr>
                <td class="emg-role-cell">${c.work||'—'}</td>
                <td class="emg-name-cell">${c.name||'—'}</td>
                <td>${cleanNum
                  ?`<a href="tel:${cleanNum}" class="call-link"><svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.67 11a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.58 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.18 6.18l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${c.number}</a>`
                  :'<span style="color:var(--text3)">—</span>'
                }</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div class="emg-contact-cards">${mobileCards}</div>
    </div>`;
  });
  wrap.innerHTML=html;
}

// ── COLLAPSIBLE BLOCKS (mobile only) ──
function toggleBlock(id){
  // Only collapse on mobile (≤900px)
  if(window.innerWidth>900)return;
  const card=document.getElementById(id);
  if(!card)return;
  const wasExpanded=card.classList.contains('expanded');
  card.classList.toggle('expanded');
  const head=card.querySelector('.block-card-head');
  if(head)head.setAttribute('aria-expanded',String(!wasExpanded));
}


// ── NOTICE BOARD (dynamic) ──
// Data is loaded from /api/notices and /api/meetings on first render.
// Falls back to empty state with a helpful message if the API isn't set up yet.

let S_noticeLang='en';
let S_noticeLangPage='en';
let NOTICES=[];       // populated by loadNotices()
let MEETINGS_DATA=[]; // populated by loadMeetings()

async function loadNotices(){
  try{
    const r=await fetch('/api/notices');
    if(!r.ok)throw new Error('HTTP '+r.status);
    const json=await r.json();
    NOTICES=(json.notices||[]);
  }catch(e){
    console.warn('Could not load notices from API:',e);
    NOTICES=[];
  }
}

async function loadMeetings(){
  try{
    const r=await fetch('/api/meetings');
    if(!r.ok)throw new Error('HTTP '+r.status);
    const json=await r.json();
    MEETINGS_DATA=(json.meetings||[]);
  }catch(e){
    console.warn('Could not load meetings from API:',e);
    MEETINGS_DATA=[];
  }
}

// ── translate notice HTML via Anthropic API and cache per notice object ──
async function translateNoticeHTML(htmlStr) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'You are a translator. Translate the given HTML notice content from English to Hindi. Preserve ALL HTML tags exactly as-is (do not add, remove, or alter any tags). Only translate the visible text content inside the tags. Return ONLY the translated HTML — no explanation, no markdown, no code fences.',
      messages: [{role:'user', content: htmlStr}]
    })
  });
  const data = await response.json();
  const text = (data.content||[]).map(b=>b.type==='text'?b.text:'').join('');
  return text.trim();
}

// ── single toggle function used by both boards ──
async function toggleNoticeLang(board) {
  const isPage = board === 'page';
  const sw = document.getElementById(isPage ? 'langSwitchPage' : 'langSwitchDash');
  if (!sw) return;

  const goingHindi = sw.getAttribute('data-hi') !== '1';

  // Flip the switch visually immediately
  sw.setAttribute('data-hi', goingHindi ? '1' : '0');
  if (isPage) {
    S_noticeLangPage = goingHindi ? 'hi' : 'en';
  } else {
    S_noticeLang = goingHindi ? 'hi' : 'en';
  }

  if (!goingHindi) {
    // Going back to English — instant, no API call needed
    isPage ? renderNoticesPage() : renderNotices();
    return;
  }

  // Going to Hindi — need translations
  // Show pulsing indicator on the track while we translate
  const track = sw.querySelector('.lang-switch-track');
  if (track) track.classList.add('translating');

  // Translate any notice that doesn't yet have a cached Hindi version
  const needsTranslation = NOTICES.filter(n => !n._html_hi && (n.html || n.text_en));
  if (needsTranslation.length) {
    try {
      await Promise.all(needsTranslation.map(async n => {
        const src = n.html || n.text_en || '';
        if (!src) return;
        n._html_hi = await translateNoticeHTML(src);
      }));
    } catch(e) {
      console.warn('Translation error:', e);
      // Fall back: copy English so the switch still "works"
      needsTranslation.forEach(n => { if (!n._html_hi) n._html_hi = n.html || n.text_en || ''; });
    }
  }

  if (track) track.classList.remove('translating');
  isPage ? renderNoticesPage() : renderNotices();
}

function _buildNoticeHTML(notices,lang,badgeId,listId){
  const list=document.getElementById(listId);
  const badge=document.getElementById(badgeId);
  if(!list)return;
  if(!notices.length){
    list.innerHTML='<div class="notice-empty">'+(lang==='hi'?'अभी कोई सूचना नहीं है।':'No notices at this time.')+'</div>';
    if(badge)badge.style.display='none';
    return;
  }
  if(badge){
    badge.style.display='';
    badge.textContent=notices.length+(notices.length===1?(lang==='hi'?' सूचना':' Notice'):(lang==='hi'?' सूचनाएं':' Notices'));
  }
  list.innerHTML=notices.map(n=>{
    const date=n['date_'+lang]||n.date_en||'';
    const text=(lang==='hi'?(n._html_hi||n['html_hi']||n['text_hi']||''):'')||(n['html_'+lang]||n.html_en||n.html||n['text_'+lang]||n.text_en||'');
    const pdfLabel=n['pdfLabel_'+lang]||n.pdfLabel_en||'Download Notice';
    return `<div class="notice-item">
      <div class="notice-item-dot"></div>
      <div class="notice-item-content">
        ${date?`<div class="notice-item-date">${date}</div>`:''}
        <div class="notice-item-text">${text}</div>
        ${n.pdfUrl?`<a class="notice-pdf-btn" href="${n.pdfUrl}" download>
          <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          ${pdfLabel}
        </a>`:''}
      </div>
    </div>`;
  }).join('');
}

function renderNotices(){
  _buildNoticeHTML(NOTICES,S_noticeLang,'noticeBadge','noticeList');
}

async function renderNoticesPage(){
  // Show loading skeleton while fetching
  const list=document.getElementById('noticeListPage');
  if(list&&!NOTICES.length){
    list.innerHTML=`<div style="padding:28px;text-align:center;color:var(--text3);font-size:13px">
      <div class="loader-ring" style="width:24px;height:24px;border-width:3px;margin:0 auto 10px"></div>
      Loading notices…
    </div>`;
  }
  const tbody=document.getElementById('meetingsBody');
  if(tbody&&!MEETINGS_DATA.length){
    tbody.innerHTML=`<tr><td colspan="4" style="text-align:center;padding:28px;color:var(--text3)">Loading meetings…</td></tr>`;
  }

  // Fetch in parallel if not already loaded
  const fetches=[];
  if(!NOTICES.length)fetches.push(loadNotices());
  if(!MEETINGS_DATA.length)fetches.push(loadMeetings());
  if(fetches.length)await Promise.all(fetches);

  _buildNoticeHTML(NOTICES,S_noticeLangPage,'noticeBadgePage','noticeListPage');
  renderMeetingsTable();
}

// ── MEETINGS TABLE WITH PAGINATION ──
let S_meetingsPage=1;
let S_meetingsRowsPerPage=10;

function meetingsChangeRows(){
  const sel=document.getElementById('meetingsRowsPerPage');
  if(sel)S_meetingsRowsPerPage=parseInt(sel.value)||10;
  S_meetingsPage=1;
  renderMeetingsTable();
}

function renderMeetingsTable(){
  const tbody=document.getElementById('meetingsBody');
  const pag=document.getElementById('meetingsPagination');
  const mobileCards=document.getElementById('meetingsMobileCards');
  const mobilePag=document.getElementById('meetingsMobilePagination');
  if(!tbody)return;
  const total=MEETINGS_DATA.length;
  const totalPages=Math.max(1,Math.ceil(total/S_meetingsRowsPerPage));
  if(S_meetingsPage>totalPages)S_meetingsPage=totalPages;
  const start=(S_meetingsPage-1)*S_meetingsRowsPerPage;
  const slice=MEETINGS_DATA.slice(start,start+S_meetingsRowsPerPage);

  if(!total){
    tbody.innerHTML=`<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:28px">No meeting records found.</td></tr>`;
    if(pag)pag.innerHTML='';
    if(mobileCards)mobileCards.innerHTML=`<div style="text-align:center;padding:28px;color:var(--text3);font-size:13px">No meeting records found.</div>`;
    if(mobilePag)mobilePag.innerHTML='';
    return;
  }

  // Desktop table rows
  tbody.innerHTML=slice.map((m,i)=>{
    const rowNum=start+i+1;
    return `<tr>
      <td style="color:var(--text3);font-family:'Fira Code',monospace;font-size:11px">${rowNum}</td>
      <td style="white-space:nowrap;font-weight:600">${m.date}</td>
      <td>${m.subject}</td>
      <td style="text-align:center">
        ${m.momUrl
          ?`<a href="${m.momUrl}" target="_blank" rel="noopener" class="mom-download-btn">
              <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Download MOM
            </a>`
          :`<span style="color:var(--text3);font-size:11px">—</span>`
        }
      </td>
    </tr>`;
  }).join('');

  // Mobile cards
  if(mobileCards){
    mobileCards.innerHTML=slice.map((m,i)=>{
      const rowNum=start+i+1;
      return `<div class="meeting-card">
        <div class="meeting-card-top">
          <span class="meeting-card-num">#${rowNum}</span>
          <span class="meeting-card-date">${m.date}</span>
        </div>
        <div class="meeting-card-subject">${m.subject}</div>
        <div class="meeting-card-footer">
          ${m.momUrl
            ?`<a href="${m.momUrl}" target="_blank" rel="noopener" class="mom-download-btn">
                <svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download MOM
              </a>`
            :`<span style="color:var(--text3);font-size:12px">No MOM available</span>`
          }
        </div>
      </div>`;
    }).join('');
  }

  // Build shared pagination HTML
  function buildPagHTML(prefix){
    let btns='';
    btns+=`<button class="page-btn" onclick="meetingsGoPage(${S_meetingsPage-1})" ${S_meetingsPage===1?'disabled':''}>‹ Prev</button>`;
    const range=[];
    for(let p=1;p<=totalPages;p++){
      if(p===1||p===totalPages||Math.abs(p-S_meetingsPage)<=2)range.push(p);
      else if(range[range.length-1]!=='…')range.push('…');
    }
    range.forEach(p=>{
      if(p==='…'){btns+=`<span style="padding:6px 4px;color:var(--text3)">…</span>`;}
      else{btns+=`<button class="page-btn${p===S_meetingsPage?' active':''}" onclick="meetingsGoPage(${p})">${p}</button>`;}
    });
    btns+=`<button class="page-btn" onclick="meetingsGoPage(${S_meetingsPage+1})" ${S_meetingsPage===totalPages?'disabled':''}>Next ›</button>`;
    const showing=`Showing ${start+1}–${Math.min(start+S_meetingsRowsPerPage,total)} of ${total} meeting${total!==1?'s':''}`;
    return `<span>${showing}</span><div class="page-btns">${btns}</div>`;
  }

  if(pag)pag.innerHTML=buildPagHTML('desk');
  if(mobilePag)mobilePag.innerHTML=buildPagHTML('mob');
}

function meetingsGoPage(p){
  const total=MEETINGS_DATA.length;
  const totalPages=Math.max(1,Math.ceil(total/S_meetingsRowsPerPage));
  S_meetingsPage=Math.max(1,Math.min(p,totalPages));
  renderMeetingsTable();
}

// ── THEME ──
function toggleTheme(){
  const isLight=document.body.classList.toggle('light-theme');
  localStorage.setItem('mig_theme',isLight?'light':'dark');
  updateChartTheme(isLight);
}

function updateChartTheme(isLight){
  if(isLight){
    CD.grid='rgba(30,50,90,.09)';
    CD.tick.color='#6b80a0';
    CD.tooltip.backgroundColor='#ffffff';
    CD.tooltip.borderColor='rgba(30,50,90,.13)';
    CD.tooltip.titleColor='#111d30';
    CD.tooltip.bodyColor='#3b526e';
  } else {
    CD.grid='rgba(255,255,255,.07)';
    CD.tick.color='#56647e';
    CD.tooltip.backgroundColor='#1e2333';
    CD.tooltip.borderColor='rgba(255,255,255,.11)';
    CD.tooltip.titleColor='#e8edf7';
    CD.tooltip.bodyColor='#94a3c0';
  }
  if(document.body.dataset.page==='dashboard'){
    if(S.payMatrixCache&&Object.keys(S.payMatrixCache).length){updateDashboard();}
    else if(S.expenseData){const e2=admBuildExpenseEntries();admRenderExpenseChart(e2);admRenderRecentExpenses(e2);}
  }
}

// Apply saved theme on load — Light is default
(function(){
  const saved=localStorage.getItem('mig_theme');
  if(saved==='dark'){
    // User explicitly chose dark; leave body without light-theme class
    updateChartTheme(false);
  } else {
    // Default: light mode (covers saved==='light' and first-time visitors)
    document.body.classList.add('light-theme');
    updateChartTheme(true);
  }
})();

// ── BOOT ──
bootPage();
// Load notices in background and render once ready
(async()=>{
  await loadNotices();
  renderNotices();
})();

// ── VISITOR COUNTER (free, no-auth CountAPI-style service) ──
// Increments a shared counter once per page load and displays the running
// total in the sidebar footer. Best-effort only — if the service is
// unreachable the label is simply left blank rather than blocking the UI.
(async()=>{
  const el=document.getElementById('sidebarVisitCount');
  if(!el)return;
  try{
    const r=await fetch('https://countapi.mileshilliard.com/api/v1/hit/mig-society-sector29-dashboard');
    const d=await r.json();
    if(d&&typeof d.value!=='undefined')el.textContent=Number(d.value).toLocaleString();
    else el.textContent='—';
  }catch(e){
    console.warn('Visitor counter unavailable:',e);
    el.textContent='—';
  }
})();
