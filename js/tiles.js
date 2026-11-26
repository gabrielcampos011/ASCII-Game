/*
 * tiles.js — a "paleta" do jogo: tipos de terreno, cores e glifos.
 *
 * Cada tipo de terreno tem VÁRIOS glifos/cores possíveis. Para cada
 * célula (x, y) escolhemos uma variação usando um "hash" determinístico:
 * a mesma célula sempre sai igual, mas o conjunto parece orgânico.
 */
window.Game = window.Game || {};

(function () {
  // Números pequenos como IDs deixam o mapa leve (um Uint8Array).
  const ID = {
    WATER: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FLOWER: 4, TREE: 5, MOUNTAIN: 6,
    SNOW: 7, PATH: 8, ROOF: 9, WALL: 10, DOOR: 11, CAMP: 12, LAIR: 13,
  };

  const GRASS_BG = ["#244a2a", "#285030", "#2b5532"];

  // walk: dá para andar? | opaque: bloqueia a visão? | anim: tipo de animação
  const DEFS = [];
  DEFS[ID.WATER]    = { g: ["~", "≈", "~", "≈"], fg: ["#3f8fd0", "#4aa0e0", "#3579b8"], bg: ["#0e3050", "#103658"], walk: false, anim: "water" };
  DEFS[ID.SHALLOW]  = { g: ["~", "-", "~"], fg: ["#8fd3f4", "#a6defa", "#77c4ea"], bg: ["#2a6f9c", "#2d78a8"], walk: true, anim: "water" };
  DEFS[ID.SAND]     = { g: [".", ":", "·", "."], fg: ["#d8c78a", "#a99456", "#e3d49c"], bg: ["#b9a368", "#bfa96d"], walk: true };
  DEFS[ID.GRASS]    = { g: ['"', ",", "'", "`", ".", ","], fg: ["#4f9a4f", "#5bab55", "#3f7f40", "#68b862"], bg: GRASS_BG, walk: true };
  DEFS[ID.FLOWER]   = { g: ["*", "✿", "*", "✿"], fg: ["#ff7eb6", "#ffd36e", "#c9a0ff", "#ff9a62", "#ffffff"], bg: GRASS_BG, walk: true };
  DEFS[ID.TREE]     = { g: ["♣", "♠", "♣", "♣"], fg: ["#2f8a3c", "#3da24a", "#27702f", "#46b055"], bg: ["#1a3320", "#1c3822"], walk: false, opaque: true };
  DEFS[ID.MOUNTAIN] = { g: ["▲", "^", "▲", "▲"], fg: ["#7d7d8c", "#9a9aa8", "#6a6a78", "#8b8b9a"], bg: ["#35353f", "#3a3a45", "#30303a"], walk: false, opaque: true };
  DEFS[ID.SNOW]     = { g: ["▲", "^", "▲"], fg: ["#f4f6ff", "#d8defa", "#ffffff"], bg: ["#555870", "#5b5e76"], walk: false, opaque: true };
  DEFS[ID.PATH]     = { g: ["·", ":", " ", "·"], fg: ["#a8976a", "#9b8a5e"], bg: ["#7a6a45", "#806f48"], walk: true };
  DEFS[ID.ROOF]     = { g: ["▒", "▓", "▒"], fg: ["#c24a3c", "#b8453a"], bg: ["#5c2420", "#64281f"], walk: false, opaque: true };
  DEFS[ID.WALL]     = { g: ["▒", "▓"], fg: ["#cdbb8c", "#c2b080"], bg: ["#7b6c4c", "#76684a"], walk: false, opaque: true };
  DEFS[ID.DOOR]     = { g: ["▮"], fg: ["#e0a64d"], bg: ["#3a2412"], walk: false, opaque: true };
  DEFS[ID.CAMP]     = { g: ["*", "♦", "^", "*"], fg: ["#ffb02e", "#ff6b1a", "#ffd75e", "#ff8a26"], bg: ["#3a2a1c"], walk: false, anim: "fire" };
  DEFS[ID.LAIR]     = { g: [".", ":", "·", "."], fg: ["#7a3a3a", "#8c4444"], bg: ["#2b1618", "#32191c"], walk: true };

  /** Hash 2D determinístico -> número de 32 bits sem sinal. */
  function hash2(x, y) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /** Gerador de números aleatórios com semente (mesma semente = mesmo mundo). */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  Game.ID = ID;
  Game.TILES = DEFS;
  Game.walkable = (id) => DEFS[id].walk;
  Game.opaque = (id) => !!DEFS[id].opaque;
  Game.hash2 = hash2;
  Game.mulberry32 = mulberry32;
})();
