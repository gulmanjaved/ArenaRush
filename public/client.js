const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const mctx = minimap.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', resize);
resize();

const socket = io();
let myId = null;
let worldSize = 4000;
let latestState = { players: [], orbs: [] };
let mouse = { x: 0, y: 0 };
let boosting = false;
let alive = false;

// --- interpolation buffer: smooths rendering between server ticks so
// movement doesn't stutter if a network packet arrives a bit late ---
let stateBuffer = []; // [{t, state}]
const INTERP_DELAY = 100; // ms of deliberate render delay, smooths jitter

const startScreen = document.getElementById('start-screen');
const deathScreen = document.getElementById('death-screen');
const nameInput = document.getElementById('name-input');
const playBtn = document.getElementById('play-btn');
const respawnBtn = document.getElementById('respawn-btn');
const finalScoreEl = document.getElementById('final-score');
const scoreValEl = document.getElementById('score-val');
const lbList = document.getElementById('lb-list');

function join() {
  const name = nameInput.value.trim() || 'Player';
  socket.emit('join', name);
  startScreen.classList.add('hidden');
  deathScreen.classList.add('hidden');
  alive = true;
}
playBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
respawnBtn.addEventListener('click', join);

socket.on('welcome', (data) => {
  myId = data.id;
  worldSize = data.worldSize;
});

socket.on('state', (state) => {
  const now = performance.now();
  stateBuffer.push({ t: now, state });
  // keep only the last ~1s of snapshots
  while (stateBuffer.length > 2 && now - stateBuffer[0].t > 1000) stateBuffer.shift();
  latestState = state; // used for non-visual logic (leaderboard, death check)

  const me = state.players.find(p => p.id === myId);
  if (me) {
    scoreValEl.textContent = me.score;
    if (!me.alive && alive) {
      alive = false;
      finalScoreEl.textContent = me.score;
      deathScreen.classList.remove('hidden');
    } else if (me.alive) {
      alive = true;
    }
  }
  renderLeaderboard(state.players);
});

function renderLeaderboard(playersArr) {
  const top = [...playersArr].filter(p => p.alive).sort((a, b) => b.score - a.score).slice(0, 8);
  lbList.innerHTML = top.map((p, i) =>
    `<li><span class="name">${i + 1}. ${escapeHtml(p.name)}${p.id === myId ? ' (you)' : ''}</span><span>${p.score}</span></li>`
  ).join('');
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// input
window.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('keydown', (e) => { if (e.code === 'Space') { boosting = true; e.preventDefault(); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') { boosting = false; } });

setInterval(() => {
  if (!myId || !alive) return;
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const angle = Math.atan2(mouse.y - cy, mouse.x - cx);
  socket.emit('input', { angle, boosting });
}, 1000 / 30);

function getMe() { return latestState.players.find(p => p.id === myId); }

function lerp(a, b, t) { return a + (b - a) * t; }

// Returns a state object interpolated between two buffered snapshots at
// (now - INTERP_DELAY), so rendering is smooth even if a server tick is late.
function getRenderState() {
  const renderTime = performance.now() - INTERP_DELAY;
  if (stateBuffer.length === 0) return latestState;
  if (stateBuffer.length === 1) return stateBuffer[0].state;

  // find the two snapshots surrounding renderTime
  let older = stateBuffer[0], newer = stateBuffer[stateBuffer.length - 1];
  for (let i = 0; i < stateBuffer.length - 1; i++) {
    if (stateBuffer[i].t <= renderTime && stateBuffer[i + 1].t >= renderTime) {
      older = stateBuffer[i];
      newer = stateBuffer[i + 1];
      break;
    }
  }
  const span = newer.t - older.t;
  const t = span > 0 ? Math.max(0, Math.min(1, (renderTime - older.t) / span)) : 1;

  const interpPlayers = newer.state.players.map(np => {
    const op = older.state.players.find(p => p.id === np.id);
    if (!op || !np.alive || !op.alive || op.segments.length !== np.segments.length) return np;
    return {
      ...np,
      x: lerp(op.x, np.x, t),
      y: lerp(op.y, np.y, t),
      segments: np.segments.map((seg, i) => ({
        x: lerp(op.segments[i].x, seg.x, t),
        y: lerp(op.segments[i].y, seg.y, t)
      }))
    };
  });

  return { players: interpPlayers, orbs: newer.state.orbs };
}

function draw() {
  requestAnimationFrame(draw);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const renderState = getRenderState();
  const me = renderState.players.find(p => p.id === myId) || getMe();
  const camX = me ? me.x : worldSize / 2;
  const camY = me ? me.y : worldSize / 2;

  ctx.save();
  ctx.translate(canvas.width / 2 - camX, canvas.height / 2 - camY);

  // grid background
  drawGrid(camX, camY);

  // world border
  ctx.strokeStyle = 'rgba(255,80,80,0.5)';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, worldSize, worldSize);

  // orbs
  for (const o of renderState.orbs) {
    ctx.beginPath();
    ctx.fillStyle = o.color;
    ctx.shadowColor = o.color;
    ctx.shadowBlur = 8;
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // players
  for (const p of renderState.players) {
    if (!p.alive) continue;
    drawSnake(p, p.id === myId);
  }

  ctx.restore();
  drawMinimap();
}

function drawGrid(camX, camY) {
  const size = 50;
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 1;
  const startX = Math.floor((camX - canvas.width) / size) * size;
  const endX = camX + canvas.width;
  const startY = Math.floor((camY - canvas.height) / size) * size;
  const endY = camY + canvas.height;
  ctx.beginPath();
  for (let x = startX; x < endX; x += size) { ctx.moveTo(x, startY); ctx.lineTo(x, endY); }
  for (let y = startY; y < endY; y += size) { ctx.moveTo(startX, y); ctx.lineTo(endX, y); }
  ctx.stroke();
}

function drawSnake(p, isMe) {
  const segs = p.segments;
  if (!segs || segs.length === 0) return;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const width = 8 + Math.min(20, p.length * 0.15);
  ctx.strokeStyle = p.color;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(segs[0].x, segs[0].y);
  for (let i = 1; i < segs.length; i++) ctx.lineTo(segs[i].x, segs[i].y);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // head glow
  ctx.beginPath();
  ctx.fillStyle = isMe ? '#ffffff' : p.color;
  ctx.shadowColor = p.color;
  ctx.shadowBlur = isMe ? 15 : 6;
  ctx.arc(segs[0].x, segs[0].y, width / 2 + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // name label
  ctx.font = '12px Segoe UI';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textAlign = 'center';
  ctx.fillText(p.name, segs[0].x, segs[0].y - width / 2 - 8);
}

function drawMinimap() {
  mctx.clearRect(0, 0, 140, 140);
  const scale = 140 / worldSize;
  mctx.fillStyle = 'rgba(255,255,255,0.03)';
  mctx.fillRect(0, 0, 140, 140);
  for (const p of latestState.players) {
    if (!p.alive) continue;
    mctx.beginPath();
    mctx.fillStyle = p.id === myId ? '#ffffff' : p.color;
    mctx.arc(p.x * scale, p.y * scale, p.id === myId ? 3 : 2, 0, Math.PI * 2);
    mctx.fill();
  }
}

draw();
