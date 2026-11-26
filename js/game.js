/*
 * game.js — as REGRAS do jogo (sem nada de HTML aqui).
 *
 * Este arquivo só mexe em dados: estado do jogador, monstros, itens,
 * combate, XP, diálogo. Quem mostra isso na tela é o render.js.
 * Separar "regras" de "desenho" deixa tudo mais fácil de entender e testar.
 *
 * O jogo é POR TURNOS: cada ação do jogador (andar, atacar, beber poção,
 * esperar) gasta 1 turno, e depois todos os monstros agem uma vez.
 */
(function () {
  const ID = Game.ID;
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Dados ----------
  const ENEMIES = {
    slime:    { name: "Gosma",     g: "S", fg: "#7dff6a", hp: 7,  atk: [1, 3],  xp: 5,   gold: [1, 3],    aggro: 5, slow: true },
    bat:      { name: "Morcego",   g: "v", fg: "#c79bff", hp: 6,  atk: [1, 3],  xp: 7,   gold: [1, 4],    aggro: 7, erratic: true },
    wolf:     { name: "Lobo",      g: "w", fg: "#e1e6f0", hp: 14, atk: [2, 5],  xp: 12,  gold: [2, 6],    aggro: 7 },
    skeleton: { name: "Esqueleto", g: "k", fg: "#fff3d0", hp: 20, atk: [3, 7],  xp: 20,  gold: [4, 10],   aggro: 6 },
    dragon:   { name: "Dragão de Cinzas", g: "D", fg: "#ff4b3a", hp: 90, atk: [6, 12], xp: 300, gold: [120, 120], aggro: 8, boss: true },
  };
  const POTION_HEAL = 20, POTION_PRICE = 15;
  const needXp = (lv) => 15 * lv;

  // ---------- Utilidades ----------
  function log(s, text, cls) {
    s.log.push({ text, cls: cls || "" });
    if (s.log.length > 40) s.log.shift();
    s.logVer++;
  }
  function fx(s, x, y, text, color) { s.fx.push({ x, y, text: String(text), color, t: now() }); }
  const inb = (s, x, y) => x >= 0 && y >= 0 && x < s.world.W && y < s.world.H;
  const tileAt = (s, x, y) => s.world.tiles[y * s.world.W + x];
  const enemyAt = (s, x, y) => s.enemies.find((e) => e.x === x && e.y === y);
  const npcAt = (s, x, y) => s.npcs.find((n) => n.x === x && n.y === y);
  const inSafe = (s, x, y) => { const r = s.world.safe; return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; };

  // ---------- Novo jogo ----------
  function newGame(seed) {
    seed = seed || ((Date.now() % 90000) + 1);
    const world = Game.World.generate(seed);
    const { W, H, tiles, dist } = world;
    const rnd = Game.mulberry32(seed ^ 0x9e3779b9);

    const s = {
      world, seed,
      player: { x: world.start.x, y: world.start.y, hp: 30, maxHp: 30, lv: 1, xp: 0, gold: 0, potions: 2, flash: 0 },
      enemies: [], items: [], fx: [], log: [], logVer: 0,
      npcs: [
        { type: "elder",    name: "Ancião",   g: "&", fg: "#7fe3ff", x: world.elder.x,    y: world.elder.y },
        { type: "merchant", name: "Mercador", g: "$", fg: "#ffd24a", x: world.merchant.x, y: world.merchant.y },
      ],
      seen: new Uint8Array(W * H), vis: new Uint8Array(W * H), R: 9,
      quest: 0, turn: 0, kills: 0, over: null, dirty: true, hurtAt: 0,
    };

    // Células onde podemos colocar coisas: alcançáveis, longe da vila.
    const cells = [];
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i / W) | 0;
      if (dist[i] >= 8 && !inSafe(s, x, y) && tiles[i] !== ID.LAIR) cells.push(i);
    }
    for (let i = cells.length - 1; i > 0; i--) {      // embaralha (Fisher-Yates)
      const j = Math.floor(rnd() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    const spaced = (x, y, list, d) => list.every((o) => Math.abs(o.x - x) + Math.abs(o.y - y) >= d);
    const spawn = (type, x, y) => {
      const def = ENEMIES[type];
      s.enemies.push({ type, x, y, hp: def.hp, flash: 0 });
    };

    // Monstros: o tipo depende da distância até a vila (mais longe = mais forte).
    for (const i of cells) {
      if (s.enemies.length >= 46) break;
      const x = i % W, y = (i / W) | 0, d = dist[i];
      if (d < 12 || !spaced(x, y, s.enemies, 5)) continue;
      const r = rnd();
      let type;
      if (d < 28) type = r < 0.55 ? "slime" : "bat";
      else if (d < 50) type = r < 0.25 ? "slime" : r < 0.5 ? "bat" : "wolf";
      else type = r < 0.4 ? "wolf" : "skeleton";
      spawn(type, x, y);
    }
    // Dragão e guarda-costas no covil.
    const L = world.lair;
    spawn("dragon", L.x, L.y);
    for (const [dx, dy] of [[-2, -2], [2, 2], [-2, 2]]) spawn("skeleton", L.x + dx, L.y + dy);

    // Baús e poções espalhados.
    let chests = 0, pots = 0;
    for (const i of cells) {
      const x = i % W, y = (i / W) | 0;
      if (enemyAt(s, x, y) || !spaced(x, y, s.items, 6)) continue;
      if (chests < 14 && rnd() < 0.2) { s.items.push({ x, y, kind: "chest", d: dist[i] }); chests++; }
      else if (pots < 8 && rnd() < 0.2) { s.items.push({ x, y, kind: "potion" }); pots++; }
    }

    log(s, "Você acorda na vila de Cinzas. Fale com o Ancião (&).", "info");
    computeVisibility(s);
    return s;
  }

  // ---------- Visão (campo de visão com linha de tiro) ----------
  function los(s, x0, y0, x1, y1) {
    // Algoritmo de Bresenham: percorre a linha reta entre dois pontos.
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    while (x !== x1 || y !== y1) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if ((x !== x1 || y !== y1) && Game.opaque(tileAt(s, x, y))) return false;
    }
    return true;
  }
  function computeVisibility(s) {
    const { W } = s.world, p = s.player, R = s.R;
    s.vis.fill(0);
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const x = p.x + dx, y = p.y + dy;
      if (!inb(s, x, y)) continue;
      if (los(s, p.x, p.y, x, y)) { s.vis[y * W + x] = 1; s.seen[y * W + x] = 1; }
    }
  }

  // ---------- XP e níveis ----------
  function gainXp(s, n) {
    const p = s.player;
    p.xp += n;
    while (p.xp >= needXp(p.lv)) {
      p.xp -= needXp(p.lv);
      p.lv++; p.maxHp += 8;
      p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.5));
      log(s, `Você subiu para o nível ${p.lv}!`, "good");
      fx(s, p.x, p.y - 1, "NV" + p.lv, "#ffe66d");
    }
  }

  // ---------- Combate ----------
  function attackEnemy(s, e) {
    const p = s.player, def = ENEMIES[e.type];
    const crit = Math.random() < 0.12;
    let dmg = 2 + p.lv + rand(0, 3);
    if (crit) dmg *= 2;
    e.hp -= dmg; e.flash = now();
    fx(s, e.x, e.y - 1, (crit ? "!" : "") + dmg, crit ? "#ffe66d" : "#ffffff");
    if (e.hp > 0) { log(s, `Você acerta ${def.name} (${dmg}${crit ? ", crítico!" : ""}).`); return; }

    s.enemies.splice(s.enemies.indexOf(e), 1);
    s.kills++;
    const gold = rand(def.gold[0], def.gold[1]);
    p.gold += gold;
    log(s, `${def.name} derrotado! +${def.xp} XP, +${gold} ouro.`, "good");
    if (!def.boss && Math.random() < 0.15) s.items.push({ x: e.x, y: e.y, kind: "potion" });
    gainXp(s, def.xp);
    if (def.boss) {
      s.over = "win";
      log(s, "O Dragão de Cinzas caiu! O reino está salvo!", "good");
    }
  }

  function hurtPlayer(s, dmg, who, label) {
    const p = s.player;
    p.hp -= dmg; p.flash = s.hurtAt = now();
    fx(s, p.x, p.y - 1, "-" + dmg, "#ff6b6b");
    log(s, `${who} ${label} (-${dmg}).`, "bad");
    if (p.hp <= 0) { p.hp = 0; s.over = "lose"; log(s, "Você caiu em batalha...", "bad"); }
  }

  function free(s, x, y) {            // monstro pode pisar aqui?
    return inb(s, x, y) && Game.walkable(tileAt(s, x, y)) && !inSafe(s, x, y) &&
      !enemyAt(s, x, y) && !npcAt(s, x, y) && !(s.player.x === x && s.player.y === y);
  }

  function enemyTurn(s) {
    const p = s.player;
    for (const e of s.enemies.slice()) {
      if (s.over) return;
      const def = ENEMIES[e.type];
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.abs(dx) + Math.abs(dy);

      if (d === 1) {                                       // colado em você: ataca
        if (Math.random() < 0.15) { fx(s, p.x, p.y - 1, "erra", "#aab"); continue; }
        hurtPlayer(s, rand(def.atk[0], def.atk[1]), def.name, "te ataca");
        continue;
      }
      if (def.boss && d <= 4 && s.turn % 4 === 0) {         // sopro de fogo do dragão
        hurtPlayer(s, rand(4, 8), def.name, "cospe fogo");
        continue;
      }
      if (def.slow && (s.turn & 1)) continue;               // gosmas são lentas

      let step = null;
      const chase = d <= def.aggro && (!def.erratic || Math.random() < 0.5);
      if (chase) {
        const sx = Math.sign(dx), sy = Math.sign(dy);
        const order = Math.abs(dx) >= Math.abs(dy) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
        step = order.find(([ax, ay]) => (ax || ay) && free(s, e.x + ax, e.y + ay));
      } else if (Math.random() < 0.2) {
        const [ax, ay] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        if (free(s, e.x + ax, e.y + ay)) step = [ax, ay];
      }
      if (step) { e.x += step[0]; e.y += step[1]; }
    }
  }

  // ---------- Itens ----------
  function pickup(s) {
    const p = s.player;
    const i = s.items.findIndex((it) => it.x === p.x && it.y === p.y);
    if (i < 0) return;
    const it = s.items[i];
    s.items.splice(i, 1);
    if (it.kind === "potion") {
      p.potions++;
      log(s, "Você achou uma poção!", "good"); fx(s, p.x, p.y - 1, "+poção", "#ff7ac8");
    } else if (Math.random() < 0.3) {
      p.potions++;
      log(s, "O baú tinha uma poção!", "good"); fx(s, p.x, p.y - 1, "+poção", "#ff7ac8");
    } else {
      const g = rand(8, 20) + Math.floor((it.d || 0) / 6);
      p.gold += g;
      log(s, `O baú tinha ${g} de ouro!`, "good"); fx(s, p.x, p.y - 1, "+" + g, "#ffd24a");
    }
  }

  function usePotion(s) {
    const p = s.player;
    if (p.potions <= 0) { log(s, "Você não tem poções."); return false; }
    if (p.hp >= p.maxHp) { log(s, "Sua vida já está cheia."); return false; }
    p.potions--;
    const h = Math.min(POTION_HEAL, p.maxHp - p.hp);
    p.hp += h;
    log(s, `Você bebe uma poção (+${h} vida).`, "good");
    fx(s, p.x, p.y - 1, "+" + h, "#7dff6a");
    return true;
  }

  // ---------- Conversa com NPCs (bater neles = falar) ----------
  function compass(s) {
    const L = s.world.lair, p = s.player;
    const dx = L.x - p.x, dy = L.y - p.y;
    const ns = dy < -Math.abs(dx) / 2 ? "N" : dy > Math.abs(dx) / 2 ? "S" : "";
    const ew = dx < -Math.abs(dy) / 2 ? "O" : dx > Math.abs(dy) / 2 ? "L" : "";
    return { dir: ns + ew || "·", dist: Math.abs(dx) + Math.abs(dy) };
  }
  function talk(s, n) {
    const p = s.player;
    if (n.type === "elder") {
      if (s.quest === 0) {
        s.quest = 1;
        log(s, "Ancião: \"Um dragão assola nossas terras, jovem herói.\"", "npc");
        log(s, `Ancião: "Seu covil fica ao ${compass(s).dir}. Fortaleça-se antes!"`, "npc");
      } else if (p.hp < p.maxHp) {
        p.hp = p.maxHp;
        log(s, "O Ancião cuida das suas feridas. Vida restaurada!", "good");
        fx(s, p.x, p.y - 1, "cura", "#7dff6a");
      } else {
        log(s, `Ancião: "O dragão está ao ${compass(s).dir}. Boa sorte!"`, "npc");
      }
    } else {
      if (p.gold >= POTION_PRICE) {
        p.gold -= POTION_PRICE; p.potions++;
        log(s, `Mercador: "Boa compra!" (-${POTION_PRICE} ouro, +1 poção)`, "npc");
      } else {
        log(s, `Mercador: "Poção: ${POTION_PRICE} de ouro. Volte com moedas!"`, "npc");
      }
    }
  }

  // ---------- Ação do jogador ----------
  function tryMove(s, dx, dy) {
    const p = s.player, nx = p.x + dx, ny = p.y + dy;
    if (!inb(s, nx, ny)) return false;
    const npc = npcAt(s, nx, ny);
    if (npc) { talk(s, npc); s.dirty = true; return false; }   // falar não gasta turno
    const en = enemyAt(s, nx, ny);
    if (en) { attackEnemy(s, en); return true; }
    const t = tileAt(s, nx, ny);
    if (!Game.walkable(t)) {
      const msg = t === ID.WATER ? "A água é funda demais." : null;
      if (msg && (!s.log.length || s.log[s.log.length - 1].text !== msg)) log(s, msg);
      return false;
    }
    p.x = nx; p.y = ny;
    pickup(s);
    return true;
  }

  /**
   * Executa uma ação do jogador. Devolve true se gastou um turno.
   * a = { type: "move", dx, dy } | { type: "wait" } | { type: "potion" }
   */
  function act(s, a) {
    if (s.over) return false;
    let used = false;
    if (a.type === "move") used = tryMove(s, a.dx, a.dy);
    else if (a.type === "wait") used = true;
    else if (a.type === "potion") used = usePotion(s);

    if (used) {
      s.turn++;
      if (!s.over) enemyTurn(s);
      if (!s.over && s.turn % 8 === 0 && s.player.hp < s.player.maxHp) s.player.hp++; // regeneração lenta
      computeVisibility(s);
    }
    s.dirty = true;
    return used;
  }

  Game.ENEMIES = ENEMIES;
  Game.needXp = needXp;
  Game.compass = compass;
  Game.newGame = newGame;
  Game.act = act;
})();
