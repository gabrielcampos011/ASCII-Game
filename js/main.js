/*
 * main.js — o GAME LOOP e as telas (título, jogo, fim).
 *
 * Todo jogo repete, várias vezes por segundo:
 *     1. LER a entrada      (o que o jogador apertou?)
 *     2. ATUALIZAR o estado (mover, lutar, física, inimigos...)
 *     3. DESENHAR           (a GPU monta o quadro)
 *
 * requestAnimationFrame(fn) chama "fn" antes de cada quadro (~60x/s).
 *
 * PASSO FIXO: a lógica roda sempre em fatias de 1/60 s (DT), usando um
 * "acumulador" de tempo. Se um quadro demora, rodamos vários passos para
 * recuperar; se for rápido demais (monitor de 144Hz), rodamos zero. Assim
 * o jogo se comporta igual em qualquer aparelho.
 */
(function () {
  const DT = 1 / 60;
  const $ = (id) => document.getElementById(id);
  const IDLE = { mx: 0, my: 0, camDX: 0, camDY: 0, rot: -0.12, attack: false, dash: false, restart: false, any: false };

  let state, mode = "title", last = 0, acc = 0, worldData, hudKey = "";

  function fail(msg) { $("nogl").hidden = false; $("nogl").querySelector("p").textContent = msg; }

  // ---------- Telas ----------
  function newState() { const s = Game.Logic.newGame(worldData); return s; }
  function startGame() {
    state = newState(); mode = "play";
    $("title").hidden = true; $("end").hidden = true; $("hud").hidden = false;
    Game.Input.clear();
  }
  function showEnd() {
    mode = "over";
    const win = state.over === "win", end = $("end");
    end.className = "overlay " + (win ? "win" : "lose");
    $("endTitle").textContent = win ? "VITÓRIA!" : "VOCÊ CAIU";
    $("endText").innerHTML = (win ? "Todas as ondas foram derrotadas." : "A escuridão venceu desta vez.") + `<br>Ondas: ${Math.min(state.wave, Game.Logic.WAVES)}/${Game.Logic.WAVES} · Inimigos: ${state.kills}`;
    end.hidden = false;
  }
  $("startBtn").addEventListener("click", startGame);
  $("againBtn").addEventListener("click", startGame);
  $("detail").addEventListener("click", () => {
    Game.Renderer.detail = (Game.Renderer.detail + 1) % 3;
    $("detail").textContent = ["fino", "médio", "grosso"][Game.Renderer.detail];
    Game.Renderer.resize();
  });

  // ---------- 1+2: ler entrada e atualizar (um passo fixo) ----------
  function step() {
    const inp = Game.Input.poll();
    if (mode === "title") {
      Game.Logic.update(state, DT, IDLE);                       // câmera girando devagar atrás do título
      if (inp.restart) startGame();
      return;
    }
    if (mode === "over") {
      Game.Logic.update(state, DT, inp);
      if (inp.restart) startGame();
      return;
    }
    if (inp.restart && state.over) { startGame(); return; }
    Game.Logic.update(state, DT, inp);
    if (state.over && state.overT < 0) showEnd();
  }

  // ---------- Painel (HUD) ----------
  function drawHud() {
    const p = state.player, L = Game.Logic;
    const key = [p.hp, p.dashCd > 0, state.wave, state.kills, state.banner.t > 0].join();
    $("hpbar").style.width = (100 * p.hp / p.maxHp) + "%";
    $("hptxt").textContent = Math.ceil(p.hp) + " / " + p.maxHp;
    $("dashbar").style.width = (100 * (1 - Math.min(1, p.dashCd / 0.85))) + "%";
    if (key !== hudKey) {
      hudKey = key;
      $("wave").textContent = state.wave ? `Onda ${Math.min(state.wave, L.WAVES)}/${L.WAVES}` : "Prepare-se";
      $("kills").textContent = "Abates " + state.kills;
    }
    const b = $("banner");
    b.textContent = state.banner.text; b.classList.toggle("on", state.banner.t > 0);
  }

  // ---------- O laço ----------
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; acc += dt;
    while (acc >= DT) { step(); acc -= DT; }
    Game.Renderer.render(state);
    if (mode !== "title") drawHud();
    requestAnimationFrame(frame);
  }

  // ---------- Início ----------
  try {
    worldData = Game.World.build();
    if (!Game.Renderer.init($("gl"), worldData)) { fail("Seu navegador não suporta WebGL2, necessário para este jogo."); return; }
  } catch (err) {
    console.error(err); fail("Erro ao iniciar o gráfico 3D: " + (err && err.message ? err.message.split("\n")[0] : err)); return;
  }
  window.addEventListener("resize", () => Game.Renderer.resize());
  window.addEventListener("orientationchange", () => setTimeout(() => Game.Renderer.resize(), 150));
  state = newState();
  state.over = "title";                                          // no título só a câmera se mexe
  state.player.hp = 100;
  Game.state = () => state;                                      // útil no console: Game.state()
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
