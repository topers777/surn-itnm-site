/* ─────────────────────────────────────────────
   SURN ITNM Registry — app.js
   Handles: registration → Formsubmit.co, REDCap
            CSV parsing, dashboard rendering, charts
   ───────────────────────────────────────────── */

// ── Google Apps Script endpoint ──
// After deploying google-apps-script.js as a Web App, paste
// the deployment URL here. Leave blank to test locally.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwFSnuVBOlACGAQpfFwzMD45lXFODY2pKivm7IzeiRxrzZhiNJMYefNagOze0kXaNux/exec';

// ══════════════════════════════════════════════
// ENROLLMENT QR CODE (index.html, on page load)
// ══════════════════════════════════════════════

(function initEnrollQR() {
  const el = document.getElementById('enroll-qr-code');
  if (!el) return;
  // Build absolute URL to enroll.html
  const base = window.location.href.replace(/\/[^/]*$/, '/');
  const enrollUrl = base + 'enroll.html';
  function makeQR() {
    if (!window.QRCode) { setTimeout(makeQR, 150); return; }
    el.innerHTML = '';
    new QRCode(el, { text: enrollUrl, width: 180, height: 180, colorDark: '#8C1515', colorLight: '#ffffff' });
    // Update all enroll.html links with the absolute URL
    document.querySelectorAll('a[href="enroll.html"]').forEach(a => a.href = enrollUrl);
    const display = document.getElementById('enroll-url-display');
    if (display) { display.href = enrollUrl; display.textContent = enrollUrl; }
  }
  makeQR();
})();

// ══════════════════════════════════════════════
// REGISTRATION FORM (index.html)
// ══════════════════════════════════════════════

