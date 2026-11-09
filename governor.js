/* =============================================
   Governor Workbench - JavaScript Engine
   All calculations, Chart.js graphs, Variac Lab Log,
   2D CAD Schematics & Matplotlib 3D API Bridge
   ============================================= */

// ──── Global State ────
let currentGovernor = 'hartnell';
let charts = {};
let lastResult = null;
let autoSpeedTimer = null;
let autoSpeedDir = 1;
let activeTab = 'twin';
let recordedReadings = [];
let lastMplSignature = '';

const GOV_META = {
    watt:     { name: 'Watt Governor',     tag: 'Gravity Controlled' },
    porter:   { name: 'Porter Governor',   tag: 'Dead Weight' },
    proell:   { name: 'Proell Governor',   tag: 'Extended Link' },
    hartnell: { name: 'Hartnell Governor', tag: 'Spring Controlled' }
};


// ──── Apple Sliding Indicators & Slider Fill ────
function syncSlidingIndicators() {
    const activeGov = document.querySelector('#govSwitcher .gov-tab.active');
    const govThumb = document.getElementById('govSegThumb');
    if (activeGov && govThumb && activeGov.offsetWidth > 0) {
        govThumb.style.width = `${activeGov.offsetWidth}px`;
        govThumb.style.transform = `translateX(${activeGov.offsetLeft}px)`;
    }

    const activeWs = document.querySelector('#workspaceTabs .ws-tab.active');
    const wsInd = document.getElementById('wsTabIndicator');
    if (activeWs && wsInd && activeWs.offsetWidth > 0) {
        wsInd.style.width = `${activeWs.offsetWidth}px`;
        wsInd.style.transform = `translateX(${activeWs.offsetLeft}px)`;
    }
}

function updateSpeedSliderTrack() {
    const slider = document.getElementById('speedSlider');
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 400;
    const val = parseFloat(slider.value) || 0;
    const pct = max > min ? Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100)) : 0;
    slider.style.background = `linear-gradient(90deg, #0a84ff 0%, #0a84ff ${pct}%, rgba(255, 255, 255, 0.14) ${pct}%, rgba(255, 255, 255, 0.14) 100%)`;
}


// ──── Workspace Tab Navigation ────
function switchWorkspaceTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.ws-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === `tab-${tabName}`);
    });
    requestAnimationFrame(syncSlidingIndicators);

    if (tabName === 'twin') {
        if (window.virtualTwin) window.virtualTwin.onResize();
        if (lastResult) drawSchematic(lastResult);
    } else if (tabName === 'charts') {
        if (lastResult) renderCharts(lastResult);
    } else if (tabName === 'matplotlib') {
        const sig = `${currentGovernor}:${JSON.stringify(getParams())}:${document.getElementById('speedSlider')?.value || ''}`;
        if (sig !== lastMplSignature) {
            loadMatplotlibSim(currentMplMode || 'snapshot');
        }
    }
}


// ──── Governor Selection ────
function selectGovernor(type) {
    const changed = currentGovernor !== type;
    currentGovernor = type;
    stopAutoSpeed();

    if (changed) {
        recordedReadings = [];
        renderRecordedLog();
        const noticeEl = document.getElementById('variac-notice');
        if (noticeEl) noticeEl.style.display = 'none';
    }

    // Update top switcher buttons
    document.querySelectorAll('.gov-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.type === type);
    });
    requestAnimationFrame(syncSlidingIndicators);

    // Show relevant param group
    document.querySelectorAll('.param-group').forEach(g => g.style.display = 'none');
    const groupEl = document.getElementById(`${type}-params`);
    if (groupEl) groupEl.style.display = 'block';

    // Update sidebar header
    const meta = GOV_META[type] || { name: type, tag: '' };
    const titleEl = document.getElementById('currentType');
    const tagEl = document.getElementById('typeClassification');
    if (titleEl) titleEl.textContent = meta.name;
    if (tagEl) tagEl.textContent = meta.tag;

    const params = getParams();
    syncSliderRange(params);

    if (window.setTwinGovernor) {
        window.setTwinGovernor(type, params);
        const initSpeed = parseFloat(document.getElementById('speedSlider')?.value) || 200;
        window.setTwinSpeed(initSpeed);
    }

    runCalculation();
}

function syncSliderRange(params) {
    const slider = document.getElementById('speedSlider');
    const valSpan = document.getElementById('speedValue');
    if (!slider) return;
    const Nmin = params.N_min || 100;
    const Nmax = params.N_max || 300;
    const maxLimit = Math.max(400, Math.ceil((Nmax * 1.25) / 50) * 50);
    slider.min = 0;
    slider.max = maxLimit;
    const mid = Math.round((Nmin + Nmax) / 2);
    slider.value = mid;
    if (valSpan) valSpan.textContent = mid;
    updateSpeedSliderTrack();
}

function resetParams() {
    if (!currentGovernor) return;
    const defaults = {
        watt: { ball_mass: 2.0, arm_length: 0.30, N_min: 100, N_max: 300, N_steps: 20 },
        porter: { ball_mass: 2.0, sleeve_mass: 5.0, arm_length: 0.30, link_length: 0.30, q: 1.0, N_min: 100, N_max: 300, N_steps: 20 },
        proell: { ball_mass: 2.0, sleeve_mass: 5.0, arm_length: 0.30, link_length: 0.30, extension: 0.05, q: 1.0, N_min: 100, N_max: 300, N_steps: 20 },
        hartnell: { ball_mass: 0.45, sleeve_mass: 2.1, mass_added: 0.14, vertical_arm: 75, horizontal_arm: 95, initial_radius: 132.5, free_length: 154, compressed_length: 145, N_min: 150, N_max: 350, N_steps: 20 }
    };
    const d = defaults[currentGovernor];
    for (const [key, val] of Object.entries(d)) {
        const el = document.getElementById(`${currentGovernor}_${key}`);
        if (el) el.value = val;
    }
    const params = getParams();
    syncSliderRange(params);
    if (window.updateTwinParams) window.updateTwinParams(params);
    runCalculation();
}


// ──── Gather Parameters ────
function getParams() {
    const p = {};
    const prefix = currentGovernor;
    document.querySelectorAll(`#${prefix}-params input`).forEach(input => {
        const key = input.id.replace(`${prefix}_`, '');
        p[key] = parseFloat(input.value);
    });
    return p;
}


// ──── Mathematical Models (Client-Side) ────

function numOr(v, fallback) {
    return (typeof v === 'number' && !isNaN(v)) ? v : fallback;
}

function calcWatt(params) {
    const m = Math.max(0.01, numOr(params.ball_mass, 2.0));
    const L = Math.max(0.02, numOr(params.arm_length, 0.3));
    const Nmin = Math.max(1, numOr(params.N_min, 100));
    const Nmax = Math.max(Nmin + 1, numOr(params.N_max, 300));
    const steps = Math.max(2, Math.min(100, Math.round(numOr(params.N_steps, 20))));
    const g = 9.81;

    const speeds = [], heights = [], radii = [], forces = [], omegas = [];

    for (let i = 0; i <= steps; i++) {
        const N = Nmin + i * (Nmax - Nmin) / steps;
        const omega = 2 * Math.PI * N / 60;
        let h = g / (omega * omega);
        if (h > L) h = L;
        let r = Math.sqrt(Math.max(0, L * L - h * h));
        const Fc = m * omega * omega * r;

        speeds.push(+N.toFixed(2));
        omegas.push(+omega.toFixed(4));
        heights.push(+(h * 1000).toFixed(4));   // mm
        radii.push(+(r * 1000).toFixed(4));      // mm
        forces.push(+Fc.toFixed(4));
    }

    const sensitivity = 2 * (Nmax - Nmin) / (Nmax + Nmin);
    return {
        speeds, omega: omegas, heights, radii, centrifugal_forces: forces,
        sleeve_positions: heights,
        sensitivity: +sensitivity.toFixed(6),
        speed_range: +(Nmax - Nmin).toFixed(2),
        mean_speed: +((Nmax + Nmin) / 2).toFixed(2),
        coeff_insensitiveness: +((Nmax - Nmin) / ((Nmax + Nmin) / 2)).toFixed(6),
        governor_type: 'Watt Governor',
        formulas: {
            height: 'h = g / ω² = 895 / N²  (metres)',
            centrifugal_force: 'F꜀ = m · ω² · r',
            radius: 'r = √(L² − h²)',
            sensitivity: 'Sensitivity = 2(N₂ − N₁) / (N₂ + N₁)'
        }
    };
}

