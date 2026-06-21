/* Microphone-Driven "Piano Brain" for NotePaint */

class PianoBrain {
  constructor(fluidSimulator, onNoteActive) {
    this.fluid = fluidSimulator;
    this.onNoteActive = onNoteActive; // Callback to notify app/visuals of note activity
    
    this.audioContext = null;
    this.analyser = null;
    this.micStream = null;
    this.audioSource = null;
    
    this.isListening = false;
    this.sensitivity = 1.0; // Default sensitivity multiplier
    
    // Pitch detection buffers
    this.fftSize = 2048;
    this.timeBuffer = new Float32Array(this.fftSize);
    
    // Track note states for sustain/density accumulation
    this.activeNotes = {};
    this.currentNoteName = ""; // Holds the active note string (e.g. "C4")
    
    // Keyboard synthesizer (for fallback testing)
    this.synth = null;
    this.setupKeyboardFallback();
  }

  // Initialize Web Audio API
  async startListening() {
    if (this.isListening) return true;
    
    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Safari / mobile: AudioContext may start suspended — must resume after user gesture
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      // Request microphone access
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      });
      
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      
      this.audioSource = this.audioContext.createMediaStreamSource(this.micStream);
      this.audioSource.connect(this.analyser);
      
      this.isListening = true;
      console.log('Microphone audio stream initialized successfully.');
      
      this.synth = this.audioContext;
      return true;
    } catch (err) {
      console.error('Microphone access denied or audio failed:', err);
      this.isListening = false;
      throw err;
    }
  }

  stopListening() {
    if (!this.isListening) return;
    
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
    }
    
    if (this.audioSource) {
      this.audioSource.disconnect();
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
    
    this.isListening = false;
    this.currentNoteName = "";
    console.log("Microphone stream stopped.");
  }

  // Get note name from MIDI number
  getNoteName(midiNumber) {
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const octave = Math.floor(midiNumber / 12) - 1;
    const name = noteNames[midiNumber % 12];
    return `${name}${octave}`;
  }

  // Update loop called by requestAnimationFrame
  update() {
    if (!this.isListening || !this.analyser) return;
    
    // 1. Get time domain data for pitch detection
    this.analyser.getFloatTimeDomainData(this.timeBuffer);
    
    // 2. Perform pitch detection
    const pitchData = this.detectPitch(this.timeBuffer, this.audioContext.sampleRate);
    
    // 3. Process note triggers
    // CONFIDENCE THRESHOLD (0.85): lowered from 0.96 to pick up notes more easily on mobile mics
    if (pitchData && pitchData.confidence > 0.85) { 
      this.handleNoteDetection(pitchData.frequency, pitchData.amplitude);
    } else {
      // Decay note sustain when silence/no note is detected
      this.decayActiveNotes();
    }
  }

  // Autocorrelation Pitch Detection Algorithm
  detectPitch(buffer, sampleRate) {
    const size = buffer.length;
    
    // Calculate RMS amplitude (volume)
    let sumSquares = 0;
    for (let i = 0; i < size; i++) {
      const val = buffer[i];
      sumSquares += val * val;
    }
    const rms = Math.sqrt(sumSquares / size);
    
    // STRICT NOISE GATE (0.02): completely ignores room floor noise, clicking, or quiet talking
    const baseGate = 0.02; 
    const threshold = baseGate / this.sensitivity;
    if (rms < threshold) {
      return null; // Too quiet (silence or ambient noise)
    }
    
    // Autocorrelation
    let r = new Float32Array(size);
    for (let lag = 0; lag < size / 2; lag++) {
      let sum = 0;
      for (let i = 0; i < size / 2; i++) {
        sum += buffer[i] * buffer[i + lag];
      }
      r[lag] = sum;
    }
    
    // Find the peak lag (ignoring lag 0 which is always the absolute maximum)
    let peakLag = -1;
    let maxCorrelation = -1;
    
    // Set frequency search boundaries (Piano: 27Hz to 4000Hz)
    const minFreq = 25;
    const maxFreq = 4200;
    const maxLag = Math.min(Math.floor(sampleRate / minFreq), size / 2);
    const minLag = Math.max(Math.floor(sampleRate / maxFreq), 2);
    
    // Peak selection with parabolic interpolation
    for (let lag = minLag; lag < maxLag; lag++) {
      if (r[lag] > r[lag - 1] && r[lag] > r[lag + 1]) {
        if (r[lag] > maxCorrelation) {
          maxCorrelation = r[lag];
          peakLag = lag;
        }
      }
    }
    
    if (peakLag === -1) return null;
    
    // Parabolic interpolation for sub-sample accuracy
    const alpha = r[peakLag - 1];
    const beta = r[peakLag];
    const gamma = r[peakLag + 1];
    const p = 0.5 * (alpha - gamma) / (alpha - 2 * beta + gamma);
    const preciseLag = peakLag + p;
    
    const frequency = sampleRate / preciseLag;
    
    // Calculate confidence based on correlation strength
    const confidence = maxCorrelation / r[0];
    
    return {
      frequency: frequency,
      amplitude: rms,
      confidence: confidence
    };
  }

  // Process a detected pitch and map it to ripple splats
  handleNoteDetection(frequency, amplitude) {
    const midiNote = Math.round(12 * Math.log2(frequency / 440) + 69);
    if (midiNote < 12 || midiNote > 115) return;

    const noteName = this.getNoteName(midiNote);
    this.currentNoteName = noteName;

    const rawX = (midiNote - 21) / (108 - 21);
    const x    = Math.max(0.07, Math.min(0.93, rawX));

    const now    = performance.now();
    const noteId = midiNote;
    let duration = 0;
    
    if (this.activeNotes[noteId]) {
      duration = now - this.activeNotes[noteId].startTime;
      this.activeNotes[noteId].lastActive = now;
      this.activeNotes[noteId].amplitude  = amplitude;
      
      // Throttle ripples for sustained notes to prevent an overpowering blast
      if (now - this.activeNotes[noteId].lastSplatTime < 250) return;
      this.activeNotes[noteId].lastSplatTime = now;
    } else {
      this.activeNotes[noteId] = { startTime: now, lastActive: now, frequency, amplitude, name: noteName, x, lastSplatTime: now };
    }

    // Much reduced volume multiplier — was 14 x 3.0, now 4 x 1.0
    const vol      = Math.min(amplitude * this.sensitivity * 4.0, 1.0);
    // Strength = how much ink to drop; very gentle (0.04 – 0.14 max)
    const strength = 0.04 + vol * 0.10;

    // ── 5-band frequency → ink hue palette ─────────────────────────────────
    // Vivid pigment colours — Beer-Lambert rendering makes them luminous on paper
    let hue;
    if      (frequency <  150) hue = [1.00, 0.12, 0.00]; // vivid vermillion  (bass)
    else if (frequency <  350) hue = [0.18, 0.00, 1.00]; // electric violet   (low-mid)
    else if (frequency <  700) hue = [0.00, 0.82, 0.75]; // bright cyan-teal  (mid)
    else if (frequency < 2000) hue = [1.00, 0.72, 0.00]; // golden yellow     (high-mid)
    else                       hue = [1.00, 0.00, 0.55]; // hot magenta       (treble)

    // Pre-scale by strength so the dye texture gets small, accumulating values
    const c  = hue.map(v => v * strength);
    const c2 = hue.map(v => v * strength * 0.6); // dimmer satellite splats

    if (frequency < 200) {
      // BASS: one wide ripple, low on canvas
      const y      = 0.08 + Math.random() * 0.22;
      const radius = this.fluid.config.SPLAT_RADIUS * (2.2 + vol * 2.0);
      this.fluid.triggerSplat(x, y, 0, 0, c, radius);

    } else if (frequency < 1000) {
      // MID: medium ripple, anywhere on canvas
      const y      = 0.12 + Math.random() * 0.76;
      const radius = this.fluid.config.SPLAT_RADIUS * (1.4 + vol * 1.8);
      this.fluid.triggerSplat(x, y, 0, 0, c, radius);

    } else {
      // TREBLE: cluster of 2–3 small ripples in upper half
      const y      = 0.40 + Math.random() * 0.45;
      const radius = this.fluid.config.SPLAT_RADIUS * (0.8 + vol * 1.2);
      this.fluid.triggerSplat(x, y, 0, 0, c, radius);
      for (let i = 0; i < 2; i++) {
        const a = (i / 2) * Math.PI * 2 + Math.random() * 0.9;
        const d = 0.018 + Math.random() * 0.022;
        this.fluid.triggerSplat(
          x + Math.cos(a) * d, y + Math.sin(a) * d * 0.55,
          0, 0, c2, radius * 0.55);
      }
    }

    if (this.onNoteActive) {
      this.onNoteActive({ frequency, midiNote, amplitude, x,
        noteName, type: frequency < 200 ? 'bass' : frequency < 1000 ? 'mid' : 'treble', duration });
    }
  }

  // Decay sustained note states
  decayActiveNotes() {
    const now = performance.now();
    let remaining = 0;
    
    for (const noteId in this.activeNotes) {
      if (now - this.activeNotes[noteId].lastActive > 180) {
        delete this.activeNotes[noteId];
      } else {
        remaining++;
      }
    }
    
    if (remaining === 0) {
      this.currentNoteName = "";
    }
  }

  setSensitivity(val) {
    this.sensitivity = val;
  }

  // Keyboard fall-back synthesizer
  setupKeyboardFallback() {
    const noteFreqs = {
      'a': 261.63, 's': 293.66, 'd': 329.63, 'f': 349.23, 'g': 392.00, 'h': 440.00, 'j': 493.88, 'k': 523.25, 'l': 587.33, ';': 659.25,
      'w': 277.18, 'e': 311.13, 't': 369.99, 'y': 415.30, 'u': 466.16, 'o': 554.37, 'p': 622.25,
      'z': 65.41,  'x': 82.41,  'c': 110.00, 'v': 146.83
    };

    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        const key = e.key.toLowerCase();
        if (noteFreqs[key]) {
          const freq = noteFreqs[key];
          this.handleNoteDetection(freq, 0.5);
        }
        return;
      }
      
      const key = e.key.toLowerCase();
      if (noteFreqs[key]) {
        const freq = noteFreqs[key];
        this.playSynthTone(freq);
        this.handleNoteDetection(freq, 0.5);
      }
    });
  }

  playSynthTone(frequency) {
    if (!this.audioContext || this.audioContext.state === 'suspended') return;
    
    try {
      const osc = this.audioContext.createOscillator();
      const gainNode = this.audioContext.createGain();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
      
      gainNode.gain.setValueAtTime(0.25, this.audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + 1.0);
      
      osc.connect(gainNode);
      gainNode.connect(this.audioContext.destination);
      
      osc.start();
      osc.stop(this.audioContext.currentTime + 1.0);
    } catch (e) {
      console.warn("Synth tone failed:", e);
    }
  }
}