(function initRegistration() {
  const form = document.getElementById('provider-form');
  if (!form) return;

  // Show/hide cell phone contact preference option
  const cellInput = document.getElementById('cell-phone');
  const cellPrefOption = document.getElementById('cell-pref-option');
  if (cellInput && cellPrefOption) {
    cellInput.addEventListener('input', () => {
      if (cellInput.value.trim().length > 0) {
        cellPrefOption.style.display = 'flex';
      } else {
        cellPrefOption.style.display = 'none';
        const cellRadio = cellPrefOption.querySelector('input[type=radio]');
        if (cellRadio) cellRadio.checked = false;
      }
    });
  }

  // Show/hide contact person fields
  const hasContactCheckbox = document.getElementById('has-contact-person');
  const contactPersonFields = document.getElementById('contact-person-fields');
  if (hasContactCheckbox && contactPersonFields) {
    hasContactCheckbox.addEventListener('change', () => {
      contactPersonFields.classList.toggle('hidden', !hasContactCheckbox.checked);
    });
  }

  // Form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl   = document.getElementById('form-error');
    const captchaEl = document.getElementById('recaptcha-error');
    const submitBtn = document.getElementById('submit-btn');

    // Required field validation
    let valid = true;
    form.querySelectorAll('[required]').forEach(field => {
      const empty = field.type === 'radio'
        ? !form.querySelector(`input[name="${field.name}"]:checked`)
        : !field.value.trim();
      field.style.borderColor = empty ? 'var(--cardinal)' : '';
      if (empty) valid = false;
    });
    if (!form.querySelector('input[name^="device_"]:checked')) valid = false;
    if (!valid) { errorEl.classList.remove('hidden'); return; }
    errorEl.classList.add('hidden');

    // reCAPTCHA (skipped when site key is still placeholder)
    const captchaWidget = document.getElementById('recaptcha-widget');
    if (window.grecaptcha && captchaWidget?.dataset.sitekey !== 'YOUR_RECAPTCHA_SITE_KEY') {
      if (!grecaptcha.getResponse()) {
        captchaEl.classList.remove('hidden');
        captchaEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      captchaEl.classList.add('hidden');
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    const data = Object.fromEntries(new FormData(form).entries());
    data.registered_at = new Date().toISOString();

    if (APPS_SCRIPT_URL && APPS_SCRIPT_URL !== 'PASTE_YOUR_WEB_APP_URL_HERE') {
      // Image src is the most reliable cross-origin GET — no CORS, no preflight
      new Image().src = APPS_SCRIPT_URL + '?payload=' + encodeURIComponent(JSON.stringify(data));
    }

    document.getElementById('reg-form-card').classList.add('hidden');
    const successEl = document.getElementById('reg-success');
    successEl.classList.remove('hidden');
    successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
})();

// ── Print enrollment page / copy link helpers ──────────────

function printEnrollPage() {
  const w = window.open('enroll.html', '_blank');
  if (w) w.addEventListener('load', () => w.print());
}

function copyEnrollLink() {
  const base = window.location.href.replace(/\/[^/]*(\?.*)?$/, '/');
  const url = base + 'enroll.html';
  navigator.clipboard.writeText(url).then(
    () => alert('Enrollment link copied!\n\n' + url),
    () => prompt('Copy this link:', url)
  );
}

// ══════════════════════════════════════════════
// EMAIL → SHA-256 HASH (for provider lookup)
// ══════════════════════════════════════════════

async function hashEmail(email) {
  const bytes = new TextEncoder().encode(email.toLowerCase().trim());
  const buf = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════
// DASHBOARD (dashboard.html)
// ══════════════════════════════════════════════

(function initDashboard() {
  if (!document.getElementById('dashboard-state')) return;

  // Admin preview: data passed via sessionStorage when previewing from admin page
  const params = new URLSearchParams(window.location.search);
  if (params.get('preview') === '1') {
    const raw = sessionStorage.getItem('itnm_admin_preview');
    sessionStorage.removeItem('itnm_admin_preview');
    if (raw) {
      const data = JSON.parse(raw);
      document.getElementById('admin-preview-banner').style.display = 'flex';
      document.getElementById('lookup-gate').classList.add('hidden');
      renderDashboard(data);
      return;
    }
  }

  // Demo mode: ?demo=true — show sample dashboard without login
  if (params.get('demo') === 'true') {
    document.getElementById('demo-banner').style.display = 'flex';
    document.getElementById('lookup-gate').classList.add('hidden');
    const reg = getDemoRegistration();
    const demoData = Object.assign(getDemoData(), {
      display_name: `Dr. ${reg.first_name} ${reg.last_name}, ${reg.credentials}`,
      institution: reg.institution,
    });
    renderDashboard(demoData, new Date().toISOString());
    return;
  }

  // Auto-fill email if returning during same session
  const lastEmail = sessionStorage.getItem('itnm_dashboard_email');
  if (lastEmail) {
    const input = document.getElementById('lookup-email');
    if (input) input.value = lastEmail;
  }
})();

// Called by the "View My Dashboard" button
async function lookupDashboard() {
  const emailInput = document.getElementById('lookup-email');
  const errorEl    = document.getElementById('lookup-error');
  const spinner    = document.getElementById('lookup-spinner');
  const email = emailInput?.value.trim();

  errorEl.textContent = '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = 'Please enter a valid email address.';
    return;
  }

  spinner.style.display = 'block';

  try {
    const hash = await hashEmail(email);
    let allData;

    if (window.location.protocol === 'file:') {
      throw new Error('file_protocol');
    }

    const res = await fetch('data/provider-data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('not_found');
    allData = await res.json();

    const providerData = allData.providers?.[hash];
    if (!providerData || !(providerData.patients || []).length) {
      // Registered provider with no uploaded data yet — show the holding page
      sessionStorage.setItem('itnm_dashboard_email', email);
      showHoldingState(email);
      spinner.style.display = 'none';
      return;
    }

    sessionStorage.setItem('itnm_dashboard_email', email);
    document.getElementById('lookup-gate').classList.add('hidden');
    renderDashboard(providerData, allData.generated);

  } catch (err) {
    spinner.style.display = 'none';
    if (err.message === 'file_protocol') {
      errorEl.innerHTML = 'Dashboard lookup requires the site to be hosted on a server.<br/><a href="admin.html">Study team: use Admin to preview dashboards.</a>';
    } else if (err.message === 'not_found') {
      // No data file deployed yet — same holding page as a provider without data
      sessionStorage.setItem('itnm_dashboard_email', email);
      showHoldingState(email);
    } else {
      errorEl.textContent = 'Could not load dashboard. Please try again or contact SUFUResearch@stanford.edu.';
    }
    return;
  }
  spinner.style.display = 'none';
}

// Holding page: shown when a provider looks up their dashboard before any
// of their REDCap data has been uploaded
function showHoldingState(email) {
  document.getElementById('lookup-gate').classList.add('hidden');
  document.getElementById('dashboard-state').classList.add('hidden');
  const emailEl = document.getElementById('holding-email');
  if (emailEl) emailEl.textContent = email;
  document.getElementById('holding-state').classList.remove('hidden');
}

function backToLookup() {
  document.getElementById('holding-state').classList.add('hidden');
  document.getElementById('lookup-gate').classList.remove('hidden');
  const input = document.getElementById('lookup-email');
  if (input) { input.value = ''; input.focus(); }
}

function signOut() {
  sessionStorage.removeItem('itnm_dashboard_email');
  document.getElementById('dashboard-state').classList.add('hidden');
  const holding = document.getElementById('holding-state');
  if (holding) holding.classList.add('hidden');
  document.getElementById('lookup-gate').classList.remove('hidden');
  document.getElementById('lookup-email').value = '';
}

function renderDashboard(data, generated) {
  document.getElementById('dashboard-state').classList.remove('hidden');

  // "Last updated" label
  if (generated) {
    const el = document.getElementById('data-updated');
    if (el) el.textContent = 'Data as of ' + new Date(generated).toLocaleDateString() + ' · updated every 2 weeks';
  }

  // Provider header
  const name = data.display_name || data.provider_name || 'Provider';
  const institution = data.institution || '';
  const initials = name.split(' ').filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('');

  document.getElementById('provider-name-display').textContent = name;
  document.getElementById('provider-institution-display').textContent = institution;
  document.getElementById('provider-avatar').textContent = initials || 'MD';

  const patients = data.patients || [];
  const implanted = patients.filter(p => p.implant_date);
  const inFollowup = patients.filter(p => p.status && p.status !== 'enrolled' && p.status !== '12mo_complete');
  const complete12 = patients.filter(p => p.status === '12mo_complete');

  document.getElementById('meta-total').textContent = patients.length;
  document.getElementById('meta-implanted').textContent = implanted.length;
  document.getElementById('meta-followup').textContent = inFollowup.length;
  document.getElementById('meta-complete').textContent = complete12.length;

  // Stat cards
  const revi     = patients.filter(p => (p.device || '').toLowerCase().includes('revi')).length;
  const ecoin    = patients.filter(p => (p.device || '').toLowerCase().includes('ecoin')).length;
  const altaviva = patients.filter(p => (p.device || '').toLowerCase().includes('altaviva')).length;
  const compCount = patients.filter(p => p.complication_yn === 'yes').length;
  const improved = patients.filter(p => {
    const pgii = p.pgii_latest || p.pgii_6mo || p.pgii_3mo || p.pgii_1mo;
    return pgii && (pgii === '1' || pgii === '2' || pgii === 'very_much_better' || pgii === 'much_better');
  }).length;

  document.getElementById('stat-enrolled').textContent = patients.length;
  document.getElementById('stat-implanted').textContent = implanted.length;
  document.getElementById('stat-revi').textContent = revi;
  document.getElementById('stat-ecoin').textContent = ecoin;
  document.getElementById('stat-altaviva').textContent = altaviva;
  document.getElementById('stat-complications').textContent = compCount;
  document.getElementById('stat-improved').textContent = improved;

  // Charts
  renderDeviceChart(patients);
  renderEnrollmentChart(patients);
  renderCompletionChart(patients);
  renderPGIIChart(patients);
  renderOABQTrendChart(patients);
  renderPadsChart(patients);
  renderUrgencyChart(patients);

  // Patient table
  renderPatientTable(patients);

  // Complications tab
  renderComplicationsTab(patients);

  // Store globally for export
  window._dashboardData = { patients, name, institution };
}

// ─── Charts ───

function renderDeviceChart(patients) {
  const ctx = document.getElementById('chart-devices');
  if (!ctx) return;
  const revi     = patients.filter(p => (p.device || '').toLowerCase().includes('revi')).length;
  const ecoin    = patients.filter(p => (p.device || '').toLowerCase().includes('ecoin')).length;
  const altaviva = patients.filter(p => (p.device || '').toLowerCase().includes('altaviva')).length;
  const other    = patients.length - revi - ecoin - altaviva;

  new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Revi™', 'eCoin™', 'Altaviva™', 'Other'],
      datasets: [{
        data: [revi, ecoin, altaviva, other],
        backgroundColor: ['#8C1515', '#4D9BE6', '#2a7a4f', '#aaa'],
        borderWidth: 2,
        borderColor: '#fff'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } }
      }
    }
  });
}

