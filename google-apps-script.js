// ─────────────────────────────────────────────────────────────
//  SURN ITNM Registry — Google Apps Script
//
//  SETUP (do this once):
//  1. Go to script.google.com (personal Gmail)
//  2. New project → paste this file → Save
//  3. Click Run → select "setup" → click Run
//     → click "Review permissions" → Allow
//  4. Check your Gmail — a test email confirms it's working
//  5. Deploy → New deployment → Web app
//     Execute as: Me | Who has access: Anyone → Deploy
//  6. Copy the Web App URL → paste into app.js
// ─────────────────────────────────────────────────────────────

const NOTIFY_EMAIL = 'SUFUResearch@stanford.edu';
const SHEET_NAME   = 'ITNM Provider Registrations';

// Run this once to authorize and test
function setup() {
  GmailApp.sendEmail(
    Session.getActiveUser().getEmail(),
    'ITNM Script: Authorization OK',
    'Google Apps Script is authorized and ready.'
  );
  Logger.log('Setup complete. Check your Gmail inbox.');
}

// Receives form POST from the website
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    saveRow(data);
    notifyTeam(data);
    return ok();
  } catch(err) {
    return ok(); // always return 200 so form shows success
  }
}

function doGet(e) {
  return ok();
}

function saveRow(d) {
  var files = DriveApp.getFilesByName(SHEET_NAME);
  var ss = files.hasNext()
    ? SpreadsheetApp.open(files.next())
    : SpreadsheetApp.create(SHEET_NAME);
  var sheet = ss.getSheets()[0];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Timestamp','First Name','Last Name','Credentials','Specialty',
      'Institution','Address','Email','Office Phone','Cell Phone',
      'Preferred Contact','Devices','Implants/yr','Notes'
    ]);
  }

  var devices = [
    d.device_revi     ? 'Revi'     : '',
    d.device_ecoin    ? 'eCoin'    : '',
    d.device_altaviva ? 'Altaviva' : '',
    d.device_other    ? 'Other'    : ''
  ].filter(Boolean).join(', ');

  sheet.appendRow([
    new Date(),
    d.first_name || '', d.last_name || '', d.credentials || '',
    d.specialty  || '', d.institution || '', d.address || '',
    d.email      || '', d.office_phone || '', d.cell_phone || '',
    d.contact_pref || '', devices, d.implants_per_year || '', d.notes || ''
  ]);
}

function notifyTeam(d) {
  var devices = [
    d.device_revi     ? 'Revi'     : '',
    d.device_ecoin    ? 'eCoin'    : '',
    d.device_altaviva ? 'Altaviva' : '',
    d.device_other    ? 'Other'    : ''
  ].filter(Boolean).join(', ');

  GmailApp.sendEmail(
    NOTIFY_EMAIL,
    'New ITNM Registration: ' + d.first_name + ' ' + d.last_name + ', ' + d.institution,
    'New provider registration:\n\n' +
    'Name:         ' + d.first_name + ' ' + d.last_name + ', ' + d.credentials + '\n' +
    'Institution:  ' + d.institution + '\n' +
    'Email:        ' + d.email + '\n' +
    'Phone:        ' + d.office_phone + '\n' +
    'Specialty:    ' + (d.specialty || '—') + '\n' +
    'Devices:      ' + devices + '\n' +
    'Implants/yr:  ' + (d.implants_per_year || '—') + '\n\n' +
    'Notes: ' + (d.notes || 'none') + '\n\n' +
    'Registered: ' + d.registered_at,
    { replyTo: d.email }
  );
}

function ok() {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