function calcPorter(params) {
    const m = Math.max(0.01, numOr(params.ball_mass, 2.0));
    const M = Math.max(0, numOr(params.sleeve_mass, 5.0));
    const L = Math.max(0.02, numOr(params.arm_length, 0.3));
    const q = Math.max(0.05, numOr(params.q, 1.0));
    const Nmin = Math.max(1, numOr(params.N_min, 100));
    const Nmax = Math.max(Nmin + 1, numOr(params.N_max, 300));
    const steps = Math.max(2, Math.min(100, Math.round(numOr(params.N_steps, 20))));
    const g = 9.81;

    const speeds = [], heights = [], radii = [], forces = [], omegas = [], sleeveLift = [];
    let h0 = null;

    for (let i = 0; i <= steps; i++) {
        const N = Nmin + i * (Nmax - Nmin) / steps;
        const omega = 2 * Math.PI * N / 60;
        let h = ((m + M * (1 + q)) / m) * (g / (omega * omega));
        if (h > L) h = L;
        let r = Math.sqrt(Math.max(0, L * L - h * h));
        const Fc = m * omega * omega * r;
        if (h0 === null) h0 = h;
        const sl = Math.max(0, 2 * (h0 - h) * 1000);

        speeds.push(+N.toFixed(2));
        omegas.push(+omega.toFixed(4));
        heights.push(+(h * 1000).toFixed(4));
        radii.push(+(r * 1000).toFixed(4));
        forces.push(+Fc.toFixed(4));
        sleeveLift.push(+sl.toFixed(4));
    }

    const sensitivity = 2 * (Nmax - Nmin) / (Nmax + Nmin);
    return {
        speeds, omega: omegas, heights, radii, centrifugal_forces: forces,
        sleeve_lifts: sleeveLift,
        sensitivity: +sensitivity.toFixed(6),
        speed_range: +(Nmax - Nmin).toFixed(2),
        mean_speed: +((Nmax + Nmin) / 2).toFixed(2),
        coeff_insensitiveness: +((Nmax - Nmin) / ((Nmax + Nmin) / 2)).toFixed(6),
        governor_type: 'Porter Governor',
        formulas: {
            height: 'h = [(m + M(1+q)) / m] × (g / ω²)',
            centrifugal_force: 'F꜀ = m · ω² · r',
            sleeve_lift: 's = 2(h₁ − h₂)',
            sensitivity: 'Sensitivity = 2(N₂ − N₁) / (N₂ + N₁)'
        }
    };
}

function calcProell(params) {
    const m = Math.max(0.01, numOr(params.ball_mass, 2.0));
    const M = Math.max(0, numOr(params.sleeve_mass, 5.0));
    const L = Math.max(0.02, numOr(params.arm_length, 0.3));
    const l = Math.max(0.02, numOr(params.link_length, 0.3));
    const e = Math.max(0, numOr(params.extension, 0.05));
    const q = Math.max(0.05, numOr(params.q, 1.0));
    const Nmin = Math.max(1, numOr(params.N_min, 100));
    const Nmax = Math.max(Nmin + 1, numOr(params.N_max, 300));
    const steps = Math.max(2, Math.min(100, Math.round(numOr(params.N_steps, 20))));
    const g = 9.81;
    const ext = 1 + e / l;

    const speeds = [], heights = [], radii = [], forces = [], omegas = [], sleeveLift = [];
    let h0 = null;

    for (let i = 0; i <= steps; i++) {
        const N = Nmin + i * (Nmax - Nmin) / steps;
        const omega = 2 * Math.PI * N / 60;
        let h = ((m + M * (1 + q)) / m) * ext * (g / (omega * omega));
        if (h > L) h = L;
        let r = Math.sqrt(Math.max(0, L * L - h * h));
        const Fc = m * omega * omega * r;
        if (h0 === null) h0 = h;
        const sl = Math.max(0, 2 * (h0 - h) * 1000);

        speeds.push(+N.toFixed(2));
        omegas.push(+omega.toFixed(4));
        heights.push(+(h * 1000).toFixed(4));
        radii.push(+(r * 1000).toFixed(4));
        forces.push(+Fc.toFixed(4));
        sleeveLift.push(+sl.toFixed(4));
    }

    const sensitivity = 2 * (Nmax - Nmin) / (Nmax + Nmin);
    return {
        speeds, omega: omegas, heights, radii, centrifugal_forces: forces,
        sleeve_lifts: sleeveLift,
        sensitivity: +sensitivity.toFixed(6),
        speed_range: +(Nmax - Nmin).toFixed(2),
        mean_speed: +((Nmax + Nmin) / 2).toFixed(2),
        coeff_insensitiveness: +((Nmax - Nmin) / ((Nmax + Nmin) / 2)).toFixed(6),
        governor_type: 'Proell Governor',
        formulas: {
            height: 'h = [(m + M(1+q)) / m] × (1 + e/l) × (g / ω²)',
            centrifugal_force: 'F꜀ = m · ω² · r',
            sleeve_lift: 's = 2(h₁ − h₂)',
            sensitivity: 'Sensitivity = 2(N₂ − N₁) / (N₂ + N₁)'
        }
    };
}

function calcHartnell(params) {
    const m = Math.max(0.01, numOr(params.ball_mass, 0.45));
    const m1 = Math.max(0, numOr(params.sleeve_mass, 2.1));
    const m2 = Math.max(0, numOr(params.mass_added, 0.14));
    const a = Math.max(1, numOr(params.vertical_arm, 75)) / 1000;   // mm to m
    const b = Math.max(1, numOr(params.horizontal_arm, 95)) / 1000;
    const R0 = Math.max(1, numOr(params.initial_radius, 132.5)) / 1000;
    const L0 = Math.max(1, numOr(params.free_length, 154)) / 1000;
    const L1 = Math.max(1, numOr(params.compressed_length, 145)) / 1000;
    const Nmin = Math.max(1, numOr(params.N_min, 150));
    const Nmax = Math.max(Nmin + 1, numOr(params.N_max, 350));
    const steps = Math.max(2, Math.min(100, Math.round(numOr(params.N_steps, 20))));
    const g = 9.81;
    const deltaInit = L0 - L1;
    const totalMass = m1 + m2;

    const speeds = [], omegas = [], radii = [], forces = [];
    const springForces = [], stiffnesses = [], sleeveDisps = [];

    for (let i = 0; i <= steps; i++) {
        const N = Nmin + i * (Nmax - Nmin) / steps;
        const omega = 2 * Math.PI * N / 60;

        // Sleeve displacement (mm) — proportional scaling
        const X = (N - Nmin) / (Nmax - Nmin) * 25; // 0 to 25 mm

        // Radius of rotation
        const R = R0 + (X / 1000) * (a / b);

        const Fc = m * omega * omega * R;
        const Fspring = 2 * Fc * (a / b) - totalMass * g;
        const delta = deltaInit + (X / 1000);
        const s = (Fspring > 0 && delta > 0) ? Fspring / (delta * 1000) : 0;

        speeds.push(+N.toFixed(2));
        omegas.push(+omega.toFixed(4));
        radii.push(+(R * 1000).toFixed(4));
        forces.push(+Fc.toFixed(4));
        springForces.push(+Math.max(0, Fspring).toFixed(4));
        sleeveDisps.push(+X.toFixed(4));
        stiffnesses.push(+s.toFixed(4));
    }

    // Overall stiffness
    const Rmax = R0 + 25 / 1000 * (a / b);
    const FcMin = m * Math.pow(2 * Math.PI * Nmin / 60, 2) * R0;
    const FcMax = m * Math.pow(2 * Math.PI * Nmax / 60, 2) * Rmax;
    const overallStiff = (Rmax !== R0) ? Math.pow(a / b, 2) * 2 * (FcMax - FcMin) / (Rmax - R0) : 0;

    const sensitivity = 2 * (Nmax - Nmin) / (Nmax + Nmin);
    return {
        speeds, omega: omegas, radii, centrifugal_forces: forces,
        spring_forces: springForces, spring_stiffnesses: stiffnesses,
        sleeve_displacements: sleeveDisps,
        overall_stiffness: +overallStiff.toFixed(4),
        sensitivity: +sensitivity.toFixed(6),
        speed_range: +(Nmax - Nmin).toFixed(2),
        mean_speed: +((Nmax + Nmin) / 2).toFixed(2),
        coeff_insensitiveness: +((Nmax - Nmin) / ((Nmax + Nmin) / 2)).toFixed(6),
        governor_type: 'Hartnell Governor',
        formulas: {
            centrifugal_force: 'F꜀ = m · ω² · R',
            radius: 'R = R₀ + X · (a / b)',
            spring_force: 'F_spring = 2·F꜀·(a/b) − (m₁+m₂)·g',
            stiffness: 's = (a/b)² × 2(F꜀₂ − F꜀₁) / (r₂ − r₁)'
        }
    };
}