function renderEnrollmentChart(patients) {
  const ctx = document.getElementById('chart-enrollment');
  if (!ctx) return;

  // Group by month of implant date
  const counts = {};
  patients.forEach(p => {
    if (!p.implant_date) return;
    const mo = p.implant_date.substring(0, 7);
    counts[mo] = (counts[mo] || 0) + 1;
  });
  const labels = Object.keys(counts).sort();
  const values = labels.map(l => counts[l]);

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => {
        const d = new Date(l + '-01');
        return d.toLocaleString('default', { month: 'short', year: '2-digit' });
      }),
      datasets: [{
        label: 'Implants',
        data: values,
        backgroundColor: '#8C1515',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderCompletionChart(patients) {
  const ctx = document.getElementById('chart-completion');
  if (!ctx) return;
  const implanted = patients.filter(p => p.implant_date).length;
  const t1 = patients.filter(p => p.oabq_1mo != null).length;
  const t3 = patients.filter(p => p.oabq_3mo != null).length;
  const t6 = patients.filter(p => p.oabq_6mo != null).length;
  const t12 = patients.filter(p => p.oabq_12mo != null).length;

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Baseline', '1-month', '3-month', '6-month', '12-month'],
      datasets: [{
        label: 'Surveys Completed',
        data: [implanted, t1, t3, t6, t12],
        backgroundColor: ['#8C1515', '#b83a3a', '#c45555', '#d07070', '#dc8888'],
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

function renderPGIIChart(patients) {
  const ctx = document.getElementById('chart-pgii');
  if (!ctx) return;

  const labels = ['Very Much Better', 'Much Better', 'A Little Better', 'No Change', 'Worse'];
  const counts = [0, 0, 0, 0, 0];
  patients.forEach(p => {
    const v = p.pgii_latest || p.pgii_6mo || p.pgii_3mo || p.pgii_1mo;
    if (!v) return;
    const n = parseInt(v);
    if (n === 1) counts[0]++;
    else if (n === 2) counts[1]++;
    else if (n === 3) counts[2]++;
    else if (n === 4) counts[3]++;
    else if (n >= 5) counts[4]++;
  });

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: counts,
        backgroundColor: ['#175E54', '#2a8c80', '#7ec8c0', '#ccc', '#e06060'],
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
    }
  });
}

function renderOABQTrendChart(patients) {
  const ctx = document.getElementById('chart-oabq-trend');
  if (!ctx) return;

  function mean(arr) {
    const valid = arr.filter(v => v != null && !isNaN(v));
    if (!valid.length) return null;
    return Math.round(valid.reduce((a, b) => a + parseFloat(b), 0) / valid.length * 10) / 10;
  }

  const timepoints = ['oabq_baseline', 'oabq_1mo', 'oabq_3mo', 'oabq_6mo', 'oabq_12mo'];
  const labels = ['Baseline', '1 Month', '3 Months', '6 Months', '12 Months'];
  const means = timepoints.map(tp => mean(patients.map(p => p[tp])));

  new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Mean OAB-Q Symptom Bother',
        data: means,
        borderColor: '#8C1515',
        backgroundColor: 'rgba(140,21,21,0.08)',
        pointBackgroundColor: '#8C1515',
        pointRadius: 5,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `Mean: ${ctx.parsed.y ?? 'N/A'}`
          }
        }
      },
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: 'OAB-Q Score (0–100)' } }
      }
    }
  });
}

function renderPadsChart(patients) {
  const ctx = document.getElementById('chart-pads');
  if (!ctx) return;
  const categories = ['0', '1', '2', '3', '4+'];
  function bucket(val) {
    const n = parseInt(val);
    if (isNaN(n)) return null;
    if (n === 0) return '0';
    if (n === 1) return '1';
    if (n === 2) return '2';
    if (n === 3) return '3';
    return '4+';
  }
  const baselineCounts = [0,0,0,0,0];
  const followupCounts = [0,0,0,0,0];
  patients.forEach(p => {
    const b = bucket(p.pads_baseline);
    const f = bucket(p.pads_12mo ?? p.pads_6mo ?? p.pads_3mo ?? p.pads_1mo);
    if (b) baselineCounts[categories.indexOf(b)]++;
    if (f) followupCounts[categories.indexOf(f)]++;
  });

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [
        { label: 'Baseline', data: baselineCounts, backgroundColor: 'rgba(140,21,21,0.6)', borderRadius: 4 },
        { label: 'Latest follow-up', data: followupCounts, backgroundColor: 'rgba(23,94,84,0.7)', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Patients' } },
                 x: { title: { display: true, text: 'Pads/day' } } }
    }
  });
}

function renderUrgencyChart(patients) {
  const ctx = document.getElementById('chart-urgency');
  if (!ctx) return;
  const categories = ['0', '1–2', '3–5', '6–10', '10+'];
  function bucket(val) {
    const n = parseInt(val);
    if (isNaN(n)) return null;
    if (n === 0) return '0';
    if (n <= 2) return '1–2';
    if (n <= 5) return '3–5';
    if (n <= 10) return '6–10';
    return '10+';
  }
  const baselineCounts = [0,0,0,0,0];
  const followupCounts = [0,0,0,0,0];
  patients.forEach(p => {
    const b = bucket(p.urgency_episodes_baseline);
    const f = bucket(p.urgency_episodes_12mo ?? p.urgency_episodes_6mo ?? p.urgency_episodes_3mo ?? p.urgency_episodes_1mo);
    if (b) baselineCounts[categories.indexOf(b)]++;
    if (f) followupCounts[categories.indexOf(f)]++;
  });

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [
        { label: 'Baseline', data: baselineCounts, backgroundColor: 'rgba(140,21,21,0.6)', borderRadius: 4 },
        { label: 'Latest follow-up', data: followupCounts, backgroundColor: 'rgba(23,94,84,0.7)', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Patients' } },
                 x: { title: { display: true, text: 'Daily leakage episodes' } } }
    }
  });
}

