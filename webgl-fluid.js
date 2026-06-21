/* 2D Wave Ripple Simulation — Multi-Colour Watercolour on Paper */

class WebGLFluid {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = this.canvas.getContext('webgl', {
      alpha: false, depth: false, antialias: false, stencil: false
    }) || this.canvas.getContext('experimental-webgl', {
      alpha: false, depth: false, antialias: false, stencil: false
    });
    if (!this.gl) { console.error('WebGL not supported.'); return; }

    this.simWidth = this.simHeight = 0;
    this.dyeWidth = this.dyeHeight = 0;

    this.config = {
      SIM_RESOLUTION: 256,
      DYE_RESOLUTION: 512,
      WAVE_SPEED:    0.40,    // propagation speed (higher = crisper rings)
      WAVE_DAMPING:  0.988,   // gentle fade so rings travel far
      DYE_PUSH:      0.055,   // how hard waves push ink outward
      DYE_DECAY:     0.995,   // ink fades gently
      SPLAT_RADIUS:  0.016,
      SPECULAR:      0.18,    // subtle gloss on crests
      RING_SHADOW:   0.12,    // how dark the ring trough shadow is
      RING_HILITE:   0.06,    // how bright the ring crest highlight is
      DYE_SCALE:     7.0,     // display: mag → density
      INK_DARKNESS:  0.38,    // Beer-Lambert absorption coefficient
      PAPER_COLOR:  [252/255, 250/255, 245/255],
    };

