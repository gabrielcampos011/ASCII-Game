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

  let state, mode = "title", last = 0, acc = 0, worldData, hudKey = "", pausedAt = 0, helpFrom = "title";
  const labelDetail = () => { $("detail").textContent = "Caracteres: " + ["pequenos", "médios", "grandes"][Game.Renderer.detail]; };

  function fail(msg) { $("nogl").hidden = false; $("nogl").querySelector("p").textContent = msg; }

  // ---------- Telas ----------
  function newState() { const s = Game.Logic.newGame(worldData); return s; }
  function startGame() {
    $("hud").hidden = false;
    state = newState(); mode = "play"; hudKey = "";
    show(null); drawHud(); setPlaying(true);
  }
  /** Mostra só uma tela por cima do jogo (ou nenhuma, com null). */
  function show(id) { for (const o of ["title", "pause", "help", "end"]) $(o).hidden = o !== id; }
  /** Liga/desliga o que só aparece durante a partida. */
  function setPlaying(on) {
    $("pauseBtn").hidden = !on; $("zoomBtn").hidden = !on; $("hint").hidden = !on;
    if (!on && document.pointerLockElement) document.exitPointerLock();
    if (document.activeElement) document.activeElement.blur();
    Game.Input.clear();
  }
  function pause() {
    if (mode !== "play" || state.over) return;
    mode = "pause"; pausedAt = performance.now(); setPlaying(false); show("pause");
  }
  function resume() {
    if (mode !== "pause") return;
    mode = "play"; show(null); setPlaying(true); lockMouse();
  }
  /** No computador, volta a travar o cursor (o navegador pode recusar logo após um Esc). */
  function lockMouse() {
    const cv = $("gl");
    if (!window.matchMedia("(pointer: fine)").matches || !cv.requestPointerLock) return;
    try { const r = cv.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* ignora */ }
  }
  function toMenu() {
    state = newState(); state.over = "title"; mode = "title";
    $("hud").hidden = true; $("banner").classList.remove("on"); setPlaying(false); show("title");
  }
  function openHelp() { helpFrom = mode; show("help"); if (document.activeElement) document.activeElement.blur(); }
  function closeHelp() { show(helpFrom === "pause" ? "pause" : "title"); }
  function showEnd() {
    mode = "over"; setPlaying(false);
    const win = state.over === "win", end = $("end");
    end.className = "overlay " + (win ? "win" : "lose");
    $("endTitle").textContent = win ? "VITÓRIA!" : "VOCÊ CAIU";
    $("endText").innerHTML = (win ? "Todas as ondas foram derrotadas." : "A escuridão venceu desta vez.") + `<br>Ondas: ${Math.min(state.wave, Game.Logic.WAVES)}/${Game.Logic.WAVES} · Inimigos: ${state.kills}`;
    show("end");
  }
  $("startBtn").addEventListener("click", startGame);
  $("againBtn").addEventListener("click", startGame);
  $("detail").addEventListener("click", () => {
    Game.Renderer.detail = (Game.Renderer.detail + 1) % 3;
    labelDetail();
    Game.Renderer.resize();
  });
  $("pauseBtn").addEventListener("click", pause);
  // ZOOM: 1x -> 2x -> 3x -> 4x -> 1x. Também muda com o gesto de pinça (veja input.js).
  Game.Renderer.onZoom = (z) => { $("zoomVal").textContent = z + "×"; };
  $("zoomBtn").addEventListener("click", () => { const R = Game.Renderer; R.setZoom(R.getZoom() >= R.maxZoom() ? 1 : R.getZoom() + 1); });
  $("resumeBtn").addEventListener("click", resume);
  $("restartBtn").addEventListener("click", startGame);
  $("quitBtn").addEventListener("click", toMenu);
  $("menuBtn").addEventListener("click", toMenu);
  $("helpBtn").addEventListener("click", openHelp);
  $("controlsBtn").addEventListener("click", openHelp);
  $("backBtn").addEventListener("click", closeHelp);

  // Esc / P pausam e continuam
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if ((k !== "escape" && k !== "p") || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$("help").hidden) closeHelp();
    else if (mode === "play") pause();
    else if (mode === "pause" && performance.now() - pausedAt > 250) resume();
  });
  // com o cursor travado, o navegador "engole" o Esc: perceber que destravou também pausa
  document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement) pause(); });
  window.addEventListener("blur", pause);                                  // trocou de janela
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });

  // ---------- 1+2: ler entrada e atualizar (um passo fixo) ----------
  function step() {
    const inp = Game.Input.poll();
    if (mode === "pause") return;                                          // nada avança: tempo, inimigos, ondas
    if (!$("help").hidden) inp.restart = false;                            // lendo os controles
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
    if (mode === "play" || mode === "over") drawHud();
    requestAnimationFrame(frame);
  }

  // ---------- Início ----------
  try {
    worldData = Game.World.build();
    if (!Game.Renderer.init($("gl"), worldData)) { fail("Seu navegador não suporta WebGL2, necessário para este jogo."); return; }
  } catch (err) {
    console.error(err); fail("Erro ao iniciar o gráfico 3D: " + (err && err.message ? err.message.split("\n")[0] : err)); return;
  }
  Game.Renderer.detail = window.innerWidth > 800 ? 0 : 1;          // PC: fino; celular: médio
  labelDetail();
  Game.Renderer.resize();
  window.addEventListener("resize", () => Game.Renderer.resize());
  window.addEventListener("orientationchange", () => setTimeout(() => Game.Renderer.resize(), 150));
  state = newState();
  state.over = "title";                                          // no título só a câmera se mexe
  state.player.hp = 100;
  Game.state = () => state;                                      // útil no console: Game.state()
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
