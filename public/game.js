(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const $ = (id) => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const COLORS = {
    bg: css.getPropertyValue("--bg").trim(),
    grid: css.getPropertyValue("--grid").trim(),
    edge: css.getPropertyValue("--edge").trim(),
  };

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- state ----------
  let myId = null;
  let world = 3000;
  const pellets = new Map(); // id -> [id,x,y,hue]
  const blobs = new Map(); // id -> {x,y,r,tx,ty,tr,name,hue,seen}
  let leaderboard = [];
  let online = 0;
  let cam = { x: 1500, y: 1500, zoom: 1 };
  let dead = false;

  // ---------- name ----------
  const nameInput = $("name");
  let savedName = "";
  try { savedName = localStorage.getItem("blobName") || ""; } catch {}
  nameInput.value = savedName;
  function sendName() {
    const n = nameInput.value.trim().slice(0, 16);
    if (!n) return;
    try { localStorage.setItem("blobName", n); } catch {}
    send({ t: "n", name: n });
  }
  nameInput.addEventListener("change", sendName);
  nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); e.stopPropagation(); });

  // ---------- network ----------
  let ws = null;
  let retry = 500;
  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    setStatus("Connecting…");
    ws.onopen = () => {
      retry = 500;
      setStatus(null);
      if (nameInput.value.trim()) sendName();
    };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "w") {
        myId = m.id;
        world = m.world;
        pellets.clear();
        blobs.clear();
        for (const p of m.pellets) pellets.set(p[0], p);
      } else if (m.t === "s") {
        for (const id of m.pr) pellets.delete(id);
        for (const p of m.pa) pellets.set(p[0], p);
        const seen = new Set();
        for (const [id, x, y, r, name, hue] of m.p) {
          seen.add(id);
          const b = blobs.get(id);
          if (b) { b.tx = x; b.ty = y; b.tr = r; b.name = name; b.hue = hue; }
          else blobs.set(id, { x, y, r, tx: x, ty: y, tr: r, name, hue });
          if (id === myId && dead) { dead = false; $("overlay").style.display = "none"; }
        }
        for (const id of blobs.keys()) if (!seen.has(id)) blobs.delete(id);
        leaderboard = m.lb;
        online = m.n;
        renderHud();
      } else if (m.t === "dead") {
        dead = true;
        $("deathMsg").textContent = `Eaten by ${m.by}!`;
        $("overlay").style.display = "flex";
      } else if (m.t === "full") {
        setStatus("Server is full — try again in a bit.");
      }
    };
    ws.onclose = () => {
      setStatus("Reconnecting…");
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 8000);
    };
  }
  function setStatus(text) {
    const el = $("status");
    el.style.display = text ? "block" : "none";
    if (text) el.textContent = text;
  }

  // ---------- input ----------
  let pointer = { x: 0, y: 0, active: false };
  function setPointer(x, y) { pointer.x = x; pointer.y = y; pointer.active = true; }
  canvas.addEventListener("mousemove", (e) => setPointer(e.clientX, e.clientY));
  canvas.addEventListener("touchstart", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", () => { pointer.active = false; });
  canvas.addEventListener("mousedown", () => nameInput.blur());

  setInterval(() => {
    if (!pointer.active) return send({ t: "i", a: 0, d: 0 });
    const dx = pointer.x - W / 2;
    const dy = pointer.y - H / 2;
    const dist = Math.hypot(dx, dy);
    const me = blobs.get(myId);
    const r = me ? me.r * cam.zoom : 20;
    send({ t: "i", a: Math.atan2(dy, dx), d: Math.min(1, Math.max(0, (dist - r * 0.3) / 120)) });
  }, 50);

  // ---------- HUD ----------
  function renderHud() {
    const me = blobs.get(myId);
    $("mass").textContent = me ? Math.round((me.tr / 4) ** 2) : 0;
    $("online").textContent = online;
    const ol = $("lbList");
    ol.replaceChildren(...leaderboard.map(([id, name, mass]) => {
      const li = document.createElement("li");
      li.textContent = `${name} — ${mass}`;
      if (id === myId) li.className = "me";
      return li;
    }));
  }

  // ---------- render ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const k = Math.min(1, dt * 12);
    for (const b of blobs.values()) {
      b.x += (b.tx - b.x) * k;
      b.y += (b.ty - b.y) * k;
      b.r += (b.tr - b.r) * k;
    }
    const me = blobs.get(myId);
    if (me) {
      cam.x += (me.x - cam.x) * Math.min(1, dt * 10);
      cam.y += (me.y - cam.y) * Math.min(1, dt * 10);
      const targetZoom = Math.max(0.35, Math.min(1.2, Math.pow(18 / me.r, 0.4))) * Math.min(1, Math.max(W, H) / 1100 + 0.25);
      cam.zoom += (targetZoom - cam.zoom) * Math.min(1, dt * 3);
    }
    draw();
    requestAnimationFrame(frame);
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    const z = cam.zoom;
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z), DPR * (H / 2 - cam.y * z));

    const vx0 = cam.x - W / 2 / z, vx1 = cam.x + W / 2 / z;
    const vy0 = cam.y - H / 2 / z, vy1 = cam.y + H / 2 / z;

    // grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    const step = 50;
    for (let x = Math.max(0, Math.floor(vx0 / step) * step); x <= Math.min(world, vx1); x += step) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(world, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / step) * step); y <= Math.min(world, vy1); y += step) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(world, vx1), y); }
    ctx.stroke();

    // world edge
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 4 / z;
    ctx.strokeRect(0, 0, world, world);

    // pellets
    for (const [, x, y, hue] of pellets.values()) {
      if (x < vx0 - 10 || x > vx1 + 10 || y < vy0 - 10 || y > vy1 + 10) continue;
      ctx.fillStyle = `hsl(${hue} 75% 60%)`;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // blobs, small first so big ones draw on top
    const sorted = [...blobs.entries()].sort((a, b) => a[1].r - b[1].r);
    for (const [id, b] of sorted) {
      if (b.x + b.r < vx0 || b.x - b.r > vx1 || b.y + b.r < vy0 || b.y - b.r > vy1) continue;
      ctx.fillStyle = `hsl(${b.hue} 65% 55%)`;
      ctx.strokeStyle = `hsl(${b.hue} 65% 38%)`;
      ctx.lineWidth = Math.max(3, b.r * 0.08);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (id === myId) {
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2 / z;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 4 / z, 0, Math.PI * 2);
        ctx.stroke();
      }
      const fs = Math.max(10, b.r * 0.38);
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = fs * 0.18;
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(b.name, b.x, b.y);
      ctx.fillStyle = "#fff";
      ctx.fillText(b.name, b.x, b.y);
    }
  }

  connect();
  requestAnimationFrame(frame);
})();
