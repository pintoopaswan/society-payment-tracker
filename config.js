/* ════════════════════════════════════════════════════════════════
   config.js — the ONE file to edit when a Google Sheet ID changes, a
   new financial year starts, the Apps Script gets redeployed, or
   someone new needs access.

   Before this file existed, these values were hardcoded independently
   in 5–6 different pages each (verified by grep, not assumed — see the
   per-key comments below for exactly which pages used to hardcode
   what). The clearest example: SHEET_IDS_BY_YEAR — the mapping of
   "2026" → <sheet id> — was copy-pasted identically into payments.html,
   payment-history.html, payments-overview.html, flat-search.html, and
   payment-verification.html. Every year-end, whoever adds the new
   year's sheet would have had to remember to edit all five. Now it's
   edited here once.

   Include this FIRST — before utils.js, auth.js, and sidebar.js, and
   before any page-specific script that reads CONFIG:
     <script src="config.js"></script>
     <script src="utils.js"></script>
     <script src="auth.js"></script>
     <script src="sidebar.js"></script>

   IMPORTANT — this file cannot be the single source of truth for
   EVERYTHING. Two values here are UX-only mirrors of values that must
   also be kept in sync, by hand, on the server side, because Apps
   Script runs in a completely separate runtime and cannot import a
   client-side .js file:
     - google.oauthClientId  mirrors  GOOGLE_OAUTH_CLIENT_ID  in
       guard-payment-write-apps-script.gs
     - allowedUsers          mirrors  ALLOWED_USERS            in
       guard-payment-write-apps-script.gs — and the server list is the
       one that actually gates every read/write; this one only avoids
       showing someone a sign-in button that was always going to fail.
   If you change either, change both places.
   ════════════════════════════════════════════════════════════════ */

window.CONFIG = Object.freeze({

  google: {
    oauthClientId: "45825105036-k447e1bpus2bfvp5k48dl56lch2d28kf.apps.googleusercontent.com",
  },

  // UX-only mirror of ALLOWED_USERS in guard-payment-write-apps-script.gs.
  // Used by login.html to show "you're not on the list" before the person
  // even tries — real enforcement is 100% server-side, on every request.
  allowedUsers: [
    "pintoopaswan88@gmail.com",
    "deveshsahu9143@gmail.com",
    "mig1.society29@gmail.com",
    "rky07456@gmail.com",
  ],

  sheets: {
    // One spreadsheet holds both the resident directory and the vehicle
    // list, as separate tabs. Previously hardcoded (identically) as
    // DIRECTORY_SHEET_ID in owner-tenant.html, CONTACT_SHEET_ID in
    // emergency-contact.html and payments.html, and DIRECTORY_SHEET_ID
    // again in flat-search.html; DIR_ID in vehicles.html.
    directory: {
      id: "15iii2nw4THbf-t-TdYNfj5WW2Aw4selhvfwu64YzisE",
      residentsTab: "Sheet1",
      vehiclesTab: "vehicles",
      emergencyContactsTab: "emergency-contacts",
    },

    // One spreadsheet per financial year of guard payments. THIS is the
    // block to edit every year: add "2027": "<new sheet id>" below, and
    // every page that reads payments (payments.html, payment-history.html,
    // payments-overview.html, flat-search.html, payment-verification.html)
    // picks it up automatically — no other file needs to change.
    paymentsByYear: {
      "2026": "1sPkVonPCAwM_avBVyQuJSSKRkx5wkB1XPHY1KiEulvU",
      "2025": "1U8uoiXbtvzdJxjDTV_IXxAjI7pvzXTFP",
    },

    // Which month tabs exist in each year's payment sheet. 2025 only has
    // tabs from June onward (the year this tracker started); a normal
    // full year (like 2026) has all twelve. Add a "2027" entry here
    // alongside paymentsByYear above when the new year starts — it can
    // just reuse MONTHS below if the new sheet has all twelve tabs from
    // January.
    monthTabsByYear: {
      "2026": null, // null = use the full MONTHS list below
      "2025": [null, null, null, null, null, "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"],
    },

    expenses: {
      id: "1uiD2QymMUl04uNB9N-RrJ9gbT45u2Nm7Vt69E1DJBvo",
      tab: "Sheet1",
    },
  },

  // Apps Script Web App deployment(s) that accept writes AND (as of the
  // authenticated-reads fix) reads.
  //
  // NOTE — these are genuinely two different deployment URLs in the
  // current codebase, not a typo introduced here: owner-tenant.html,
  // vehicles.html, fund-ledger.html, AND flat-search.html all POST to
  // `residentsVehiclesExpenses` below, while payments.html POSTs to a
  // SEPARATE deployment (`payments`). If both are meant to run the same
  // guard-payment-write-apps-script.gs, that's two deployments to keep
  // in sync on every future change to that script — worth confirming
  // that's intentional (e.g. a deliberate staged rollout) rather than
  // payments.html simply having drifted from a redeploy that updated
  // the others. If they should be one deployment, point both keys below
  // at the same URL and redeploy once.
  //
  // `read` is used by every page for CSV reads (see utils.js fetchCsv).
  // It's set to `residentsVehiclesExpenses` because that deployment is
  // already the one most pages depend on — but for this to actually
  // work, whichever Google account owns/deployed THAT script must have
  // at least Viewer access to every sheet listed in
  // guard-payment-write-apps-script.gs's READABLE_SHEET_IDS, including
  // the payment-year sheets that only payments.html used to write to
  // through the OTHER deployment. Confirm that access after deploying.
  appsScript: {
    residentsVehiclesExpenses: "https://script.google.com/macros/s/AKfycbxrVX9NFnmbY3Bf_KRYKq7eZsemHgk7AzJ8OA_94Zt-LKpCZODkYsTnNX-pB6MUjutgeA/exec",
    payments: "https://script.google.com/macros/s/AKfycbzOOKgbKaeTzmIPc6KMMtQn69ic66KSCHSWq0bD787ZUCL6dpDxaHNK0npp3VNeje320A/exec",
    read: "https://script.google.com/macros/s/AKfycbxrVX9NFnmbY3Bf_KRYKq7eZsemHgk7AzJ8OA_94Zt-LKpCZODkYsTnNX-pB6MUjutgeA/exec",
  },

  cache: {
    // How long a cached CSV read is served without hitting the network
    // at all. Write-triggered invalidation (see utils.js) is what keeps
    // this safe to leave fairly short-lived even with a low ceiling —
    // this TTL only matters for changes made outside this app entirely.
    csvTtlMs: 60 * 1000,
  },

});
