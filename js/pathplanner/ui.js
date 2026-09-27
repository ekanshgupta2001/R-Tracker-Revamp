// ── R-Tracker Path Planner — UI, Saved-Paths Modal & Init ────────────────

// Escapes a string for innerHTML. Path ids and names come from the student's own
// state or imported progress file, so they are user-provided text, never markup.
function escapeHTML(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ── Waypoint Editor ───────────────────────────────────────────────────────
function refreshUI() {
  renderWpList();
  renderEditor();
  updatePlayButton();
  updateCode();
  drawAll();
}

function renderWpList() {
  const list = document.getElementById('wpList');
  document.getElementById('wpCount').textContent = waypoints.length + ' point' + (waypoints.length !== 1 ? 's' : '');
  if (waypoints.length === 0) {
    list.innerHTML = '<div class="wp-empty">Click the field to place waypoints.</div>';
    return;
  }
  let html = '';
  waypoints.forEach((wp, i) => {
    html += `
      <div class="wp-card${i === selectedIdx ? ' selected' : ''}" onclick="selectWp(${i})" style="margin-bottom:0;">
        <div class="wp-num">${i + 1}</div>
        <div class="wp-info">
          <div class="wp-coords">(${wp.x.toFixed(1)}, ${wp.y.toFixed(1)}) in</div>
          <div class="wp-heading">Heading: ${wp.heading.toFixed(1)}° · ${escapeHTML(wp.action)}</div>
        </div>
        <button class="wp-delete" onclick="event.stopPropagation(); deleteWpAt(${i})" title="Delete" aria-label="Delete waypoint ${i + 1}">✕</button>
      </div>`;
    if (i < waypoints.length - 1) {
      const seg = segments[i];
      const isCurved = seg.cps.length > 0;
      html += `
      <div class="seg-row">
        <span class="seg-row-label">↕ ${i+1}→${i+2}</span>
        <select class="seg-select${isCurved ? ' curved' : ''}" aria-label="Segment ${i+1} to ${i+2} shape"
          onchange="setSegmentType(${i}, this.value)"
          onclick="event.stopPropagation()">
          <option value="line"${!isCurved ? ' selected' : ''}>line()</option>
          <option value="curve"${isCurved ? ' selected' : ''}>curve()</option>
        </select>
      </div>`;
    }
  });
  list.innerHTML = html;
}

function selectWp(i) { selectedIdx = i; selectedSegIdx = -1; refreshUI(); }

function renderEditor() {
  const titleEl = document.getElementById('editorSectionTitle');
  const content = document.getElementById('editorContent');
  const delBtn  = document.getElementById('btnDelSel');

  if (selectedIdx >= 0 && selectedIdx < waypoints.length) {
    titleEl.textContent = `Waypoint ${selectedIdx + 1}`;
    delBtn.disabled = false;
    renderWaypointEditor();
  } else if (selectedSegIdx >= 0 && selectedSegIdx < segments.length) {
    titleEl.textContent = `Segment ${selectedSegIdx + 1} → ${selectedSegIdx + 2}`;
    delBtn.disabled = true;
    renderSegmentEditor(selectedSegIdx);
  } else {
    titleEl.textContent = 'Selection';
    delBtn.disabled = true;
    content.innerHTML = '<div class="no-select-msg">Click a waypoint or path segment to select it.</div>';
  }
}

function renderWaypointEditor() {
  if (selectedIdx < 0 || selectedIdx >= waypoints.length) return;
  const wp = waypoints[selectedIdx];
  document.getElementById('editorContent').innerHTML = `
    <div class="editor-form">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="edX">X (0–${FIELD_IN} in)</label>
          <input type="number" class="form-input" id="edX" value="${wp.x}" step="0.5" min="0" max="${FIELD_IN}" oninput="editorUpdate()" onchange="syncEditorFields()">
        </div>
        <div class="form-group">
          <label class="form-label" for="edY">Y (0–${FIELD_IN} in)</label>
          <input type="number" class="form-input" id="edY" value="${wp.y}" step="0.5" min="0" max="${FIELD_IN}" oninput="editorUpdate()" onchange="syncEditorFields()">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:2">
          <label class="form-label" for="edH">Heading (°, 0 = +x, CCW)</label>
          <div class="angle-row">
            <canvas id="anglePicker" width="40" height="40" title="Click or drag to set heading" aria-hidden="true"></canvas>
            <input type="number" class="form-input" id="edH" value="${wp.heading}" step="1" min="-180" max="180" oninput="editorUpdate()" onchange="syncEditorFields()">
          </div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="edW">Wait (ms)</label>
          <input type="number" class="form-input" id="edW" value="${wp.waitMs}" step="100" min="0" oninput="editorUpdate()" onchange="syncEditorFields()">
        </div>
        <div class="form-group">
          <label class="form-label" for="edA">Action</label>
          <select class="form-select" id="edA" onchange="editorUpdate()">
            ${['None','Wait','Intake','Outtake','Custom'].map(a => `<option${a===wp.action?' selected':''}>${a}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-note">The wait runs in <code>routine()</code> in the code below. An action becomes a TODO line there for your mechanism code.</div>
    </div>`;
  drawAnglePicker(wp.heading);
  initAnglePicker();
}

function renderSegmentEditor(si) {
  const seg = segments[si];
  const canAdd = seg.cps.length < 2;
  const typeLabel = seg.cps.length === 0 ? 'line() — straight path'
                  : seg.cps.length === 1  ? 'curve() — 1 control point'
                  : 'curve() — 2 control points';

  document.getElementById('editorContent').innerHTML = `
    <div style="display:flex; flex-direction:column; gap:8px;">
      <div style="font-size:11px; color:var(--text-muted); margin-bottom:2px;">${typeLabel}</div>
      ${canAdd ? `<button class="tbtn primary" style="align-self:flex-start;" onclick="addControlPoint(${si})">+ Add Control Point</button>` : ''}
      ${seg.cps.map((cp, ci) => `
        <div class="cp-card">
          <div class="cp-card-title">
            Control Point ${ci + 1}
            <button class="cp-remove-btn" onclick="removeCP(${si}, ${ci})" title="Remove CP" aria-label="Remove control point ${ci + 1}">✕</button>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="cpX${ci}">X (0–${FIELD_IN})</label>
              <input type="number" class="form-input" id="cpX${ci}" value="${cp.x.toFixed(1)}" step="0.5" min="0" max="${FIELD_IN}"
                oninput="updateCP(${si}, ${ci}, 'x', this.value)" onchange="this.value = segments[${si}].cps[${ci}].x">
            </div>
            <div class="form-group">
              <label class="form-label" for="cpY${ci}">Y (0–${FIELD_IN})</label>
              <input type="number" class="form-input" id="cpY${ci}" value="${cp.y.toFixed(1)}" step="0.5" min="0" max="${FIELD_IN}"
                oninput="updateCP(${si}, ${ci}, 'y', this.value)" onchange="this.value = segments[${si}].cps[${ci}].y">
            </div>
          </div>
        </div>`).join('')}
      ${seg.cps.length === 0 ? '<div style="font-size:11px;color:var(--text-muted);line-height:1.6;">Add control points to create a Bezier curve.</div>' : ''}
    </div>`;
}

// Every value is normalised to what the path and the export use: on the field,
// heading in (-180, 180] like the angle picker, a wait of 0 ms or more. The path
// follows the typing live; when a field is committed (change: blur or Enter)
// syncEditorFields() writes the stored values back (typing never triggers it, so
// the cursor is not disturbed), so a field never shows a number the path is not using.
function wrapHeading(h) {
  let d = ((h + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return Math.round(d * 10) / 10;
}

function syncEditorFields() {
  if (selectedIdx < 0 || selectedIdx >= waypoints.length) return;
  const wp = waypoints[selectedIdx];
  [['edX', wp.x], ['edY', wp.y], ['edH', wp.heading], ['edW', wp.waitMs]].forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });
  drawAnglePicker(wp.heading);
}

function editorUpdate() {
  if (selectedIdx < 0) return;
  const wp = waypoints[selectedIdx];
  wp.x       = parseFloat(clampField(parseFloat(document.getElementById('edX').value) || 0).toFixed(2));
  wp.y       = parseFloat(clampField(parseFloat(document.getElementById('edY').value) || 0).toFixed(2));
  wp.heading = wrapHeading(parseFloat(document.getElementById('edH').value) || 0);
  wp.waitMs  = Math.max(0, Math.round(parseFloat(document.getElementById('edW').value) || 0));
  wp.action  = document.getElementById('edA').value;
  drawAnglePicker(wp.heading);
  renderWpList();
  updateCode();
  drawAll();
}

function drawAnglePicker(deg) {
  const pc = document.getElementById('anglePicker');
  if (!pc) return;
  const pctx = pc.getContext('2d');
  const cx = 20, cy = 20, r = 16;
  pctx.clearRect(0, 0, 40, 40);
  pctx.beginPath(); pctx.arc(cx, cy, r, 0, Math.PI * 2);
  pctx.strokeStyle = '#c73e5a'; pctx.lineWidth = 1.5; pctx.stroke();
  pctx.fillStyle = '#181818'; pctx.fill();
  const ang = -deg * Math.PI / 180;   // Pedro heading: 0 = +x, CCW; canvas y points down
  const ex = cx + Math.cos(ang) * (r - 3);
  const ey = cy + Math.sin(ang) * (r - 3);
  pctx.strokeStyle = '#a0334a'; pctx.lineWidth = 2; pctx.lineCap = 'round';
  pctx.beginPath(); pctx.moveTo(cx, cy); pctx.lineTo(ex, ey); pctx.stroke();
  pctx.fillStyle = '#c73e5a';
  pctx.beginPath(); pctx.arc(ex, ey, 2.5, 0, Math.PI * 2); pctx.fill();
}

function initAnglePicker() {
  const pc = document.getElementById('anglePicker');
  if (!pc || pc._inited) return;
  pc._inited = true;
  function onMove(e) {
    const rect = pc.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const px2 = (e.touches ? e.touches[0].clientX : e.clientX) - cx;
    const py2 = (e.touches ? e.touches[0].clientY : e.clientY) - cy;
    let deg = -Math.atan2(py2, px2) * 180 / Math.PI;   // Pedro heading: 0 = +x, CCW
    if (deg > 180) deg -= 360;
    if (deg <= -180) deg += 360;                        // (-180, 180]: west reads 180
    document.getElementById('edH').value = deg.toFixed(1);
    editorUpdate();
  }
  let down = false;
  pc.addEventListener('mousedown', () => { down = true; });
  window.addEventListener('mouseup', () => { down = false; });
  pc.addEventListener('mousemove', e => { if (down) onMove(e); });
  pc.addEventListener('click', onMove);
  pc.addEventListener('touchstart', e => { e.preventDefault(); onMove(e); }, { passive: false });
  pc.addEventListener('touchmove',  e => { e.preventDefault(); onMove(e); }, { passive: false });
}

function updatePathSettings() {
  pathSettings.speed = parseFloat(document.getElementById('speedSlider').value);
  document.getElementById('speedVal').textContent = pathSettings.speed.toFixed(2) + '×';
}

function updatePlayButton() {
  document.getElementById('btnRobotAnim').disabled = waypoints.length < 2;
}

// ── Saved Paths (kept in local progress via RTStore; nothing leaves the browser) ──
let _pathModalMode = 'save';

function openPathModal(mode) {
  _pathModalMode = mode;
  const modal   = document.getElementById('pp-cloud-modal');
  const saveRow = document.getElementById('ppc-save-row');
  const loadSec = document.getElementById('ppc-load-section');
  clearPathMsg();
  if (mode === 'save') {
    modal.querySelector('.ppc-title').textContent = 'Save in this tab';
    saveRow.style.display = 'flex'; loadSec.style.display = 'none';
  } else {
    modal.querySelector('.ppc-title').textContent = 'Load a path';
    saveRow.style.display = 'none'; loadSec.style.display = 'block';
    renderSavedPaths();
  }
  window.rtDialog.open(document.getElementById('pp-cloud-backdrop'), { labelledBy: 'ppc-title', focus: mode === 'save' ? '#ppc-name-input' : '.ppc-path-open', onClose: closePathModal });
}

function closePathModal() { window.rtDialog.close(document.getElementById('pp-cloud-backdrop')); }

// ── Unsaved work ──────────────────────────────────────────────────────────
// The path lives only on this page until it is saved in the tab (RTStore.paths).
// cleanSig is the path as last saved or loaded; anything else asks before the
// student leaves (js/sidebar.js, js/store.js).
function pathSig() { return JSON.stringify([waypoints, segments]); }
let cleanSig = pathSig();
function markPathClean() { cleanSig = pathSig(); }
window.rtUnsaved = function () {
  if (!waypoints.length || pathSig() === cleanSig) return '';
  return 'Your path has changes that are not saved yet.';
};
function clearPathMsg()   { const el = document.getElementById('ppc-msg'); if (el) { el.textContent = ''; el.className = 'ppc-msg'; } }
function setPathMsg(msg, isErr) {
  const el = document.getElementById('ppc-msg');
  if (!el) return;
  el.textContent = msg;
  el.className = 'ppc-msg' + (isErr ? ' err' : '');
}
function _newPathId() { return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function savePath() {
  const nameInput = document.getElementById('ppc-name-input');
  const name = nameInput.value.trim();
  if (!name) { setPathMsg('Please enter a path name.', true); return; }
  if (name.length > RTSchema.LIMITS.nameMaxLen) { setPathMsg('That name is too long.', true); return; }
  const now = Date.now();
  RTStore.update(s => {
    const data = {
      name,
      waypoints: JSON.parse(JSON.stringify(waypoints)),
      segments:  JSON.parse(JSON.stringify(segments)),
      pathSettings: JSON.parse(JSON.stringify(pathSettings)),
      updatedAt: now,
    };
    const existing = s.paths.find(p => p.name === name);
    if (existing) {
      Object.assign(existing, data);
    } else {
      s.paths.push(Object.assign({ id: _newPathId(), createdAt: now }, data));
      const cap = RTSchema.LIMITS.pathsMax;
      if (s.paths.length > cap) {
        s.paths.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
        s.paths.splice(0, s.paths.length - cap);
      }
    }
  });
  markPathClean();
  setPathMsg('Saved in this tab. Export to a file to keep it after the tab closes.', false);
  nameInput.value = '';
  setTimeout(() => {
    closePathModal();
    if (window.rtNudgeExport) window.rtNudgeExport('"' + name + '" is saved in this tab. Export to a file to keep it after the tab closes.', { force: true });
  }, 900);
}

function renderSavedPaths() {
  const container = document.getElementById('ppc-path-list');
  const paths = RTStore.get().paths.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (paths.length === 0) { container.innerHTML = '<div class="ppc-empty">No saved paths yet.</div>'; return; }
  container.innerHTML = '';
  paths.forEach(d => {
    const updated = d.updatedAt ? new Date(d.updatedAt).toLocaleDateString() : '';
    const row = document.createElement('div');
    row.className = 'ppc-path-item';
    row.innerHTML = `
      <button type="button" class="ppc-path-open" onclick="loadSavedPath('${escapeHTML(d.id)}')">
        <span class="ppc-path-name">${escapeHTML(d.name)}</span>
        <span class="ppc-path-meta">${(d.waypoints||[]).length} waypoints &middot; ${escapeHTML(updated)}</span>
      </button>
      <button type="button" class="ppc-path-del" onclick="deleteSavedPath('${escapeHTML(d.id)}',event)" title="Delete" aria-label="Delete ${escapeHTML(d.name)}">${rtIcon('trash')}</button>`;
    row.addEventListener('click', e => { if (e.target === row) row.querySelector('.ppc-path-open').click(); });
    container.appendChild(row);
  });
}

function loadSavedPath(id) {
  const d = RTStore.get().paths.find(p => p.id === id);
  if (!d) { setPathMsg('Path not found.', true); return; }
  if (window.rtUnsaved() && !confirm('Your path has changes that are not saved yet. Load "' + d.name + '" anyway?')) return;
  stopAnim();
  waypoints = JSON.parse(JSON.stringify(d.waypoints || []));
  segments  = JSON.parse(JSON.stringify(d.segments || []));
  if (d.pathSettings) Object.assign(pathSettings, d.pathSettings);
  const speed = Number(pathSettings.speed);
  if (speed > 0) document.getElementById('speedSlider').value = speed;
  updatePathSettings();
  selectedIdx = -1; selectedSegIdx = -1;
  refreshUI();                                   // list, editor, Play button, code, field
  markPathClean();
  setPathMsg('Path "' + d.name + '" loaded!', false);
  setTimeout(closePathModal, 1200);
}

function deleteSavedPath(id, event) {
  event.stopPropagation();
  if (!confirm('Delete this saved path?')) return;
  RTStore.update(s => { s.paths = s.paths.filter(p => p.id !== id); });
  renderSavedPaths();
}

// ── Resize ────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => { resizeCanvas(); drawAll(); });
window.addEventListener('rt-layoutchange', () => { resizeCanvas(); drawAll(); });   // sidebar opened / closed

// ── Init ──────────────────────────────────────────────────────────────────
// (js/sidebar.js builds the navigation itself; calling initSidebar() here as well
// used to inject it twice.)
resizeCanvas();
updatePathSettings();
updateCode();
drawAll();