    this.initWebGL();
    this.resize();
    this.clear();
  }

  initWebGL() {
    const gl = this.gl;
    this.halfFloat = gl.getExtension('OES_texture_half_float');
    this.supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    const hfWrite = gl.getExtension('EXT_color_buffer_half_float');
    this.floatTex = gl.getExtension('OES_texture_float');
    const fWrite  = gl.getExtension('WEBGL_color_buffer_float');

    if (this.halfFloat && hfWrite) {
      this.texType = this.halfFloat.HALF_FLOAT_OES || 0x8D61;
    } else if (this.floatTex && fWrite) {
      this.texType = gl.FLOAT;
      this.supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
      this.texType = gl.UNSIGNED_BYTE;
      this.supportLinearFiltering = true;
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    /* ── Vertex shaders ─────────────────────────────────────────────── */
    const simpleVS = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main(){
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`;

    const neighborVS = `
      attribute vec2 aPosition;
      varying vec2 vUv, vL, vR, vB, vT;
      uniform vec2 uTexelSize;
      void main(){
        vUv = aPosition * 0.5 + 0.5;
        vL  = vUv - vec2(uTexelSize.x, 0.0);
        vR  = vUv + vec2(uTexelSize.x, 0.0);
        vB  = vUv - vec2(0.0, uTexelSize.y);
        vT  = vUv + vec2(0.0, uTexelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`;

    /* ── Wave propagation ───────────────────────────────────────────── */
    const waveFS = `
      precision highp float;
      varying vec2 vUv, vL, vR, vB, vT;
      uniform sampler2D uWave;
      uniform float uSpeed;
      uniform float uDamping;
      void main(){
        float cur  = texture2D(uWave, vUv).r - 0.5;
        float prev = texture2D(uWave, vUv).g - 0.5;
        float L    = texture2D(uWave, vL).r - 0.5;
        float R    = texture2D(uWave, vR).r - 0.5;
        float B    = texture2D(uWave, vB).r - 0.5;
        float T    = texture2D(uWave, vT).r - 0.5;
        float next = (2.0*cur - prev + uSpeed*(L+R+B+T - 4.0*cur)) * uDamping;
        next = clamp(next, -0.48, 0.48);
        gl_FragColor = vec4(next+0.5, cur+0.5, 0.0, 1.0);
      }`;

    /* ── Wave impulse ───────────────────────────────────────────────── */
    const waveSplatFS = `
      precision highp float;
      uniform sampler2D uWave;
      uniform vec2  uPoint;
      uniform float uStrength;
      uniform float uRadius;
      uniform float uAspect;
      varying vec2  vUv;
      void main(){
        vec2 p = vUv - uPoint; p.x *= uAspect;
        float splat = exp(-dot(p,p)/(uRadius*uRadius));
        vec4  base  = texture2D(uWave, vUv);
        float cur   = clamp((base.r-0.5) + uStrength*splat, -0.48, 0.48);
        gl_FragColor = vec4(cur+0.5, base.g, 0.0, 1.0);
      }`;

    /* ── Ink / dye splat (stores actual RGB ink colour) ─────────────── */
    const dyeSplatFS = `
      precision highp float;
      uniform sampler2D uDye;
      uniform vec2  uPoint;
      uniform vec3  uColor;
      uniform float uRadius;
      uniform float uAspect;
      varying vec2  vUv;
      void main(){
        vec2  p     = vUv - uPoint; p.x *= uAspect;
        float splat = exp(-dot(p,p)/(uRadius*uRadius));
        vec3  base  = texture2D(uDye, vUv).rgb;
        gl_FragColor = vec4(base + uColor*splat, 1.0);
      }`;

    /* ── Dye advect along wave gradient ─────────────────────────────── */
    const dyeAdvectFS = `
      precision highp float;
      varying vec2 vUv, vL, vR, vB, vT;
      uniform sampler2D uDye;
      uniform sampler2D uWave;
      uniform vec2  uTexelSize;
      uniform float uPush;
      uniform float uDecay;
      void main(){
        float wL = texture2D(uWave, vL).r;
        float wR = texture2D(uWave, vR).r;
        float wB = texture2D(uWave, vB).r;
        float wT = texture2D(uWave, vT).r;
        vec2 grad = vec2(wR-wL, wT-wB) * uPush;
        vec2 coord = clamp(vUv - grad*uTexelSize, vec2(0.001), vec2(0.999));
        gl_FragColor = texture2D(uDye, coord) * uDecay;
      }`;

    /* ── Display: ripple rings visible on bare paper + multi-colour ink ─ */
    const displayFS = `
      precision highp float;
      varying vec2 vUv, vL, vR, vB, vT;
      uniform sampler2D uDye;
      uniform sampler2D uWave;
      uniform vec3  uPaper;
      uniform float uSpecular;
      uniform float uRingShadow;
      uniform float uRingHilite;
      uniform float uDyeScale;
      uniform float uInkDarkness;

      float hash(vec2 p){ p=fract(p*vec2(127.1,311.7)); return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      float noise(vec2 p){
        vec2 i=floor(p), f=fract(p), u=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);
      }
      float fbm(vec2 p){
        float v=0.0, a=0.5;
        mat2 r=mat2(0.88,0.48,-0.48,0.88);
        for(int i=0;i<5;i++){ v+=a*noise(p); p=r*p*2.1+vec2(100.0); a*=0.46; }
        return v;
      }

      void main(){
        /* ── Paper base with FBM grain ─────────────────────── */
        vec2  pc = vUv * 1100.0;
        float h  = fbm(pc);
        float hL = fbm(pc-vec2(1.8,0.0)), hR = fbm(pc+vec2(1.8,0.0));
        float hB = fbm(pc-vec2(0.0,1.8)), hT = fbm(pc+vec2(0.0,1.8));
        vec2  dn = vec2(hR-hL, hT-hB);
        float lit  = 1.0 - 0.055*dn.x - 0.055*dn.y - (1.0-h)*0.018;
        vec3  paper = clamp(uPaper * lit, 0.0, 1.0);

        /* ── Wave surface (always sampled, rings on bare paper) ─ */
        float wC  = texture2D(uWave, vUv).r - 0.5;
        float wL_ = texture2D(uWave, vL).r  - 0.5;
        float wR_ = texture2D(uWave, vR).r  - 0.5;
        float wB_ = texture2D(uWave, vB).r  - 0.5;
        float wT_ = texture2D(uWave, vT).r  - 0.5;
        vec2  wGrad = vec2(wR_-wL_, wT_-wB_);
        float wGM   = length(wGrad);     // gradient magnitude = ring-front marker

        /* Trough darkens paper, crest brightens it — makes concentric rings
           visible even with zero ink. Shadow/highlight are gentle. */
        float trough   = clamp(-wC * 6.0, 0.0, 1.0);   // dark in valleys
        float crest    = clamp( wC * 6.0, 0.0, 1.0);   // light on peaks
        float ringFront = clamp(wGM * 14.0, 0.0, 1.0); // the moving ring wall

        vec3 ringPaper = paper
          - vec3(trough   * uRingShadow)   // shadow in troughs
          + vec3(crest    * uRingHilite)   // highlight on crests
          - vec3(ringFront* uRingShadow * 0.5); // dark ring-front wall
        ringPaper = clamp(ringPaper, 0.0, 1.0);

        /* ── Specular on wave crest ────────────────────────── */
        vec3 norm  = normalize(vec3(-wGrad*20.0, 1.0));
        vec3 light = normalize(vec3(0.4, 0.7, 1.4));
        float spec = pow(max(dot(norm, normalize(light+vec3(0,0,1))),0.0), 32.0)
                     * uSpecular;

        /* ── Multi-colour ink — Beer-Lambert subtractive wash ── */
        /* Light passes through pigment, paper reflects it back.
           Ink absorbs its complement → vivid, luminous watercolour. */
        vec3  dye     = texture2D(uDye, vUv).rgb;
        float mag     = length(dye);
        float density = clamp(mag * uDyeScale, 0.0, 1.0);

        vec3 col = ringPaper;
        if (density > 0.001) {
          vec3 inkDir = dye / (mag + 0.001);   // normalised ink hue

          /* Wet-paper grain: ink pools in valleys for a more organic wash */
          float wetH  = mix(1.0, 0.68 + 0.58*h, density);
          float k     = density * wetH * uInkDarkness * 6.0;

          /* Beer-Lambert: each channel absorbed by its complement */
          vec3 absorb = (1.0 - inkDir) * k;
          vec3 transm = exp(-absorb);           // transmittance per channel
          col = ringPaper * transm;             // paper shines through pigment
        }

        col += vec3(spec);
        gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      }`;

    this.waveUpdateProgram = this.createProgram(neighborVS, waveFS);
    this.waveSplatProgram  = this.createProgram(simpleVS,   waveSplatFS);
    this.dyeSplatProgram   = this.createProgram(simpleVS,   dyeSplatFS);
    this.dyeAdvectProgram  = this.createProgram(neighborVS, dyeAdvectFS);
    this.displayProgram    = this.createProgram(neighborVS, displayFS);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  }

  compileShader(type, src) {
    const gl = this.gl;
    const s  = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(s)); return null;
    }
    return s;
  }

  createProgram(vs, fs) {
    const gl = this.gl;
    const v  = this.compileShader(gl.VERTEX_SHADER,   vs);
    const f  = this.compileShader(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Link error:', gl.getProgramInfoLog(p)); return null;
    }
    return p;
  }

  makeFBO(w, h) {
    const gl  = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const filt = this.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, this.texType, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo };
  }

  makeDoubleFBO(w, h) {
    let a = this.makeFBO(w, h), b = this.makeFBO(w, h);
    return { get read(){ return a; }, get write(){ return b; },
             swap(){ const t=a; a=b; b=t; } };
  }

  resize() {
    const gl = this.gl;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W; this.canvas.height = H;
    }
    const ratio = H / W;
    this.simWidth  = this.config.SIM_RESOLUTION;
    this.simHeight = Math.round(this.simWidth * ratio);
    this.dyeWidth  = this.config.DYE_RESOLUTION;
    this.dyeHeight = Math.round(this.dyeWidth * ratio);
    this.wave = this.makeDoubleFBO(this.simWidth, this.simHeight);
    this.dye  = this.makeDoubleFBO(this.dyeWidth, this.dyeHeight);
  }

  clear() {
    const gl = this.gl;
    const wipe = (fbo, w, h, r, g) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(r, g, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    wipe(this.wave.read.fbo,  this.simWidth,  this.simHeight, 0.5, 0.5);
    wipe(this.wave.write.fbo, this.simWidth,  this.simHeight, 0.5, 0.5);
    wipe(this.dye.read.fbo,   this.dyeWidth,  this.dyeHeight, 0.0, 0.0);
    wipe(this.dye.write.fbo,  this.dyeWidth,  this.dyeHeight, 0.0, 0.0);
  }

  drawQuad(prog) {
    const gl  = this.gl;
    gl.useProgram(prog);
    const loc = gl.getAttribLocation(prog, 'aPosition');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /* ── Public: inject a ripple + ink at (x, y)
     colorChannels = [r,g,b] ink colour pre-scaled by caller's strength
     waveStrength  = explicit wave amplitude (default 0.30) — decoupled
                     from ink so rings are always visible              */
  triggerSplat(x, y, dx, dy, colorChannels, radius, waveStrength) {
    const gl  = this.gl;
    const asp = this.canvas.width / this.canvas.height;
    const sw  = this.simWidth,  sh = this.simHeight;
    const dw  = this.dyeWidth,  dh = this.dyeHeight;

    // Wave amplitude: always strong enough for visible rings (0.28 default)
    const waveAmp = (waveStrength !== undefined)
      ? Math.min(waveStrength, 0.44)
      : 0.28;

    /* 1. Wave height impulse */
    gl.viewport(0, 0, sw, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wave.write.fbo);
    gl.useProgram(this.waveSplatProgram);
    gl.uniform1i(gl.getUniformLocation(this.waveSplatProgram, 'uWave'),     0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.wave.read.tex);
    gl.uniform2f(gl.getUniformLocation(this.waveSplatProgram, 'uPoint'),    x, y);
    gl.uniform1f(gl.getUniformLocation(this.waveSplatProgram, 'uStrength'), waveAmp);
    gl.uniform1f(gl.getUniformLocation(this.waveSplatProgram, 'uRadius'),   radius);
    gl.uniform1f(gl.getUniformLocation(this.waveSplatProgram, 'uAspect'),   asp);
    this.drawQuad(this.waveSplatProgram);
    this.wave.swap();

    /* 2. Ink / dye splat — small and gentle */
    gl.viewport(0, 0, dw, dh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dye.write.fbo);
    gl.useProgram(this.dyeSplatProgram);
    gl.uniform1i(gl.getUniformLocation(this.dyeSplatProgram, 'uDye'),    0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex);
    gl.uniform2f(gl.getUniformLocation(this.dyeSplatProgram, 'uPoint'),  x, y);
    gl.uniform3f(gl.getUniformLocation(this.dyeSplatProgram, 'uColor'),
      colorChannels[0], colorChannels[1], colorChannels[2]);
    gl.uniform1f(gl.getUniformLocation(this.dyeSplatProgram, 'uRadius'), radius * 1.4);
    gl.uniform1f(gl.getUniformLocation(this.dyeSplatProgram, 'uAspect'), asp);
    this.drawQuad(this.dyeSplatProgram);
    this.dye.swap();
  }

  step(dt) {
    const gl  = this.gl;
    if (!gl) return;
    const sw  = this.simWidth,  sh = this.simHeight;
    const dw  = this.dyeWidth,  dh = this.dyeHeight;
    const loc = (p, n) => gl.getUniformLocation(p, n);

    /* 1. Propagate wave */
    gl.viewport(0, 0, sw, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.wave.write.fbo);
    gl.useProgram(this.waveUpdateProgram);
    gl.uniform1i(loc(this.waveUpdateProgram, 'uWave'), 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.wave.read.tex);
    gl.uniform2f(loc(this.waveUpdateProgram, 'uTexelSize'), 1/sw, 1/sh);
    gl.uniform1f(loc(this.waveUpdateProgram, 'uSpeed'),   this.config.WAVE_SPEED);
    gl.uniform1f(loc(this.waveUpdateProgram, 'uDamping'), this.config.WAVE_DAMPING);
    this.drawQuad(this.waveUpdateProgram);
    this.wave.swap();

    /* 2. Advect dye along wave gradient */
    gl.viewport(0, 0, dw, dh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.dye.write.fbo);
    gl.useProgram(this.dyeAdvectProgram);
    gl.uniform1i(loc(this.dyeAdvectProgram, 'uDye'),  0);
    gl.uniform1i(loc(this.dyeAdvectProgram, 'uWave'), 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.wave.read.tex);
    gl.uniform2f(loc(this.dyeAdvectProgram, 'uTexelSize'), 1/dw, 1/dh);
    gl.uniform1f(loc(this.dyeAdvectProgram, 'uPush'),  this.config.DYE_PUSH);
    gl.uniform1f(loc(this.dyeAdvectProgram, 'uDecay'), this.config.DYE_DECAY);
    this.drawQuad(this.dyeAdvectProgram);
    this.dye.swap();

    /* 3. Render to screen */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.displayProgram);
    gl.uniform1i(loc(this.displayProgram, 'uDye'),  0);
    gl.uniform1i(loc(this.displayProgram, 'uWave'), 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.dye.read.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.wave.read.tex);
    gl.uniform2f(loc(this.displayProgram, 'uTexelSize'), 1/dw, 1/dh);
    const [pr, pg, pb] = this.config.PAPER_COLOR;
    gl.uniform3f(loc(this.displayProgram, 'uPaper'),       pr, pg, pb);
    gl.uniform1f(loc(this.displayProgram, 'uSpecular'),    this.config.SPECULAR);
    gl.uniform1f(loc(this.displayProgram, 'uRingShadow'),  this.config.RING_SHADOW);
    gl.uniform1f(loc(this.displayProgram, 'uRingHilite'),  this.config.RING_HILITE);
    gl.uniform1f(loc(this.displayProgram, 'uDyeScale'),    this.config.DYE_SCALE);
    gl.uniform1f(loc(this.displayProgram, 'uInkDarkness'), this.config.INK_DARKNESS);
    this.drawQuad(this.displayProgram);
  }

  updateConfig(key, value) {
    if (key in this.config) this.config[key] = value;
  }

  updatePalette(name) {
    const P = {
      aether:  { paper: [252/255, 250/255, 245/255] },
      sunset:  { paper: [253/255, 246/255, 230/255] },
      oceanic: { paper: [242/255, 248/255, 246/255] },
      meadow:  { paper: [248/255, 250/255, 244/255] },
    };
    const p = P[name] || P.aether;
    this.config.PAPER_COLOR = p.paper;
    const hex = p.paper.map(v => Math.round(v*255).toString(16).padStart(2,'0')).join('');
    document.documentElement.style.setProperty('--paper-color', '#'+hex);
  }
}
