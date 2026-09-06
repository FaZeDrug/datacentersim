import './style.css';
import { FacilityWorld } from './world';
import { FacilityAudio } from './audio';
import { EQUIPMENT, createSimulation, startSimulation, tickSimulation, inspectEquipment, applyAction, getActions, getObjective, getPostmortem } from './simulation';
import type { SimState } from './simulation';
import { loadIntegrations, saveRun, getAudioSources } from './integration';

const icon = (name: string) => {
  const paths: Record<string, string> = {
    bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7z"/>',
    thermometer: '<path d="M9 14.8V5a3 3 0 0 1 6 0v9.8a5 5 0 1 1-6 0Z"/><path d="M12 9v9"/>',
    pulse: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    sound: '<path d="m11 5-6 4H2v6h3l6 4zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
    mute: '<path d="m11 5-6 4H2v6h3l6 4zm5 4 6 6m-6 0 6-6"/>',
    camera: '<rect x="3" y="5" width="18" height="15" rx="3"/><circle cx="12" cy="12" r="4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>',
  };
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] ?? paths.scan) + '</svg>';
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const fmtTime = (seconds: number) => Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0') + ':' + Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0');
const evidenceIds = ['rack-b2', 'cooling', 'power', 'vent'];
const evidenceCount = (simulation: SimState) => evidenceIds.filter(id => simulation.inspected.includes(id)).length;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

