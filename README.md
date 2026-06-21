# NotePaint 🎨🎹

Website here
https://vryuz.github.io/NOTEPAINT-piano-visualizer-/

A generative watercolour physics simulation driven entirely by the live sound of a piano. 

Play a real piano into your microphone (or use the built-in touch keyboard) and watch as musical notes are translated into vivid, organic watercolour splatters that bleed into digital paper in real-time.

## Features

- **Live Microphone Input**: Advanced autocorrelation pitch detection algorithm identifies piano notes in real-time.
- **Physics-Based Fluid Simulation**: A custom WebGL 2D Wave Equation solver creates realistic, propagating ripples.
- **Beer-Lambert Watercolour Rendering**: Ink pigments are rendered using physically-correct subtractive colour mixing. Colours absorb their complements, resulting in vivid, luminous washes that mix beautifully when they overlap.
- **Frequency-to-Color Mapping**: Different octaves trigger specific pigment colours (e.g., bass notes trigger deep vermillion, treble notes trigger hot magenta).
- **Interactive UI**: Touch-enabled piano keyboard, adjustable paper textures, dynamic flow direction, and more.
- **Picture-in-Picture (PiP)**: A draggable floating window allows you to view the waveform or your own webcam while playing.

## How It Works

### 1. Pitch Detection (`audio.js`)
The application captures microphone input using the Web Audio API. It performs real-time pitch detection using an **Autocorrelation algorithm** with parabolic interpolation for sub-sample accuracy. 
- It maps the detected frequency to a MIDI note and assigns a specific position (`X` axis) on the canvas.
- The frequency range determines the **colour** (vivid vermillion, electric violet, bright cyan-teal, golden yellow, or hot magenta) and the Y-position grouping (bass notes lower, treble notes higher).

### 2. The Fluid & Wave Engine (`webgl-fluid.js`)
Instead of a standard Navier-Stokes fluid sim, NotePaint uses a pure **2D Wave Equation** to simulate the physical propagation of ripples through water:
- **Wave Buffer**: Stores the wave height (amplitude) and velocity. Splats inject energy into this buffer, which propagates outward as concentric rings.
- **Dye Buffer**: Stores the RGB pigment concentration. Pigments advect (flow) along the gradient of the wave height, causing ink to naturally pool into the valleys of the ripples and paper texture.
- **FBM Paper Texture**: Fractal Brownian Motion generates procedural cold-press, hot-press, or rough watercolour paper textures.

### 3. Display Shader
The final composite shader uses the **Beer-Lambert Law** to render the ink. Instead of flatly multiplying colours, the shader calculates how much light is absorbed by the pigment and how much reflects off the paper back to the viewer. This creates the signature glowing, luminous look of real watercolour.

## Local Setup

NotePaint is a pure client-side application. No build step is required!

1. Clone the repository.
2. Serve the directory using any local HTTP server. For example:
   ```bash
   npx http-server -p 8080
   ```
3. Open `http://localhost:8080` in your browser.
4. Tap anywhere to start, allow microphone access, and play some music!

*(Note: The Web Audio API and getUserMedia require the site to be served over `localhost` or `https`)*
