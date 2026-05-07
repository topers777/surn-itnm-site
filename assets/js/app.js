/* ─────────────────────────────────────────────
   SURN ITNM Registry — app.js
   Handles: registration → Formsubmit.co, REDCap
            CSV parsing, dashboard rendering, charts
   ───────────────────────────────────────────── */

// ── Google Apps Script endpoint ──
// After deploying google-apps-script.js as a Web App, paste
// the deployment URL here. Leave blank to test locally.
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxoFSCe4MxhceXgccba16reWjlhbERQxIz0SJ4Bq4utMoxDdxYBXnKbNOaQCbws4aVi/exec';

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

    try {
      if (APPS_SCRIPT_URL && APPS_SCRIPT_URL !== 'PASTE_YOUR_WEB_APP_URL_HERE') {
        // no-cors avoids CORS preflight; response is opaque but the script runs
        fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          mode: 'no-cors',
          body: JSON.stringify(data)
        }).catch(() => {});
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
    if (!providerData) {
      errorEl.textContent = 'Email not found in the registry. Check your email or contact SUFUResearch@stanford.edu.';
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
      errorEl.innerHTML = 'Data file not yet deployed. Upload REDCap data via the <a href="admin.html">Admin</a> page, then deploy <code>data/provider-data.json</code>.';
    } else {
      errorEl.textContent = 'Could not load dashboard. Please try again or contact SUFUResearch@stanford.edu.';
    }
    return;
  }
  spinner.style.display = 'none';
}

function signOut() {
  sessionStorage.removeItem('itnm_dashboard_email');
  document.getElementById('dashboard-state').classList.add('hidden');
  document.getElementById('lookup-gate').classList.remove('hidden');
  document.getElementById('lookup-email').value = '';
}

