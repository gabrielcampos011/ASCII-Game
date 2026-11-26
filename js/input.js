/*
 * input.js — teclado, mouse e toque (joystick virtual + botões).
 *
 * Os eventos chegam a qualquer momento; aqui só ANOTAMOS o que o jogador
 * quer. O game loop chama Game.Input.poll() uma vez por passo e recebe:
 *   mx, my      : direção de movimento (-1..1; my positivo = para frente)
 *   camDX/camDY : quanto a câmera foi arrastada desde o último passo
 *   rot         : giro contínuo da câmera (teclas Q/E)
 *   attack/dash : "foi apertado" (valem uma vez só)
 */
window.Game = window.Game || {};

(function () {
  const keys = new Set();
  const st = { camDX: 0, camDY: 0, attack: false, dash: false, restart: false, any: false, stickX: 0, stickY: 0 };
  const $ = (id) => document.getElementById(id);
  const canvas = $("gl");

  // ---------- Teclado ----------
  const MOVE = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "q", "e", "j", "k"];
  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if ((k === " " || k === "enter") && e.target.closest && e.target.closest("button")) return;   // aciona o botão focado
    if (MOVE.includes(k)) e.preventDefault();
    st.any = true;
    if (e.repeat) return;
    keys.add(k);
    if (k === " " || k === "j") st.attack = true;
    if (k === "shift" || k === "k") st.dash = true;
    if (k === "r" || k === "enter") st.restart = true;
  });
  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener("blur", () => keys.clear());

  // ---------- Mouse (trava o cursor para girar a câmera) ----------
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") return;
    st.any = true;
    if (e.button === 2) { st.dash = true; return; }
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) { try { canvas.requestPointerLock(); } catch (_) { /* ignora */ } }
    st.attack = true;
  });
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) { st.camDX -= e.movementX; st.camDY += e.movementY; }
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  // ---------- Toque: arrastar na tela gira a câmera ----------
  const drags = new Map();
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    st.any = true; try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  let pinching = false;                                     // true enquanto há 2 dedos fazendo pinça (veja mais abaixo)
  canvas.addEventListener("pointermove", (e) => {
    const d = drags.get(e.pointerId); if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY;
    if (pinching) return;                                   // só durante uma pinça de verdade a câmera fica parada
    st.camDX -= dx; st.camDY += dy;
  });
  const endDrag = (e) => { drags.delete(e.pointerId); };
  canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);

  // ---------- Toque: joystick flutuante (aparece onde você encosta) ----------
  const zone = $("stickZone"), base = $("stick"), knob = $("knob"), RAD = 54;
  let stickId = null, origin = null;
  zone.addEventListener("pointerdown", (e) => {
    if (stickId !== null) return;
    e.preventDefault(); stickId = e.pointerId; try { zone.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } st.any = true;
    origin = { x: e.clientX, y: e.clientY };
    base.style.left = origin.x + "px"; base.style.top = origin.y + "px"; base.classList.add("on");
    knob.style.transform = "translate(-50%,-50%)";
  });
  zone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - origin.x, dy = e.clientY - origin.y; const l = Math.hypot(dx, dy);
    if (l > RAD) { dx *= RAD / l; dy *= RAD / l; }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const m = Math.min(1, Math.hypot(dx, dy) / RAD), a = Math.atan2(dy, dx);
    const dead = m < 0.12 ? 0 : (m - 0.12) / 0.88;
    st.stickX = Math.cos(a) * dead; st.stickY = -Math.sin(a) * dead;      // y da tela é invertido
  });
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null; st.stickX = st.stickY = 0; base.classList.remove("on");
  };
  zone.addEventListener("pointerup", endStick); zone.addEventListener("pointercancel", endStick);

  // ---------- Pinça (zoom nas letras) ----------
  // CUIDADO: jogar no celular já usa DOIS dedos ao mesmo tempo (polegar esquerdo no joystick + polegar
  // direito girando a câmera). Por isso a pinça só vale quando NENHUM dos dedos está no joystick
  // (#stickZone) nem em um botão. Além disso ela só "pega" depois que a distância entre os dedos muda
  // de forma clara (zona morta), e só então a câmera para de girar.
  let pinchD0 = 0, pinchZ0 = 1, pinchOn = false;
  const tdist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const forbidden = (t) => !!(t.target && ((t.target.id === "stickZone") || (t.target.closest && t.target.closest("button"))));
  const freeTouches = (e) => e.touches.length >= 2 && ![...e.touches].some(forbidden);
  document.addEventListener("touchstart", (e) => {
    if (!freeTouches(e) || !Game.Renderer || !Game.Renderer.getZoom) { pinchOn = false; return; }
    pinchOn = true; pinchD0 = Math.max(20, tdist(e.touches[0], e.touches[1])); pinchZ0 = Game.Renderer.getZoom();
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!pinchOn || !freeTouches(e)) return;
    const ratio = tdist(e.touches[0], e.touches[1]) / pinchD0;
    if (!pinching) {                                       // zona morta: só vira pinça se os dedos mudarem ~14%
      if (ratio > 0.86 && ratio < 1.16) return;
      pinching = true; drags.clear();
    }
    const R = Game.Renderer, z = Math.round(pinchZ0 * ratio);
    if (z !== R.getZoom()) R.setZoom(z);
  }, { passive: true });
  const endPinch = (e) => { if (e.touches.length < 2) { pinching = false; pinchOn = false; } };
  document.addEventListener("touchend", endPinch, { passive: true }); document.addEventListener("touchcancel", endPinch, { passive: true });

  // ---------- Botões de toque ----------
  const press = (id, fn) => {
    const b = $(id);
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); st.any = true; b.classList.add("on"); fn(); });
    const up = () => b.classList.remove("on");
    b.addEventListener("pointerup", up); b.addEventListener("pointercancel", up); b.addEventListener("pointerleave", up);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  };
  press("btnAtk", () => { st.attack = true; });
  press("btnDash", () => { st.dash = true; });

  // ---------- Bloqueios de zoom/rolagem (o iOS ignora user-scalable=no) ----------
  ["gesturestart", "gesturechange"].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));
  document.addEventListener("touchmove", (e) => {
    if (e.target.closest && e.target.closest(".overlay")) return;          // telas de menu podem rolar
    e.preventDefault();
  }, { passive: false });
  let lastEnd = 0;
  document.addEventListener("touchend", (e) => {
    const n = Date.now(); if (n - lastEnd < 300) e.preventDefault(); lastEnd = n;
  }, { passive: false });

  Game.Input = {
    /** Lê e zera as entradas "de um toque só". Chamado a cada passo do loop. */
    poll() {
      let mx = st.stickX, my = st.stickY;
      if (keys.has("a") || keys.has("arrowleft")) mx -= 1;
      if (keys.has("d") || keys.has("arrowright")) mx += 1;
      if (keys.has("w") || keys.has("arrowup")) my += 1;
      if (keys.has("s") || keys.has("arrowdown")) my -= 1;
      const r = {
        mx, my, camDX: st.camDX, camDY: st.camDY, attack: st.attack, dash: st.dash, restart: st.restart, any: st.any,
        rot: (keys.has("q") ? 1 : 0) - (keys.has("e") ? 1 : 0),
      };
      st.camDX = st.camDY = 0; st.attack = st.dash = st.restart = st.any = false;
      return r;
    },
    clear() {
      st.attack = st.dash = st.restart = st.any = false; st.camDX = st.camDY = 0;
      // solta teclas, joystick e arrastos (ex.: ao pausar)
      keys.clear(); drags.clear(); stickId = null; st.stickX = st.stickY = 0; base.classList.remove("on");
      for (const id of ["btnAtk", "btnDash"]) $(id).classList.remove("on");
    },
  };
})();