$('#app').innerHTML = `
  <canvas id="world" aria-label="Interactive 3D data center. Use WASD to move, drag to look, and E to inspect nearby equipment." tabindex="0"></canvas>
  <div class="vignette" aria-hidden="true"></div>
  <header class="topbar">
    <a class="brand" href="#" id="brand" aria-label="Data Center Sim home"><span class="brand-mark">D<span></span></span><span>DATA CENTER <b>SIM</b><small>OPERATIONS TRAINING / 01</small></span></a>
    <div class="header-location"><span class="status-dot"></span> SFO–01 <span class="slash">/</span> NIGHT SHIFT</div>
    <div class="header-actions"><button id="sound" class="icon-button" title="Mute sound" aria-label="Mute sound">${icon('sound')}</button><button id="pause" class="icon-button" title="Pause · Esc" aria-label="Pause game" hidden>${icon('pause')}</button></div>
  </header>

  <section id="start-screen" class="start-screen">
    <div class="start-copy">
      <div class="eyebrow"><span class="tiny-line"></span> INCIDENT SIMULATOR</div>
      <h1>Your shift.<br>Your call.</h1>
      <p class="intro">A quiet data center. A rising temperature.<br>Find the fault before it becomes an outage.</p>
      <div class="mission-preview"><span class="mission-number">01</span><div><strong>Night Shift</strong><span>Cooling failure · Cascading consequences</span></div><span class="difficulty-bars" aria-label="Moderate difficulty"><i></i><i></i><i></i></span></div>
      <div class="setup-row"><span class="field-label">YOUR OPERATOR</span><div class="swatches" role="group" aria-label="Choose jacket color"><button class="swatch active" data-color="#ef9560" style="--swatch:#ef9560" aria-label="Amber jacket" aria-pressed="true"></button><button class="swatch" data-color="#5acbbb" style="--swatch:#5acbbb" aria-label="Mint jacket" aria-pressed="false"></button><button class="swatch" data-color="#79a9ed" style="--swatch:#79a9ed" aria-label="Blue jacket" aria-pressed="false"></button><button class="swatch" data-color="#c8a4d8" style="--swatch:#c8a4d8" aria-label="Lilac jacket" aria-pressed="false"></button></div></div>
      <div class="mode-select" role="group" aria-label="Training mode"><button data-mode="guided" class="active" aria-pressed="true"><strong>Guided shift</strong><span>Follow your field notes</span></button><button data-mode="challenge" aria-pressed="false"><strong>On your own</strong><span>Make the diagnosis</span></button></div>
      <button id="start" class="primary-button">Begin shift <span>${icon('arrow')}</span></button>
      <p class="start-hint"><kbd>W A S D</kbd> move <span>·</span> drag to look <span>·</span> <kbd>E</kbd> inspect</p>
      <p class="best-run" id="best-run"></p>
    </div>
    <div class="scene-caption"><span class="crosshair-decoration">+</span><span>EDGE FACILITY / SAN FRANCISCO<br><b>12 RACKS · 1 INCIDENT · YOUR DECISIONS</b></span></div>
    <div class="start-footer"><span><i class="status-dot"></i> SYSTEM READY</span><span>SIMULATED TELEMETRY · TRAINING PROTOTYPE</span></div>
  </section>

  <div id="hud" hidden>
    <div class="telemetry-strip">
      <div class="telemetry-item">${icon('pulse')}<div><small>SERVICE HEALTH</small><strong id="health">100<span>%</span></strong></div><div class="mini-meter"><i id="health-fill"></i></div></div>
      <div class="telemetry-item">${icon('thermometer')}<div><small>RACK B2 INLET</small><strong id="temperature">38.0<span>°C</span></strong></div><svg class="sparkline" viewBox="0 0 80 30" aria-hidden="true"><polyline id="temp-line" points="0,25 80,15" /></svg></div>
      <div class="telemetry-item">${icon('bolt')}<div><small>CIRCUIT LOAD</small><strong id="power-value">86<span>%</span></strong></div></div>
      <div class="telemetry-item shift-timer"><div><small>SHIFT REMAINING</small><strong id="timer">06:00</strong></div></div>
    </div>
    <aside class="left-hud">
      <section class="objective-panel"><div class="eyebrow"><span class="status-dot"></span> CURRENT OBJECTIVE</div><h2 id="objective-title">Investigate the alert</h2><p id="objective-detail"></p><button id="track-objective" class="text-button">Locate equipment ${icon('arrow')}</button></section>
      <div id="backup-alert" class="backup-alert" hidden>${icon('bolt')}<div><strong>ON BATTERY BACKUP</strong><span id="battery-label">90% reserve remaining</span></div></div>
      <div class="field-log"><div class="field-log-title">FIELD LOG <span id="evidence-count">0 / 4 INSPECTED</span></div><div id="log-entries"></div></div>
    </aside>
    <div class="view-controls"><button id="thermal" class="chip" aria-pressed="false">${icon('scan')} Thermal <kbd>T</kbd></button><button id="camera" class="chip">${icon('camera')} <span id="camera-label">Third person</span><kbd>V</kbd></button></div>
    <div id="thermal-legend" hidden><span>THERMAL VIEW</span><i></i><small>COOL</small><small>HOT</small></div>
    <section class="minimap-panel"><div class="map-top"><span><i class="status-dot"></i> FACILITY MAP</span><span>N ↑</span></div><canvas id="minimap" width="464" height="380" aria-label="Facility minimap. Click an equipment marker to track it."></canvas><div class="map-bottom"><span><i class="legend-dot player-dot"></i> YOU</span><span><i class="legend-dot fault-dot"></i> ALERT</span><span id="map-floor">LEVEL 01</span></div></section>
    <div id="interaction-prompt" class="interaction-prompt" hidden><kbd>E</kbd><div><small>INSPECT EQUIPMENT</small><strong id="nearby-name"></strong></div><span id="nearby-distance"></span></div>
    <div class="bottom-bar"><span><kbd>W A S D</kbd> Move <span class="desktop-hint">· Drag to look · <kbd>Shift</kbd> Run</span></span><span id="score-label">SCORE <b>0000</b></span><span><span class="status-dot"></span> SIMULATION LIVE</span></div>
    <div class="touch-controls"><div class="touch-pad"><button data-move="0,1" class="touch-up" aria-label="Move forward">↑</button><button data-move="-1,0" class="touch-left" aria-label="Move left">←</button><button data-move="0,-1" class="touch-down" aria-label="Move backward">↓</button><button data-move="1,0" class="touch-right" aria-label="Move right">→</button></div><button id="touch-inspect" class="touch-inspect" aria-label="Inspect nearest equipment">${icon('scan')}</button></div>
  </div>

  <aside id="inspector" class="inspector" hidden>
    <div class="inspector-top"><span class="eyebrow">EQUIPMENT INSPECTION</span><button id="close-inspector" class="icon-button" aria-label="Close inspection">${icon('close')}</button></div>
    <span id="equipment-kind" class="equipment-kind"></span><h2 id="equipment-name"></h2>
    <div class="equipment-meta"><span id="equipment-state"></span><span id="equipment-location"></span></div>
    <div id="equipment-readings" class="equipment-readings"></div>
    <div class="inspector-section-label">FIELD OBSERVATIONS</div><ul id="observations" class="observations"></ul>
    <div class="inspector-section-label actions-label">AVAILABLE INTERVENTIONS</div><div id="equipment-actions"></div>
    <div class="inspection-footer"><span class="status-dot"></span> The incident continues while you inspect.</div>
  </aside>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <div id="pause-screen" class="modal-scrim" hidden><section class="pause-card"><div class="eyebrow">TAKE A BREATH</div><h2>Shift paused.</h2><p>Your facility is holding its state.</p><button id="resume" class="primary-button">Back to work ${icon('play')}</button><button id="restart-from-pause" class="secondary-button">Restart briefing</button><p class="control-note">WASD move · Drag to look · E inspect<br>T thermal · V camera · Esc pause</p></section></div>
  <div id="results-screen" class="modal-scrim" hidden><section class="results-card"><div class="results-header"><span class="eyebrow" id="result-eyebrow">SHIFT REPORT</span><span class="report-stamp" id="report-stamp">SFO–01</span></div><div class="result-heading"><div><h2 id="result-title"></h2><p id="result-summary"></p></div><div class="result-grade" id="result-grade">A</div></div><div class="result-metrics" id="result-metrics"></div><div class="result-details"><div><div class="inspector-section-label">INCIDENT TIMELINE</div><ol id="result-timeline"></ol></div><div><div class="inspector-section-label">YOUR DEBRIEF</div><ul id="result-lessons"></ul></div></div><div class="results-footer"><span id="save-status">Saved on this device</span><button id="retry" class="primary-button">Take another shift ${icon('arrow')}</button></div></section></div>
  <div id="fatal-screen" class="modal-scrim" hidden><section class="pause-card"><div class="eyebrow">RENDERER UNAVAILABLE</div><h2>We need a 3D canvas.</h2><p id="fatal-message"></p><button onclick="location.reload()" class="primary-button">Try again</button></section></div>
`;

