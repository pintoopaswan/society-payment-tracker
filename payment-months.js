/* ═══════════════════════════════════════════════════════════════════════
   payment-months.js
   Shared Month-Year ("YYYY-MM") payment coverage utilities.

   Loaded by BOTH flat-search.html and payments.html so the "which months
   has this flat already paid" logic lives in exactly one place instead of
   being duplicated (and drifting out of sync) across the two pages.

   WHY "YYYY-MM" AND NOT BARE MONTH NAMES:
   The payment sheets used to store paid months as bare names ("NOV","DEC",
   "JAN") with no year. That made it impossible to tell "Nov 2025" apart
   from "Nov 2026" — a January-2026 payment that settled Nov+Dec 2025 and
   Jan 2026 would incorrectly appear to also cover Nov/Dec *2026*, since
   only the month name was ever compared. Every function below works in
   terms of canonical "YYYY-MM" keys so coverage is always checked against
   an exact calendar month, never just a month name.

   BACKWARD COMPATIBILITY:
   Old sheet rows only ever recorded bare month names. parseField()/
   parseToken() still read those correctly by inferring the year from the
   context (the sheet tab a row lives in — its own year + month index),
   using the month closest to that context. Any row saved by the app going
   forward is written back out as explicit "YYYY-MM" keys (see
   buildStorageString), so the inference step is only ever needed for
   legacy data — new data is fully self-describing and never needs it.
═══════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var MONTH_FULL = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
  var MONTH_SHORT = ["JAN","FEB","MAR","APR","MAY","JUNE","JULY","AUG","SEP","OCT","NOV","DEC"];
  var MONTH_DISPLAY = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  function pad2(n) { n = Number(n); return (n < 10 ? "0" : "") + n; }

  /* year (number|string) + 0-based monthIndex → "YYYY-MM", or "" if invalid */
  function toKey(year, monthIndex) {
    var y = Number(year), mi = Number(monthIndex);
    if (!Number.isFinite(y) || !Number.isFinite(mi) || mi < 0 || mi > 11 || y < 1000) return "";
    return y + "-" + pad2(mi + 1);
  }

  /* "YYYY-MM" → {year, monthIndex} or null */
  function parseKey(key) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(key || "").trim());
    if (!m) return null;
    var monthIndex = Number(m[2]) - 1;
    if (monthIndex < 0 || monthIndex > 11) return null;
    return { year: Number(m[1]), monthIndex: monthIndex };
  }

  /* "YYYY-MM" → "Nov 2025" (short=true, default) or "November 2025" */
  function label(key, short) {
    var p = parseKey(key);
    if (!p) return String(key || "");
    var names = short === false ? MONTH_FULL : MONTH_DISPLAY;
    return names[p.monthIndex] + " " + p.year;
  }

  /* Fuzzy month-name → 0-based index, matching full or short forms either way. */
  function monthNameIndex(token) {
    var raw = String(token || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    if (!raw) return -1;
    for (var i = 0; i < MONTH_FULL.length; i++) {
      var full = MONTH_FULL[i], short = MONTH_SHORT[i];
      if (raw === full || raw === short || full.indexOf(raw) === 0 || short.indexOf(raw) === 0) return i;
    }
    return -1;
  }

  /* Distance-minimizing year inference for a bare (year-less) legacy month
     token, anchored on a context year/month (typically the sheet tab a
     record lives in). Picks whichever of {context-1, context, context+1}
     lands the token nearest the anchor month — so a January anchor infers
     "Nov"/"Dec" tokens as the PREVIOUS year (a catch-up payment covering
     months owed from last year), while a June anchor infers "Jul"/"Aug"
     tokens as the SAME year (an advance payment for upcoming months). */
  function inferYearForBareMonth(monthIndex, contextYear, contextMonthIndex) {
    var cy = Number(contextYear), cm = Number(contextMonthIndex);
    if (!Number.isFinite(cy)) cy = new Date().getFullYear();
    if (!Number.isFinite(cm)) cm = 0;
    var bestYear = cy, bestDist = Infinity;
    [-1, 0, 1].forEach(function (k) {
      var dist = Math.abs((k * 12 + monthIndex) - cm);
      if (dist < bestDist) { bestDist = dist; bestYear = cy + k; }
    });
    return bestYear;
  }

  /* Parse ONE raw token into a canonical "YYYY-MM" key, or "" if unparseable.
     Recognizes (in priority order): "YYYY-MM", "MM/YYYY" or "MM-YYYY",
     "Nov 2025" / "November-2025" / "Nov,2025", "2025 Nov", and finally a
     bare month name/label ("NOV"), whose year is inferred from context. */
  function parseToken(token, contextYear, contextMonthIndex) {
    var raw = String(token || "").trim();
    if (!raw) return "";

    var m = /^(\d{4})-(\d{1,2})$/.exec(raw);
    if (m) { var mi1 = Number(m[2]) - 1; if (mi1 >= 0 && mi1 <= 11) return toKey(m[1], mi1); }

    m = /^(\d{1,2})[\/\-](\d{4})$/.exec(raw);
    if (m) { var mi2 = Number(m[1]) - 1; if (mi2 >= 0 && mi2 <= 11) return toKey(m[2], mi2); }

    m = /^([A-Za-z]+)[\s,\-\/]+(\d{4})$/.exec(raw);
    if (m) { var mi3 = monthNameIndex(m[1]); if (mi3 >= 0) return toKey(m[2], mi3); }

    m = /^(\d{4})[\s,\-\/]+([A-Za-z]+)$/.exec(raw);
    if (m) { var mi4 = monthNameIndex(m[2]); if (mi4 >= 0) return toKey(m[1], mi4); }

    var bareIdx = monthNameIndex(raw);
    if (bareIdx >= 0) return toKey(inferYearForBareMonth(bareIdx, contextYear, contextMonthIndex), bareIdx);

    return "";
  }

  /* Split + parse a raw "paidMonths" cell value into a sorted, de-duplicated
     array of "YYYY-MM" keys. Handles comma/semicolon/pipe/slash/whitespace
     separated lists (old rows are space-joined bare names like "NOV DEC
     JAN"; new rows are comma-joined keys like "2025-11,2025-12,2026-01"). */
  function parseField(raw, contextYear, contextMonthIndex) {
    var str = String(raw || "").trim();
    if (!str) return [];
    var parts = str.split(/[,;|]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    var keys = [];
    parts.forEach(function (p) {
      var whole = parseToken(p, contextYear, contextMonthIndex);
      if (whole) { keys.push(whole); return; }
      p.split(/\s+/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (tok) {
        var k = parseToken(tok, contextYear, contextMonthIndex);
        if (k) keys.push(k);
      });
    });
    return dedupeSorted(keys);
  }

  function dedupeSorted(keys) {
    var out = Array.from(new Set(keys));
    out.sort();
    return out;
  }

  /* Canonical string to persist back to the sheet. */
  function buildStorageString(keys) {
    return dedupeSorted(keys).join(",");
  }

  /* "YYYY-MM" keys → ["Nov 2025", "Dec 2025", …], chronologically sorted. */
  function formatList(keys, short) {
    return dedupeSorted(keys).map(function (k) { return label(k, short); });
  }

  /* Inclusive window of "YYYY-MM" keys running from `back` months before the
     anchor to `fwd` months after it (chronological order). Kept for any
     future anchor-based use; the Add/Update Payment picker itself now uses
     a Year dropdown + Month multi-select instead (see yearOptions/
     yearMonthKeys below). */
  function buildWindow(anchorYear, anchorMonthIndex, back, fwd) {
    back = back == null ? 12 : back;
    fwd = fwd == null ? 2 : fwd;
    var ay = Number(anchorYear), am = Number(anchorMonthIndex);
    var keys = [];
    for (var off = -back; off <= fwd; off++) {
      var total = ay * 12 + am + off;
      var y = Math.floor(total / 12), mi = ((total % 12) + 12) % 12;
      keys.push(toKey(y, mi));
    }
    return keys;
  }

  /* Earliest year selectable in the Year dropdown. The payment sheets don't
     go back further than this, so there's nothing before it to pick. */
  var YEAR_RANGE_START = 2025;

  /* Selectable years for the picker's Year dropdown: YEAR_RANGE_START
     through (current calendar year + 1), so next year's advance payments
     can always be recorded ahead of time. */
  function yearOptions() {
    var end = new Date().getFullYear() + 1;
    var out = [];
    for (var y = YEAR_RANGE_START; y <= end; y++) out.push(y);
    return out;
  }

  /* All 12 "YYYY-MM" keys (Jan–Dec) for one calendar year, in order. */
  function yearMonthKeys(year) {
    var out = [];
    for (var mi = 0; mi < 12; mi++) out.push(toKey(year, mi));
    return out;
  }

  /* ── Guard maintenance fee validation ──────────────────────────────
     The monthly guard maintenance fee is fixed at MONTHLY_FEE. Any
     payment amount must be a positive whole multiple of it, and the
     number of months selected in the picker must exactly equal
     amount / MONTHLY_FEE. Both payments.html and flat-search.html call
     validateAmountMonths() so the rule (and its wording) can't drift
     between the two pages. The backend (guard-payment-write-apps-script.gs)
     re-implements the same check server-side, since Apps Script can't
     import this browser file. */
  var MONTHLY_FEE = 200;

  /* Returns "" when (amount, monthCount) are consistent with the guard
     fee rule, otherwise a user-facing error message. */
  function validateAmountMonths(amount, monthCount) {
    var amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0 || Math.round(amt) !== amt || amt % MONTHLY_FEE !== 0) {
      return "Payment amount must be a multiple of \u20B9" + MONTHLY_FEE + ".";
    }
    var required = amt / MONTHLY_FEE;
    var count = Number(monthCount) || 0;
    if (count !== required) {
      var amtLabel = "\u20B9" + amt.toLocaleString("en-IN");
      var reqWord = required === 1 ? "month" : "months";
      if (count === 0) {
        return "Please select exactly " + required + " " + reqWord + " for a payment of " + amtLabel + ".";
      }
      var countWord = count === 1 ? "month" : "months";
      return "You have selected " + count + " " + countWord + ", but the entered amount covers " + required + " " + reqWord + ".";
    }
    return "";
  }

  global.PaymentMonths = {
    MONTH_FULL: MONTH_FULL,
    MONTH_SHORT: MONTH_SHORT,
    MONTH_DISPLAY: MONTH_DISPLAY,
    toKey: toKey,
    parseKey: parseKey,
    label: label,
    monthNameIndex: monthNameIndex,
    inferYearForBareMonth: inferYearForBareMonth,
    parseToken: parseToken,
    parseField: parseField,
    dedupeSorted: dedupeSorted,
    buildStorageString: buildStorageString,
    formatList: formatList,
    buildWindow: buildWindow,
    YEAR_RANGE_START: YEAR_RANGE_START,
    yearOptions: yearOptions,
    yearMonthKeys: yearMonthKeys,
    MONTHLY_FEE: MONTHLY_FEE,
    validateAmountMonths: validateAmountMonths
  };
})(window);