/* ═══════════════════════════════════════════════════════
   Election 2569 – LIFF Web App  (app.js)
   No backend – LIFF + Google Apps Script + Google Sheet
   ═══════════════════════════════════════════════════════ */

// ─── CONFIG ────────────────────────────────────
const CONFIG = {
    // TODO: ใส่ LIFF ID จริง
    LIFF_ID: '2009070108-A8wQ9BQ7',

    // Google Sheet master data (public CSV)
    // MASTER_CSV_URL: 'https://docs.google.com/spreadsheets/d/1_tk0BUorCmZZcv20L7Sbpkg08tr9ljoNH37lP90wV5s/export?format=csv&gid=0',
    MASTER_CSV_URL: 'https://docs.google.com/spreadsheets/d/1_tk0BUorCmZZcv20L7Sbpkg08tr9ljoNH37lP90wV5s/export?format=csv&gid=0',

    // Google Apps Script Web App URL
    // TODO: ใส่ URL ของ GAS Web App จริง
    // GAS_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
    GAS_URL: 'https://script.google.com/macros/s/AKfycbztmVHcdZG31z8gGtbRyUvWXMrytQi0lQGq2d1hNJ6-U39nM-d1M-TmpHndAaUIYE76/exec',

    // Video size limit (bytes) – 10 MB
    VIDEO_MAX_SIZE: 10 * 1024 * 1024,

    // localStorage keys
    LS_PREFIX: 'election2569_',
};

// ─── STATE ─────────────────────────────────────
let state = {
    currentStep: 1,
    mode: null,           // 'score' | 'incident'
    masterData: [],       // parsed CSV rows

    // Step 2
    district: '',
    subdistrict: '',
    unit: '',
    unitName: '',
    unitMapUrl: '',

    // Step 3a
    ballotType: 'CANDIDATE',
    voterTurnout: '',     // จำนวนผู้มาใช้สิทธิ์
    scoreRows: [{ id: '', score: '' }],
    spoiledBallots: '',   // บัตรเสีย (CANDIDATE/PARTY)
    referendumApprove: '',    // ประชามติ: เห็นชอบ
    referendumDisapprove: '', // ประชามติ: ไม่เห็นชอบ
    referendumSpoiled: '',    // ประชามติ: บัตรเสีย
    imagesA: [],          // { file, base64, name }

    // Step 3b
    description: '',
    imagesB: [],
    videosB: [],

    // Reporter
    lineUserId: '',
    lineDisplayName: '',
    linePictureUrl: '',
};

// ─── DOM REFS ──────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── INIT ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initLiff();
        await loadMasterData();
        bindEvents();
        restoreState();
        hideLoading();
    } catch (err) {
        console.error(err);
        showToast('เกิดข้อผิดพลาด: ' + err.message);
        hideLoading();
    }
});

// ═══════════════════════════════════════════════
// LIFF
// ═══════════════════════════════════════════════
async function initLiff() {
    try {
        await liff.init({ liffId: CONFIG.LIFF_ID });

        if (!liff.isLoggedIn()) {
            liff.login();
            return;
        }

        const profile = await liff.getProfile();
        state.lineUserId = profile.userId;
        state.lineDisplayName = profile.displayName;
        state.linePictureUrl = profile.pictureUrl || '';

        // Show user info
        $('#user-avatar').src = state.linePictureUrl;
        $('#user-name').textContent = state.lineDisplayName;
        $('#user-info').classList.remove('hidden');
    } catch (e) {
        // Fallback สำหรับ dev mode (ไม่ได้เปิดใน LINE)
        console.warn('LIFF init failed, running in dev mode', e);
        state.lineUserId = 'dev_user_' + Date.now();
        state.lineDisplayName = 'Dev User';
    }
}

// ═══════════════════════════════════════════════
// MASTER DATA  (CSV → JSON)
// ═══════════════════════════════════════════════
async function loadMasterData() {
    const res = await fetch(CONFIG.MASTER_CSV_URL);
    const csv = await res.text();
    state.masterData = parseCSV(csv);
    populateDistricts();
}

function parseCSV(csv) {
    const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];

    const headers = splitCSVLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const vals = splitCSVLine(lines[i]);
        const row = {};
        headers.forEach((h, idx) => {
            row[h.trim()] = (vals[idx] || '').trim();
        });
        rows.push(row);
    }
    return rows;
}

/** Handle quoted CSV fields */
function splitCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
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