let state = createSimulation('guided');
let mode: SimState['mode'] = 'guided';
let cameraMode: 'third' | 'first' | 'overview' = 'third';
let avatarColor = '#ef9560';
let thermal = false;
let paused = false;
let inspectorId: string | null = null;
let trackedId: string | null = null;
let inspectorSignature = '';
let eventSignature = '';
let lastEventCount = 0;
let resultShown = false;
let lastFrame = 0;
let accumulator = 0;
let uiClock = 0;
let toastTimeout: ReturnType<typeof setTimeout> | undefined;
let tempHistory: number[] = [];
let graphClock = 0;
const audio = new FacilityAudio();
let soundEnabled = true;
let world: FacilityWorld;
const canvas = $<HTMLCanvasElement>('#world');

function toast(message: string, kind = 'info') {
  const target = $('#toast');
  target.textContent = message;
  target.dataset.kind = kind;
  target.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { target.hidden = true; }, 4500);
}

function syncInput() {
  world.setActive(state.status === 'running' && !paused && !inspectorId);
}

function selectEquipment(id: string) {
  if (state.status !== 'running' || paused) return;
  trackedId = id;
  if (world.getDistance(id) > 3.6) {
    toast('Equipment tracked. Walk closer to inspect it.');
    return;
  }
  inspectorId = id;
  inspectEquipment(state, id);
  inspectorSignature = '';
  $('#inspector').hidden = false;
  $('#hud').classList.add('inspecting');
  audio.cue('inspect');
  syncInput();
  updateInspector();
  $('#close-inspector').focus();
}