function renderDashboard(data, generated) {
  document.getElementById('dashboard-state').classList.remove('hidden');

  // "Last updated" label
  if (generated) {
    const el = document.getElementById('data-updated');
    if (el) el.textContent = 'Data as of ' + new Date(generated).toLocaleDateString();
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
    const f = bucket(p.pads_6mo ?? p.pads_3mo);
    if (b) baselineCounts[categories.indexOf(b)]++;
    if (f) followupCounts[categories.indexOf(f)]++;
  });

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [
        { label: 'Baseline', data: baselineCounts, backgroundColor: 'rgba(140,21,21,0.6)', borderRadius: 4 },
        { label: '6-month', data: followupCounts, backgroundColor: 'rgba(23,94,84,0.7)', borderRadius: 4 }
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
    const f = bucket(p.urgency_episodes_6mo ?? p.urgency_episodes_3mo);
    if (b) baselineCounts[categories.indexOf(b)]++;
    if (f) followupCounts[categories.indexOf(f)]++;
  });

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: categories,
      datasets: [
        { label: 'Baseline', data: baselineCounts, backgroundColor: 'rgba(140,21,21,0.6)', borderRadius: 4 },
        { label: '6-month', data: followupCounts, backgroundColor: 'rgba(23,94,84,0.7)', borderRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, title: { display: true, text: 'Patients' } },
                 x: { title: { display: true, text: 'Daily urgency episodes' } } }
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
  return map[String(val)] || val;
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
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-light);padding:24px;">No complications recorded.</td></tr>';
    return;
  }

  tbody.innerHTML = withComp.map(p => `<tr>
    <td><code style="font-size:0.82rem;">${escHtml(p.record_id || p.patient_id || '—')}</code></td>
    <td>${deviceBadgeHTML(p.device)}</td>
    <td>${escHtml(p.implant_date || '—')}</td>
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

  // Load registered providers
  renderRegisteredProviders();
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
      const result = parseREDCapCSV(text);
      displayPreview(result);
    } catch (err) {
      showUploadFeedback('error', 'Error parsing CSV: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function parseREDCapCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV appears empty.');

  const headers = parseCSVRow(lines[0]);
  const rows = lines.slice(1).filter(l => l.trim()).map(l => {
    const vals = parseCSVRow(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] || '').trim(); });
    return obj;
  });

  // Group by provider
  const providerKey = findColumn(headers, ['provider_name', 'provider', 'site_name', 'investigator_name']);
  const providerEmail = findColumn(headers, ['provider_email', 'investigator_email', 'site_email']);

  const providers = {};
  rows.forEach(row => {
    const pName = row[providerKey] || row[providerEmail] || 'Unknown Provider';
    if (!providers[pName]) {
      providers[pName] = {
        provider_name: pName,
        provider_email: row[providerEmail] || '',
        institution: row[findColumn(headers, ['institution', 'site', 'hospital'])] || '',
        patients: []
      };
    }
    providers[pName].patients.push(mapREDCapRow(row, headers));
  });

  return { headers, rows, providers };
}

function mapREDCapRow(row, headers) {
  // Flexible column mapping — handles both exact names and common REDCap variants
  function get(...keys) {
    for (const k of keys) {
      const found = findColumn(headers, [k]);
      if (found && row[found] !== undefined && row[found] !== '') return row[found];
    }
    return undefined;
  }

  return {
    record_id: get('record_id', 'patient_id', 'id'),
    patient_id: get('patient_id', 'record_id', 'id'),
    implant_date: get('implant_date', 'surgery_date', 'procedure_date'),
    device: get('device', 'implant_type', 'device_type'),
    implant_side: get('implant_side', 'side', 'leg_side'),
    status: get('status', 'patient_status', 'enrollment_status') || 'enrolled',
    complication_yn: get('complication_yn', 'complication', 'any_complication'),
    complication_type: get('complication_type', 'complication_detail', 'complication_types'),
    complication_timing: get('complication_timing', 'timing'),
    clavien_dindo: get('clavien_dindo', 'clavien'),
    complication_notes: get('complication_notes', 'notes'),
    oabq_baseline: parseScore(get('oabq_baseline', 'oabq_sx_baseline', 'oabq_bother_baseline')),
    oabq_1mo: parseScore(get('oabq_1mo', 'oabq_sx_1mo', 'oabq_1month')),
    oabq_3mo: parseScore(get('oabq_3mo', 'oabq_sx_3mo', 'oabq_3month')),
    oabq_6mo: parseScore(get('oabq_6mo', 'oabq_sx_6mo', 'oabq_6month')),
    oabq_12mo: parseScore(get('oabq_12mo', 'oabq_sx_12mo', 'oabq_12month')),
    pgii_1mo: get('pgii_1mo', 'pgic_1mo', 'pgii_1month'),
    pgii_3mo: get('pgii_3mo', 'pgic_3mo', 'pgii_3month'),
    pgii_6mo: get('pgii_6mo', 'pgic_6mo', 'pgii_6month'),
    pgii_12mo: get('pgii_12mo', 'pgic_12mo', 'pgii_12month'),
    pgii_latest: get('pgii_latest', 'pgii_most_recent'),
    pads_baseline: parseScore(get('pads_baseline', 'pads_day_baseline')),
    pads_6mo: parseScore(get('pads_6mo', 'pads_day_6mo')),
    urgency_episodes_baseline: parseScore(get('urgency_episodes_baseline', 'urgency_baseline', 'uui_baseline')),
    urgency_episodes_6mo: parseScore(get('urgency_episodes_6mo', 'urgency_6mo', 'uui_6mo')),
  };
}

function findColumn(headers, candidates) {
  for (const c of candidates) {
    const found = headers.find(h => h.trim().toLowerCase() === c.toLowerCase());
    if (found) return found;
  }
  // Partial match fallback
  for (const c of candidates) {
    const found = headers.find(h => h.trim().toLowerCase().includes(c.toLowerCase()));
    if (found) return found;
  }
  return candidates[0];
}

function parseScore(val) {
  if (val === undefined || val === null || val === '') return undefined;
  const n = parseFloat(val);
  return isNaN(n) ? undefined : n;
}

function parseCSVRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function displayPreview({ headers, rows, providers }) {
  _parsedProviders = providers;

  // Feedback
  showUploadFeedback('success', `Loaded ${rows.length} patient records across ${Object.keys(providers).length} provider(s).`);

  // Step 2
  document.getElementById('step2-card').classList.remove('hidden');
  const validationDiv = document.getElementById('validation-summary');
  const missing = ['record_id', 'implant_date', 'device', 'provider_name'].filter(
    req => !headers.some(h => h.toLowerCase().includes(req.replace('_', '').toLowerCase()) || h.toLowerCase() === req)
  );
  if (missing.length) {
    validationDiv.innerHTML = `<div class="alert alert-warning"><span class="alert-icon">&#x26A0;</span><div><strong>Note:</strong> Could not find columns matching: <code>${missing.join(', ')}</code>. Some fields may be blank in dashboards. See the <a href="sample-redcap-template.csv" download>column template</a>.</div></div>`;
  } else {
    validationDiv.innerHTML = `<div class="alert alert-success"><span class="alert-icon">&#x2705;</span><div>All expected columns found. Data looks good.</div></div>`;
  }

  // Preview table (first 8 rows, first 10 cols)
  const previewCols = headers.slice(0, 10);
  const previewWrap = document.getElementById('preview-table-wrap');
  previewWrap.innerHTML = `<table>
    <thead><tr>${previewCols.map(h => `<th>${escHtml(h)}</th>`).join('')}${headers.length > 10 ? `<th>+${headers.length - 10} more...</th>` : ''}</tr></thead>
    <tbody>${rows.slice(0, 8).map(row => `<tr>${previewCols.map(h => `<td>${escHtml(row[h] || '')}</td>`).join('')}${headers.length > 10 ? '<td>...</td>' : ''}</tr>`).join('')}</tbody>
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

  // Identify providers missing an email (they won't appear in dashboards)
  const missing = providerEntries.filter(([, p]) => !p.provider_email);

  // Build the all-providers JSON (async, hashes each email)
  const json = await buildProviderDataJSON(providers);
  const jsonStr = JSON.stringify(json, null, 2);
  const providerCount = Object.keys(json.providers).length;

  list.innerHTML = `
    <div class="alert alert-success" style="margin-bottom:16px;">
      <span class="alert-icon">&#x2705;</span>
      <div>
        <strong>${providerCount} provider dashboard${providerCount !== 1 ? 's' : ''} ready.</strong>
        Download the file below and place it at <code>data/provider-data.json</code> on your server.
        Every provider's dashboard will update automatically — no links to re-send.
        ${missing.length ? `<br/><span style="color:var(--warning);">&#x26A0; ${missing.length} provider(s) have no email in REDCap and will not appear in dashboards: ${missing.map(([n]) => escHtml(n)).join(', ')}</span>` : ''}
      </div>
    </div>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
      <button class="btn btn-primary" onclick="downloadProviderDataJSON()">
        &#x2B07; Download provider-data.json
      </button>
      <span style="font-size:0.82rem;color:var(--text-light);align-self:center;">
        Deploy this single file to update all ${providerCount} provider dashboards at once
      </span>
    </div>

    <div style="font-size:0.88rem;font-weight:700;color:var(--cool-grey);text-transform:uppercase;letter-spacing:0.4px;margin-bottom:10px;">
      All Providers — click Preview to inspect any individual dashboard
    </div>

    ${providerEntries.map(([name, pdata]) => {
      const pts = pdata.patients || [];
      const implanted = pts.filter(p => p.implant_date).length;
      const comps = pts.filter(p => p.complication_yn === 'yes').length;
      const revi = pts.filter(p => (p.device||'').toLowerCase().includes('revi')).length;
      const ecoin = pts.filter(p => (p.device||'').toLowerCase().includes('ecoin')).length;
      const altaviva = pts.filter(p => (p.device||'').toLowerCase().includes('altaviva')).length;
      const hasEmail = !!pdata.provider_email;
      const safeName = escHtml(name);
      const safeDataAttr = encodeURIComponent(JSON.stringify({
        display_name: pdata.provider_name || name,
        institution: pdata.institution || '',
        patients: pdata.patients
      }));
      return `<div class="provider-list-item">
        <div style="flex:1;min-width:200px;">
          <strong>${safeName}</strong>
          ${pdata.institution ? `<span style="color:var(--text-light);font-size:0.85rem;"> &bull; ${escHtml(pdata.institution)}</span>` : ''}
          ${!hasEmail ? `<span class="badge badge-yellow" style="margin-left:6px;">no email</span>` : ''}
          <div style="font-size:0.8rem;color:var(--text-light);margin-top:3px;">
            ${pts.length} patient(s) &bull; ${implanted} implanted &bull;
            ${revi ? `Revi: ${revi}` : ''}${ecoin ? ` eCoin: ${ecoin}` : ''}${altaviva ? ` Altaviva: ${altaviva}` : ''} &bull;
            ${comps} complication${comps !== 1 ? 's' : ''}
          </div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="previewProviderDashboard(decodeURIComponent('${safeDataAttr}'))">
          &#x1F50D; Preview Dashboard
        </button>
      </div>`;
    }).join('')}
  `;

  // Store JSON string globally for the download button
  window._providerDataJSON = jsonStr;
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

function previewProviderDashboard(dataStr) {
  try {
    const data = JSON.parse(dataStr);
    sessionStorage.setItem('itnm_admin_preview', JSON.stringify(data));
    window.open('dashboard.html?preview=1', '_blank');
  } catch (e) {
    alert('Could not open preview: ' + e.message);
  }
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