// ═══════════════════════════════════════════════
// POPULATE SELECTS
// ═══════════════════════════════════════════════
function populateDistricts() {
    const districts = [...new Set(state.masterData.map((r) => r['อำเภอ']))].sort();
    const sel = $('#sel-district');
    sel.innerHTML = '<option value="">-- เลือกอำเภอ --</option>';
    districts.forEach((d) => {
        sel.innerHTML += `<option value="${d}">${d}</option>`;
    });
}

function onDistrictChange() {
    state.district = $('#sel-district').value;
    state.subdistrict = '';
    state.unit = '';

    const selSub = $('#sel-subdistrict');
    const selUnit = $('#sel-unit');

    selSub.innerHTML = '<option value="">-- เลือกตำบล --</option>';
    selUnit.innerHTML = '<option value="">-- เลือกชื่อหน่วย --</option>';
    selUnit.disabled = true;
    $('#unit-info').classList.add('hidden');
    $('#btn-step2-next').disabled = true;

    if (!state.district) {
        selSub.disabled = true;
        return;
    }

    const subs = [...new Set(
        state.masterData
            .filter((r) => r['อำเภอ'] === state.district)
            .map((r) => r['ตำบล'])
    )].sort();

    subs.forEach((s) => {
        selSub.innerHTML += `<option value="${s}">${s}</option>`;
    });
    selSub.disabled = false;
}

function onSubdistrictChange() {
    state.subdistrict = $('#sel-subdistrict').value;
    state.unit = '';

    const selUnit = $('#sel-unit');
    selUnit.innerHTML = '<option value="">-- เลือกชื่อหน่วย --</option>';
    $('#unit-info').classList.add('hidden');
    $('#btn-step2-next').disabled = true;

    if (!state.subdistrict) {
        selUnit.disabled = true;
        return;
    }

    const units = state.masterData
        .filter((r) => r['อำเภอ'] === state.district && r['ตำบล'] === state.subdistrict)
        .sort((a, b) => Number(a['หน่วยที่']) - Number(b['หน่วยที่']));

    units.forEach((u) => {
        selUnit.innerHTML += `<option value="${u['หน่วยที่']}">(หน่วยที่ ${u['หน่วยที่']}) ${u['ชื่อหน่วย']}</option>`;
    });
    selUnit.disabled = false;
}

function onUnitChange() {
    state.unit = $('#sel-unit').value;
    if (!state.unit) {
        $('#unit-info').classList.add('hidden');
        $('#btn-step2-next').disabled = true;
        return;
    }

    const row = state.masterData.find(
        (r) =>
            r['อำเภอ'] === state.district &&
            r['ตำบล'] === state.subdistrict &&
            r['หน่วยที่'] === state.unit
    );

    state.unitName = row ? row['ชื่อหน่วย'] : '';
    state.unitMapUrl = row ? row['ที่ตั้ง'] : '';

    $('#unit-number-text').textContent = state.unit;
    $('#unit-name-text').textContent = state.unitName;

    const mapLink = $('#unit-map-link');
    if (state.unitMapUrl) {
        mapLink.href = state.unitMapUrl;
        mapLink.style.display = '';
    } else {
        mapLink.style.display = 'none';
    }

    $('#unit-info').classList.remove('hidden');
    $('#btn-step2-next').disabled = false;
}

// ═══════════════════════════════════════════════
// SCORE ROWS
// ═══════════════════════════════════════════════
function renderScoreRows() {
    const container = $('#score-rows');
    container.innerHTML = '';

    state.scoreRows.forEach((row, idx) => {
        const div = document.createElement('div');
        div.className = 'score-row';
        div.innerHTML = `
      <div class="col-id">
        <input type="number" inputmode="numeric" placeholder="เลขที่"
               value="${row.id}" data-idx="${idx}" data-field="id" min="1" />
      </div>
      <div class="col-score">
        <input type="number" inputmode="numeric" placeholder="คะแนน"
               value="${row.score}" data-idx="${idx}" data-field="score" min="0" />
      </div>
      <div class="col-action">
        ${state.scoreRows.length > 1
                ? `<button class="btn-remove" data-idx="${idx}" type="button">✕</button>`
                : ''}
      </div>
    `;
        container.appendChild(div);
    });

    // Bind events
    container.querySelectorAll('input').forEach((input) => {
        input.addEventListener('input', (e) => {
            const idx = +e.target.dataset.idx;
            const field = e.target.dataset.field;
            state.scoreRows[idx][field] = e.target.value;
            saveState();
        });
    });
    container.querySelectorAll('.btn-remove').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            const idx = +e.target.dataset.idx;
            state.scoreRows.splice(idx, 1);
            renderScoreRows();
            saveState();
        });
    });
}