// ─── Patient Table ───

let _allPatients = [];

function renderPatientTable(patients) {
  _allPatients = patients;
  filterPatients();
}

function filterPatients() {
  const search = (document.getElementById('patient-search')?.value || '').toLowerCase();
  const deviceFilter = document.getElementById('patient-filter-device')?.value || '';
  const statusFilter = document.getElementById('patient-filter-status')?.value || '';

  const filtered = _allPatients.filter(p => {
    if (search && !JSON.stringify(p).toLowerCase().includes(search)) return false;
    if (deviceFilter && !(p.device || '').toLowerCase().includes(deviceFilter)) return false;
    if (statusFilter && p.status !== statusFilter) return false;
    return true;
  });

  const tbody = document.getElementById('patient-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-light);padding:24px;">No patients match the current filters.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const statusBadge = statusBadgeHTML(p.status);
    const compBadge = p.complication_yn === 'yes'
      ? '<span class="badge badge-red">Yes</span>'
      : '<span class="badge badge-green">No</span>';
    const pgii = p.pgii_latest || p.pgii_6mo || p.pgii_3mo || p.pgii_1mo;
    const pgiiLabel = pgiiText(pgii);
    const latestOabq = p.oabq_12mo ?? p.oabq_6mo ?? p.oabq_3mo ?? p.oabq_1mo;

    return `<tr>
      <td><code style="font-size:0.82rem;">${escHtml(p.record_id || p.patient_id || '—')}</code></td>
      <td>${escHtml(p.implant_date || '—')}</td>
      <td>${deviceBadgeHTML(p.device)}</td>
      <td>${escHtml(p.implant_side || '—')}</td>
      <td>${statusBadge}</td>
      <td>${compBadge}</td>
      <td>${p.oabq_baseline != null ? p.oabq_baseline : '—'}</td>
      <td>${latestOabq != null ? latestOabq : '—'}</td>
      <td>${pgiiLabel}</td>
    </tr>`;
  }).join('');
}

function statusBadgeHTML(status) {
  const map = {
    enrolled: ['badge-grey', 'Enrolled'],
    implanted: ['badge-blue', 'Implanted'],
    '1mo_complete': ['badge-yellow', '1-mo Done'],
    '3mo_complete': ['badge-yellow', '3-mo Done'],
    '6mo_complete': ['badge-blue', '6-mo Done'],
    '12mo_complete': ['badge-green', '12-mo Done'],
  };
  const [cls, label] = map[status] || ['badge-grey', status || '—'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function deviceBadgeHTML(device) {
  if (!device) return '—';
  const d = device.toLowerCase();
  if (d.includes('revi')) return '<span class="badge badge-red">Revi™</span>';
  if (d.includes('ecoin')) return '<span class="badge badge-blue">eCoin™</span>';
  return `<span class="badge badge-grey">${escHtml(device)}</span>`;
}

function pgiiText(val) {
  const map = { '1': 'Very Much Better', '2': 'Much Better', '3': 'A Little Better', '4': 'No Change', '5': 'A Little Worse', '6': 'Much Worse', '7': 'Very Much Worse' };
  if (!val) return '—';
  return map[String(val)] || escHtml(val);
}

// ─── Complications Tab ───

function renderComplicationsTab(patients) {
  const tbody = document.getElementById('complications-tbody');
  if (!tbody) return;

  const withComp = patients.filter(p => p.complication_yn === 'yes');

  // Stats
  const statsDiv = document.getElementById('complication-stats');
  if (statsDiv) {
    const types = {};
    withComp.forEach(p => {
      const t = p.complication_type || 'Unspecified';
      types[t] = (types[t] || 0) + 1;
    });
    const rate = patients.length ? Math.round(withComp.length / patients.length * 100) : 0;
    statsDiv.innerHTML = `
      <div class="stat-card stat-warning">
        <div class="stat-number">${withComp.length}</div>
        <div class="stat-label">Total Complications</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${rate}%</div>
        <div class="stat-label">Complication Rate</div>
      </div>
      ${Object.entries(types).map(([t, n]) => `
        <div class="stat-card">
          <div class="stat-number">${n}</div>
          <div class="stat-label">${escHtml(t)}</div>
        </div>`).join('')}
    `;
  }

  if (withComp.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:24px;">No complications recorded.</td></tr>';
    return;
  }

  // De-identified: device + complication details only, no patient IDs or dates
  tbody.innerHTML = withComp.map(p => `<tr>
    <td>${deviceBadgeHTML(p.device)}</td>
    <td>${escHtml(p.complication_type || '—')}</td>
    <td>${escHtml(p.complication_timing || '—')}</td>
    <td>${escHtml(p.clavien_dindo || '—')}</td>
    <td>${escHtml(p.complication_notes || '—')}</td>
  </tr>`).join('');
}

// ─── Tabs ───

function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name)?.classList.add('active');
  const btn = [...document.querySelectorAll('.tab-btn')].find(b => b.getAttribute('onclick')?.includes(name));
  if (btn) btn.classList.add('active');
}

// ─── Export CSV ───

function exportCSV() {
  if (!window._dashboardData) return;
  const { patients } = window._dashboardData;
  const cols = ['record_id', 'implant_date', 'device', 'implant_side', 'status',
                 'complication_yn', 'complication_type', 'oabq_baseline', 'oabq_1mo',
                 'oabq_3mo', 'oabq_6mo', 'oabq_12mo', 'pgii_1mo', 'pgii_3mo',
                 'pgii_6mo', 'pgii_12mo', 'pads_baseline', 'pads_6mo',
                 'urgency_episodes_baseline', 'urgency_episodes_6mo'];
  const header = cols.join(',');
  const rows = patients.map(p => cols.map(c => JSON.stringify(p[c] ?? '')).join(','));
  const csv = [header, ...rows].join('\n');
  downloadFile(csv, 'itnm-dashboard-export.csv', 'text/csv');
}

