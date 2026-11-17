// Canvas rendering: ocean biomes, jelly food (batched per type, with a far-zoom density texture),
// the player blob with a face and cosmetics, effects, radar, mini-map and the finale.
import { BLOB_TYPES, BIOMES } from "./config.js";
import { eachBlobIn, nearestBlobs, biomeAt } from "./map.js";
import { radiusOf } from "./sim.js";

const LOD_LIMIT = 50000; // above this many visible blobs, draw the density texture instead
const TEX_CELL = 64; // world units per density-texture pixel

export function createRenderer(canvas, cfg, MAP) {
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, DPR = 1;
  const fx = { pops: [], parts: [], floats: [], trail: [], bubbles: [], blinkUntil: 0, flashAt: 0 };
  const stat = { visible: 0 };

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
  }
  resize();

  // ---------- density texture (far zoom) ----------
  const texW = Math.ceil(cfg.world / TEX_CELL);
  const tex = document.createElement("canvas");
  tex.width = texW; tex.height = texW;
  const tctx = tex.getContext("2d");
  const timg = tctx.createImageData(texW, texW);
  const tcount = new Uint16Array(texW * texW);
  const tcolor = new Uint8Array(texW * texW * 3);
  const texOf = (i) => Math.min(texW - 1, Math.floor(MAP.by[i] / TEX_CELL)) * texW + Math.min(texW - 1, Math.floor(MAP.bx[i] / TEX_CELL));
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const biomeFood = BIOMES.map((b) => hex(BLOB_TYPES.find((t) => t.biome === BIOMES.indexOf(b) && !t.gold).color[0]));
  for (let k = 0; k < tcount.length; k++) {
    const cx = (k % texW + 0.5) * TEX_CELL, cy = (Math.floor(k / texW) + 0.5) * TEX_CELL;
    const c = biomeFood[biomeAt(cfg, cx, cy)];
    tcolor[k * 3] = c[0]; tcolor[k * 3 + 1] = c[1]; tcolor[k * 3 + 2] = c[2];
  }
  let dirty = null;
  function texReset(run) {
    tcount.fill(0);
    for (let i = 0; i < MAP.N; i++) if (run.alive[i]) tcount[texOf(i)]++;
    dirty = [0, 0, texW - 1, texW - 1];
    texFlush(true);
  }
  function texEat(i) {
    const k = texOf(i);
    if (tcount[k]) tcount[k]--;
    const x = k % texW, y = (k / texW) | 0;
    if (!dirty) dirty = [x, y, x, y];
    else { dirty[0] = Math.min(dirty[0], x); dirty[1] = Math.min(dirty[1], y); dirty[2] = Math.max(dirty[2], x); dirty[3] = Math.max(dirty[3], y); }
  }
  let texFlushedAt = 0;
  function texFlush(force) {
    const now = performance.now();
    if (!dirty || (!force && now - texFlushedAt < 250)) return;
    texFlushedAt = now;
    const [x0, y0, x1, y1] = dirty;
    const d = timg.data;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * texW + x, o = k * 4, n = tcount[k];
        d[o] = tcolor[k * 3]; d[o + 1] = tcolor[k * 3 + 1]; d[o + 2] = tcolor[k * 3 + 2];
        d[o + 3] = n ? Math.min(255, 110 + 45 * n) : 0;
      }
    }
    tctx.putImageData(timg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    dirty = null;
  }

  // ---------- effects ----------
  function bubbles(x, y, n, spread, color, z) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = (20 + Math.random() * 50) * spread;
      fx.bubbles.push({ x, y, vx: (Math.cos(a) * v) / z, vy: (Math.sin(a) * v - 30) / z, t: 0, life: 0.5 + Math.random() * 0.4, r: (1.5 + Math.random() * 2.5) / z, color });
    }
    if (fx.bubbles.length > 300) fx.bubbles.splice(0, fx.bubbles.length - 300);
  }
  function onEat(i, gain, gold, pearl, z, cos, floatBudget) {
    texEat(i);
    const t = BLOB_TYPES[MAP.bt[i]];
    const x = MAP.bx[i], y = MAP.by[i];
    if (fx.pops.length < 100) fx.pops.push({ x, y, r: t.r, t: 0, gold });
    if (cos.eat === "bubbles" || gold) bubbles(x, y, gold ? 4 : 2, 1, gold ? "rgba(242,196,90,0.8)" : "rgba(220,245,240,0.7)", z);
    if (floatBudget || gold || pearl) fx.floats.push({ x, y: y - t.r, t: 0, text: `+${fmtNum(Math.max(1, Math.round(gain)))}`, gold: gold || pearl, big: gold || pearl });
    if (fx.floats.length > 60) fx.floats.splice(0, fx.floats.length - 60);
    if (gold || Math.random() < 0.08) fx.blinkUntil = performance.now() + 110;
  }
  function onDashMove(p, r, cos) {
    const last = fx.trail[fx.trail.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > r * 0.35) fx.trail.push({ x: p.x, y: p.y, r, t: 0 });
    if (cos.trail === "bubbles" && Math.random() < 0.6) bubbles(p.x, p.y, 1, 0.5, "rgba(220,245,240,0.6)", 1 / (r / 40));
  }
  function floatText(x, y, text, gold) { fx.floats.push({ x, y, t: 0, text, gold, big: true }); }
  function finale(x, y, z) {
    fx.flashAt = performance.now();
    for (let k = 0; k < 6; k++) bubbles(x + (Math.random() - 0.5) * 300 / z, y + (Math.random() - 0.5) * 300 / z, 14, 2.5, k % 2 ? "rgba(242,196,90,0.85)" : "rgba(196,239,224,0.85)", z);
  }

  // ---------- main draw ----------
  function draw(now, dt, cam, run, opts) {
    const { cos, showRadar, finalStretch } = opts;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#06101c";
    ctx.fillRect(0, 0, W, H);
    const z = cam.zoom * (1 - cam.punch);
    ctx.setTransform(DPR * z, 0, 0, DPR * z, DPR * (W / 2 - cam.x * z), DPR * (H / 2 - cam.y * z));
    const vx0 = cam.x - W / 2 / z, vx1 = cam.x + W / 2 / z, vy0 = cam.y - H / 2 / z, vy1 = cam.y + H / 2 / z;
    const world = cfg.world, h = world / 2;

    // biome rings (outermost first)
    ctx.fillStyle = BIOMES[3].bg;
    ctx.fillRect(0, 0, world, world);
    for (let b = BIOMES.length - 2; b >= 0; b--) {
      ctx.fillStyle = BIOMES[b].bg;
      ctx.beginPath();
      ctx.arc(h, h, BIOMES[b].outer * h, 0, Math.PI * 2);
      ctx.fill();
    }
    // faint grid gives a sense of motion
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    let step = 50;
    while (step * z < 40) step *= 2;
    for (let x = Math.max(0, Math.floor(vx0 / step) * step); x <= Math.min(world, vx1); x += step) { ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(world, vy1)); }
    for (let y = Math.max(0, Math.floor(vy0 / step) * step); y <= Math.min(world, vy1); y += step) { ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(world, vx1), y); }
    ctx.stroke();
    ctx.strokeStyle = "rgba(240,153,123,0.5)";
    ctx.lineWidth = 3 / z;
    ctx.strokeRect(0, 0, world, world);

    // food
    const pr = radiusOf(cfg, run.p.m);
    let visible = 0;
    {
      const { cs, gw } = MAP;
      const gx0 = Math.max(0, Math.floor(vx0 / cs)), gx1 = Math.min(gw - 1, Math.floor(vx1 / cs));
      const gy0 = Math.max(0, Math.floor(vy0 / cs)), gy1 = Math.min(gw - 1, Math.floor(vy1 / cs));
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) visible += run.cellAlive[gy * gw + gx];
      stat.visible = visible;
    }
    texFlush(false);
    // only switch to the texture once a texel is small on screen, so it still reads as dots
    if (visible > LOD_LIMIT && z * TEX_CELL < 4 && !finalStretch) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tex, 0, 0, texW, texW, 0, 0, texW * TEX_CELL, texW * TEX_CELL);
    } else {
      drawFood(z, vx0, vy0, vx1, vy1, pr, run, finalStretch, now);
    }

    // eat ripples
    for (const p of fx.pops) {
      p.t += dt;
      const a = 1 - p.t / 0.35;
      if (a <= 0) continue;
      ctx.strokeStyle = p.gold ? `rgba(242,196,90,${a * 0.55})` : `rgba(220,245,240,${a * 0.25})`;
      ctx.lineWidth = 1.2 / z;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + (p.t * 24) / z, 0, Math.PI * 2);
      ctx.stroke();
    }
    fx.pops = fx.pops.filter((p) => p.t < 0.35);
    // bubbles
    for (const b of fx.bubbles) {
      b.t += dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= Math.exp(-3 * dt); b.vy = b.vy * Math.exp(-3 * dt) - (12 / z) * dt;
      const a = 1 - b.t / b.life;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = Math.max(0.8 / z, b.r * 0.35);
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    fx.bubbles = fx.bubbles.filter((b) => b.t < b.life);

    if (run.state !== "menu") drawPlayer(now, dt, z, run, cos);

    // floating numbers
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const f of fx.floats) {
      f.t += dt;
      const a = 1 - f.t / 0.8;
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      ctx.font = `700 ${((f.big ? 16 : 11.5) / z).toFixed(3)}px Inter, system-ui, sans-serif`;
      ctx.lineWidth = 3 / z;
      ctx.strokeStyle = "rgba(4,20,30,0.6)";
      ctx.strokeText(f.text, f.x, f.y - (f.t * 38) / z);
      ctx.fillStyle = f.gold ? "#f2c45a" : "#b8ec8a";
      ctx.fillText(f.text, f.x, f.y - (f.t * 38) / z);
    }
    ctx.globalAlpha = 1;
    fx.floats = fx.floats.filter((f) => f.t < 0.8);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (showRadar) drawRadar(cam, z, run, pr, finalStretch ? 6 : 3, [vx0, vx1, vy0, vy1]);
    if (run.state === "done" && opts.finaleText) drawFinale(now, opts.finaleText);
  }

  const typeGroups = BLOB_TYPES.map(() => []);
  function drawFood(z, vx0, vy0, vx1, vy1, pr, run, finalStretch, now) {
    for (const g of typeGroups) g.length = 0;
    const { bx, by, bt } = MAP;
    eachBlobIn(MAP, run, vx0 - 30, vy0 - 30, vx1 + 30, vy1 + 30, (i) => typeGroups[bt[i]].push(i));
    const minR = 1.1 / z;
    for (let t = 0; t < BLOB_TYPES.length; t++) {
      const list = typeGroups[t];
      if (!list.length) continue;
      const T = BLOB_TYPES[t];
      const locked = pr < cfg.gates[T.biome];
      const r = Math.max(T.r, minR * (T.gold ? 1.4 : 1));
      const sr = r * z;
      ctx.globalAlpha = locked ? 0.32 : 1;
      ctx.fillStyle = T.color[0];
      ctx.beginPath();
      if (sr < 2.2) for (const i of list) ctx.rect(bx[i] - r, by[i] - r, r * 2, r * 2);
      else for (const i of list) { ctx.moveTo(bx[i] + r, by[i]); ctx.arc(bx[i], by[i], r, 0, Math.PI * 2); }
      ctx.fill();
      if (sr >= 4 && !locked) {
        // jelly highlight
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = T.color[1];
        ctx.beginPath();
        const hr = r * 0.38, off = r * 0.32;
        for (const i of list) { ctx.moveTo(bx[i] - off + hr, by[i] - off); ctx.arc(bx[i] - off, by[i] - off, hr, 0, Math.PI * 2); }
        ctx.fill();
      }
      if (locked && sr >= 3) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = T.color[1];
        ctx.lineWidth = 1 / z;
        ctx.beginPath();
        for (const i of list) { ctx.moveTo(bx[i] + r + 2 / z, by[i]); ctx.arc(bx[i], by[i], r + 2 / z, 0, Math.PI * 2); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (finalStretch) {
      ctx.strokeStyle = "rgba(242,196,90,0.85)";
      ctx.lineWidth = 2.5 / z;
      eachBlobIn(MAP, run, vx0 - 30, vy0 - 30, vx1 + 30, vy1 + 30, (i) => {
        if (MAP.tPearl[bt[i]]) return;
        ctx.beginPath();
        ctx.arc(bx[i], by[i], Math.max(BLOB_TYPES[bt[i]].r, minR) + (7 + 3 * Math.sin(now / 140)) / z, 0, Math.PI * 2);
        ctx.stroke();
      });
    }
  }

  function drawPlayer(now, dt, z, run, cos) {
    const p = run.p;
    const r = radiusOf(cfg, p.m);
    const skin = cos.skin;
    // dash trail
    for (const g of fx.trail) {
      g.t += dt;
      const a = 1 - g.t / 0.3;
      if (a <= 0) continue;
      if (cos.trail === "ink") { ctx.fillStyle = `rgba(20,24,48,${0.35 * a})`; ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (1.05 + 0.3 * (1 - a)), 0, Math.PI * 2); ctx.fill(); }
      else { ctx.globalAlpha = 0.22 * a; ctx.fillStyle = skin.body; ctx.beginPath(); ctx.arc(g.x, g.y, g.r * (0.75 + 0.25 * a), 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    }
    fx.trail = fx.trail.filter((g) => g.t < 0.3);

    p.pulse *= Math.exp(-9 * dt);
    const rr = r * (1 + 0.035 * p.pulse);
    const sp = Math.hypot(p.vx, p.vy);
    ctx.save();
    ctx.translate(p.x, p.y);
    // squash and stretch: along a dash, or gently along movement
    let ang = Math.atan2(p.vy, p.vx), sx = 1, sy = 1;
    if (p.dash) { const k = 1 - Math.min(1, p.dash.t / p.dash.dur); ang = Math.atan2(p.dash.dy, p.dash.dx); sx = 1 + 0.22 * k; sy = 1 - 0.14 * k; }
    else if (sp > 1) { const k = Math.min(1, sp / (r * 6)); sx = 1 + 0.05 * k; sy = 1 - 0.04 * k; }
    ctx.rotate(ang);
    ctx.scale(sx, sy);
    ctx.rotate(-ang);
    // body
    ctx.fillStyle = skin.body;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.fill();
    if (skin.pattern) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = skin.hi;
      ctx.globalAlpha = 0.35;
      if (skin.pattern === "stripes") for (let k = -3; k <= 3; k++) ctx.fillRect(-rr, k * rr * 0.32 - rr * 0.08, rr * 2, rr * 0.16);
      else for (const [a, b, c] of [[-0.4, 0.35, 0.16], [0.45, 0.4, 0.12], [0.1, -0.5, 0.1], [-0.55, -0.15, 0.09], [0.5, -0.1, 0.13]]) { ctx.beginPath(); ctx.arc(a * rr, b * rr, c * rr, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = skin.hi;
    ctx.beginPath();
    ctx.ellipse(-rr * 0.32, -rr * 0.38, rr * 0.34, rr * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(4,30,36,0.35)";
    ctx.lineWidth = Math.max(2 / z, rr * 0.04);
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
    // face: eyes look toward the aim direction and blink on bites
    const aim = opts_aim(run);
    const ex = aim.x * rr * 0.18, ey = aim.y * rr * 0.18;
    const blink = now < fx.blinkUntil;
    for (const side of [-1, 1]) {
      const cx = ex + side * rr * 0.26 + aim.x * rr * 0.05, cy = ey - rr * 0.08;
      const w = rr * 0.15, hgt = rr * 0.19 * (blink ? 0.12 : 1);
      if (cos.eyes === "happy") {
        ctx.strokeStyle = "#0b2a2a"; ctx.lineWidth = rr * 0.06; ctx.lineCap = "round";
        ctx.beginPath(); ctx.arc(cx, cy + w * 0.3, w * 0.9, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        continue;
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.ellipse(cx, cy, w, hgt, 0, 0, Math.PI * 2); ctx.fill();
      if (!blink) {
        ctx.fillStyle = "#0b2a2a";
        ctx.beginPath(); ctx.arc(cx + aim.x * w * 0.35, cy + aim.y * hgt * 0.35, w * 0.55, 0, Math.PI * 2); ctx.fill();
        if (cos.eyes === "sleepy") { ctx.fillStyle = skin.body; ctx.beginPath(); ctx.ellipse(cx, cy - hgt * 0.45, w * 1.15, hgt * 0.65, 0, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    ctx.restore();
  }
  let aimRef = { x: 1, y: 0 };
  const opts_aim = () => aimRef;
  function setAim(a) { aimRef = a; }

  let radarAt = 0, radarList = [];
  function drawRadar(cam, z, run, pr, count, view) {
    const now = performance.now();
    if (now - radarAt > 250 || radarList.some((i) => !run.alive[i])) {
      radarAt = now;
      radarList = nearestBlobs(MAP, run, cam.x, cam.y, count, (i) => {
        const x = MAP.bx[i], y = MAP.by[i];
        if (x > view[0] && x < view[1] && y > view[2] && y < view[3]) return false;
        return pr >= cfg.gates[MAP.tBiome[MAP.bt[i]]] && !MAP.tPearl[MAP.bt[i]];
      });
    }
    ctx.fillStyle = "#f2c45a";
    for (const i of radarList) {
      const a = Math.atan2(MAP.by[i] - cam.y, MAP.bx[i] - cam.x);
      const hx = W / 2 - 34, hy = H / 2 - 34;
      const t = Math.min(hx / Math.abs(Math.cos(a) || 1e-6), hy / Math.abs(Math.sin(a) || 1e-6));
      ctx.save();
      ctx.translate(W / 2 + Math.cos(a) * t, H / 2 + Math.sin(a) * t);
      ctx.rotate(a);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(-7, -7); ctx.lineTo(-3, 0); ctx.lineTo(-7, 7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawFinale(now, [title, sub]) {
    const e = now - fx.flashAt;
    if (e < 500) { ctx.fillStyle = `rgba(196,239,224,${0.3 * (1 - e / 500)})`; ctx.fillRect(0, 0, W, H); }
    if (e >= 2600) return;
    const a = Math.min(1, e / 250) * Math.min(1, (2600 - e) / 400);
    const big = Math.round(Math.min(W, 900) / 12), small = Math.round(Math.min(W, 900) / 28);
    ctx.globalAlpha = a;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${big}px Inter, system-ui, sans-serif`;
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(4,20,30,0.55)";
    ctx.strokeText(title, W / 2, H * 0.38);
    ctx.fillStyle = "#f2c45a";
    ctx.fillText(title, W / 2, H * 0.38);
    ctx.font = `600 ${small}px Inter, system-ui, sans-serif`;
    ctx.lineWidth = 5;
    ctx.strokeText(sub, W / 2, H * 0.38 + Math.min(W, 900) / 13);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(sub, W / 2, H * 0.38 + Math.min(W, 900) / 13);
    ctx.globalAlpha = 1;
  }

  // ---------- mini-map ----------
  function minimap(mini, run, cam) {
    const mctx = mini.getContext("2d");
    const S = mini.width;
    if (!minimap.img) {
      minimap.c = document.createElement("canvas");
      minimap.c.width = MAP.gw; minimap.c.height = MAP.gw;
      minimap.img = minimap.c.getContext("2d").createImageData(MAP.gw, MAP.gw);
      minimap.at = 0;
    }
    const now = performance.now();
    if (now - minimap.at > 500) {
      minimap.at = now;
      const d = minimap.img.data, cnt = run.cellAlive;
      const ref = Math.log(1 + (cfg.debug ? 3 : 500));
      for (let k = 0; k < cnt.length; k++) {
        const v = Math.min(1, Math.log(1 + cnt[k]) / ref), o = k * 4;
        d[o] = 170; d[o + 1] = 235; d[o + 2] = 220;
        d[o + 3] = cnt[k] ? 25 + 230 * v ** 1.5 : 0;
      }
      minimap.c.getContext("2d").putImageData(minimap.img, 0, 0);
    }
    const k = S / cfg.world, h = cfg.world / 2;
    mctx.clearRect(0, 0, S, S);
    mctx.fillStyle = BIOMES[3].bg; mctx.fillRect(0, 0, S, S);
    for (let b = BIOMES.length - 2; b >= 0; b--) { mctx.fillStyle = BIOMES[b].bg; mctx.beginPath(); mctx.arc(h * k, h * k, BIOMES[b].outer * h * k, 0, Math.PI * 2); mctx.fill(); }
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(minimap.c, 0, 0, S, S);
    const vw = W / cam.zoom, vh = H / cam.zoom;
    mctx.strokeStyle = "rgba(255,255,255,0.6)";
    mctx.lineWidth = 1;
    mctx.strokeRect((cam.x - vw / 2) * k, (cam.y - vh / 2) * k, Math.max(2, vw * k), Math.max(2, vh * k));
    mctx.fillStyle = "#f2c45a";
    mctx.beginPath(); mctx.arc(run.p.x * k, run.p.y * k, 3, 0, Math.PI * 2); mctx.fill();
  }

  function reset(run) {
    fx.pops.length = 0; fx.parts.length = 0; fx.floats.length = 0; fx.trail.length = 0; fx.bubbles.length = 0;
    texReset(run);
    minimap.at = 0;
    radarAt = 0;
  }

  return { resize, draw, reset, onEat, onDashMove, floatText, finale, minimap, setAim, size: () => ({ W, H }), stat };
}

export function fmtNum(n) {
  n = Math.floor(n);
  if (n < 10000) return n.toLocaleString("en-US");
  if (n < 99950) return `${(n / 1000).toFixed(1)}k`;
  if (n < 999500) return `${Math.round(n / 1000)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e8 ? 2 : 1)}M`;
  return `${(n / 1e9).toFixed(2)}B`;
}
export function fmtTime(ms) {
  if (ms == null) return "—";
  const t = Math.max(0, ms) / 1000, m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