function addScoreRow() {
    state.scoreRows.push({ id: '', score: '' });
    renderScoreRows();
    // Focus the new id field
    const rows = $$('.score-row');
    const last = rows[rows.length - 1];
    if (last) last.querySelector('input').focus();
    saveState();
}

// ═══════════════════════════════════════════════
// TOGGLE BALLOT SECTIONS
// ═══════════════════════════════════════════════
function toggleBallotSections() {
    const isRef = state.ballotType === 'REFERENDUM';
    $('#score-section').classList.toggle('hidden', isRef);
    $('#spoiled-section').classList.toggle('hidden', isRef);
    $('#referendum-section').classList.toggle('hidden', !isRef);
}

// ═══════════════════════════════════════════════
// IMAGE & VIDEO HANDLING
// ═══════════════════════════════════════════════
function handleFileInput(input, targetArray, previewContainerId, type = 'image') {
    const files = Array.from(input.files);
    const previewContainer = $(previewContainerId);

    files.forEach((file) => {
        // Video size check
        if (type === 'video' && file.size > CONFIG.VIDEO_MAX_SIZE) {
            showToast(`❌ ไฟล์ ${file.name} ใหญ่เกิน 10 MB`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result.split(',')[1];
            targetArray.push({ name: file.name, base64, type: file.type });

            if (type === 'image') {
                const img = document.createElement('img');
                img.src = e.target.result;
                previewContainer.appendChild(img);
            } else {
                const div = document.createElement('div');
                div.className = 'video-item';
                div.innerHTML = `🎥 ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
                previewContainer.appendChild(div);
            }
            saveState();
        };
        reader.readAsDataURL(file);
    });

    // Reset input to allow re-selecting same files
    input.value = '';
}

// ═══════════════════════════════════════════════
// STEP NAVIGATION
// ═══════════════════════════════════════════════
function goStep(n) {
    // Hide all steps
    $$('.step').forEach((s) => s.classList.add('hidden'));

    const stepId = getStepId(n);
    $(`#${stepId}`).classList.remove('hidden');

    state.currentStep = n;
    updateProgress(n);
    saveState();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function getStepId(n) {
    if (n === 1) return 'step-1';
    if (n === 2) return 'step-2';
    if (n === 3) return state.mode === 'score' ? 'step-3a' : 'step-3b';
    if (n === 4) return 'step-4';
    if (n === 5) return 'step-5';
    return 'step-1';
}

function updateProgress(step) {
    const pct = { 1: 0, 2: 33, 3: 55, 4: 80, 5: 100 };
    $('#progress-fill').style.width = (pct[step] || 0) + '%';

    $$('.step-label').forEach((el) => {
        const s = +el.dataset.step;
        el.classList.toggle('active', s <= step);
    });
}

// ═══════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════
function validateStep3a() {
    const errors = [];

    // Voter turnout validation
    if (state.voterTurnout === '' || isNaN(Number(state.voterTurnout))) {
        errors.push('กรุณากรอกจำนวนผู้มาใช้สิทธิ์');
    }

    if (state.ballotType === 'REFERENDUM') {
        // Referendum: ต้องกรอกเห็นชอบ + ไม่เห็นชอบ
        if (state.referendumApprove === '' || isNaN(Number(state.referendumApprove))) {
            errors.push('กรุณากรอกคะแนน "เห็นชอบ"');
        }
        if (state.referendumDisapprove === '' || isNaN(Number(state.referendumDisapprove))) {
            errors.push('กรุณากรอกคะแนน "ไม่เห็นชอบ"');
        }
        if (state.referendumSpoiled !== '' && isNaN(Number(state.referendumSpoiled))) {
            errors.push('จำนวนบัตรเสียไม่ถูกต้อง');
        }
    } else {
        // CANDIDATE / PARTY: ต้องกรอกคะแนนอย่างน้อย 1 แถว
        const validRows = state.scoreRows.filter((r) => r.id !== '' || r.score !== '');
        if (validRows.length === 0) {
            errors.push('กรุณากรอกคะแนนอย่างน้อย 1 แถว');
        }

        for (const row of validRows) {
            if (!row.id || isNaN(Number(row.id))) {
                errors.push(`เลขที่ "${row.id}" ไม่ถูกต้อง`);
            }
            if (row.score === '' || isNaN(Number(row.score))) {
                errors.push(`คะแนนของเลขที่ ${row.id} ไม่ถูกต้อง`);
            }
        }

        const ids = validRows.map((r) => r.id);
        const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
        if (dupes.length > 0) {
            errors.push(`เลขที่ซ้ำ: ${[...new Set(dupes)].join(', ')}`);
        }

        if (state.spoiledBallots !== '' && isNaN(Number(state.spoiledBallots))) {
            errors.push('จำนวนบัตรเสียไม่ถูกต้อง');
        }
    }

    // Check images
    if (state.imagesA.length === 0) {
        errors.push('กรุณาอัปโหลดรูปหลักฐานอย่างน้อย 1 รูป');
    }

    return errors;
}

function validateStep3b() {
    const errors = [];

    if (!state.description.trim()) {
        errors.push('กรุณากรอกรายละเอียดเหตุการณ์');
    }

    return errors;
}

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════
function buildSummary() {
    const ballotLabels = {
        CANDIDATE: 'ผู้สมัครประจำหน่วย',
        PARTY: 'พรรค',
        REFERENDUM: 'ประชามติ',
    };

    let html = '';

    // Location
    html += `<div class="summary-section">
    <dl>
      <dt>อำเภอ</dt><dd>${state.district}</dd>
      <dt>ตำบล</dt><dd>${state.subdistrict}</dd>
      <dt>หน่วยที่</dt><dd>${state.unit} — ${state.unitName}</dd>
    </dl>
  </div>`;

    if (state.mode === 'score') {
        html += `<div class="summary-section">
      <dl>
        <dt>ประเภทบัตร</dt><dd>${ballotLabels[state.ballotType] || state.ballotType}</dd>
        <dt>จำนวนผู้มาใช้สิทธิ์</dt><dd>${state.voterTurnout} คน</dd>
      </dl>`;

        if (state.ballotType === 'REFERENDUM') {
            html += `<table>
        <tbody>
          <tr><td>✅ เห็นชอบ</td><td>${state.referendumApprove}</td></tr>
          <tr><td>❌ ไม่เห็นชอบ</td><td>${state.referendumDisapprove}</td></tr>
          <tr><td>⚠️ บัตรเสีย</td><td>${state.referendumSpoiled || 0}</td></tr>
        </tbody>
      </table>`;
        } else {
            html += `<table>
        <thead><tr><th>เลขที่</th><th>คะแนน</th></tr></thead>
        <tbody>
          ${state.scoreRows
                    .filter((r) => r.id !== '')
                    .map((r) => `<tr><td>${r.id}</td><td>${r.score}</td></tr>`)
                    .join('')}
          <tr><td>⚠️ บัตรเสีย</td><td>${state.spoiledBallots || 0}</td></tr>
        </tbody>
      </table>`;
        }
        html += `</div>`;

        html += `<div class="summary-section">
      <dt>รูปหลักฐาน</dt><dd>${state.imagesA.length} รูป</dd>
    </div>`;
    } else {
        html += `<div class="summary-section">
      <dt>รายละเอียดเหตุการณ์</dt>
      <dd>${escapeHtml(state.description)}</dd>
    </div>`;

        if (state.imagesB.length > 0) {
            html += `<div class="summary-section">
      <dt>หลักฐาน</dt>
      <dd>${state.imagesB.length} รูป</dd>
    </div>`;
        }
    }

    html += `<div class="summary-section">
    <dt>ผู้รายงาน</dt><dd>${state.lineDisplayName} (${state.lineUserId.substring(0, 8)}…)</dd>
  </div>`;

    return html;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ═══════════════════════════════════════════════
// SUBMISSION
// ═══════════════════════════════════════════════
async function submitReport() {
    showSubmitOverlay();
    hideError('error-4');

    try {
        const payload = buildPayload();

        const res = await fetch(CONFIG.GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            // GAS Web App ต้องรับเป็น text/plain เพื่อหลีกเลี่ยง CORS preflight
            body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (data.ok) {
            clearSavedState();
            goStep(5);
        } else {
            showError('error-4', data.error || 'เกิดข้อผิดพลาดจากเซิร์ฟเวอร์');
        }
    } catch (err) {
        console.error(err);
        showError('error-4', 'ไม่สามารถส่งข้อมูลได้ กรุณาลองใหม่');
    } finally {
        hideSubmitOverlay();
    }
}

function buildPayload() {
    const now = new Date().toISOString();

    if (state.mode === 'score') {
        return {
            mode: 'score',
            district: state.district,
            subdistrict: state.subdistrict,
            unit: state.unit,
            ballotType: state.ballotType,
            voterTurnout: Number(state.voterTurnout) || 0,
            round: Date.now(),
            results: state.ballotType === 'REFERENDUM'
                ? [
                    { id: 'approve', score: Number(state.referendumApprove) },
                    { id: 'disapprove', score: Number(state.referendumDisapprove) },
                    { id: 'spoiled', score: Number(state.referendumSpoiled || 0) },
                ]
                : [
                    ...state.scoreRows
                        .filter((r) => r.id !== '')
                        .map((r) => ({ id: Number(r.id), score: Number(r.score) })),
                    ...(state.spoiledBallots ? [{ id: 0, score: Number(state.spoiledBallots) }] : []),
                ],
            evidences: {
                images: state.imagesA.map((img) => img.base64),
            },
            reporter: {
                lineUserId: state.lineUserId,
            },
            timestamp: now,
        };
    } else {
        return {
            mode: 'incident',
            district: state.district,
            subdistrict: state.subdistrict,
            unit: state.unit,
            description: state.description,
            evidences: {
                images: state.imagesB.map((img) => img.base64),
            },
            reporter: {
                lineUserId: state.lineUserId,
            },
            timestamp: now,
        };
    }
}

// ═══════════════════════════════════════════════
// AUTO-SAVE / RESTORE  (localStorage)
// ═══════════════════════════════════════════════
function saveState() {
    try {
        const toSave = {
            mode: state.mode,
            district: state.district,
            subdistrict: state.subdistrict,
            unit: state.unit,
            ballotType: state.ballotType,
            voterTurnout: state.voterTurnout,
            scoreRows: state.scoreRows,
            spoiledBallots: state.spoiledBallots,
            referendumApprove: state.referendumApprove,
            referendumDisapprove: state.referendumDisapprove,
            referendumSpoiled: state.referendumSpoiled,
            description: state.description,
            currentStep: state.currentStep,
        };
        localStorage.setItem(CONFIG.LS_PREFIX + 'draft', JSON.stringify(toSave));
    } catch (_) { /* ignore quota errors */ }
}

function restoreState() {
    try {
        const saved = localStorage.getItem(CONFIG.LS_PREFIX + 'draft');
        if (!saved) return;

        const data = JSON.parse(saved);
        state.mode = data.mode || null;
        state.district = data.district || '';
        state.subdistrict = data.subdistrict || '';
        state.unit = data.unit || '';
        state.ballotType = data.ballotType || 'CANDIDATE';
        state.voterTurnout = data.voterTurnout || '';
        state.scoreRows = data.scoreRows || [{ id: '', score: '' }];
        state.spoiledBallots = data.spoiledBallots || '';
        state.referendumApprove = data.referendumApprove || '';
        state.referendumDisapprove = data.referendumDisapprove || '';
        state.referendumSpoiled = data.referendumSpoiled || '';
        state.description = data.description || '';

        // Restore UI
        if (state.district) {
            $('#sel-district').value = state.district;
            onDistrictChange();
            if (state.subdistrict) {
                $('#sel-subdistrict').value = state.subdistrict;
                onSubdistrictChange();
                if (state.unit) {
                    $('#sel-unit').value = state.unit;
                    onUnitChange();
                }
            }
        }

        if (state.ballotType) {
            const radio = document.querySelector(`input[name="ballotType"][value="${state.ballotType}"]`);
            if (radio) radio.checked = true;
        }

        if (state.description) {
            $('#incident-desc').value = state.description;
        }

        renderScoreRows();

        // Restore voter turnout / spoiled / referendum inputs
        if (state.voterTurnout) $('#voter-turnout').value = state.voterTurnout;
        if (state.spoiledBallots) $('#spoiled-ballots').value = state.spoiledBallots;
        if (state.referendumApprove) $('#ref-approve').value = state.referendumApprove;
        if (state.referendumDisapprove) $('#ref-disapprove').value = state.referendumDisapprove;
        if (state.referendumSpoiled) $('#ref-spoiled').value = state.referendumSpoiled;
        toggleBallotSections();

        // Go to saved step (but at most step 3, don't auto-advance to confirm)
        const targetStep = Math.min(data.currentStep || 1, 3);
        if (targetStep > 1 && state.mode) {
            goStep(targetStep);
        }
    } catch (_) { /* ignore */ }
}

function clearSavedState() {
    try {
        localStorage.removeItem(CONFIG.LS_PREFIX + 'draft');
    } catch (_) { /* ignore */ }
}

// ═══════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════
function bindEvents() {
    // ── Step 1: Mode select ──
    $$('.mode-card').forEach((card) => {
        card.addEventListener('click', () => {
            state.mode = card.dataset.mode;
            saveState();
            goStep(2);
        });
    });

    // ── Step 2: Location selects ──
    $('#sel-district').addEventListener('change', onDistrictChange);
    $('#sel-subdistrict').addEventListener('change', onSubdistrictChange);
    $('#sel-unit').addEventListener('change', onUnitChange);

    $('#btn-step2-next').addEventListener('click', () => {
        goStep(3);
        if (state.mode === 'score') {
            toggleBallotSections();
            renderScoreRows();
        }
    });

    // ── Step 3a: Score ──
    $('#btn-add-row').addEventListener('click', addScoreRow);

    $$('input[name="ballotType"]').forEach((radio) => {
        radio.addEventListener('change', (e) => {
            state.ballotType = e.target.value;
            toggleBallotSections();
            saveState();
        });
    });

    $('#voter-turnout').addEventListener('input', (e) => {
        state.voterTurnout = e.target.value;
        saveState();
    });

    $('#spoiled-ballots').addEventListener('input', (e) => {
        state.spoiledBallots = e.target.value;
        saveState();
    });

    $('#ref-approve').addEventListener('input', (e) => {
        state.referendumApprove = e.target.value;
        saveState();
    });
    $('#ref-disapprove').addEventListener('input', (e) => {
        state.referendumDisapprove = e.target.value;
        saveState();
    });
    $('#ref-spoiled').addEventListener('input', (e) => {
        state.referendumSpoiled = e.target.value;
        saveState();
    });

    $('#evidence-images-a').addEventListener('change', (e) => {
        handleFileInput(e.target, state.imagesA, '#preview-images-a', 'image');
    });

    $('#btn-step3a-next').addEventListener('click', () => {
        const errors = validateStep3a();
        if (errors.length) {
            showError('error-3a', errors.join('<br>'));
            return;
        }
        hideError('error-3a');

        $('#summary-content').innerHTML = buildSummary();
        goStep(4);
    });

    // ── Step 3b: Incident ──
    $('#incident-desc').addEventListener('input', (e) => {
        state.description = e.target.value;
        saveState();
    });

    $('#evidence-images-b').addEventListener('change', (e) => {
        handleFileInput(e.target, state.imagesB, '#preview-images-b', 'image');
    });

    $('#btn-step3b-next').addEventListener('click', () => {
        const errors = validateStep3b();
        if (errors.length) {
            showError('error-3b', errors.join('<br>'));
            return;
        }
        hideError('error-3b');

        $('#summary-content').innerHTML = buildSummary();
        goStep(4);
    });

    // ── Step 4: Confirm & Submit ──
    $('#btn-back-from-4').addEventListener('click', () => {
        goStep(3);
        if (state.mode === 'score') {
            toggleBallotSections();
            renderScoreRows();
        }
    });

    $('#btn-submit').addEventListener('click', submitReport);
}

// ═══════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════
function hideLoading() {
    $('#loading-overlay').classList.add('hidden');
    $('#app').classList.remove('hidden');
}

function showSubmitOverlay() {
    $('#submit-overlay').classList.remove('hidden');
}
function hideSubmitOverlay() {
    $('#submit-overlay').classList.add('hidden');
}

function showError(id, msg) {
    const el = $(`#${id}`);
    el.innerHTML = msg;
    el.classList.remove('hidden');
}
function hideError(id) {
    const el = $(`#${id}`);
    el.classList.add('hidden');
}

function showToast(msg, type = 'error') {
    const toast = $('#toast');
    toast.textContent = msg;
    toast.className = `toast ${type}`;
    setTimeout(() => toast.classList.add('hidden'), 4000);
}

// Global
window.goStep = goStep;
window.resetApp = function () {
    state.mode = null;
    state.scoreRows = [{ id: '', score: '' }];
    state.voterTurnout = '';
    state.spoiledBallots = '';
    state.referendumApprove = '';
    state.referendumDisapprove = '';
    state.referendumSpoiled = '';
    state.description = '';
    state.imagesA = [];
    state.imagesB = [];
    clearSavedState();
    // Clear file previews
    $('#preview-images-a').innerHTML = '';
    $('#preview-images-b').innerHTML = '';
    goStep(1);
};