// ══════════════════════════════════════════════
// ADMIN PAGE (admin.html)
// ══════════════════════════════════════════════

let _parsedProviders = {};

(function initAdmin() {
  if (!document.getElementById('upload-zone')) return;

  // Drag and drop
  const zone = document.getElementById('upload-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) processCSVFile(file);
  });
})();

function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) processCSVFile(file);
}

function processCSVFile(file) {
  if (!file.name.endsWith('.csv')) {
    showUploadFeedback('error', 'Please select a .csv file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      const result = parseREDCapExport(text);
      displayPreview(result);
    } catch (err) {
      showUploadFeedback('error', 'Error parsing CSV: ' + err.message);
    }
  };
  reader.readAsText(file);
}

// ─── REDCap raw-data export parsing ─────────────────────────
// Expected file: REDCap → Data Exports, Reports, and Stats →
// "CSV / Microsoft Excel (raw data)". Long format: one row per record
// per event (redcap_event_name = baseline_arm_1, one_month_arm_1, …)
// with variable names as headers (surgeon_confirm, itnm_date_verify,
// prov_device, oab_q1…oab_q8, oab_q1_fup…, pgi_i, pads_day, leaks_num).

function parseREDCapExport(text) {
  const table = parseCSVText(text);
  if (table.length < 2) throw new Error('CSV appears empty.');

  const headers = table[0].map(h => h.trim());

  if (!headers.includes('record_id') || !headers.includes('redcap_event_name')) {
    if (headers.includes('Record ID') || headers.includes('Event Name')) {
      throw new Error('This looks like a <strong>labels</strong> export. In REDCap, choose "CSV / Microsoft Excel (<strong>raw data</strong>)" — variable names, not labels — and upload that file instead.');
    }
    throw new Error('Could not find <code>record_id</code> and <code>redcap_event_name</code> columns. Upload a raw REDCap export (see the column template).');
  }

  const rows = table.slice(1)
    .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); }); return o; })
    .filter(o => o.record_id);

  // Group event rows by record, keyed by timepoint
  const records = {};
  rows.forEach(r => {
    (records[r.record_id] = records[r.record_id] || {})[eventTimepoint(r.redcap_event_name)] = r;
  });

  const patients = Object.entries(records).map(([id, evs]) => buildPatient(id, evs));

  // Group patients by confirmed surgeon (fallback: patient-entered surgeon name)
  const providers = {};
  patients.forEach(p => {
    const name = p._surgeon || 'Unassigned (no surgeon recorded)';
    if (!providers[name]) {
      providers[name] = { provider_name: name, provider_email: '', institution: '', patients: [], _locs: {} };
    }
    if (p._institution) providers[name]._locs[p._institution] = (providers[name]._locs[p._institution] || 0) + 1;
    providers[name].patients.push(p);
  });

  // Institution = most common patient-entered location; email from saved surgeon→email map
  const emailMap = getProviderEmailMap();
  Object.values(providers).forEach(pr => {
    pr.institution = (Object.entries(pr._locs).sort((a, b) => b[1] - a[1])[0] || [''])[0];
    delete pr._locs;
    pr.provider_email = emailMap[pr.provider_name.toLowerCase()] || '';
  });

  return { headers, rows, providers, patients };
}

function eventTimepoint(name) {
  const n = String(name || '').toLowerCase();
  if (n.startsWith('baseline')) return 'baseline';
  if (/(^|_)(one|1)_?month/.test(n)) return '1mo';
  if (/(^|_)(three|3)_?month/.test(n)) return '3mo';
  if (/(^|_)(six|6)_?month/.test(n)) return '6mo';
  if (/(^|_)(twelve|12)_?month|one_?year/.test(n)) return '12mo';
  return n || 'unknown';
}

const DEVICE_NAMES = { ecoin: 'eCoin', revi: 'Revi', altaviva: 'Altaviva' };

function buildPatient(id, evs) {
  const base = evs.baseline || {};
  const oneMo = evs['1mo'] || {};
  const g = (row, field) => (row[field] || '').trim();

  const p = {
    record_id: id.length > 12 ? id.slice(0, 8) : id,  // hashes are long — shorten for display
    patient_id: id,
  };

  p._surgeon = g(base, 'surgeon_confirm') || g(base, 'surgeon_name');
  p._institution = g(base, 'surgeon_loc');

  // If the 1-month survey reports a rescheduled date, that supersedes the planned date
  p.implant_date = g(oneMo, 'resched_date') || g(base, 'itnm_date_verify') || undefined;

  const rawDevice = g(base, 'prov_device') || g(oneMo, 'device_name') || g(base, 'other_device') || g(oneMo, 'other_device_pat');
  p.device = DEVICE_NAMES[rawDevice.toLowerCase()] || rawDevice || undefined;

  const leg = g(oneMo, 'implant_leg');
  p.implant_side = leg ? leg.charAt(0).toUpperCase() + leg.slice(1) : undefined;

  // Complications: provider form (on the baseline event) + patient 1-month report
  const provComp = g(base, 'complications') === '1';
  const patComp = g(oneMo, 'complic_pat') === '1';
  p.complication_yn = provComp || patComp ? 'yes' : 'no';
  const types = [];
  if (g(oneMo, 'bleed_pat') === '1') types.push('Bleeding');
  if (g(oneMo, 'bruise_pat') === '1') types.push('Bruising');
  if (g(oneMo, 'infection_pat') === '1') types.push('Infection');
  if (g(oneMo, 'pain_pat') === '1') types.push('Pain');
  if (g(oneMo, 'other_compl_pat') === '1') types.push(g(oneMo, 'other_compl_spec') || 'Other');
  p.complication_type = types.join(', ') || (provComp ? 'Reported by provider' : undefined);
  const intraop = g(base, 'intraop') === '1';
  const postop = g(base, 'postop') === '1';
  p.complication_timing = intraop && postop ? 'Intra- & postoperative'
    : intraop ? 'Intraoperative'
    : postop ? 'Postoperative'
    : patComp ? 'Patient-reported (1 month)' : undefined;
  p.clavien_dindo = g(base, 'clavien_dindo').toUpperCase() || undefined;
  p.complication_notes = [g(base, 'intraop_spec'), g(base, 'postop_spec')].filter(Boolean).join('; ') || undefined;

  // Outcomes
  p.oabq_baseline = oabqBotherScore(base, '');
  p.pads_baseline = parseScore(g(base, 'pads_day'));
  p.urgency_episodes_baseline = parseScore(g(base, 'leaks_num'));

  let latestFup = null;
  ['1mo', '3mo', '6mo', '12mo'].forEach(tp => {
    const row = evs[tp];
    if (!row) return;
    const score = oabqBotherScore(row, '_fup');
    if (score !== undefined) p['oabq_' + tp] = score;
    const pgii = g(row, 'pgi_i');
    if (pgii) p['pgii_' + tp] = pgii;
    const pads = parseScore(g(row, 'pads_day_fup'));
    if (pads !== undefined) p['pads_' + tp] = pads;
    const leaks = parseScore(g(row, 'leaks_num_fup') || g(row, 'times_uui_fup'));
    if (leaks !== undefined) p['urgency_episodes_' + tp] = leaks;
    if (score !== undefined || pgii || g(row, 'patient_follow_up_complete') === '2') latestFup = tp;
  });
  p.pgii_latest = p.pgii_12mo || p.pgii_6mo || p.pgii_3mo || p.pgii_1mo;

  p.status = latestFup ? latestFup + '_complete'
    : (p.implant_date || p.device || g(base, 'provider_baseline_complete') === '2') ? 'implanted'
    : 'enrolled';

  return p;
}

