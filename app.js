/* NotePaint Main Application Orchestrator */

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('fluid-canvas');
  const statusText = document.getElementById('status-text');
  const pulseDot = document.querySelector('.pulse-dot');
  
  // Waveform Canvas Setup
  const waveCanvas = document.getElementById('waveform-canvas');
  const waveCtx = waveCanvas.getContext('2d');

  // 1. Initialize WebGL Fluid Simulator
  const fluid = new WebGLFluid(canvas);
  
  // Handle window resizing
  window.addEventListener('resize', () => {
    fluid.resize();
    resizeWaveformCanvas();
  });

  function resizeWaveformCanvas() {
    const rect = waveCanvas.parentElement.getBoundingClientRect();
    waveCanvas.width = rect.width;
    waveCanvas.height = rect.height;
  }
  resizeWaveformCanvas();

  // 2. Initialize Microphone Piano Brain
  const brain = new PianoBrain(fluid, (noteInfo) => {
    // Note trigger callback (unused for now)
  });

  // 3. Initialize PIP Player View
  const pip = new PlayerView('pip-container', brain.activeNotes);

  // 4. Connect Audio First-Click / Keyboard Trigger (Web Audio requirement)
  let initialized = false;
  
  async function initAudioOnInteraction() {
    if (initialized) return;
    initialized = true;
    
    statusText.innerText = "Initializing Microphone...";
    
    try {
      await brain.startListening();
      
      pulseDot.className = 'pulse-dot'; // Changes from warning (yellow) to active (green)
      statusText.innerText = "Microphone Active";
      
      // Hide the splash screen
      const splash = document.getElementById('start-splash');
      if (splash) splash.classList.add('hidden');
      
      // Trigger starting splash
      setTimeout(() => {
        fluid.triggerSplat(0.5, 0.4, 0, 5, [0.3, 0.3, 0.3], 0.05);
      }, 300);
      
      // Remove listeners once active
      document.removeEventListener('click', initAudioOnInteraction);
      document.removeEventListener('keydown', initAudioOnInteraction);
      document.removeEventListener('touchstart', initAudioOnInteraction);
    } catch (err) {
      initialized = false; // Allow retry on next click
      statusText.innerText = "Microphone Error";
      pulseDot.className = 'pulse-dot error';
    }
  }

  // Bind first interaction triggers (click, keydown, OR touch on mobile)
  document.addEventListener('click',      initAudioOnInteraction);
  document.addEventListener('keydown',    initAudioOnInteraction);
  document.addEventListener('touchstart', initAudioOnInteraction, { passive: true });

  // 5. Connect UI Settings Toggles
  const controlsBtn = document.getElementById('controls-toggle-btn');
  const settingsPanel = document.getElementById('settings-panel');

  controlsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = settingsPanel.classList.toggle('hidden');
    controlsBtn.classList.toggle('active', !isHidden);
  });

  // Close settings panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && e.target !== controlsBtn) {
      settingsPanel.classList.add('hidden');
      controlsBtn.classList.remove('active');
    }
  });

  // Prevent clicks inside panel from closing it
  settingsPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // A. Sensitivity Control
  const sensitivitySlider = document.getElementById('sensitivity-slider');
  const sensitivityVal = document.getElementById('sensitivity-val');
  
  sensitivitySlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    brain.setSensitivity(val);
    
    if (val < 0.8) {
      sensitivityVal.innerText = "Low";
    } else if (val <= 1.6) {
      sensitivityVal.innerText = "Medium";
    } else {
      sensitivityVal.innerText = "High";
    }
  });

  // B. Palette Preset Selection
  const paletteBtns = document.querySelectorAll('.palette-option');
  paletteBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      paletteBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const palette = btn.getAttribute('data-palette');
      fluid.updatePalette(palette);
    });
  });

  // C. Paint Bleed Rate
  const bleedBtns = document.querySelectorAll('.bleed-option');
  const bleedRates = {
    slow: 0.998,
    medium: 0.995,
    fast: 0.982
  };
  
  bleedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      bleedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const bleedMode = btn.getAttribute('data-bleed');
      fluid.updateConfig('DYE_DIFFUSION', bleedRates[bleedMode]);
    });
  });

  // D. Gravity Vector Selection
  const gravityBtns = document.querySelectorAll('.gravity-option');
  const gravityVectors = {
    up: { x: 0.0, y: 4.5 },
    down: { x: 0.0, y: -4.5 },
    left: { x: 4.5, y: 0.0 },
    right: { x: -4.5, y: 0.0 },
    zero: { x: 0.0, y: 0.0 }
  };
  
  gravityBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      gravityBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const gravityMode = btn.getAttribute('data-gravity');
      const vectorData = gravityVectors[gravityMode];
      fluid.updateConfig('GRAVITY', { x: vectorData.x, y: vectorData.y });
    });
  });

  // E. Paper Texture Selection
  const textureBtns = document.querySelectorAll('.texture-option');
  const canvasContainer = document.getElementById('canvas-container');
  
  textureBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      textureBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const textureMode = btn.getAttribute('data-texture');
      
      canvasContainer.className = ''; 
      canvasContainer.classList.add(`filter-${textureMode}`);
    });
  });

  // 6. Connect Bottom Navigation Actions
  
  // Back button (Stops listener and resets status indicator)
  const navBackBtn = document.getElementById('nav-back-btn');
  navBackBtn.addEventListener('click', () => {
    if (confirm("Stop listening? Your painting will be preserved in the background.")) {
      brain.stopListening();
      initialized = false;
      pulseDot.className = 'pulse-dot warning';
      statusText.innerText = "Click to Start";
      // Re-bind listeners
      document.addEventListener('click', initAudioOnInteraction);
      document.addEventListener('keydown', initAudioOnInteraction);
    }
  });

  // New Sheet button (Clear canvas)
  const navNewBtn = document.getElementById('nav-new-btn');
  navNewBtn.addEventListener('click', () => {
    fluid.clear();
  });

  // Save button (Captures canvas drawing as PNG download)
  const navSaveBtn = document.getElementById('nav-save-btn');
  navSaveBtn.addEventListener('click', () => {
    fluid.step(0.016);
    const link = document.createElement('a');
    link.download = 'notepaint-watercolor.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  });

  // 7. Draw bottom-left live waveform visualizer
  const timeData = new Float32Array(brain.fftSize);
  
  function drawWaveform() {
    if (brain.isListening && brain.analyser) {
      brain.analyser.getFloatTimeDomainData(timeData);
      waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
      waveCtx.strokeStyle = '#4e4942'; 
      waveCtx.lineWidth = 1.6;
      waveCtx.beginPath();
      
      const sliceWidth = waveCanvas.width / brain.fftSize;
      let x = 0;
      
      for (let i = 0; i < brain.fftSize; i++) {
        const v = timeData[i] * 2.5; 
        const y = (v + 1.0) * waveCanvas.height / 2.0;
        
        if (i === 0) {
          waveCtx.moveTo(x, y);
        } else {
          waveCtx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      waveCtx.stroke();
    } else {
      waveCtx.clearRect(0, 0, waveCanvas.width, waveCanvas.height);
      waveCtx.strokeStyle = 'rgba(78, 73, 66, 0.25)';
      waveCtx.lineWidth = 1.0;
      waveCtx.beginPath();
      waveCtx.moveTo(0, waveCanvas.height / 2.0);
      waveCtx.lineTo(waveCanvas.width, waveCanvas.height / 2.0);
      waveCtx.stroke();
    }
  }

  // 8. Wire up Touch Piano Keys
  const pianoKeys = document.querySelectorAll('.piano-key');

  function playPianoKey(key) {
    const freq = parseFloat(key.dataset.freq);
    if (!freq) return;
    key.classList.add('pressed');
    // Make sure audio is started (first touch triggers init)
    if (brain.isListening) {
      brain.playSynthTone(freq);
      brain.handleNoteDetection(freq, 0.6);
    }
    setTimeout(() => key.classList.remove('pressed'), 200);
  }

  pianoKeys.forEach(key => {
    // Mouse support (desktop preview)
    key.addEventListener('mousedown', (e) => { e.preventDefault(); playPianoKey(key); });

    // Touch support (mobile/tablet) — supports multi-touch chords
    key.addEventListener('touchstart', (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (el && el.classList.contains('piano-key')) playPianoKey(el);
      }
    }, { passive: false });
  });

  // Also handle touchmove across keys (slide to play)
  document.getElementById('touch-piano')?.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      if (el && el.classList.contains('piano-key') && !el.classList.contains('pressed')) {
        playPianoKey(el);
      }
    }
  }, { passive: false });

  // 9. Start Render/Simulation Loop
  let lastTime = performance.now();
  
  function mainLoop(time) {
    requestAnimationFrame(mainLoop);
    
    let dt = (time - lastTime) / 1000.0;
    lastTime = time;
    
    if (dt > 0.033) dt = 0.016; 
    
    // Update microphone pitch analysis
    brain.update();
    
    // Draw the bottom-left waveform
    drawWaveform();
    
    // Step fluid simulation (using a stable physical timestep)
    fluid.step(0.016);
  }
  
  requestAnimationFrame(mainLoop);
});