// ──── Run Calculation ────
function runCalculation() {
    if (!currentGovernor) return;

    const params = getParams();
    let result;

    switch (currentGovernor) {
        case 'watt':     result = calcWatt(params); break;
        case 'porter':   result = calcPorter(params); break;
        case 'proell':   result = calcProell(params); break;
        case 'hartnell': result = calcHartnell(params); break;
    }

    lastResult = result;
    displayResults(result);

    // Sync 3D Virtual Twin with latest variable parameters
    if (window.updateTwinParams) {
        window.updateTwinParams(params);
        const speed = parseFloat(document.getElementById('speedSlider')?.value || 200);
        window.setTwinSpeed(speed);
    }

    lastMplSignature = '';
    if (activeTab === 'matplotlib') {
        loadMatplotlibSim(currentMplMode || 'snapshot');
    }
}


// ──── Display Results ────
function displayResults(data) {
    // Formulas
    displayFormulas(data.formulas);

    // KPIs
    document.getElementById('kpiSensitivity').textContent = data.sensitivity.toFixed(4);
    document.getElementById('kpiRange').textContent = data.speed_range + ' rpm';
    document.getElementById('kpiMean').textContent = data.mean_speed + ' rpm';

    if (currentGovernor === 'hartnell') {
        document.getElementById('kpiFourthLabel').textContent = 'Overall Stiffness';
        document.getElementById('kpiFourth').textContent = (data.overall_stiffness || 0).toFixed(2) + ' N/m';
    } else {
        document.getElementById('kpiFourthLabel').textContent = 'Coeff. Insensitiveness';
        document.getElementById('kpiFourth').textContent = data.coeff_insensitiveness.toFixed(4);
    }

    // Charts
    renderCharts(data);

    // Table
    renderTable(data);

    // Schematic
    drawSchematic(data);
}


// ──── 3D Virtual Twin & Variac Controls ────
function onSpeedSliderChange(val) {
    const numVal = parseFloat(val) || 0;
    const valSpan = document.getElementById('speedValue');
    if (valSpan) valSpan.textContent = Math.round(numVal);
    updateSpeedSliderTrack();
    if (window.setTwinSpeed) {
        window.setTwinSpeed(numVal);
    }
}

function stopAutoSpeed() {
    if (autoSpeedTimer) {
        clearInterval(autoSpeedTimer);
        autoSpeedTimer = null;
    }
    const btn = document.getElementById('autoSpeedBtn');
    if (btn) {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fas fa-wave-square"></i> Auto Ramp';
    }
}

function toggleAutoSpeed() {
    const btn = document.getElementById('autoSpeedBtn');
    if (autoSpeedTimer) {
        stopAutoSpeed();
        return;
    }
    if (!currentGovernor) return;

    const params = getParams();
    const minN = Math.max(0, (params.N_min || 100) * 0.6);
    const maxN = (params.N_max || 300) * 1.1;
    const slider = document.getElementById('speedSlider');
    if (slider) {
        slider.max = Math.max(parseFloat(slider.max) || 400, Math.ceil(maxN / 50) * 50);
        updateSpeedSliderTrack();
    }

    if (btn) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fas fa-stop"></i> Stop Ramp';
    }

    autoSpeedTimer = setInterval(() => {
        if (!slider) return;
        let val = parseFloat(slider.value) + autoSpeedDir * 3;
        if (val >= maxN) {
            val = maxN;
            autoSpeedDir = -1;
        } else if (val <= minN) {
            val = minN;
            autoSpeedDir = 1;
        }
        slider.value = val;
        onSpeedSliderChange(val);
    }, 50);
}

function setTwinCameraView(preset) {
    if (window.virtualTwin) {
        window.virtualTwin.setCameraView(preset);
    }
}

function toggleTwinPause() {
    if (!window.virtualTwin) return;
    const paused = window.virtualTwin.togglePause();
    const btn = document.getElementById('pauseTwinBtn');
    if (btn) {
        btn.innerHTML = paused
            ? '<i class="fas fa-play"></i> Resume'
            : '<i class="fas fa-pause"></i> Pause';
    }
}


// ──── Interactive Variac Lab Log ────
function showVariacNotice(msg) {
    const el = document.getElementById('variac-notice');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 4000);
}

function recordVariacReading() {
    const twin = window.virtualTwin;
    const st = twin?.latestState;
    if (!st) return;

    // Enforce Lab Manual Procedure Step 7: Always record in increasing speed
    if (recordedReadings.length > 0) {
        const prevN = recordedReadings[recordedReadings.length - 1].N;
        if (st.N < prevN) {
            showVariacNotice(`Procedure Note (Step 7): Speed (${st.N.toFixed(0)} rpm) is lower than previous reading (${prevN.toFixed(0)} rpm). Always record in increasing tendency of speed.`);
        }
    }

    recordedReadings.push({ ...st });
    renderRecordedLog();
    if (lastResult) renderCharts(lastResult);
    showVariacNotice(`Recorded Reading #${recordedReadings.length}: N = ${st.N.toFixed(0)} rpm, Fc = ${st.Fc.toFixed(2)} N`);
}

function clearRecordedLog() {
    recordedReadings = [];
    renderRecordedLog();
    if (lastResult) renderCharts(lastResult);
}

