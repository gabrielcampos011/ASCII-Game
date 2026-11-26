/*
 * audio.js — todos os sons do jogo, GERADOS POR CÓDIGO (nenhum arquivo de áudio).
 *
 * Usamos a Web Audio API: montamos "circuitos" de sons ligando peças:
 *   fonte (oscilador = tom puro, ou ruído branco)  ->  filtro  ->  volume (envelope)  ->  caixa de som
 *
 * - Oscilador: uma onda (sine/triangle/sawtooth/square) numa frequência; mudar a frequência no tempo
 *   faz "pancadas" (grave que cai) e "assobios" (agudo que sobe).
 * - Ruído filtrado: chiado "cortado" por um filtro dá vento, golpe de espada, passos...
 * - Envelope: o volume sobe rápido e desce devagar, e é isso que dá a forma de cada som.
 *
 * O jogo (game.js) só anota "aconteceu um golpe em tal lugar" em state.sfx; o main.js entrega a lista
 * para Game.Audio.play(), que decide como soar e o quão alto/de qual lado, conforme a posição.
 */
window.Game = window.Game || {};

(function () {
  const A = (Game.Audio = { muted: false, ready: false });
  let ctx = null, master = null, noiseBuf = null, ambGain = null, reverbIn = null, musicBus = null, drone = null, det = 1;
  const L = { x: 0, z: 0, yaw: 0 };                 // "ouvidos": posição e direção da câmera
  const last = {};                                  // anti-metralhadora: último instante de cada som

  try { A.muted = localStorage.getItem("rc_muted") === "1"; } catch (_) { /* sem armazenamento: ok */ }

  // ---------- Preparação (precisa de um toque/tecla do jogador: regra dos navegadores) ----------
  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = A.muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();          // evita estourar quando vários sons tocam juntos
    master.connect(comp); comp.connect(ctx.destination);
    A.analyser = ctx.createAnalyser(); A.analyser.fftSize = 1024; master.connect(A.analyser);   // só para testes
    // ruído branco de 2 segundos, reaproveitado por todos os sons de "chiado"
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // REVERB: a "sala" onde os sons ecoam. A resposta (impulso) é um ruído que some aos poucos, mais grave no fim.
    const rev = ctx.createConvolver(), n = Math.floor(ctx.sampleRate * 2.6), imp = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d2 = imp.getChannelData(c); let y = 0; for (let i = 0; i < n; i++) { y += ((Math.random() * 2 - 1) - y) * (0.55 - 0.45 * i / n); d2[i] = y * Math.pow(1 - i / n, 2.4); } }
    rev.buffer = imp;
    reverbIn = ctx.createGain(); reverbIn.gain.value = 1;
    const wet = ctx.createGain(); wet.gain.value = 0.42; reverbIn.connect(rev); rev.connect(wet); wet.connect(master);
    startAmbient(); startMusic();
    A.ready = true;
    return ctx;
  }
  A.unlock = function () {
    try {
      if (navigator.audioSession) navigator.audioSession.type = "playback";   // iPhone: toca mesmo com o modo silencioso
      if (!ensure()) return;
      if (ctx.state === "suspended") ctx.resume();
    } catch (_) { /* ignora */ }
  };
  A.suspend = () => { try { if (ctx && ctx.state === "running") ctx.suspend(); } catch (_) { /* ok */ } };
  A.resume = () => { try { if (ctx && ctx.state === "suspended") ctx.resume(); } catch (_) { /* ok */ } };
  A.setMuted = function (m) {
    A.muted = !!m;
    try { localStorage.setItem("rc_muted", A.muted ? "1" : "0"); } catch (_) { /* ok */ }
    if (master) master.gain.setTargetAtTime(A.muted ? 0 : 0.6, ctx.currentTime, 0.03);
  };
  A.listen = (x, z, yaw) => { L.x = x; L.z = z; L.yaw = yaw; };

  // ---------- Peças básicas ----------
  /** Saída de um som: volume + lado (pan) conforme a posição no mundo. */
  function route(x, z, gain, send) {
    const g = ctx.createGain(); let out = g, vol = gain;
    if (x !== undefined) {
      const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
      vol *= 1 / (1 + d * 0.13);                                   // longe = mais baixo
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, ((dx * -Math.cos(L.yaw) + dz * Math.sin(L.yaw)) / (d + 2)) * 1.4));
        g.connect(p); out = p;
      }
    }
    g.gain.value = vol; out.connect(master);
    if (send) { const sg = ctx.createGain(); sg.gain.value = send; out.connect(sg); sg.connect(reverbIn); }   // parte do som vai para a sala
    return g;
  }
  /** Curva de volume: sobe em "attack" e cai até silêncio em "dur". */
  function env(g, t, attack, dur, peak) {
    attack = Math.max(attack, 0.006);                             // ataque nunca instantâneo: evita "clique"
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  /** Chiado filtrado (type: bandpass/lowpass/highpass), com a frequência indo de f0 a f1. */
  function noise(dest, t, o) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || "bandpass"; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0 * det, t); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1 * det, t + o.dur);
    const g = ctx.createGain(); env(g, t, o.attack ?? 0.005, o.dur, o.peak ?? 1);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + o.dur + 0.05);
  }
  /** Tom (oscilador), com a frequência indo de f0 a f1 e filtro opcional. */
  function tone(dest, t, o) {
    const s = ctx.createOscillator(); s.type = o.type || "sine";
    s.frequency.setValueAtTime(o.f0 * det, t); if (o.f1) s.frequency.exponentialRampToValueAtTime(o.f1 * det, t + o.dur);
    const g = ctx.createGain(); env(g, t, o.attack ?? 0.004, o.dur, o.peak ?? 1);
    let node = s;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp; s.connect(f); node = f; }
    node.connect(g); g.connect(dest);
    s.start(t); s.stop(t + o.dur + 0.05);
  }

  // ---------- Os sons ----------
  const SFX = {
    swing:  (d, t) => { noise(d, t, { f0: 500, f1: 2800, q: 1.3, dur: 0.2, peak: 0.55, attack: 0.05 }); },
    hit:    (d, t, o) => {
      noise(d, t, { type: "lowpass", f0: 2400, f1: 500, dur: 0.1, peak: 0.9 });
      tone(d, t, { f0: 160, f1: 50, dur: 0.16, peak: 0.9 });
      noise(d, t + 0.02, { f0: 380, q: 4, dur: 0.14, peak: 0.45 });                   // "squish" de carne
      if (o.crit) { tone(d, t, { type: "triangle", f0: 1500, f1: 900, dur: 0.3, peak: 0.28 }); noise(d, t, { type: "highpass", f0: 3000, dur: 0.12, peak: 0.4 }); }
    },
    kill:   (d, t, o) => {
      tone(d, t, { type: "sawtooth", f0: o.big ? 150 : 260, f1: 45, dur: o.big ? 0.8 : 0.5, peak: 0.4, lp: 700 });
      noise(d, t, { type: "lowpass", f0: 1500, f1: 200, dur: 0.4, peak: 0.6 });
    },
    hurt:   (d, t) => {
      tone(d, t, { f0: 120, f1: 50, dur: 0.28, peak: 1 });
      noise(d, t, { type: "lowpass", f0: 1000, f1: 200, dur: 0.18, peak: 0.7 });
      tone(d, t, { type: "square", f0: 190, f1: 110, dur: 0.14, peak: 0.12, lp: 600 });
    },
    dash:   (d, t) => { noise(d, t, { type: "highpass", f0: 500, f1: 4000, dur: 0.3, peak: 0.55, attack: 0.06 }); tone(d, t, { f0: 300, f1: 760, dur: 0.22, peak: 0.07 }); },
    step:   (d, t) => { noise(d, t, { f0: 700 + Math.random() * 500, q: 0.7, dur: 0.07, peak: 0.28 }); },
    splash: (d, t) => { noise(d, t, { f0: 1300 + Math.random() * 600, q: 0.8, dur: 0.2, peak: 0.4, attack: 0.02 }); noise(d, t + 0.04, { type: "highpass", f0: 2500, dur: 0.14, peak: 0.15 }); },
    orb:    (d, t) => { tone(d, t, { f0: 660, dur: 0.3, peak: 0.35 }); tone(d, t + 0.08, { f0: 990, dur: 0.4, peak: 0.3 }); tone(d, t + 0.16, { f0: 1320, dur: 0.5, peak: 0.2 }); },
    growl:  (d, t, o) => {
      const f = o.big ? 52 : 95, dur = o.big ? 0.9 : 0.45;
      tone(d, t, { type: "sawtooth", f0: f * 1.15, f1: f * 0.8, dur, peak: 0.4, attack: 0.1, lp: 380 });
      tone(d, t, { type: "sawtooth", f0: f * 1.2, f1: f * 0.82, dur, peak: 0.25, attack: 0.1, lp: 380 });
    },
    strike: (d, t, o) => {
      if (o.big) { tone(d, t, { f0: 90, f1: 30, dur: 0.5, peak: 1 }); noise(d, t, { type: "lowpass", f0: 500, f1: 90, dur: 0.45, peak: 0.9 }); }
      else { noise(d, t, { f0: 300, f1: 1000, dur: 0.14, peak: 0.5, attack: 0.03 }); tone(d, t + 0.05, { f0: 110, f1: 55, dur: 0.12, peak: 0.4 }); }
    },
    horn:   (d, t) => {
      tone(d, t, { type: "sawtooth", f0: 98, dur: 1.5, peak: 0.4, attack: 0.4, lp: 520 });
      tone(d, t, { type: "sawtooth", f0: 147, dur: 1.5, peak: 0.3, attack: 0.4, lp: 520 });
      tone(d, t, { type: "sawtooth", f0: 99.5, dur: 1.5, peak: 0.25, attack: 0.4, lp: 520 });
    },
    win:    (d, t) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(d, t + i * 0.16, { type: "triangle", f0: f, dur: 0.7, peak: 0.35 })); },
    lose:   (d, t) => { [220, 185, 147, 110].forEach((f, i) => tone(d, t + i * 0.3, { type: "sawtooth", f0: f, f1: f * 0.97, dur: 0.9, peak: 0.28, lp: 600 })); },
    heart:  (d, t) => { tone(d, t, { f0: 70, f1: 45, dur: 0.16, peak: 0.9 }); tone(d, t + 0.17, { f0: 62, f1: 40, dur: 0.18, peak: 0.7 }); },
  };
  const SEND = { swing: 0.15, hit: 0.28, kill: 0.55, hurt: 0.3, dash: 0.2, step: 0.1, splash: 0.3, orb: 0.7, growl: 0.4, strike: 0.4, horn: 0.6, win: 0.6, lose: 0.6, heart: 0.12 };
  const GAP = { swing: 0.08, hit: 0.03, step: 0.14, splash: 0.14, growl: 0.12, strike: 0.08, kill: 0.05 };   // intervalo mínimo entre repetições
  const LOUD = { swing: 0.8, hit: 1, kill: 1, hurt: 1, dash: 0.8, step: 0.7, splash: 0.8, orb: 0.8, growl: 0.9, strike: 1, horn: 0.9, win: 0.9, lose: 0.9, heart: 1 };

  /** Toca um evento: { n: nome, x, z (posição no mundo, opcional), crit, big }. */
  A.play = function (ev) {
    if (!ctx || ctx.state !== "running" || A.muted || !SFX[ev.n]) return;
    const t = ctx.currentTime;
    if (last[ev.n] !== undefined && t - last[ev.n] < (GAP[ev.n] || 0)) return;
    last[ev.n] = t;
    det = ev.n === "heart" || ev.n === "horn" || ev.n === "win" || ev.n === "lose" ? 1 : 1 + (Math.random() - 0.5) * 0.14;   // cada som sai um pouco diferente
    const dest = route(ev.x, ev.z, LOUD[ev.n] ?? 1, SEND[ev.n] ?? 0.2);
    SFX[ev.n](dest, t + 0.005, ev);
  };

  // ---------- Música: acordes lentos (Lá menor - Fá - Dó - Sol) + notas de sino, gerados na hora ----------
  const CHORDS = [[220, 261.63, 329.63, 440], [174.61, 220, 261.63, 349.23], [261.63, 329.63, 392, 523.25], [196, 246.94, 293.66, 392]];
  const PENTA = [0, 3, 5, 7, 10, 12, 15, 17];                       // escala pentatônica (soa sempre bem)
  let nextBar = 0, barIdx = 0, musicTimer = null;
  function scheduleBar(t) {
    const ch = CHORDS[barIdx % CHORDS.length], dur = 8;
    ch.forEach((f, i) => {                                           // pad: duas ondas levemente desafinadas por nota
      for (const dt of [-6, 6]) {
        const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = f; o.detune.value = dt;
        const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 780; lp.Q.value = 0.4;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.034 / (1 + i * 0.15), t + 2.4); g.gain.linearRampToValueAtTime(0.026, t + dur - 1.5); g.gain.linearRampToValueAtTime(0.0001, t + dur + 2.5);
        o.connect(lp); lp.connect(g); g.connect(musicBus); o.start(t); o.stop(t + dur + 2.6);
      }
    });
    const b = ctx.createOscillator(); b.type = "sine"; b.frequency.value = ch[0] / 2;                    // baixo
    const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(0.07, t + 1.2); bg.gain.linearRampToValueAtTime(0.0001, t + dur + 1);
    b.connect(bg); bg.connect(musicBus); b.start(t); b.stop(t + dur + 1.1);
    for (let k = 0; k < 6; k++) {                                    // notas de sino espalhadas, com eco
      if (Math.random() < 0.25) continue;
      const nt = t + 0.6 + k * 1.2 + Math.random() * 0.5, f = ch[0] * 2 * Math.pow(2, PENTA[(Math.random() * PENTA.length) | 0] / 12);
      for (const [mul, pk] of [[1, 0.06], [2.01, 0.02]]) {
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * mul;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, nt); g.gain.linearRampToValueAtTime(pk, nt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, nt + 1.6);
        o.connect(g); g.connect(musicBus); o.start(nt); o.stop(nt + 1.7);
      }
    }
    barIdx++;
  }
  function startMusic() {
    musicBus = ctx.createGain(); musicBus.gain.value = 0.9; musicBus.connect(master);
    const send = ctx.createGain(); send.gain.value = 0.75; musicBus.connect(send); send.connect(reverbIn);
    // camada de TENSÃO: um zumbido grave que cresce quando há inimigos por perto (controlada por A.setIntensity)
    drone = ctx.createGain(); drone.gain.value = 0;
    for (const f of [55, 55.4]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 160; o.connect(lp); lp.connect(drone); o.start(); }
    drone.connect(master);
    nextBar = ctx.currentTime + 0.3;
    const tick = () => { while (ctx && nextBar < ctx.currentTime + 2) { scheduleBar(nextBar); nextBar += 8; } };
    tick(); musicTimer = setInterval(tick, 400);
  }
  /** v de 0 a 1: quão perigosa está a situação (inimigos perto). Sobe o zumbido de tensão. */
  A.setIntensity = (v) => { if (drone) drone.gain.setTargetAtTime(Math.max(0, Math.min(1, v)) * 0.075, ctx.currentTime, 0.6); };

  // ---------- Ambiente: vento que sopra em ondas + grilos bem baixinhos ----------
  function startAmbient() {
    ambGain = ctx.createGain(); ambGain.gain.value = 0.55; ambGain.connect(master);
    const w = ctx.createBufferSource(); w.buffer = noiseBuf; w.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 520; lp.Q.value = 0.6;
    const wg = ctx.createGain(); wg.gain.value = 0.07;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;                 // rajadas lentas
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.045; lfo.connect(lfoG); lfoG.connect(wg.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 260; lfo2.connect(lfo2G); lfo2G.connect(lp.frequency);
    w.connect(lp); lp.connect(wg); wg.connect(ambGain);
    w.start(); lfo.start(); lfo2.start();
    // grilos: tom agudo ligado/desligado rapidamente
    const c = ctx.createOscillator(); c.type = "sine"; c.frequency.value = 4300;
    const cg = ctx.createGain(); cg.gain.value = 0.0;
    const pulse = ctx.createOscillator(); pulse.type = "square"; pulse.frequency.value = 13;
    const pg = ctx.createGain(); pg.gain.value = 0.004; pulse.connect(pg); pg.connect(cg.gain);
    const slow = ctx.createOscillator(); slow.frequency.value = 0.23;
    const sg = ctx.createGain(); sg.gain.value = 0.003; slow.connect(sg); sg.connect(cg.gain);
    c.connect(cg); cg.connect(ambGain);
    c.start(); pulse.start(); slow.start();
  }
})();