function closeInspector() {
  if (trackedId === inspectorId) trackedId = null;
  inspectorId = null;
  $('#inspector').hidden = true;
  $('#hud').classList.remove('inspecting');
  syncInput();
  canvas.focus({ preventScroll: true });
}

function setPause(value: boolean) {
  if (state.status !== 'running') return;
  paused = value;
  $('#pause-screen').hidden = !value;
  $('#pause').setAttribute('aria-label', value ? 'Resume game' : 'Pause game');
  audio.setRunning(!value, state.breakerTripped);
  syncInput();
  if (value) $('#resume').focus();
  else if (inspectorId) $('#close-inspector').focus();
  else canvas.focus({ preventScroll: true });
}

function toggleThermal() {
  thermal = !thermal;
  $('#thermal').classList.toggle('active', thermal);
  $('#thermal').setAttribute('aria-pressed', String(thermal));
  $('#thermal-legend').hidden = !thermal;
  audio.cue('click');
}

function cycleCamera() {
  const modes = ['third', 'first', 'overview'] as const;
  cameraMode = modes[(modes.indexOf(cameraMode) + 1) % 3];
  world.setCameraMode(cameraMode);
  $('#camera-label').textContent = { third: 'Third person', first: 'First person', overview: 'Overview' }[cameraMode];
  audio.cue('click');
}

function updateBest() {
  try {
    const best = Number(localStorage.getItem('datacentersim-best')) || 0;
    $('#best-run').textContent = best ? 'PERSONAL BEST  /  ' + best.toLocaleString() + ' PTS' : 'No account or API keys needed to play.';
  } catch { $('#best-run').textContent = 'No account or API keys needed to play.'; }
}

function beginShift() {
  state = createSimulation(mode);
  startSimulation(state);
  paused = false;
  resultShown = false;
  inspectorId = null;
  trackedId = null;
  accumulator = 0;
  inspectorSignature = '';
  eventSignature = '';
  lastEventCount = state.events.length;
  tempHistory = [];
  graphClock = 0;
  thermal = false;
  $('#thermal').classList.remove('active');
  $('#thermal').setAttribute('aria-pressed', 'false');
  $('#thermal-legend').hidden = true;
  $('#start-screen').hidden = true;
  $('#results-screen').hidden = true;
  $('#pause-screen').hidden = true;
  $('#inspector').hidden = true;
  $('#hud').hidden = false;
  $('#hud').classList.remove('inspecting');
  $('#pause').hidden = false;
  document.body.classList.add('in-game');
  world.reset();
  world.setAvatar(avatarColor);
  world.setCameraMode(cameraMode);
  audio.unlock();
  audio.setRunning(true);
  audio.cue('warning');
  syncInput();
  updateHud();
  canvas.focus({ preventScroll: true });
  toast('High temperature in Rack B2. Follow the amber marker.');
}

function briefing() {
  if (state.status === 'running') setPause(true);
  state = createSimulation(mode);
  paused = false;
  inspectorId = null;
  trackedId = null;
  resultShown = false;
  $('#start-screen').hidden = false;
  $('#hud').hidden = true;
  $('#inspector').hidden = true;
  $('#pause-screen').hidden = true;
  $('#results-screen').hidden = true;
  $('#pause').hidden = true;
  $('#toast').hidden = true;
  document.body.classList.remove('in-game');
  world.reset();
  world.setCameraMode('overview');
  world.setActive(false);
  audio.setRunning(false);
  updateBest();
  $('#start').focus();
}

