const ALLOWED_USERS = ["pintoopaswan88@gmail.com", "deveshsahu9143@gmail.com", "mig1.society29@gmail.com","rky07456@gmail.com"];
const PAYMENT_WRITE_SECRET = "MigSocietyPaymentWrite_2026_9xK4pL72Qz";
const SPREADSHEET_ID = "1sPkVonPCAwM_avBVyQuJSSKRkx5wkB1XPHY1KiEulvU";
const DIRECTORY_SPREADSHEET_ID = "15iii2nw4THbf-t-TdYNfj5WW2Aw4selhvfwu64YzisE";
const DIRECTORY_TAB_NAME = "Sheet1";
const VEHICLE_TAB_NAME = "vehicles";
const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const PAID_MONTH_LABELS = ["JAN","FEB","MAR","APR","MAY","JUNE","JULY","AUG","SEP","OCT","NOV","DEC"];
// This spreadsheet (SPREADSHEET_ID) only ever contains tabs for ONE calendar
// year. Legacy "Paid Months" cells only ever stored a bare month name with
// no year (e.g. "NOV"), so when a bare token needs a year inferred, this is
// the anchor year — see inferYearForBareMonth() below.
const PAYMENT_SHEET_YEAR = 2026;

function doGet(e) {
  if (isPingRequest(e)) {
    return handlePingRequest(e);
  }
  // Fund Ledger expense operations
  if (isExpenseRequest(e)) {
    return handleExpenseRequest(e);
  }
  // Vehicle directory operations
  if (isVehicleRequest(e)) {
    return handleVehicleRequest(e);
  }
  if (isApiSaveRequest(e)) {
    return handleApiSaveRequest(e);
  }
  
  if (isApiResidentSaveRequest(e)) {
    return handleApiResidentSaveRequest(e);
  }
  const email = getSignedInEmail();
  if (!isAllowedEmail(email)) {
    return HtmlService
      .createHtmlOutput(getUnauthorizedHtml(email))
      .setTitle("Unauthorized")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService
    .createHtmlOutputFromFile("index")
    .setTitle("MIG Society Guard Payment Dashboard")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function isPingRequest(e) {
  const params = (e && e.parameter) || {};
  return String(params.action || "").toLowerCase() === "ping";
}

function handlePingRequest(e) {
  const params = (e && e.parameter) || {};
  const callback = String(params.callback || "").trim();
  const result = { ok: true, status: "alive", service: "guard-payment-write", time: new Date().toISOString() };
  if (callback && /^[A-Za-z0-9_$.]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(result);
}

function savePaymentFromAdmin(payload) {
  assertAllowedUser();
  return handlePaymentMutation(payload);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || "{}");
    if (payload.secret !== PAYMENT_WRITE_SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }
    const postAction = String(payload.action || "").toLowerCase();
    if (postAction === "saveresident") {
      return jsonResponse(saveResidentPayload(payload));
    }
    if (postAction === "deleteresidentfields") {
      return jsonResponse(deleteResidentFieldsPayload(payload));
    }
    if (postAction === "savevehicle") {
      return jsonResponse(saveVehiclePayload(payload));
    }
    if (postAction === "updatevehicle") {
      return jsonResponse(updateVehiclePayload(payload));
    }
    if (postAction === "deletevehicle") {
      return jsonResponse(deleteVehiclePayload(payload));
    }
    return jsonResponse(handlePaymentMutation(payload));
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function isApiSaveRequest(e) {
  const params = (e && e.parameter) || {};
  return String(params.action || "").toLowerCase() === "savepayment";
}

function isApiResidentSaveRequest(e) {
  const params = (e && e.parameter) || {};
  const action = String(params.action || "").toLowerCase();
  return action === "saveresident" || action === "deleteresidentfields";
}

function handleApiSaveRequest(e) {
  const params = (e && e.parameter) || {};
  const callback = String(params.callback || "").trim();
  const payload = parseApiPayload(params.payload);
  let result;
  try {
    if (payload.secret !== PAYMENT_WRITE_SECRET) {
      result = { ok: false, error: "Unauthorized" };
    } else {
      result = handlePaymentMutation(payload);
    }
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  if (callback && /^[A-Za-z0-9_$.]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(result);
}

function handleApiResidentSaveRequest(e) {
  const params = (e && e.parameter) || {};
  const callback = String(params.callback || "").trim();
  const payload = parseApiPayload(params.payload);
  const action = String(params.action || payload.action || "").toLowerCase();
  let result;
  try {
    if (payload.secret !== PAYMENT_WRITE_SECRET) {
      result = { ok: false, error: "Unauthorized" };
    } else if (action === "deleteresidentfields") {
      result = deleteResidentFieldsPayload(payload);
    } else {
      result = saveResidentPayload(payload);
    }
  } catch (error) {
    result = { ok: false, error: error.message };
  }
  if (callback && /^[A-Za-z0-9_$.]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(result);
}

function parseApiPayload(payloadParam) {
  const raw = String(payloadParam || "").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    return JSON.parse(decodeURIComponent(raw));
  }
}

function handlePaymentMutation(payload) {
  const actionType = String(payload.actionType || "create").trim().toLowerCase();
  if (actionType === "update") return updatePaymentPayload(payload);
  if (actionType === "delete") return deletePaymentPayload(payload);
  return savePaymentPayload(payload);
}

/* ═══════════════════════════════════════════════════════════════════════
   Guard maintenance fee validation — server-side mirror of
   PaymentMonths.validateAmountMonths() in payment-months.js. The frontend
   (payments.html / flat-search.html) already blocks mismatched
   amount/month submissions before they're sent, but that's client-side
   only; this re-checks the same rule here so a malformed or forged
   request can't bypass it and write inconsistent data to the sheet.
   Keep the constant and message wording in sync with payment-months.js
   if either ever changes.
═══════════════════════════════════════════════════════════════════════ */
var MONTHLY_FEE = 200;

function formatIndianAmount_(amt) {
  var s = String(Math.round(amt));
  var lastThree = s.length > 3 ? s.slice(-3) : s;
  var rest = s.length > 3 ? s.slice(0, -3) : "";
  if (rest !== "") lastThree = "," + lastThree;
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
}

function validateAmountMonths_(amount, monthCount) {
  var amt = Number(amount);
  if (!isFinite(amt) || amt <= 0 || Math.round(amt) !== amt || amt % MONTHLY_FEE !== 0) {
    return "Payment amount must be a multiple of \u20B9" + MONTHLY_FEE + ".";
  }
  var required = amt / MONTHLY_FEE;
  var count = Number(monthCount) || 0;
  if (count !== required) {
    var amtLabel = "\u20B9" + formatIndianAmount_(amt);
    var reqWord = required === 1 ? "month" : "months";
    if (count === 0) {
      return "Please select exactly " + required + " " + reqWord + " for a payment of " + amtLabel + ".";
    }
    var countWord = count === 1 ? "month" : "months";
    return "You have selected " + count + " " + countWord + ", but the entered amount covers " + required + " " + reqWord + ".";
  }
  return "";
}

function savePaymentPayload(payload) {
  const sheetName = getSheetNameFromPaymentDate(payload.paymentDateInput);
  if (!sheetName) {
    return { ok: false, error: "Invalid payment date." };
  }
  const contextMonthIndex = MONTHS.indexOf(sheetName);

  const amount = Number(payload.amount || 0);
  if (!payload.block || !payload.flatNo || !amount || amount % 1 !== 0) {
    return { ok: false, error: "Block, flat number, and whole-number amount are required." };
  }

  const submittedPaidMonths = normalizePaidMonths(payload.paidMonths || [], PAYMENT_SHEET_YEAR, contextMonthIndex);
  if (!submittedPaidMonths.length) {
    return { ok: false, error: "Paid months are required." };
  }
  const feeErr = validateAmountMonths_(amount, submittedPaidMonths.length);
  if (feeErr) {
    return { ok: false, error: feeErr };
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    return { ok: false, error: "Missing sheet tab: " + sheetName };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let targetRow = 0;
  try {
    targetRow = findPaymentRow(sheet, payload.block, payload.flatNo);
    if (!targetRow) {
      return {
        ok: false,
        error: "No existing row found for " + payload.block + " / Flat " + payload.flatNo + " in " + sheetName + ".",
      };
    }

    const existingValues = sheet.getRange(targetRow, 3, 1, 7).getValues()[0];
    const existingAmount = Number(existingValues[0] || 0);
    // oneLineRemarks_ also cleans up any \n that made it into older rows
    // before this fix, so legacy line breaks don't keep propagating forward.
    const existingRemarks = oneLineRemarks_(existingValues[5]);
    const existingPaidMonths = normalizePaidMonths(existingValues[6] || "", PAYMENT_SHEET_YEAR, contextMonthIndex);
    const mergedPaidMonths = mergePaidMonths(existingPaidMonths, submittedPaidMonths).join(",");
    const newTotalAmount = existingAmount + amount;
    // NOTE: the client (payments.html / flat-search.html) already builds a
    // complete audit line — "<amount> <MODE> received on <date> | Added by: …" —
    // and sends it as payload.notes. Do NOT also build a server-side audit
    // note here (buildPaymentRemark) on top of it; doing so produced a
    // duplicated, mode-less "<amount> received on <date>" line stacked in
    // front of the client's own note on every Add. The server's only job is
    // to preserve prior remarks and append whatever the client sent — as a
    // single line, never with a line break.
    const submittedNotes = oneLineRemarks_(payload.notes);
    const remarksParts = [];
    if (existingRemarks) remarksParts.push(existingRemarks);
    if (submittedNotes) remarksParts.push(submittedNotes);

    sheet.getRange(targetRow, 3, 1, 7).setValues([[
      newTotalAmount,
      payload.paymentMode || "",
      toSheetDate(payload.paymentDateInput),
      "DONE",
      payload.receivedBy || "",
      remarksParts.join(" | "),
      mergedPaidMonths,
    ]]);
  } finally {
    lock.releaseLock();
  }

  const guardSync = syncGuardPayment(payload.block, payload.flatNo, payload.paymentDateInput, submittedPaidMonths, true);
  return { ok: true, sheetName: sheetName, updatedRow: targetRow, guardSync: guardSync };
}

function updatePaymentPayload(payload) {
  const sheetName = getSheetNameFromPaymentDate(payload.paymentDateInput);
  if (!sheetName) {
    return { ok: false, error: "Invalid payment date." };
  }
  const contextMonthIndex = MONTHS.indexOf(sheetName);

  const amount = Number(payload.amount || 0);
  if (!payload.block || !payload.flatNo || !amount || amount % 1 !== 0) {
    return { ok: false, error: "Block, flat number, and whole-number amount are required." };
  }

  const submittedPaidMonths = normalizePaidMonths(payload.paidMonths || [], PAYMENT_SHEET_YEAR, contextMonthIndex);
  if (!submittedPaidMonths.length) {
    return { ok: false, error: "Paid months are required." };
  }
  const feeErr = validateAmountMonths_(amount, submittedPaidMonths.length);
  if (feeErr) {
    return { ok: false, error: feeErr };
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    return { ok: false, error: "Missing sheet tab: " + sheetName };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let targetRow = 0;
  let previousPaidMonths = [];
  try {
    targetRow = findPaymentRow(sheet, payload.block, payload.flatNo);
    if (!targetRow) {
      return {
        ok: false,
        error: "No existing row found for " + payload.block + " / Flat " + payload.flatNo + " in " + sheetName + ".",
      };
    }

    const previousValues = sheet.getRange(targetRow, 3, 1, 7).getValues()[0];
    previousPaidMonths = normalizePaidMonths(previousValues[6] || "", PAYMENT_SHEET_YEAR, contextMonthIndex);

    const updatedRemarks = oneLineRemarks_(payload.notes);
    sheet.getRange(targetRow, 3, 1, 7).setValues([[
      amount,
      payload.paymentMode || "",
      toSheetDate(payload.paymentDateInput),
      "DONE",
      payload.receivedBy || "",
      updatedRemarks,
      submittedPaidMonths.join(","),
    ]]);
  } finally {
    lock.releaseLock();
  }

  const guardCleared = syncGuardPayment(payload.block, payload.flatNo, payload.paymentDateInput, previousPaidMonths, false);
  const guardSet = syncGuardPayment(payload.block, payload.flatNo, payload.paymentDateInput, submittedPaidMonths, true);
  return { ok: true, sheetName: sheetName, updatedRow: targetRow, actionType: "update", guardSync: { cleared: guardCleared, set: guardSet } };
}

function deletePaymentPayload(payload) {
  const sheetName = getSheetNameFromPaymentDate(payload.paymentDateInput);
  if (!sheetName) {
    return { ok: false, error: "Invalid payment date." };
  }
  if (!payload.block || !payload.flatNo) {
    return { ok: false, error: "Block and flat number are required." };
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    return { ok: false, error: "Missing sheet tab: " + sheetName };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let targetRow = 0;
  let removedPaidMonths = [];
  try {
    targetRow = findPaymentRow(sheet, payload.block, payload.flatNo);
    if (!targetRow) {
      return {
        ok: false,
        error: "No existing row found for " + payload.block + " / Flat " + payload.flatNo + " in " + sheetName + ".",
      };
    }
    const existingValues = sheet.getRange(targetRow, 3, 1, 7).getValues()[0];
    removedPaidMonths = normalizePaidMonths(existingValues[6] || "", PAYMENT_SHEET_YEAR, MONTHS.indexOf(sheetName));
    sheet.getRange(targetRow, 3, 1, 7).clearContent();
  } finally {
    lock.releaseLock();
  }

  const guardSync = syncGuardPayment(payload.block, payload.flatNo, payload.paymentDateInput, removedPaidMonths, false);
  return { ok: true, sheetName: sheetName, updatedRow: targetRow, actionType: "delete", guardSync: guardSync };
}

function saveResidentPayload(payload) {
  const headers = Array.isArray(payload.headers) ? payload.headers.map(function(h) { return String(h || "").trim(); }) : [];
  const rowValues = Array.isArray(payload.rowValues) ? payload.rowValues.map(function(v) { return v === null || v === undefined ? "" : String(v); }) : [];
  if (!headers.length || !rowValues.length || headers.length !== rowValues.length) {
    return { ok: false, error: "Invalid resident row payload." };
  }

  const blockIndex = findHeaderIndex(headers, ["block"]);
  const flatIndex = findHeaderIndex(headers, ["flat", "house", "apartment"]);
  if (blockIndex < 0 || flatIndex < 0) {
    return { ok: false, error: "Block/Flat columns not found in resident data." };
  }

  const block = rowValues[blockIndex];
  const flat = rowValues[flatIndex];
  if (!block || !flat) {
    return { ok: false, error: "Block and Flat are required." };
  }

  const spreadsheet = SpreadsheetApp.openById(DIRECTORY_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(DIRECTORY_TAB_NAME);
  if (!sheet) {
    return { ok: false, error: "Missing resident sheet tab: " + DIRECTORY_TAB_NAME };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let targetRow = 0;
  try {
    targetRow = findResidentRow(sheet, block, flat, blockIndex + 1, flatIndex + 1);
    if (!targetRow) {
      return { ok: false, error: "Resident row not found for " + block + " / Flat " + flat + "." };
    }
    sheet.getRange(targetRow, 1, 1, rowValues.length).setValues([rowValues]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, updatedRow: targetRow, action: "saveResident" };
}

function deleteResidentFieldsPayload(payload) {
  const headers = Array.isArray(payload.headers) ? payload.headers.map(function(h) { return String(h || "").trim(); }) : [];
  if (!headers.length) return { ok: false, error: "Invalid resident headers." };
  const blockIndex = findHeaderIndex(headers, ["block"]);
  const flatIndex = findHeaderIndex(headers, ["flat", "house", "apartment"]);
  if (blockIndex < 0 || flatIndex < 0) {
    return { ok: false, error: "Block/Flat columns not found in resident data." };
  }
  const block = String(payload.block || "").trim();
  const flat = String(payload.flat || "").trim();
  if (!block || !flat) return { ok: false, error: "Block and Flat are required." };

  const spreadsheet = SpreadsheetApp.openById(DIRECTORY_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(DIRECTORY_TAB_NAME);
  if (!sheet) return { ok: false, error: "Missing resident sheet tab: " + DIRECTORY_TAB_NAME };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let targetRow = 0;
  try {
    targetRow = findResidentRow(sheet, block, flat, blockIndex + 1, flatIndex + 1);
    if (!targetRow) return { ok: false, error: "Resident row not found for " + block + " / Flat " + flat + "." };
    const width = headers.length;
    const existing = sheet.getRange(targetRow, 1, 1, width).getValues()[0];
    for (let i = 0; i < width; i++) {
      if (i !== blockIndex && i !== flatIndex) existing[i] = "";
    }
    sheet.getRange(targetRow, 1, 1, width).setValues([existing]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, updatedRow: targetRow, action: "deleteResidentFields" };
}

function assertAllowedUser() {
  const email = getSignedInEmail();
  if (!isAllowedEmail(email)) {
    throw new Error("Unauthorized user: " + (email || "unknown"));
  }
}

function getSignedInEmail() {
  return String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
}

function isAllowedEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  return ALLOWED_USERS.map(function(user) {
    return String(user || "").trim().toLowerCase();
  }).indexOf(normalizedEmail) >= 0;
}

function getUnauthorizedHtml(email) {
  const shownEmail = email || "No Google account email detected";
  return '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{font-family:Arial,sans-serif;background:#f3f7fb;color:#17314f;margin:0;min-height:100vh;display:grid;place-items:center}.card{background:#fff;border-radius:18px;box-shadow:0 18px 38px rgba(27,37,54,.08);padding:28px;max-width:460px;margin:18px}h1{font-size:1.35rem;margin:0 0 10px}p{line-height:1.45}.email{font-weight:700}</style></head><body><div class="card"><h1>Access denied</h1><p>This admin page is restricted to approved Google accounts.</p><p>Signed in as: <span class="email">' + escapeHtml(shownEmail) + '</span></p></div></body></html>';
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Collapses any line breaks in a remarks/notes string into a single space,
   so the Remarks column is always written as one line — never with a \n —
   whether the text came fresh from the client or was already stored (with
   a stray line break) in the sheet from before this fix. Used by both
   addPaymentPayload() and updatePaymentPayload(). */
function oneLineRemarks_(raw) {
  return String(raw || "").replace(/\r\n|\r|\n/g, " ").replace(/\s+/g, " ").trim();
}

/* buildPaymentRemark() was removed — it built a mode-less "<amount> received
   on <date>" audit line and was the root cause of the duplicated remark bug
   described above savePaymentPayload(). The client (payments.html /
   flat-search.html) already builds the complete audit line itself; the
   server's only job is to preserve prior remarks and append whatever the
   client sent. Do not reintroduce a server-side remark builder. */

/* ═══════════════════════════════════════════════════════════════════════
   Month-Year ("YYYY-MM") paid-months helpers.

   Mirrors the logic in the client-side payment-months.js (flat-search.html
   / payments.html) so the sheet always stores an exact calendar month for
   each covered period, never just a bare month name. Bare legacy tokens
   ("NOV") are still readable — their year is inferred from context — but
   every new write goes out as an explicit "YYYY-MM" key so no inference is
   ever needed again once a row has been touched by the app.
═══════════════════════════════════════════════════════════════════════ */

function pad2(n) { n = Number(n); return (n < 10 ? "0" : "") + n; }

function monthYearKey(year, monthIndex) {
  const y = Number(year), mi = Number(monthIndex);
  if (mi < 0 || mi > 11 || !y) return "";
  return y + "-" + pad2(mi + 1);
}

function parseMonthYearKey(value) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const monthIndex = Number(m[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  return { year: Number(m[1]), monthIndex: monthIndex };
}

function monthNameIndex(token) {
  const raw = String(token || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!raw) return -1;
  for (let i = 0; i < MONTHS.length; i++) {
    const full = MONTHS[i], short = PAID_MONTH_LABELS[i];
    if (raw === full || raw === short || full.indexOf(raw) === 0 || short.indexOf(raw) === 0) return i;
  }
  return -1;
}

// Distance-minimizing year inference for a bare (year-less) legacy month
// token, anchored on a context year/month. Picks whichever of {year-1,
// year, year+1} lands the token closest to the anchor — so a January
// anchor infers "Nov"/"Dec" as the PREVIOUS year (a catch-up payment)
// rather than blindly assuming the same year as the transaction.
function inferYearForBareMonth(monthIndex, contextYear, contextMonthIndex) {
  let bestYear = contextYear, bestDist = Infinity;
  [-1, 0, 1].forEach(function (k) {
    const dist = Math.abs((k * 12 + monthIndex) - contextMonthIndex);
    if (dist < bestDist) { bestDist = dist; bestYear = contextYear + k; }
  });
  return bestYear;
}

// Parse one raw token into a canonical "YYYY-MM" key. Accepts the
// Month-Year formats the client sends ("2025-11", "Nov 2025", …) and falls
// back to year-inference for legacy bare month names ("NOV").
function parseMonthToken(token, contextYear, contextMonthIndex) {
  const raw = String(token || "").trim();
  if (!raw) return "";

  let m = /^(\d{4})-(\d{1,2})$/.exec(raw);
  if (m) { const mi = Number(m[2]) - 1; if (mi >= 0 && mi <= 11) return monthYearKey(m[1], mi); }

  m = /^(\d{1,2})[\/\-](\d{4})$/.exec(raw);
  if (m) { const mi = Number(m[1]) - 1; if (mi >= 0 && mi <= 11) return monthYearKey(m[2], mi); }

  m = /^([A-Za-z]+)[\s,\-\/]+(\d{4})$/.exec(raw);
  if (m) { const mi = monthNameIndex(m[1]); if (mi >= 0) return monthYearKey(m[2], mi); }

  m = /^(\d{4})[\s,\-\/]+([A-Za-z]+)$/.exec(raw);
  if (m) { const mi = monthNameIndex(m[2]); if (mi >= 0) return monthYearKey(m[1], mi); }

  const bareIdx = monthNameIndex(raw);
  if (bareIdx >= 0) return monthYearKey(inferYearForBareMonth(bareIdx, contextYear, contextMonthIndex), bareIdx);

  return "";
}

// A legacy edge case: some old rows glued month labels together with no
// separator at all (e.g. "NOVDECJAN"). Numeric/Month-Year tokens are never
// chunked this way — only pure-letter tokens that aren't already a single
// recognizable month name.
function splitCombinedMonthTokens(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  if (/\d/.test(raw)) return [raw];
  if (monthNameIndex(raw) >= 0) return [raw];

  const compact = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (!compact) return [];

  if (compact.length % 3 === 0) {
    const found = [];
    for (let i = 0; i < compact.length; i += 3) {
      const chunk = compact.substring(i, i + 3);
      if (monthNameIndex(chunk) >= 0) found.push(chunk);
    }
    if (found.length && found.length * 3 === compact.length) return found;
  }

  const scan = [];
  for (let index = 0; index < PAID_MONTH_LABELS.length; index++) {
    const shortLabel = PAID_MONTH_LABELS[index], fullLabel = MONTHS[index];
    if (compact.indexOf(fullLabel) >= 0 || compact.indexOf(shortLabel) >= 0) scan.push(shortLabel);
  }
  return scan;
}

// Parse a raw "Paid Months" cell/payload value into a sorted, de-duplicated
// array of canonical "YYYY-MM" keys. contextYear/contextMonthIndex anchor
// the year-inference for any legacy bare-month tokens found.
function normalizePaidMonths(value, contextYear, contextMonthIndex) {
  const cy = contextYear || PAYMENT_SHEET_YEAR;
  const cm = (contextMonthIndex === undefined || contextMonthIndex === null) ? 0 : contextMonthIndex;
  const rawTokens = Array.isArray(value) ? value : String(value || "").split(/[,;|]+|\s+/);
  const keys = {};
  rawTokens.forEach(function (token) {
    splitCombinedMonthTokens(token).forEach(function (t) {
      const key = parseMonthToken(t, cy, cm);
      if (key) keys[key] = true;
    });
  });
  return Object.keys(keys).sort();
}

// Union of two already-normalized "YYYY-MM" key arrays, sorted.
function mergePaidMonths(existingKeys, newKeys) {
  const seen = {};
  existingKeys.concat(newKeys).forEach(function (k) { if (k) seen[k] = true; });
  return Object.keys(seen).sort();
}

function findPaymentRow(sheet, block, flatNo) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const targetBlock = normalizeBlock(block);
  const targetFlat = normalizeFlat(flatNo);
  for (let index = 0; index < values.length; index++) {
    const rowBlock = normalizeBlock(values[index][0]);
    const rowFlat = normalizeFlat(values[index][1]);
    if (rowBlock === targetBlock && rowFlat === targetFlat) {
      return index + 2;
    }
  }
  return 0;
}

function findResidentRow(sheet, block, flatNo, blockColumn, flatColumn) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const rowCount = lastRow - 1;
  const maxCol = Math.max(blockColumn, flatColumn);
  const values = sheet.getRange(2, 1, rowCount, maxCol).getValues();
  const targetBlock = normalizeBlock(block);
  const targetFlat = normalizeFlat(flatNo);
  for (let index = 0; index < values.length; index++) {
    const rowBlock = normalizeBlock(values[index][blockColumn - 1]);
    const rowFlat = normalizeFlat(values[index][flatColumn - 1]);
    if (rowBlock === targetBlock && rowFlat === targetFlat) return index + 2;
  }
  return 0;
}

function findHeaderIndex(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const value = String(headers[i] || "").trim().toLowerCase();
    for (let j = 0; j < patterns.length; j++) {
      if (value.indexOf(patterns[j]) >= 0) return i;
    }
  }
  return -1;
}

function normalizeBlock(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits ? "BLOCK-" + Number(digits) : String(value || "").trim().toUpperCase();
}

function normalizeFlat(value) {
  return String(value || "").trim().replace(/^0+(?=\d)/, "");
}

function getSheetNameFromPaymentDate(inputDate) {
  const parts = String(inputDate || "").split("-");
  const monthIndex = Number(parts[1]) - 1;
  return monthIndex >= 0 && monthIndex < MONTHS.length ? MONTHS[monthIndex] : "";
}

function toSheetDate(inputDate) {
  const parts = String(inputDate || "").split("-");
  if (parts.length !== 3) return "";
  return parts[1] + "/" + parts[2] + "/" + parts[0];
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════════════════════════════════════
// FUND LEDGER — Expense Sheet Write Handlers
// Sheet ID  : 12xUQSim5hPYi1TmI51WzYn3-tph9vFJHopwCaWx76D8
// Tab       : Sheet1 (or whichever the active tab is)
// Columns   : TRANSACTION DATE | TRANSACTION TYPE | DESCRIPTION | AMOUNT |
//             PAYMENT MODE | OPENING BALANCE | CLOSING BALANCE | PAID BY BILL
// ═══════════════════════════════════════════════════════════════════════════

const EXPENSE_SPREADSHEET_ID = "12xUQSim5hPYi1TmI51WzYn3-tph9vFJHopwCaWx76D8";
// Candidate tab names — the handler tries each until one is found
const EXPENSE_TAB_CANDIDATES = ["Sheet1", "Ledger", "LEDGER", "Fund Ledger",
                                 "FUND LEDGER", "Expense", "EXPENSE"];

// ── Routing: plug expense actions into the existing doGet / doPost ──────────
// Add to isApiSaveRequest check:
function isExpenseRequest(e) {
  const action = String((e && e.parameter && e.parameter.action) || "").toLowerCase();
  return action === "saveexpense" || action === "updateexpense" || action === "deleteexpense";
}

function handleExpenseRequest(e) {
  const params   = (e && e.parameter) || {};
  const callback = String(params.callback || "").trim();
  const payload  = parseApiPayload(params.payload);
  let result;
  try {
    if (payload.secret !== PAYMENT_WRITE_SECRET) {
      result = { ok: false, error: "Unauthorized" };
    } else {
      const action = String(params.action || payload.actionType || "").toLowerCase();
      if (action === "deleteexpense") {
        result = deleteExpensePayload(payload);
      } else if (action === "updateexpense") {
        result = updateExpensePayload(payload);
      } else {
        result = saveExpensePayload(payload);
      }
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  if (callback && /^[A-Za-z0-9_$.]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(result);
}

// ── Helper: open the expense sheet tab ─────────────────────────────────────
function openExpenseSheet() {
  const ss = SpreadsheetApp.openById(EXPENSE_SPREADSHEET_ID
  
  );
  for (var i = 0; i < EXPENSE_TAB_CANDIDATES.length; i++) {
    var sheet = ss.getSheetByName(EXPENSE_TAB_CANDIDATES[i]);
    if (sheet) return sheet;
  }
  // Fallback: first sheet
  return ss.getSheets()[0];
}

// ── Helper: ensure header row exists with correct columns ───────────────────
function ensureExpenseHeader(sheet) {
  const HEADERS = [
    "TRANSACTION DATE", "TRANSACTION TYPE", "DESCRIPTION", "AMOUNT",
    "PAYMENT MODE", "OPENING BALANCE", "CLOSING BALANCE", "PAID BY BILL"
  ];
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(HEADERS);
    return;
  }
  const first = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const hasHeader = first.some(function(v) {
    return String(v || "").toLowerCase().includes("transaction") ||
           String(v || "").toLowerCase().includes("date") ||
           String(v || "").toLowerCase().includes("amount");
  });
  if (!hasHeader) {
    sheet.insertRowBefore(1);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  }
}

// ── Helper: get previous closing balance (last non-empty row) ───────────────
function getPrevClosingBalance(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  // Column 7 = CLOSING BALANCE (1-based)
  const vals = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    const v = parseFloat(String(vals[i][0] || "").replace(/[^0-9.-]/g, ""));
    if (!isNaN(v) && v !== 0) return v;
  }
  return 0;
}

// ── Save (append new row) ───────────────────────────────────────────────────
function saveExpensePayload(payload) {
  const date   = String(payload.date   || "").trim();
  const type   = String(payload.type   || "CREDIT").trim().toUpperCase();
  const desc   = String(payload.desc   || "").trim();
  const amount = parseFloat(String(payload.amount || "0").replace(/[^0-9.-]/g, "")) || 0;
  const mode   = String(payload.paymode || payload.category || "").trim();
  const bill   = String(payload.notes  || "").trim();

  if (!date || !desc || !amount) {
    return { ok: false, error: "Date, description and amount are required." };
  }

  const sheet = openExpenseSheet();
  ensureExpenseHeader(sheet);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let newRow;
  try {
    const openBal  = getPrevClosingBalance(sheet);
    const closeBal = type === "CREDIT" ? openBal + amount : openBal - amount;
    const rowData  = [date, type, desc, amount, mode, openBal, closeBal, bill];
    sheet.appendRow(rowData);
    newRow = sheet.getLastRow();
    // Recompute all closing balances from scratch for integrity
    recomputeAllBalances(sheet);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "saveExpense", newRow: newRow };
}

// ── Update (overwrite existing row) ─────────────────────────────────────────
function updateExpensePayload(payload) {
  const rowId  = parseInt(payload.rowId || "0", 10);
  const date   = String(payload.date   || "").trim();
  const type   = String(payload.type   || "CREDIT").trim().toUpperCase();
  const desc   = String(payload.desc   || "").trim();
  const amount = parseFloat(String(payload.amount || "0").replace(/[^0-9.-]/g, "")) || 0;
  const mode   = String(payload.paymode || payload.category || "").trim();
  const bill   = String(payload.notes  || "").trim();

  if (!rowId || rowId < 2) return { ok: false, error: "Invalid row ID." };
  if (!date || !desc || !amount) {
    return { ok: false, error: "Date, description and amount are required." };
  }

  const sheet = openExpenseSheet();
  const lastRow = sheet.getLastRow();
  if (rowId > lastRow) return { ok: false, error: "Row " + rowId + " not found." };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Write the editable columns (leave balances to recompute)
    sheet.getRange(rowId, 1, 1, 5).setValues([[date, type, desc, amount, mode]]);
    sheet.getRange(rowId, 8, 1, 1).setValues([[bill]]);
    recomputeAllBalances(sheet);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "updateExpense", updatedRow: rowId };
}

// ── Delete (clear row and shift up) ─────────────────────────────────────────
function deleteExpensePayload(payload) {
  const rowId = parseInt(payload.rowId || "0", 10);
  if (!rowId || rowId < 2) return { ok: false, error: "Invalid row ID." };

  const sheet   = openExpenseSheet();
  const lastRow = sheet.getLastRow();
  if (rowId > lastRow) return { ok: false, error: "Row " + rowId + " not found." };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.deleteRow(rowId);
    recomputeAllBalances(sheet);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "deleteExpense", deletedRow: rowId };
}

// ── Recompute OPENING BALANCE and CLOSING BALANCE for all data rows ─────────
// Rows are kept in their current order (insertion order / date order as entered).
// Column 6 = OPENING BALANCE, Column 7 = CLOSING BALANCE (1-based).
function recomputeAllBalances(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const dataRange = sheet.getRange(2, 1, lastRow - 1, 8);
  const data      = dataRange.getValues();

  var balance = 0;
  for (var i = 0; i < data.length; i++) {
    const type   = String(data[i][1] || "").trim().toUpperCase();
    const amount = parseFloat(String(data[i][3] || "0").replace(/[^0-9.-]/g, "")) || 0;
    const open   = balance;
    const close  = type.startsWith("C") ? balance + amount : balance - amount;
    data[i][5]   = open;
    data[i][6]   = close;
    balance      = close;
  }
  dataRange.setValues(data);
}

// ═══════════════════════════════════════════════════════════════════════════
// GUARD PAYMENT MATRIX — Flat-wise Security Guard Collection Sync
// Sheet ID  : 12xUQSim5hPYi1TmI51WzYn3-tph9vFJHopwCaWx76D8 (same file as the
//             Fund Ledger / EXPENSE_SPREADSHEET_ID above — just different tabs)
// Tabs      : one per year, e.g. "2025", "2026" — chosen from the payment's
//             year, taken from payload.paymentDateInput (format YYYY-MM-DD)
// Layout    : Row 1 = title, Row 2 = "Guard Amount Per Month" + total, Row 3
//             blank, Row 4 = headers (A=Flat No, B=Tenant Name, C..N=Jan..Dec,
//             O=Total, P=Flat Status, Q=Paid By). Data starts Row 5.
//             Flat No column holds "<block>-<flatNo>", e.g. "1-101".
// Behaviour : Whatever month(s) a maintenance payment covers, this writes (or
//             clears) the FIXED per-month guard fee (GUARD_MONTHLY_AMOUNT) in
//             that month's column for the matching flat row — it does NOT
//             write the actual maintenance amount, only the flat 200/month
//             guard-fee marker. Every guard sync is wrapped so it can never
//             throw and break the main maintenance-payment save/update/delete.
// ═══════════════════════════════════════════════════════════════════════════

const GUARD_SPREADSHEET_ID = "12xUQSim5hPYi1TmI51WzYn3-tph9vFJHopwCaWx76D8";
const GUARD_MONTHLY_AMOUNT = 200;
const GUARD_HEADER_ROW = 4; // header labels live on row 4; data starts row 5
const GUARD_FLAT_COL = 1;   // column A holds "<block>-<flatNo>"
// Column order on the guard sheet, starting at column C (index 3)
const GUARD_MONTH_COLUMNS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// ── Open the year tab (throws if that year's tab doesn't exist yet) ─────────
function openGuardSheetForYear(year) {
  const ss = SpreadsheetApp.openById(GUARD_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(String(year));
  if (!sheet) {
    throw new Error("Missing guard payment sheet tab for year: " + year);
  }
  return sheet;
}

// ── Build the "<block>-<flatNo>" key used in the guard sheet's Flat No column ─
function guardFlatKey(block, flatNo) {
  const blockDigits = String(block || "").replace(/[^0-9]/g, "");
  return blockDigits + "-" + normalizeFlat(flatNo);
}

// ── Find the data row for a given block/flat (returns 0 if not found) ──────
function findGuardRow(sheet, block, flatNo) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= GUARD_HEADER_ROW) return 0;
  const targetKey = guardFlatKey(block, flatNo).toUpperCase();
  const values = sheet.getRange(GUARD_HEADER_ROW + 1, GUARD_FLAT_COL, lastRow - GUARD_HEADER_ROW, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim().toUpperCase() === targetKey) {
      return GUARD_HEADER_ROW + 1 + i;
    }
  }
  return 0;
}

// ── Map a PAID_MONTH_LABELS-style label (JAN, ..., JUNE, JULY, ..., DEC) to the
//    guard sheet's plain 3-letter column label (JUN, JUL) ───────────────────
function toGuardMonthLabel(label) {
  const value = String(label || "").trim().toUpperCase();
  if (value === "JUNE") return "JUN";
  if (value === "JULY") return "JUL";
  return value.substring(0, 3);
}

function guardMonthColumn(monthLabel3) {
  const idx = GUARD_MONTH_COLUMNS.indexOf(monthLabel3);
  return idx >= 0 ? 3 + idx : 0; // column C = 3
}

// ── Pull a YYYY year out of a payload date string (YYYY-MM-DD) ─────────────
function extractGuardYear(paymentDateInput) {
  const parts = String(paymentDateInput || "").split("-");
  return /^\d{4}$/.test(parts[0]) ? parts[0] : "";
}

// ── Write (markPaid=true) or clear (markPaid=false) the fixed guard fee for
//    the given months, for one flat, on the year tab derived from the
//    payment date. Never throws — failures are reported in the return value
//    so a guard-sheet hiccup never blocks the main maintenance-payment save.
function syncGuardPayment(block, flatNo, paymentDateInput, paidMonths, markPaid) {
  const year = extractGuardYear(paymentDateInput);
  if (!year) {
    return { ok: false, error: "Could not determine year from payment date: " + paymentDateInput };
  }
  // paidMonths comes in as normalized "YYYY-MM" keys, extract month labels
  const normalized = normalizePaidMonths(paidMonths);
  
  // DEBUG: Log what we're receiving
  const debugInfo = {
    inputPaidMonths: paidMonths,
    normalizedKeys: normalized,
    year: year,
    block: block,
    flatNo: flatNo
  };
  
  const months = normalized.map(function(key) {
    // key format: "YYYY-MM", extract month number and convert to label
    const parts = String(key || "").split("-");
    const monthIdx = Number(parts[1]) - 1;
    const monthLabel = monthIdx >= 0 && monthIdx < MONTHS.length ? MONTHS[monthIdx].substring(0, 3) : "";
    return monthLabel;
  }).filter(function(m) { return m && GUARD_MONTH_COLUMNS.indexOf(m) >= 0; });
  
  if (!months.length) {
    return { ok: true, sheet: year, months: [], note: "No months to sync.", debug: debugInfo };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = openGuardSheetForYear(year);
    const row = findGuardRow(sheet, block, flatNo);
    if (!row) {
      return { ok: false, sheet: year, error: "Flat " + guardFlatKey(block, flatNo) + " not found on guard sheet " + year + ".", debug: debugInfo };
    }
    months.forEach(function(m) {
      const col = guardMonthColumn(m);
      if (col) sheet.getRange(row, col).setValue(markPaid ? GUARD_MONTHLY_AMOUNT : "");
    });
    return { ok: true, sheet: year, row: row, months: months, markedPaid: markPaid, debug: debugInfo };
  } catch (err) {
    return { ok: false, sheet: year, error: err.message, debug: debugInfo };
  } finally {
    lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PATCH: Update the existing doGet to route expense requests
// Replace the isApiSaveRequest check at the top of doGet with:
//   if (isExpenseRequest(e)) return handleExpenseRequest(e);
// Add this line BEFORE the existing isApiSaveRequest check.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// VEHICLE DIRECTORY — Write Handlers
// Sheet ID  : 15iii2nw4THbf-t-TdYNfj5WW2Aw4selhvfwu64YzisE (DIRECTORY_SPREADSHEET_ID)
// Tab       : vehicles (VEHICLE_TAB_NAME)
// Columns   : BLOCK | FLAT NO | VEHICLE TYPE | VEHICLE NO | BRAND | MODEL | COLOR
//             (Brand/Model/Color are optional; header order is auto-detected,
//             so this works even if columns are arranged differently.)
// ═══════════════════════════════════════════════════════════════════════════

const VEHICLE_HEADERS = ["BLOCK", "FLAT NO", "VEHICLE TYPE", "VEHICLE NO", "BRAND", "MODEL", "COLOR"];

// ── Routing predicate ────────────────────────────────────────────────────────
function isVehicleRequest(e) {
  const action = String((e && e.parameter && e.parameter.action) || "").toLowerCase();
  return action === "savevehicle" || action === "updatevehicle" || action === "deletevehicle";
}

function handleVehicleRequest(e) {
  const params   = (e && e.parameter) || {};
  const callback = String(params.callback || "").trim();
  const payload  = parseApiPayload(params.payload);
  let result;
  try {
    if (payload.secret !== PAYMENT_WRITE_SECRET) {
      result = { ok: false, error: "Unauthorized" };
    } else {
      const action = String(params.action || payload.actionType || "").toLowerCase();
      if (action === "deletevehicle") {
        result = deleteVehiclePayload(payload);
      } else if (action === "updatevehicle") {
        result = updateVehiclePayload(payload);
      } else {
        result = saveVehiclePayload(payload);
      }
    }
  } catch (err) {
    result = { ok: false, error: err.message };
  }
  if (callback && /^[A-Za-z0-9_$.]+$/.test(callback)) {
    return ContentService
      .createTextOutput(callback + "(" + JSON.stringify(result) + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(result);
}

// ── Helper: open the vehicle directory tab ───────────────────────────────────
function openVehicleSheet() {
  const ss = SpreadsheetApp.openById(DIRECTORY_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(VEHICLE_TAB_NAME);
  if (!sheet) {
    throw new Error("Missing vehicle directory sheet tab: " + VEHICLE_TAB_NAME);
  }
  return sheet;
}

// ── Helper: read header row and resolve column indexes (1-based) ────────────
// Tolerant of header variations, mirroring the PHP reader's matching logic.
function getVehicleColumnMap(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), VEHICLE_HEADERS.length);
  const headerRow = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
    .map(function(h) { return String(h || "").trim().toUpperCase().replace(/\s+/g, " "); });

  function find(patterns) {
    for (let i = 0; i < headerRow.length; i++) {
      for (let j = 0; j < patterns.length; j++) {
        if (headerRow[i] === patterns[j]) return i + 1; // 1-based column
      }
    }
    return 0;
  }

  return {
    block:   find(["BLOCK"]),
    flatNo:  find(["FLAT NO", "FLAT NO.", "FLAT_NO", "FLAT NUMBER"]),
    type:    find(["VEHICLE TYPE", "VEHICLE_TYPE", "TYPE"]),
    vehicle: find(["VEHICLE NO", "VEHICLE NO.", "VEHICLE_NO", "VEHICLE NUMBER"]),
    brand:   find(["BRAND", "VEHICLE BRAND", "MAKE"]),
    model:   find(["MODEL", "VEHICLE MODEL"]),
    color:   find(["COLOR", "COLOUR", "VEHICLE COLOR", "VEHICLE COLOUR"]),
    lastCol: lastCol,
    headerRow: headerRow,
  };
}

// ── Helper: ensure the directory sheet has a usable header row ──────────────
// If completely empty, writes the default header. Otherwise leaves the
// existing header untouched (columns are matched by name, not position).
function ensureVehicleHeader(sheet) {
  if (sheet.getLastRow() < 1) {
    sheet.appendRow(VEHICLE_HEADERS);
  }
}

// ── Helper: normalize a vehicle number for matching (case/space-insensitive) ─
function normalizeVehicleNo(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

// ── Helper: find the row number of an existing vehicle by its vehicle number ─
function findVehicleRowByNumber(sheet, colMap, vehicleNo) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !colMap.vehicle) return 0;
  const values = sheet.getRange(2, colMap.vehicle, lastRow - 1, 1).getValues();
  const target = normalizeVehicleNo(vehicleNo);
  for (let i = 0; i < values.length; i++) {
    if (normalizeVehicleNo(values[i][0]) === target) return i + 2;
  }
  return 0;
}

// ── Validate the mandatory fields shared by save/update ──────────────────────
function validateVehiclePayload(payload) {
  const block       = String(payload.block || "").trim();
  const flatNo       = String(payload.flatNo || "").trim();
  const vehicleType = String(payload.vehicleType || "").trim();
  const vehicleNo    = String(payload.vehicleNo || "").trim();
  if (!block || !flatNo || !vehicleType || !vehicleNo) {
    return { error: "Block, Flat No, Vehicle Type, and Vehicle No are all required." };
  }
  return {
    block: block,
    flatNo: flatNo,
    vehicleType: vehicleType,
    vehicleNo: vehicleNo,
    brand: String(payload.brand || "").trim(),
    model: String(payload.model || "").trim(),
    color: String(payload.color || "").trim(),
  };
}

// ── Save (append new vehicle row) ────────────────────────────────────────────
function saveVehiclePayload(payload) {
  const data = validateVehiclePayload(payload);
  if (data.error) return { ok: false, error: data.error };

  const sheet = openVehicleSheet();
  ensureVehicleHeader(sheet);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let newRow;
  try {
    const colMap = getVehicleColumnMap(sheet);
    if (!colMap.block || !colMap.flatNo || !colMap.type || !colMap.vehicle) {
      return { ok: false, error: "Could not locate Block/Flat No/Vehicle Type/Vehicle No columns in the sheet header." };
    }

    // Prevent duplicate vehicle numbers
    const existingRow = findVehicleRowByNumber(sheet, colMap, data.vehicleNo);
    if (existingRow) {
      return { ok: false, error: "A vehicle with number " + data.vehicleNo + " already exists (row " + existingRow + ")." };
    }

    const rowValues = new Array(colMap.lastCol).fill("");
    rowValues[colMap.block - 1]   = data.block;
    rowValues[colMap.flatNo - 1]  = data.flatNo;
    rowValues[colMap.type - 1]    = data.vehicleType;
    rowValues[colMap.vehicle - 1] = data.vehicleNo;
    if (colMap.brand) rowValues[colMap.brand - 1] = data.brand;
    if (colMap.model) rowValues[colMap.model - 1] = data.model;
    if (colMap.color) rowValues[colMap.color - 1] = data.color;

    sheet.appendRow(rowValues);
    newRow = sheet.getLastRow();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "saveVehicle", newRow: newRow };
}

// ── Update (overwrite an existing vehicle row, matched by original vehicle no) ─
function updateVehiclePayload(payload) {
  const originalVehicleNo = String(payload.originalVehicleNo || payload.vehicleNo || "").trim();
  if (!originalVehicleNo) return { ok: false, error: "Original vehicle number is required to locate the row to update." };

  const data = validateVehiclePayload(payload);
  if (data.error) return { ok: false, error: data.error };

  const sheet = openVehicleSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let targetRow = 0;
  try {
    const colMap = getVehicleColumnMap(sheet);
    if (!colMap.block || !colMap.flatNo || !colMap.type || !colMap.vehicle) {
      return { ok: false, error: "Could not locate Block/Flat No/Vehicle Type/Vehicle No columns in the sheet header." };
    }

    targetRow = findVehicleRowByNumber(sheet, colMap, originalVehicleNo);
    if (!targetRow) {
      return { ok: false, error: "No existing vehicle found with number " + originalVehicleNo + "." };
    }

    // If the vehicle number is being changed, make sure the new number isn't already taken by a different row
    if (normalizeVehicleNo(data.vehicleNo) !== normalizeVehicleNo(originalVehicleNo)) {
      const clashRow = findVehicleRowByNumber(sheet, colMap, data.vehicleNo);
      if (clashRow && clashRow !== targetRow) {
        return { ok: false, error: "Another vehicle already uses number " + data.vehicleNo + "." };
      }
    }

    const existing = sheet.getRange(targetRow, 1, 1, colMap.lastCol).getValues()[0];
    existing[colMap.block - 1]   = data.block;
    existing[colMap.flatNo - 1]  = data.flatNo;
    existing[colMap.type - 1]    = data.vehicleType;
    existing[colMap.vehicle - 1] = data.vehicleNo;
    if (colMap.brand) existing[colMap.brand - 1] = data.brand;
    if (colMap.model) existing[colMap.model - 1] = data.model;
    if (colMap.color) existing[colMap.color - 1] = data.color;

    sheet.getRange(targetRow, 1, 1, colMap.lastCol).setValues([existing]);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "updateVehicle", updatedRow: targetRow };
}

// ── Delete (remove the row entirely, matched by vehicle no) ─────────────────
function deleteVehiclePayload(payload) {
  const vehicleNo = String(payload.vehicleNo || "").trim();
  if (!vehicleNo) return { ok: false, error: "Vehicle number is required to delete a row." };

  const sheet = openVehicleSheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  let targetRow = 0;
  try {
    const colMap = getVehicleColumnMap(sheet);
    targetRow = findVehicleRowByNumber(sheet, colMap, vehicleNo);
    if (!targetRow) {
      return { ok: false, error: "No existing vehicle found with number " + vehicleNo + "." };
    }
    sheet.deleteRow(targetRow);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, action: "deleteVehicle", deletedRow: targetRow };
}