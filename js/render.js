/*
 * render.js — desenha o estado do jogo na tela.
 *
 * Regra de ouro: renderizar NÃO muda o jogo, só lê o estado e mostra.
 */
(function () {
  const screen = document.getElementById("screen");
  const coinsEl = document.getElementById("coins");
  const messageEl = document.getElementById("message");

  /**
   * Monta o texto do mapa. Para cada célula escolhemos um caractere
   * (e uma cor, via <span class="...">). Como todos os caracteres de
   * uma fonte monoespaçada têm a mesma largura, as colunas ficam alinhadas.
   */
  function buildHTML(state) {
    const lines = [];
    for (let y = 0; y < state.grid.length; y++) {
      let line = "";
      for (let x = 0; x < state.grid[y].length; x++) {
        const isPlayer = x === state.player.x && y === state.player.y;
        const ch = state.grid[y][x];
        if (isPlayer)       line += '<span class="p">@</span>';
        else if (ch === "#") line += '<span class="w">#</span>';
        else if (ch === "$") line += '<span class="c">$</span>';
        else                 line += ch;
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  /**
   * Ajusta o font-size para o mapa caber na largura da tela.
   * 1) medimos quanto mede 1 caractere em fonte de 100px (a proporção)
   * 2) tamanho = largura disponível / (colunas * proporção)
   */
  function fitToScreen(cols, rows) {
    const probe = document.createElement("span");
    probe.textContent = "#".repeat(20);
    probe.style.cssText = "position:absolute;visibility:hidden;font-size:100px;white-space:pre";
    screen.appendChild(probe);
    const charWidthRatio = probe.getBoundingClientRect().width / 20 / 100;
    probe.remove();

    const availW = document.documentElement.clientWidth - 32;   // margem lateral
    // Também limita pela altura, reservando espaço para HUD e D-pad
    const reserved = window.matchMedia("(pointer: coarse)").matches ? 330 : 140;
    const availH = window.innerHeight - reserved;

    const byWidth = availW / (cols * charWidthRatio);
    const byHeight = availH / (rows * 1.1);          // 1.1 = line-height do CSS
    const size = Math.max(8, Math.min(byWidth, byHeight, 40));
    screen.style.fontSize = size + "px";
  }

  Game.Render = {
    draw(state) {
      screen.innerHTML = buildHTML(state);
      coinsEl.textContent = state.coins + "/" + state.total;
      messageEl.hidden = !state.won;
    },
    fit: fitToScreen,
  };
})();
