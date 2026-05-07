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

const NOTIFY_EMAIL   = 'SUFUResearch@stanford.edu';
const SHEET_NAME     = 'ITNM Provider Registrations';
const DASHBOARD_URL  = 'https://topers777.github.io/surn-itnm-site/dashboard.html';

// Run this once to authorize and test
function setup() {
  MailApp.sendEmail(
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
  if (e && e.parameter && e.parameter.payload) {
    try {
      var data = JSON.parse(e.parameter.payload);
      saveRow(data);
      notifyTeam(data);
    } catch(err) {}
    return ok();
  }
  if (e && e.parameter && e.parameter.action === 'providers') {
    return getProviders();
  }
  return ok();
}

function getProviders() {
  try {
    var files = DriveApp.getFilesByName(SHEET_NAME);
    if (!files.hasNext()) {
      return ContentService.createTextOutput(JSON.stringify({ success: true, providers: [], sheetUrl: null }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var ss = SpreadsheetApp.open(files.next());
    var sheet = ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ success: true, providers: [], sheetUrl: ss.getUrl() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var headers = data[0];
    var providers = data.slice(1).map(function(row) {
      var obj = {};
      headers.forEach(function(h, i) { obj[h] = row[i]; });
      return obj;
    });
    return ContentService.createTextOutput(JSON.stringify({ success: true, providers: providers, sheetUrl: ss.getUrl() }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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

  var subject = 'New ITNM Registration: ' + d.first_name + ' ' + d.last_name + ', ' + d.institution;

  var body =
    '------------------------------------------------------------\n' +
    'STUDY TEAM: Forward the message below to the provider.\n' +
    'Registration details for your records are at the bottom.\n' +
    '------------------------------------------------------------\n\n' +

    'Dear Dr. ' + d.last_name + ',\n\n' +

    'Thank you for registering with the SURN ITNM Registry! We are excited to have ' +
    d.institution + ' participating in this national real-world outcomes study.\n\n' +

    'YOUR PROVIDER DASHBOARD\n' +
    DASHBOARD_URL + '\n\n' +
    'Log in with your registered email address: ' + d.email + '\n' +
    'Your dashboard will display enrollment counts, device breakdown, complications, ' +
    'and validated outcomes (OAB-Q, PGI-I) for your patients as data becomes available.\n\n' +

    'DASHBOARD UPDATES\n' +
    'Your dashboard is refreshed monthly as new survey data comes in. ' +
    'If you would like an out-of-sequence update at any time, simply email us at ' +
    NOTIFY_EMAIL + ' and we will push a refresh for your site.\n\n' +

    'NEXT STEPS\n' +
    '1. Download the patient recruitment flyer: ' + DASHBOARD_URL.replace('dashboard.html', 'handouts/ITNM_Patient_Recruitment_Flyer.docx') + '\n' +
    '2. Share the enrollment link with patients at the point of care: ' + DASHBOARD_URL.replace('dashboard.html', 'enroll.html') + '\n' +
    '3. Patients complete surveys from their own device — no extra clinic work required.\n\n' +

    'Questions? Reply to this email or contact us at ' + NOTIFY_EMAIL + '\n\n' +
    'Thank you again for your participation.\n\n' +
    'Best regards,\n' +
    'SURN ITNM Registry Team\n' +
    'Society for Female Urology and Urodynamics Research Network\n\n' +

    '============================================================\n' +
    'REGISTRATION DETAILS (study team use)\n' +
    '============================================================\n' +
    'Name:         ' + d.first_name + ' ' + d.last_name + ', ' + d.credentials + '\n' +
    'Specialty:    ' + (d.specialty || '—') + '\n' +
    'Institution:  ' + d.institution + '\n' +
    'Address:      ' + (d.address || '—') + '\n' +
    'Email:        ' + d.email + '\n' +
    'Office Phone: ' + d.office_phone + '\n' +
    'Cell Phone:   ' + (d.cell_phone || '—') + '\n' +
    'Preferred:    ' + d.contact_pref + '\n' +
    'Devices:      ' + devices + '\n' +
    'Implants/yr:  ' + (d.implants_per_year || '—') + '\n' +
    'Notes:        ' + (d.notes || 'none') + '\n' +
    'Registered:   ' + d.registered_at;

  MailApp.sendEmail(NOTIFY_EMAIL, subject, body, { replyTo: d.email, bcc: 'trude@stanford.edu' });
}

function ok() {
  return ContentService
    .createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
