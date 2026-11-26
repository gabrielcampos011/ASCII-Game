/*
 * game.js — as REGRAS do jogo (nenhum código de desenho aqui).
 *
 * Aqui vivem o herói, os inimigos, o combate, o dash, as ondas e a
 * câmera. update(estado, dt, entrada) avança o mundo "dt" segundos.
 * O desenho (render.js) só LÊ o estado que este arquivo modifica.
 *
 * Coordenadas: x e z são o chão, y é a altura. O herói "olha" na direção
 * (sin(yaw), cos(yaw)) — yaw é o ângulo de giro em volta do eixo Y.
 */
window.Game = window.Game || {};

(function () {
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

  const WAVES = 5;
  const ENEMY = {
    goblin: { name: "Goblin", hp: 36, speed: 4.0, range: 1.7, windup: 0.45, dmg: 10, r: 0.45, scale: 1.0, orb: 0.3 },
    ogre:   { name: "Dokkaebi", hp: 150, speed: 2.3, range: 2.9, windup: 0.95, dmg: 24, r: 0.95, scale: 1.9, orb: 0.85 },
  };

  let world = null;                     // dados do mundo (colliders etc.)

  // ---------- Utilidades ----------
  /** Empurra (x,z) para fora das árvores/pedras/pilares. */
  function collide(pos, r) {
    for (const c of world.colliders) {
      const dx = pos.x - c.x, dz = pos.z - c.z, rr = r + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr; }
    }
    const rad = Math.hypot(pos.x, pos.z);               // paredão de montanhas
    if (rad > 66) { pos.x *= 66 / rad; pos.z *= 66 / rad; }
  }

  function burst(s, x, y, z, n, o) {
    for (let i = 0; i < n && s.particles.length < 260; i++) {
      const a = rand(0, TAU), up = rand(o.up0 ?? 0.2, o.up1 ?? 1), sp = rand(0.3, 1) * (o.speed ?? 4);
      s.particles.push({
        x, y, z, vx: Math.cos(a) * sp, vy: up * (o.speed ?? 4), vz: Math.sin(a) * sp,
        life: rand(0.6, 1) * (o.life ?? 0.5), max: o.life ?? 0.5, size: (o.size ?? 0.12) * rand(0.7, 1.3),
        color: o.color ?? [1, 1, 1], em: o.em ?? 1, grav: o.grav ?? 9,
      });
    }
  }

  // ---------- Novo jogo ----------
  function newGame(w) {
    world = w;
    const s = {
      t: 0, hitstop: 0, over: null, wave: 0, kills: 0, waveTimer: 1.2, banner: { text: "", t: 0 },
      player: {
        x: 0, z: 0, y: 1, yaw: 1.96, vx: 0, vz: 0, speed01: 0, walk: 0, moveMag: 0,
        hp: 100, maxHp: 100, invuln: 0, flash: 0,
        dashT: 0, dashCd: 0, dashX: 0, dashZ: 1, ghostT: 0,
        attackT: -1, attackDir: 1, attackBuf: 0, twist: 0, combo: 0,
      },
      enemies: [], particles: [], orbs: [], ghosts: [], trail: [],
      cam: { yaw: 1.96, pitch: 0.32, dist: 5.0, x: 0, y: 3, z: -6, tx: 0, ty: 1.5, tz: 0, fov: 1.08, shake: 0, aspect: 1.6 },
    };
    s.player.y = Game.World.height(0, 0);
    return s;
  }

  // ---------- Ondas ----------
  function spawnEnemy(s, type) {
    const p = s.player;
    for (let t = 0; t < 40; t++) {
      const a = rand(0, TAU), d = rand(20, 32), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const h = Game.World.height(x, z);
      if (h < 0.7 || h > 6 || Math.hypot(x, z) > 62) continue;
      const def = ENEMY[type];
      s.enemies.push({
        type, x, z, y: h, yaw: 0, hp: def.hp, maxHp: def.hp, state: "chase", st: 0, atkCd: rand(0.3, 1.2),
        kx: 0, kz: 0, flash: 0, age: 0, dying: false, dieT: 0, phase: rand(0, TAU), id: Math.random(), walk: 0, swing: 0,
      });
      burst(s, x, h, z, 10, { color: [0.8, 0.3, 1], speed: 3, life: 0.6, size: 0.15 });
      return;
    }
  }
  function startWave(s) {
    s.wave++;
    const n = 3 + s.wave * 2, ogres = Math.max(0, s.wave - 2) + (s.wave === WAVES ? 1 : 0);
    for (let i = 0; i < n; i++) spawnEnemy(s, "goblin");
    for (let i = 0; i < ogres; i++) spawnEnemy(s, "ogre");
    s.banner = { text: s.wave === WAVES ? "ONDA FINAL" : "ONDA " + s.wave, t: 2.4 };
  }

  // ---------- Dano ----------
  function hurtPlayer(s, dmg, fx, fz) {
    const p = s.player;
    if (p.invuln > 0 || p.dashT > 0 || s.over) return false;
    p.hp -= dmg; p.invuln = 0.6; p.flash = 0.25;
    const d = Math.hypot(p.x - fx, p.z - fz) || 1;
    p.vx = ((p.x - fx) / d) * 8; p.vz = ((p.z - fz) / d) * 8;
    s.cam.shake = 0.5; s.hitstop = 0.07;
    burst(s, p.x, p.y + 1.2, p.z, 14, { color: [1, 0.3, 0.3], speed: 5, life: 0.5 });
    if (p.hp <= 0) { p.hp = 0; s.over = "lose"; s.overT = 1.2; }
    return true;
  }

  function damageEnemy(s, e, dmg, crit) {
    const p = s.player;
    e.hp -= dmg; e.flash = 0.14;
    const d = Math.hypot(e.x - p.x, e.z - p.z) || 1, kb = e.type === "ogre" ? 2.5 : 7;
    e.kx = ((e.x - p.x) / d) * kb; e.kz = ((e.z - p.z) / d) * kb;
    if (e.state === "windup" && e.type === "goblin") { e.state = "recover"; e.st = 0; }      // golpe interrompe goblin
    s.hitstop = crit ? 0.1 : 0.055; s.cam.shake = Math.max(s.cam.shake, crit ? 0.45 : 0.22);
    burst(s, e.x, e.y + 0.9, e.z, crit ? 18 : 10, { color: crit ? [1, 0.9, 0.4] : [1, 1, 1], speed: 6, life: 0.4 });
    if (e.hp <= 0 && !e.dying) { e.dying = true; e.dieT = 0; s.kills++; }
  }

  // ---------- Jogador ----------
  function updatePlayer(s, dt, inp) {
    const p = s.player, cam = s.cam, H = Game.World.height;
    p.invuln = Math.max(0, p.invuln - dt); p.dashCd = Math.max(0, p.dashCd - dt); p.flash = Math.max(0, p.flash - dt);
    p.attackBuf = Math.max(0, p.attackBuf - dt);

    // Direção desejada, relativa à câmera (f = para onde a câmera olha, r = direita)
    const f = [Math.sin(cam.yaw), Math.cos(cam.yaw)], r = [-f[1], f[0]];
    let mx = inp.mx * r[0] + inp.my * f[0], mz = inp.mx * r[1] + inp.my * f[1];
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    p.moveMag = Math.min(1, mag);

    // Dash
    if (inp.dash && p.dashCd <= 0 && p.dashT <= 0) {
      const dx = mag > 0.15 ? mx / Math.max(mag, 1) : Math.sin(p.yaw), dz = mag > 0.15 ? mz / Math.max(mag, 1) : Math.cos(p.yaw);
      const l = Math.hypot(dx, dz) || 1;
      p.dashX = dx / l; p.dashZ = dz / l; p.dashT = 0.2; p.dashCd = 0.85; p.invuln = Math.max(p.invuln, 0.28);
      p.attackT = -1; p.yaw = Math.atan2(p.dashX, p.dashZ);
      burst(s, p.x, p.y + 0.1, p.z, 16, { color: [0.6, 0.9, 1], speed: 3.5, life: 0.45, size: 0.14, up0: 0.1, up1: 0.5 });
    }
    // Ataque (com um pequeno "buffer": o toque vale por 0,25s)
    if (inp.attack) p.attackBuf = 0.25;
    if (p.attackBuf > 0 && p.attackT < 0 && p.dashT <= 0) {
      p.attackT = 0; p.attackDir = -p.attackDir; p.attackBuf = 0; p.hit = new Set(); p.combo++;
      // auto-mira: vira para o inimigo mais próximo à frente
      let best = null, bd = 6.5;
      for (const e of s.enemies) {
        if (e.dying) continue;
        const d = Math.hypot(e.x - p.x, e.z - p.z);
        if (d < bd && Math.abs(angDiff(p.yaw, Math.atan2(e.x - p.x, e.z - p.z))) < 1.9) { bd = d; best = e; }
      }
      if (best) p.yaw = Math.atan2(best.x - p.x, best.z - p.z);
      else if (mag > 0.15) p.yaw = Math.atan2(mx, mz);
    }

    let tvx = 0, tvz = 0;
    if (p.dashT > 0) {                                     // --- dash ---
      p.dashT -= dt; tvx = p.dashX * 23; tvz = p.dashZ * 23;
      p.vx = tvx; p.vz = tvz;
      p.ghostT -= dt;
      if (p.ghostT <= 0) { p.ghostT = 0.035; s.ghosts.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, walk: p.walk, life: 0.28, max: 0.28 }); }
    } else if (p.attackT >= 0) {                           // --- ataque ---
      p.attackT += dt / 0.44;
      const lunge = p.attackT < 0.45 ? 5.5 : 0.6;
      tvx = Math.sin(p.yaw) * lunge; tvz = Math.cos(p.yaw) * lunge;
      p.vx = lerp(p.vx, tvx, Math.min(1, dt * 18)); p.vz = lerp(p.vz, tvz, Math.min(1, dt * 18));
      // janela de acerto
      if (p.attackT > 0.3 && p.attackT < 0.58) {
        for (const e of s.enemies) {
          if (e.dying || p.hit.has(e)) continue;
          const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
          if (d < 3.3 + ENEMY[e.type].r) {
            if (Math.abs(angDiff(p.yaw + p.attackDir * 0.1, Math.atan2(dx, dz))) < 1.35) {
              p.hit.add(e);
              const crit = Math.random() < 0.15;
              damageEnemy(s, e, Math.round(rand(17, 25) * (crit ? 2 : 1)), crit);
            }
          }
        }
      }
      if (p.attackT >= 1) { p.attackT = -1; p.twist = 0; }
    } else {                                               // --- andar ---
      const inWater = H(p.x, p.z) < -0.05;
      const sp = 6.4 * (inWater ? 0.6 : 1);
      tvx = mx * sp; tvz = mz * sp;
      const k = Math.min(1, dt * (mag > 0.05 ? 14 : 10));
      p.vx = lerp(p.vx, tvx, k); p.vz = lerp(p.vz, tvz, k);
      if (mag > 0.12) {
        const want = Math.atan2(mx, mz);
        p.yaw += clamp(angDiff(p.yaw, want), -16 * dt, 16 * dt);
      }
    }
    const spd = Math.hypot(p.vx, p.vz);
    p.speed01 = clamp(spd / 6.4, 0, 1.4);
    p.walk += dt * (4 + spd * 1.15);

    // Mover (sem entrar em água funda) e colidir
    const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt, pos = { x: p.x, z: p.z };
    if (H(nx, nz) > -0.45) { pos.x = nx; pos.z = nz; }
    else if (H(nx, p.z) > -0.45) pos.x = nx;
    else if (H(p.x, nz) > -0.45) pos.z = nz;
    collide(pos, 0.45);
    p.x = pos.x; p.z = pos.z;
    const gh = H(p.x, p.z);
    p.y = lerp(p.y, Math.max(gh, -0.3), Math.min(1, dt * 20));
    if (gh < -0.05 && spd > 1.5 && Math.random() < dt * 14) {                  // respingos na água
      burst(s, p.x, 0, p.z, 3, { color: [0.7, 0.9, 1], speed: 2, life: 0.4, size: 0.1 });
    }

    // Rastro da espada (guarda a base e a ponta da lâmina durante o golpe)
    if (p.attackT >= 0.12 && p.attackT <= 0.7) {
      const sp = Game.Models.swordPoints(p);
      s.trail.push({ b: sp[0], t: sp[1], life: 0.22, max: 0.22, at: s.t });
    }
  }

  // ---------- Inimigos ----------
  function updateEnemies(s, dt) {
    const p = s.player, H = Game.World.height;
    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i], def = ENEMY[e.type];
      e.age += dt; e.flash = Math.max(0, e.flash - dt);
      if (e.dying) {
        e.dieT += dt;
        if (e.dieT > 0.45) {
          burst(s, e.x, e.y + 0.8 * def.scale, e.z, e.type === "ogre" ? 36 : 18, { color: [1, 0.7, 0.3], speed: 6, life: 0.7, size: 0.16 });
          if (Math.random() < def.orb) s.orbs.push({ x: e.x, z: e.z, t: 0 });
          s.enemies.splice(i, 1);
        }
        continue;
      }
      if (e.age < 0.8) { e.y = H(e.x, e.z); continue; }                        // surgindo do chão

      const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz) || 1, want = Math.atan2(dx, dz);
      e.atkCd -= dt;
      // empurrão do golpe
      e.x += e.kx * dt; e.z += e.kz * dt; e.kx *= Math.exp(-dt * 8); e.kz *= Math.exp(-dt * 8);

      if (e.state === "chase") {
        e.yaw += clamp(angDiff(e.yaw, want), -7 * dt, 7 * dt);
        if (dist > def.range * 0.8) {
          let mx = dx / dist, mz = dz / dist;
          if (e.type === "goblin") { const sw = Math.sin(s.t * 1.8 + e.phase) * 0.45; const t = mx; mx += -mz * sw; mz += t * sw; }
          const l = Math.hypot(mx, mz) || 1;
          e.x += (mx / l) * def.speed * dt; e.z += (mz / l) * def.speed * dt; e.walk += dt * def.speed * 1.6;
        }
        if (dist < def.range && e.atkCd <= 0) { e.state = "windup"; e.st = 0; }
      } else if (e.state === "windup") {
        e.st += dt; e.yaw += clamp(angDiff(e.yaw, want), -2.5 * dt, 2.5 * dt);
        if (e.st >= def.windup) {
          e.state = "recover"; e.st = 0;
          const reach = def.range + (e.type === "ogre" ? 0.4 : 0.5);
          if (Math.hypot(p.x - e.x, p.z - e.z) < reach) hurtPlayer(s, def.dmg, e.x, e.z);
          if (e.type === "ogre") {
            s.cam.shake = Math.max(s.cam.shake, 0.4);
            burst(s, e.x + Math.sin(e.yaw) * 2, e.y + 0.1, e.z + Math.cos(e.yaw) * 2, 22, { color: [1, 0.6, 0.2], speed: 5, life: 0.5, up0: 0.1, up1: 0.6 });
          }
        }
      } else if (e.state === "recover") {
        e.st += dt;
        if (e.st > (e.type === "ogre" ? 0.9 : 0.55)) { e.state = "chase"; e.atkCd = e.type === "ogre" ? rand(0.8, 1.6) : rand(0.4, 1.0); }
      }

      // separação entre inimigos e contra o jogador
      for (const o of s.enemies) {
        if (o === e || o.dying) continue;
        const ox = e.x - o.x, oz = e.z - o.z, rr = def.r + ENEMY[o.type].r, d2 = ox * ox + oz * oz;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), push = (rr - d) * 0.5; e.x += (ox / d) * push; e.z += (oz / d) * push; }
      }
      const pr = def.r + 0.4, px = e.x - p.x, pz = e.z - p.z, pd = Math.hypot(px, pz);
      if (pd < pr && pd > 1e-6) { e.x = p.x + (px / pd) * pr; e.z = p.z + (pz / pd) * pr; }
      const pos = { x: e.x, z: e.z }; collide(pos, def.r); e.x = pos.x; e.z = pos.z;
      e.y = Math.max(H(e.x, e.z), -0.3);
    }
  }

  // ---------- Partículas, orbes, rastros ----------
  function updateFx(s, dt) {
    const p = s.player;
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const q = s.particles[i];
      q.life -= dt; if (q.life <= 0) { s.particles.splice(i, 1); continue; }
      q.vy -= q.grav * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      const g = Game.World.height(q.x, q.z); if (q.y < Math.max(g, 0) && q.vy < 0) { q.y = Math.max(g, 0); q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
    }
    for (let i = s.ghosts.length - 1; i >= 0; i--) { s.ghosts[i].life -= dt; if (s.ghosts[i].life <= 0) s.ghosts.splice(i, 1); }
    for (let i = s.trail.length - 1; i >= 0; i--) { s.trail[i].life -= dt; if (s.trail[i].life <= 0) s.trail.splice(i, 1); }
    for (let i = s.orbs.length - 1; i >= 0; i--) {
      const o = s.orbs[i]; o.t += dt;
      if (Math.hypot(o.x - p.x, o.z - p.z) < 1.3) {
        p.hp = Math.min(p.maxHp, p.hp + 15);
        burst(s, o.x, Game.World.height(o.x, o.z) + 0.6, o.z, 14, { color: [0.4, 1, 0.5], speed: 3, life: 0.5 });
        s.orbs.splice(i, 1);
      }
    }
  }

  // ---------- Câmera ----------
  function updateCamera(s, dt, inp) {
    const c = s.cam, p = s.player;
    c.yaw += inp.camDX * 0.0034 + inp.rot * dt * 1.9;
    c.pitch = clamp(c.pitch + inp.camDY * 0.0030, 0.12, 0.95);
    const portrait = c.aspect < 1;
    const wantDist = (portrait ? 8.4 : 5.0) + (p.dashT > 0 ? 1.2 : 0);
    c.dist = lerp(c.dist, wantDist, Math.min(1, dt * 6));
    c.fov = lerp(c.fov, (portrait ? 0.98 : 1.0) + (p.dashT > 0 ? 0.16 : 0), Math.min(1, dt * 10));
    const k = 1 - Math.exp(-dt * 11);
    c.tx = lerp(c.tx, p.x, k); c.ty = lerp(c.ty, p.y + 1.35, k); c.tz = lerp(c.tz, p.z, k);
    const f = [Math.sin(c.yaw), Math.cos(c.yaw)], cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    c.x = c.tx - f[0] * cp * c.dist; c.z = c.tz - f[1] * cp * c.dist; c.y = c.ty + sp * c.dist;
    c.y = Math.max(c.y, Game.World.height(c.x, c.z) + 0.8);
    c.shake = Math.max(0, c.shake - dt * 2.2);
    if (c.shake > 0) { const a = c.shake * 0.28; c.x += rand(-a, a); c.y += rand(-a, a); c.z += rand(-a, a); }
  }

  // ---------- Passo principal ----------
  function update(s, dt, inp) {
    if (s.hitstop > 0) { s.hitstop -= dt; dt *= 0.04; }       // "hit-stop": o tempo quase para no impacto
    s.t += dt;
    if (!s.over) {
      updatePlayer(s, dt, inp);
      updateEnemies(s, dt);
      // ondas
      const alive = s.enemies.some((e) => !e.dying);
      if (!alive && s.wave > 0) { if (s.waveTimer <= 0) s.waveTimer = 3.2; }
      if (!alive) {
        s.waveTimer -= dt;
        if (s.waveTimer <= 0) { if (s.wave >= WAVES) { s.over = "win"; s.overT = 1.2; } else startWave(s); }
      }
    } else { s.overT -= dt; updateEnemies(s, dt * 0.2); }
    updateFx(s, dt);
    if (s.banner.t > 0) s.banner.t -= dt;
    updateCamera(s, dt, inp);
  }

  Game.Logic = { newGame, update, ENEMY, WAVES, angDiff };
})();
