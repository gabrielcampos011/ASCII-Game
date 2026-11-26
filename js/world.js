/*
 * world.js — gera o mundo (terreno, vila e covil do dragão).
 *
 * Técnica: "ruído de valor" em camadas (fbm). Dois mapas de ruído:
 *   e = elevação  (baixo = água, alto = montanha)
 *   m = umidade   (alto = floresta)
 * Uma "ilha" é formada subtraindo elevação perto das bordas.
 * Tudo vem de uma SEMENTE: mesma semente = mesmo mundo.
 */
(function () {
  const ID = Game.ID;
  const W = 72, H = 48;

  // ---------- ruído ----------
  function lat(ix, iy, s) {
    let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  const smooth = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = smooth(x - ix), fy = smooth(y - iy);
    const a = lat(ix, iy, s), b = lat(ix + 1, iy, s), c = lat(ix, iy + 1, s), d = lat(ix + 1, iy + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, s) {                 // 4 camadas de detalhe somadas
    let v = 0, amp = 0.5, f = 1, sum = 0;
    for (let o = 0; o < 4; o++) { v += amp * vnoise(x * f, y * f, s + o * 101); sum += amp; amp *= 0.5; f *= 2; }
    return v / sum;
  }
  function noiseMap(scale, ox, oy, salt) {   // gera e normaliza para 0..1
    const a = new Float32Array(W * H);
    let mn = 9, mx = -9;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = fbm((x + ox) * scale, (y + oy) * scale, salt);
      a[y * W + x] = v; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - mn) / (mx - mn);
    return a;
  }

  // ---------- busca em largura (distância de caminhada) ----------
  function bfs(tiles, sx, sy) {
    const dist = new Int16Array(W * H).fill(-1);
    const q = [sy * W + sx]; dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (dist[j] === -1 && Game.walkable(tiles[j])) { dist[j] = dist[i] + 1; q.push(j); }
      }
    }
    return { dist, count: q.length };
  }

  function tryGenerate(seed) {
    const rnd = Game.mulberry32(seed);
    const ox = rnd() * 500, oy = rnd() * 500;
    const e = noiseMap(0.085, ox, oy, seed & 0xffff);
    const m = noiseMap(0.11, oy + 77, ox + 33, (seed >>> 3) & 0xffff);
    const tiles = new Uint8Array(W * H);

    // 1) terreno base
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const nx = ((x + 0.5) / W) * 2 - 1, ny = ((y + 0.5) / H) * 2 - 1;
      const d = Math.hypot(nx, ny * 1.05) / 1.2;           // 0 no centro, ~1 nas bordas
      const ev = e[i] - 0.55 * Math.pow(d, 3);              // ilha
      const r = rnd();
      let t;
      if (ev < 0.22) t = ID.WATER;
      else if (ev < 0.29) t = ID.SHALLOW;
      else if (ev < 0.33) t = ID.SAND;
      else if (ev > 0.72) t = ID.SNOW;
      else if (ev > 0.6) t = ID.MOUNTAIN;
      else if (m[i] > 0.5 && r < 0.72) t = ID.TREE;
      else if (m[i] > 0.38 && r < 0.1) t = ID.TREE;
      else if (r < 0.07) t = ID.FLOWER;
      else t = ID.GRASS;
      tiles[i] = t;
    }

    // 2) maior região caminhável
    const comp = new Int32Array(W * H).fill(-1);
    let best = -1, bestSize = 0, label = 0;
    for (let s = 0; s < W * H; s++) {
      if (comp[s] !== -1 || !Game.walkable(tiles[s])) continue;
      const q = [s]; comp[s] = label;
      for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % W, y = (i / W) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (comp[j] === -1 && Game.walkable(tiles[j])) { comp[j] = label; q.push(j); }
        }
      }
      if (q.length > bestSize) { bestSize = q.length; best = label; }
      label++;
    }
    if (bestSize < 1100) return null;

    // 3) onde fica a vila: janela 13x9 com pouca água/montanha, perto do centro
    let cx = -1, cy = -1, bestScore = 1e9;
    for (let y = 6; y <= H - 7; y++) for (let x = 8; x <= W - 9; x++) {
      const i = y * W + x;
      if (comp[i] !== best || (tiles[i] !== ID.GRASS && tiles[i] !== ID.FLOWER)) continue;
      let blocked = 0;
      for (let dy = -4; dy <= 4; dy++) for (let dx = -6; dx <= 6; dx++) {
        const t = tiles[(y + dy) * W + x + dx];
        if (t === ID.WATER || t === ID.MOUNTAIN || t === ID.SNOW) blocked++;
      }
      const score = blocked * 12 + Math.hypot(x - W / 2, (y - H / 2) * 1.4);
      if (score < bestScore) { bestScore = score; cx = x; cy = y; }
    }
    if (cx < 0) return null;

    // 4) constrói a vila
    for (let dy = -4; dy <= 4; dy++) for (let dx = -6; dx <= 6; dx++) {
      tiles[(cy + dy) * W + cx + dx] = rnd() < 0.08 ? ID.FLOWER : ID.GRASS;
    }
    const set = (x, y, t) => { tiles[y * W + x] = t; };
    for (let x = cx - 5; x <= cx + 5; x++) set(x, cy - 1, ID.PATH);        // rua
    for (let y = cy - 1; y <= cy + 4; y++) set(cx, y, ID.PATH);            // rua para o sul
    for (const hx of [cx - 4, cx + 4]) {                                   // duas casas 3x2
      for (let k = -1; k <= 1; k++) { set(hx + k, cy - 3, ID.ROOF); set(hx + k, cy - 2, k === 0 ? ID.DOOR : ID.WALL); }
    }
    set(cx, cy - 2, ID.CAMP);                                              // fogueira
    const safe = { x0: cx - 6, x1: cx + 6, y0: cy - 4, y1: cy + 4 };
    const start = { x: cx, y: cy + 2 };
    const elder = { x: cx - 4, y: cy - 1 };
    const merchant = { x: cx + 4, y: cy - 1 };

    // 5) covil do dragão: um dos lugares mais distantes, de preferência cercado de montanhas
    let { dist } = bfs(tiles, start.x, start.y);
    let maxD = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i] > maxD) maxD = dist[i];
    let lair = null, lairScore = -1;
    for (let y = 4; y < H - 4; y++) for (let x = 4; x < W - 4; x++) {
      const d = dist[y * W + x];
      if (d < maxD * 0.8) continue;
      let mt = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const t = tiles[(y + dy) * W + x + dx];
        if (t === ID.MOUNTAIN || t === ID.SNOW) mt++;
      }
      const sc = mt + d * 0.2;
      if (sc > lairScore) { lairScore = sc; lair = { x, y }; }
    }
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(lair.x + dx, lair.y + dy, ID.LAIR);

    const res = bfs(tiles, start.x, start.y);
    if (res.count < 1000) return null;
    return { W, H, seed, tiles, dist: res.dist, start, safe, elder, merchant, lair };
  }

  Game.World = {
    W, H,
    generate(seed) {
      for (let a = 0; a < 40; a++) {              // tenta sementes vizinhas até dar certo
        const w = tryGenerate(seed + a * 7919);
        if (w) return w;
      }
      throw new Error("não foi possível gerar o mundo");
    },
  };
})();