// OAB-q Symptom Bother: items oab_q1–oab_q8 coded 1–6, scaled to 0–100
// (higher = more bother). Scored when at least half the items are answered.
function oabqBotherScore(row, suffix) {
  const vals = [];
  for (let i = 1; i <= 8; i++) {
    const v = parseFloat(row['oab_q' + i + suffix]);
    if (!isNaN(v) && v >= 1 && v <= 6) vals.push(v);
  }
  if (vals.length < 4) return undefined;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round((mean - 1) / 5 * 1000) / 10;
}

// ── Surgeon → provider-email mapping (persisted across uploads) ──

function getProviderEmailMap() {
  try { return JSON.parse(localStorage.getItem('itnm_provider_emails') || '{}'); }
  catch (e) { return {}; }
}

function saveProviderEmailMap(map) {
  localStorage.setItem('itnm_provider_emails', JSON.stringify(map));
}

// Match a surgeon name from REDCap against the registered-provider sheet
// (loaded via "Load Providers"). Returns the registration row on a unique match.
function matchRegistration(surgeonName, regs) {
  const name = ' ' + surgeonName.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const hits = regs.filter(r => {
    const last = String(r['Last Name'] || '').toLowerCase().trim();
    return last.length >= 2 && name.includes(' ' + last + ' ');
  });
  return hits.length === 1 ? hits[0] : null;
}

