/* ════════════════════════════════════════════════════════════════
   utils.js — shared helpers used by every page, so a fix here fixes
   every page at once instead of needing 10 separate edits.

   This is Phase 1 of the de-duplication work flagged in the
   production-readiness audit: `escapeHtml` used to exist in only 2 of
   10 pages (a real stored-XSS gap), and `fetchCsv` / toast / pagination
   were each re-implemented slightly differently per page. Everything
   below is additive — no page's existing local functions were removed,
   so nothing breaks if a page hasn't been switched over to `Utils.*`
   yet. Migrating each page's local duplicate to call these instead is
   the Phase 2 follow-up.

   Include this BEFORE auth.js/sidebar.js and before any page script
   that uses it:

     <script src="utils.js"></script>
     <script src="auth.js"></script>
     <script src="sidebar.js"></script>

   Everything is namespaced under window.Utils so it can't collide with
   a page's own globals (e.g. a page-local `escapeHtml` still works
   fine sitting next to `Utils.escapeHtml`).
   ════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── escapeHtml ──
     The fix for the stored-XSS gap: any sheet-sourced free text
     (remarks, resident names, notes) MUST go through this before being
     placed in an innerHTML template — including inside attributes like
     title="...". */
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  /* ── CSV cache ──
     Reliable caching for the small, fixed set of Google Sheets this app
     reads from — designed so a cache hit is fast AND correct, not just
     fast:

       1. TTL (from config.js's cache.csvTtlMs) is a SAFETY NET, not the
          primary mechanism — it only matters for changes made outside
          this app (someone editing the Sheet directly). Within the TTL
          window, a read is served from cache with zero network calls.
       2. The PRIMARY mechanism is explicit invalidation: every page that
          writes (payments.html, owner-tenant.html, vehicles.html,
          fund-ledger.html, flat-search.html) calls
          Utils.invalidateCsvCache(sheetId, tab) the moment its write
          succeeds, so a user always sees their own change immediately —
          never a "fast but stale" read.
       3. localStorage (not sessionStorage) means the cache is shared
          across every open tab for free. A write in one tab evicts the
          entry there; the next load in any OTHER tab (not a live push —
          just its next fetch) gets fresh data too, with no extra wiring.
       4. Fails open: if localStorage is full, disabled, or throws for any
          reason, caching is silently skipped and every read just goes to
          the network like it always did — caching must never be the
          reason a read fails.
       5. Concurrent callers asking for the same sheet+tab at the same
          moment (e.g. two dashboard widgets on one page) collapse into
          one network call instead of two. */
  const CSV_CACHE_PREFIX = "sp-csv-cache:";
  const csvInFlight = new Map();

  function csvCacheTtlMs() {
    return window.CONFIG?.cache?.csvTtlMs ?? 60 * 1000; // fail-safe default if config.js isn't loaded
  }

  function csvCacheKey(sheetId, tab) { return `${CSV_CACHE_PREFIX}${sheetId}::${tab}`; }

  function readCsvCache(sheetId, tab) {
    try {
      const raw = localStorage.getItem(csvCacheKey(sheetId, tab));
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (typeof data !== "string") return null;
      return { data, age: Date.now() - ts };
    } catch { return null; }
  }

  function writeCsvCache(sheetId, tab, data) {
    try {
      localStorage.setItem(csvCacheKey(sheetId, tab), JSON.stringify({ data, ts: Date.now() }));
    } catch { /* storage full/blocked — caching is best-effort, never fatal */ }
  }

  /* Evict one sheet+tab's cached entry — call this the moment a write to
     that tab succeeds. */
  function invalidateCsvCache(sheetId, tab) {
    try { localStorage.removeItem(csvCacheKey(sheetId, tab)); } catch {}
  }

  /* Evict every cached sheet+tab — this is what each page's "Refresh"
     button should call before re-running its normal load function, so
     Refresh always means "guaranteed fresh," not "fresh unless the TTL
     hasn't expired yet." */
  function clearAllCsvCache() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(CSV_CACHE_PREFIX))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  /* ── JSONP helper ──
     Apps Script Web Apps don't reliably support fetch()-with-custom-
     headers cross-origin, so — matching the exact pattern every write
     in this app already uses — reads go out as a <script src="..."> tag
     with a callback param, sidestepping CORS entirely. The idToken rides
     along as a URL query param here too, same as it already does for
     every write; that's a known, already-flagged characteristic of this
     app's JSONP approach (see the security audit notes), not something
     new introduced by moving reads onto this same mechanism. */
  let jsonpSeq = 0;
  function jsonpRequest(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const cbName = `__sp_jsonp_${Date.now()}_${jsonpSeq++}`;
      const script = document.createElement("script");
      let settled = false;
      let timer;
      const cleanup = () => {
        delete window[cbName];
        script.remove();
        clearTimeout(timer);
      };
      window[cbName] = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data);
      };
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Request timed out"));
      }, timeoutMs);
      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("Network error"));
      };
      script.src = `${url}${url.includes("?") ? "&" : "?"}callback=${cbName}`;
      document.head.appendChild(script);
    });
  }

  /* ── doFetchCsv ──
     Reads now go through the same authenticated Apps Script endpoint
     writes already use (guard-payment-write-apps-script.gs's
     handleReadRequest), instead of Google's PUBLIC gviz/export CSV URLs.
     That public-URL approach meant anyone with a sheet's URL — signed in
     through this app's login or not — could read every resident's phone
     number, every payment record, every emergency contact, regardless of
     what auth.js enforced at the page level. The backend now verifies
     the same Google idToken every write verifies, checks it against
     ALLOWED_USERS, AND only serves sheet+tab combinations on its own
     server-side allow-list (READABLE_SHEET_IDS) — never an arbitrary
     sheetId a caller might pass.

     This is NOT a purely client-side change: the underlying Google
     Sheets must ALSO be switched from "Anyone with the link" to
     Restricted sharing for this fix to be complete — Apps Script reads
     them via the script owner's own access, so they don't need to be
     public anymore. Until that sharing setting is changed, the old
     public URLs would still work for anyone who already has them
     bookmarked, even though this app no longer calls them itself. */
  async function doFetchCsv(sheetId, tab) {
    const readUrl = window.CONFIG?.appsScript?.read;
    if (!readUrl) return ""; // config.js not loaded — fail safe, not fail open
    const idToken = window.Auth?.getIdToken?.();
    if (!idToken) return ""; // not signed in; auth.js will already be redirecting to login.html

    try {
      const params = new URLSearchParams({ action: "read", sheetId, tab, idToken });
      const result = await jsonpRequest(`${readUrl}?${params.toString()}`);
      if (!result || !result.ok) return "";
      return typeof result.csv === "string" ? result.csv : "";
    } catch {
      return "";
    }
  }

  /* ── fetchCsv ──
     Fetches a sheet+tab as CSV text via the authenticated backend
     endpoint (see doFetchCsv above) — requires the caller to already be
     signed in (auth.js guarantees this on every real page). Returns ""
     (not a throw) on total failure — unauthorized, network error, or an
     unrecognized sheet/tab — so callers can render an empty state
     instead of an unhandled rejection.

     Cache-aware (see CSV cache block above). Pass {forceRefresh:true} to
     bypass the cache entirely — this is what a page's "Refresh" button
     should do via clearAllCsvCache(), or what a caller can do per-call if
     it specifically needs the network truth (e.g. right before opening
     an edit form, to avoid clobbering someone else's concurrent edit
     with stale data). */
  async function fetchCsv(sheetId, tab, { forceRefresh = false } = {}) {
    if (!forceRefresh) {
      const cached = readCsvCache(sheetId, tab);
      if (cached && cached.age < csvCacheTtlMs()) return cached.data;
    }

    const key = `${sheetId}::${tab}`;
    if (!forceRefresh && csvInFlight.has(key)) return csvInFlight.get(key);

    const p = doFetchCsv(sheetId, tab).then(data => {
      csvInFlight.delete(key);
      if (data) writeCsvCache(sheetId, tab, data);
      // On total network failure, fall back to whatever's cached — even
      // past its TTL — rather than showing an empty page. Stale-but-real
      // data beats no data when the network itself is the problem.
      if (!data) {
        const stale = readCsvCache(sheetId, tab);
        if (stale) return stale.data;
      }
      return data;
    });
    csvInFlight.set(key, p);
    return p;
  }

  /* ── parseCSV ──
     Full multi-row CSV parser (handles quoted fields, embedded commas,
     escaped "" quotes, and quoted fields that contain a literal
     newline) — a few pages' hand-rolled single-line regex parsers don't
     handle that last case. Returns an array of row arrays. */
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    const s = String(text ?? "").replace(/\r\n/g, "\n");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n") {
        row.push(field); rows.push(row); row = []; field = "";
      } else {
        field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ""));
  }

  /* ── showToast ──
     Self-contained toast notification — creates its own stack element
     and injects its own (scoped, `sp-toast-*` prefixed) styles the
     first time it's called, so it works on a page with zero existing
     toast markup (this is what owner-tenant.html and
     payment-history.html now use instead of alert()). */
  let toastCssInjected = false;
  function ensureToastStyles() {
    if (toastCssInjected) return;
    toastCssInjected = true;
    const style = document.createElement("style");
    style.textContent = `
      #sp-toast-stack{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
        z-index:99999;display:flex;flex-direction:column;gap:8px;align-items:center;
        pointer-events:none;width:100%;padding:0 16px}
      .sp-toast{pointer-events:auto;display:flex;align-items:center;gap:8px;
        max-width:420px;padding:11px 16px;border-radius:11px;font:600 0.83rem/1.35 'DM Sans',sans-serif;
        color:#fff;box-shadow:0 12px 28px rgba(15,23,42,0.22);
        opacity:0;transform:translateY(10px);transition:opacity .2s ease,transform .2s ease}
      .sp-toast.show{opacity:1;transform:translateY(0)}
      .sp-toast-success{background:linear-gradient(135deg,#059669,#047857)}
      .sp-toast-error{background:linear-gradient(135deg,#dc2626,#b91c1c)}
      .sp-toast-icon{flex:0 0 auto;display:flex}
      @media(max-width:640px){#sp-toast-stack{bottom:16px}.sp-toast{max-width:none}}
    `;
    document.head.appendChild(style);
  }
  function toastStack() {
    let stack = document.getElementById("sp-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "sp-toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }
  function showToast(message, type = "success", duration = 3200) {
    ensureToastStyles();
    const stack = toastStack();
    const toast = document.createElement("div");
    toast.className = `sp-toast sp-toast-${type === "error" ? "error" : "success"}`;
    const icon = type === "error"
      ? `<svg class="sp-toast-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="5" x2="8" y2="8.5"/><circle cx="8" cy="11" r="0.6" fill="currentColor"/></svg>`
      : `<svg class="sp-toast-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,8.5 6.5,12 13,4"/></svg>`;
    toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
    stack.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("show"));
    const remove = () => { toast.classList.remove("show"); setTimeout(() => toast.remove(), 220); };
    setTimeout(remove, duration);
    return remove; // caller can dismiss early if needed
  }

  /* ── renderPagination ──
     Same markup/classes (`pag-btn`, `pag-info`, `mob-pag-btn`, …) the
     four pages that already had pagination were using, so it drops in
     using the CSS already shipped for those and now centralized in
     styles.css. Renders into a desktop container and (optionally) a
     mobile container, and wires click handlers itself — the caller
     just supplies current page / page size / total and a callback.

     Usage:
       Utils.renderPagination({
         total: filteredRows.length, page: currentPage, pageSize: PAGE_SIZE,
         deskId: "deskPagination", mobId: "mobPagination",
         onChange: (p) => { currentPage = p; renderAll(); }
       }); */
  function renderPagination({ total, page, pageSize, deskId, mobId, onChange, noun = "entries" }) {
    const dp = deskId && document.getElementById(deskId);
    const mp = mobId && document.getElementById(mobId);
    const tp = Math.max(1, Math.ceil(total / pageSize));
    const cur = Math.min(Math.max(1, page), tp);

    if (total <= pageSize) {
      if (dp) dp.innerHTML = "";
      if (mp) mp.style.display = "none";
      return cur;
    }

    const start = (cur - 1) * pageSize + 1;
    const end = Math.min(cur * pageSize, total);
    const infoTxt = `${start}–${end} of ${total} ${noun}`;

    const maxVisible = 5;
    let startPg = Math.max(1, cur - Math.floor(maxVisible / 2));
    let endPg = Math.min(tp, startPg + maxVisible - 1);
    if (endPg - startPg < maxVisible - 1) startPg = Math.max(1, endPg - maxVisible + 1);
    let pageBtns = "";
    for (let p = startPg; p <= endPg; p++) {
      pageBtns += `<button class="pag-btn${p === cur ? " active" : ""}" data-page="${p}" type="button">${p}</button>`;
    }

    if (dp) {
      dp.innerHTML = `
        <span class="pag-info">${infoTxt}</span>
        <div class="pag-btns">
          <button class="pag-btn" data-page="${cur - 1}" type="button" ${cur <= 1 ? "disabled" : ""}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="7,1 3,5 7,9"/></svg>
            Prev
          </button>
          ${pageBtns}
          <button class="pag-btn" data-page="${cur + 1}" type="button" ${cur >= tp ? "disabled" : ""}>
            Next
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><polyline points="3,1 7,5 3,9"/></svg>
          </button>
        </div>`;
      dp.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
          const p = Number(btn.dataset.page);
          if (p >= 1 && p <= tp) onChange(p);
        });
      });
    }

    if (mp) {
      mp.style.display = "flex";
      mp.innerHTML = `
        <span class="mob-pag-info">${infoTxt}</span>
        <div class="mob-pag-btns">
          <button class="mob-pag-btn" data-page="${cur - 1}" type="button" ${cur <= 1 ? "disabled" : ""}>← Prev</button>
          <button class="mob-pag-btn" data-page="${cur + 1}" type="button" ${cur >= tp ? "disabled" : ""}>Next →</button>
        </div>`;
      mp.querySelectorAll("[data-page]").forEach(btn => {
        btn.addEventListener("click", () => {
          const p = Number(btn.dataset.page);
          if (p >= 1 && p <= tp) onChange(p);
        });
      });
    }

    return cur;
  }

  /* ── parseCSVLine ──
     Parses ONE already-split CSV line into fields (quoted-comma-safe).
     This is the exact regex-based parser five pages (index.html,
     fund-ledger.html, payment-history.html, payments-overview.html,
     vehicles.html) each had their own byte-identical copy of — and the
     CORRECT version of a regex owner-tenant.html had a subtly different,
     buggy copy of (its version split unquoted fields on any whitespace,
     not just commas, silently corrupting any unquoted field containing a
     space — e.g. a resident's name). Swapping every page over to this
     one fixes that latent bug as a side effect of removing the
     duplication. */
  function parseCSVLine(line) {
    // Was previously a regex — /(".*?"|[^",\n]+)(?=\s*,|\s*$)/g — which only
    // matches fields with at least one character. Any genuinely empty cell
    // (very common for Received By / Remarks on real payment rows) produced
    // NO match at all instead of "", so the field vanished from the result
    // array rather than appearing as an empty string — silently shifting
    // every later field one position to the left. That's what caused
    // Received By / Remarks / Paid Months to read each other's data
    // whenever an earlier cell in the row was blank. This version walks
    // the string and pushes a field at every comma, so empty cells are
    // preserved as "" and column positions never drift.
    const s = String(line ?? "");
    const row = [];
    let field = "", inQuotes = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field.trim()); field = "";
      } else {
        field += c;
      }
    }
    row.push(field.trim());
    return row;
  }

  /* ── splitCSVRows ──
     Splits a full CSV text blob into an array of row-strings, respecting
     quoted fields that contain a literal newline (so a multi-line address
     in a quoted cell doesn't get cut into two rows). Pairs with
     parseCSVLine() above — this is the exact pattern flat-search.html,
     payments.html, and payment-verification.html each hand-rolled their
     own copy of as `parseCSVRows` + `parseCSV(line)`. */
  function splitCSVRows(csv) {
    const rows = [];
    let cur = "", inQ = false;
    const s = String(csv ?? "");
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '"' && s[i + 1] === '"') { cur += c + s[i + 1]; i++; }
      else if (c === '"') { inQ = !inQ; cur += c; }
      else if ((c === "\n" || c === "\r") && !inQ) {
        if (c === "\r" && s[i + 1] === "\n") i++;
        if (cur.trim()) rows.push(cur);
        cur = "";
      } else cur += c;
    }
    if (cur.trim()) rows.push(cur);
    return rows;
  }

  window.Utils = {
    escapeHtml, fetchCsv, parseCSV, parseCSVLine, splitCSVRows,
    invalidateCsvCache, clearAllCsvCache,
    showToast, renderPagination,
  };
})();
