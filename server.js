// Blob Devour — serves the game and keeps a small global leaderboard.
// The game itself runs entirely in the browser.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const SCORES_FILE = path.join(__dirname, "scores.json");
const MIN_TIME_MS = 10 * 60 * 1000; // anything faster is not a real run
const MAX_TIME_MS = 6 * 60 * 60 * 1000;
const KEEP_PER_BOARD = 100;
const SHOW_PER_BOARD = 20;

// ---------- static files ----------
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
};
// game modules: only plain file names inside public/js, so nothing outside that folder can be read
const JS_MODULE = /^\/js\/([a-z]+)\.js$/;

// ---------- leaderboard storage ----------
let scores = { all: [], fresh: [] };
try {
  const loaded = JSON.parse(fs.readFileSync(SCORES_FILE, "utf8"));
  if (Array.isArray(loaded.all) && Array.isArray(loaded.fresh)) scores = loaded;
} catch {
  // no file yet (or it was wiped by a restart) — start empty
}

let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(SCORES_FILE, JSON.stringify(scores), () => {});
  }, 500);
}

function insert(board, entry) {
  board.push(entry);
  board.sort((a, b) => a.timeMs - b.timeMs);
  if (board.length > KEEP_PER_BOARD) board.length = KEEP_PER_BOARD;
}

function cleanName(n) {
  if (typeof n !== "string") return "";
  return n.replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, 16);
}

// simple per-IP rate limit: 6 submissions per minute
const recent = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (recent.get(ip) || []).filter((t) => now - t < 60000);
  if (list.length >= 6) return false;
  list.push(now);
  recent.set(ip, list);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of recent) if (!list.some((t) => now - t < 60000)) recent.delete(ip);
}, 60000);

// ---------- http ----------
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];

  if (url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    return res.end("ok");
  }

  if (url === "/api/leaderboard" && req.method === "GET") {
    return json(res, 200, {
      all: scores.all.slice(0, SHOW_PER_BOARD),
      fresh: scores.fresh.slice(0, SHOW_PER_BOARD),
    });
  }

  if (url === "/api/score" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1000) req.destroy();
    });
    req.on("end", () => {
      let m;
      try {
        m = JSON.parse(body);
      } catch {
        return json(res, 400, { error: "bad json" });
      }
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (!allowed(ip)) return json(res, 429, { error: "slow down" });
      const name = cleanName(m && m.name) || "Anonymous";
      const timeMs = Math.round(Number(m && m.timeMs));
      const prestige = Math.max(0, Math.floor(Number(m && m.prestige) || 0));
      const fresh = !!(m && m.fresh);
      if (!Number.isFinite(timeMs) || timeMs < MIN_TIME_MS || timeMs > MAX_TIME_MS) {
        return json(res, 400, { error: "invalid time" });
      }
      const entry = { name, timeMs, prestige: fresh ? 0 : prestige, fresh, at: Date.now() };
      insert(scores.all, entry);
      if (fresh || prestige === 0) insert(scores.fresh, entry);
      saveSoon();
      const rank = scores.all.indexOf(entry) + 1;
      const freshRank = scores.fresh.indexOf(entry) + 1;
      json(res, 200, { ok: true, rank: rank || null, freshRank: freshRank || null });
    });
    return;
  }

  let entry = STATIC[url];
  const mod = url.match(JS_MODULE);
  if (!entry && mod) entry = [path.join("js", `${mod[1]}.js`), "text/javascript; charset=utf-8"];
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

server.listen(PORT, () => console.log(`Blob Devour running on http://localhost:${PORT}`));
