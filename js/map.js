/*
 * map.js — dados do mapa e regras do mundo.
 *
 * Todos os arquivos compartilham um único objeto global "Game".
 * Aqui criamos o objeto e colocamos nele o mapa e as funções do mundo.
 */
window.Game = window.Game || {};

(function () {
  // Legenda: # parede | $ moeda | @ posição inicial do jogador | espaço = chão livre
  // Cada string é uma linha; todas têm a mesma largura (25 colunas).
  const LEVEL = [
    "#########################",
    "#@  $    #       #   $  #",
    "# ### ## # ##### # ###  #",
    "# #  $#    #   $        #",
    "# # ####### # ### ### # #",
    "#   #     # #   #   # $ #",
    "# ### ### # ### ##### # #",
    "#   #   #   #       # # #",
    "### ### ##### ##### # # #",
    "# $     #   $     # #   #",
    "# ##### # ####### # ### #",
    "#       #   $       #  $#",
    "#########################",
  ];

  const WALL = "#";
  const COIN = "$";

  /**
   * Cria um estado de jogo novo a partir do mapa.
   * Transformamos cada linha (string) em um array de caracteres,
   * porque strings são imutáveis e queremos apagar moedas coletadas.
   */
  function createState() {
    const grid = LEVEL.map((row) => row.split(""));
    const state = { grid, player: { x: 1, y: 1 }, coins: 0, total: 0, won: false };

    for (let y = 0; y < grid.length; y++) {
      for (let x = 0; x < grid[y].length; x++) {
        if (grid[y][x] === "@") {          // achou o ponto de partida
          state.player = { x, y };
          grid[y][x] = " ";                // o jogador é desenhado à parte
        } else if (grid[y][x] === COIN) {
          state.total++;
        }
      }
    }
    return state;
  }

  /** Verdadeiro se a célula (x, y) é parede (ou está fora do mapa). */
  function isWall(state, x, y) {
    const row = state.grid[y];
    return !row || row[x] === undefined || row[x] === WALL;
  }

  /**
   * Tenta mover o jogador em (dx, dy). dx/dy são -1, 0 ou 1.
   * Se bater na parede, não anda. Se cair numa moeda, coleta.
   */
  function movePlayer(state, dx, dy) {
    if (state.won) return;                       // jogo acabou: ignora movimento

    const nx = state.player.x + dx;
    const ny = state.player.y + dy;
    if (isWall(state, nx, ny)) return;           // bateu na parede

    state.player.x = nx;
    state.player.y = ny;

    if (state.grid[ny][nx] === COIN) {
      state.grid[ny][nx] = " ";                  // tira a moeda do mapa
      state.coins++;
      if (state.coins === state.total) state.won = true;  // pegou todas!
    }
  }

  Game.LEVEL = LEVEL;
  Game.createState = createState;
  Game.movePlayer = movePlayer;
})();