function parseScore(val) {
  if (val === undefined || val === null || val === '') return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

// Character-level CSV parser — handles quoted fields containing commas and newlines
function parseCSVText(text) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cur); cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function displayPreview({ headers, rows, providers, patients }) {
  _parsedProviders = providers;

  // Feedback
  showUploadFeedback('success', `Loaded ${patients.length} patient(s) (${rows.length} event rows) across ${Object.keys(providers).length} surgeon group(s).`);

  // Step 2 — validation against the raw REDCap variable names
  document.getElementById('step2-card').classList.remove('hidden');
  const validationDiv = document.getElementById('validation-summary');
  const expected = ['surgeon_confirm', 'surgeon_name', 'surgeon_loc', 'itnm_date_verify', 'resched_date',
                    'prov_device', 'device_name', 'implant_leg', 'oab_q1', 'oab_q1_fup', 'pgi_i',
                    'pads_day', 'pads_day_fup', 'leaks_num', 'complications', 'complic_pat'];
  const missing = expected.filter(c => !headers.includes(c));
  const unassigned = (providers['Unassigned (no surgeon recorded)'] || { patients: [] }).patients.length;

  let html = '';
  if (missing.length) {
    html += `<div class="alert alert-warning"><span class="alert-icon">&#x26A0;</span><div><strong>Note:</strong> Could not find expected REDCap variable(s): <code>${missing.join(', ')}</code>. Some fields may be blank in dashboards. See the <a href="sample-redcap-template.csv" download>column template</a>.</div></div>`;
  } else {
    html += `<div class="alert alert-success"><span class="alert-icon">&#x2705;</span><div>All expected REDCap variables found. Data looks good.</div></div>`;
  }
  if (unassigned) {
    html += `<div class="alert alert-warning"><span class="alert-icon">&#x26A0;</span><div>${unassigned} patient(s) have no surgeon recorded (<code>surgeon_confirm</code> or <code>surgeon_name</code>) and are grouped under &ldquo;Unassigned&rdquo;. Confirm their surgeon in REDCap so they appear on the right dashboard.</div></div>`;
  }
  validationDiv.innerHTML = html;

  // Preview table — parsed patient summary (what dashboards will show)
  const previewWrap = document.getElementById('preview-table-wrap');
  previewWrap.innerHTML = `<table>
    <thead><tr><th>Record</th><th>Surgeon</th><th>Location</th><th>Device</th><th>Implant Date</th><th>Status</th><th>OAB-q Baseline</th><th>OAB-q Latest</th><th>PGI-I</th><th>Complication</th></tr></thead>
    <tbody>${patients.map(p => {
      const latestOabq = p.oabq_12mo ?? p.oabq_6mo ?? p.oabq_3mo ?? p.oabq_1mo;
      return `<tr>
        <td><code style="font-size:0.8rem;">${escHtml(p.record_id)}</code></td>
        <td>${escHtml(p._surgeon || '—')}</td>
        <td>${escHtml(p._institution || '—')}</td>
        <td>${deviceBadgeHTML(p.device)}</td>
        <td>${escHtml(p.implant_date || '—')}</td>
        <td>${statusBadgeHTML(p.status)}</td>
        <td>${p.oabq_baseline != null ? p.oabq_baseline : '—'}</td>
        <td>${latestOabq != null ? latestOabq : '—'}</td>
        <td>${pgiiText(p.pgii_latest)}</td>
        <td>${p.complication_yn === 'yes' ? '<span class="badge badge-red">Yes</span>' : '<span class="badge badge-green">No</span>'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;

  // Step 3
  document.getElementById('step3-card').classList.remove('hidden');
  renderProviderDashboardList(providers); // async — builds JSON in background
}

// Called once CSV is parsed — builds the provider list and the Download JSON button
async function renderProviderDashboardList(providers) {
  const list = document.getElementById('provider-dashboard-list');
  if (!list) return;

  const providerEntries = Object.entries(providers);
  if (providerEntries.length === 0) {
    list.innerHTML = '<p style="color:var(--text-light);">No providers found in data.</p>';
    return;
  }

  // Auto-fill missing emails from the registered-provider sheet (if loaded)
  const regs = window._providerData || null;
  if (regs) {
    providerEntries.forEach(([name, pdata]) => {
      if (!pdata.provider_email && !name.startsWith('Unassigned')) {
        const m = matchRegistration(name, regs);
        if (m && m['Email']) pdata.provider_email = String(m['Email']).trim().toLowerCase();
      }
    });
  }

  // REDCap exports carry no provider email — surgeons must be matched to a
  // registered email (their dashboard login) before their dashboard can be built
  const missing = providerEntries.filter(([n, p]) => !p.provider_email && !n.startsWith('Unassigned'));

  // Build the all-providers JSON (async, hashes each email)
  const json = await buildProviderDataJSON(providers);
  const jsonStr = JSON.stringify(json, null, 2);
  const providerCount = Object.keys(json.providers).length;

  list.innerHTML = `
    <div class="alert ${missing.length ? 'alert-warning' : 'alert-success'}" style="margin-bottom:16px;">
      <span class="alert-icon">${missing.length ? '&#x26A0;' : '&#x2705;'}</span>
      <div>
        <strong>${providerCount} provider dashboard${providerCount !== 1 ? 's' : ''} ready.</strong>
        The REDCap export identifies surgeons by name only, so each surgeon must be matched to the
        email they registered with (their dashboard login).
        ${regs ? '' : '<br/>Tip: click <strong>Load Providers</strong> above first to auto-match surgeons against the registration sheet.'}
        ${missing.length ? `<br/><span style="color:#7a5400;">&#x26A0; ${missing.length} surgeon(s) not yet matched to an email — fill in the box under their name and click <strong>Save emails &amp; rebuild</strong>. Unmatched surgeons are left out of the dashboard file: ${missing.map(([n]) => escHtml(n)).join(', ')}</span>` : ''}
      </div>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
      <button class="btn btn-primary" onclick="downloadProviderDataJSON()">
        &#x2B07; Download provider-data.json
      </button>
      <button class="btn btn-sm" style="background:var(--sand);color:var(--cardinal);border:1px solid var(--border);align-self:center;" onclick="applyProviderEmails()">
        &#x1F4BE; Save emails &amp; rebuild
      </button>
      <span style="font-size:0.82rem;color:var(--text-light);align-self:center;">
        Deploy this single file as <code>data/provider-data.json</code> to update all ${providerCount} provider dashboards at once
      </span>
    </div>

    <div style="font-size:0.88rem;font-weight:700;color:var(--cool-grey);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:10px;">
      All Surgeons — click Preview to inspect any individual dashboard
    </div>

    ${providerEntries.map(([name, pdata]) => {
      const pts = pdata.patients || [];
      const implanted = pts.filter(p => p.implant_date).length;
      const comps = pts.filter(p => p.complication_yn === 'yes').length;
      const revi = pts.filter(p => (p.device||'').toLowerCase().includes('revi')).length;
      const ecoin = pts.filter(p => (p.device||'').toLowerCase().includes('ecoin')).length;
      const altaviva = pts.filter(p => (p.device||'').toLowerCase().includes('altaviva')).length;
      const unassigned = name.startsWith('Unassigned');
      const safeName = escHtml(name);
      return `<div class="provider-list-item">
        <div style="flex:1;min-width:200px;">
          <strong>${safeName}</strong>
          ${pdata.institution ? `<span style="color:var(--text-light);font-size:0.85rem;"> &bull; ${escHtml(pdata.institution)}</span>` : ''}
          ${!pdata.provider_email && !unassigned ? `<span class="badge badge-yellow" style="margin-left:6px;">needs email</span>` : ''}
          <div style="font-size:0.8rem;color:var(--text-light);margin-top:3px;">
            ${pts.length} patient(s) &bull; ${implanted} implanted &bull;
            ${revi ? `Revi: ${revi}` : ''}${ecoin ? ` eCoin: ${ecoin}` : ''}${altaviva ? ` Altaviva: ${altaviva}` : ''} &bull;
            ${comps} complication${comps !== 1 ? 's' : ''}
          </div>
          ${unassigned ? '' : `<input type="email" class="prov-email-input" data-key="${encodeURIComponent(name)}"
            value="${escHtml(pdata.provider_email)}" placeholder="registered email, e.g. name@institution.edu"
            style="margin-top:6px;width:100%;max-width:320px;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.85rem;" />`}
        </div>
        <button class="btn btn-sm btn-primary" data-key="${encodeURIComponent(name)}"
                onclick="previewProviderDashboard(decodeURIComponent(this.dataset.key))">
          &#x1F50D; Preview Dashboard
        </button>
      </div>`;
    }).join('')}
  `;

  // Store JSON string globally for the download button
  window._providerDataJSON = jsonStr;
}

// Reads the email inputs, persists the surgeon→email map, and rebuilds the JSON
function applyProviderEmails() {
  const map = getProviderEmailMap();
  document.querySelectorAll('.prov-email-input').forEach(inp => {
    const key = decodeURIComponent(inp.dataset.key);
    const email = inp.value.trim().toLowerCase();
    if (_parsedProviders[key]) _parsedProviders[key].provider_email = email;
    if (email) map[key.toLowerCase()] = email;
    else delete map[key.toLowerCase()];
  });
  saveProviderEmailMap(map);
  renderProviderDashboardList(_parsedProviders);
}

async function buildProviderDataJSON(providers) {
  const result = { generated: new Date().toISOString(), version: 1, providers: {} };
  for (const [name, pdata] of Object.entries(providers)) {
    const email = (pdata.provider_email || '').toLowerCase().trim();
    if (!email) continue;
    const hash = await hashEmail(email);
    result.providers[hash] = {
      display_name: pdata.provider_name || name,
      institution: pdata.institution || '',
      patients: pdata.patients || []
    };
  }
  return result;
}

function downloadProviderDataJSON() {
  if (!window._providerDataJSON) { alert('No data ready. Please upload a REDCap CSV first.'); return; }
  downloadFile(window._providerDataJSON, 'provider-data.json', 'application/json');
}

// Surgeon names come from patient-entered REDCap text, so the button passes
// only the name (via a data attribute) and the data is looked up here
function previewProviderDashboard(name) {
  const pdata = _parsedProviders[name];
  if (!pdata) { alert('Could not open preview: surgeon not found. Re-upload the CSV.'); return; }
  sessionStorage.setItem('itnm_admin_preview', JSON.stringify({
    display_name: pdata.provider_name || name,
    institution: pdata.institution || '',
    patients: pdata.patients
  }));
  window.open('dashboard.html?preview=1', '_blank');
}

// ─── Feedback helper ───

function showUploadFeedback(type, msg) {
  const el = document.getElementById('upload-feedback');
  if (!el) return;
  el.classList.remove('hidden');
  el.innerHTML = `<div class="alert alert-${type === 'success' ? 'success' : 'warning'}">
    <span class="alert-icon">${type === 'success' ? '&#x2705;' : '&#x26A0;'}</span>
    <div>${msg}</div>
  </div>`;
}

// ══════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════

// ─── QR Code Download ───

function downloadQR(containerId, filename) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const img = container.querySelector('img');
  const canvas = container.querySelector('canvas');
  let src = null;
  if (canvas) {
    src = canvas.toDataURL('image/png');
  } else if (img) {
    src = img.src;
  }
  if (!src) { alert('QR code not ready yet. Please wait a moment and try again.'); return; }
  const a = document.createElement('a');
  a.href = src;
  a.download = (filename || 'qr-code') + '.png';
  a.click();
}

function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Dashboard link copied to clipboard:\n' + text);
  }).catch(() => {
    prompt('Copy this link:', text);
  });
}

// ══════════════════════════════════════════════
// DEMO DATA — shown when no real data is loaded
// ══════════════════════════════════════════════

function getDemoRegistration() {
  return {
    first_name: 'Sample',
    last_name: 'Provider',
    credentials: 'MD',
    institution: 'Demo Medical Center (sample data)',
  };
}

function getDemoData() {
  const devices = ['Revi', 'Revi', 'Revi', 'eCoin', 'eCoin', 'Revi', 'eCoin', 'Revi', 'eCoin', 'Revi', 'Revi', 'eCoin'];
  const sides = ['Left', 'Right', 'Left', 'Right', 'Left', 'Right', 'Left', 'Right', 'Left', 'Right', 'Left', 'Right'];
  const statuses = ['12mo_complete','12mo_complete','6mo_complete','6mo_complete','3mo_complete','3mo_complete','1mo_complete','implanted','enrolled','12mo_complete','6mo_complete','3mo_complete'];
  const dates = ['2025-03-10','2025-03-22','2025-04-05','2025-05-14','2025-06-01','2025-06-20','2025-07-08','2025-08-02','2025-09-15','2025-10-01','2025-11-12','2026-01-09'];
  const complications = [false,false,false,false,false,true,false,false,false,false,false,false];
  const compTypes = [null,null,null,null,null,'Infection',null,null,null,null,null,null];
  const baseOABQ = [72,68,80,65,77,70,82,58,75,69,73,85];
  const oabq1 = [60,55,70,54,null,62,74,null,null,58,62,null];
  const oabq3 = [48,44,58,42,null,50,null,null,null,46,51,null];
  const oabq6 = [38,35,45,null,null,40,null,null,null,36,null,null];
  const oabq12 = [30,28,null,null,null,null,null,null,null,29,null,null];
  const pgii1 = ['2','2','2','3',null,'3','3',null,null,'1','2',null];
  const pgii3 = ['1','2','2','2',null,'3',null,null,null,'1','2',null];
  const pgii6 = ['1','1','2',null,null,'3',null,null,null,'1',null,null];
  const padsBase = [3,4,2,3,5,4,3,2,4,3,3,5];
  const pads6 = [1,1,1,null,null,2,null,null,null,1,null,null];
  const urgBase = [8,6,10,7,9,8,11,5,8,7,9,12];
  const urg6 = [3,2,4,null,null,5,null,null,null,2,null,null];

  return {
    patients: devices.map((dev, i) => ({
      record_id: `ITNM-${String(i + 1).padStart(3, '0')}`,
      patient_id: `ITNM-${String(i + 1).padStart(3, '0')}`,
      implant_date: dates[i],
      device: dev,
      implant_side: sides[i],
      status: statuses[i],
      complication_yn: complications[i] ? 'yes' : 'no',
      complication_type: compTypes[i],
      complication_timing: complications[i] ? 'Postoperative' : null,
      clavien_dindo: complications[i] ? 'II' : null,
      complication_notes: complications[i] ? 'Superficial wound infection, treated with oral antibiotics' : null,
      oabq_baseline: baseOABQ[i],
      oabq_1mo: oabq1[i],
      oabq_3mo: oabq3[i],
      oabq_6mo: oabq6[i],
      oabq_12mo: oabq12[i],
      pgii_1mo: pgii1[i],
      pgii_3mo: pgii3[i],
      pgii_6mo: pgii6[i],
      pgii_12mo: null,
      pgii_latest: pgii6[i] || pgii3[i] || pgii1[i],
      pads_baseline: padsBase[i],
      pads_6mo: pads6[i],
      urgency_episodes_baseline: urgBase[i],
      urgency_episodes_6mo: urg6[i],
    }))
  };
}