function updateInspector() {
  if (!inspectorId) return;
  const equipment = EQUIPMENT.find(item => item.id === inspectorId)!;
  const isTarget = equipment.id === 'rack-b2';
  const temp = isTarget ? state.temperature : 24.2;
  let readings: [string, string][];
  if (equipment.kind === 'rack') readings = [['INLET TEMPERATURE', temp.toFixed(1) + ' °C'], ['CPU UTILIZATION', (isTarget ? state.cpu : 42).toFixed(0) + '%']];
  else if (equipment.kind === 'cooling') readings = [['POWER', state.breakerTripped ? 'OFFLINE' : 'ONLINE'], ['FAN MODE', state.breakerTripped ? 'STOPPED' : state.coolingBoosted ? 'BOOST' : 'NORMAL']];
  else if (equipment.kind === 'power') readings = [['CIRCUIT', state.breakerTripped ? 'TRIPPED' : 'ONLINE'], ['DEMAND / RESERVE', (state.breakerTripped ? state.battery : state.powerLoad).toFixed(0) + '%']];
  else readings = [['AIRFLOW', state.ventCleared ? 'CLEAR' : 'RESTRICTED'], ['AISLE', 'B / COLD SIDE']];
  $('#equipment-readings').innerHTML = readings.map(([label, value]) => '<div><small>' + label + '</small><strong>' + value + '</strong></div>').join('');
  $('#equipment-state').textContent = state.breakerTripped && equipment.kind === 'power' ? '● ATTENTION REQUIRED' : isTarget && temp > 32 ? '● TEMPERATURE ALERT' : '● INSPECTED';
  $('#observations').innerHTML = inspectEquipment(state, equipment.id).map(note => '<li>' + escapeHtml(note) + '</li>').join('');
  const signature = [inspectorId, state.workloadMigrated, state.ventCleared, state.breakerTripped, state.coolingBoosted, state.status].join('|');
  if (signature === inspectorSignature) return;
  inspectorSignature = signature;
  $('#equipment-name').textContent = equipment.name;
  $('#equipment-kind').textContent = equipment.kind.toUpperCase() + ' / SFO–01';
  $('#equipment-location').textContent = Math.round(world.getDistance(equipment.id)) + ' M FROM OPERATOR';
  const actions = getActions(state, equipment.id);
  $('#equipment-actions').innerHTML = actions.length ? actions.map(action => '<button class="intervention" data-action="' + escapeHtml(action.id) + '"' + (action.disabled ? ' disabled' : '') + '><span><strong>' + escapeHtml(action.label) + '</strong><small>' + escapeHtml(action.description) + '</small></span>' + icon(action.disabled ? 'check' : 'arrow') + '</button>').join('') : '<p class="muted-copy">No intervention needed. This rack is operating normally.</p>';
}

function updateHud() {
  const objective = getObjective(state);
  $('#objective-title').textContent = objective.title;
  $('#objective-detail').textContent = objective.detail;
  $('#track-objective').hidden = !objective.targetId;
  $('#health').innerHTML = Math.round(state.serviceHealth) + '<span>%</span>';
  $('#health-fill').style.width = Math.max(0, state.serviceHealth) + '%';
  $('#temperature').innerHTML = state.temperature.toFixed(1) + '<span>°C</span>';
  $('#temperature').classList.toggle('danger-text', state.temperature >= 50);
  $('#power-value').innerHTML = Math.round(state.powerLoad) + '<span>%</span>';
  $('#power-value').classList.toggle('danger-text', state.breakerTripped);
  $('#timer').textContent = fmtTime(state.timeLimit - state.elapsed);
  $('#timer').classList.toggle('danger-text', state.timeLimit - state.elapsed < 60);
  $('#score-label').innerHTML = 'SCORE <b>' + Math.round(state.score).toString().padStart(4, '0') + '</b>';
  $('#backup-alert').hidden = !state.breakerTripped;
  $('#battery-label').textContent = Math.max(0, state.battery).toFixed(0) + '% reserve remaining';
  const relevant = evidenceCount(state);
  $('#evidence-count').textContent = relevant + ' / 4 INSPECTED';
  const eventKey = state.events.map(event => event.id).join(',');
  if (eventKey !== eventSignature) {
    eventSignature = eventKey;
    $('#log-entries').innerHTML = state.events.slice(-3).reverse().map(event => '<div class="log-entry ' + event.kind + '"><time>' + fmtTime(event.time) + '</time><p>' + escapeHtml(event.text) + '</p></div>').join('');
  }
  const nearest = world.getNearest();
  const showPrompt = nearest && nearest.distance <= 3.6 && !inspectorId && !paused && state.status === 'running';
  $('#interaction-prompt').hidden = !showPrompt;
  if (showPrompt) {
    $('#nearby-name').textContent = EQUIPMENT.find(equipment => equipment.id === nearest.id)?.name ?? nearest.id;
    $('#nearby-distance').textContent = nearest.distance.toFixed(1) + ' m';
  }
  $('#temp-line').setAttribute('points', tempHistory.map((temp, index) => (index / Math.max(1, tempHistory.length - 1) * 80).toFixed(1) + ',' + Math.max(2, Math.min(28, 30 - (temp - 20) / 50 * 30)).toFixed(1)).join(' '));
  updateInspector();
}

