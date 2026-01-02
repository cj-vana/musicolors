# Musicolors

Audio-reactive sphere visualization library built with Three.js and Web Audio API.

## What It Does

Renders a 3D sphere that reacts to audio in real-time:
- **Pulsing size** based on audio energy
- **Gradient colors** that shift on beat/transient detection
- **Perlin noise deformation** based on audio timbre (roughness)
- **Hyperspace particle tunnel** with metallic colors that accelerate on beats

## Installation

```bash
npm install musicolors three
```

**Peer Dependency:** Requires `three` >= 0.148.0

## Quick Start

```javascript
import { Visualizer } from 'musicolors';

const container = document.getElementById('visualizer');
const visualizer = new Visualizer(container);

// Initialize with one of three methods (see below)
await visualizer.initWithMicrophone();

// Start the render loop
visualizer.start();
```

---

## API Reference

### Constructor

```javascript
const visualizer = new Visualizer(container, options?)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `container` | `HTMLElement` | Yes | DOM element to render into. Must have defined width/height. |
| `options` | `Object` | No | Configuration options (see below) |

**Options:**
```javascript
{
  visualizerOptions: {},  // Passed to SphereVisualizer
  audioOptions: {
    smoothingFactor: 0.8,      // 0-1, higher = smoother but more latency
    clarityThreshold: 0.9,     // Pitch detection clarity threshold
    minFrequency: 20,          // Min frequency for pitch detection (Hz)
    maxFrequency: 4000,        // Max frequency for pitch detection (Hz)
  }
}
```

---

### Initialization Methods

You must call ONE of these before `start()`:

#### 1. `initWithAnalyser(analyserNode, audioContext)`

**Use for: External audio engines (e.g., Resonance, custom players)**

```javascript
// Synchronous - no await needed
visualizer.initWithAnalyser(
  audioEngine.getAnalyser(),     // AnalyserNode instance
  audioEngine.getAudioContext()  // AudioContext instance
);
```

This method does NOT create its own AudioContext - it uses yours. The visualizer will poll the analyser for data via `requestAnimationFrame`.

#### 2. `initWithAudioElement(audioElement)`

**Use for: HTML `<audio>` elements**

```javascript
const audio = document.getElementById('audio-player');
await visualizer.initWithAudioElement(audio);
```

Creates a `MediaElementSource` from the audio element. The audio will play through the visualizer's audio graph.

**Important:** Each audio element can only have ONE MediaElementSource. If you get an error about the element already having a source, you need to reuse the existing source or create a new audio element.

#### 3. `initWithMicrophone()`

**Use for: Microphone input**

```javascript
await visualizer.initWithMicrophone();
```

Requests microphone permission and creates a `MediaStreamSource`.

---

### Control Methods

#### `start()`
Begin the visualization render loop.
```javascript
visualizer.start();
```

#### `stop()`
Pause the visualization (does not destroy resources).
```javascript
visualizer.stop();
```

#### `resize(width, height)`
Update the renderer size. Call on window resize.
```javascript
window.addEventListener('resize', () => {
  visualizer.resize(container.clientWidth, container.clientHeight);
});
```

#### `destroy()`
Clean up all resources (Three.js objects, audio connections, animation frames).
```javascript
visualizer.destroy();
```

**Always call this when removing the visualizer to prevent memory leaks.**

---

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `isRunning` | `boolean` | Whether the render loop is active |
| `visualizer` | `SphereVisualizer` | Direct access to the sphere visualizer instance |
| `audioSource` | `AudioSource` | Direct access to the audio analysis instance |

---

### Audio Data Access

Get real-time audio analysis data:

```javascript
const data = visualizer.getAudioData();
```

Returns:
```javascript
{
  energy: 0.0-1.0,           // Overall loudness (RMS)
  roughness: 0.0-1.0,        // Spectral flatness (noise vs tone)
  warmth: 0-22050,           // Spectral centroid in Hz
  richness: 0.0-1.0,         // Perceptual spread
  sharpness: 0.0-1.0,        // Perceptual sharpness
  kurtosis: number,          // Spectral kurtosis
  pitch: 'C'|'D'|...|null,   // Detected note name
  octave: 0-8|null,          // Detected octave
  dominantFrequency: Hz,     // Peak frequency from FFT
  bassFrequency: 0-360,      // Bass peak mapped to hue
  bassEnergy: 0.0-1.0,       // Energy of bass peak
  frequencyData: Uint8Array, // Raw FFT data
  timeDomainData: Uint8Array // Raw waveform data
}
```

---

## Resonance Integration Example

Complete integration with an audio engine:

```javascript
import { Visualizer } from 'musicolors';

