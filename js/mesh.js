/*
 * mesh.js — formas 3D básicas (cubo, cilindro, cone, esfera, anel, folha de grama).
 *
 * Uma "malha" (mesh) é uma lista de vértices (posição + normal) e uma lista
 * de triângulos (índices). A NORMAL diz para onde a superfície "aponta" e é
 * o que permite calcular luz e sombra.
 */
window.Game = window.Game || {};

(function () {
  const TAU = Math.PI * 2;

  function finish(P, N, I) {
    let minY = 1e9, maxY = -1e9;
    for (let i = 1; i < P.length; i += 3) { if (P[i] < minY) minY = P[i]; if (P[i] > maxY) maxY = P[i]; }
    return { pos: new Float32Array(P), nrm: new Float32Array(N), idx: new Uint32Array(I), minY, maxY };
  }

  /** Cubo de lado 1, centrado na origem. */
  function cube() {
    const P = [], N = [], I = [];
    for (const n of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) {
      const u = Math.abs(n[1]) === 1 ? [1, 0, 0] : [0, 1, 0];
      const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      const b = P.length / 3;
      for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        P.push(n[0] * 0.5 + u[0] * a * 0.5 + v[0] * c * 0.5, n[1] * 0.5 + u[1] * a * 0.5 + v[1] * c * 0.5, n[2] * 0.5 + u[2] * a * 0.5 + v[2] * c * 0.5);
        N.push(n[0], n[1], n[2]);
      }
      I.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return finish(P, N, I);
  }

  /** Cilindro de raio 0.5 e altura 1 (y de 0 a 1), com tampa de cima. */
  function cylinder(seg = 12) {
    const P = [], N = [], I = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU, c = Math.cos(a), s = Math.sin(a);
      P.push(c * 0.5, 0, s * 0.5, c * 0.5, 1, s * 0.5); N.push(c, 0, s, c, 0, s);
    }
    for (let i = 0; i < seg; i++) { const b = i * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const top = P.length / 3; P.push(0, 1, 0); N.push(0, 1, 0);
    for (let i = 0; i <= seg; i++) { const a = (i / seg) * TAU; P.push(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5); N.push(0, 1, 0); }
    for (let i = 0; i < seg; i++) I.push(top, top + 1 + i, top + 2 + i);
    return finish(P, N, I);
  }

  /** Cone de raio 0.5 na base (y=0) e ponta em y=1. */
  function cone(seg = 12) {
    const P = [], N = [], I = [], k = 1 / Math.hypot(1, 0.5);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU, am = (a0 + a1) / 2;
      const b = P.length / 3;
      P.push(Math.cos(a0) * 0.5, 0, Math.sin(a0) * 0.5, Math.cos(a1) * 0.5, 0, Math.sin(a1) * 0.5, 0, 1, 0);
      for (const a of [a0, a1, am]) N.push(Math.cos(a) * k, 0.5 * k, Math.sin(a) * k);
      I.push(b, b + 1, b + 2);
    }
    return finish(P, N, I);
  }

  /** Esfera de raio 0.5. */
  function sphere(lat = 10, lon = 14) {
    const P = [], N = [], I = [];
    for (let i = 0; i <= lat; i++) {
      const th = (i / lat) * Math.PI, y = Math.cos(th), r = Math.sin(th);
      for (let j = 0; j <= lon; j++) {
        const ph = (j / lon) * TAU, x = r * Math.cos(ph), z = r * Math.sin(ph);
        P.push(x * 0.5, y * 0.5, z * 0.5); N.push(x, y, z);
      }
    }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = i * (lon + 1) + j, b = a + lon + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return finish(P, N, I);
  }

  /** Anel (rosca) deitado no plano XZ: raio R, espessura r. */
  function torus(R = 0.5, r = 0.05, seg = 28, tube = 6) {
    const P = [], N = [], I = [];
    for (let i = 0; i <= seg; i++) {
      const u = (i / seg) * TAU;
      for (let j = 0; j <= tube; j++) {
        const v = (j / tube) * TAU, cv = Math.cos(v), sv = Math.sin(v);
        P.push((R + r * cv) * Math.cos(u), r * sv, (R + r * cv) * Math.sin(u));
        N.push(cv * Math.cos(u), sv, cv * Math.sin(u));
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < tube; j++) {
      const a = i * (tube + 1) + j, b = a + tube + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
    return finish(P, N, I);
  }

  /** Uma folha de grama: tira fina que afina até a ponta (x = largura, y = 0..1). */
  function blade() {
    const P = [], I = [], levels = 4;
    for (let i = 0; i < levels; i++) {
      const y = i / levels, w = 0.5 * Math.pow(1 - y, 0.8);
      P.push(-w, y, 0, w, y, 0);
    }
    P.push(0, 1, 0);
    for (let i = 0; i < levels - 1; i++) { const b = i * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const b = (levels - 1) * 2; I.push(b, b + 1, b + 2);
    return { pos: new Float32Array(P), idx: new Uint32Array(I) };
  }

  /** Hash determinístico 0..1 de 3 números (para variações de cor). */
  Game.hash = (a, b, c) => {
    let h = Math.imul(Math.floor(a * 100), 374761393) ^ Math.imul(Math.floor(b * 100), 668265263) ^ Math.imul(Math.floor(c * 100), 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  Game.rng = (a) => () => {   // mulberry32: sorteio com semente
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  /** Junta várias formas posicionadas no mundo numa malha só (cenário estático). */
  function Builder() { this.pos = []; this.nrm = []; this.col = []; this.idx = []; this.sw = []; }
  Builder.prototype.add = function (m, x, y, z, yaw, sx, sy, sz, color, grad = 0, sway = null) {
    const c = Math.cos(yaw), s = Math.sin(yaw), base = this.pos.length / 3, span = (m.maxY - m.minY) || 1;
    for (let i = 0; i < m.pos.length; i += 3) {
      const px = m.pos[i] * sx, py = m.pos[i + 1] * sy, pz = m.pos[i + 2] * sz;
      const wx = c * px + s * pz + x, wy = py + y, wz = -s * px + c * pz + z;
      this.pos.push(wx, wy, wz);
      let nx = m.nrm[i] / sx, ny = m.nrm[i + 1] / sy, nz = m.nrm[i + 2] / sz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      this.nrm.push(c * nx + s * nz, ny, -s * nx + c * nz);
      const ly = (m.pos[i + 1] - m.minY) / span;
      const shade = (1 - grad * (1 - ly)) * (0.9 + 0.2 * Game.hash(wx * 3.1, wz * 2.3, wy * 1.7));
      this.col.push(color[0] * shade, color[1] * shade, color[2] * shade);
      // peso do balanço: 0 na base da árvore, cresce até 1 na ponta (a base fica parada, o topo balança)
      const wgt = sway ? Math.pow(Math.max(0, Math.min(1, (wy - sway.base) / sway.h)), 1.6) : 0;
      this.sw.push(wgt, sway ? sway.phase : 0);
    }
    for (let i = 0; i < m.idx.length; i++) this.idx.push(base + m.idx[i]);
  };

  Game.Geo = { cube, cylinder, cone, sphere, torus, blade, Builder };
})();