const minimap = $<HTMLCanvasElement>('#minimap');
const map = minimap.getContext('2d')!;
const mx = (x: number) => 15 + (x + 14) / 28 * 202;
const my = (z: number) => 12 + (z + 16) / 32 * 166;

function drawMinimap() {
  map.setTransform(2, 0, 0, 2, 0, 0);
  map.clearRect(0, 0, 232, 190);
  map.fillStyle = '#13232a';
  map.fillRect(15, 12, 202, 166);
  map.strokeStyle = '#2c424a';
  map.lineWidth = 0.65;
  map.strokeRect(15, 12, 202, 166);
  map.strokeStyle = '#20343b';
  for (let i = -12; i <= 12; i += 4) { map.beginPath(); map.moveTo(mx(i), 12); map.lineTo(mx(i), 178); map.stroke(); }
  for (let i = -12; i <= 12; i += 4) { map.beginPath(); map.moveTo(15, my(i)); map.lineTo(217, my(i)); map.stroke(); }
  const targetId = trackedId || getObjective(state).targetId;
  for (const equipment of EQUIPMENT) {
    const hazard = equipment.id === 'rack-b2' && state.temperature > 32 || equipment.id === 'power' && state.breakerTripped;
    const x = mx(equipment.x), y = my(equipment.z);
    const width = equipment.width / 28 * 202, height = equipment.depth / 32 * 166;
    map.fillStyle = hazard ? '#f4a268' : equipment.kind === 'vent' ? (state.ventCleared ? '#84dcc7' : '#63727a') : '#435b65';
    map.fillRect(x - width / 2, y - height / 2, width, height);
    if (equipment.id === targetId) {
      map.strokeStyle = '#f6bc8d';
      map.lineWidth = 1;
      map.beginPath(); map.arc(x, y, 10 + Math.sin(state.elapsed * 3) * 1.2, 0, Math.PI * 2); map.stroke();
    }
  }
  map.fillStyle = '#a1b6ba'; map.font = '8px monospace'; map.textAlign = 'center';
  [-8, -3, 3, 8].forEach((x, index) => map.fillText('ABCD'[index], mx(x), my(5.5)));
  map.fillStyle = '#88a29f'; map.fillText('ENTRY', mx(0), my(13.7));
  const player = world.getPlayer();
  map.save(); map.translate(mx(player.x), my(player.z)); map.rotate(-player.yaw);
  map.fillStyle = '#9af0dc'; map.beginPath(); map.moveTo(0, -5.5); map.lineTo(4, 4); map.lineTo(0, 2); map.lineTo(-4, 4); map.closePath(); map.fill(); map.restore();
}