class ResonanceVisualizer {
  constructor(container, audioEngine) {
    this.container = container;
    this.audioEngine = audioEngine;
    this.visualizer = null;
  }

  init() {
    // Create visualizer
    this.visualizer = new Visualizer(this.container);

    // Connect to Resonance's audio graph
    this.visualizer.initWithAnalyser(
      this.audioEngine.getAnalyser(),
      this.audioEngine.getAudioContext()
    );

    // Handle resize
    this.resizeHandler = () => {
      this.visualizer.resize(
        this.container.clientWidth,
        this.container.clientHeight
      );
    };
    window.addEventListener('resize', this.resizeHandler);

    // Start rendering
    this.visualizer.start();
  }

  destroy() {
    window.removeEventListener('resize', this.resizeHandler);
    if (this.visualizer) {
      this.visualizer.destroy();
      this.visualizer = null;
    }
  }
}

// Usage
const vizContainer = document.getElementById('visualizer');
const resonanceViz = new ResonanceVisualizer(vizContainer, audioEngine);
resonanceViz.init();

// Later, when cleaning up:
resonanceViz.destroy();
```

---

## React Integration Example

```jsx
import { useEffect, useRef } from 'react';
import { Visualizer } from 'musicolors';

function AudioVisualizer({ audioEngine }) {
  const containerRef = useRef(null);
  const visualizerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current || !audioEngine) return;

    // Create and initialize
    const viz = new Visualizer(containerRef.current);
    viz.initWithAnalyser(
      audioEngine.getAnalyser(),
      audioEngine.getAudioContext()
    );
    viz.start();
    visualizerRef.current = viz;

    // Resize handler
    const handleResize = () => {
      viz.resize(
        containerRef.current.clientWidth,
        containerRef.current.clientHeight
      );
    };
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      viz.destroy();
    };
  }, [audioEngine]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '400px' }}
    />
  );
}
```

---

## Direct Exports

For advanced use cases, you can import individual modules:

```javascript
// Main API
import { Visualizer } from 'musicolors';

// Individual components
import { AudioSource, SphereVisualizer, BaseVisualizer } from 'musicolors';

// Audio utilities only
import { AudioSource } from 'musicolors/audio';
```

---

## AudioSource Standalone Usage

Use the audio analysis without visualization:

```javascript
import { AudioSource } from 'musicolors';

const audio = new AudioSource({ smoothingFactor: 0.7 });

// Connect to your audio
audio.connectExternalAnalyser(myAnalyser, myAudioContext);

// Read data in your render loop
function animate() {
  const data = audio.getAudioData();
  console.log('Energy:', data.energy);
  console.log('Pitch:', data.pitch, data.octave);
  requestAnimationFrame(animate);
}
animate();

// Cleanup
audio.destroy();
```

---

## Browser Requirements

- Web Audio API support
- WebGL support
- ES6+ (or use the UMD bundle at `dist/visualizer.js`)

---

## Bundle Formats

| Path | Format | Use Case |
|------|--------|----------|
| `src/js/visualizers/index.js` | ESM | Modern bundlers (Vite, webpack, etc.) |
| `src/js/dist/visualizer.js` | UMD | Script tags, legacy systems |

---

## Troubleshooting

### Audio not playing through visualizer
When using `initWithAudioElement()`, the audio is routed through the Web Audio API. Ensure:
1. AudioContext is not suspended (call `visualizer.audioSource.resume()`)
2. User has interacted with the page (browser autoplay policy)

### "Already has a MediaElementSource" error
Each `<audio>` element can only have one MediaElementSource. Either:
- Reuse the existing source
- Create a new audio element
- Use `initWithAnalyser()` if you already have an audio graph

### Visualizer not responding to audio
1. Check that `start()` was called after initialization
2. Verify audio is actually playing
3. Check browser console for errors
4. Ensure container has non-zero dimensions

### Memory leaks
Always call `destroy()` when removing the visualizer, especially in SPAs.

---

## License

MIT
