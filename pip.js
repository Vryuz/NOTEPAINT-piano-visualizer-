/* Picture-in-Picture (PIP) Player View and Persistent Note Display */

class PlayerView {
  constructor(containerId, activeNotesRef) {
    this.container = document.getElementById(containerId);
    this.video = document.getElementById('pip-webcam');
    this.canvas = document.getElementById('pip-visualizer-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.watermark = document.getElementById('pip-watermark');
    this.toggleBtn = document.getElementById('pip-toggle-source');
    
    // Minimize button setup
    this.minimizeBtn = document.getElementById('pip-minimize-btn');
    this.isMinimized = false;
    
    this.activeNotes = activeNotesRef; // Reference to PianoBrain's activeNotes map
    this.webcamStream = null;
    this.mode = 'visualizer'; // 'visualizer' or 'webcam'
    
    // Persistent note memory
    this.lastNoteName = "";
    this.lastNoteFreq = 0;
    this.pulseGlow = 0;
    
    this.initMode();
    this.setupDraggable();
    this.setupEvents();
    this.resizeCanvas();
    
    // Start canvas render loop
    this.animate();
  }

  initMode() {
    if (this.mode === 'webcam') {
      this.startWebcam();
    } else {
      this.stopWebcam();
    }
  }

  async startWebcam() {
    try {
      this.webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 320, height: 240, facingMode: 'user' },
        audio: false
      });
      this.video.srcObject = this.webcamStream;
      this.video.classList.add('active');
      this.canvas.classList.add('inactive');
      this.watermark.innerText = "Webcam: Artist Hands";
      this.mode = 'webcam';
    } catch (err) {
      console.warn("Could not start webcam, falling back to persistent note display:", err);
      this.mode = 'visualizer';
      this.stopWebcam();
    }
  }

  stopWebcam() {
    if (this.webcamStream) {
      this.webcamStream.getTracks().forEach(track => track.stop());
      this.webcamStream = null;
    }
    this.video.srcObject = null;
    this.video.classList.remove('active');
    this.canvas.classList.remove('inactive');
    this.watermark.innerText = "Active Pitch";
    this.mode = 'visualizer';
  }

  setupEvents() {
    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.mode === 'visualizer') {
        this.startWebcam();
      } else {
        this.stopWebcam();
      }
    });

    this.minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMinimize();
    });

    window.addEventListener('resize', () => this.resizeCanvas());
  }

  toggleMinimize() {
    this.isMinimized = !this.isMinimized;
    if (this.isMinimized) {
      this.container.classList.add('minimized');
      this.minimizeBtn.innerText = '⛶'; // Expand icon
      this.minimizeBtn.title = "Expand Player View";
    } else {
      this.container.classList.remove('minimized');
      this.minimizeBtn.innerText = '—'; // Minimize dash
      this.minimizeBtn.title = "Minimize Player View";
      setTimeout(() => this.resizeCanvas(), 50); // Small delay to let CSS transitions finish
    }
  }

  resizeCanvas() {
    if (this.isMinimized) return;
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  setupDraggable() {
    const header = this.container.querySelector('.pip-header');
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    header.addEventListener('mousedown', dragStart.bind(this));
    window.addEventListener('mousemove', drag.bind(this));
    window.addEventListener('mouseup', dragEnd.bind(this));

    header.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        dragStart.call(this, e.touches[0]);
      }
    });
    window.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches.length === 1) {
        drag.call(this, e.touches[0]);
      }
    });
    window.addEventListener('touchend', dragEnd.bind(this));

    function dragStart(e) {
      isDragging = true;
      this.container.classList.add('dragging');
      
      const rect = this.container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      
      startX = e.clientX;
      startY = e.clientY;
    }

    function drag(e) {
      if (!isDragging) return;
      e.preventDefault();
      
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      
      let newLeft = initialLeft + dx;
      let newTop = initialTop + dy;
      
      const padding = 10;
      const maxX = window.innerWidth - this.container.offsetWidth - padding;
      const maxY = window.innerHeight - this.container.offsetHeight - padding;
      
      newLeft = Math.max(padding, Math.min(newLeft, maxX));
      newTop = Math.max(padding, Math.min(newTop, maxY));
      
      this.container.style.left = newLeft + 'px';
      this.container.style.top = newTop + 'px';
      this.container.style.bottom = 'auto';
      this.container.style.right = 'auto';
    }

    function dragEnd() {
      if (!isDragging) return;
      isDragging = false;
      this.container.classList.remove('dragging');
    }
  }

  // Draw note and frequency visualizer
  animate() {
    requestAnimationFrame(() => this.animate());
    
    if (this.mode !== 'visualizer' || this.isMinimized) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Dark minimalist background
    ctx.fillStyle = '#141318';
    ctx.fillRect(0, 0, w, h);

    // Find the loudest active note
    let loudestNote = null;
    let maxAmp = -1;
    for (const noteId in this.activeNotes) {
      const note = this.activeNotes[noteId];
      if (note.amplitude > maxAmp) {
        maxAmp = note.amplitude;
        loudestNote = note;
      }
    }

    if (loudestNote) {
      const noteName = loudestNote.name || "Unknown";
      const freq = loudestNote.frequency || 0;
      
      // Update persistent memory
      this.lastNoteName = noteName;
      this.lastNoteFreq = freq;
      
      // Select glow color
      let glowColor = '74, 144, 226'; 
      if (freq < 200) glowColor = '63, 81, 181'; 
      else if (freq > 1000) glowColor = '236, 0, 140'; 
      
      this.pulseGlow = (this.pulseGlow + 0.06) % (Math.PI * 2);
      const pulseSize = 40 + Math.sin(this.pulseGlow) * 10 + loudestNote.amplitude * 45;
      
      // 1. Pulsing glow
      const grad = ctx.createRadialGradient(w/2, h/2, 5, w/2, h/2, pulseSize);
      grad.addColorStop(0, `rgba(${glowColor}, 0.28)`);
      grad.addColorStop(0.5, `rgba(${glowColor}, 0.1)`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(w/2, h/2, pulseSize, 0, Math.PI * 2);
      ctx.fill();

      // 2. Active Note (Bright White)
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 3.2rem "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = `rgba(${glowColor}, 0.6)`;
      ctx.shadowBlur = 18;
      ctx.fillText(noteName, w/2, h/2 - 10);
      ctx.shadowBlur = 0;

      // 3. Frequency Sub-text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.font = '500 0.8rem "Outfit", sans-serif';
      ctx.fillText(`${freq.toFixed(1)} Hz`, w/2, h/2 + 26);

    } else if (this.lastNoteName) {
      // --- DISPLAY LAST PLAYED NOTE (PERSISTENT MEMORY) ---
      let glowColor = '74, 144, 226'; 
      if (this.lastNoteFreq < 200) glowColor = '63, 81, 181'; 
      else if (this.lastNoteFreq > 1000) glowColor = '236, 0, 140'; 

      // Subtle, steady glow
      const grad = ctx.createRadialGradient(w/2, h/2, 5, w/2, h/2, 40);
      grad.addColorStop(0, `rgba(${glowColor}, 0.1)`);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(w/2, h/2, 40, 0, Math.PI * 2);
      ctx.fill();

      // Dimmed Note Name (shows it is historic/last note)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '700 3.0rem "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.lastNoteName, w/2, h/2 - 16);

      // "Last played" label
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '600 0.62rem "Outfit", sans-serif';
      ctx.letterSpacing = '1px';
      ctx.fillText("LAST NOTE", w/2, h/2 + 20);
      ctx.letterSpacing = '0px';

    } else {
      // Empty listening state
      this.pulseGlow = (this.pulseGlow + 0.02) % (Math.PI * 2);
      const breathAlpha = 0.2 + (Math.sin(this.pulseGlow) + 1.0) * 0.15;
      
      ctx.strokeStyle = `rgba(255, 255, 255, ${breathAlpha * 0.15})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(w/2, h/2, 35, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(255, 255, 255, ${breathAlpha})`;
      ctx.font = '600 0.75rem "Outfit", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.letterSpacing = '2px';
      ctx.fillText("LISTENING", w/2, h/2);
      ctx.letterSpacing = '0px';
    }
  }
}