function showResults() {
  if (resultShown) return;
  resultShown = true;
  closeInspector();
  world.setActive(false);
  $('#pause').hidden = true;
  $('#toast').hidden = true;
  const postmortem = getPostmortem(state);
  const won = state.status === 'won';
  $('#results-screen').hidden = false;
  $('#result-eyebrow').textContent = won ? 'INCIDENT CONTAINED' : 'INCIDENT REVIEW';
  $('#result-title').textContent = won ? 'You kept the lights on.' : 'A lesson for next shift.';
  $('#result-summary').textContent = postmortem.summary;
  $('#result-grade').textContent = won ? (state.mistakes === 0 && evidenceCount(state) >= 3 ? 'A' : state.mistakes <= 1 ? 'B' : 'C') : 'R';
  $('#result-grade').dataset.outcome = won ? 'won' : 'lost';
  $('#result-metrics').innerHTML = [['FINAL SCORE', Math.round(state.score).toLocaleString()], ['RESPONSE TIME', fmtTime(state.elapsed)], ['SERVICE HEALTH', Math.round(state.serviceHealth) + '%'], ['MISSTEPS', String(state.mistakes)]].map(([label, value]) => '<div><small>' + label + '</small><strong>' + value + '</strong></div>').join('');
  $('#result-timeline').innerHTML = state.events.map(event => '<li class="' + event.kind + '"><time>' + fmtTime(event.time) + '</time><span>' + escapeHtml(event.text) + '</span></li>').join('');
  $('#result-lessons').innerHTML = postmortem.lessons.map(lesson => '<li>' + escapeHtml(lesson) + '</li>').join('');
  audio.cue(won ? 'success' : 'danger');
  audio.setRunning(false);
  const run = { score: Math.round(state.score), outcome: won ? 'won' as const : 'lost' as const, elapsed: state.elapsed, mode: state.mode, inspections: evidenceCount(state), mistakes: state.mistakes };
  try {
    const previous = Number(localStorage.getItem('datacentersim-best')) || 0;
    if (run.score > previous) localStorage.setItem('datacentersim-best', String(run.score));
    localStorage.setItem('datacentersim-last-run', JSON.stringify(run));
    $('#save-status').textContent = 'Saved on this device';
  } catch { $('#save-status').textContent = 'Device storage unavailable'; }
  void saveRun(run).then(result => { if (result === 'saved') $('#save-status').textContent = 'Report saved to your connected backend'; }).catch(() => { $('#save-status').textContent = 'Cloud save unavailable · local report retained'; });
  $('#retry').focus();
}

function frame(now: number) {
  // Keep movement and incident time on the same capped clock under a slow frame.
  const dt = Math.min((now - lastFrame) / 1000 || 0, 0.05);
  lastFrame = now;
  if (state.status === 'running' && !paused) {
    accumulator += dt;
    while (accumulator >= 0.1) { tickSimulation(state, 0.1); accumulator -= 0.1; }
    graphClock += dt;
    if (graphClock >= 0.6) { graphClock = 0; tempHistory.push(state.temperature); if (tempHistory.length > 40) tempHistory.shift(); }
    if (state.events.length > lastEventCount) {
      const latest = state.events[state.events.length - 1];
      if (latest.kind === 'danger' || latest.kind === 'warning') { audio.cue(latest.kind); toast(latest.text, latest.kind); }
      lastEventCount = state.events.length;
    }
  }
  if (state.status === 'won' || state.status === 'lost') showResults();
  world.update(dt, state, { thermal: state.status !== 'ready' && thermal, selectedId: trackedId || (state.status === 'running' ? getObjective(state).targetId : null), paused });
  uiClock += dt;
  if (uiClock >= 0.1) { uiClock = 0; if (state.status !== 'ready') { updateHud(); drawMinimap(); } }
  requestAnimationFrame(frame);
}

