/*
 * models.js — o corpo do herói e dos inimigos, montado com peças simples.
 *
 * Cada personagem é um "esqueleto" de caixas, esferas e cones. Cada peça
 * tem uma matriz que diz onde ela fica RELATIVA à peça-pai: o braço fica
 * preso ao ombro, a espada à mão... Girar o ombro leva o braço e a espada
 * juntos. É assim que se anima um personagem 3D (animação hierárquica).
 *
 * part(malha, matriz, cor, brilho) desenha uma peça; quem decide como
 * desenhar (sombra, reflexo ou cena) é o render.js.
 */
window.Game = window.Game || {};

(function () {
  const M = Game.M;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (k) => 1 - (1 - k) * (1 - k);
  const easeIO = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  const C = {
    skin: [0.92, 0.80, 0.68], hair: [0.20, 0.16, 0.30], cloak: [0.16, 0.50, 0.95], armor: [0.78, 0.84, 0.98],
    pants: [0.22, 0.26, 0.42], belt: [0.35, 0.95, 1.0], halo: [1, 1, 1], blade: [0.85, 0.95, 1.0], hilt: [0.75, 0.55, 0.2],
  };

  /** Ângulos do braço da espada para o golpe t (0..1). dir = lado do golpe (+1/-1). */
  function swing(t, dir) {
    const s0 = 1.55 * dir;
    if (t < 0.28) { const k = easeOut(t / 0.28); return { psi: lerp(0, s0, k), pitch: lerp(-0.9, -2.0, k) }; }
    if (t < 0.56) { const k = easeIO((t - 0.28) / 0.28); return { psi: lerp(s0, -s0 * 1.1, k), pitch: lerp(-2.0, -1.3, k) }; }
    const k = easeOut(Math.min(1, (t - 0.56) / 0.44));
    return { psi: lerp(-s0 * 1.1, 0, k), pitch: lerp(-1.3, -0.9, k) };
  }

  function playerFrames(p) {
    const sp = Math.min(1, p.speed01), bob = Math.abs(Math.sin(p.walk)) * 0.06 * sp;
    let psi = 0, pitch = -0.9 + Math.sin(p.walk) * 0.08 * sp;
    if (p.attackT >= 0) { const w = swing(p.attackT, p.attackDir); psi = w.psi; pitch = w.pitch; p.twist = psi * 0.28; }
    const root = M.chain(M.T(p.x, p.y, p.z), M.Ry(p.yaw + (p.attackT >= 0 ? p.twist : 0)));
    const shoulder = M.chain(root, M.T(0.4, 1.52 + bob, 0), M.Ry(psi), M.Rx(pitch));
    const hand = M.chain(shoulder, M.T(0, -0.7, 0));
    return { root, shoulder, hand, sp, bob };
  }

  /** Base e ponta da espada no mundo (para o rastro e o acerto). */
  function swordPoints(p) {
    const f = playerFrames(p);
    return [M.point(f.hand, [0, -0.2, 0]), M.point(f.hand, [0, -1.7, 0])];
  }

  /** Desenha o herói. "ghost" = {color, em}: usado nas imagens-fantasma do dash. */
  function drawPlayer(part, p, time, ghost) {
    const R = Game.Renderer.meshes, f = playerFrames(p), { root, sp, bob } = f;
    const hurt = p.flash > 0 && ((p.flash * 28) | 0) % 2 === 0;
    const P = (mesh, mat, col, em) => part(mesh, mat, ghost ? ghost.color : hurt ? [1, 0.35, 0.3] : col, ghost ? ghost.em : hurt ? 0.6 : em || 0);
    const lean = 0.1 * sp + (p.dashT > 0 ? 0.55 : 0);

    for (const s of [-1, 1]) {                                            // pernas
      const sw = Math.sin(p.walk + (s > 0 ? 0 : Math.PI)) * 0.85 * sp;
      P(R.cube, M.chain(root, M.T(0.15 * s, 0.88 + bob, 0), M.Rx(sw), M.T(0, -0.44, 0), M.S(0.21, 0.88, 0.24)), C.pants);
    }
    const torso = M.chain(root, M.T(0, 1.22 + bob, 0), M.Rx(lean));
    P(R.cube, M.chain(torso, M.S(0.58, 0.74, 0.36)), C.armor);
    P(R.cube, M.chain(root, M.T(0, 0.9 + bob, 0), M.Rx(lean * 0.5), M.S(0.62, 0.09, 0.4)), C.belt, 1);   // cinto brilhante
    // capa: pendurada nas costas, balança com a velocidade
    const flow = 0.1 + sp * 0.45 + Math.sin(time * 3 + p.walk) * 0.04 * (0.3 + sp);
    P(R.cube, M.chain(torso, M.T(0, 0.34, -0.22), M.Rx(flow), M.T(0, -0.66, 0), M.S(0.66, 1.3, 0.07)), C.cloak);
    P(R.cube, M.chain(torso, M.T(0, 0.38, -0.20), M.S(0.8, 0.2, 0.28)), C.cloak);                         // gola
    // cabeça + cabelo + aureola
    const head = M.chain(root, M.T(0, 1.8 + bob, 0.02), M.Rx(lean * 0.6));
    P(R.sph, M.chain(head, M.S(0.46, 0.5, 0.46)), C.skin);
    P(R.sph, M.chain(head, M.T(0, 0.08, -0.04), M.S(0.5, 0.42, 0.5)), C.hair);
    P(R.torus, M.chain(root, M.T(0, 2.3 + bob, 0), M.Rx(0.5), M.Ry(time * 1.4), M.S(1.2, 1.6, 1.2)), C.halo, 1);
    // braço esquerdo
    P(R.cube, M.chain(root, M.T(-0.4, 1.5 + bob, 0), M.Rx(-Math.sin(p.walk) * 0.8 * sp - 0.15), M.T(0, -0.34, 0), M.S(0.17, 0.7, 0.19)), C.armor);
    // braço direito + espada
    P(R.cube, M.chain(f.shoulder, M.T(0, -0.34, 0), M.S(0.17, 0.7, 0.19)), C.armor);
    P(R.cube, M.chain(f.hand, M.T(0, -0.1, 0), M.S(0.34, 0.07, 0.1)), C.hilt);                            // guarda
    P(R.cube, M.chain(f.hand, M.T(0, -0.93, 0), M.S(0.07, 1.5, 0.035)), C.blade, ghost ? 0 : 0.55);        // lâmina
  }

  /** Desenha um inimigo (goblin pequeno ou dokkaebi grande). */
  function drawEnemy(part, e, time) {
    const R = Game.Renderer.meshes, ogre = e.type === "ogre", def = Game.Logic.ENEMY[e.type], sc = def.scale;
    const grow = Math.min(1, e.age / 0.8), die = e.dying ? Math.max(0, 1 - e.dieT / 0.45) : 1;
    const root = M.chain(M.T(e.x, e.y - (1 - grow) * 1.6 * sc, e.z), M.Ry(e.yaw), M.S(sc * grow, sc * grow * die, sc * grow));
    const skin = ogre ? [0.80, 0.22, 0.28] : [0.40, 0.72, 0.28], cloth = ogre ? [0.25, 0.22, 0.55] : [0.55, 0.34, 0.18];
    const flash = e.flash > 0, wind = e.state === "windup", k = wind ? e.st / def.windup : 0;
    const P = (mesh, mat, col, em) => part(mesh, mat, flash ? [1, 1, 1] : wind ? [col[0] * 0.5 + 0.6, col[1] * 0.6, col[2] * 0.5] : col, flash ? 0.8 : em || 0);
    const w = Math.sin(e.walk) * 0.8;
    const bob = Math.abs(Math.sin(e.walk)) * 0.05;

    for (const s of [-1, 1]) P(R.cube, M.chain(root, M.T(0.13 * s, 0.5 + bob, 0), M.Rx(w * s), M.T(0, -0.25, 0), M.S(0.17, 0.5, 0.2)), cloth);
    const body = M.chain(root, M.T(0, 0.86 + bob, 0), M.Rx(0.28));
    P(R.cube, M.chain(body, M.S(0.56, 0.62, 0.38)), skin);
    P(R.cube, M.chain(body, M.T(0, -0.12, 0.01), M.S(0.6, 0.3, 0.41)), cloth);
    const head = M.chain(root, M.T(0, 1.3 + bob, 0.12));
    P(R.sph, M.chain(head, M.S(0.46, 0.44, 0.46)), skin);
    for (const s of [-1, 1]) {
      P(R.cube, M.chain(head, M.T(0.27 * s, 0.04, 0), M.Rz(-0.35 * s), M.S(0.3, 0.07, 0.06)), skin);           // orelhas
      P(R.cube, M.chain(head, M.T(0.1 * s, 0.05, 0.21), M.S(0.08, 0.06, 0.04)), [1, 0.15, 0.1], 1);            // olhos
      if (ogre) P(R.cone, M.chain(head, M.T(0.15 * s, 0.17, 0), M.Rz(-0.4 * s), M.S(0.12, 0.34, 0.12)), [0.95, 0.9, 0.75]);   // chifres
    }
    P(R.cube, M.chain(root, M.T(-0.34, 1.0 + bob, 0), M.Rx(-w * 0.5), M.T(0, -0.22, 0), M.S(0.12, 0.5, 0.12)), skin);
    // braço com porrete: levanta no "windup" e desce no golpe
    let arm = -0.5 + Math.sin(time * 2 + e.phase) * 0.05;
    if (wind) arm = lerp(-0.5, -2.7, easeOut(Math.min(1, k)));
    else if (e.state === "recover") arm = lerp(-1.1, -0.5, Math.min(1, e.st / 0.5)) - (e.st < 0.12 ? 0.7 : 0);
    const sh = M.chain(root, M.T(0.34, 1.0 + bob, 0), M.Rx(arm));
    P(R.cube, M.chain(sh, M.T(0, -0.22, 0), M.S(0.13, 0.5, 0.13)), skin);
    const hand = M.chain(sh, M.T(0, -0.5, 0));
    const len = ogre ? 1.0 : 0.75;
    P(R.cyl, M.chain(hand, M.T(0, 0.1 - len, 0), M.S(0.1, len, 0.1)), [0.5, 0.32, 0.18]);
    P(R.sph, M.chain(hand, M.T(0, -len - 0.05, 0), M.S(0.34, 0.34, 0.34)), wind ? [1, 0.6, 0.2] : [0.45, 0.30, 0.2], wind ? 1 : 0);
  }

  Game.Models = { drawPlayer, drawEnemy, swordPoints, playerFrames };
})();
