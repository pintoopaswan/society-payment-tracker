const ALLOWED_USERS = ["pintoopaswan88@gmail.com", "amitm876@gmail.com", "anshumannayak724@gmail.com", "mig1.society29@gmail.com"];
const PAYMENT_WRITE_SECRET = "MigSocietyPaymentWrite_2026_9xK4pL72Qz";
const SPREADSHEET_ID = "1sPkVonPCAwM_avBVyQuJSSKRkx5wkB1XPHY1KiEulvU";
const DIRECTORY_SPREADSHEET_ID = "15iii2nw4THbf-t-TdYNfj5WW2Aw4selhvfwu64YzisE";
const DIRECTORY_TAB_NAME = "Sheet1";
const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const PAID_MONTH_LABELS = ["JAN","FEB","MAR","APR","MAY","JUNE","JULY","AUG","SEP","OCT","NOV","DEC"];

function doGet(e) {
  if (isPingRequest(e)) {
    return handlePingRequest(e);
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
    if (String(payload.action || "").toLowerCase() === "saveresident") {
      return jsonResponse(saveResidentPayload(payload));
    }
    if (String(payload.action || "").toLowerCase() === "deleteresidentfields") {
      return jsonResponse(deleteResidentFieldsPayload(payload));
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

function savePaymentPayload(payload) {
  const sheetName = getSheetNameFromPaymentDate(payload.paymentDateInput);
  if (!sheetName) {
    return { ok: false, error: "Invalid payment date." };
  }

  const amount = Number(payload.amount || 0);
  if (!payload.block || !payload.flatNo || !amount || amount % 1 !== 0) {
    return { ok: false, error: "Block, flat number, and whole-number amount are required." };
  }

  const submittedPaidMonths = normalizePaidMonths(payload.paidMonths || []);
  if (!submittedPaidMonths.length) {
    return { ok: false, error: "Paid months are required." };
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
    const existingRemarks = String(existingValues[5] || "").trim();
    const existingPaidMonths = normalizePaidMonths(existingValues[6] || "");
    const mergedPaidMonths = mergePaidMonths(existingPaidMonths, submittedPaidMonths).join(" ");
    const newTotalAmount = existingAmount + amount;
    const paymentNote = buildPaymentRemark(payload.paymentDateInput, amount);
    const submittedNotes = String(payload.notes || "").trim();
    const remarksParts = [];
    if (existingRemarks) remarksParts.push(existingRemarks);
    remarksParts.push(paymentNote);
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

  return { ok: true, sheetName: sheetName, updatedRow: targetRow };
}

function updatePaymentPayload(payload) {
  const sheetName = getSheetNameFromPaymentDate(payload.paymentDateInput);
  if (!sheetName) {
    return { ok: false, error: "Invalid payment date." };
  }

  const amount = Number(payload.amount || 0);
  if (!payload.block || !payload.flatNo || !amount || amount % 1 !== 0) {
    return { ok: false, error: "Block, flat number, and whole-number amount are required." };
  }

  const submittedPaidMonths = normalizePaidMonths(payload.paidMonths || []);
  if (!submittedPaidMonths.length) {
    return { ok: false, error: "Paid months are required." };
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

    const updatedRemarks = String(payload.notes || "").trim();
    sheet.getRange(targetRow, 3, 1, 7).setValues([[
      amount,
      payload.paymentMode || "",
      toSheetDate(payload.paymentDateInput),
      "DONE",
      payload.receivedBy || "",
      updatedRemarks,
      submittedPaidMonths.join(" "),
    ]]);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, sheetName: sheetName, updatedRow: targetRow, actionType: "update" };
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
  try {
    targetRow = findPaymentRow(sheet, payload.block, payload.flatNo);
    if (!targetRow) {
      return {
        ok: false,
        error: "No existing row found for " + payload.block + " / Flat " + payload.flatNo + " in " + sheetName + ".",
      };
    }
    sheet.getRange(targetRow, 3, 1, 7).clearContent();
  } finally {
    lock.releaseLock();
  }

  return { ok: true, sheetName: sheetName, updatedRow: targetRow, actionType: "delete" };
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

function buildPaymentRemark(inputDate, amount) {
  const dateText = toSheetDate(inputDate);
  return "Payment added on " + dateText + " for amount " + amount;
}

function normalizePaidMonths(value) {
  const rawMonths = Array.isArray(value) ? value : String(value || "").split(/[,;|\/]+|\s+/);
  const expanded = [];
  rawMonths.forEach(function(month) {
    splitCombinedMonthLabels(month).forEach(function(label) { expanded.push(label); });
  });
  const unique = {};
  expanded.forEach(function(month) { unique[month] = true; });
  return PAID_MONTH_LABELS.filter(function(month) { return !!unique[month]; });
}

function splitCombinedMonthLabels(value) {
  const direct = normalizePaidMonthLabel(value);
  if (direct) return [direct];

  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return [];
  const compact = raw.replace(/[^A-Z]/g, "");
  if (!compact) return [];

  const found = [];
  if (compact.length % 3 === 0) {
    for (var i = 0; i < compact.length; i += 3) {
      const label = normalizePaidMonthLabel(compact.substring(i, i + 3));
      if (label) found.push(label);
    }
    if (found.length && found.length * 3 === compact.length) {
      return found;
    }
  }

  for (var index = 0; index < PAID_MONTH_LABELS.length; index++) {
    var shortLabel = PAID_MONTH_LABELS[index];
    var fullLabel = MONTHS[index];
    if (compact.indexOf(fullLabel) >= 0 || compact.indexOf(shortLabel) >= 0) {
      found.push(shortLabel);
    }
  }
  return found;
}

function normalizePaidMonthLabel(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  for (let index = 0; index < MONTHS.length; index++) {
    if (raw === MONTHS[index] || raw === PAID_MONTH_LABELS[index] || raw.substring(0, 3) === MONTHS[index].substring(0, 3)) {
      return PAID_MONTH_LABELS[index];
    }
  }
  return "";
}

function mergePaidMonths(existingMonths, newMonths) {
  const selected = {};
  existingMonths.concat(newMonths).forEach(function(month) { selected[month] = true; });
  return PAID_MONTH_LABELS.filter(function(month) { return selected[month]; });
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