function bindControls() {
  $('#start').addEventListener('click', beginShift);
  $('#brand').addEventListener('click', event => { event.preventDefault(); if (state.status === 'running') setPause(true); });
  $('#pause').addEventListener('click', () => setPause(!paused));
  $('#resume').addEventListener('click', () => setPause(false));
  $('#restart-from-pause').addEventListener('click', briefing);
  $('#retry').addEventListener('click', briefing);
  $('#close-inspector').addEventListener('click', closeInspector);
  $('#thermal').addEventListener('click', toggleThermal);
  $('#camera').addEventListener('click', cycleCamera);
  $('#track-objective').addEventListener('click', () => { const id = getObjective(state).targetId; if (id) { trackedId = id; toast('Tracking ' + EQUIPMENT.find(item => item.id === id)?.name + ' on your minimap.'); } });
  $('#sound').addEventListener('click', () => {
    soundEnabled = !soundEnabled; audio.setEnabled(soundEnabled); if (soundEnabled) audio.unlock();
    $('#sound').innerHTML = icon(soundEnabled ? 'sound' : 'mute');
    $('#sound').setAttribute('aria-label', soundEnabled ? 'Mute sound' : 'Enable sound');
    $('#sound').title = soundEnabled ? 'Mute sound' : 'Enable sound';
  });
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mode as SimState['mode'];
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(button => button.addEventListener('click', () => {
    avatarColor = button.dataset.color!; world.setAvatar(avatarColor);
    document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(item => { item.classList.toggle('active', item === button); item.setAttribute('aria-pressed', String(item === button)); });
  }));
  $('#equipment-actions').addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!button || button.disabled || !inspectorId || paused || state.status !== 'running') return;
    if (world.getDistance(inspectorId) > 3.6) { toast('Move closer to the equipment to intervene.'); return; }
    const previousEventCount = state.events.length;
    const result = applyAction(state, inspectorId, button.dataset.action!);
    const emitted = state.events.slice(previousEventCount);
    const severity = emitted.some(event => event.kind === 'danger') ? 'danger' : emitted.some(event => event.kind === 'warning') ? 'warning' : result.ok ? 'success' : 'warning';
    lastEventCount = state.events.length;
    audio.cue(severity);
    audio.setRunning(true, state.breakerTripped);
    toast(result.message, severity);
    inspectorSignature = '';
    updateInspector();
  });
  const inspectNearest = () => { const nearest = world.getNearest(); if (nearest && nearest.distance <= 3.6) selectEquipment(nearest.id); else toast('Walk closer to equipment. Look for the amber marker.'); };
  $('#touch-inspect').addEventListener('click', inspectNearest);
  document.addEventListener('keydown', event => {
    if (event.repeat || (event.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) return;
    if (event.code === 'Escape') { if (paused) setPause(false); else if (inspectorId) closeInspector(); else setPause(true); return; }
    if (state.status !== 'running' || paused) return;
    if (event.code === 'KeyE') { event.preventDefault(); if (inspectorId) closeInspector(); else inspectNearest(); }
    if (event.code === 'KeyT') toggleThermal();
    if (event.code === 'KeyV') cycleCamera();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && state.status === 'running') setPause(true); });
  minimap.addEventListener('click', event => {
    const rect = minimap.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * 232, y = (event.clientY - rect.top) / rect.height * 190;
    const nearest = [...EQUIPMENT].sort((a, b) => Math.hypot(mx(a.x) - x, my(a.z) - y) - Math.hypot(mx(b.x) - x, my(b.z) - y))[0];
    if (nearest && Math.hypot(mx(nearest.x) - x, my(nearest.z) - y) < 17) { trackedId = nearest.id; toast('Tracking ' + nearest.name + '.'); }
  });
  document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); const [x, y] = button.dataset.move!.split(',').map(Number); world.setTouchMove(x, y); });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, () => world.setTouchMove(0, 0));
  });
}

try {
  world = new FacilityWorld(canvas, selectEquipment);
  world.setCameraMode('overview');
  world.setActive(false);
  bindControls();
  updateBest();
  requestAnimationFrame(frame);
  void loadIntegrations(world, message => toast(message))
    .then(() => audio.setSources(getAudioSources()))
    .catch(error => toast('Optional asset loading failed. Local facility is ready. ' + (error instanceof Error ? error.message : ''), 'warning'));
  window.addEventListener('pagehide', event => { if (!event.persisted) { audio.dispose(); world.dispose(); } });
} catch (error) {
  $('#fatal-screen').hidden = false;
  $('#fatal-message').textContent = 'Try a recent Chrome, Edge, or Safari with hardware acceleration enabled. ' + (error instanceof Error ? error.message : 'Your browser could not initialize WebGL.');
}
