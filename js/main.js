/*
 * main.js — o GAME LOOP e as telas (título, jogo, fim).
 *
 * Todo jogo repete, várias vezes por segundo:
 *     1. LER a entrada      (o que o jogador apertou?)
 *     2. ATUALIZAR o estado (andar, lutar, coletar...)
 *     3. DESENHAR           (mostrar o estado na tela)
 *
 * O navegador oferece requestAnimationFrame(fn): chama "fn" antes de cada
 * quadro (~60x/s) e pausa sozinho quando a aba está escondida.
 *
 * PASSO FIXO: lemos a entrada a cada STEP_MS (e não a cada quadro), usando
 * um "acumulador" de tempo. Assim o herói anda na mesma velocidade em
 * qualquer aparelho, sem importar se a tela é 60Hz ou 120Hz.
 *
 * Já o DESENHO acontece a cada quadro (a água ondula, o fogo tremula,
 * números de dano flutuam), mas só quando há algo novo para mostrar.
 */
(function () {
  const STEP_MS = 130;
  const $ = (id) => document.getElementById(id);
  const stage = $("stage");

  let state = null;
  let mode = "title";                  // "title" | "play" | "over"
  let lastTime = 0, acc = 0, lastDraw = 0;

  // ---------- Telas ----------
  function startGame() {
    state = Game.newGame();
    mode = "play";
    $("title").hidden = true; $("end").hidden = true;
    Game.Input.clear();
    Game.Render.fit();
    state.dirty = true;
  }
  function showEnd() {
    mode = "over";
    const win = state.over === "win", p = state.player;
    const end = $("end");
    end.className = "overlay " + (win ? "win" : "lose");
    $("endTitle").textContent = win ? "VITÓRIA!" : "Você caiu...";
    $("endText").innerHTML = (win ? "O Dragão de Cinzas foi derrotado.<br>" : "As cinzas cobrem o reino.<br>") +
      `Nível ${p.lv} · ${state.kills} monstros · ${p.gold} de ouro · ${state.turn} turnos`;
    end.hidden = false;
    Game.Input.clear();
  }
  $("startBtn").addEventListener("click", startGame);
  $("title").addEventListener("click", startGame);
  $("againBtn").addEventListener("click", startGame);

  // ---------- 1+2: ler entrada e atualizar (um passo fixo) ----------
  function step() {
    if (mode === "title") {
      if (Game.Input.hadAnyInput()) startGame();
      return;
    }
    const action = Game.Input.nextAction();
    if (mode === "over") {
      if (action === "restart" || action === "confirm" || action === "wait") startGame();
      return;
    }
    if (action === "restart") { startGame(); return; }

    if (action === "potion") Game.act(state, { type: "potion" });
    else if (action === "wait") Game.act(state, { type: "wait" });
    else {
      const d = Game.Input.nextDirection();
      if (d) Game.act(state, { type: "move", dx: d.dx, dy: d.dy });
    }
    if (state.over) showEnd();
  }

  // ---------- 3: desenhar ----------
  function render(now) {
    if (!state) return;
    // Redesenha se o estado mudou, se há efeitos animados ou a cada 200ms (água/fogo).
    if (state.dirty || state.fx.length || now - lastDraw > 200) {
      Game.Render.draw(state, now);
      state.dirty = false; lastDraw = now;
    }
  }

  // ---------- O laço ----------
  function frame(now) {
    const delta = now - lastTime;
    lastTime = now;
    acc += Math.min(delta, 250);       // limita: aba parada não "recupera" passos
    while (acc >= STEP_MS) { step(); acc -= STEP_MS; }
    render(now);
    requestAnimationFrame(frame);
  }

  Game.current = () => state;        // útil para depurar no console: Game.current()

  // ---------- Ajuste de tamanho (girar celular, redimensionar) ----------
  function onResize() { Game.Render.fit(); if (state) state.dirty = true; }
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(stage);

  // Pré-visualização atrás do título: um mundo para o fundo não ficar vazio.
  state = Game.newGame(7);
  for (let i = 0; i < state.seen.length; i++) state.seen[i] = 1;   // título mostra o mapa "revelado"
  state.vis.fill(1);
  Game.Render.fit();

  requestAnimationFrame((t) => { lastTime = t; frame(t); });
})();
