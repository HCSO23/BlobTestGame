// Seeded map generation + spatial grid. Pure (no DOM), shared by the game and tools/balance.mjs.
import { BLOB_TYPES, BIOMES, TYPE_INDEX } from "./config.js";

export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Which biome ring a point is in (0 = Shallows ... 3 = Abyss).
export function biomeAt(cfg, x, y) {
  const h = cfg.world / 2;
  const d = Math.hypot(x - h, y - h) / h;
  for (let b = 0; b < BIOMES.length; b++) if (d < BIOMES[b].outer) return b;
  return BIOMES.length - 1;
}

export function buildMap(cfg) {
  const W = cfg.world, h = W / 2;
  const rnd = mulberry32(cfg.seed);
  const counts = cfg.counts;
  const N = counts.reduce((a, b) => a + b, 0) + cfg.pearls;
  const bx = new Float32Array(N), by = new Float32Array(N), bt = new Uint8Array(N);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const inner = (b) => (b === 0 ? 0 : BIOMES[b - 1].outer * h);
  const outer = (b) => BIOMES[b].outer * h;
  const inBiome = (b, x, y) => {
    if (x < 40 || y < 40 || x > W - 40 || y > W - 40) return false;
    const d = Math.hypot(x - h, y - h);
    return d >= inner(b) && d < outer(b);
  };
  const uniformIn = (b) => {
    const o = Math.min(outer(b), h * 1.5);
    for (let k = 0; k < 200; k++) {
      const x = h + (rnd() * 2 - 1) * o, y = h + (rnd() * 2 - 1) * o;
      if (inBiome(b, x, y)) return [x, y];
    }
    return [h, h];
  };

  let i = 0;
  for (let b = 0; b < BIOMES.length; b++) {
    const bio = BIOMES[b];
    const typeTable = bio.types.map(([id, w]) => [TYPE_INDEX[id], w]);
    const clusterCount = cfg.debug ? 0 : bio.clusters;
    const clusters = [];
    let wsum = 0;
    const cscale = [0.45, 0.9, 1.15, 1.4][b];
    for (let c = 0; c < clusterCount; c++) {
      const [x, y] = uniformIn(b);
      wsum += 0.3 + rnd();
      clusters.push({ x, y, r: (300 + rnd() ** 2 * 2200) * cscale, w: wsum });
    }
    for (let n = 0; n < counts[b]; n++, i++) {
      const roll = rnd();
      let acc = 0, t = typeTable[0][0];
      for (const [ti, w] of typeTable) { acc += w; if (roll < acc) { t = ti; break; } }
      bt[i] = t;
      let x, y;
      if (clusters.length && rnd() < bio.clusterShare) {
        const pick = rnd() * wsum;
        let lo = 0, hi = clusters.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (clusters[mid].w < pick) lo = mid + 1; else hi = mid; }
        const c = clusters[lo];
        let ok = false;
        for (let k = 0; k < 6 && !ok; k++) {
          x = c.x + gauss() * c.r * 0.5;
          y = c.y + gauss() * c.r * 0.5;
          ok = inBiome(b, x, y);
        }
        if (!ok) [x, y] = uniformIn(b);
      } else {
        [x, y] = uniformIn(b);
      }
      bx[i] = x; by[i] = y;
    }
  }
  // pearls (only alive when the Pearls star upgrade is owned) sit in the Trench
  const pearlStart = i;
  for (let n = 0; n < cfg.pearls; n++, i++) {
    const [x, y] = uniformIn(2);
    bx[i] = x; by[i] = y; bt[i] = TYPE_INDEX.pearl;
  }

  // spatial grid via counting sort: blobs of cell k are order[start[k] .. start[k + 1])
  const cs = cfg.gridSize, gw = Math.ceil(W / cs), cells = gw * gw;
  const cellOf = new Int32Array(N), start = new Int32Array(cells + 1);
  for (let j = 0; j < N; j++) {
    const k = Math.min(gw - 1, Math.floor(by[j] / cs)) * gw + Math.min(gw - 1, Math.floor(bx[j] / cs));
    cellOf[j] = k;
    start[k + 1]++;
  }
  for (let k = 0; k < cells; k++) start[k + 1] += start[k];
  const fill = start.slice(0, cells), order = new Int32Array(N);
  for (let j = 0; j < N; j++) order[fill[cellOf[j]]++] = j;

  // per-type lookups as flat arrays for speed
  const T = BLOB_TYPES.length;
  const tMass = new Float32Array(T), tGoo = new Float32Array(T), tR = new Float32Array(T), tBiome = new Uint8Array(T), tGold = new Uint8Array(T), tPearl = new Uint8Array(T);
  BLOB_TYPES.forEach((t, k) => { tMass[k] = t.mass; tGoo[k] = t.goo; tR[k] = t.r; tBiome[k] = t.biome; tGold[k] = t.gold ? 1 : 0; tPearl[k] = t.pearl ? 1 : 0; });

  return { N, bx, by, bt, cs, gw, start, order, cellOf, pearlStart, tMass, tGoo, tR, tBiome, tGold, tPearl, counts };
}

// Visit live blobs whose grid cells overlap a rectangle.
export function eachBlobIn(MAP, run, x0, y0, x1, y1, fn) {
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

// The `count` nearest live blobs matching `accept(i)`, searched ring by ring outward from (cx, cy).
export function nearestBlobs(MAP, run, cx, cy, count, accept) {
  const { cs, gw, start, order, bx, by } = MAP;
  const ccx = Math.min(gw - 1, Math.max(0, Math.floor(cx / cs))), ccy = Math.min(gw - 1, Math.max(0, Math.floor(cy / cs)));
  const found = [];
  for (let ring = 0; ring < gw; ring++) {
    for (let gy = ccy - ring; gy <= ccy + ring; gy++) {
      if (gy < 0 || gy >= gw) continue;
      const edgeRow = gy === ccy - ring || gy === ccy + ring;
      for (let gx = ccx - ring; gx <= ccx + ring; gx += edgeRow ? 1 : 2 * ring || 1) {
        if (gx < 0 || gx >= gw) continue;
        const k = gy * gw + gx;
        if (!run.cellAlive[k]) continue;
        for (let j = start[k], e = start[k + 1]; j < e; j++) {
          const i = order[j];
          if (!run.alive[i] || (accept && !accept(i))) continue;
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
