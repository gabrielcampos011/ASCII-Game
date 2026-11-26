/*
 * render.js — o desenho 3D + a "conversão para ASCII".
 *
 * Por quadro, a GPU faz 4 passadas:
 *   1. SOMBRA    : a cena vista da LUA, guardando só a profundidade
 *                  (se um ponto está "atrás" de algo, está na sombra).
 *   2. REFLEXO   : a cena de cabeça para baixo (espelhada em y=0);
 *                  a água mostra essa imagem.
 *   3. CENA      : o desenho normal, em BAIXA resolução (2x2 pixels por
 *                  caractere). Fica numa textura, não na tela.
 *   4. ASCII     : para cada "célula" da tela, olha a cor e o brilho da
 *                  cena naquele lugar e desenha um caractere: mais claro
 *                  = caractere mais "cheio"; bordas viram | - / \ .
 *
 * Tudo é WebGL2 puro (sem bibliotecas). Os "shaders" são pequenos
 * programas em GLSL que rodam na placa de vídeo, um por vértice/pixel.
 */
window.Game = window.Game || {};

(function () {
  const M = Game.M, Geo = Game.Geo;
  const HDR = "#version 300 es\nprecision highp float;\nprecision highp sampler2D;\n";
  const R = (Game.Renderer = { meshes: {}, ok: false, detail: 0, style: 0 });
  const SX = 4, SY = 8;                       // sub-pixels da cena por célula (4 de largura x 8 de altura)
  // ASCII imprimível SEM letras e números: só sinais, para a imagem não virar uma "sopa de letras"
  const GLYPHS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).filter((c) => !/[A-Za-z0-9]/.test(c)).join("");
  const NG = GLYPHS.length;
  const SHADOW = 1024, EXT = 34;
  const L = (() => { const v = [0.62, 0.5, -0.25], l = Math.hypot(...v); return v.map((x) => x / l); })();

  let zoom = 1, RW = 64, RH = 64;
  try { R.style = Math.max(0, Math.min(2, +(localStorage.getItem('rc_theme') ?? 0))); } catch (_) { R.style = 0; }
  let gl, canvas, world, W = 2, H = 2, cols = 10, rows = 10, cellPx = [8, 14];
  let progs = {}, U = {}, fbShadow, texShadow, fbScene, texScene, fbRefl, texRefl, texAtlas, texPat, fbCell, rampIdx, rampCov;
  let staticMesh, waterMesh, skyMesh, ribbon, grassBuf, grassVAO, bladeCount, chunks;

  // =============================== SHADERS ===============================
  // Balanço do vento nas árvores: o vértice anda conforme o "peso" (0 = base parada, 1 = ponta solta).
  // As rajadas (gust) passam lentamente pelo mapa, então as árvores não balançam todas juntas.
  const SWAY = `
    layout(location=5) in vec2 aSway;
    vec3 sway(vec3 p, vec2 sw, float t){
      if (sw.x <= 0.0) return p;
      float gust = 0.5 + 0.5 * sin(t * 0.37 + p.x * 0.035 + p.z * 0.05);
      float a = t * (1.2 + 0.6 * gust) + p.x * 0.13 + p.z * 0.1 + sw.y;
      float amp = sw.x * (0.14 + 0.30 * gust);
      p.x += (sin(a) + 0.45 * sin(a * 2.3 + 1.7)) * amp;
      p.z += (cos(a * 0.8 + 0.6) + 0.3 * sin(a * 1.9)) * amp * 0.6;
      return p;
    }`;

  const DEPTH_VS = HDR + `
    layout(location=0) in vec3 aPos;
    uniform mat4 uMVP; uniform float uTime;
    ${SWAY}
    void main(){ gl_Position = uMVP * vec4(sway(aPos, aSway, uTime), 1.0); }`;
  const DEPTH_FS = HDR + `void main(){}`;

  const LIT_VS = HDR + `
    layout(location=0) in vec3 aPos;
    layout(location=1) in vec3 aNrm;
    layout(location=2) in vec3 aCol;
    uniform mat4 uModel, uViewProj, uLightVP; uniform float uTime;
    ${SWAY}
    out vec3 vN; out vec3 vCol; out vec3 vWorld; out vec4 vLP;
    void main(){
      vec4 w = uModel * vec4(aPos, 1.0); w.xyz = sway(w.xyz, aSway, uTime);
      vWorld = w.xyz; vN = normalize(mat3(uModel) * aNrm); vCol = aCol; vLP = uLightVP * w;
      gl_Position = uViewProj * w;
    }`;
  // Mapeamento de tons "ACES" (usado no cinema): comprime as luzes sem estourar e dá contraste suave,
  // mais uma correção de cor: sombras levemente azuis, luzes levemente quentes, cores um pouco mais vivas.
  const TONE = `
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 grade(vec3 c){
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, 1.14);
      return c * mix(vec3(0.93, 1.0, 1.09), vec3(1.07, 1.0, 0.93), smoothstep(0.08, 0.7, l));
    }`;

  const LIT_FS = HDR + `
    in vec3 vN; in vec3 vCol; in vec3 vWorld; in vec4 vLP;
    uniform sampler2D uShadow;
    uniform vec3 uLightDir, uLightCol, uAmbUp, uAmbDown, uCamPos, uFogCol, uRimCol;
    uniform float uEmissive, uClip, uFogDen, uExposure, uRim, uFill;
    out vec4 o;
    ${TONE}
    float shadowAt(float ndl){
      vec3 p = vLP.xyz / vLP.w * 0.5 + 0.5;
      if (p.x < 0. || p.x > 1. || p.y < 0. || p.y > 1. || p.z > 1.) return 1.0;
      float bias = 0.0012 + 0.003 * (1.0 - ndl);
      vec2 ts = 1.0 / vec2(textureSize(uShadow, 0));
      float s = 0.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
        float d = texture(uShadow, p.xy + vec2(float(x), float(y)) * ts * 1.4).r;
        s += (p.z - bias > d) ? 0.0 : 1.0;
      }
      return s / 9.0;
    }
    void main(){
      if (vWorld.y < uClip) discard;
      vec3 N = normalize(vN), V = normalize(uCamPos - vWorld);
      float ndl = max(dot(N, uLightDir), 0.0);
      float sh = shadowAt(ndl);
      vec3 amb = mix(uAmbDown, uAmbUp, N.y * 0.5 + 0.5);
      vec3 col = vCol * (amb + uLightCol * ndl * sh);
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * uRim;
      col += uRimCol * rim * (0.35 + 0.65 * sh) * vCol * 2.0;
      col += vCol * uFill * (0.25 + 0.75 * max(dot(N, V), 0.0)) * vec3(0.55, 0.72, 1.0);
      float em = clamp(uEmissive, 0.0, 1.0);
      col = mix(col, vCol * (1.0 + uEmissive * 1.6), em);
      float d = length(uCamPos - vWorld);
      col = mix(col, uFogCol, (1.0 - exp(-d * uFogDen)) * (1.0 - em * 0.8));
      o = vec4(grade(aces(col * uExposure)), uEmissive > 0.5 ? 1.0 : 0.0);
    }`;

  const SKY_VS = HDR + `
    layout(location=0) in vec3 aPos;
    uniform mat4 uViewProj; uniform vec3 uCamPos;
    out vec3 vDir;
    void main(){ vDir = normalize(aPos); vec4 p = uViewProj * vec4(aPos * 400.0 + uCamPos, 1.0); gl_Position = p.xyww; }`;
  const SKY_FS = HDR + `
    in vec3 vDir; uniform vec3 uMoon; uniform float uExposure, uTime; out vec4 o;
    ${TONE}
    float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      float a = h(vec3(i, 1.0)), b = h(vec3(i + vec2(1, 0), 1.0)), c = h(vec3(i + vec2(0, 1), 1.0)), d = h(vec3(i + vec2(1, 1), 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int k = 0; k < 5; k++) { v += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
    void main(){
      vec3 d = normalize(vDir); float y = d.y;
      vec3 hor = vec3(0.14, 0.28, 0.36), mid = vec3(0.04, 0.10, 0.20), zen = vec3(0.008, 0.025, 0.09);
      vec3 col = mix(hor, mid, smoothstep(0.0, 0.25, y)); col = mix(col, zen, smoothstep(0.2, 0.9, y));
      if (y < 0.0) col = mix(hor, vec3(0.02, 0.05, 0.06), clamp(-y * 4.0, 0.0, 1.0));
      col += step(0.9968, h(floor(d * 230.0))) * vec3(0.8, 0.9, 1.0) * clamp(y * 3.0, 0.0, 1.0) * (0.6 + 0.4 * sin(uTime * 2.0 + h(floor(d * 230.0)) * 30.0));
      float m = dot(d, normalize(uMoon));
      // nuvens: um plano alto que anda devagar com o vento, iluminado pela lua
      vec2 cuv = d.xz / max(y + 0.12, 0.06) * 0.8 + vec2(uTime * 0.012, uTime * 0.004);
      float cl = smoothstep(0.50, 0.82, fbm(cuv * 1.4)) * smoothstep(0.02, 0.22, y);
      vec3 cloudCol = mix(vec3(0.07, 0.11, 0.2), vec3(0.62, 0.74, 0.95), pow(max(m, 0.0), 6.0) * 1.4 + 0.12);
      col = mix(col, cloudCol, cl * 0.7);
      float disc = smoothstep(0.9972, 0.9984, m) * (1.0 - cl * 0.85);
      col += vec3(1.0, 0.97, 0.88) * disc * 2.6 + vec3(0.5, 0.62, 0.9) * pow(max(m, 0.0), 48.0) * 0.55 + vec3(0.3, 0.4, 0.7) * pow(max(m, 0.0), 6.0) * 0.14;
      o = vec4(grade(aces(col * uExposure)), disc > 0.5 ? 1.0 : 0.0);
    }`;

  const GRASS_VS = HDR + `
    layout(location=0) in vec3 aBlade;
    layout(location=3) in vec4 aI0;   // x, y, z, giro
    layout(location=4) in vec4 aI1;   // altura, largura, variação, fase
    uniform mat4 uViewProj, uLightVP; uniform sampler2D uShadow;
    uniform float uTime, uFogDen, uExposure; uniform vec3 uPlayer, uCamPos, uLightCol, uAmbUp, uFogCol;
    out vec3 vCol;
    ${TONE}
    void main(){
      float hgt = aI1.x, wid = aI1.y, y = aBlade.y;
      float c = cos(aI0.w), s = sin(aI0.w);
      vec3 lp = vec3(aBlade.x * wid, y * hgt, 0.0);
      vec3 wp = vec3(c * lp.x + s * lp.z, lp.y, -s * lp.x + c * lp.z) + aI0.xyz;
      // vento: ondas que andam pelo campo
      float ph = uTime * 1.6 + aI0.x * 0.31 + aI0.z * 0.23 + aI1.w * 0.2;
      float wind = (sin(ph) + 0.5 * sin(ph * 2.3 + 1.7)) * 0.17 * y * y * hgt;
      wp.x += wind; wp.z += wind * 0.6;
      float la = aI1.w * 3.1, lean = (fract(aI1.w * 7.3) - 0.5) * 0.9;     // cada folha pende para um lado
      wp.xz += vec2(cos(la), sin(la)) * lean * y * y * hgt;
      // o herói amassa a grama
      vec2 dv = aI0.xz - uPlayer.xz; float dist = length(dv);
      float push = smoothstep(1.8, 0.0, dist);
      wp.xz += normalize(dv + vec2(1e-4)) * push * y * 0.75 * hgt;
      wp.y -= push * y * y * hgt * 0.5;
      gl_Position = uViewProj * vec4(wp, 1.0);
      // sombra lida na base da folha
      vec4 lq = uLightVP * vec4(aI0.xyz + vec3(0.0, 0.3, 0.0), 1.0);
      vec3 sp = lq.xyz / lq.w * 0.5 + 0.5;
      float sh = 1.0;
      if (sp.x > 0.0 && sp.x < 1.0 && sp.y > 0.0 && sp.y < 1.0) {
        vec2 ts = 1.0 / vec2(textureSize(uShadow, 0)); float t = 0.0;
        for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
          t += (sp.z - 0.002 > texture(uShadow, sp.xy + vec2(float(i), float(j)) * ts * 1.5).r) ? 0.0 : 1.0;
        sh = t / 9.0;
      }
      vec3 base = vec3(0.05, 0.17, 0.10), tip = vec3(0.17, 0.44, 0.22);
      vec3 col = mix(base, tip, y) * (0.75 + 0.5 * aI1.z);
      col *= uAmbUp + uLightCol * sh * (0.3 + 0.5 * y);
      float d = length(uCamPos - wp);
      col = mix(col, uFogCol, 1.0 - exp(-d * uFogDen));
      vCol = grade(aces(col * uExposure));
    }`;
  const GRASS_FS = HDR + `in vec3 vCol; out vec4 o; void main(){ o = vec4(vCol, 0.0); }`;

  const WATER_VS = HDR + `
    layout(location=0) in vec3 aPos;
    layout(location=2) in vec3 aCol;
    uniform mat4 uViewProj; uniform float uTime; out vec3 vWorld; out float vDepth;
    void main(){
      vec3 p = aPos;
      // a superfície sobe e desce com o vento (menos perto da margem, para não "descolar" da terra)
      float gust = 0.6 + 0.4 * sin(uTime * 0.4 + p.x * 0.05);
      p.y += (sin(p.x * 0.9 + p.z * 0.45 - uTime * 2.1) + 0.6 * sin(p.z * 1.3 - uTime * 1.6 + p.x * 0.3)) * 0.04 * gust * smoothstep(0.0, 0.7, aCol.x);
      vWorld = p; vDepth = aCol.x; gl_Position = uViewProj * vec4(p, 1.0);
    }`;
  const WATER_FS = HDR + `
    in vec3 vWorld; in float vDepth;
    uniform sampler2D uRefl; uniform vec2 uRes; uniform float uTime, uExposure; uniform vec3 uCamPos, uLightDir;
    out vec4 o;
    ${TONE}
    void main(){
      vec2 uv = gl_FragCoord.xy / uRes; vec3 p = vWorld;
      // VENTO: ondas viajando na direção do vento + rajadas que passam sobre a lagoa
      vec2 wd = normalize(vec2(1.0, 0.45)), cw = vec2(-wd.y, wd.x);
      float gust = 0.6 + 0.4 * sin(uTime * 0.5 + p.x * 0.04 + p.z * 0.03);
      float k1 = dot(p.xz, wd) * 1.4 - uTime * 2.4, k2 = dot(p.xz, cw) * 2.3 - uTime * 1.7, k3 = dot(p.xz, wd) * 3.7 - uTime * 3.6 + sin(p.z * 1.1) * 0.5;
      vec2 slope = (wd * (cos(k1) * 0.55 + cos(k3) * 0.25) + cw * cos(k2) * 0.3) * (0.55 + 0.9 * gust);
      vec2 off = slope * 0.013;                                       // quanto o reflexo "treme"
      // reflexo: 3 amostras esticadas na vertical (reflexo na água fica alongado) e mais brilhante
      vec3 refl = (texture(uRefl, clamp(uv + off, 0.002, 0.998)).rgb * 0.5
                 + texture(uRefl, clamp(uv + off + vec2(0.0, 0.006), 0.002, 0.998)).rgb * 0.25
                 + texture(uRefl, clamp(uv + off - vec2(0.0, 0.006), 0.002, 0.998)).rgb * 0.25) * 1.3;
      vec3 V = normalize(uCamPos - p);
      float fres = clamp(0.38 + 0.62 * pow(1.0 - V.y, 2.2), 0.0, 1.0);
      vec3 body = grade(aces(mix(vec3(0.05, 0.26, 0.30), vec3(0.01, 0.05, 0.10), smoothstep(0.0, 1.8, vDepth)) * uExposure));
      vec3 col = mix(body, refl, fres * 0.94 + 0.06);
      // brilho da lua nas ondinhas (cintilação que se move) + faixa de lua mais larga
      vec3 N = normalize(vec3(-slope.x * 0.9, 1.0, -slope.y * 0.9));
      vec3 Rv = reflect(-uLightDir, N);
      float spec = pow(max(dot(Rv, V), 0.0), 90.0), path = pow(max(dot(Rv, V), 0.0), 18.0);
      col += vec3(0.85, 0.95, 1.0) * (spec * 0.75 + path * 0.1);
      // riscos de vento: faixas claras que correm sobre a água
      float streak = smoothstep(0.55, 1.0, sin(dot(p.xz, cw) * 3.1 + sin(dot(p.xz, wd) * 0.6 - uTime * 0.8) * 2.0)) * gust;
      col += vec3(0.35, 0.55, 0.65) * streak * 0.12;
      // espuma na margem, "lambendo" a terra
      float foam = smoothstep(0.38, 0.0, vDepth + 0.08 * sin(uTime * 1.6 + p.x * 0.7 + p.z * 0.5)) * (0.5 + 0.5 * sin(vDepth * 30.0 - uTime * 2.2 + p.x * 0.7));
      col += vec3(0.45, 0.8, 0.8) * foam * 0.32;
      o = vec4(col, (spec > 0.3 || foam > 0.7) ? 1.0 : 0.0);
    }`;

  const ASCII_VS = HDR + `void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  // PASSO A (uma execução por CÉLULA): compara a "forma" dos 4x8 sub-pixels da cena com a
  // forma de cada letra ASCII e escolhe a mais parecida (menor erro quadrático).
  const MATCH_FS = HDR + `
    uniform sampler2D uScene, uPat; uniform vec2 uCellPx, uCanvas; uniform float uLod;
    uniform int uN, uRampN; uniform float uRampCov[16]; uniform int uRampIdx[16];
    layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    // lê a cena já suavizada (mipmap): cada amostra representa o pedaço de tela que ela cobre, sem serrilhado
    vec4 S(vec2 canvasPos, float lod){ return textureLod(uScene, canvasPos / uCanvas, lod); }
    void main(){
      ivec2 cell = ivec2(gl_FragCoord.xy);
      vec4 Lr[${SY}]; vec3 msum = vec3(0.0); float lo = 1e9, hi = 0.0, sum = 0.0, em = 0.0;
      for (int j = 0; j < ${SY}; j++) {
        vec4 row;
        for (int i = 0; i < ${SX}; i++) {
          vec4 sp = S((vec2(cell) + vec2((float(i) + 0.5) / ${SX}.0, (float(j) + 0.5) / ${SY}.0)) * uCellPx, uLod);
          float l = lum(sp.rgb);
          row[i] = l; lo = min(lo, l); hi = max(hi, l); sum += l; msum += sp.rgb; em = max(em, sp.a);
        }
        Lr[j] = row;
      }
      vec3 mean = msum / float(${SX * SY});                              // cor média REAL do pedaço (para a luz bater com a imagem)
      float m = sum / float(${SX * SY});
      float contrast = (hi - lo) / max(hi, 0.02);
      float w = smoothstep(0.28, 0.60, contrast) * step(0.04, hi);     // 0 = área lisa (densidade), 1 = contorno (forma)
      vec4 T[${SY}];
      float floorCov = clamp(lo * 0.9, 0.0, 1.0) * 0.55;
      float amp = clamp((hi - lo) * 3.2, 0.0, 0.95);
      for (int j = 0; j < ${SY}; j++) {
        vec4 td = clamp(Lr[j] * 0.9, 0.0, 1.0) * 0.55;
        vec4 ts = floorCov + (Lr[j] - lo) / max(hi - lo, 1e-3) * amp;
        T[j] = mix(td, ts, w);
      }
      float best = 1e9; int bi = 0;
      for (int g = 0; g < uN; g++) {
        float e = 0.0;
        for (int j = 0; j < ${SY}; j++) { vec4 d = T[j] - texelFetch(uPat, ivec2(g, j), 0); e += dot(d, d); }
        if (e < best) { best = e; bi = g; }
      }
      // áreas lisas: rampa de símbolos de "textura" (. : - = + * # @), nunca | ou _
      float tmean = 0.0;
      for (int j = 0; j < ${SY}; j++) tmean += dot(clamp(Lr[j] * 0.9, 0.0, 1.0) * 0.55, vec4(1.0));
      tmean /= float(${SX * SY});
      float jit = (fract(sin(dot(vec2(cell), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.012;
      float bd = 1e9; int di = 0;
      for (int r = 0; r < uRampN; r++) { float d = abs(uRampCov[r] - (tmean + jit)); if (d < bd) { bd = d; di = uRampIdx[r]; } }
      if (w < 0.5) bi = di;
      if (hi < 0.05) bi = 0;                                           // escuro: espaço vazio

      // TINTA QUE PRESERVA A LUZ (como num meio-tom de gráfica): a letra cobre só uma parte da célula (cov);
      // para a célula inteira ter o brilho da imagem, o que sobra de luz é concentrado na tinta da letra.
      float cov = 0.0;
      for (int j = 0; j < ${SY}; j++) cov += dot(texelFetch(uPat, ivec2(bi, j), 0), vec4(1.0));
      cov = max(cov / float(${SX * SY}), 0.14);
      vec3 bgc = mean * 0.07;
      // ganho moderado: letras esparsas ficam um pouco mais claras para compensar, mas sem virar "estrelas" nas áreas escuras
      float gain = clamp(pow(0.42 / cov, 0.65), 0.95, 2.4);
      vec3 ink = clamp(mean * gain + 0.015, 0.0, 1.5);
      float l = lum(ink); ink = mix(vec3(l), ink, 1.45);                // cores mais vivas
      ink *= 1.0 + em * 0.6;
      // brilho (bloom) vindo de células vizinhas emissivas, só no fundo da célula
      vec2 cc = (vec2(cell) + 0.5) * uCellPx;
      vec4 a1 = S(cc + vec2(uCellPx.x, 0.0), 1.0), a2 = S(cc - vec2(uCellPx.x, 0.0), 1.0), a3 = S(cc + vec2(0.0, uCellPx.y), 1.0), a4 = S(cc - vec2(0.0, uCellPx.y), 1.0);
      vec3 glow = a1.rgb * a1.a + a2.rgb * a2.a + a3.rgb * a3.a + a4.rgb * a4.a;
      o0 = vec4(bgc + glow * 0.03, float(bi) / 255.0);
      o1 = vec4(ink, em);
    }`;
  // PASSO B (uma execução por PIXEL da tela): desenha a letra escolhida em alta resolução.
  const SHOW_FS = HDR + `
    uniform sampler2D uC0, uC1, uAtlas; uniform vec2 uGrid, uCell, uCanvas; uniform int uZoom, uStyle; uniform ivec2 uOff; out vec4 o;
    void main(){
      vec2 px = gl_FragCoord.xy;
      // ZOOM: cada célula passa a ocupar uZoom x o tamanho, ampliando a grade em volta do centro da tela.
      ivec2 size = ivec2(uCell) * uZoom, u = ivec2(px) + uOff, cell = u / size, loc = u - cell * size;
      if (u.x < 0 || u.y < 0 || cell.x >= int(uGrid.x) || cell.y >= int(uGrid.y)) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
      vec4 a = texelFetch(uC0, cell, 0), b = texelFetch(uC1, cell, 0);
      float idx = floor(a.a * 255.0 + 0.5);
      // 1 pixel do atlas = 1 pixel da tela: nada é ampliado nem reduzido, então a letra fica nítida
      float ga = texelFetch(uAtlas, ivec2(int(idx) * size.x + loc.x, size.y - 1 - loc.y), 0).r;
      vec3 col = mix(a.rgb, b.rgb, ga);                                  // 100% letras: fundo escuro + tinta colorida
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      if (uStyle == 1) col = vec3(0.22, 1.0, 0.34) * l * 1.15;           // terminal verde
      else if (uStyle == 2) col = vec3(1.0, 0.64, 0.2) * l * 1.1;        // âmbar
      vec2 q2 = px / uCanvas - 0.5;
      col *= 1.0 - dot(q2, q2) * 0.45;
      o = vec4(col, 1.0);
    }`;

  // =============================== AJUDANTES GL ===============================
  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src.split("\n").map((l, i) => (i + 1) + ": " + l).join("\n"));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const cache = {};
    return { p, u: new Proxy(cache, { get: (o, k) => (k in o ? o[k] : (o[k] = gl.getUniformLocation(p, k))) }) };
  }
  function mesh(d, dynamic) {
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const bufs = {};
    const attr = (loc, data, size) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); return b;
    };
    bufs.pos = attr(0, d.pos, 3);
    if (d.nrm) bufs.nrm = attr(1, d.nrm, 3);
    if (d.col) bufs.col = attr(2, d.col, 3);
    if (d.sw) bufs.sw = attr(5, d.sw, 2);
    let count;
    if (d.idx) { const e = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, e); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, d.idx, gl.STATIC_DRAW); count = d.idx.length; }
    else count = d.pos.length / 3;
    gl.bindVertexArray(null);
    return { vao, count, indexed: !!d.idx, bufs };
  }
  function draw(m) {
    gl.bindVertexArray(m.vao);
    if (m.indexed) gl.drawElements(gl.TRIANGLES, m.count, gl.UNSIGNED_INT, 0); else gl.drawArrays(gl.TRIANGLES, 0, m.count);
  }
  function texture(unit, w, h, internal, format, type, filter) {
    const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function colorFBO(unit, w, h) {
    const tex = texture(unit, w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("FBO incompleto");
    return { fb, tex, rb };
  }

  /** Desenha todas as letras lado a lado, cada uma numa caixa de sw x sh pixels. */
  function drawGlyphs(sw, sh) {
    const cv = document.createElement("canvas");
    cv.width = sw * NG; cv.height = sh;
    const c = cv.getContext("2d", { willReadFrequently: true });
    c.fillStyle = "#000"; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
    const size = Math.max(5, Math.round(Math.min(sw * 1.58, sh * 0.82)));
    c.font = `bold ${size}px "DejaVu Sans Mono", Menlo, Consolas, "Courier New", monospace`;
    for (let i = 0; i < NG; i++) {
      c.save(); c.beginPath(); c.rect(i * sw, 0, sw, sh); c.clip();           // uma letra não invade a vizinha
      c.fillText(GLYPHS[i], i * sw + Math.floor(sw / 2), Math.round(sh * 0.54));
      c.restore();
    }
    return cv;
  }

  /** Atlas VISUAL: refeito a cada resize, no tamanho exato da célula na tela. */
  function makeDisplayAtlas(sw, sh) {
    const cv = drawGlyphs(sw, sh);
    gl.activeTexture(gl.TEXTURE3);
    if (texAtlas) gl.deleteTexture(texAtlas);
    texAtlas = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Cria a textura de "formas" das letras, usada para escolher a mais parecida. */
  function makeAtlas() {
    const sw = 24, sh = 48, cv = drawGlyphs(sw, sh), c = cv.getContext("2d");

    // (b) cobertura de cada letra em SX x SY sub-células (média do brilho do desenho)
    const img = c.getImageData(0, 0, cv.width, cv.height).data, pat = new Uint8Array(NG * SY * 4);
    const bw = sw / SX, bh = sh / SY;
    for (let g = 0; g < NG; g++) for (let r = 0; r < SY; r++) for (let q = 0; q < SX; q++) {
      let sum = 0;
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) sum += img[((r * bh + y) * cv.width + g * sw + q * bw + x) * 4];
      const j = SY - 1 - r;                                  // linha 0 = parte de baixo (como o WebGL)
      pat[(j * NG + g) * 4 + q] = Math.round(sum / (bw * bh));
    }
    const RAMP_CH = " .:-~=+*#%@";                       // letras para áreas lisas
    rampIdx = []; rampCov = [];
    for (const ch of RAMP_CH) {
      const g = GLYPHS.indexOf(ch); let sum = 0;
      for (let j = 0; j < SY; j++) for (let q = 0; q < SX; q++) sum += pat[(j * NG + g) * 4 + q] / 255;
      rampIdx.push(g); rampCov.push(sum / (SX * SY));
    }
    texPat = texture(4, NG, SY, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NG, SY, gl.RGBA, gl.UNSIGNED_BYTE, pat);

  }


  // =============================== INICIALIZAÇÃO ===============================
  R.init = function (cv, worldData) {
    canvas = cv;
    gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) return false;
    progs.depth = program(DEPTH_VS, DEPTH_FS); progs.lit = program(LIT_VS, LIT_FS); progs.sky = program(SKY_VS, SKY_FS);
    progs.grass = program(GRASS_VS, GRASS_FS); progs.water = program(WATER_VS, WATER_FS); progs.ascii = program(ASCII_VS, MATCH_FS); progs.show = program(ASCII_VS, SHOW_FS);
    // cada sampler aponta para uma "unidade de textura" fixa: 0=cena 1=sombra 2=reflexo 3=letras
    gl.useProgram(progs.lit.p); gl.uniform1i(progs.lit.u.uShadow, 1);
    gl.useProgram(progs.grass.p); gl.uniform1i(progs.grass.u.uShadow, 1);
    gl.useProgram(progs.water.p); gl.uniform1i(progs.water.u.uRefl, 2);
    gl.useProgram(progs.ascii.p); gl.uniform1i(progs.ascii.u.uScene, 0); gl.uniform1i(progs.ascii.u.uPat, 4);
    gl.useProgram(progs.show.p); gl.uniform1i(progs.show.u.uScene, 0); gl.uniform1i(progs.show.u.uC0, 5); gl.uniform1i(progs.show.u.uC1, 6); gl.uniform1i(progs.show.u.uAtlas, 3);

    const me = R.meshes;
    me.cube = mesh(Geo.cube()); me.cyl = mesh(Geo.cylinder(10)); me.cone = mesh(Geo.cone(10));
    me.tap = mesh(Geo.taper(1.35, 10)); me.tapT = mesh(Geo.taper(1.55, 12));   // membros e tronco (mais largos em cima)
    me.sph = mesh(Geo.sphere(8, 12)); me.torus = mesh(Geo.torus(0.4, 0.035, 28, 6));
    skyMesh = mesh(Geo.sphere(12, 18));

    // sombra: textura de profundidade
    texShadow = texture(1, SHADOW, SHADOW, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
    fbShadow = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbShadow);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texShadow, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("FBO de sombra incompleto");

    makeAtlas();
    R.setWorld(worldData);
    R.resize();
    R.ok = true;
    return true;
  };

  R.setWorld = function (w) {
    world = w;
    staticMesh = mesh(w.static); waterMesh = mesh(w.water);
    ribbon = mesh({ pos: new Float32Array(600 * 3), nrm: new Float32Array(600 * 3), col: new Float32Array(600 * 3) }, true);
    const bl = Geo.blade(); bladeCount = bl.idx.length;
    grassVAO = gl.createVertexArray(); gl.bindVertexArray(grassVAO);
    const bb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bb); gl.bufferData(gl.ARRAY_BUFFER, bl.pos, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const eb = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, eb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bl.idx, gl.STATIC_DRAW);
    grassBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, grassBuf); gl.bufferData(gl.ARRAY_BUFFER, w.grass, gl.STATIC_DRAW);
    for (const loc of [3, 4]) { gl.enableVertexAttribArray(loc); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    chunks = w.chunks;
  };

  /** Recalcula o tamanho da tela, das células de caractere e das texturas. */
  R.resize = function () {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);          // usa toda a densidade do iPhone (3x)
    const cssW = window.innerWidth, cssH = window.innerHeight;
    const fine = window.matchMedia("(pointer: fine)").matches;     // computador (mouse)
    // colunas desejadas (fino / médio / grande). No estilo "Cinema" as letras são só uma textura fina, então as células são bem pequenas.
    const tbl = fine ? [230, 165, 105] : [190, 135, 85];
    const target = tbl[R.detail] ?? 150;
    const cw = Math.max(3, Math.min(12, Math.round(cssW / target)));
    const ch = Math.round(cw * 1.9);
    cellPx = [Math.round(cw * dpr), Math.round(ch * dpr)];
    cols = Math.ceil((cssW * dpr) / cellPx[0]); rows = Math.ceil((cssH * dpr) / cellPx[1]);
    canvas.width = cols * cellPx[0]; canvas.height = rows * cellPx[1];
    canvas.style.width = canvas.width / dpr + "px"; canvas.style.height = canvas.height / dpr + "px";
    zoom = Math.min(zoom, maxZoom());
    makeDisplayAtlas(cellPx[0] * zoom, cellPx[1] * zoom);
    const q = Math.min(1, 2 / dpr);                                  // a cena 3D é só a FONTE das letras: até 2x CSS px
    W = Math.max(64, Math.round(canvas.width * q)); H = Math.max(64, Math.round(canvas.height * q));
    if (fbScene) {
      for (const f of [fbScene, fbRefl]) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); gl.deleteRenderbuffer(f.rb); }
      gl.deleteFramebuffer(fbCell.fb); gl.deleteTexture(fbCell.t0); gl.deleteTexture(fbCell.t1);
    }
    fbScene = colorFBO(0, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbScene.tex);      // mipmaps: usados no brilho (bloom)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    RW = Math.max(64, Math.round(W * 0.75)); RH = Math.max(64, Math.round(H * 0.75));
    fbRefl = colorFBO(2, RW, RH);
    // uma textura pequena (1 pixel por célula) com duas camadas: fundo+letra e cor da tinta
    const t0 = texture(5, cols, rows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    const t1 = texture(6, cols, rows, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.NEAREST);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t1, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("FBO de células incompleto");
    fbCell = { fb, t0, t1 };
    R.cols = cols; R.rows = rows;
  };
  /** Tema de cor das letras: 0 coloridas, 1 terminal verde, 2 âmbar. */
  R.setStyle = function (n) {
    R.style = ((n % 3) + 3) % 3;
    try { localStorage.setItem('rc_theme', String(R.style)); } catch (_) { /* ok */ }
    R.resize();
  };


  /** Maior zoom que cabe numa textura (o atlas tem NG letras lado a lado). */
  function maxZoom() {
    const lim = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let z = 4;
    while (z > 1 && (NG * cellPx[0] * z > lim || cellPx[1] * z > lim)) z--;
    return z;
  }
  /** Zoom de 1x a 4x. Refaz as letras no tamanho ampliado (nítidas, não esticadas). */
  R.setZoom = function (z) {
    z = Math.max(1, Math.min(maxZoom(), Math.round(z)));
    if (z !== zoom) { zoom = z; makeDisplayAtlas(cellPx[0] * zoom, cellPx[1] * zoom); }
    if (R.onZoom) R.onZoom(zoom);
    return zoom;
  };
  R.getZoom = () => zoom;
  R.maxZoom = () => (gl ? maxZoom() : 1);

  /** Depuração: devolve a imagem 3D "crua" (antes de virar caracteres) como PNG. */
  R.dumpScene = function () {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbScene.fb);
    const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const c = cv.getContext("2d"), img = c.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = ((H - 1 - y) * W + x) * 4, b = (y * W + x) * 4;
      img.data[b] = px[a]; img.data[b + 1] = px[a + 1]; img.data[b + 2] = px[a + 2]; img.data[b + 3] = 255;
    }
    c.putImageData(img, 0, 0); return cv.toDataURL("image/png");
  };

  // =============================== DESENHO ===============================
  const IDENT = M.ident();
  function setLit(vp, cam, clip) {
    const u = progs.lit.u;
    gl.useProgram(progs.lit.p);
    gl.uniformMatrix4fv(u.uViewProj, false, vp); gl.uniformMatrix4fv(u.uLightVP, false, R._lightVP);
    gl.uniform3f(u.uLightDir, L[0], L[1], L[2]); gl.uniform3f(u.uLightCol, 0.72, 0.82, 1.08);
    gl.uniform3f(u.uAmbUp, 0.18, 0.27, 0.40); gl.uniform3f(u.uAmbDown, 0.05, 0.08, 0.12);
    gl.uniform3f(u.uCamPos, cam.x, cam.y, cam.z); gl.uniform3f(u.uFogCol, 0.07, 0.14, 0.19);
    gl.uniform3f(u.uRimCol, 0.5, 0.75, 1.0); gl.uniform1f(u.uRim, 0.55);
    gl.uniform1f(u.uFogDen, 0.011); gl.uniform1f(u.uExposure, 1.15); gl.uniform1f(u.uClip, clip); gl.uniform1f(u.uTime, R._t); gl.uniform1f(u.uFill, 0.06);
  }

  /** Desenha tudo que se mexe, usando "part" (que muda conforme a passada). */
  function drawEntities(part, s, pass) {
    const me = R.meshes, p = s.player, T = s.t;
    if (!s.over || s.over !== "lose") Game.Models.drawPlayer(part, p, T);
    for (const e of s.enemies) Game.Models.drawEnemy(part, e, T);
    if (pass === "shadow") return;
    for (const r of world.runes) part(me.cube, M.chain(M.T(r.x, r.y, r.z), M.Ry(r.yaw), M.S(r.w, r.h, 0.05)), [0.4, 0.95, 1.0], 1);
    for (const o of s.orbs) {
      const y = Game.World.height(o.x, o.z) + 0.7 + Math.sin(o.t * 3) * 0.15, k = 0.28 + Math.sin(o.t * 6) * 0.05;
      part(me.sph, M.chain(M.T(o.x, y, o.z), M.S(k, k, k)), [0.35, 1.0, 0.5], 1);
    }
    if (pass === "reflect") return;
    for (const d of s.decals) {                                   // sangue no chão (some devagar)
      const k = Math.min(1, d.life / 4);
      part(me.sph, M.chain(M.T(d.x, d.y, d.z), M.Ry(d.yaw), M.S(d.size, 0.05, d.size * 0.65)), [0.46 * k, 0.012 * k, 0.03 * k], 0.3);
    }
    for (const g of s.ghosts) {
      const k = g.life / g.max;
      Game.Models.drawPlayer(part, { x: g.x, y: g.y, z: g.z, yaw: g.yaw, walk: g.walk, speed01: 1, attackT: -1, dashT: 1, flash: 0, attackDir: 1, twist: 0 }, T, { color: [0.2 * k, 0.8 * k, 1.0 * k], em: 0.9 });
    }
    for (const q of s.particles) {
      const k = Math.max(0, q.life / q.max), sz = q.size * (0.4 + 0.6 * k);
      part(me.cube, M.chain(M.T(q.x, q.y, q.z), M.S(sz, sz, sz)), [q.color[0] * k, q.color[1] * k, q.color[2] * k], q.em);
    }
    for (const f of world.fireflies) {
      if (Math.abs(f.x - p.x) > 38 || Math.abs(f.z - p.z) > 38) continue;
      const x = f.x + Math.sin(T * 0.7 + f.ph) * 1.2, z = f.z + Math.cos(T * 0.6 + f.ph * 1.3) * 1.2, y = f.y + Math.sin(T * 1.3 + f.ph) * 0.4;
      const b = 0.5 + 0.5 * Math.sin(T * 2.4 + f.ph * 3), sz = 0.11 + 0.05 * b;
      part(me.cube, M.chain(M.T(x, y, z), M.S(sz, sz, sz)), [0.9 * b + 0.2, 1.0 * b + 0.2, 0.5 * b], 1);
    }
  }

  /** Fita brilhante atrás da espada. */
  function buildRibbon(s) {
    const tr = s.trail, P = ribbon.bufs; let n = 0;
    const pos = new Float32Array(600 * 3), nrm = new Float32Array(600 * 3), col = new Float32Array(600 * 3);
    const put = (pt, c) => { pos.set(pt, n * 3); nrm[n * 3 + 1] = 1; col.set(c, n * 3); n++; };
    for (let i = 0; i < tr.length - 1 && n < 590; i++) {
      const a = tr[i], b = tr[i + 1];
      if (b.at - a.at > 0.08) continue;
      const ka = Math.pow(a.life / a.max, 1.4), kb = Math.pow(b.life / b.max, 1.4);
      const ca = [0.7 * ka, 0.9 * ka, 1.0 * ka], cb = [0.7 * kb, 0.9 * kb, 1.0 * kb];
      put(a.b, [ca[0] * 0.5, ca[1] * 0.5, ca[2] * 0.5]); put(a.t, ca); put(b.t, cb);
      put(a.b, [ca[0] * 0.5, ca[1] * 0.5, ca[2] * 0.5]); put(b.t, cb); put(b.b, [cb[0] * 0.5, cb[1] * 0.5, cb[2] * 0.5]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, P.pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.nrm); gl.bufferSubData(gl.ARRAY_BUFFER, 0, nrm);
    gl.bindBuffer(gl.ARRAY_BUFFER, P.col); gl.bufferSubData(gl.ARRAY_BUFFER, 0, col);
    ribbon.count = n;
  }

  function drawGrass(vp, cam, s) {
    const g = progs.grass, u = g.u, p = s.player;
    gl.useProgram(g.p);
    gl.uniformMatrix4fv(u.uViewProj, false, vp); gl.uniformMatrix4fv(u.uLightVP, false, R._lightVP);
    gl.uniform1f(u.uTime, s.t); gl.uniform3f(u.uPlayer, p.x, p.y, p.z); gl.uniform3f(u.uCamPos, cam.x, cam.y, cam.z);
    gl.uniform3f(u.uLightCol, 0.72, 0.82, 1.08); gl.uniform3f(u.uAmbUp, 0.20, 0.27, 0.40); gl.uniform3f(u.uFogCol, 0.07, 0.14, 0.19);
    gl.uniform1f(u.uFogDen, 0.011); gl.uniform1f(u.uExposure, 1.15);
    gl.bindVertexArray(grassVAO); gl.bindBuffer(gl.ARRAY_BUFFER, grassBuf);
    for (const c of chunks) {
      if (!c.count || Math.hypot(c.cx - cam.tx, c.cz - cam.tz) > 27) continue;
      const off = c.start * 32;
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, off); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, off + 16);
      gl.drawElementsInstanced(gl.TRIANGLES, bladeCount, gl.UNSIGNED_INT, 0, c.count);
    }
  }

  R.render = function (s) {
    R._t = s.t;
    const cam = s.cam, p = s.player, me = R.meshes;
    cam.aspect = canvas.width / canvas.height;
    const view = M.lookAt([cam.x, cam.y, cam.z], [cam.tx, cam.ty, cam.tz], [0, 1, 0]);
    const vp = M.mul(M.perspective(cam.fov, cam.aspect, 0.3, 500), view);
    const vpR = M.mul(vp, M.S(1, -1, 1));

    // ---- luz da lua (matriz que olha a cena de cima), "encaixada" em texels p/ a sombra não tremer ----
    let tgt = [p.x, p.y, p.z];
    let lv = M.lookAt([tgt[0] + L[0] * 70, tgt[1] + L[1] * 70, tgt[2] + L[2] * 70], tgt, [0, 1, 0]);
    const texel = (2 * EXT) / SHADOW, rx = [lv[0], lv[4], lv[8]], ry = [lv[1], lv[5], lv[9]];
    const dr = tgt[0] * rx[0] + tgt[1] * rx[1] + tgt[2] * rx[2], du = tgt[0] * ry[0] + tgt[1] * ry[1] + tgt[2] * ry[2];
    const sr = Math.floor(dr / texel) * texel - dr, su = Math.floor(du / texel) * texel - du;
    tgt = [tgt[0] + rx[0] * sr + ry[0] * su, tgt[1] + rx[1] * sr + ry[1] * su, tgt[2] + rx[2] * sr + ry[2] * su];
    lv = M.lookAt([tgt[0] + L[0] * 70, tgt[1] + L[1] * 70, tgt[2] + L[2] * 70], tgt, [0, 1, 0]);
    const lightVP = M.mul(M.ortho(-EXT, EXT, -EXT, EXT, 1, 150), lv);
    R._lightVP = lightVP;

    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);

    // ---- 1) SOMBRA ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbShadow); gl.viewport(0, 0, SHADOW, SHADOW);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(progs.depth.p); const du2 = progs.depth.u; gl.uniform1f(du2.uTime, s.t);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
    gl.uniformMatrix4fv(du2.uMVP, false, lightVP); draw(staticMesh);
    drawEntities((m, mat, c, em) => { if (em >= 1) return; gl.uniformMatrix4fv(du2.uMVP, false, M.mul(lightVP, mat)); draw(m); }, s, "shadow");
    gl.disable(gl.POLYGON_OFFSET_FILL);

    const litPart = (m, mat, c, em) => {
      gl.uniformMatrix4fv(progs.lit.u.uModel, false, mat); gl.vertexAttrib4f(2, c[0], c[1], c[2], 1);
      gl.uniform1f(progs.lit.u.uEmissive, em || 0); draw(m);
    };
    const litEnt = (m, mat, c, em) => { gl.uniform1f(progs.lit.u.uFill, 1.5); gl.uniform1f(progs.lit.u.uRim, 1.7); litPart(m, mat, c, em); };
    const drawSky = (matrix) => {
      gl.useProgram(progs.sky.p); const u = progs.sky.u;
      gl.uniformMatrix4fv(u.uViewProj, false, matrix); gl.uniform3f(u.uCamPos, cam.x, cam.y, cam.z);
      gl.uniform3f(u.uMoon, L[0], L[1], L[2]); gl.uniform1f(u.uExposure, 1.5); gl.uniform1f(u.uTime, R._t);
      gl.depthMask(false); draw(skyMesh); gl.depthMask(true);
    };

    // ---- 2) REFLEXO (mundo espelhado em y=0; descarta o que está abaixo da água) ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbRefl.fb); gl.viewport(0, 0, RW, RH);
    gl.clearColor(0.03, 0.07, 0.1, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawSky(vpR);
    setLit(vpR, cam, -0.01); gl.uniform1f(progs.lit.u.uEmissive, 0);
    gl.uniformMatrix4fv(progs.lit.u.uModel, false, IDENT); draw(staticMesh);
    drawEntities(litEnt, s, "reflect");

    // ---- 3) CENA ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbScene.fb); gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawSky(vp);
    setLit(vp, cam, -1e9);
    gl.uniform1f(progs.lit.u.uEmissive, 0);
    gl.uniformMatrix4fv(progs.lit.u.uModel, false, IDENT); draw(staticMesh);
    drawGrass(vp, cam, s);
    gl.useProgram(progs.lit.p);
    drawEntities(litEnt, s, "main");
    gl.uniform1f(progs.lit.u.uRim, 0.55);
    if (s.trail.length > 1) {                                 // rastro da espada
      buildRibbon(s);
      gl.uniformMatrix4fv(progs.lit.u.uModel, false, IDENT); gl.uniform1f(progs.lit.u.uEmissive, 1); draw(ribbon);
    }
    // água por último (opaca, com o reflexo que acabamos de renderizar)
    const wu = progs.water.u; gl.useProgram(progs.water.p);
    gl.uniformMatrix4fv(wu.uViewProj, false, vp); gl.uniform2f(wu.uRes, W, H);
    gl.uniform1f(wu.uTime, s.t); gl.uniform1f(wu.uExposure, 1.15);
    gl.uniform3f(wu.uCamPos, cam.x, cam.y, cam.z); gl.uniform3f(wu.uLightDir, L[0], L[1], L[2]);
    draw(waterMesh);

    // ---- 4) ASCII, em dois passos ----
    gl.disable(gl.DEPTH_TEST); gl.bindVertexArray(null);
    // A) uma execução por célula: escolhe a letra cuja FORMA mais se parece com o pedaço da imagem
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fbScene.tex); gl.generateMipmap(gl.TEXTURE_2D);   // pirâmide de versões suavizadas da cena
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbCell.fb); gl.viewport(0, 0, cols, rows);
    const m = progs.ascii; gl.useProgram(m.p); gl.uniform1i(m.u.uN, NG);
    gl.uniform2f(m.u.uCellPx, cellPx[0], cellPx[1]); gl.uniform2f(m.u.uCanvas, canvas.width, canvas.height);
    gl.uniform1f(m.u.uLod, Math.max(0, Math.log2(Math.max(cellPx[0] / SX * (W / canvas.width), cellPx[1] / SY * (H / canvas.height))) + 0.05));   // suaviza ~1 amostra por sub-célula
    gl.uniform1i(m.u.uRampN, rampIdx.length); gl.uniform1fv(m.u.uRampCov, rampCov); gl.uniform1iv(m.u.uRampIdx, rampIdx);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // B) desenha as letras escolhidas em resolução total
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
    const a = progs.show; gl.useProgram(a.p);
    gl.uniform2f(a.u.uGrid, cols, rows); gl.uniform2f(a.u.uCell, cellPx[0], cellPx[1]);
    gl.uniform1i(a.u.uZoom, zoom); gl.uniform1i(a.u.uStyle, R.style); gl.uniform2f(a.u.uCanvas, canvas.width, canvas.height);
    gl.uniform2i(a.u.uOff, Math.round((canvas.width / 2) * (zoom - 1)), Math.round((canvas.height / 2) * (zoom - 1)));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
  };
})();
