const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- World config ----------
const WORLD_SIZE = 4000;
const ORB_COUNT = 400;
const TICK_RATE = 30; // server ticks per second
const START_LENGTH = 8;
const SEGMENT_SPACING = 12;
const BASE_SPEED = 2.6;
const BOOST_SPEED = 4.8;
const BOOST_DRAIN = 0.15; // length lost per tick while boosting
const TURN_RATE = 0.09;
const GRID_CELL = 150;
const BOT_COUNT = 6;
const COLORS = ['#ff5e5e', '#5ecbff', '#5eff8f', '#ffd75e', '#c95eff', '#ff9d5e', '#5effe8', '#ff5ec4'];

let nextId = 1;
const players = new Map(); // id -> player object (includes bots)
const orbs = new Map(); // id -> {id,x,y,r,color,value}
let nextOrbId = 1;

function rand(min, max) { return Math.random() * (max - min) + min; }
function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }

function spawnOrb() {
  const id = nextOrbId++;
  orbs.set(id, {
    id,
    x: rand(50, WORLD_SIZE - 50),
    y: rand(50, WORLD_SIZE - 50),
    r: rand(4, 7),
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    value: 1
  });
}
for (let i = 0; i < ORB_COUNT; i++) spawnOrb();

function makeSegments(x, y, len) {
  const segs = [];
  for (let i = 0; i < len; i++) segs.push({ x: x - i * SEGMENT_SPACING, y });
  return segs;
}

function spawnPlayer(id, name, isBot) {
  const x = rand(300, WORLD_SIZE - 300);
  const y = rand(300, WORLD_SIZE - 300);
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];
  return {
    id, name: name || `Player${id}`, isBot: !!isBot,
    x, y, angle: rand(0, Math.PI * 2), targetAngle: rand(0, Math.PI * 2),
    speed: BASE_SPEED, boosting: false, alive: true,
    length: START_LENGTH, segments: makeSegments(x, y, START_LENGTH),
    color, score: 0, respawnTimer: 0
  };
}

// bots
for (let i = 0; i < BOT_COUNT; i++) {
  const id = 'bot_' + (nextId++);
  players.set(id, spawnPlayer(id, `Bot${i + 1}`, true));
}

function killPlayer(p) {
  p.alive = false;
  p.respawnTimer = 90; // ticks (~3s)
  // burst into orbs along the body
  for (let i = 0; i < p.segments.length; i += 2) {
    const seg = p.segments[i];
    const id = nextOrbId++;
    orbs.set(id, { id, x: seg.x + rand(-15, 15), y: seg.y + rand(-15, 15), r: rand(5, 8), color: p.color, value: 2 });
  }
}

function gridKey(x, y) { return Math.floor(x / GRID_CELL) + '_' + Math.floor(y / GRID_CELL); }

function tick() {
  // build spatial grid of all body segments for collision checks
  const grid = new Map();
  for (const p of players.values()) {
    if (!p.alive) continue;
    for (let i = 4; i < p.segments.length; i++) { // skip near-head segments of own body
      const seg = p.segments[i];
      const key = gridKey(seg.x, seg.y);
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push({ ownerId: p.id, x: seg.x, y: seg.y });
    }
  }

  for (const p of players.values()) {
    if (!p.alive) {
      if (p.respawnTimer > 0) {
        p.respawnTimer--;
        if (p.respawnTimer <= 0) {
          const np = spawnPlayer(p.id, p.name, p.isBot);
          Object.assign(p, np);
        }
      }
      continue;
    }

    // bot AI: steer toward nearest orb
    if (p.isBot) {
      let nearest = null, nd = Infinity;
      for (const o of orbs.values()) {
        const d = dist2(p.x, p.y, o.x, o.y);
        if (d < nd) { nd = d; nearest = o; }
      }
      if (nearest) p.targetAngle = Math.atan2(nearest.y - p.y, nearest.x - p.x);
      p.boosting = false;
      // steer away from walls
      const margin = 200;
      if (p.x < margin || p.x > WORLD_SIZE - margin || p.y < margin || p.y > WORLD_SIZE - margin) {
        p.targetAngle = Math.atan2(WORLD_SIZE / 2 - p.y, WORLD_SIZE / 2 - p.x);
      }
    }

    // smooth turning
    let diff = p.targetAngle - p.angle;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.angle += Math.max(-TURN_RATE, Math.min(TURN_RATE, diff));

    const speed = (p.boosting && p.length > START_LENGTH + 2) ? BOOST_SPEED : BASE_SPEED;
    if (p.boosting && p.length > START_LENGTH + 2) {
      p.length = Math.max(START_LENGTH, p.length - BOOST_DRAIN);
    }

    p.x += Math.cos(p.angle) * speed;
    p.y += Math.sin(p.angle) * speed;
    p.x = Math.max(10, Math.min(WORLD_SIZE - 10, p.x));
    p.y = Math.max(10, Math.min(WORLD_SIZE - 10, p.y));

    // move segments (follow-the-leader)
    p.segments.unshift({ x: p.x, y: p.y });
    const desiredLen = Math.max(START_LENGTH, Math.floor(p.length));
    while (p.segments.length > desiredLen) p.segments.pop();

    // orb collection
    const ok = gridKey(p.x, p.y);
    for (const o of orbs.values()) {
      if (dist2(p.x, p.y, o.x, o.y) < 20 * 20) {
        p.length += o.value * 0.8;
        p.score += o.value;
        orbs.delete(o.id);
        spawnOrb();
      }
    }

    // collision with other bodies
    const cx = Math.floor(p.x / GRID_CELL), cy = Math.floor(p.y / GRID_CELL);
    outer:
    for (let gx = -1; gx <= 1; gx++) {
      for (let gy = -1; gy <= 1; gy++) {
        const bucket = grid.get((cx + gx) + '_' + (cy + gy));
        if (!bucket) continue;
        for (const seg of bucket) {
          if (seg.ownerId === p.id) continue;
          if (dist2(p.x, p.y, seg.x, seg.y) < 11 * 11) {
            killPlayer(p);
            const other = players.get(seg.ownerId);
            if (other) other.score += 5;
            break outer;
          }
        }
      }
    }
  }

  // broadcast state — round coordinates to shrink payload size over the network
  const r1 = (n) => Math.round(n * 10) / 10;
  const state = {
    players: Array.from(players.values()).map(p => ({
      id: p.id, name: p.name, x: r1(p.x), y: r1(p.y), angle: r1(p.angle),
      alive: p.alive, length: Math.floor(p.length),
      segments: p.segments.map(s => ({ x: r1(s.x), y: r1(s.y) })),
      color: p.color, score: p.score, isBot: p.isBot
    })),
    orbs: Array.from(orbs.values()).map(o => ({ id: o.id, x: r1(o.x), y: r1(o.y), r: o.r, color: o.color, value: o.value }))
  };
  io.emit('state', state);
}

setInterval(tick, 1000 / TICK_RATE);

io.on('connection', (socket) => {
  const id = 'p_' + (nextId++);
  let joined = false;

  socket.on('join', (name) => {
    if (joined) return;
    joined = true;
    const p = spawnPlayer(id, (name || 'Player').slice(0, 16), false);
    players.set(id, p);
    socket.emit('welcome', { id, worldSize: WORLD_SIZE });
  });

  socket.on('input', (data) => {
    const p = players.get(id);
    if (!p || !p.alive) return;
    if (typeof data.angle === 'number') p.targetAngle = data.angle;
    p.boosting = !!data.boosting;
  });

  socket.on('disconnect', () => {
    players.delete(id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Arena Rush running on http://localhost:${PORT}`));
