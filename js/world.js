/*
 * world.js — o mundo 3D: relevo, lagoa, árvores, pedras, ruínas e grama.
 *
 * O terreno é um "mapa de alturas": uma função height(x, z) diz quão alto
 * o chão está em cada ponto. Com ela montamos uma malha de triângulos, e
 * também sabemos onde o jogador pode pisar. Tudo é gerado de uma semente
 * fixa, então o mundo é sempre o mesmo.
 */
window.Game = window.Game || {};

(function () {
  const HALF = 80;                      // o mundo vai de -80 a +80 em x e z
  const STEP = 0.8;                     // distância entre vértices do terreno
  const POND = { x: 17, z: -7 };        // centro da lagoa
  const RUINS = { x: -11, z: -13 };     // centro das ruínas

  // ---------- ruído (para o relevo parecer natural) ----------
  function lat(ix, iy, s) {
    let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177); n ^= n >>> 16;
    return (n >>> 0) / 4294967296;
  }
  const sm = (t) => t * t * (3 - 2 * t);
  function vnoise(x, y, s) {
    const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
    const a = lat(ix, iy, s), b = lat(ix + 1, iy, s), c = lat(ix, iy + 1, s), d = lat(ix + 1, iy + 1, s);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, s) {
    let v = 0, amp = 0.5, f = 1, sum = 0;
    for (let o = 0; o < 4; o++) { v += amp * vnoise(x * f, y * f, s + o * 101); sum += amp; amp *= 0.5; f *= 2; }
    return v / sum;
  }
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  /** Altura do chão no ponto (x, z). A água fica em y = 0. */
  function height(x, z) {
    const r = Math.hypot(x, z);
    let h = 1.1 + (fbm(x * 0.04 + 31.7, z * 0.04 + 12.3, 7) - 0.5) * 5.0;
    h += (fbm(x * 0.15, z * 0.15, 3) - 0.5) * 0.5;
    const dx = x - POND.x, dz = z - POND.z;
    h -= 4.4 * Math.exp(-(dx * dx + dz * dz) / (2 * 8.5 * 8.5));        // a lagoa
    const flat = smooth(11, 3, r);                                       // área inicial mais plana
    h = h * (1 - flat) + 1.0 * flat;
    h += smooth(56, 76, r) * 20;                                         // montanhas cercam o mapa
    return h;
  }

  function terrainColor(x, z, h, ny) {
    const n = fbm(x * 0.2, z * 0.2, 5);
    let c;
    if (h < 0.6) c = mix([0.10, 0.12, 0.12], [0.38, 0.33, 0.22], smooth(-0.4, 0.6, h));   // lama/areia
    else c = mix([0.10, 0.30, 0.14], [0.18, 0.44, 0.18], n);                                // grama
    const slope = 1 - ny + (h > 6 ? 0.3 : 0);
    c = mix(c, [0.34, 0.37, 0.44], smooth(0.22, 0.5, slope));                               // rocha
    c = mix(c, [0.78, 0.84, 0.95], smooth(14, 18, h));                                      // neve
    return c;
  }

  /** Monta tudo. Chamado uma vez; devolve dados prontos para a GPU. */
  function build() {
    const G = Game.Geo, B = new G.Builder(), rnd = Game.rng(2024);
    const colliders = [];                      // círculos onde não se pode pisar
    const runes = [];                          // luzes emissivas da ruína

    // ----- terreno -----
    const n = Math.round((HALF * 2) / STEP) + 1;
    const hs = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) hs[j * n + i] = height(-HALF + i * STEP, -HALF + j * STEP);
    const H = (i, j) => hs[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP, h = hs[j * n + i];
      let nx = H(i - 1, j) - H(i + 1, j), nz = H(i, j - 1) - H(i, j + 1), ny = 2 * STEP;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const c = terrainColor(x, z, h, ny);
      const v = 0.92 + 0.16 * Game.hash(x, z, 1);
      B.pos.push(x, h, z); B.nrm.push(nx, ny, nz); B.col.push(c[0] * v, c[1] * v, c[2] * v); B.sw.push(0, 0);
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      B.idx.push(a, c, b, b, c, d);
    }

    // ----- água: só onde o terreno fica abaixo de y=0 -----
    const wp = [], wd = [], wi = [];
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const hh = [H(i, j), H(i + 1, j), H(i, j + 1), H(i + 1, j + 1)];
      if (Math.min(...hh) > 0.05) continue;
      const base = wp.length / 3;
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([di, dj], k) => {
        wp.push(-HALF + (i + di) * STEP, -0.03, -HALF + (j + dj) * STEP);
        wd.push(Math.max(0, -hh[k]), 0, 0);               // profundidade vai na "cor"
      });
      wi.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }

    // ----- árvores (pinheiros) -----
    const cyl = G.cylinder(7), cone = G.cone(8), sph = G.sphere(6, 8), cube = G.cube();
    const trees = [], cellUsed = new Set();
    for (let t = 0; t < 2600 && trees.length < 170; t++) {
      const x = (rnd() * 2 - 1) * 66, z = (rnd() * 2 - 1) * 66, r = Math.hypot(x, z);
      const h = height(x, z);
      if (h < 0.8 || h > 6 || r < 8 || r > 66 || Math.hypot(x - RUINS.x, z - RUINS.z) < 7) continue;
      if (Math.abs(height(x + 1, z) - h) > 0.7 || Math.abs(height(x, z + 1) - h) > 0.7) continue;
      const dens = smooth(0.4, 0.62, fbm(x * 0.06 + 5, z * 0.06 + 9, 11)) * 0.95 + 0.05;
      if (rnd() > dens) continue;
      const key = Math.floor(x / 3.2) + "," + Math.floor(z / 3.2);
      if (cellUsed.has(key)) continue;
      cellUsed.add(key);
      const s = 0.8 + rnd() * 0.9, tint = rnd();
      const sway = { base: h, h: 6.3 * s, phase: Game.hash(x, z, 7) * 6.283 };      // cada árvore balança com uma fase própria
      B.add(cyl, x, h - 0.2, z, 0, 0.55 * s, 2.6 * s, 0.55 * s, [0.30, 0.18, 0.11], 0.4, sway);
      const leaf = tint < 0.7 ? [0.07, 0.32, 0.22] : [0.10, 0.40, 0.16];
      B.add(cone, x, h + 1.0 * s, z, rnd() * 6, 3.8 * s, 2.8 * s, 3.8 * s, leaf, 0.55, sway);
      B.add(cone, x, h + 2.5 * s, z, rnd() * 6, 3.0 * s, 2.5 * s, 3.0 * s, leaf, 0.5, sway);
      B.add(cone, x, h + 3.9 * s, z, rnd() * 6, 2.0 * s, 2.3 * s, 2.0 * s, leaf, 0.4, sway);
      colliders.push({ x, z, r: 0.6 });
      trees.push({ x, z });
    }

    // ----- pedras -----
    for (let t = 0; t < 600 && colliders.length < 170 + 46; t++) {
      const x = (rnd() * 2 - 1) * 64, z = (rnd() * 2 - 1) * 64, h = height(x, z), r = Math.hypot(x, z);
      if (h < 0.6 || r < 7 || r > 64 || Math.hypot(x - RUINS.x, z - RUINS.z) < 6) continue;
      const s = 0.7 + rnd() * 1.6;
      B.add(sph, x, h - 0.15 * s, z, rnd() * 6, 1.6 * s, 1.0 * s, 1.3 * s, [0.34, 0.36, 0.42], 0.3);
      colliders.push({ x, z, r: 0.75 * s });
    }

    // ----- ruínas: pilares em círculo + monólito com runas brilhantes -----
    const stone = [0.42, 0.44, 0.52];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, x = RUINS.x + Math.cos(a) * 7, z = RUINS.z + Math.sin(a) * 7, h = height(x, z);
      const ph = k % 3 === 0 ? 2.2 : 4.6;                                // alguns quebrados
      B.add(cube, x, h - 0.1, z, a, 1.5, 0.5, 1.5, stone, 0.2);          // base
      B.add(cyl, x, h + 0.3, z, 0, 1.1, ph, 1.1, stone, 0.3);            // coluna
      if (ph > 4) B.add(cube, x, h + 0.3 + ph, z, a, 1.5, 0.45, 1.5, stone, 0.1);   // capitel
      colliders.push({ x, z, r: 0.85 });
    }
    {
      const h = height(RUINS.x, RUINS.z);
      B.add(cube, RUINS.x, h, RUINS.z, 0.6, 1.6, 0.35, 1.6, stone, 0.2);
      B.add(cube, RUINS.x, h + 0.3, RUINS.z, 0.6, 1.3, 5.5, 0.7, [0.30, 0.33, 0.42], 0.25);
      colliders.push({ x: RUINS.x, z: RUINS.z, r: 1.0 });
      const ca = Math.cos(0.6), sa = Math.sin(0.6);                      // runas na frente do monólito
      for (let k = 0; k < 4; k++) runes.push({ x: RUINS.x - sa * 0.36, y: h + 1.4 + k * 1.1, z: RUINS.z - ca * 0.36, yaw: 0.6, w: 0.5, h: 0.14 });
    }

    // ----- grama: instâncias por bloco (para desenhar só o que está perto) -----
    const CH = 10, nc = (HALF * 2) / CH, chunks = [], all = [];
    for (let cj = 0; cj < nc; cj++) for (let ci = 0; ci < nc; ci++) {
      const x0 = -HALF + ci * CH, z0 = -HALF + cj * CH, start = all.length / 8;
      for (let k = 0; k < 3800; k++) {
        const x = x0 + rnd() * CH, z = z0 + rnd() * CH, h = height(x, z);
        if (h < 0.45 || h > 6.5) continue;
        const patch = fbm(x * 0.12 + 3, z * 0.12 + 8, 21);
        if (rnd() > 0.55 + patch * 0.5) continue;
        if (Math.hypot(x - RUINS.x, z - RUINS.z) < 3 && rnd() < 0.7) continue;
        all.push(x, h - 0.05, z, rnd() * 6.283, (0.25 + rnd() * 0.4) * (0.75 + patch * 0.5), 0.07 + rnd() * 0.06, rnd(), rnd() * 6.283);
      }
      chunks.push({ cx: x0 + CH / 2, cz: z0 + CH / 2, start, count: all.length / 8 - start });
    }

    // ----- vaga-lumes (pontinhos brilhantes) -----
    const fireflies = [];
    for (let t = 0; t < 400 && fireflies.length < 110; t++) {
      const x = (rnd() * 2 - 1) * 60, z = (rnd() * 2 - 1) * 60, h = height(x, z);
      if (h > 0.2 && h < 6) fireflies.push({ x, z, y: h + 0.5 + rnd() * 1.8, ph: rnd() * 6.283 });
    }

    return {
      static: { pos: new Float32Array(B.pos), nrm: new Float32Array(B.nrm), col: new Float32Array(B.col), sw: new Float32Array(B.sw), idx: new Uint32Array(B.idx) },
      water: { pos: new Float32Array(wp), nrm: new Float32Array(wp.length), col: new Float32Array(wd), idx: new Uint32Array(wi) },
      grass: new Float32Array(all), chunks, colliders, fireflies, runes,
    };
  }

  Game.World = { HALF, POND, RUINS, height, build };
})();
