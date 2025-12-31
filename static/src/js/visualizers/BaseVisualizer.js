import * as THREE from 'three';

/**
 * BaseVisualizer - Abstract base class for all visualizer presets
 * Handles common setup: Three.js scene, renderer, animation loop, lifecycle
 *
 * Design Constraints:
 * - Flexible aspect ratio: Adapts to any container size
 * - Dark theme colors: All visualizers use dark theme
 * - Transparent background: Alpha channel for overlay use
 */
export class BaseVisualizer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {number} [options.width] - Canvas width (default: container width)
   * @param {number} [options.height] - Canvas height (default: container height)
   * @param {boolean} [options.antialias=true] - Enable antialiasing
   * @param {number} [options.pixelRatio] - Device pixel ratio (default: auto)
   */
  constructor(container, options = {}) {
    if (!container) {
      throw new Error('Container element is required');
    }

    this.container = container;
    this.width = options.width || container.clientWidth || 400;
    this.height = options.height || container.clientHeight || 400;
    this.options = options;

    // Animation state
    this.isRunning = false;
    this.isDestroyed = false;
    this._animationFrameId = null;
    this._lastTime = 0;

    // Dark theme color palette (matching Resonance aesthetic)
    this.colors = {
      background: 0x0a0a0a,
      primary: 0x6366f1,      // Indigo accent
      secondary: 0x8b5cf6,    // Purple
      tertiary: 0x06b6d4,     // Cyan
      highlight: 0xffffff,
      muted: 0x3f3f46,
      surface: 0x18181b,
      // Gradient colors for visualizations
      gradient: [
        0x6366f1, // Indigo
        0x8b5cf6, // Purple
        0xa855f7, // Violet
        0xd946ef, // Fuchsia
        0xec4899, // Pink
      ]
    };

    // Initialize Three.js components
    this._initScene();
    this._initRenderer(options);
    this._initCamera();

    // Mount canvas to container
    this.container.appendChild(this.renderer.domElement);

    // Handle resize
    this._boundResizeHandler = this._handleResize.bind(this);
    window.addEventListener('resize', this._boundResizeHandler);

    // Pre-setup hook for child class property initialization
    this._initProperties();

    // Setup hook for subclasses
    this.setup();
  }

  /**
   * Initialize Three.js scene
   * @private
   */
  _initScene() {
    this.scene = new THREE.Scene();
  }

  /**
   * Initialize Three.js renderer
   * @private
   */
  _initRenderer(options) {
    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: options.antialias !== false,
      powerPreference: 'high-performance',
    });

    this.renderer.setClearColor(this.colors.background, 0); // Transparent
    this.renderer.setPixelRatio(options.pixelRatio || Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
  }

  /**
   * Initialize camera - override in subclass if needed
   * @private
   */
  _initCamera() {
    const aspect = this.width / this.height;
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Property initialization hook - override in subclasses to initialize properties
   * Called before setup() to ensure properties are available during setup
   * @protected
   */
  _initProperties() {
    // Override in subclass
  }

  /**
   * Setup hook - override in subclasses to initialize visualizer-specific elements
   * Called once after base initialization
   */
  setup() {
    // Override in subclass
  }

  /**
   * Update hook - override in subclasses to update visualizer based on audio data
   * Called every animation frame when running
   *
   * @param {Object} audioData - Audio data from AudioSource
   * @param {number} audioData.energy - Energy level (0-1+)
   * @param {number} audioData.roughness - Spectral flatness (0-1)
   * @param {number} audioData.warmth - Spectral centroid (Hz, typically 0-360 for hue)
   * @param {number} audioData.richness - Perceptual spread (0-1)
   * @param {number} audioData.sharpness - Perceptual sharpness (0-1)
   * @param {string|null} audioData.pitch - Detected note (C, D, E, F, G, A, B) or null
   * @param {number|null} audioData.octave - Detected octave (0-8) or null
   * @param {Uint8Array} audioData.frequencyData - Raw frequency bin data
   * @param {Uint8Array} audioData.timeDomainData - Raw time domain data
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(audioData, deltaTime) {
    // Override in subclass
  }

  /**
   * Render the scene
   * @protected
   */
  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Animation loop - handles timing and calls update/render
   * @private
   */
  _animate(currentTime = 0) {
    if (!this.isRunning || this.isDestroyed) {
      this._animationFrameId = null;
      return;
    }

    // Handle first frame after start/resume - use 0 delta to avoid animation spike
    const deltaTime = this._lastTime === 0 ? 0 : (currentTime - this._lastTime) / 1000;
    this._lastTime = currentTime;

    // Get audio data from source if available
    const audioData = this._audioSource ? this._audioSource.getAudioData() : this._getEmptyAudioData();

    // Update visualizer
    this.update(audioData, deltaTime);

    // Render
    this.render();

    // Continue loop
    this._animationFrameId = requestAnimationFrame((t) => this._animate(t));
  }

  /**
   * Get empty audio data structure for when no source is connected
   * @private
   */
  _getEmptyAudioData() {
    return {
      energy: 0,
      roughness: 0,
      warmth: 0,
      richness: 0,
      sharpness: 0,
      kurtosis: 0,
      pitch: null,
      octave: null,
      dominantFrequency: 0,
      dominantBin: 0,
      bassFrequency: 0,
      bassEnergy: 0,
      frequencyData: null,
      timeDomainData: null,
    };
  }

  /**
   * Connect an audio source for visualization
   * @param {AudioSource} audioSource - AudioSource instance
   */
  connectAudioSource(audioSource) {
    this._audioSource = audioSource;
  }

  /**
   * Disconnect the audio source
   */
  disconnectAudioSource() {
    this._audioSource = null;
  }

  /**
   * Start the animation loop
   */
  start() {
    if (this.isRunning || this.isDestroyed) return;

    // Ensure no orphaned animation frames exist
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }

    this.isRunning = true;
    this._lastTime = 0;
    this._animate();
  }

  /**
   * Stop the animation loop
   */
  stop() {
    this.isRunning = false;
    if (this._animationFrameId) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
  }

  /**
   * Handle window resize
   * @private
   */
  _handleResize() {
    // Use container dimensions if not explicitly sized
    if (!this.options.width || !this.options.height) {
      this.resize(
        this.container.clientWidth || this.width,
        this.container.clientHeight || this.height
      );
    }
  }

  /**
   * Resize the visualizer
   * @param {number} width - New width
   * @param {number} height - New height
   */
  resize(width, height) {
    this.width = width;
    this.height = height;

    // Update camera aspect ratio
    if (this.camera instanceof THREE.PerspectiveCamera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    // Update renderer size
    this.renderer.setSize(width, height);

    // Call resize hook for subclasses
    this.onResize(width, height);
  }

  /**
   * Resize hook - override in subclasses if needed
   * @param {number} width - New width
   * @param {number} height - New height
   */
  onResize(width, height) {
    // Override in subclass if needed
  }

  /**
   * Cleanup and destroy the visualizer
   */
  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    // Stop animation
    this.stop();

    // Remove resize listener (defensive: handle missing reference)
    if (this._boundResizeHandler) {
      window.removeEventListener('resize', this._boundResizeHandler);
      this._boundResizeHandler = null;
    }

    // Disconnect audio source
    this.disconnectAudioSource();

    // Call cleanup hook
    this.onDestroy();

    // Dispose Three.js objects
    this._disposeScene(this.scene);

    // Remove canvas from DOM
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }

    // Dispose renderer
    this.renderer.dispose();

    // Clear references
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.container = null;
  }

  /**
   * Cleanup hook - override in subclasses if needed
   */
  onDestroy() {
    // Override in subclass if needed
  }

  /**
   * Recursively dispose of Three.js objects in a scene
   * @private
   */
  _disposeScene(obj) {
    if (!obj) return;

    // Dispose children first (iterate over copy to avoid mutation issues)
    if (obj.children && obj.children.length > 0) {
      const childrenCopy = [...obj.children];
      childrenCopy.forEach(child => {
        this._disposeScene(child);
        obj.remove(child);
      });
    }

    // Dispose geometry
    if (obj.geometry?.dispose) {
      obj.geometry.dispose();
    }

    // Dispose material(s)
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(mat => this._disposeMaterial(mat));
      } else {
        this._disposeMaterial(obj.material);
      }
    }

    // Dispose lights
    if (obj instanceof THREE.Light && obj.dispose) {
      obj.dispose();
    }
  }

  /**
   * Helper for subclasses to cleanly dispose custom objects
   * Call this in onDestroy() for any custom geometries, materials, or objects
   * @protected
   * @param {THREE.Object3D|THREE.Geometry|THREE.Material} obj - Object to dispose
   */
  disposeObject(obj) {
    if (!obj) return;

    if (obj.geometry?.dispose) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) {
        obj.material.forEach(m => m.dispose?.());
      } else {
        obj.material.dispose?.();
      }
    }
    if (obj.dispose) obj.dispose();
  }

  /**
   * Dispose of a material and its textures
   * @private
   */
  _disposeMaterial(material) {
    if (!material) return;

    // Dispose textures
    const textureProperties = ['map', 'normalMap', 'specularMap', 'envMap', 'emissiveMap'];
    textureProperties.forEach(prop => {
      if (material[prop]) {
        material[prop].dispose();
      }
    });

    material.dispose();
  }

  // ============================================
  // Utility Methods for Subclasses
  // ============================================

  /**
   * Convert HSL to Three.js Color
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-100)
   * @param {number} l - Lightness (0-100)
   * @returns {THREE.Color}
   */
  hslToColor(h, s, l) {
    const color = new THREE.Color();
    color.setHSL(h / 360, s / 100, l / 100);
    return color;
  }

  /**
   * Get color from gradient based on value
   * @param {number} value - Value between 0-1
   * @param {number[]} [gradient] - Array of hex colors (default: this.colors.gradient)
   * @returns {THREE.Color}
   */
  getGradientColor(value, gradient = this.colors.gradient) {
    const clampedValue = Math.max(0, Math.min(1, value));
    const index = clampedValue * (gradient.length - 1);
    const lowerIndex = Math.floor(index);
    const upperIndex = Math.ceil(index);
    const t = index - lowerIndex;

    const color1 = new THREE.Color(gradient[lowerIndex]);
    const color2 = new THREE.Color(gradient[upperIndex]);

    return color1.lerp(color2, t);
  }

  /**
   * Map a value from one range to another
   * @param {number} value - Input value
   * @param {number} inMin - Input range minimum
   * @param {number} inMax - Input range maximum
   * @param {number} outMin - Output range minimum
   * @param {number} outMax - Output range maximum
   * @returns {number}
   */
  mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
  }

  /**
   * Smooth a value using lerp (linear interpolation)
   * @param {number} current - Current value
   * @param {number} target - Target value
   * @param {number} factor - Smoothing factor (0-1, lower = smoother)
   * @returns {number}
   */
  lerp(current, target, factor) {
    return current + (target - current) * factor;
  }

  /**
   * Get visualizer name - override in subclasses
   * @returns {string}
   */
  get name() {
    return 'BaseVisualizer';
  }

  /**
   * Get visualizer description - override in subclasses
   * @returns {string}
   */
  get description() {
    return 'Base visualizer class';
  }
}
