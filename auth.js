/* ════════════════════════════════════════════════════════════════
   auth.js — single source of truth for "who is signed in", shared by
   every page.

   Why this exists: every page used to hand-roll its own login check —
   some auto-granted access to anyone (`sessionStorage.setItem(AUTH_KEY,
   "true")` with no actual check), some popped a modal with a hardcoded
   admin/password baked into client JS, and two pages ran their own
   copy of Google Sign-In just to gate the Save button. None of them
   agreed with each other, and a person could be "logged in" on one
   page and locked out of another. Now there is exactly ONE login
   surface (login.html) and every other page just asks this file
   "is there a valid session?".

   Include this script FIRST, before sidebar.js and before any other
   page script — right at the top of <body> (or in <head> — it has no
   DOM dependency):

     <script src="auth.js"></script>
     <script src="sidebar.js"></script>

   What it does on every page load:
     1. Reads the session Google Identity Services left behind on
        login.html (an ID token + the claims decoded from it).
     2. If there's no session, or the token has expired, it redirects
        straight to login.html?next=<this page> and stops — nothing
        else on the page should be trusted to run past that point.
     3. If the session is valid, it exposes `window.Auth` so page
        scripts and sidebar.js can read the signed-in identity and
        attach a verified token to every write, instead of a typed
        username or a secret sitting in plaintext in the page source:

          window.Auth.isSignedIn()   -> true
          window.Auth.getIdToken()   -> the Google ID token (send this
                                         with every read/write call to
                                         the Apps Script backend —
                                         guard-payment-write-apps-script.gs
                                         verifies it against Google and
                                         against ALLOWED_USERS on every
                                         request; nothing here is a
                                         substitute for that check)
          window.Auth.getEmail()     -> "someone@gmail.com"
          window.Auth.getName()      -> "Someone" (falls back to email)
          window.Auth.logout()       -> clears the session and sends
                                         the person back to login.html

   Client-side gating (this file) keeps casual/accidental access out
   and drives the UI. It is NOT the security boundary — someone could
   edit this file in their own browser and never touch anyone else's
   data. The actual boundary is the backend verifying idToken against
   Google + ALLOWED_USERS on every request, which is why every write
   call must keep sending idToken (see auth.js consumers in app.js /
   payments.html / owner-tenant.html / vehicles.html / fund-ledger.html).
   ════════════════════════════════════════════════════════════════ */
(function () {
  const SESSION_KEY = "society_auth_session";
  const LOGIN_PAGE = "login.html";

  function currentFile() {
    return location.pathname.split("/").pop() || "index.html";
  }

  function readSession() {
    let raw;
    try {
      raw = sessionStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    let s;
    try {
      s = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!s || !s.idToken || !s.email || !s.exp) return null;
    // JWT "exp" is seconds-since-epoch; Google ID tokens are short-lived
    // (~1 hour), so a session left open in a background tab naturally
    // expires and sends the person back through login.html.
    if (Date.now() >= s.exp * 1000) return null;
    return s;
  }

  function doLogout() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    try {
      window.google?.accounts?.id?.disableAutoSelect();
    } catch {}
    window.location.href = LOGIN_PAGE;
  }

  const session = readSession();

  if (!session) {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    if (currentFile() !== LOGIN_PAGE) {
      const next = encodeURIComponent(currentFile());
      window.location.replace(`${LOGIN_PAGE}?next=${next}`);
    }
    // Redirect is in flight (it isn't synchronous), so anything else on
    // this page may still execute for a beat. Hand out a harmless
    // signed-out Auth object rather than leaving window.Auth undefined,
    // so a page script that runs before navigation completes fails
    // safely (empty email/no token) instead of throwing.
    window.Auth = {
      isSignedIn: () => false,
      getIdToken: () => null,
      getEmail: () => "",
      getName: () => "",
      logout: doLogout,
    };
    return;
  }

  window.Auth = {
    isSignedIn: () => !!readSession(),
    getIdToken: () => readSession()?.idToken || null,
    getEmail: () => readSession()?.email || "",
    getName: () => readSession()?.name || readSession()?.email || "",
    logout: doLogout,
  };
})();
