// ─────────────────────────────────────────────────────────────
//  SURN ITNM Registry — Google Apps Script Backend
//  Paste this entire file into script.google.com, then deploy
//  as a Web App (see deployment instructions below).
// ─────────────────────────────────────────────────────────────
//
//  DEPLOYMENT STEPS:
//  1. Go to https://script.google.com and create a new project
//  2. Paste this entire file, replacing any existing code
//  3. Click "Save" (floppy disk icon)
//  4. Click "Deploy" → "New deployment"
//  5. Type: "Web app"
//  6. Description: "ITNM Registry Form Handler"
//  7. Execute as: "Me (SUFUResearch@stanford.edu)"
//  8. Who has access: "Anyone"
//  9. Click "Deploy" → copy the Web App URL
// 10. Paste the Web App URL into app.js where indicated
// 11. Also share the Google Sheet with SUFUResearch@stanford.edu
//     (it will be created automatically on first submission)
// ─────────────────────────────────────────────────────────────

const STUDY_EMAIL     = 'SUFUResearch@stanford.edu';
const SHEET_NAME      = 'Provider Registrations';
const DASHBOARD_URL   = 'https://topers777.github.io/surn-itnm-site/dashboard.html';

// Column headers for the spreadsheet
const COLUMNS = [
  'Timestamp', 'First Name', 'Last Name', 'Credentials', 'Specialty',
  'Institution', 'Address', 'Email', 'Office Phone', 'Cell Phone',
  'Preferred Contact', 'Devices', 'Implants/Year', 'Coordinator Name',
  'Coordinator Role', 'Coordinator Email', 'Coordinator Phone', 'Notes'
];

// ── Handle form POST ────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    saveToSheet(data);
    sendProviderConfirmation(data);
    sendStudyTeamNotification(data);
    return jsonResponse({ success: true });
  } catch (err) {
    return jsonResponse({ success: false, error: err.message });
  }
}

// Return provider list for admin page (requires admin key)
function doGet(e) {
  const key = e && e.parameter && e.parameter.key;
  const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!adminKey || key !== adminKey) {
    return jsonResponse({ success: false, error: 'Unauthorized' });
  }

  const ss    = getOrCreateSpreadsheet();
  const sheet = getOrCreateSheet(ss);
  const rows  = sheet.getDataRange().getValues();
  if (rows.length <= 1) return jsonResponse({ success: true, providers: [] });

  const headers  = rows[0];
  const providers = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });

  return jsonResponse({ success: true, providers });
}

// ── Save registration to Google Sheet ──────────────────────
function saveToSheet(data) {
  const ss    = getOrCreateSpreadsheet();
  const sheet = getOrCreateSheet(ss);

  // Add headers if sheet is empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length)
      .setFontWeight('bold')
      .setBackground('#8C1515')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }

  const devices = [
    data.device_revi     ? 'Revi'     : '',
    data.device_ecoin    ? 'eCoin'    : '',
    data.device_altaviva ? 'Altaviva' : '',
    data.device_other    ? 'Other'    : ''
  ].filter(Boolean).join(', ');

  sheet.appendRow([
    new Date(),
    data.first_name        || '',
    data.last_name         || '',
    data.credentials       || '',
    data.specialty         || '',
    data.institution       || '',
    data.address           || '',
    data.email             || '',
    data.office_phone      || '',
    data.cell_phone        || '',
    data.contact_pref      || '',
    devices,
    data.implants_per_year || '',
    data.cp_name           || '',
    data.cp_role           || '',
    data.cp_email          || '',
    data.cp_phone          || '',
    data.notes             || ''
  ]);

  // Auto-resize columns for readability
  sheet.autoResizeColumns(1, COLUMNS.length);
}

// ── Send confirmation email to the provider ─────────────────
function sendProviderConfirmation(data) {
  const name = `Dr. ${data.last_name || 'Provider'}`;
  const subject = 'SURN ITNM Registry — Registration Confirmed';
  const body = `Dear ${name},

Thank you for registering with the SURN ITNM Registry!

Your site registration has been received. The study team will follow up within 1–2 business days to confirm your access.

ACCESS YOUR PROVIDER DASHBOARD
${DASHBOARD_URL}

Log in with this email address: ${data.email}
Your dashboard will display patient enrollment, device breakdown, complications, and validated outcomes for your site once data is available.

NEXT STEPS
1. Print or download the patient recruitment flyer from the Provider Portal
2. Post the QR code in your office or share the enrollment link with patients at the point of care
3. Patients complete surveys on their own device — no extra clinic work required

Questions? Reply to this email or contact us at ${STUDY_EMAIL}

SURN ITNM Registry Team
Society for Female Urology and Urodynamics Research Network
Stanford University`;

  GmailApp.sendEmail(data.email, subject, body, {
    from: STUDY_EMAIL,
    replyTo: STUDY_EMAIL,
    name: 'SURN ITNM Registry'
  });
}

// ── Notify study team of new registration ───────────────────
function sendStudyTeamNotification(data) {
  const subject = `New ITNM Registry Registration: ${data.first_name} ${data.last_name}, ${data.institution}`;

  const devices = [
    data.device_revi     ? 'Revi'     : '',
    data.device_ecoin    ? 'eCoin'    : '',
    data.device_altaviva ? 'Altaviva' : '',
    data.device_other    ? 'Other'    : ''
  ].filter(Boolean).join(', ');

  const body = `New provider registration received.

PROVIDER
Name:         ${data.first_name} ${data.last_name}, ${data.credentials}
Specialty:    ${data.specialty || '—'}
Institution:  ${data.institution}
Address:      ${data.address || '—'}

CONTACT
Email:        ${data.email}
Office Phone: ${data.office_phone}
Cell Phone:   ${data.cell_phone || '—'}
Preferred:    ${data.contact_pref}

SITE
Devices:      ${devices}
Implants/yr:  ${data.implants_per_year || '—'}

COORDINATOR
Name:   ${data.cp_name  || '—'}
Role:   ${data.cp_role  || '—'}
Email:  ${data.cp_email || '—'}
Phone:  ${data.cp_phone || '—'}

NOTES
${data.notes || '(none)'}

Registered at: ${data.registered_at}`;

  GmailApp.sendEmail(STUDY_EMAIL, subject, body, {
    replyTo: data.email,
    name: 'ITNM Registry Form'
  });
}

// ── Helpers ─────────────────────────────────────────────────
function getOrCreateSpreadsheet() {
  // Look for an existing sheet named SHEET_NAME in Drive
  const files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }
  // Create a new one
  const ss = SpreadsheetApp.create(SHEET_NAME);
  // Share with study team email
  ss.addEditor(STUDY_EMAIL);
  return ss;
}

function getOrCreateSheet(ss) {
  return ss.getSheets()[0];
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
