const ALLOWED_USERS = ["pintoopaswan88@gmail.com", "amitm876@gmail.com", "anshumannayak724@gmail.com", "mig1.society29@gmail.com"];
const PAYMENT_WRITE_SECRET = "MigSocietyPaymentWrite_2026_9xK4pL72Qz";
const SPREADSHEET_ID = "1sPkVonPCAwM_avBVyQuJSSKRkx5wkB1XPHY1KiEulvU";
const MONTHS = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE","JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const PAID_MONTH_LABELS = ["JAN","FEB","MAR","APR","MAY","JUNE","JULY","AUG","SEP","OCT","NOV","DEC"];

function doGet() {
  const email = getSignedInEmail();
  if (!isAllowedEmail(email)) {
    return HtmlService
      .createHtmlOutput(getUnauthorizedHtml(email))
      .setTitle("Unauthorized")
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  return HtmlService
    .createHtmlOutputFromFile("admin-index")
    .setTitle("MIG Society Admin")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function savePaymentFromAdmin(payload) {
  assertAllowedUser();
  return savePaymentPayload(payload);
}

function doPost(e) {
  try {
    assertAllowedUser();
    const payload = JSON.parse(e.postData.contents || "{}");
    if (payload.secret !== PAYMENT_WRITE_SECRET) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }
    return jsonResponse(savePaymentPayload(payload));
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
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
  return rawMonths
    .map(function(month) { return normalizePaidMonthLabel(month); })
    .filter(Boolean);
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
