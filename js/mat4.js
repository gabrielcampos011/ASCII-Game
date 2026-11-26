/*
 * mat4.js — matemática 3D mínima (matrizes 4x4).
 *
 * Uma matriz 4x4 guarda "mover + girar + escalar" de um objeto no espaço 3D.
 * Multiplicar matrizes combina transformações. Usamos o formato "coluna
 * por coluna" que o WebGL espera: elemento (linha r, coluna c) = m[c*4 + r].
 */
window.Game = window.Game || {};

(function () {
  const M = {};

  M.ident = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

  /** a * b (aplica b primeiro, depois a). */
  M.mul = (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  };
  /** M.chain(A, B, C) = A*B*C (a leitura é "da raiz para a folha"). */
  M.chain = (...ms) => ms.reduce((acc, m) => M.mul(acc, m));

  M.T = (x, y, z) => { const m = M.ident(); m[12] = x; m[13] = y; m[14] = z; return m; };
  M.S = (x, y, z) => { const m = M.ident(); m[0] = x; m[5] = y; m[10] = z; return m; };
  M.Rx = (a) => { const m = M.ident(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; };
  M.Ry = (a) => { const m = M.ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[8] = s; m[2] = -s; m[10] = c; return m; };
  M.Rz = (a) => { const m = M.ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[4] = -s; m[1] = s; m[5] = c; return m; };

  /** Projeção em perspectiva (como uma câmera de verdade). */
  M.perspective = (fovy, aspect, n, f) => {
    const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = t / aspect; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
    return m;
  };
  /** Projeção ortográfica (usada pela luz que faz sombra). */
  M.ortho = (l, r, b, t, n, f) => {
    const m = M.ident();
    m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
    m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n);
    return m;
  };
  /** Câmera em "e" olhando para "c". */
  M.lookAt = (e, c, up) => {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx; m[4] = xy; m[5] = yy; m[6] = zy; m[8] = xz; m[9] = yz; m[10] = zz;
    m[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
    m[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
    m[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
    m[15] = 1;
    return m;
  };
  /** Aplica a matriz a um ponto [x,y,z]. */
  M.point = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];

  Game.M = M;
})();
