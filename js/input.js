/*
 * input.js — teclado (WASD/setas/E/Espaço/R) e botões de toque.
 *
 * Os eventos acontecem a qualquer momento, mas o jogo só "olha" para
 * eles uma vez por passo do game loop. Então aqui só ANOTAMOS:
 *
 *   held    -> direções seguradas agora (segurar = andar continuamente)
 *   queue   -> toques rápidos ainda não consumidos (não perde cliques)
 *   actions -> ações especiais: "potion", "wait", "restart", "confirm"
 */
(function () {
  const DIRS = {
    up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
  };
  const KEYS = {
    ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right",
  };

  const held = [], queue = [], actions = [];
  let any = false;                       // alguma entrada aconteceu? (tela de título)

  function press(dir) {
    if (!held.includes(dir)) held.push(dir);
    queue.push(dir); any = true;
  }
  function release(dir) {
    const i = held.indexOf(dir);
    if (i !== -1) held.splice(i, 1);
  }
  function act(name) { actions.push(name); any = true; }

  // ---------- Teclado ----------
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = KEYS[e.key];
    if (dir) { e.preventDefault(); if (!e.repeat) press(dir); return; }
    if (e.key === " ") { e.preventDefault(); if (!e.repeat) act("wait"); }
    else if (e.key === "e" || e.key === "E" || e.key === "q" || e.key === "Q") { if (!e.repeat) act("potion"); }
    else if (e.key === "r" || e.key === "R") act("restart");
    else if (e.key === "Enter") act("confirm");
    else any = true;
  });
  window.addEventListener("keyup", (e) => { const d = KEYS[e.key]; if (d) release(d); });
  window.addEventListener("blur", () => { held.length = 0; });   // perdeu foco: para de andar

  // ---------- Botões de toque ----------
  document.querySelectorAll("#dpad button").forEach((btn) => {
    const dir = btn.dataset.dir;
    btn.addEventListener("pointerdown", (e) => {
      e.preventDefault();                       // sem zoom/seleção/menu
      btn.setPointerCapture(e.pointerId);       // continua valendo se o dedo escorregar
      btn.classList.add("on"); press(dir);
    });
    const stop = () => { btn.classList.remove("on"); release(dir); };
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  document.querySelectorAll("#actions button").forEach((btn) => {
    btn.addEventListener("pointerdown", (e) => { e.preventDefault(); act(btn.dataset.act); });
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  });

  // ---------- Bloqueios de zoom/rolagem (o iOS ignora user-scalable=no) ----------
  ["gesturestart", "gesturechange"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  let lastEnd = 0;
  document.addEventListener("touchend", (e) => {
    const n = Date.now();
    if (n - lastEnd < 300) e.preventDefault();   // toque duplo rápido = zoom no iOS
    lastEnd = n;
  }, { passive: false });

  // ---------- API usada pelo game loop ----------
  Game.Input = {
    /** Próxima direção a andar neste passo (toque pendente ou tecla segurada). */
    nextDirection() {
      const dir = queue.shift() || held[held.length - 1];
      queue.length = Math.min(queue.length, 2);
      return dir ? DIRS[dir] : null;
    },
    nextAction() { return actions.shift() || null; },
    hadAnyInput() { const a = any; any = false; return a; },
    clear() { queue.length = 0; actions.length = 0; any = false; },
  };
})();
