/*
 * models.js — o corpo do herói e dos inimigos, montado como um ESQUELETO de peças.
 *
 * Cada membro tem DUAS partes ligadas por uma articulação:
 *     quadril -> coxa -> joelho -> canela -> tornozelo -> pé
 *     ombro   -> braço -> cotovelo -> antebraço -> mão
 * Cada peça tem uma matriz RELATIVA à peça-pai: girar o quadril leva a perna toda; dobrar o joelho
 * leva só a canela e o pé. É a "animação hierárquica" de qualquer jogo 3D.
 *
 * Ideia física importante: a ALTURA DO QUADRIL não é fixa: é calculada pelas pernas (a que está mais
 * esticada toca o chão). Assim, ao dobrar os joelhos o corpo desce, e os pés não flutuam nem afundam.
 *
 * part(malha, matriz, cor, brilho) desenha uma peça; quem decide como (sombra/reflexo/cena) é o render.js.
 */
window.Game = window.Game || {};

(function () {
  const M = Game.M;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (k) => 1 - (1 - k) * (1 - k);
  const easeIO = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  const C = {
    skin: [0.93, 0.78, 0.64], hair: [0.22, 0.16, 0.14], tunic: [0.92, 0.86, 0.74], armor: [1.0, 0.97, 0.9],
    pants: [0.34, 0.30, 0.28], boot: [0.30, 0.20, 0.14], leather: [0.34, 0.23, 0.15], glove: [0.26, 0.19, 0.14],
    cloak: [0.92, 0.30, 0.24], cloak2: [0.70, 0.18, 0.18], belt: [0.35, 0.95, 1.0], halo: [1, 1, 1],
    blade: [0.88, 0.96, 1.0], gold: [0.85, 0.65, 0.22],
  };

  // medidas do herói (metros)
  const L1 = 0.44, L2 = 0.44, ANKLE = 0.09, AU = 0.30, AF = 0.28;
  /** Altura vertical que uma perna alcança com esses ângulos (quadril e joelho). */
  const legReach = (hip, knee) => L1 * Math.cos(hip) + L2 * Math.cos(hip + knee);

  /** Ângulos do braço da espada para o golpe t (0..1). dir = lado do golpe (+1/-1). */
  function swing(t, dir) {
    const s0 = 1.55 * dir;
    if (t < 0.28) { const k = easeOut(t / 0.28); return { psi: lerp(0, s0, k), pitch: lerp(-0.9, -2.0, k) }; }
    if (t < 0.56) { const k = easeIO((t - 0.28) / 0.28); return { psi: lerp(s0, -s0 * 1.1, k), pitch: lerp(-2.0, -1.3, k) }; }
    const k = easeOut(Math.min(1, (t - 0.56) / 0.44));
    return { psi: lerp(-s0 * 1.1, 0, k), pitch: lerp(-1.3, -0.9, k) };
  }

  /** Calcula a POSE do herói (todos os ângulos) e as matrizes principais. */
  function pose(p, t) {
    const sp = Math.min(1, p.speed01 || 0), ph = p.walk || 0;
    const atk = p.attackT >= 0, dash = p.dashT > 0;
    const a = atk ? Math.sin(Math.min(1, p.attackT) * Math.PI) : 0;               // 0 -> 1 -> 0 durante o golpe

    // --- pernas: cada uma tem ângulo do quadril (hip) e do joelho (knee) ---
    const legs = [-1, 1].map((s) => {
      const th = ph + (s > 0 ? 0 : Math.PI), f = Math.sin(th);
      let hip = -0.72 * sp * f, knee = 0.06 + 1.0 * sp * Math.max(0, Math.cos(th));   // joelho dobra quando a perna vem para frente
      if (atk) { const front = s === (p.attackDir > 0 ? 1 : -1); hip = lerp(hip, front ? -0.62 : 0.5, a); knee = lerp(knee, front ? 0.75 : 0.28, a); }
      if (dash) { hip = s > 0 ? -0.95 : 0.9; knee = s > 0 ? 0.9 : 0.15; }
      return { s, hip, knee };
    });
    const pelvis = Math.max(legReach(legs[0].hip, legs[0].knee), legReach(legs[1].hip, legs[1].knee)) + ANKLE;

    // --- tronco e braços ---
    const lean = 0.07 + 0.22 * sp + (dash ? 0.55 : 0) + 0.2 * a;                  // inclina para frente ao correr/atacar
    const twist = Math.sin(ph) * 0.16 * sp;                                       // ombros giram contra o quadril
    const breath = Math.sin((t || 0) * 2.1) * 0.012 * (1 - sp);
    let psi = 0, pitchR = -0.9 + Math.sin(ph) * 0.1 * sp, elbowR = 0.5 + 0.25 * sp;
    if (atk) { const w = swing(p.attackT, p.attackDir); psi = w.psi; pitchR = w.pitch; elbowR = 0.22; p.twist = psi * 0.28; }
    const pitchL = dash ? 0.9 : -0.12 - 0.7 * sp * Math.sin(ph), elbowL = dash ? 0.3 : 0.25 + 0.7 * sp;

    const root = M.chain(M.T(p.x, p.y, p.z), M.Ry(p.yaw + (atk ? p.twist : 0)));
    const hipsF = M.chain(root, M.T(0, pelvis, 0));
    const U = M.chain(hipsF, M.Ry(twist), M.Rx(lean));                            // frame do tronco (começa no quadril)
    const shoulderR = M.chain(U, M.T(0.215, 0.55 + breath, 0), M.Ry(psi), M.Rx(pitchR));
    const elbowRF = M.chain(shoulderR, M.T(0, -AU, 0), M.Rx(-elbowR));
    const hand = M.chain(elbowRF, M.T(0, -AF - 0.03, 0));
    return { sp, ph, lean, breath, legs, pelvis, root, hipsF, U, shoulderR, elbowRF, hand, pitchL, elbowL };
  }

  /** Base e ponta da espada no mundo (para o rastro e o acerto). */
  function swordPoints(p) {
    const f = pose(p, 0);
    return [M.point(f.hand, [0, -0.2, 0]), M.point(f.hand, [0, -1.58, 0])];
  }

  /** Desenha o herói. "ghost" = {color, em}: imagens-fantasma do dash (versão simplificada). */
  function drawPlayer(part, p, time, ghost) {
    const R = Game.Renderer.meshes, f = pose(p, time), { U, hipsF, root, sp } = f;
    const hurt = p.flash > 0 && ((p.flash * 28) | 0) % 2 === 0;
    const P = (mesh, mat, col, em) => part(mesh, mat, ghost ? ghost.color : hurt ? [1, 0.35, 0.3] : col, ghost ? ghost.em : hurt ? 0.6 : em || 0);
    const lod = !!ghost;                                                          // fantasmas: sem detalhes pequenos

    // ---------- pernas ----------
    for (const lg of f.legs) {
      const hipJ = M.chain(hipsF, M.T(0.115 * lg.s, -0.02, 0), M.Rx(lg.hip));
      P(R.tap, M.chain(hipJ, M.T(0, -L1, 0), M.S(0.17, L1, 0.18)), C.pants);                  // coxa
      const kneeJ = M.chain(hipJ, M.T(0, -L1, 0), M.Rx(lg.knee));
      if (!lod) P(R.sph, M.chain(kneeJ, M.S(0.14, 0.14, 0.14)), C.pants);                     // joelho
      P(R.tap, M.chain(kneeJ, M.T(0, -L2, 0), M.S(0.135, L2, 0.14)), C.pants);                // canela
      P(R.tap, M.chain(kneeJ, M.T(0, -L2, 0), M.S(0.14, 0.24, 0.15)), C.boot);                // cano da bota
      const ankle = M.chain(kneeJ, M.T(0, -L2, 0), M.Rx(-(lg.hip + lg.knee) * 0.8));
      P(R.cube, M.chain(ankle, M.T(0, -0.045, 0.075), M.S(0.125, 0.09, 0.3)), C.boot);        // pé
    }
    // ---------- tronco ----------
    P(R.cube, M.chain(hipsF, M.T(0, 0.02, 0), M.S(0.35, 0.17, 0.21)), C.leather);             // quadril
    P(R.cube, M.chain(U, M.T(0, 0.095, 0), M.S(0.37, 0.05, 0.225)), C.belt, 1);               // cinto brilhante
    if (!lod) P(R.cube, M.chain(U, M.T(0.19, 0.04, 0.02), M.S(0.07, 0.1, 0.07)), C.leather);  // bolsinha no cinto
    P(R.tap, M.chain(U, M.T(0, 0.06, 0), M.S(0.22, 0.2, 0.16)), C.tunic);                     // barriga
    P(R.tapT, M.chain(U, M.T(0, 0.26 + f.breath, 0), M.S(0.27, 0.32, 0.18)), C.tunic);        // peito (ombros mais largos que a cintura)
    if (!lod) P(R.cube, M.chain(U, M.T(0, 0.44, 0.095), M.S(0.3, 0.2, 0.04)), C.armor);       // peitoral
    P(R.cyl, M.chain(U, M.T(0, 0.56, 0.01), M.S(0.085, 0.12, 0.085)), C.skin);                // pescoço

    // ---------- capa em 3 pedaços: cada um balança um pouco depois do anterior ----------
    const ca = p.cloakA ?? 0.15;                                                  // ângulo da capa (física de mola, game.js)
    let cf = M.chain(U, M.T(0, 0.55, -0.13), M.Rx(0.06 + ca * 0.5));
    const widths = [0.34, 0.39, 0.44, 0.5], SEG = 0.31;
    for (let i = 0; i < (lod ? 2 : 4); i++) {
      const c2 = i % 2 ? C.cloak2 : C.cloak;
      P(R.cyl, M.chain(cf, M.T(0, -SEG - 0.01, 0), M.S(widths[i], SEG + 0.02, 0.1)), c2);   // elíptico: o sombreado curva como tecido
      cf = M.chain(cf, M.T(0, -SEG, 0), M.Rx(ca * 0.3 + Math.sin(time * 2.4 + i * 0.9 + f.ph * 0.5) * 0.07 * (0.4 + sp)));
    }
    P(R.sph, M.chain(U, M.T(0, 0.585, -0.035), M.S(0.34, 0.12, 0.27)), C.cloak);              // gola

    // ---------- cabeça ----------
    const H = M.chain(U, M.T(0, 0.76, 0.015), M.Rx(-f.lean * 0.6));
    P(R.sph, M.chain(H, M.S(0.19, 0.235, 0.21)), C.skin);
    P(R.sph, M.chain(H, M.T(0, 0.05, -0.03), M.S(0.215, 0.2, 0.235)), C.hair);                // cabelo
    if (!lod) {
      P(R.cube, M.chain(H, M.T(0, -0.01, 0.105), M.S(0.03, 0.05, 0.04)), C.skin);             // nariz
      for (const s of [-1, 1]) P(R.cube, M.chain(H, M.T(0.05 * s, 0.03, 0.093), M.S(0.03, 0.02, 0.02)), C.hair);   // olhos
      const hairA = 0.35 + ca * 0.7;                                              // rabo de cavalo com a mesma mola da capa
      const h1 = M.chain(H, M.T(0, 0.05, -0.11), M.Rx(hairA));
      P(R.tap, M.chain(h1, M.T(0, -0.18, 0), M.S(0.07, 0.18, 0.07)), C.hair);
      const h2 = M.chain(h1, M.T(0, -0.18, 0), M.Rx(0.3 + Math.sin(time * 3 + f.ph) * 0.12 * (0.3 + sp)));
      P(R.tap, M.chain(h2, M.T(0, -0.17, 0), M.S(0.05, 0.17, 0.05)), C.hair);
    }
    P(R.torus, M.chain(H, M.T(0, 0.3, -0.02), M.Rx(0.35), M.Ry(time * 1.4), M.S(0.78, 1.1, 0.78)), C.halo, 1);   // aureola

    // ---------- ombros e armadura ----------
    for (const s of [-1, 1]) {
      P(R.sph, M.chain(U, M.T(0.215 * s, 0.55 + f.breath, 0), M.S(0.12, 0.12, 0.12)), C.tunic);
      if (!lod) P(R.sph, M.chain(U, M.T(0.235 * s, 0.585 + f.breath, 0), M.Rz(-0.25 * s), M.S(0.2, 0.1, 0.19)), C.armor);   // ombreira
    }

    // ---------- braço esquerdo ----------
    const shL = M.chain(U, M.T(-0.215, 0.55 + f.breath, 0), M.Rx(f.pitchL), M.Rz(0.06));
    P(R.tap, M.chain(shL, M.T(0, -AU, 0), M.S(0.095, AU, 0.095)), C.tunic);
    const elL = M.chain(shL, M.T(0, -AU, 0), M.Rx(-f.elbowL));
    if (!lod) P(R.sph, M.chain(elL, M.S(0.1, 0.1, 0.1)), C.tunic);
    P(R.tap, M.chain(elL, M.T(0, -AF, 0), M.S(0.08, AF, 0.08)), C.armor);                       // braçadeira
    if (!lod) P(R.sph, M.chain(elL, M.T(0, -AF - 0.025, 0), M.S(0.1, 0.11, 0.1)), C.glove);     // mão
    // ---------- braço direito + espada ----------
    P(R.tap, M.chain(f.shoulderR, M.T(0, -AU, 0), M.S(0.095, AU, 0.095)), C.tunic);
    if (!lod) P(R.sph, M.chain(f.elbowRF, M.S(0.1, 0.1, 0.1)), C.tunic);
    P(R.tap, M.chain(f.elbowRF, M.T(0, -AF, 0), M.S(0.08, AF, 0.08)), C.armor);
    if (!lod) P(R.sph, M.chain(f.hand, M.T(0, 0.005, 0), M.S(0.105, 0.115, 0.105)), C.glove);
    const sw = f.hand;
    if (!lod) { P(R.sph, M.chain(sw, M.T(0, 0.075, 0), M.S(0.06, 0.06, 0.06)), C.gold); P(R.cyl, M.chain(sw, M.T(0, -0.17, 0), M.S(0.045, 0.22, 0.045)), C.leather); }
    P(R.cube, M.chain(sw, M.T(0, -0.19, 0), M.S(0.24, 0.04, 0.06)), C.gold);                    // guarda
    P(R.cube, M.chain(sw, M.T(0, -0.805, 0), M.S(0.065, 1.23, 0.024)), C.blade, ghost ? 0 : 0.55);   // lâmina
    P(R.cone, M.chain(sw, M.T(0, -1.42, 0), M.Rx(Math.PI), M.S(0.065, 0.16, 0.024)), C.blade, ghost ? 0 : 0.55);   // ponta
  }

  /** Desenha um inimigo (goblin curvado e pequeno, ou o Dokkaebi grande de chifres). */
  function drawEnemy(part, e, time) {
    const R = Game.Renderer.meshes, ogre = e.type === "ogre", def = Game.Logic.ENEMY[e.type], sc = def.scale;
    const grow = Math.min(1, e.age / 0.8), die = e.dying ? Math.max(0, 1 - e.dieT / 0.45) : 1;
    const skin = ogre ? [0.80, 0.22, 0.28] : [0.40, 0.72, 0.28], cloth = ogre ? [0.25, 0.22, 0.55] : [0.55, 0.34, 0.18];
    const flash = e.flash > 0, wind = e.state === "windup", k = wind ? e.st / def.windup : 0;
    const P = (mesh, mat, col, em) => part(mesh, mat, flash ? [1, 1, 1] : wind ? [col[0] * 0.5 + 0.6, col[1] * 0.6, col[2] * 0.5] : col, flash ? 0.8 : em || 0);
    const mv = Math.min(1, e.mv || 0), ph = e.walk;
    const l1 = 0.26, l2 = 0.26, ank = 0.06;
    const reach = (hip, kn) => l1 * Math.cos(hip) + l2 * Math.cos(hip + kn);

    // pernas (andar curvado: passos mais curtos)
    const legs = [-1, 1].map((s) => { const th = ph + (s > 0 ? 0 : Math.PI); return { s, hip: -0.6 * mv * Math.sin(th), knee: 0.18 + 0.8 * mv * Math.max(0, Math.cos(th)) }; });
    const pel = Math.max(reach(legs[0].hip, legs[0].knee), reach(legs[1].hip, legs[1].knee)) + ank;
    const root = M.chain(M.T(e.x, e.y - (1 - grow) * 1.6 * sc, e.z), M.Ry(e.yaw), M.S(sc * grow, sc * grow * die, sc * grow));
    const hips = M.chain(root, M.T(0, pel, 0));
    const hunch = 0.5 + (wind ? -0.25 * k : 0);                                    // corcunda: se endireita ao levantar o porrete
    const U = M.chain(hips, M.Rx(hunch));

    for (const lg of legs) {
      const hj = M.chain(hips, M.T(0.1 * lg.s, -0.02, 0), M.Rx(lg.hip));
      P(R.tap, M.chain(hj, M.T(0, -l1, 0), M.S(0.14, l1, 0.15)), cloth);
      const kj = M.chain(hj, M.T(0, -l1, 0), M.Rx(lg.knee));
      P(R.sph, M.chain(kj, M.S(0.12, 0.12, 0.12)), cloth);
      P(R.tap, M.chain(kj, M.T(0, -l2, 0), M.S(0.11, l2, 0.12)), skin);
      P(R.cube, M.chain(kj, M.T(0, -l2, 0), M.Rx(-(lg.hip + lg.knee) * 0.8), M.T(0, -0.035, 0.06), M.S(0.11, 0.07, 0.24)), skin);
    }
    P(R.tap, M.chain(U, M.T(0, 0, 0), M.S(0.28, 0.3, 0.22)), cloth);                // barriga/tanga
    P(R.tapT, M.chain(U, M.T(0, 0.28, 0), M.S(0.26, 0.3, 0.2)), skin);              // peito largo
    if (ogre) P(R.sph, M.chain(U, M.T(0, 0.17, 0.1), M.S(0.38, 0.32, 0.26)), skin); // barriga grande
    // cabeça
    const Hh = M.chain(U, M.T(0, 0.66, 0.05), M.Rx(-hunch * 0.8));
    P(R.sph, M.chain(Hh, M.S(0.34, 0.31, 0.34)), skin);
    P(R.cube, M.chain(Hh, M.T(0, -0.1, 0.1), M.S(0.2, 0.1, 0.14)), skin);           // queixo/mandíbula
    P(R.cone, M.chain(Hh, M.T(0, -0.02, 0.17), M.Rx(Math.PI / 2), M.S(0.06, 0.11, 0.06)), skin);   // nariz pontudo
    for (const s of [-1, 1]) {
      P(R.cube, M.chain(Hh, M.T(0.2 * s, 0.03, 0), M.Rz(-0.4 * s), M.S(0.24, 0.05, 0.07)), skin);   // orelhas
      P(R.cube, M.chain(Hh, M.T(0.08 * s, 0.05, 0.15), M.S(0.07, 0.05, 0.03)), [1, 0.15, 0.1], 1);  // olhos
      if (ogre) {
        P(R.cone, M.chain(Hh, M.T(0.12 * s, 0.13, 0), M.Rz(-0.4 * s), M.S(0.1, 0.3, 0.1)), [0.95, 0.9, 0.75]);       // chifres
        P(R.cone, M.chain(Hh, M.T(0.07 * s, -0.12, 0.12), M.Rx(Math.PI * 0.85), M.S(0.04, 0.1, 0.04)), [0.95, 0.9, 0.75]); // presas
      }
    }
    // braço esquerdo (balança ao andar)
    const aw = Math.sin(ph) * 0.7 * mv;
    const shL = M.chain(U, M.T(-0.27, 0.52, 0), M.Rx(-0.2 - aw));
    P(R.tap, M.chain(shL, M.T(0, -0.26, 0), M.S(0.1, 0.26, 0.1)), skin);
    const elL = M.chain(shL, M.T(0, -0.26, 0), M.Rx(-0.5));
    P(R.tap, M.chain(elL, M.T(0, -0.25, 0), M.S(0.085, 0.25, 0.085)), skin);
    // braço direito com porrete: levanta no "windup" e desce no golpe
    let arm = -0.5 + Math.sin(time * 2 + e.phase) * 0.05;
    if (wind) arm = lerp(-0.5, -2.7, easeOut(Math.min(1, k)));
    else if (e.state === "recover") arm = lerp(-1.1, -0.5, Math.min(1, e.st / 0.5)) - (e.st < 0.12 ? 0.7 : 0);
    const sh = M.chain(U, M.T(0.27, 0.52, 0), M.Rx(arm));
    P(R.tap, M.chain(sh, M.T(0, -0.26, 0), M.S(0.1, 0.26, 0.1)), skin);
    const el = M.chain(sh, M.T(0, -0.26, 0), M.Rx(-(wind ? 0.2 : 0.5)));
    P(R.tap, M.chain(el, M.T(0, -0.25, 0), M.S(0.085, 0.25, 0.085)), skin);
    const hand = M.chain(el, M.T(0, -0.27, 0));
    const len = ogre ? 1.0 : 0.75;
    P(R.cyl, M.chain(hand, M.T(0, 0.1 - len, 0), M.S(0.1, len, 0.1)), [0.5, 0.32, 0.18]);
    P(R.sph, M.chain(hand, M.T(0, -len - 0.05, 0), M.S(0.34, 0.34, 0.34)), wind ? [1, 0.6, 0.2] : [0.45, 0.30, 0.2], wind ? 1 : 0);
  }

  Game.Models = { drawPlayer, drawEnemy, swordPoints, pose };
})();
