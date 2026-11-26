/*
 * main.js — o GAME LOOP.
 *
 * Um jogo é um laço que repete, várias vezes por segundo:
 *
 *     1. LER a entrada     (o que o jogador apertou?)
 *     2. ATUALIZAR o estado (mover, coletar moeda, checar vitória)
 *     3. DESENHAR           (mostrar o novo estado na tela)
 *
 * Em JavaScript, usamos requestAnimationFrame(fn): o navegador chama
 * "fn" antes de cada quadro desenhado (~60 vezes por segundo) e para
 * sozinho quando a aba fica escondida, economizando bateria.
 *
 * PASSO FIXO: se movêssemos o jogador a cada quadro, ele correria 60
 * casas por segundo. Então usamos um "acumulador": somamos o tempo
 * que passou e só damos um passo de lógica a cada STEP_MS milissegundos.
 * Assim o jogo roda na mesma velocidade em qualquer aparelho.
 */
(function () {
  const STEP_MS = 110;            // 1 movimento a cada 110 ms (~9 casas/s)

  let state = Game.createState(); // estado atual do jogo
  let lastTime = 0;               // timestamp do quadro anterior
  let accumulator = 0;            // tempo "guardado" ainda não usado

  /** Um passo de lógica (sem desenhar nada). */
  function update() {
    const dir = Game.Input.nextDirection();      // 1. ler entrada
    if (dir) Game.movePlayer(state, dir.dx, dir.dy); // 2. atualizar
  }

  /** Chamado pelo navegador a cada quadro. "now" = tempo em ms. */
  function frame(now) {
    const delta = now - lastTime;                // tempo desde o último quadro
    lastTime = now;
    // Limita delta: se a aba ficou parada, não "recupera" dezenas de passos
    accumulator += Math.min(delta, 250);

    if (Game.Input.consumeRestart()) {           // reiniciar tem prioridade
      state = Game.createState();
      accumulator = 0;
    }

    while (accumulator >= STEP_MS) {             // quantos passos já "venceram"?
      update();
      accumulator -= STEP_MS;
    }

    Game.Render.draw(state);                     // 3. desenhar
    requestAnimationFrame(frame);                // agenda o próximo quadro
  }

  // Recalcula o tamanho da fonte quando a tela muda (girar o celular, redimensionar)
  function fit() {
    Game.Render.fit(Game.LEVEL[0].length, Game.LEVEL.length);
  }
  window.addEventListener("resize", fit);
  window.addEventListener("orientationchange", fit);
  fit();

  requestAnimationFrame((t) => { lastTime = t; frame(t); });  // liga o motor
})();
