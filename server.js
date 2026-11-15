// Blob Arena — tiny authoritative multiplayer server.
// Serves the client from ./public and runs the game over WebSockets at /ws.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const WORLD = 3000;
const PELLET_TARGET = 5000;
const TICK_HZ = 30;
const SEND_EVERY = 2; // snapshots at 15 Hz
const MAX_PLAYERS = 100;
const START_MASS = 20;
const RESPAWN_MS = 2000;

// ---------- static files ----------
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/game.js": ["game.js", "text/javascript; charset=utf-8"],
};
const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }
  const entry = STATIC[url];
  if (!entry) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("not found");
  }
  fs.readFile(path.join(__dirname, "public", entry[0]), (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end("error");
    }
    res.writeHead(200, { "content-type": entry[1], "cache-control": "no-cache" });
    res.end(data);
  });
});

// ---------- game state ----------
const rand = (a, b) => a + Math.random() * (b - a);
const radius = (m) => 4 * Math.sqrt(m);
const speedFor = (r) => 40 + 200 * Math.pow(18 / r, 0.45); // px/s

let nextPelletId = 1;
const pellets = new Map(); // id -> [id, x, y, hue]
let addedPellets = [];
let removedPellets = [];

function spawnPellet() {
  const p = [nextPelletId++, Math.round(rand(20, WORLD - 20)), Math.round(rand(20, WORLD - 20)), Math.floor(rand(0, 360))];
  pellets.set(p[0], p);
  addedPellets.push(p);
}
for (let i = 0; i < PELLET_TARGET; i++) spawnPellet();
addedPellets = [];

let nextPlayerId = 1;
const players = new Map(); // id -> player

function cleanName(n) {
  if (typeof n !== "string") return "";
  return n.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16);
}

function respawn(p) {
  p.mass = START_MASS;
  p.x = rand(100, WORLD - 100);
  p.y = rand(100, WORLD - 100);
  p.alive = true;
  p.respawnAt = 0;
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------- networking ----------
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 512 });

wss.on("connection", (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: "full" });
    return ws.close();
  }
  const id = nextPlayerId++;
  const p = {
    id,
    ws,
    name: "Blob " + Math.floor(rand(100, 999)),
    hue: Math.floor(rand(0, 360)),
    x: 0,
    y: 0,
    mass: START_MASS,
    angle: 0,
    throttle: 0,
    alive: false,
    respawnAt: 0,
    kills: 0,
  };
  respawn(p);
  players.set(id, p);
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));

  send(ws, { t: "w", id, world: WORLD, pellets: [...pellets.values()] });

  ws.on("message", (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    if (m.t === "i") {
      const a = Number(m.a);
      const d = Number(m.d);
      if (Number.isFinite(a)) p.angle = a;
      if (Number.isFinite(d)) p.throttle = Math.max(0, Math.min(1, d));
    } else if (m.t === "n") {
      const n = cleanName(m.name);
      if (n) p.name = n;
    }
  });

  ws.on("close", () => players.delete(id));
  ws.on("error", () => players.delete(id));
});

// drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

// ---------- game loop ----------
let tick = 0;
setInterval(() => {
  const dt = 1 / TICK_HZ;
  const now = Date.now();
  const list = [...players.values()];

  for (const p of list) {
    if (!p.alive) {
      if (p.respawnAt && now >= p.respawnAt) respawn(p);
      continue;
    }
    const r = radius(p.mass);
    const sp = speedFor(r) * p.throttle;
    p.x = Math.max(r * 0.5, Math.min(WORLD - r * 0.5, p.x + Math.cos(p.angle) * sp * dt));
    p.y = Math.max(r * 0.5, Math.min(WORLD - r * 0.5, p.y + Math.sin(p.angle) * sp * dt));
    if (p.mass > 100) p.mass *= 1 - 0.003 * dt; // slow decay keeps the leaderboard moving

    // eat pellets (simple scan; fine for a few hundred pellets)
    for (const pel of pellets.values()) {
      const dx = pel[1] - p.x;
      const dy = pel[2] - p.y;
      if (dx * dx + dy * dy < r * r) {
        pellets.delete(pel[0]);
        removedPellets.push(pel[0]);
        p.mass += 1;
      }
    }
  }

  // eat players
  for (const a of list) {
    if (!a.alive) continue;
    const ra = radius(a.mass);
    for (const b of list) {
      if (a === b || !b.alive) continue;
      const rb = radius(b.mass);
      if (ra < rb * 1.15) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < ra * ra) {
        a.mass += b.mass * 0.8;
        a.kills++;
        b.alive = false;
        b.respawnAt = now + RESPAWN_MS;
        send(b.ws, { t: "dead", by: a.name, mass: Math.round(b.mass) });
      }
    }
  }

  while (pellets.size < PELLET_TARGET) spawnPellet();

  if (++tick % SEND_EVERY !== 0) return;

  const snap = [];
  for (const p of list) {
    if (p.alive) snap.push([p.id, Math.round(p.x), Math.round(p.y), Math.round(radius(p.mass) * 10) / 10, p.name, p.hue]);
  }
  const lb = list
    .filter((p) => p.alive)
    .sort((x, y) => y.mass - x.mass)
    .slice(0, 5)
    .map((p) => [p.id, p.name, Math.round(p.mass)]);
  const msg = JSON.stringify({ t: "s", p: snap, pa: addedPellets, pr: removedPellets, lb, n: list.length });
  addedPellets = [];
  removedPellets = [];
  for (const p of list) if (p.ws.readyState === 1) p.ws.send(msg);
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`Blob Arena running on http://localhost:${PORT}`));
