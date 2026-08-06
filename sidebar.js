/* ════════════════════════════════════════════════════════════════
   sidebar.js — single source of truth for the primary (desktop) and
   mobile-drawer navigation, shared by every page.

   Why this exists: each page used to carry its own hand-copied
   sidebar markup, which had drifted out of sync (different labels,
   a missing badge, mismatched section headings, etc). Now every
   page just holds an empty placeholder —

     <aside class="sidebar" id="sidebar" aria-label="Primary navigation"></aside>
     <aside class="mob-drawer" id="mobDrawer" aria-label="Mobile navigation"></aside>

   — and this file fills both in, marking whichever link matches the
   current filename as active.

   Adding / renaming / reordering a page? Edit NAV_ITEMS below once;
   every page picks it up automatically. No other file needs to
   change.

   Load order matters: include this script right after the two
   <aside> placeholders (near the top of <body>), BEFORE each page's
   own script, since that script binds click handlers (sidebarToggle,
   logoutDesk, drawerLogoutBtn, badge counters, etc.) to elements
   this file creates.
   ════════════════════════════════════════════════════════════════ */
(function(){

  const NAV_ITEMS=[
    { href:"index.html",             label:"Dashboard",    tooltip:"Dashboard",       section:"Main",
      icon:'<rect x="2" y="2" width="7" height="7" rx="1.5"/><rect x="11" y="2" width="7" height="7" rx="1.5"/><rect x="2" y="11" width="7" height="7" rx="1.5"/><rect x="11" y="11" width="7" height="7" rx="1.5"/>' },
    { href:"payments.html",          label:"Payments",     tooltip:"Payments",
      icon:'<rect x="2" y="4" width="16" height="13" rx="2"/><line x1="2" y1="9" x2="18" y2="9"/><line x1="6" y1="14" x2="8" y2="14"/>' },
    { href:"payment-history.html",   label:"History",      tooltip:"Payment History",
      icon:'<rect x="2" y="4" width="16" height="13" rx="2"/><line x1="2" y1="9" x2="18" y2="9"/><line x1="6" y1="14" x2="8" y2="14"/>' },
    { href:"fund-ledger.html",       label:"Fund Ledger",  tooltip:"Fund Ledger",
      icon:'<path d="M3 6h14M3 10h14M3 14h14"/><path d="M7 3.5L5.5 16.5M14.5 3.5L13 16.5"/>' },
    { href:"flat-search.html",       label:"Flat Search",  tooltip:"Flat Search",
      icon:'<circle cx="9" cy="9" r="6"/><path d="M20 20l-4.35-4.35"/>' },
    { href:"owner-tenant.html",      label:"Residents",    tooltip:"Residents",  section:"Directory", badge:"Residents",
      icon:'<circle cx="7" cy="6" r="3.5"/><path d="M1 18c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="16" cy="6" r="2.5"/><path d="M18.5 18c0-2.5-1.5-4.5-4-5"/>' },
    { href:"vehicles.html",          label:"Vehicles",     tooltip:"Vehicles",   badge:"Vehicles",
      icon:'<circle cx="5" cy="14" r="2.5"/><circle cx="15" cy="14" r="2.5"/><path d="M2.5 14H1V9l3-5h8l2 3.5H17a1.5 1.5 0 0 1 1.5 1.5V14h-2"/><path d="M7.5 4.5L5.5 9H13"/>' },
    { href:"emergency-contact.html", label:"Emergency",    tooltip:"Emergency",  badge:"Emergency",
      icon:'<circle cx="10" cy="10" r="8"/><line x1="10" y1="7" x2="10" y2="10.5"/><circle cx="10" cy="13.5" r="0.6" fill="currentColor"/>' }
  ];

  const LOGO_SVG   ='<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="8" width="16" height="11" rx="2"/><path d="M6 8V6a4 4 0 0 1 8 0v2"/></svg>';
  const TOGGLE_SVG ='<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="8,2 4,6 8,10"/></svg>';
  const LOGOUT_SVG ='<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3"/><polyline points="10,11 13,8 10,5"/><line x1="13" y1="8" x2="5" y2="8"/></svg>';

  function normalizePageName(value){
    const raw = String(value||"").toLowerCase();
    const stripped = raw.replace(/[#?].*$/g,"").replace(/^.*\//g,"").replace(/\.html$/g,"");
    return stripped || "index";
  }

  function currentPage(){
    const file = location.pathname.split("/").pop() || "index.html";
    return normalizePageName(file);
  }

  function svgIcon(pathData){
    return`<svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${pathData}</svg>`;
  }

  // drawer=true renders the compact mobile-drawer flavor: no data-tooltip
  // (tooltips are a hover-only affordance, meaningless on touch), and
  // badge ids get a "drawerNav" prefix instead of "nav" so both the
  // desktop and drawer copies of a badge can be updated independently.
  function navLinksHtml(active,drawer){
    let html="",lastSection=null;
    NAV_ITEMS.forEach(item=>{
      if(item.section && item.section!==lastSection){
        html+=`<div class="sb-section-label">${item.section}</div>`;
        lastSection=item.section;
      }
      const itemName = normalizePageName(item.href);
      const isActive = itemName === active;
      const tooltip = drawer ? "" : ` data-tooltip="${item.tooltip}"`;
      const badge = item.badge ? `<span class="sb-badge" id="${drawer?"drawerNav":"nav"}${item.badge}">0</span>` : "";
      html += `<a class="sb-item${isActive?" active":""}" href="${item.href}"${tooltip}>`
          +`<div class="sb-icon">${svgIcon(item.icon)}</div>`
          +`<span class="sb-label">${item.label}</span>${badge}`
          +`</a>`;
    });
    return html;
  }

  function brandHtml(tag){
    return`<div class="sb-brand">`
        +`<div class="sb-logo">${LOGO_SVG}</div>`
        +`<div class="sb-copy"><div class="sb-name">MIG Society</div><div class="sb-tag">${tag}</div></div>`
        +`</div>`;
  }

  function footerHtml(userId){
    return`<div class="sb-footer">`
        +`<div class="sb-user" id="${userId}">`
        +`<div class="sb-avatar">A</div>`
        +`<div class="sb-user-info"><div class="sb-user-name">Admin</div><div class="sb-user-role">Society Manager</div></div>`
        +`<div class="sb-logout" title="Logout">${LOGOUT_SVG}</div>`
        +`</div></div>`;
  }

  function desktopSidebarHtml(active){
    return brandHtml("Sector-29 · Admin Panel")
        +`<button class="sb-toggle" id="sidebarToggle" aria-label="Toggle sidebar" type="button">${TOGGLE_SVG}</button>`
        +`<nav class="sb-nav">${navLinksHtml(active,false)}</nav>`
        +footerHtml("logoutDesk");
  }

  function drawerHtml(active){
    return brandHtml("Sector-29 · Admin")
        +`<nav class="sb-nav">${navLinksHtml(active,true)}</nav>`
        +footerHtml("drawerLogoutBtn");
  }

  function inject(){
    const active=currentPage();
    const sidebar=document.getElementById("sidebar");
    if(sidebar)sidebar.innerHTML=desktopSidebarHtml(active);
    const drawer=document.getElementById("mobDrawer");
    if(drawer)drawer.innerHTML=drawerHtml(active);
  }

  inject();
})();