function renderRecordedLog() {
    const badge = document.getElementById('recordedCountBadge');
    const emptyEl = document.getElementById('recorded-empty');
    const wrapEl = document.getElementById('recorded-table-wrap');
    const thead = document.getElementById('recordedHead');
    const tbody = document.getElementById('recordedBody');

    if (badge) {
        badge.textContent = recordedReadings.length;
        badge.style.display = recordedReadings.length > 0 ? 'inline-block' : 'none';
        requestAnimationFrame(syncSlidingIndicators);
    }
    if (!emptyEl || !wrapEl || !thead || !tbody) return;

    if (recordedReadings.length === 0) {
        emptyEl.style.display = 'block';
        wrapEl.style.display = 'none';
        return;
    }

    emptyEl.style.display = 'none';
    wrapEl.style.display = 'block';
    thead.innerHTML = '';
    tbody.innerHTML = '';

    const isHartnell = currentGovernor === 'hartnell';
    const headers = isHartnell
        ? ['Sr.', 'N (rpm)', 'ω (rad/s)', 'Sleeve X (mm)', 'Radius R (mm)', 'Fc (N)', 'Spring S (N)', 'Status']
        : ['Sr.', 'N (rpm)', 'ω (rad/s)', 'Height h (mm)', 'Radius r (mm)', 'Fc (N)', 'Sleeve Lift (mm)', 'Status'];

    const trH = document.createElement('tr');
    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        trH.appendChild(th);
    });
    thead.appendChild(trH);

    recordedReadings.forEach((r, idx) => {
        const tr = document.createElement('tr');
        const cols = isHartnell
            ? [idx + 1, r.N.toFixed(1), r.omega.toFixed(2), r.X.toFixed(2), r.R.toFixed(2), r.Fc.toFixed(2), r.F_spring.toFixed(2), r.stateText]
            : [idx + 1, r.N.toFixed(1), r.omega.toFixed(2), r.h.toFixed(1), r.r.toFixed(1), r.Fc.toFixed(2), (r.lift || 0).toFixed(1), r.stateText];
        cols.forEach(v => {
            const td = document.createElement('td');
            td.textContent = v;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}


// ──── Lab Manual Preset (Exact Notebook Values, pg. 65-66) ────
function loadLabManualPreset() {
    selectGovernor('hartnell');
    const preset = {
        ball_mass: 0.45,
        sleeve_mass: 2.1,
        mass_added: 0.14,
        vertical_arm: 75,
        horizontal_arm: 95,
        initial_radius: 132.5,
        free_length: 154,
        compressed_length: 145,
        N_min: 197,
        N_max: 283,
        N_steps: 12
    };
    for (const [k, v] of Object.entries(preset)) {
        const el = document.getElementById(`hartnell_${k}`);
        if (el) el.value = v;
    }
    syncSliderRange(preset);

    // Populate the exact 5 experimental readings from page 66
    const manualReadings = [
        { N: 197, X: 5.08,  R: 136.51, Fc: 26.14, F_spring: 16.71 },
        { N: 210, X: 10.16, R: 140.52, Fc: 30.58, F_spring: 23.76 },
        { N: 218, X: 15.24, R: 144.53, Fc: 33.96, F_spring: 28.99 },
        { N: 238, X: 21.59, R: 149.54, Fc: 41.80, F_spring: 41.48 },
        { N: 283, X: 21.59, R: 149.54, Fc: 59.10, F_spring: 68.80 }
    ];
    recordedReadings = manualReadings.map(r => ({
        ...r,
        omega: (2 * Math.PI * r.N) / 60,
        stateText: 'Lab Manual Reading (pg. 66)',
        type: 'hartnell'
    }));
    renderRecordedLog();
    runCalculation();
    showVariacNotice('Loaded exact Hartnell Lab Manual parameters & 5 recorded readings (pg. 65–66).');
}


// ──── CSV Export ────
function exportCSV() {
    if (!lastResult) return;
    const d = lastResult;
    let headers, rows;
    if (currentGovernor === 'hartnell') {
        headers = ['Sr', 'Speed_RPM', 'Omega_rad_s', 'Sleeve_X_mm', 'Radius_R_mm', 'Fc_N', 'Spring_Force_N', 'Stiffness_N_mm'];
        rows = d.speeds.map((N, i) => [i + 1, N, d.omega[i], d.sleeve_displacements[i], d.radii[i], d.centrifugal_forces[i], d.spring_forces[i], d.spring_stiffnesses[i]]);
    } else {
        headers = ['Sr', 'Speed_RPM', 'Omega_rad_s', 'Height_h_mm', 'Radius_r_mm', 'Fc_N'];
        if (d.sleeve_lifts) headers.push('Sleeve_Lift_mm');
        rows = d.speeds.map((N, i) => {
            const row = [i + 1, N, d.omega[i], d.heights[i], d.radii[i], d.centrifugal_forces[i]];
            if (d.sleeve_lifts) row.push(d.sleeve_lifts[i]);
            return row;
        });
    }
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentGovernor}_governor_analysis.csv`;
    a.click();
    URL.revokeObjectURL(url);
}


// ──── Python Matplotlib 3D Simulation API ────
let currentMplMode = 'snapshot';
let mplAbortCtrl = null;

async function loadMatplotlibSim(mode = 'snapshot') {
    if (!currentGovernor) return;
    currentMplMode = mode;

    ['mplBtnSnapshot', 'mplBtnMultispeed', 'mplBtnAnimation'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
    });
    const activeMap = {
        snapshot: 'mplBtnSnapshot',
        multispeed: 'mplBtnMultispeed',
        animation: 'mplBtnAnimation'
    };
    const activeBtn = document.getElementById(activeMap[mode]);
    if (activeBtn) activeBtn.classList.add('active');

    const loadingEl = document.getElementById('mpl-loading');
    const loadingTxt = document.getElementById('mpl-loading-text');
    const imgEl = document.getElementById('mpl-image');
    const placeholderEl = document.getElementById('mpl-placeholder');
    const downloadBtn = document.getElementById('mplDownloadBtn');

    if (mplAbortCtrl) mplAbortCtrl.abort();
    mplAbortCtrl = new AbortController();

    if (placeholderEl) placeholderEl.style.display = 'none';
    if (imgEl) imgEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'flex';
    if (loadingTxt) {
        loadingTxt.textContent = mode === 'animation'
            ? 'Generating Python Matplotlib 3D Animated GIF (~3–5 sec)...'
            : 'Rendering Python Matplotlib 3D Simulation...';
    }

    const params = getParams();
    const speedSlider = document.getElementById('speedSlider');
    const currentSpeed = speedSlider ? parseFloat(speedSlider.value) : null;

    try {
        const resp = await fetch('/api/matplotlib_sim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: mplAbortCtrl.signal,
            body: JSON.stringify({
                type: currentGovernor,
                params: params,
                speed: currentSpeed,
                mode: mode,
                frames: 30
            })
        });

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const payload = await resp.json();
        if (payload.error) throw new Error(payload.error);

        lastMplSignature = `${currentGovernor}:${JSON.stringify(params)}:${currentSpeed}`;
        const dataUrl = `data:${payload.mime};base64,${payload.image}`;
        if (imgEl) {
            imgEl.src = dataUrl;
            imgEl.style.display = 'block';
        }
        if (downloadBtn) {
            const ext = payload.mime === 'image/gif' ? 'gif' : 'png';
            downloadBtn.href = dataUrl;
            downloadBtn.download = `${currentGovernor}_matplotlib_3d_${mode}.${ext}`;
            downloadBtn.style.display = 'inline-flex';
        }
    } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Matplotlib simulation error:', err);
        if (placeholderEl) {
            placeholderEl.style.display = 'block';
            placeholderEl.innerHTML = `<p style="color:#ff453a;">Could not render Python Matplotlib simulation (${err.message}). Make sure <code>python app.py</code> is running.</p>`;
        }
    } finally {
        if (loadingEl) loadingEl.style.display = 'none';
    }
}

// ──── Initialization & Live Parameter Listeners ────
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.param-group input').forEach(inp => {
        inp.addEventListener('input', () => {
            if (!currentGovernor) return;
            const params = getParams();
            if (window.updateTwinParams) {
                window.updateTwinParams(params);
            }
            runCalculation();
        });
    });

    // Boot directly into Hartnell Workbench
    selectGovernor('hartnell');
    requestAnimationFrame(syncSlidingIndicators);
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(syncSlidingIndicators);
    }

    window.addEventListener('resize', () => {
        syncSlidingIndicators();
        if (activeTab === 'twin' && lastResult) {
            drawSchematic(lastResult);
        }
    });

    window.addEventListener('load', () => {
        syncSlidingIndicators();
        if (currentGovernor && window.setTwinGovernor) {
            const params = getParams();
            window.setTwinGovernor(currentGovernor, params);
            const sp = parseFloat(document.getElementById('speedSlider')?.value || 250);
            window.setTwinSpeed(sp);
        }
    });
});

function displayFormulas(formulas) {
    const container = document.getElementById('formula-content');
    container.innerHTML = '';
    for (const [key, val] of Object.entries(formulas)) {
        const div = document.createElement('div');
        div.className = 'formula-item';
        const label = key.replace(/_/g, ' ');
        div.innerHTML = `<span class="formula-label">${label}</span><span>${val}</span>`;
        container.appendChild(div);
    }
}


// ──── Chart.js Configuration (Apple SF Pro Dark Palette) ────
const chartColors = {
    blue: '#0a84ff',
    teal: '#64d2ff',
    orange: '#ff9f0a',
    green: '#30d158',
    indigo: '#5e5ce6',
    red: '#ff453a',
    slate: '#8e8e93'
};

function makeAreaGradient(rgbaTop, rgbaBottom = 'rgba(22, 22, 24, 0)') {
    return (context) => {
        const { ctx, chartArea } = context.chart;
        if (!chartArea) return rgbaTop;
        const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        grad.addColorStop(0, rgbaTop);
        grad.addColorStop(1, rgbaBottom);
        return grad;
    };
}

function makeChartOptions(xLabel, yLabel, xType = 'linear') {
    const sans = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif";
    const mono = "'SF Mono', 'JetBrains Mono', ui-monospace, monospace";
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 520, easing: 'easeOutQuart' },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
            legend: {
                display: true,
                labels: {
                    color: 'rgba(235, 235, 245, 0.65)',
                    font: { family: sans, size: 11, weight: '500' },
                    boxWidth: 8,
                    boxHeight: 8,
                    usePointStyle: true,
                    pointStyle: 'circle'
                }
            },
            tooltip: {
                backgroundColor: 'rgba(28, 28, 30, 0.94)',
                titleColor: '#f5f5f7',
                bodyColor: 'rgba(235, 235, 245, 0.78)',
                borderColor: 'rgba(255, 255, 255, 0.14)',
                borderWidth: 1,
                cornerRadius: 10,
                padding: 10,
                titleFont: { family: sans, size: 11.5, weight: '600' },
                bodyFont: { family: mono, size: 11 }
            }
        },
        scales: {
            x: {
                type: xType,
                border: { display: false },
                grid: { color: 'rgba(255, 255, 255, 0.06)', tickLength: 0 },
                ticks: {
                    color: 'rgba(235, 235, 245, 0.45)',
                    font: { family: mono, size: 10 },
                    padding: 6,
                    maxTicksLimit: 7
                },
                title: {
                    display: true,
                    text: xLabel,
                    color: 'rgba(235, 235, 245, 0.65)',
                    font: { family: sans, size: 11, weight: '500' }
                }
            },
            y: {
                border: { display: false },
                grid: { color: 'rgba(255, 255, 255, 0.06)', tickLength: 0 },
                ticks: {
                    color: 'rgba(235, 235, 245, 0.45)',
                    font: { family: mono, size: 10 },
                    padding: 6,
                    maxTicksLimit: 6
                },
                title: {
                    display: true,
                    text: yLabel,
                    color: 'rgba(235, 235, 245, 0.65)',
                    font: { family: sans, size: 11, weight: '500' }
                }
            }
        }
    };
}

function makeRecordedDataset(label, points) {
    return {
        label: label || 'Recorded Lab Log',
        data: points,
        showLine: false,
        borderColor: '#161618',
        backgroundColor: chartColors.orange,
        pointRadius: 5.5,
        pointHoverRadius: 7.5,
        pointBorderWidth: 1.8,
        order: 0
    };
}

function makeIsochronousRay(radii, forces) {
    if (!radii || radii.length < 2) return null;
    const valid = radii
        .map((r, i) => ({ r, fc: forces[i] }))
        .filter(p => p.r > 0 && p.fc >= 0);
    if (valid.length < 2) return null;

    const mid = valid[Math.floor(valid.length / 2)];
    if (!mid || mid.r <= 0) return null;

    const slope = mid.fc / mid.r;
    const rMin = Math.min(...valid.map(p => p.r));
    const rMax = Math.max(...valid.map(p => p.r));
    if (rMax <= rMin) return null;

    return {
        label: 'Isochronous Ref (Fc/r = const)',
        data: [
            { x: +rMin.toFixed(3), y: +(slope * rMin).toFixed(3) },
            { x: +rMax.toFixed(3), y: +(slope * rMax).toFixed(3) }
        ],
        showLine: true,
        borderColor: 'rgba(235, 235, 245, 0.36)',
        backgroundColor: 'transparent',
        borderDash: [4, 4],
        borderWidth: 1.25,
        pointRadius: 0,
        fill: false,
        order: 2
    };
}

function destroyCharts() {
    Object.values(charts).forEach(c => { if (c) c.destroy(); });
    charts = {};
}

function renderCharts(data) {
    destroyCharts();

    if (currentGovernor === 'hartnell') {
        renderHartnellCharts(data);
    } else {
        renderGravityCharts(data);
    }
}

function renderGravityCharts(data) {
    const speeds = data.speeds;
    const hasLog = recordedReadings.length > 0;

    // Chart 1: Height vs Speed
    document.getElementById('chart1Title').textContent = 'Height (mm) vs Speed (rpm)';
    const ds1 = [{
        label: 'Analytical h (mm)',
        data: speeds.map((N, i) => ({ x: N, y: data.heights[i] })),
        showLine: true,
        borderColor: chartColors.blue,
        backgroundColor: makeAreaGradient('rgba(10, 132, 255, 0.24)'),
        fill: true, tension: 0.34, pointRadius: 2.5, pointHoverRadius: 5.5,
        pointBackgroundColor: '#161618', pointBorderColor: chartColors.blue, pointBorderWidth: 1.8,
        borderWidth: 2.2, order: 1
    }];
    if (hasLog) ds1.push(makeRecordedDataset('Variac Log', recordedReadings.map(pt => ({ x: pt.N, y: pt.h }))));
    charts.chart1 = new Chart(document.getElementById('chart1'), {
        type: 'scatter',
        data: { datasets: ds1 },
        options: makeChartOptions('Speed N (rpm)', 'Height h (mm)')
    });

    // Chart 2: Radius vs Speed
    document.getElementById('chart2Title').textContent = 'Radius (mm) vs Speed (rpm)';
    const ds2 = [{
        label: 'Analytical r (mm)',
        data: speeds.map((N, i) => ({ x: N, y: data.radii[i] })),
        showLine: true,
        borderColor: chartColors.green,
        backgroundColor: makeAreaGradient('rgba(48, 209, 88, 0.22)'),
        fill: true, tension: 0.34, pointRadius: 2.5, pointHoverRadius: 5.5,
        pointBackgroundColor: '#161618', pointBorderColor: chartColors.green, pointBorderWidth: 1.8,
        borderWidth: 2.2, order: 1
    }];
    if (hasLog) ds2.push(makeRecordedDataset('Variac Log', recordedReadings.map(pt => ({ x: pt.N, y: pt.r }))));
    charts.chart2 = new Chart(document.getElementById('chart2'), {
        type: 'scatter',
        data: { datasets: ds2 },
        options: makeChartOptions('Speed N (rpm)', 'Radius r (mm)')
    });

    // Chart 3: Centrifugal Force vs Speed
    document.getElementById('chart3Title').textContent = 'Centrifugal Force (N) vs Speed (rpm)';
    const ds3 = [{
        label: 'Analytical Fc (N)',
        data: speeds.map((N, i) => ({ x: N, y: data.centrifugal_forces[i] })),
        showLine: true,
        borderColor: chartColors.indigo,
        backgroundColor: makeAreaGradient('rgba(94, 92, 230, 0.24)'),
        fill: true, tension: 0.34, pointRadius: 2.5, pointHoverRadius: 5.5,
        pointBackgroundColor: '#161618', pointBorderColor: chartColors.indigo, pointBorderWidth: 1.8,
        borderWidth: 2.2, order: 1
    }];
    if (hasLog) ds3.push(makeRecordedDataset('Variac Log', recordedReadings.map(pt => ({ x: pt.N, y: pt.Fc }))));
    charts.chart3 = new Chart(document.getElementById('chart3'), {
        type: 'scatter',
        data: { datasets: ds3 },
        options: makeChartOptions('Speed N (rpm)', 'Centrifugal Force Fc (N)')
    });

    // Chart 4: Controlling Force (Fc) vs Radius
    document.getElementById('chart4Title').textContent = 'Controlling Force (N) vs Radius (mm)';
    const ds4 = [{
        label: 'Fc vs r Curve',
        data: data.radii.map((r, i) => ({ x: r, y: data.centrifugal_forces[i] })),
        showLine: true,
        borderColor: chartColors.teal,
        backgroundColor: makeAreaGradient('rgba(100, 210, 255, 0.22)'),
        fill: true, tension: 0.34, pointRadius: 3, pointHoverRadius: 6,
        pointBackgroundColor: '#161618', pointBorderColor: chartColors.teal, pointBorderWidth: 1.8,
        borderWidth: 2.2, order: 1
    }];
    const isoRay = makeIsochronousRay(data.radii, data.centrifugal_forces);
    if (isoRay) ds4.push(isoRay);
    if (hasLog) ds4.push(makeRecordedDataset('Variac Log', recordedReadings.map(pt => ({ x: pt.r, y: pt.Fc }))));
    charts.chart4 = new Chart(document.getElementById('chart4'), {
        type: 'scatter',
        data: { datasets: ds4 },
        options: makeChartOptions('Radius r (mm)', 'Controlling Force Fc (N)')
    });
}

function renderHartnellCharts(data) {
    const speeds = data.speeds;
    const hasLog = recordedReadings.length > 0;

    // Chart 1: Centrifugal Force vs Speed
    document.getElementById('chart1Title').textContent = 'Centrifugal Force (N) vs Speed (rpm)';
    const ds1 = [{
        label: 'Analytical Fc (N)',
        data: speeds.map((N, i) => ({ x: N, y: data.centrifugal_forces[i] })),
        showLine: true,
        borderColor: chartColors.blue,
        backgroundColor: makeAreaGradient('rgba(10, 132, 255, 0.24)'),
        fill: true, tension: 0.34, pointRadius: 2.5, pointHoverRadius: 5.5,
        pointBackgroundColor: '#161618', pointBorderColor: chartColors.blue, pointBorderWidth: 1.8,
        borderWidth: 2.2, order: 1
    }];
    if (hasLog) ds1.push(makeRecordedDataset('Recorded Log', recordedReadings.map(pt => ({ x: pt.N, y: pt.Fc }))));
    charts.chart1 = new Chart(document.getElementById('chart1'), {
        type: 'scatter',
        data: { datasets: ds1 },
        options: makeChartOptions('Speed N (rpm)', 'Centrifugal Force Fc (N)')
    });

    // Chart 2: Spring Force vs Speed
    document.getElementById('chart2Title').textContent = 'Spring Force (N) vs Speed (rpm)';
    const ds2 = [{
        label: 'Analytical S (N)',
        data: speeds.map((N, i) => ({ x: N, y: data.spring_forces[i] })),
        showLine: true,
        borderColor: chartColors.green,
        backgroundColor: makeAreaGradient('rgba(48, 209, 88, 0.22)'),
        fill: true, tension: 0.34, pointRadius: 2.5, pointHoverRadius: 5.5,
        pointBackgroundColor: '#161618', pointBorderColor: chartColors.green, pointBorderWidth: 1.8,
        borderWidth: 2.2, order: 1
    }];
    if (hasLog) ds2.push(makeRecordedDataset('Recorded Log', recordedReadings.map(pt => ({ x: pt.N, y: pt.F_spring }))));
    charts.chart2 = new Chart(document.getElementById('chart2'), {
        type: 'scatter',
        data: { datasets: ds2 },
        options: makeChartOptions('Speed N (rpm)', 'Spring Force S (N)')
    });

    // Chart 3: Controlling Force vs Radius + Isochronous Reference
    document.getElementById('chart3Title').textContent = 'Controlling Force (N) vs Radius (mm)';
    const ds3 = [{
        label: 'Controlling Line (Fc vs R)',
        data: data.radii.map((r, i) => ({ x: r, y: data.centrifugal_forces[i] })),
        showLine: true,
        borderColor: chartColors.indigo,
        backgroundColor: makeAreaGradient('rgba(94, 92, 230, 0.24)'),
        fill: true, tension: 0.24, pointRadius: 3, pointHoverRadius: 6,
        pointBackgroundColor: '#161618', pointBorderColor: chartColors.indigo, pointBorderWidth: 1.8,
        borderWidth: 2.2, order: 1
    }];
    const isoRay = makeIsochronousRay(data.radii, data.centrifugal_forces);
    if (isoRay) ds3.push(isoRay);
    if (hasLog) ds3.push(makeRecordedDataset('Recorded Log', recordedReadings.map(pt => ({ x: pt.R, y: pt.Fc }))));
    charts.chart3 = new Chart(document.getElementById('chart3'), {
        type: 'scatter',
        data: { datasets: ds3 },
        options: makeChartOptions('Radius R (mm)', 'Controlling Force Fc (N)')
    });

    // Chart 4: Spring Stiffness vs Speed
    document.getElementById('chart4Title').textContent = 'Spring Stiffness (N/mm) vs Speed (rpm)';
    charts.chart4 = new Chart(document.getElementById('chart4'), {
        type: 'bar',
        data: {
            labels: speeds,
            datasets: [{
                label: 'Stiffness s (N/mm)',
                data: data.spring_stiffnesses,
                backgroundColor: 'rgba(10, 132, 255, 0.34)',
                hoverBackgroundColor: 'rgba(10, 132, 255, 0.56)',
                borderColor: chartColors.blue,
                borderWidth: 1.25,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: makeChartOptions('Speed N (rpm)', 'Stiffness s (N/mm)', 'category')
    });
}


// ──── Data Table ────
function renderTable(data) {
    const thead = document.getElementById('tableHead');
    const tbody = document.getElementById('tableBody');
    thead.innerHTML = '';
    tbody.innerHTML = '';

    let headers, rows;

    if (currentGovernor === 'hartnell') {
        headers = ['Sr.', 'N (rpm)', 'ω (rad/s)', 'X (mm)', 'R (mm)', 'Fc (N)', 'F_spring (N)', 's (N/mm)'];
        rows = data.speeds.map((N, i) => [
            i + 1, N, data.omega[i], data.sleeve_displacements[i],
            data.radii[i], data.centrifugal_forces[i],
            data.spring_forces[i], data.spring_stiffnesses[i]
        ]);
    } else {
        const hasSlLift = data.sleeve_lifts && data.sleeve_lifts.length;
        headers = ['Sr.', 'N (rpm)', 'ω (rad/s)', 'h (mm)', 'r (mm)', 'Fc (N)'];
        if (hasSlLift) headers.push('Sleeve Lift (mm)');

        rows = data.speeds.map((N, i) => {
            const row = [i + 1, N, data.omega[i], data.heights[i], data.radii[i], data.centrifugal_forces[i]];
            if (hasSlLift) row.push(data.sleeve_lifts[i]);
            return row;
        });
    }

    // Build header
    const trHead = document.createElement('tr');
    headers.forEach(h => {
        const th = document.createElement('th');
        th.textContent = h;
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    // Build body
    rows.forEach(row => {
        const tr = document.createElement('tr');
        row.forEach(val => {
            const td = document.createElement('td');
            td.textContent = val;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
}


// ──── 2D CAD Schematic Drawing (HiDPI Scaled 520×360 Apple Studio Diagram) ────
const SCHEMATIC_PALETTE = {
    bg: '#141416',
    title: '#f5f5f7',
    label: 'rgba(235, 235, 245, 0.65)',
    shaft: '#636366',
    centerline: 'rgba(255, 255, 255, 0.14)',
    arm: '#0a84ff',
    link: '#5e5ce6',
    spring: '#30d158',
    extension: '#64d2ff',
    ball: '#ff453a',
    ballEdge: '#9e231c',
    sleeve: '#ff9f0a',
    sleeveEdge: '#b26a00',
    dimTeal: '#64d2ff',
    dimOrange: '#ff9f0a',
    pivot: '#f5f5f7'
};

function drawSchematic(data) {
    const canvas = document.getElementById('schematicCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const cssW = Math.max(320, canvas.parentElement.clientWidth || 480);
    const cssH = 360;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Calm studio dot matrix inside viewport
    ctx.fillStyle = 'rgba(255, 255, 255, 0.065)';
    for (let x = 20; x < cssW; x += 28) {
        for (let y = 20; y < cssH; y += 28) {
            ctx.beginPath();
            ctx.arc(x, y, 0.9, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const vw = 520, vh = 360;
    const scale = Math.min(cssW / vw, cssH / vh);
    ctx.save();
    ctx.translate((cssW - vw * scale) / 2, (cssH - vh * scale) / 2);
    ctx.scale(scale, scale);

    switch (currentGovernor) {
        case 'watt':     drawWattSchematic(ctx, vw, vh); break;
        case 'porter':   drawPorterSchematic(ctx, vw, vh); break;
        case 'proell':   drawProellSchematic(ctx, vw, vh); break;
        case 'hartnell': drawHartnellSchematic(ctx, vw, vh); break;
    }

    ctx.restore();
}

function setSchematicStyle(ctx) {
    ctx.strokeStyle = SCHEMATIC_PALETTE.arm;
    ctx.fillStyle = SCHEMATIC_PALETTE.bg;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
}

function drawSchematicHeader(ctx, title, w) {
    ctx.fillStyle = SCHEMATIC_PALETTE.title;
    ctx.font = '600 11.5px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, w / 2, 24);
}

function drawSpindleShaft(ctx, cx, yTop, yBot) {
    // Centerline dashed axis
    ctx.save();
    ctx.strokeStyle = SCHEMATIC_PALETTE.centerline;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, yTop - 10);
    ctx.lineTo(cx, yBot + 10);
    ctx.stroke();
    ctx.restore();

    // Physical shaft
    ctx.strokeStyle = SCHEMATIC_PALETTE.shaft;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, yTop);
    ctx.lineTo(cx, yBot);
    ctx.stroke();
}

function drawFlyball(ctx, x, y, r = 11) {
    ctx.fillStyle = SCHEMATIC_PALETTE.ball;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = SCHEMATIC_PALETTE.ballEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Specular highlight dot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.40)';
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
}

function drawSleeveBlock(ctx, x, y, w, h) {
    roundRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = SCHEMATIC_PALETTE.sleeve;
    ctx.fill();
    ctx.strokeStyle = SCHEMATIC_PALETTE.sleeveEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

function drawPillText(ctx, text, x, y, color, align = 'center', font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif') {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    const m = ctx.measureText(text);
    const padX = 5;
    let rx = x - padX;
    if (align === 'center') rx = x - m.width / 2 - padX;
    else if (align === 'right') rx = x - m.width - padX;
    roundRect(ctx, rx, y - 10.5, m.width + padX * 2, 14, 4);
    ctx.fillStyle = SCHEMATIC_PALETTE.bg;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
}

function drawFormulaStrip(ctx, w, h, line1, line2 = null) {
    const boxY = h - 46;
    const boxH = 34;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.lineWidth = 1;
    roundRect(ctx, 16, boxY, w - 32, boxH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = SCHEMATIC_PALETTE.dimTeal;
    ctx.font = '11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    if (line2) {
        ctx.fillText(line1, w / 2, boxY + 13);
        ctx.fillText(line2, w / 2, boxY + 27);
    } else {
        ctx.fillText(line1, w / 2, boxY + 21);
    }
}

function drawWattSchematic(ctx, w, h) {
    setSchematicStyle(ctx);
    const cx = w / 2;
    drawSchematicHeader(ctx, 'WATT GOVERNOR · CONICAL PENDULUM', w);
    drawSpindleShaft(ctx, cx, 44, 268);

    const pivY = 68;
    const ballX = 104;
    const ballY = 196;

    // Upper arms
    ctx.strokeStyle = SCHEMATIC_PALETTE.arm;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx, pivY); ctx.lineTo(cx - ballX, ballY);
    ctx.moveTo(cx, pivY); ctx.lineTo(cx + ballX, ballY);
    ctx.stroke();

    // Pivot O
    ctx.fillStyle = SCHEMATIC_PALETTE.pivot;
    ctx.beginPath(); ctx.arc(cx, pivY, 4.8, 0, Math.PI * 2); ctx.fill();
    drawPillText(ctx, 'Pivot (O)', cx, pivY - 12, SCHEMATIC_PALETTE.label, 'center');

    // Balls
    drawFlyball(ctx, cx - ballX, ballY, 12);
    drawFlyball(ctx, cx + ballX, ballY, 12);

    // Dimension h (left)
    ctx.save();
    ctx.strokeStyle = SCHEMATIC_PALETTE.dimOrange;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - 134, pivY); ctx.lineTo(cx - 134, ballY);
    ctx.moveTo(cx - 134, pivY); ctx.lineTo(cx, pivY);
    ctx.moveTo(cx - 134, ballY); ctx.lineTo(cx - ballX, ballY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = SCHEMATIC_PALETTE.dimOrange;
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('h', cx - 140, (pivY + ballY) / 2 + 4);

    // Dimension r (right)
    ctx.save();
    ctx.strokeStyle = SCHEMATIC_PALETTE.dimTeal;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, ballY + 22); ctx.lineTo(cx + ballX, ballY + 22);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = SCHEMATIC_PALETTE.dimTeal;
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('r', cx + ballX / 2, ballY + 35);

    // Labels
    ctx.fillStyle = SCHEMATIC_PALETTE.label;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Arm (L)', cx - 58, 124);
    ctx.textAlign = 'left';
    ctx.fillText('m (ball)', cx + ballX + 16, ballY - 14);

    // Fc vectors
    ctx.strokeStyle = SCHEMATIC_PALETTE.spring;
    ctx.fillStyle = SCHEMATIC_PALETTE.spring;
    ctx.lineWidth = 1.8;
    drawArrow(ctx, cx + ballX + 14, ballY, cx + ballX + 58, ballY);
    drawArrow(ctx, cx - ballX - 14, ballY, cx - ballX - 58, ballY);
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Fc', cx + ballX + 62, ballY + 4);
    ctx.textAlign = 'right';
    ctx.fillText('Fc', cx - ballX - 62, ballY + 4);

    // Rotation indicator
    drawRotationArrow(ctx, cx, 266, 16);
    ctx.fillStyle = SCHEMATIC_PALETTE.link;
    ctx.font = '11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ω (spindle)', cx + 22, 270);

    drawFormulaStrip(ctx, w, h, 'h = g / ω² = 895 / N²   |   Fc = m · ω² · r   |   r = √(L² − h²)');
}

function drawPorterSchematic(ctx, w, h) {
    setSchematicStyle(ctx);
    const cx = w / 2;
    drawSchematicHeader(ctx, 'PORTER GOVERNOR · DEAD-WEIGHT SLEEVE', w);
    drawSpindleShaft(ctx, cx, 42, 286);

    const pivY = 62;
    const jointX = 98;
    const jointY = 166;
    const sleeveY = 232;
    const collarX = 16;

    // Upper arms
    ctx.strokeStyle = SCHEMATIC_PALETTE.arm;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx, pivY); ctx.lineTo(cx - jointX, jointY);
    ctx.moveTo(cx, pivY); ctx.lineTo(cx + jointX, jointY);
    ctx.stroke();

    // Lower links
    ctx.strokeStyle = SCHEMATIC_PALETTE.link;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - jointX, jointY); ctx.lineTo(cx - collarX, sleeveY);
    ctx.moveTo(cx + jointX, jointY); ctx.lineTo(cx + collarX, sleeveY);
    ctx.stroke();

    // Pivot
    ctx.fillStyle = SCHEMATIC_PALETTE.pivot;
    ctx.beginPath(); ctx.arc(cx, pivY, 4.8, 0, Math.PI * 2); ctx.fill();

    // Sleeve
    drawSleeveBlock(ctx, cx - 22, sleeveY - 12, 44, 24);

    // Balls
    drawFlyball(ctx, cx - jointX, jointY, 11);
    drawFlyball(ctx, cx + jointX, jointY, 11);

    // Height & Radius guides
    ctx.save();
    ctx.strokeStyle = SCHEMATIC_PALETTE.dimOrange;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - 128, pivY); ctx.lineTo(cx - 128, jointY);
    ctx.moveTo(cx - 128, pivY); ctx.lineTo(cx, pivY);
    ctx.moveTo(cx - 128, jointY); ctx.lineTo(cx - jointX, jointY);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = SCHEMATIC_PALETTE.dimOrange;
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText('h', cx - 134, (pivY + jointY) / 2 + 4);

    // Fc arrows
    ctx.strokeStyle = SCHEMATIC_PALETTE.spring;
    ctx.fillStyle = SCHEMATIC_PALETTE.spring;
    ctx.lineWidth = 1.8;
    drawArrow(ctx, cx + jointX + 13, jointY, cx + jointX + 54, jointY);
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Fc', cx + jointX + 58, jointY + 4);

    // Labels
    ctx.fillStyle = SCHEMATIC_PALETTE.label;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('Arm L (α)', cx - 54, 108);
    ctx.fillText('Link l (β)', cx - 64, 212);
    ctx.textAlign = 'left';
    ctx.fillText('m (ball)', cx + jointX + 14, jointY - 14);
    drawPillText(ctx, 'Sleeve M (dead wt.)', cx, sleeveY + 28, SCHEMATIC_PALETTE.sleeve, 'center');

    drawFormulaStrip(ctx, w, h, 'h = [(m + M(1 + q)) / m] · (g / ω²)   |   q = tan β / tan α');
}

function drawProellSchematic(ctx, w, h) {
    setSchematicStyle(ctx);
    const cx = w / 2;
    drawSchematicHeader(ctx, 'PROELL GOVERNOR · RIGID EXTENSION LINK', w);
    drawSpindleShaft(ctx, cx, 42, 286);

    const pivY = 62;
    const jx = 88;
    const jy = 172;
    const sx = 16;
    const sy = 234;

    // Collinear extension along link (collar -> joint)
    const dx = jx - sx;
    const dy = jy - sy;
    const len = Math.hypot(dx, dy);
    const extFrac = 46 / len;
    const bx = jx + dx * extFrac;
    const by = jy + dy * extFrac;

    // Upper arms
    ctx.strokeStyle = SCHEMATIC_PALETTE.arm;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx, pivY); ctx.lineTo(cx - jx, jy);
    ctx.moveTo(cx, pivY); ctx.lineTo(cx + jx, jy);
    ctx.stroke();

    // Lower links
    ctx.strokeStyle = SCHEMATIC_PALETTE.link;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(cx - sx, sy); ctx.lineTo(cx - jx, jy);
    ctx.moveTo(cx + sx, sy); ctx.lineTo(cx + jx, jy);
    ctx.stroke();

    // Collinear extensions
    ctx.strokeStyle = SCHEMATIC_PALETTE.extension;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(cx - jx, jy); ctx.lineTo(cx - bx, by);
    ctx.moveTo(cx + jx, jy); ctx.lineTo(cx + bx, by);
    ctx.stroke();

    // Pivots & Joints
    ctx.fillStyle = SCHEMATIC_PALETTE.pivot;
    ctx.beginPath(); ctx.arc(cx, pivY, 4.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx - jx, jy, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + jx, jy, 4.2, 0, Math.PI * 2); ctx.fill();

    // Sleeve
    drawSleeveBlock(ctx, cx - 22, sy - 12, 44, 24);

    // Balls on extension tips
    drawFlyball(ctx, cx - bx, by, 11);
    drawFlyball(ctx, cx + bx, by, 11);

    // Fc vector
    ctx.strokeStyle = SCHEMATIC_PALETTE.spring;
    ctx.fillStyle = SCHEMATIC_PALETTE.spring;
    ctx.lineWidth = 1.8;
    drawArrow(ctx, cx + bx + 13, by, cx + bx + 54, by);
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Fc', cx + bx + 58, by + 4);

    // Labels
    ctx.fillStyle = SCHEMATIC_PALETTE.extension;
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Extension (e)', cx + jx + 28, jy + 12);
    ctx.fillStyle = SCHEMATIC_PALETTE.label;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
    ctx.fillText('m (ball)', cx + bx + 14, by - 14);
    ctx.textAlign = 'right';
    ctx.fillText('Joint (B)', cx - jx - 10, jy + 4);
    drawPillText(ctx, 'Sleeve M', cx, sy + 28, SCHEMATIC_PALETTE.sleeve, 'center');

    drawFormulaStrip(ctx, w, h, 'h = [(m + M(1 + q)) / m] · (1 + e/l) · (g / ω²)');
}

function drawHartnellSchematic(ctx, w, h) {
    setSchematicStyle(ctx);
    const cx = w / 2;
    drawSchematicHeader(ctx, 'HARTNELL GOVERNOR · SPRING-LOADED BELL CRANK', w);
    drawSpindleShaft(ctx, cx, 40, 268);

    // Top spring nut / cap
    const springTop = 64;
    const springBot = 178;
    roundRect(ctx, cx - 28, springTop - 7, 56, 7, 3);
    ctx.fillStyle = '#3a3a3c';
    ctx.fill();

    // Helical spring coils
    ctx.strokeStyle = SCHEMATIC_PALETTE.spring;
    ctx.lineWidth = 2.2;
    const coils = 7;
    const sw = 15;
    ctx.beginPath();
    ctx.moveTo(cx, springTop);
    for (let i = 0; i < coils; i++) {
        const y1 = springTop + (i + 0.25) * (springBot - springTop) / coils;
        const y2 = springTop + (i + 0.75) * (springBot - springTop) / coils;
        ctx.lineTo(cx + sw, y1);
        ctx.lineTo(cx - sw, y2);
    }
    ctx.lineTo(cx, springBot);
    ctx.stroke();

    // Sleeve under spring
    drawSleeveBlock(ctx, cx - 28, springBot, 56, 24);

    // Bell-crank fulcrums & arms
    const pivY = springBot + 12;
    const pivX = 88;
    const armV = 78;

    [-1, 1].forEach(sign => {
        const fx = cx + sign * pivX;
        const sx = cx + sign * 28;
        const by = pivY - armV;

        // Bell crank arms
        ctx.strokeStyle = SCHEMATIC_PALETTE.arm;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(sx, pivY);
        ctx.lineTo(fx, pivY);
        ctx.lineTo(fx, by);
        ctx.stroke();

        // Fulcrum pin
        ctx.fillStyle = SCHEMATIC_PALETTE.pivot;
        ctx.beginPath();
        ctx.arc(fx, pivY, 4.8, 0, Math.PI * 2);
        ctx.fill();

        // Ball
        drawFlyball(ctx, fx, by, 11);
    });

    // R dimension (right ball center to spindle)
    ctx.save();
    ctx.strokeStyle = SCHEMATIC_PALETTE.dimTeal;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, pivY - armV - 20);
    ctx.lineTo(cx + pivX, pivY - armV - 20);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = SCHEMATIC_PALETTE.dimTeal;
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('R', cx + pivX / 2, pivY - armV - 24);

    // Fc arrow
    ctx.strokeStyle = SCHEMATIC_PALETTE.spring;
    ctx.fillStyle = SCHEMATIC_PALETTE.spring;
    ctx.lineWidth = 1.8;
    drawArrow(ctx, cx + pivX + 13, pivY - armV, cx + pivX + 54, pivY - armV);
    ctx.font = '600 11px "SF Mono", "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Fc', cx + pivX + 58, pivY - armV + 4);

    // Clear text callouts
    ctx.fillStyle = SCHEMATIC_PALETTE.spring;
    ctx.font = '11px -apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Spring (S)', cx + 22, (springTop + springBot) / 2 + 4);

    ctx.fillStyle = SCHEMATIC_PALETTE.dimTeal;
    ctx.textAlign = 'right';
    ctx.fillText('a (ball arm)', cx - pivX - 10, pivY - armV / 2);
    ctx.textAlign = 'center';
    ctx.fillText('b (sleeve)', cx - (pivX + 28) / 2, pivY - 9);

    ctx.fillStyle = SCHEMATIC_PALETTE.label;
    ctx.textAlign = 'left';
    ctx.fillText('Fulcrum', cx + pivX + 10, pivY + 4);
    ctx.fillText('Ball (m)', cx + pivX + 14, pivY - armV - 14);

    drawPillText(ctx, 'Sleeve (m₁ + m₂)', cx, springBot + 42, SCHEMATIC_PALETTE.sleeve, 'center');

    drawFormulaStrip(
        ctx, w, h,
        '2·Fc·a = (S + (m₁+m₂)g)·b   |   s = (a/b)² · 2(Fc₂ − Fc₁)/(r₂ − r₁)'
    );
}


// ──── Drawing Helpers ────
function drawArrow(ctx, x1, y1, x2, y2) {
    const headLen = 7;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
}

function drawRotationArrow(ctx, x, y, radius) {
    ctx.strokeStyle = SCHEMATIC_PALETTE.link;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y, radius, -Math.PI * 0.8, Math.PI * 0.3);
    ctx.stroke();
    const endAngle = Math.PI * 0.3;
    const ex = x + radius * Math.cos(endAngle);
    const ey = y + radius * Math.sin(endAngle);
    ctx.fillStyle = SCHEMATIC_PALETTE.link;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - 5, ey - 7);
    ctx.lineTo(ex + 5, ey - 3);
    ctx.closePath();
    ctx.fill();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
