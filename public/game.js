(() => {
  // ================= config =================
  const params = new URLSearchParams(location.search);
  const DEBUG = params.get("debug") === "1";
  const CFG = {
    world: DEBUG ? 3000 : 102500,
    blobCount: DEBUG ? 20 : 1000000,
    clusters: DEBUG ? 0 : 600, // dense patches; the rest of the blobs are scattered evenly
    clusterShare: 0.6,
    startMass: 20,
    parMs: DEBUG ? 30000 : 40 * 60 * 1000, // beat par (40 min) for bonus Essence
    seed: 1337, // same map every run, so routes can be learned
    baseSpeed: 110,
    sizeSpeedExp: 0.5, // bigger blobs move faster: speed × (radius/18)^this
    zoomExp: 0.7, // how fast the camera pulls out as you grow
    gridSize: DEBUG ? 250 : 500, // spatial grid cell size
    accel: 9, // how quickly velocity catches up to input (higher = less drift)
    dashBase: 220, // px at starting size; scales with √size
    dashDur: 0.28, // seconds
    splitCount: 8, // speedrun checkpoints per run
    comboBase: 1.1, // seconds between bites to keep a combo
    comboCap: 40,
  };
  const SAVE_KEY = DEBUG ? "blobDevourSave_debug" : "blobDevourSave";
  const COST_SCALE = DEBUG ? 0.1 : 1;
  const PERK_MULT = 1.6;
  const BUY_KEYS = ["z", "x", "c"];
  const pct = (x) => `${Math.round(x)}%`;

  // In-run upgrades: few tiers, each a big step. Early tiers are cheap, late tiers are for the late game.
  const ABILITIES = [
    { id: "speed", icon: "»", name: "Speed", kind: "Passive", desc: "Higher top speed. You also get faster as you grow.", unlock: 0,
      subs: [
        { id: "lvl", name: "Top speed", costs: [50, 400, 3000, 20000, 150000, 1000000], info: (l) => `+${pct(l * 25)} speed` },
      ] },
    { id: "gobble", icon: "✦", name: "Gobble", kind: "Passive", desc: "More from every blob, and longer combos.", unlock: 0,
      subs: [
        { id: "goo", name: "Goo per blob", costs: [40, 300, 2500, 18000, 120000, 800000], info: (l) => `+${pct(l * 50)} Goo` },
        { id: "combo", name: "Combo window", costs: [500, 6000, 60000, 500000], info: (l) => `${(CFG.comboBase + 0.4 * l).toFixed(1)}s to keep a combo` },
        { id: "mass", name: "Mass per blob", costs: [200, 2500, 25000, 250000], info: (l) => `+${pct(l * 25)} mass` },
      ] },
    { id: "dash", icon: "➤", name: "Dash", kind: "Active · Space", desc: "A quick burst in your aim direction that grows with your size. Wider pickup mid-dash; a gold blob mid-dash refunds the charge.", unlock: 100,
      subs: [
        { id: "cooldown", name: "Cooldown", costs: [200, 1500, 12000, 90000, 600000], info: (l) => `${(2.5 * 0.75 ** l).toFixed(2)}s recharge` },
        { id: "distance", name: "Distance", costs: [200, 1500, 12000, 90000, 600000], info: (l) => `+${pct(l * 30)} dash distance` },
        { id: "charges", name: "Charges", costs: [5000, 60000, 500000], info: (l) => `${1 + l} charge${l ? "s" : ""}` },
      ] },
  ];
  for (const a of ABILITIES) {
    a.unlock = Math.round(a.unlock * COST_SCALE);
    for (const s of a.subs) s.max = s.costs.length;
  }
  const subCost = (s, lvl) => Math.max(1, Math.round(s.costs[lvl] * COST_SCALE));

  // Permanent prestige perks, bought with Essence.
  const START_GOO = [0, 100, 300, 1000, 3000, 8000, 20000];
  const PERKS = [
    { id: "gooMult", icon: "✦", name: "Goo multiplier", max: 10, base: 5, info: (l) => `+${l * 20}% Goo` },
    { id: "startSpeed", icon: "»", name: "Quick feet", max: 5, base: 6, info: (l) => `+${l * 5}% base speed` },
    { id: "startGoo", icon: "◆", name: "Starting Goo", max: 6, base: 4, info: (l) => `Start with ${START_GOO[l].toLocaleString("en-US")} Goo` },
    { id: "headDash", icon: "➤", name: "Head start: Dash", max: 1, base: 6, info: () => "Start runs with Dash unlocked" },
    { id: "tracker", icon: "%", name: "Progress tracker", max: 1, base: 6, info: () => "Shows blobs eaten, blobs left and % cleared" },
    { id: "minimap", icon: "▦", name: "Mini-map", max: 1, base: 15, info: () => "A live map of remaining blobs and where you are" },
    { id: "radar", icon: "↗", name: "Blob radar", max: 1, base: 12, info: () => "Arrows point to the nearest blobs off-screen" },
  ];

  // ================= helpers =================
  const $ = (id) => document.getElementById(id);
  const radius = (m) => 4 * Math.sqrt(m);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = (x) => 1 - (1 - x) ** 3;
  const perkCost = (perk, lvl) => Math.round(perk.base * PERK_MULT ** lvl);
  function fmtNum(n) {
    n = Math.floor(n);
    if (n < 10000) return n.toLocaleString("en-US");
    if (n < 1e6) return `${(n / 1000).toFixed(n < 1e5 ? 1 : 0)}k`;
    return `${(n / 1e6).toFixed(2)}M`;
  }
  function fmtTime(ms) {
    if (ms == null) return "—";
    const t = Math.max(0, ms) / 1000;
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
  }
  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const css = getComputedStyle(document.documentElement);
  const C = (name) => css.getPropertyValue(name).trim();
  const COLORS = { bg: C("--bg"), grid: C("--grid"), edge: C("--edge"), accent: C("--accent"), gold: C("--gold"), goo: C("--goo") };
  const FINAL_STRETCH = DEBUG ? 6 : 20; // last N blobs glow and get arrows
  const PALETTE = Array.from({ length: 12 }, (_, i) => `hsl(${i * 30} 65% 62%)`);

  // ================= save =================
  function defaultSave() {
    return { name: "", essence: 0, prestige: 0, perks: {}, bestNormal: null, bestFresh: null, splitsNormal: null, splitsFresh: null, muted: false };
  }
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && typeof s === "object") return { ...defaultSave(), ...s, perks: { ...(s.perks || {}) } };
    } catch {}
    return defaultSave();
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch {}
  }
  let save = loadSave();
  // Split and Magnet were removed: refund their head-start perks
  if (save.perks.headSplit) { save.essence += 15; delete save.perks.headSplit; }
  if (save.perks.headMagnet) { save.essence += 8; delete save.perks.headMagnet; }
  persist();
  const perkLvl = (id) => save.perks[id] || 0;

  // ================= sound (tiny WebAudio synth, no files) =================
  const sfx = (() => {
    let ac = null;
    let noise = null;
    let lastEat = 0;
    function ctx() {
      if (!ac) {
        try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
      }
      if (ac.state === "suspended") ac.resume();
      return ac;
    }
    function tone(freq, { type = "sine", dur = 0.09, vol = 0.12, slide = 1, delay = 0 } = {}) {
      if (save.muted || !ac) return;
      const t = ac.currentTime + delay;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    // filtered noise sweep: an airy "whoosh"
    function whoosh(dur) {
      if (save.muted || !ac) return;
      if (!noise) {
        noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.6), ac.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noise;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(500, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.5);
      bp.frequency.exponentialRampToValueAtTime(900, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp).connect(g).connect(ac.destination);
      src.start(t);
      src.stop(t + dur + 0.05);
    }
    return {
      unlock: ctx,
      eat(combo, gold) {
        const now = performance.now();
        if (!gold && now - lastEat < 32) return; // avoid a wall of noise when eating many at once
        lastEat = now;
        const f = 330 * 2 ** (Math.min(combo, 24) / 24); // pitch climbs with the combo
        if (gold) {
          tone(f * 1.5, { type: "triangle", dur: 0.16, vol: 0.11, slide: 1.02 });
          tone(f * 2.25, { type: "sine", dur: 0.22, vol: 0.06, delay: 0.05 });
        } else {
          tone(f, { type: "sine", dur: 0.07, vol: 0.07, slide: 1.3 });
        }
      },
      dash() { whoosh(0.32); tone(150, { type: "sine", dur: 0.14, vol: 0.1, slide: 0.5 }); },
      refund() { tone(880, { type: "triangle", dur: 0.12, vol: 0.08, delay: 0.06 }); },
      buy() { tone(523, { type: "triangle", dur: 0.08, vol: 0.07 }); tone(784, { type: "triangle", dur: 0.12, vol: 0.07, delay: 0.07 }); },
      finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, { type: "triangle", dur: 0.25, vol: 0.09, delay: i * 0.11 })); },
    };
  })();
  window.addEventListener("pointerdown", () => sfx.unlock());
  window.addEventListener("keydown", () => sfx.unlock());

  // ================= canvas =================
  const canvas = $("c");
  const ctx = canvas.getContext("2d");
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

  // ================= map (built once; each run only resets which blobs are alive) =================
  // Blob data lives in typed arrays so 250k blobs stay light. Type 0 small, 1 medium, 2 gold.
  const T_MASS = [1, 3, 8], T_GOO = [1, 3, 10], T_R = [radius(1) + 1, radius(3) + 1, radius(8) + 1];
  const MAP = (() => {
    const N = CFG.blobCount, WD = CFG.world;
    const rnd = mulberry32(CFG.seed);
    const bx = new Float32Array(N), by = new Float32Array(N), bt = new Uint8Array(N), bc = new Uint8Array(N);
    const clusters = [];
    let wsum = 0;
    for (let i = 0; i < CFG.clusters; i++) {
      wsum += 0.3 + rnd();
      clusters.push({ x: rnd() * WD, y: rnd() * WD, r: 400 + rnd() ** 2 * 2600, w: wsum });
    }
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
    for (let i = 0; i < N; i++) {
      const roll = rnd();
      bt[i] = roll < 0.05 ? 2 : roll < 0.2 ? 1 : 0;
      let x, y;
      if (clusters.length && rnd() < CFG.clusterShare) {
        const pick = rnd() * wsum;
        let lo = 0, hi = clusters.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (clusters[mid].w < pick) lo = mid + 1; else hi = mid; }
        const c = clusters[lo];
        x = c.x + gauss() * c.r * 0.5;
        y = c.y + gauss() * c.r * 0.5;
      } else {
        x = rnd() * WD;
        y = rnd() * WD;
      }
      bx[i] = clamp(x, 40, WD - 40);
      by[i] = clamp(y, 40, WD - 40);
      bc[i] = Math.floor(rnd() * PALETTE.length);
    }
    // bucket into a grid (counting sort): blobs of cell k are order[start[k] .. start[k+1])
    const cs = CFG.gridSize, gw = Math.ceil(WD / cs), cells = gw * gw;
    const cellOf = new Int32Array(N);
    const start = new Int32Array(cells + 1);
    for (let i = 0; i < N; i++) {
      const k = Math.min(gw - 1, Math.floor(by[i] / cs)) * gw + Math.min(gw - 1, Math.floor(bx[i] / cs));
      cellOf[i] = k;
      start[k + 1]++;
    }
    for (let k = 0; k < cells; k++) start[k + 1] += start[k];
    const fill = start.slice(0, cells);
    const order = new Int32Array(N);
    for (let i = 0; i < N; i++) order[fill[cellOf[i]]++] = i;
    const baseCount = new Int32Array(cells);
    for (let k = 0; k < cells; k++) baseCount[k] = start[k + 1] - start[k];
    return { N, bx, by, bt, bc, cs, gw, start, order, cellOf, baseCount };
  })();

  function eachBlobIn(x0, y0, x1, y1, fn) {
    const { cs, gw, start, order } = MAP;
    const alive = run.alive, cnt = run.cellAlive;
    const gx0 = Math.max(0, Math.floor(x0 / cs)), gx1 = Math.min(gw - 1, Math.floor(x1 / cs));
    const gy0 = Math.max(0, Math.floor(y0 / cs)), gy1 = Math.min(gw - 1, Math.floor(y1 / cs));
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const k = gy * gw + gx;
        if (!cnt[k]) continue;
        for (let j = start[k], e = start[k + 1]; j < e; j++) {
          const i = order[j];
          if (alive[i]) fn(i);
        }
      }
    }
  }

  // The `count` nearest live blobs outside the view rectangle, searched ring by ring outward.
  function nearestOutside(cx, cy, count, view) {
    const { cs, gw, start, order, bx, by } = MAP;
    const ccx = clamp(Math.floor(cx / cs), 0, gw - 1), ccy = clamp(Math.floor(cy / cs), 0, gw - 1);
    const found = [];
    for (let ring = 0; ring < gw; ring++) {
      for (let gy = ccy - ring; gy <= ccy + ring; gy++) {
        if (gy < 0 || gy >= gw) continue;
        const edgeRow = gy === ccy - ring || gy === ccy + ring;
        for (let gx = ccx - ring; gx <= ccx + ring; gx += edgeRow ? 1 : 2 * ring || 1) {
          if (gx < 0 || gx >= gw) continue;
          const k = gy * gw + gx;
          if (!run.cellAlive[k]) continue;
          for (let j = start[k]; j < start[k + 1]; j++) {
            const i = order[j];
            if (!run.alive[i]) continue;
            if (bx[i] > view[0] && bx[i] < view[1] && by[i] > view[2] && by[i] < view[3]) continue;
            found.push([(bx[i] - cx) ** 2 + (by[i] - cy) ** 2, i]);
          }
        }
      }
      if (found.length >= count) {
        found.sort((a, b) => a[0] - b[0]);
        if (Math.sqrt(found[count - 1][0]) <= ring * cs) break;
      }
    }
    found.sort((a, b) => a[0] - b[0]);
    return found.slice(0, count).map((f) => f[1]);
  }

  // ================= run state =================
  let run = null;
  const cam = { x: CFG.world / 2, y: CFG.world / 2, zoom: 1, punch: 0 };

  function newRun(state, fresh) {
    const perm = {};
    for (const p of PERKS) perm[p.id] = fresh ? 0 : perkLvl(p.id);
    const up = {};
    for (const a of ABILITIES) {
      up[a.id] = { owned: a.unlock === 0 };
      for (const s of a.subs) up[a.id][s.id] = 0;
    }
    if (perm.headDash) up.dash.owned = true;
    const c = CFG.world / 2;
    run = {
      state, fresh,
      prestigeAtStart: save.prestige,
      perm, up,
      goo: Math.round(START_GOO[perm.startGoo] * COST_SCALE),
      alive: new Uint8Array(MAP.N).fill(1),
      cellAlive: MAP.baseCount.slice(),
      left: MAP.N,
      eaten: 0,
      p: { x: c, y: c, m: CFG.startMass, vx: 0, vy: 0, pulse: 0, dash: null },
      trail: [],
      aim: { x: 1, y: 0 },
      startT: 0, endT: 0,
      dash: { n: 1, prog: 0 },
      combo: 0, lastEat: -1e9, maxCombo: 0,
      splits: [],
      deltaShowUntil: 0,
      pops: [], parts: [], floats: [], floatsThisFrame: 0,
      gooEarned: 0,
      finaleAt: 0,
      radarAt: 0, radarList: [],
      submitted: false,
    };
    cam.x = c; cam.y = c;
    selected = 0;
  }

  function stats() {
    const u = run.up, p = run.perm;
    return {
      speedMult: (1 + 0.25 * u.speed.lvl) * (1 + 0.05 * p.startSpeed),
      gooMult: (1 + 0.5 * u.gobble.goo) * (1 + 0.2 * p.gooMult),
      massMult: 1 + 0.25 * u.gobble.mass,
      comboWindow: (CFG.comboBase + 0.4 * u.gobble.combo) * 1000,
      dashCd: 2500 * 0.75 ** u.dash.cooldown,
      dashDist: CFG.dashBase * (1 + 0.3 * u.dash.distance),
      dashCharges: 1 + u.dash.charges,
    };
  }
  const comboMult = (n) => 1 + 0.04 * (Math.min(n, CFG.comboCap) - 1); // x1 → ~x2.6 at 40
  const splitEvery = () => Math.max(1, Math.floor(MAP.N / CFG.splitCount));
  const topSpeed = (st, r) => CFG.baseSpeed * st.speedMult * Math.pow(r / 18, CFG.sizeSpeedExp);

  // ================= particles =================
  function burst(x, y, color, n, speed) {
    if (!run) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.5 + Math.random() * 0.7);
      run.parts.push({ x, y, vx: (Math.cos(a) * v) / cam.zoom, vy: (Math.sin(a) * v) / cam.zoom, t: 0, life: 0.3 + Math.random() * 0.2, color, size: (1.2 + Math.random() * 1.3) / cam.zoom });
    }
    if (run.parts.length > 400) run.parts.splice(0, run.parts.length - 400);
  }

  // ================= input =================
  const pointer = { x: 0, y: 0, active: false };
  const keys = new Set();
  const setPointer = (x, y) => { pointer.x = x; pointer.y = y; pointer.active = true; };
  canvas.addEventListener("mousemove", (e) => setPointer(e.clientX, e.clientY));
  canvas.addEventListener("touchstart", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { const t = e.touches[0]; setPointer(t.clientX, t.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", (e) => { if (!e.touches.length) pointer.active = false; });
  window.addEventListener("blur", () => keys.clear());

  const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
  function keyDir() {
    let x = 0, y = 0;
    for (const k of keys) if (MOVE[k]) { x += MOVE[k][0]; y += MOVE[k][1]; }
    const d = Math.hypot(x, y);
    return d ? { x: x / d, y: y / d } : null;
  }
  function cursorWorld() {
    return { x: cam.x + (pointer.x - W / 2) / cam.zoom, y: cam.y + (pointer.y - H / 2) / cam.zoom };
  }

  window.addEventListener("keydown", (e) => {
    if (e.target === $("name")) {
      if (e.key === "Enter") startRun(false);
      return;
    }
    if (MOVE[e.code]) {
      keys.add(e.code);
      e.preventDefault();
      if (isPlaying()) pointer.active = false; // keyboard takes over steering until the mouse moves again
      return;
    }
    if (e.repeat) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space" || k === "shift") { e.preventDefault(); doDash(); }
    else if (k === "u" || k === "tab") { if (isPlaying()) { e.preventDefault(); toggleShop(); } }
    else if (k === "m") toggleMute();
    else if (k >= "1" && k <= "3") selectAbility(Number(k) - 1);
    else if (BUY_KEYS.includes(k)) buyRow(BUY_KEYS.indexOf(k));
    else if (k === "r" && run && run.state !== "menu") startRun(run.fresh);
    else if (k === "escape" && run && run.state !== "menu") openMenu();
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  $("dashBtn").addEventListener("click", doDash);
  $("upgBtn").addEventListener("click", () => toggleShop());
  $("shopClose").addEventListener("click", () => toggleShop(false));
  function toggleShop(force) {
    const open = typeof force === "boolean" ? force : !$("shop").classList.contains("open");
    $("shop").classList.toggle("open", open);
    $("upgBtn").hidden = open || !isPlaying();
    if (open) updateShop();
  }
  function toggleMute() {
    save.muted = !save.muted;
    persist();
    $("muteBtn").classList.toggle("muted", !!save.muted);
  }
  $("muteBtn").addEventListener("click", toggleMute);
  $("muteBtn").classList.toggle("muted", !!save.muted);

  // ================= abilities =================
  function isPlaying() { return run && (run.state === "ready" || run.state === "running"); }

  // Aim: keyboard direction, else toward the cursor, else the last heading.
  function aimDir() {
    const kd = keyDir();
    if (kd) return kd;
    const p = run.p;
    if (pointer.active) {
      const cw = cursorWorld();
      const dx = cw.x - p.x, dy = cw.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 4) return { x: dx / d, y: dy / d };
    }
    return run.aim;
  }

  function doDash() {
    if (!isPlaying() || !run.up.dash.owned || run.dash.n < 1) return;
    const st = stats();
    const p = run.p;
    const a = aimDir();
    run.dash.n--;
    p.dash = { t: 0, dur: CFG.dashDur, dx: a.x, dy: a.y, dist: st.dashDist * Math.sqrt(radius(p.m) / 18), prevE: 0 };
    cam.punch = 0.07; // brief pull-back of the camera sells the burst
    sfx.dash();
    beginTimer();
  }

  function beginTimer() {
    if (run.state === "ready") {
      run.state = "running";
      run.startT = performance.now();
    }
  }

  // ================= upgrades panel =================
  let selected = 0;
  let detailKey = "";
  const tileRefs = [];
  let rowRefs = [];

  function buildShop() {
    const root = $("tiles");
    root.replaceChildren();
    tileRefs.length = 0;
    ABILITIES.forEach((a, i) => {
      const t = document.createElement("button");
      t.className = "tile";
      t.innerHTML = `<kbd>${i + 1}</kbd><span class="dot"></span><span class="ico"></span><span class="tn"></span><span class="tl num"></span>`;
      t.querySelector(".ico").textContent = a.icon;
      t.querySelector(".tn").textContent = a.name;
      t.addEventListener("click", () => selectAbility(i));
      root.appendChild(t);
      tileRefs.push({ el: t, lvl: t.querySelector(".tl"), ability: a });
    });
    detailKey = "";
    updateShop();
  }

  function selectAbility(i) {
    if (!run || i < 0 || i >= ABILITIES.length) return;
    selected = i;
    updateShop();
  }

  function rowsFor(a) {
    return run.up[a.id].owned ? a.subs.map((s) => ({ a, s })) : [{ a, s: null }];
  }
  function canBuy(a, s) {
    const st = run.up[a.id];
    if (!s) return !st.owned && run.goo >= a.unlock;
    const lvl = st[s.id];
    return st.owned && lvl < s.max && run.goo >= subCost(s, lvl);
  }
  function affordableCount() {
    let n = 0;
    for (const a of ABILITIES) for (const { s } of rowsFor(a)) if (canBuy(a, s)) n++;
    return n;
  }

  function buildDetail() {
    const a = ABILITIES[selected];
    const root = $("detail");
    root.replaceChildren();
    const head = document.createElement("div");
    head.className = "detail-head";
    head.innerHTML = `<strong></strong><span class="tag"></span>`;
    head.querySelector("strong").textContent = `${a.icon} ${a.name}`;
    head.querySelector(".tag").textContent = a.kind;
    const desc = document.createElement("div");
    desc.className = "detail-desc";
    desc.textContent = a.desc;
    root.append(head, desc);
    rowRefs = rowsFor(a).map(({ s }, i) => {
      const el = document.createElement("button");
      el.className = "up" + (s ? "" : " unlock");
      el.innerHTML = `<div class="main"><div class="nm"><kbd>${BUY_KEYS[i].toUpperCase()}</kbd><span></span></div><div class="val"></div></div><span class="cost num"></span>` +
        (s ? `<div class="pips">${"<i></i>".repeat(s.max)}</div>` : "");
      el.querySelector(".nm span").textContent = s ? s.name : `Unlock ${a.name}`;
      el.addEventListener("click", () => buyRow(i));
      root.appendChild(el);
      return { el, s, a, val: el.querySelector(".val"), pips: el.querySelector(".pips"), cost: el.querySelector(".cost") };
    });
  }

  function updateShop() {
    if (!run || !tileRefs.length) return;
    const playing = isPlaying();
    tileRefs.forEach((t, i) => {
      const a = t.ability;
      const st = run.up[a.id];
      t.el.classList.toggle("sel", i === selected);
      t.el.classList.toggle("locked", !st.owned);
      if (!st.owned) t.lvl.textContent = `${fmtNum(a.unlock)} Goo`;
      else {
        const lv = a.subs.reduce((s, x) => s + st[x.id], 0);
        const mx = a.subs.reduce((s, x) => s + x.max, 0);
        t.lvl.textContent = `${lv}/${mx}`;
      }
      t.el.classList.toggle("can", playing && rowsFor(a).some(({ s }) => canBuy(a, s)));
    });
    const a = ABILITIES[selected];
    const key = `${selected}:${run.up[a.id].owned}`;
    if (key !== detailKey) { detailKey = key; buildDetail(); }
    for (const r of rowRefs) {
      const st = run.up[r.a.id];
      if (!r.s) {
        r.val.textContent = "Unlocks this ability";
        r.cost.textContent = `${fmtNum(r.a.unlock)} Goo`;
        r.cost.className = "cost num";
        r.el.disabled = !playing || !canBuy(r.a, null);
        continue;
      }
      const lvl = st[r.s.id];
      const maxed = lvl >= r.s.max;
      r.val.replaceChildren(document.createTextNode(r.s.info(lvl)));
      if (!maxed) {
        const nx = document.createElement("span");
        nx.className = "next";
        nx.textContent = ` → ${r.s.info(lvl + 1)}`;
        r.val.appendChild(nx);
      }
      [...r.pips.children].forEach((pip, i) => pip.classList.toggle("on", i < lvl));
      r.cost.textContent = maxed ? "Maxed" : `${fmtNum(subCost(r.s, lvl))} Goo`;
      r.cost.className = "cost num" + (maxed ? " max" : "");
      r.el.disabled = !playing || maxed || !canBuy(r.a, r.s);
    }
    $("shopGoo").textContent = fmtNum(run.goo);
    $("upgGoo").textContent = `${fmtNum(run.goo)} Goo`;
    const n = playing ? affordableCount() : 0;
    $("upgBadge").textContent = n ? n : "";
    $("upgBtn").classList.toggle("has", n > 0);
  }

  function buyRow(i) {
    if (!isPlaying()) return;
    if (!rowRefs.length) updateShop();
    const r = rowRefs[i];
    if (!r || !canBuy(r.a, r.s)) return;
    const st = run.up[r.a.id];
    if (!r.s) {
      run.goo -= r.a.unlock;
      st.owned = true;
    } else {
      run.goo -= subCost(r.s, st[r.s.id]);
      st[r.s.id]++;
      if (r.a.id === "dash" && r.s.id === "charges") run.dash.n = Math.min(run.dash.n + 1, stats().dashCharges);
    }
    sfx.buy();
    updateShop();
    const again = rowRefs[i];
    if (again) { again.el.classList.remove("flash"); void again.el.offsetWidth; again.el.classList.add("flash"); }
  }

  // ================= menu / prestige =================
  let lbBoard = "all";
  let lbData = { all: [], fresh: [] };

  function showPane(name) {
    for (const t of document.querySelectorAll(".mtab")) t.classList.toggle("on", t.dataset.pane === name);
    for (const p of document.querySelectorAll(".pane")) p.hidden = p.dataset.pane !== name;
  }
  for (const t of document.querySelectorAll(".mtab")) t.addEventListener("click", () => showPane(t.dataset.pane));

  function setInRun(on) {
    $("overlay").hidden = on;
    $("hud").hidden = !on;
    $("abilities").hidden = !on;
    $("shop").hidden = !on;
    $("upgBtn").hidden = !on;
    $("minimapCard").hidden = !on || !run.perm.minimap;
    $("tracker").hidden = !on || !run.perm.tracker;
    if (!on) $("shop").classList.remove("open");
  }

  function openMenu(results) {
    if (!results) newRun("menu", false);
    setInRun(false);
    $("results").hidden = !results;
    showPane("play");
    renderMenu();
    fetchLeaderboard();
  }

  function renderMenu() {
    $("name").value = save.name;
    $("stPrestige").textContent = save.prestige;
    $("stEssence").textContent = save.essence;
    $("stEssence2").textContent = save.essence;
    $("stBestN").textContent = fmtTime(save.bestNormal);
    $("stBestF").textContent = fmtTime(save.bestFresh);
    $("stRuns").textContent = save.prestige;
    const root = $("prestigeCards");
    root.replaceChildren();
    let anyAffordable = false;
    for (const p of PERKS) {
      const lvl = perkLvl(p.id);
      const maxed = lvl >= p.max;
      const cost = perkCost(p, lvl);
      if (!maxed && save.essence >= cost) anyAffordable = true;
      const el = document.createElement("button");
      el.className = "perk" + (maxed ? " owned" : "");
      el.innerHTML = `<div class="top"><span class="pico"></span><div><div class="pn"></div><div class="pd"></div></div></div><div class="bottom"><span class="plv num"></span><span class="cost num"></span></div>`;
      el.querySelector(".pico").textContent = p.icon;
      el.querySelector(".pn").textContent = p.name;
      el.querySelector(".pd").textContent = maxed ? p.info(lvl) : p.info(lvl + 1);
      el.querySelector(".plv").textContent = p.max > 1 ? `Level ${lvl} / ${p.max}` : maxed ? "Unlocked" : "Not unlocked";
      el.querySelector(".cost").textContent = maxed ? (p.max === 1 ? "✓ Owned" : "✓ Maxed") : `${cost} Essence`;
      el.disabled = maxed || save.essence < cost;
      el.addEventListener("click", () => {
        const l = perkLvl(p.id);
        const c = perkCost(p, l);
        if (l >= p.max || save.essence < c) return;
        save.essence -= c;
        save.perks[p.id] = l + 1;
        persist();
        sfx.unlock();
        sfx.buy();
        renderMenu();
      });
      root.appendChild(el);
    }
    $("perkDot").hidden = !anyAffordable;
  }

  function saveName() {
    save.name = $("name").value.replace(/[<>]/g, "").trim().slice(0, 16);
    persist();
  }
  $("name").addEventListener("change", saveName);
  $("startNormal").addEventListener("click", () => startRun(false));
  $("startFresh").addEventListener("click", () => startRun(true));

  function startRun(fresh) {
    saveName();
    newRun("ready", fresh);
    setInRun(true);
    $("modeTag").textContent = fresh ? "Fresh run · no perks" : `Run · prestige ${save.prestige}`;
    $("modeTag").className = "label" + (fresh ? " fresh" : "");
    $("splitDelta").textContent = "";
    buildShop();
    cam.zoom = 4; // start right up close, then pull out
    sfx.unlock();
    pointer.active = false;
    keys.clear();
    document.activeElement && document.activeElement.blur && document.activeElement.blur();
  }

  function finishRun() {
    run.state = "done";
    run.endT = performance.now();
    run.finaleAt = run.endT;
    run.p.dash = null;
    sfx.finish();
    burst(run.p.x, run.p.y, COLORS.gold, 40, 420);
    toggleShop(false);
    $("upgBtn").hidden = true;
    const t = run.endT - run.startT;
    const key = run.fresh ? "bestFresh" : "bestNormal";
    const splitKey = run.fresh ? "splitsFresh" : "splitsNormal";
    const prev = save[key];
    const isPb = prev == null || t < prev;
    const parBonus = Math.max(0, Math.floor((CFG.parMs - t) / (DEBUG ? 10000 : 60000))); // +1 per minute under par
    const pbBonus = isPb && prev != null ? 3 : 0;
    const ess = 10 + parBonus + pbBonus;
    save.essence += ess;
    save.prestige += 1;
    if (isPb) { save[key] = t; save[splitKey] = run.splits.slice(); }
    persist();
    run.timeMs = t;

    $("resMode").textContent = run.fresh ? "Fresh run complete" : "Run complete";
    $("resTime").textContent = fmtTime(t);
    $("resPb").replaceChildren();
    if (isPb) {
      const span = document.createElement("span");
      span.className = "pb";
      span.textContent = prev == null ? "First clear!" : `New personal best (was ${fmtTime(prev)})`;
      $("resPb").appendChild(span);
    } else {
      $("resPb").textContent = `Personal best ${fmtTime(prev)} · +${((t - prev) / 1000).toFixed(1)}s`;
    }
    $("resCombo").textContent = run.maxCombo;
    $("resGoo").textContent = fmtNum(run.gooEarned);
    let lv = 0, mx = 0;
    for (const a of ABILITIES) for (const sub of a.subs) { mx += sub.max; if (run.up[a.id].owned) lv += run.up[a.id][sub.id]; }
    $("resUps").textContent = `${lv}/${mx}`;
    run.essGained = ess;
    $("resEss").textContent = "+0";
    const why = ["10 base"];
    if (parBonus) why.push(`${parBonus} under par`);
    if (pbBonus) why.push(`${pbBonus} personal best`);
    $("resEssWhy").textContent = `Essence: ${why.join(" + ")}`;
    $("submitBtn").disabled = DEBUG;
    $("submitMsg").textContent = DEBUG ? "Debug runs can't be submitted." : "";
    setTimeout(() => { openMenu(true); countUpEssence(); }, 2600);
  }

  function countUpEssence() {
    const target = run.essGained || 0;
    const t0 = performance.now();
    const id = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / 900);
      $("resEss").textContent = `+${Math.round(target * (1 - (1 - k) ** 3))}`;
      if (k >= 1) { clearInterval(id); sfx.buy(); }
    }, 30);
  }

  $("submitBtn").addEventListener("click", async () => {
    if (!run || run.state !== "done" || run.submitted) return;
    saveName();
    $("submitBtn").disabled = true;
    $("submitMsg").textContent = "Submitting…";
    try {
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: save.name || "Anonymous", timeMs: Math.round(run.timeMs), prestige: run.fresh ? 0 : run.prestigeAtStart, fresh: run.fresh }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "failed");
      run.submitted = true;
      const onFresh = run.fresh || run.prestigeAtStart === 0;
      const rank = onFresh ? data.freshRank : data.rank;
      $("submitMsg").textContent = rank ? `Submitted — you're #${rank}${onFresh ? " on Fresh" : ""}.` : "Submitted (not in the top 100).";
      lbBoard = onFresh ? "fresh" : "all";
      fetchLeaderboard();
    } catch (err) {
      $("submitBtn").disabled = false;
      $("submitMsg").textContent = `Couldn't submit (${err.message}).`;
    }
  });

  async function fetchLeaderboard() {
    try {
      const res = await fetch("/api/leaderboard");
      lbData = await res.json();
    } catch {}
    renderLeaderboard();
  }
  function renderLeaderboard() {
    for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.dataset.board === lbBoard);
    const list = lbData[lbBoard] || [];
    $("lbEmpty").hidden = list.length > 0;
    $("lbList").hidden = list.length === 0;
    $("lbList").replaceChildren(...list.map((e, i) => {
      const li = document.createElement("li");
      if (save.name && e.name === save.name) li.className = "me";
      const cells = [["rank", `${i + 1}`], ["who", e.name], ["pl", e.fresh ? "fresh" : `P${e.prestige}`], ["num", fmtTime(e.timeMs)]];
      for (const [cls, text] of cells) {
        const s = document.createElement("span");
        s.className = cls;
        s.textContent = text;
        li.appendChild(s);
      }
      return li;
    }));
  }
  for (const t of document.querySelectorAll(".tab")) {
    t.addEventListener("click", () => { lbBoard = t.dataset.board; renderLeaderboard(); });
  }

  // ================= simulation =================
  function onEat(i, st, now) {
    const p = run.p;
    run.alive[i] = 0;
    run.cellAlive[MAP.cellOf[i]]--;
    run.left--;
    run.eaten++;
    const type = MAP.bt[i];
    const gold = type === 2;
    const bx = MAP.bx[i], by = MAP.by[i];
    run.combo = now - run.lastEat <= st.comboWindow ? run.combo + 1 : 1;
    run.lastEat = now;
    run.maxCombo = Math.max(run.maxCombo, run.combo);
    p.m += T_MASS[type] * st.massMult;
    const gain = T_GOO[type] * st.gooMult * comboMult(run.combo);
    run.goo += gain;
    run.gooEarned += gain;
    p.pulse = Math.min(1, p.pulse + (gold ? 0.5 : 0.2));
    if (run.pops.length < 120) run.pops.push({ x: bx, y: by, r: T_R[type], t: 0, gold });
    if (gold) burst(bx, by, "rgba(245,197,66,0.7)", 4, 60);
    if (run.floatsThisFrame < 4 || gold) {
      run.floatsThisFrame++;
      run.floats.push({ x: bx, y: by - T_R[type], t: 0, text: `+${fmtNum(Math.max(1, Math.round(gain)))}`, gold, big: gold });
    }
    if (run.combo % 10 === 0) run.floats.push({ x: p.x, y: p.y - radius(p.m) - 12 / cam.zoom, t: 0, text: `${run.combo}× combo`, gold: true, big: true });
    if (run.floats.length > 60) run.floats.splice(0, run.floats.length - 60);
    sfx.eat(run.combo, gold || run.left < FINAL_STRETCH);
    // dash tech: a gold blob eaten mid-dash refunds the charge
    if (gold && p.dash && run.dash.n < st.dashCharges) {
      run.dash.n++;
      run.pops.push({ x: p.x, y: p.y, r: radius(p.m), t: 0, gold: true });
      sfx.refund();
    }
    // speedrun checkpoints
    if (run.eaten % splitEvery() === 0 && run.splits.length < CFG.splitCount) {
      const t = now - run.startT;
      run.splits.push(t);
      const pb = (run.fresh ? save.splitsFresh : save.splitsNormal) || [];
      const ref = pb[run.splits.length - 1];
      const el = $("splitDelta");
      if (ref != null) {
        const d = (t - ref) / 1000;
        el.textContent = `Checkpoint ${run.splits.length}: ${d <= 0 ? "−" : "+"}${Math.abs(d).toFixed(1)}s`;
        el.className = "num " + (d <= 0 ? "good" : "bad");
      } else {
        el.textContent = `Checkpoint ${run.splits.length} · ${fmtTime(t)}`;
        el.className = "num";
      }
      run.deltaShowUntil = now + 4000;
    }
  }

  function update(dt, now) {
    if (!run || run.state === "menu") return;
    const st = stats();
    run.floatsThisFrame = 0;

    if (run.up.dash.owned && run.dash.n < st.dashCharges) {
      run.dash.prog += (dt * 1000) / st.dashCd;
      if (run.dash.prog >= 1) { run.dash.n++; run.dash.prog = 0; }
    }
    if (run.state === "done" && now - run.finaleAt < 2300 && now > (run.nextFirework || 0)) {
      run.nextFirework = now + 160;
      const sx = cam.x + (Math.random() - 0.5) * (W / cam.zoom) * 0.8;
      const sy = cam.y + (Math.random() - 0.5) * (H / cam.zoom) * 0.8;
      burst(sx, sy, `hsl(${Math.floor(Math.random() * 360)} 90% 65%)`, 22, 260);
    }
    if (!isPlaying()) return;

    const p = run.p;
    const kd = keyDir();
    if (run.state === "ready") {
      if (kd) beginTimer();
      else if (pointer.active && Math.hypot(pointer.x - W / 2, pointer.y - H / 2) > 20) beginTimer();
    }
    const r = radius(p.m);
    const top = topSpeed(st, r);
    let tx = 0, ty = 0;
    if (run.state === "running") {
      if (kd) { tx = kd.x * top; ty = kd.y * top; }
      else if (pointer.active) {
        const cw = cursorWorld();
        const dx = cw.x - p.x, dy = cw.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > 3) { const sp = Math.min(top, d * 5); tx = (dx / d) * sp; ty = (dy / d) * sp; }
      }
    }
    const follow = 1 - Math.exp(-CFG.accel * dt);
    p.vx += (tx - p.vx) * follow;
    p.vy += (ty - p.vy) * follow;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // dash: eased travel over a fixed duration, leaving afterimages, then hands off its momentum
    let pickup = 1;
    if (p.dash) {
      const d = p.dash;
      d.t += dt;
      const k = Math.min(1, d.t / d.dur);
      const e = easeOut(k);
      const step = (e - d.prevE) * d.dist;
      d.prevE = e;
      p.x += d.dx * step;
      p.y += d.dy * step;
      pickup = 1 + 0.5 * (1 - k);
      if (run.trail.length === 0 || Math.hypot(p.x - run.trail[run.trail.length - 1].x, p.y - run.trail[run.trail.length - 1].y) > r * 0.35) {
        run.trail.push({ x: p.x, y: p.y, r, t: 0 });
      }
      if (k >= 1) {
        p.vx = d.dx * top;
        p.vy = d.dy * top;
        p.dash = null;
      }
    }
    const nx = clamp(p.x, r * 0.5, CFG.world - r * 0.5), ny = clamp(p.y, r * 0.5, CFG.world - r * 0.5);
    if (nx !== p.x) { p.vx = 0; if (p.dash) p.dash.dx = 0; }
    if (ny !== p.y) { p.vy = 0; if (p.dash) p.dash.dy = 0; }
    p.x = nx; p.y = ny;

    const sp = Math.hypot(p.vx, p.vy);
    if (sp > 20) run.aim = { x: p.vx / sp, y: p.vy / sp };

    // eat everything under the blob
    const er = r * pickup;
    const { bx, by, bt } = MAP;
    eachBlobIn(p.x - er - 10, p.y - er - 10, p.x + er + 10, p.y + er + 10, (i) => {
      const dx = p.x - bx[i], dy = p.y - by[i];
      const reach = er + T_R[bt[i]] * 0.5;
      if (dx * dx + dy * dy < reach * reach) onEat(i, st, now);
    });

    if (now - run.lastEat > st.comboWindow) run.combo = 0;
    if (run.left <= 0) finishRun();
  }

  // ================= HUD =================
  let lastShopUpdate = 0;
  function updateHud(now) {
    if (!isPlaying() && run.state !== "done") return;
    const st = stats();
    const t = run.state === "running" ? now - run.startT : run.state === "done" ? run.endT - run.startT : 0;
    $("timer").textContent = fmtTime(t);
    $("goo").textContent = fmtNum(run.goo);
    $("mass").textContent = fmtNum(run.p.m);
    if (run.combo > 0) {
      $("comboTxt").textContent = `${run.combo}  ×${comboMult(run.combo).toFixed(2)}`;
      $("comboFill").style.width = `${clamp(1 - (now - run.lastEat) / st.comboWindow, 0, 1) * 100}%`;
    } else {
      $("comboTxt").textContent = "—";
      $("comboFill").style.width = "0%";
    }
    if (run.perm.tracker) {
      const frac = run.eaten / MAP.N;
      $("trackPct").textContent = `${(frac * 100).toFixed(frac < 0.1 ? 2 : 1)}%`;
      $("trackFill").style.width = `${frac * 100}%`;
      $("trackEaten").textContent = fmtNum(run.eaten);
      $("trackLeft").textContent = fmtNum(run.left);
    }
    const final = run.left <= FINAL_STRETCH && run.left > 0;
    $("finalTag").hidden = !final;
    if (final) $("finalTag").textContent = `Final ${run.left} — follow the arrows`;
    if (run.deltaShowUntil && now > run.deltaShowUntil) { $("splitDelta").textContent = ""; run.deltaShowUntil = 0; }

    const dashBtn = $("dashBtn");
    dashBtn.hidden = !run.up.dash.owned;
    if (run.up.dash.owned) {
      $("dashSub").textContent = run.dash.n;
      const full = run.dash.n >= st.dashCharges;
      $("dashRing").style.setProperty("--p", full ? 1 : run.dash.prog);
      dashBtn.classList.toggle("ready", run.dash.n > 0);
    }
    $("abilities").hidden = !run.up.dash.owned || !isPlaying();
    if (now - lastShopUpdate > 150) { updateShop(); lastShopUpdate = now; }
    if (run.perm.minimap && now - (run.miniAt || 0) > 120) { run.miniAt = now; drawMinimap(now); }
  }

  // ================= mini-map =================
  const mini = $("minimap");
  const mctx = mini.getContext("2d");
  const density = document.createElement("canvas");
  density.width = MAP.gw;
  density.height = MAP.gw;
  const dctx = density.getContext("2d");
  const dimg = dctx.createImageData(MAP.gw, MAP.gw);
  let densityAt = 0;
  function drawMinimap(now) {
    const S = mini.width;
    if (now - densityAt > 500) {
      densityAt = now;
      const d = dimg.data, cnt = run.cellAlive;
      const ref = Math.log(1 + (DEBUG ? 3 : 300));
      for (let k = 0; k < cnt.length; k++) {
        const v = Math.min(1, Math.log(1 + cnt[k]) / ref); // log scale so clusters stand out from scattered blobs
        const o = k * 4;
        d[o] = 120; d[o + 1] = 205; d[o + 2] = 185;
        d[o + 3] = cnt[k] ? 20 + 235 * v ** 1.6 : 0;
      }
      dctx.putImageData(dimg, 0, 0);
    }
    mctx.clearRect(0, 0, S, S);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(density, 0, 0, S, S);
    const k = S / CFG.world;
    // current view
    const vw = W / cam.zoom, vh = H / cam.zoom;
    mctx.strokeStyle = "rgba(255,255,255,0.55)";
    mctx.lineWidth = 1;
    mctx.strokeRect((cam.x - vw / 2) * k, (cam.y - vh / 2) * k, Math.max(2, vw * k), Math.max(2, vh * k));
    // you
    mctx.fillStyle = COLORS.gold;
    mctx.beginPath();
    mctx.arc(run.p.x * k, run.p.y * k, 3, 0, Math.PI * 2);
    mctx.fill();
  }

  // ================= camera =================
  function updateCamera(dt) {
    const p = run.p;
    const r = radius(p.m);
    const screen = Math.min(1, Math.max(W, H) / 1100 + 0.25);
    // close-up while small; pulls out further and further as you grow
    const base = clamp(1.7 * Math.pow(18 / r, CFG.zoomExp), 0.012, 1.7) * screen;
    const target = run.state === "menu" ? 0.6 * screen : run.state === "done" ? base * 0.6 : base;
    // look slightly ahead of where you're heading; trail a little behind during a dash
    const lead = 0.12;
    const tx = p.x + p.vx * lead, ty = p.y + p.vy * lead;
    const k = Math.min(1, dt * (p.dash ? 5 : 8));
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;
    cam.zoom += (target - cam.zoom) * Math.min(1, dt * 2.5);
    cam.punch *= Math.exp(-6 * dt);
  }

  // ================= drawing =================
  const colorBuckets = PALETTE.map(() => []);
  function draw(now, dt) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    const z = cam.zoom * (1 - cam.punch);
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z), DPR * (H / 2 - cam.y * z));
    const vx0 = cam.x - W / 2 / z, vx1 = cam.x + W / 2 / z;
    const vy0 = cam.y - H / 2 / z, vy1 = cam.y + H / 2 / z;
    const world = CFG.world;

    // grid
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    let step = 50;
    while (step * z < 26) step *= 2;
    for (let x = Math.max(0, Math.floor(vx0 / step) * step); x <= Math.min(world, vx1); x += step) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(world, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / step) * step); y <= Math.min(world, vy1); y += step) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(world, vx1), y); }
    ctx.stroke();
    ctx.strokeStyle = COLORS.edge;
    ctx.lineWidth = 4 / z;
    ctx.strokeRect(0, 0, world, world);

    // blobs, batched by color (one fill per color instead of one per blob)
    const finalStretch = isPlaying() && run.left <= FINAL_STRETCH;
    const minR = 1.2 / z;
    const asDots = T_R[0] * z < 2;
    for (const b of colorBuckets) b.length = 0;
    const golds = [];
    const { bx, by, bt, bc } = MAP;
    eachBlobIn(vx0 - 20, vy0 - 20, vx1 + 20, vy1 + 20, (i) => {
      if (bt[i] === 2) golds.push(i);
      else colorBuckets[bc[i]].push(i);
    });
    for (let c = 0; c < colorBuckets.length; c++) {
      const list = colorBuckets[c];
      if (!list.length) continue;
      ctx.fillStyle = PALETTE[c];
      ctx.beginPath();
      for (const i of list) {
        const rr = Math.max(T_R[bt[i]], minR);
        if (asDots) ctx.rect(bx[i] - rr, by[i] - rr, rr * 2, rr * 2);
        else { ctx.moveTo(bx[i] + rr, by[i]); ctx.arc(bx[i], by[i], rr, 0, Math.PI * 2); }
      }
      ctx.fill();
    }
    if (golds.length) {
      ctx.fillStyle = COLORS.gold;
      ctx.beginPath();
      for (const i of golds) { const rr = Math.max(T_R[2], minR * 1.4); ctx.moveTo(bx[i] + rr, by[i]); ctx.arc(bx[i], by[i], rr, 0, Math.PI * 2); }
      ctx.fill();
    }
    if (finalStretch) {
      ctx.strokeStyle = "rgba(242,193,78,0.85)";
      ctx.lineWidth = 2.5 / z;
      eachBlobIn(vx0 - 20, vy0 - 20, vx1 + 20, vy1 + 20, (i) => {
        ctx.beginPath();
        ctx.arc(bx[i], by[i], Math.max(T_R[bt[i]], minR) + (7 + 3 * Math.sin(now / 140)) / z, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    // eat rings
    for (const p of run.pops) {
      p.t += dt;
      const a = 1 - p.t / 0.35;
      if (a <= 0) continue;
      ctx.strokeStyle = p.gold ? `rgba(242,193,78,${a * 0.6})` : `rgba(255,255,255,${a * 0.22})`;
      ctx.lineWidth = 1.2 / z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + (p.t * 24) / z, 0, Math.PI * 2);
      ctx.stroke();
    }
    run.pops = run.pops.filter((p) => p.t < 0.35);

    // particles
    for (const p of run.parts) {
      p.t += dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.exp(-5 * dt); p.vy *= Math.exp(-5 * dt);
      const a = 1 - p.t / p.life;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.6 + 0.4 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    run.parts = run.parts.filter((p) => p.t < p.life);

    if (run.state !== "menu") drawPlayer(now, dt, z);

    // floating numbers
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of run.floats) {
      f.t += dt;
      const a = 1 - f.t / 0.8;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.font = `700 ${((f.big ? 17 : 12) / z).toFixed(3)}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 3 / z;
      ctx.strokeStyle = "rgba(0,0,0,0.5)";
      ctx.strokeText(f.text, f.x, f.y - (f.t * 40) / z);
      ctx.fillStyle = f.gold ? COLORS.gold : COLORS.goo;
      ctx.fillText(f.text, f.x, f.y - (f.t * 40) / z);
    }
    ctx.globalAlpha = 1;
    run.floats = run.floats.filter((f) => f.t < 0.8);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (isPlaying() && (run.perm.radar || finalStretch)) drawRadar(vx0, vx1, vy0, vy1, finalStretch ? 6 : 3);
    if (run.state === "done" && run.finaleAt) drawFinale(now);
  }

  function drawPlayer(now, dt, z) {
    const p = run.p;
    const r = radius(p.m);
    // dash afterimages
    for (const g of run.trail) {
      g.t += dt;
      const a = 1 - g.t / 0.28;
      if (a <= 0) continue;
      ctx.fillStyle = `rgba(95,212,180,${0.22 * a})`;
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * (0.75 + 0.25 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    run.trail = run.trail.filter((g) => g.t < 0.28);

    p.pulse *= Math.exp(-9 * dt);
    const rr = r * (1 + 0.035 * p.pulse);
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.dash) {
      // stretch along the dash direction, easing back to round
      const k = 1 - Math.min(1, p.dash.t / p.dash.dur);
      ctx.rotate(Math.atan2(p.dash.dy, p.dash.dx));
      ctx.scale(1 + 0.22 * k, 1 - 0.14 * k);
      ctx.fillStyle = `rgba(95,212,180,${0.14 * k})`;
      ctx.beginPath();
      ctx.arc(0, 0, rr * 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.accent;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = Math.max(3 / z, rr * 0.06);
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    if (isPlaying()) {
      const a = aimDir();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.moveTo(p.x + a.x * (r + 6 / z), p.y + a.y * (r + 6 / z));
      ctx.lineTo(p.x + a.x * (r + 16 / z), p.y + a.y * (r + 16 / z));
      ctx.stroke();
    }
  }

  function drawRadar(vx0, vx1, vy0, vy1, count) {
    const now = performance.now();
    if (!run.radarAt || now - run.radarAt > 250 || run.radarList.some((i) => !run.alive[i])) {
      run.radarAt = now;
      run.radarList = nearestOutside(cam.x, cam.y, count, [vx0, vx1, vy0, vy1]);
    }
    ctx.fillStyle = COLORS.gold;
    for (const i of run.radarList) {
      const ang = Math.atan2(MAP.by[i] - cam.y, MAP.bx[i] - cam.x);
      const margin = 34;
      const hx = W / 2 - margin, hy = H / 2 - margin;
      const t = Math.min(hx / Math.abs(Math.cos(ang) || 1e-6), hy / Math.abs(Math.sin(ang) || 1e-6));
      ctx.save();
      ctx.translate(W / 2 + Math.cos(ang) * t, H / 2 + Math.sin(ang) * t);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawFinale(now) {
    const e = now - run.finaleAt;
    if (e < 450) {
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - e / 450)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (e >= 2600) return;
    const a = Math.min(1, e / 200) * Math.min(1, (2600 - e) / 400);
    const scale = 1 + 0.2 * Math.max(0, 1 - e / 300);
    const big = Math.round((Math.min(W, 900) / 12) * scale);
    const small = Math.round(Math.min(W, 900) / 28);
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${big}px Inter, system-ui, sans-serif`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText("Map cleared", W / 2, H * 0.38);
    ctx.fillStyle = COLORS.gold;
    ctx.fillText("Map cleared", W / 2, H * 0.38);
    ctx.font = `600 ${small}px Inter, system-ui, sans-serif`;
    ctx.lineWidth = 5;
    const ty = H * 0.38 + Math.min(W, 900) / 13;
    ctx.strokeText(fmtTime(run.endT - run.startT), W / 2, ty);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fmtTime(run.endT - run.startT), W / 2, ty);
    ctx.globalAlpha = 1;
  }

  // ================= loop =================
  let last = performance.now();
  function tick(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (run && run.state === "done" && now - run.finaleAt < 900) dt *= 0.35; // slow-mo on the final bite
    update(dt, now);
    updateCamera(dt);
    draw(now, dt);
    updateHud(now);
  }
  function frame(now) {
    tick(now);
    requestAnimationFrame(frame);
  }
  // debug only: keep simulating when the tab can't animate (hidden test browsers)
  if (DEBUG) setInterval(() => { const now = performance.now(); if (now - last > 100) tick(now); }, 16);

  if (DEBUG || params.get("perf") === "1") {
    window.__blob = {
      get run() { return run; }, get save() { return save; }, MAP, cam, stats: () => stats(),
      tick: (n = 1) => { for (let k = 0; k < n; k++) tick(last + 16.7); },
      finish: () => { run.alive.fill(0); run.cellAlive.fill(0); run.left = 0; },
      eatAt: (i) => { run.p.x = MAP.bx[i]; run.p.y = MAP.by[i]; },
      frameCost: (n = 30) => { const t0 = performance.now(); for (let k = 0; k < n; k++) { draw(performance.now(), 0.016); } return (performance.now() - t0) / n; },
    };
  }

  openMenu(false);
  requestAnimationFrame(frame);
})();
