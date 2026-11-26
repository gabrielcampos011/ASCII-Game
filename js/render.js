/*
 * render.js — transforma o estado do jogo em imagem.
 *
 * Regra de ouro: renderizar NÃO muda o jogo, só lê o estado.
 *
 * O mapa é um <pre> com um <span> por tile. Cada span ganha cor do
 * glifo, cor de fundo e "opacity" (luz): perto do herói é claro, longe
 * escurece, e o que já foi explorado fica apagado (névoa de guerra).
 */
(function () {
  const ID = Game.ID, TL = Game.TILES;
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), screen = $("screen");
  const els = {
    lv: $("lv"), gold: $("gold"), pot: $("pot"), hpbar: $("hpbar"), hptxt: $("hptxt"),
    xpbar: $("xpbar"), quest: $("quest"), log: $("log"),
  };

  let cols = 15, rows = 11, lastLogVer = -1;

  /** Mede o palco e decide o tamanho dos tiles e quantos cabem. */
  function fit() {
    const w = stage.clientWidth, h = stage.clientHeight;
    const cell = Math.max(20, Math.min(36, Math.round(Math.min(w, 900) / 17)));
    cols = Math.max(9, Math.floor(w / cell)); if (cols % 2 === 0) cols--;     // ímpar: herói no centro
    rows = Math.max(7, Math.floor(h / cell)); if (rows % 2 === 0) rows--;
    document.documentElement.style.setProperty("--cell", cell + "px");
  }

  const esc = (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c);

  /** Monta uma célula. */
  function span(glyph, fg, bg, opacity, cls) {
    return `<span${cls ? ` class="${cls}"` : ""} style="color:${fg};background:${bg};opacity:${opacity}">${esc(glyph)}</span>`;
  }

  function draw(s, t) {
    const { W, H, tiles } = s.world, p = s.player;

    // Câmera: centraliza no herói, sem passar das bordas do mundo.
    const camX = Math.max(0, Math.min(W - cols, p.x - (cols >> 1)));
    const camY = Math.max(0, Math.min(H - rows, p.y - (rows >> 1)));
    const phase = Math.floor(t / 450), flick = Math.floor(t / 130);
    const R2 = s.R * s.R;

    // Camada de entidades (itens < NPCs < monstros < herói < efeitos).
    const over = new Map();
    const put = (x, y, v) => over.set(y * W + x, v);
    for (const it of s.items) put(it.x, it.y, it.kind === "chest" ? { g: "▣", fg: "#ffcf4a", cls: "e" } : { g: "!", fg: "#ff7ac8", cls: "e" });
    for (const n of s.npcs) put(n.x, n.y, { g: n.g, fg: n.fg, cls: "e" });
    for (const e of s.enemies) {
      const d = Game.ENEMIES[e.type];
      put(e.x, e.y, { g: d.g, fg: d.fg, cls: "e", flash: t - e.flash < 150 });
    }
    put(p.x, p.y, { g: "@", fg: "#fff7a8", cls: "pl", flash: t - p.flash < 150, red: t - p.flash < 150 });

    // Efeitos flutuantes (números de dano): sobem e somem em ~0,8 s.
    s.fx = s.fx.filter((f) => t - f.t < 800);
    const fxCells = new Map();
    for (const f of s.fx) {
      const y = f.y - Math.floor((t - f.t) / 220);
      const x0 = f.x - ((f.text.length - 1) >> 1);
      for (let k = 0; k < f.text.length; k++) fxCells.set(y * W + x0 + k, { g: f.text[k], fg: f.color });
    }

    const out = [];
    for (let vy = 0; vy < rows; vy++) {
      for (let vx = 0; vx < cols; vx++) {
        const x = camX + vx, y = camY + vy;
        if (x >= W || y >= H) { out.push(span(" ", "#000", "#05070a", 1)); continue; }
        const i = y * W + x;
        const f = fxCells.get(i);
        if (f && s.vis[i]) { // número flutuante por cima de tudo
          const td = TL[tiles[i]];
          out.push(span(f.g, f.fg, td.bg[0], 1, "fxt")); continue;
        }
        if (!s.seen[i]) { out.push(span(" ", "#000", "#05070a", 1)); continue; }

        const def = TL[tiles[i]], h = Game.hash2(x, y);
        let gi = h % def.g.length;
        if (def.anim === "water") gi = (h + phase) % def.g.length;        // água ondula
        else if (def.anim === "fire") gi = (h + flick) % def.g.length;    // fogueira tremula
        const fg = def.fg[(h >>> 3) % def.fg.length];
        const bg = def.bg[(h >>> 6) % def.bg.length];

        if (!s.vis[i]) { out.push(span(def.g[gi], fg, bg, 0.34)); continue; } // explorado, fora da visão

        const dx = x - p.x, dy = y - p.y;
        const light = Math.max(0.42, 1 - 0.58 * ((dx * dx + dy * dy) / R2));
        const o = over.get(i);
        if (o) {
          const bg2 = o.red ? "#8a1f1f" : o.flash ? "#6b6b6b" : bg;
          out.push(span(o.g, o.fg, bg2, 1, o.cls));
        } else {
          out.push(span(def.g[gi], fg, bg, light.toFixed(2)));
        }
      }
      out.push("\n");
    }
    screen.innerHTML = out.join("");

    // Efeitos de dano na tela
    const hurt = t - s.hurtAt < 280;
    stage.classList.toggle("hurt", hurt);
    stage.classList.toggle("shake", hurt);

    drawHud(s);
  }

  function drawHud(s) {
    const p = s.player;
    els.lv.textContent = p.lv;
    els.gold.textContent = p.gold;
    els.pot.textContent = p.potions;
    els.hpbar.style.width = (100 * p.hp / p.maxHp) + "%";
    els.hptxt.textContent = `Vida ${p.hp}/${p.maxHp}`;
    els.xpbar.style.width = (100 * p.xp / Game.needXp(p.lv)) + "%";

    if (s.quest === 0) els.quest.innerHTML = "Missão: fale com o <b>Ancião</b> (&amp;) na vila";
    else {
      const c = Game.compass(s);
      els.quest.innerHTML = `Missão: derrote o <b>Dragão de Cinzas</b> — ${c.dir}, ${c.dist} passos`;
    }

    if (s.logVer !== lastLogVer) {          // só reconstrói o log quando mudou
      lastLogVer = s.logVer;
      els.log.innerHTML = s.log.slice(-4).map((l) => `<div class="${l.cls}">${l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("");
    }
  }

  Game.Render = { fit, draw, size: () => ({ cols, rows }) };
})();
