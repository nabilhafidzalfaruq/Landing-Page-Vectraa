/**
 * VECTRA — HTTP adapter for Code.gs
 * ---------------------------------------------------------------------
 * Paste this into your EXISTING Code.gs (the one that already has login,
 * saveDraft, adminUpsertCompetition, etc.). It does NOT replace your
 * business logic — it just exposes it over HTTP so a static frontend
 * hosted on Vercel can call it with fetch() instead of google.script.run.
 *
 * Deploy: Deploy → New deployment → type "Web app"
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the resulting /exec URL into firebase-config.js as GAS_API_URL.
 * ---------------------------------------------------------------------
 * SECURITY NOTE: doPost() below only dispatches to functions explicitly
 * listed in ALLOWED_ACTIONS. Do not switch this to a generic
 * `this[action](...)` call — that would let anyone invoke ANY global
 * function in your project by name, including ones never meant to be
 * reachable from the browser.
 */

var ALLOWED_ACTIONS = {
  warmupApp: warmupApp,
  getPublicBootstrap: getPublicBootstrap,       // NEW — see below
  resumeSession: resumeSession,
  login: login,                                  // signature changes, see below
  registerAccount: registerAccount,              // signature changes, see below
  logout: logout,
  getRegistrationForm: getRegistrationForm,
  saveDraft: saveDraft,
  submitRegistration: submitRegistration,
  uploadRegistrationFile: uploadRegistrationFile, // NEW — see below
  getBrandLogo: getBrandLogo,
  getCompetitionLogo: getCompetitionLogo,
  getAdminRegistrationsPage: getAdminRegistrationsPage,
  adminGetSystemInfo: adminGetSystemInfo,
  adminUpsertCompetition: adminUpsertCompetition,
  getAdminCompetitions: getAdminCompetitions,
  adminSetCompetitionStatus: adminSetCompetitionStatus,
  adminGetRegistrationDetail: adminGetRegistrationDetail,
  adminUpdateRegistrationStatus: adminUpdateRegistrationStatus
  // changeMyPassword / saveMyPassword removed: password changes now go
  // through Firebase client SDK directly (reauthenticate + updatePassword).
};

function doPost(e) {
  var result, error;
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var args = body.args || [];
    var fn = ALLOWED_ACTIONS[action];
    if (typeof fn !== 'function') throw new Error('Aksi tidak dikenal: ' + action);
    result = fn.apply(null, args);
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ result: result, error: error }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ ready: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * NEW: getPublicBootstrap()
 * Replaces the data that used to be templated server-side into
 * window.__VECTRA_BOOTSTRAP__ by HtmlService. Reuse whatever function you
 * already had building that object (e.g. buildPublicCompetitions() +
 * getBrandLogoUrl()) and return the same shape here:
 *   { competitions: [...], brandLogoUrl: '...' }
 *
 * function getPublicBootstrap() {
 *   return {
 *     competitions: buildPublicCompetitions(),
 *     brandLogoUrl: getBrandLogoUrl()
 *   };
 * }
 */

/**
 * CHANGED: login(payload) / registerAccount(payload)
 * Firebase now owns password verification and hashing, so these no longer
 * take a plaintext password. They receive:
 *   { email, uid, idToken }               (login)
 *   { name, email, phone, uid, idToken }  (registerAccount)
 *
 * idToken is a Firebase-signed JWT. To trust `uid`, verify idToken instead
 * of just believing the client — the simplest approach without adding the
 * Firebase Admin SDK is to call Google's tokeninfo endpoint and confirm the
 * `sub` claim matches `uid` and `aud`/`iss` match your Firebase project:
 *
 *   function verifyFirebaseIdToken(idToken, uid) {
 *     var res = UrlFetchApp.fetch(
 *       'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
 *       { muteHttpExceptions: true }
 *     );
 *     if (res.getResponseCode() !== 200) throw new Error('Token Firebase tidak valid.');
 *     var claims = JSON.parse(res.getContentText());
 *     if (claims.sub !== uid) throw new Error('Token Firebase tidak cocok dengan akun.');
 *     return claims;
 *   }
 *
 * Then: look up (or, for registerAccount, create) the USERS row by uid
 * instead of by a locally-hashed password, and issue your existing session
 * token exactly as before.
 */

/**
 * NEW: uploadRegistrationFile(token, competitionId, fieldKey, file)
 * file = { fileName, mimeType, base64 }
 * Should decode the base64, write it into the participant's Drive folder
 * (same folder convention you already use for registration_id), and return
 * { url, fileName } — the same shape the frontend already expects from a
 * file field's stored value.
 *
 * function uploadRegistrationFile(token, competitionId, fieldKey, file) {
 *   var session = requireSession(token); // however you validate sessions today
 *   var folder = getRegistrationFolder(session.user, competitionId);
 *   var blob = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType, file.fileName);
 *   var driveFile = folder.createFile(blob);
 *   driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
 *   return { url: driveFile.getUrl(), fileName: file.fileName };
 * }
 */
