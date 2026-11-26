/*
 * input.js — teclado (WASD/setas) e D-pad de toque.
 *
 * Ideia importante: os eventos (keydown, pointerdown...) acontecem a
 * QUALQUER momento, mas o jogo só "olha" para eles uma vez a cada passo
 * do game loop. Então este arquivo apenas ANOTA o que o jogador quer:
 *
 *   held  -> quais direções estão pressionadas agora (para segurar e andar)
 *   queue -> toques rápidos que ainda não viraram movimento (não perde cliques)
 *
 * O main.js chama Game.Input.nextDirection() a cada passo.
 */
(function () {
  // Cada direção vira um deslocamento (dx, dy). Y cresce para BAIXO.
  const DIRS = {
    up:    { dx: 0,  dy: -1 },
    down:  { dx: 0,  dy: 1 },
    left:  { dx: -1, dy: 0 },
    right: { dx: 1,  dy: 0 },
  };

  // Teclas -> direção
  const KEYS = {
    ArrowUp: "up", w: "up", W: "up",
    ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left",
    ArrowRight: "right", d: "right", D: "right",
  };

  const held = [];   // direções seguradas (a última é a mais recente)
  const queue = [];  // toques pendentes
  let restartRequested = false;

  function press(dir) {
    if (!held.includes(dir)) held.push(dir);
    queue.push(dir);
  }
  function release(dir) {
    const i = held.indexOf(dir);
    if (i !== -1) held.splice(i, 1);
  }

  // ---------- Teclado ----------
  window.addEventListener("keydown", (e) => {
    const dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();               // setas não rolam a página
      if (!e.repeat) press(dir);        // ignora repetição automática do SO
    } else if (e.key === "r" || e.key === "R" || e.key === "Enter") {
      restartRequested = true;
    }
  });
  window.addEventListener("keyup", (e) => {
    const dir = KEYS[e.key];
    if (dir) release(dir);
  });
  // Se a janela perde o foco com tecla pressionada, não fica "andando sozinho"
  window.addEventListener("blur", () => { held.length = 0; });

  // ---------- D-pad de toque ----------
  document.querySelectorAll("#dpad button").forEach((btn) => {
    const dir = btn.dataset.dir;

    // pointerdown cobre dedo, mouse e caneta com um único evento
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();               // evita zoom/seleção/menu de pressionar
      btn.setPointerCapture(e.pointerId); // continua recebendo eventos mesmo se o dedo sair do botão
      btn.classList.add("on");
      press(dir);
    });
    const stop = () => { btn.classList.remove("on"); release(dir); };
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    // Bloqueia o menu de contexto (toque longo)
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  // Botão reiniciar
  document.getElementById("restart").addEventListener("click", () => {
    restartRequested = true;
  });

  // Bloqueia gestos de pinça (iOS Safari ignora user-scalable=no)
  ["gesturestart", "gesturechange"].forEach((t) =>
    document.addEventListener(t, (e) => e.preventDefault())
  );
  // Bloqueia rolagem por arrastar em qualquer lugar da página
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  // Bloqueia zoom por toque duplo rápido (iOS)
  let lastTouchEnd = 0;
  document.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  // ---------- API usada pelo game loop ----------
  Game.Input = {
    /** Devolve a próxima direção a andar neste passo, ou null. */
    nextDirection() {
      const dir = queue.shift() || held[held.length - 1];
      queue.length = Math.min(queue.length, 2); // evita fila gigante
      return dir ? DIRS[dir] : null;
    },
    /** Verdadeiro (uma vez) se o jogador pediu para reiniciar. */
    consumeRestart() {
      const r = restartRequested;
      restartRequested = false;
      return r;
    },
  };
})();
