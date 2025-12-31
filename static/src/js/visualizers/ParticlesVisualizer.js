import * as THREE from 'three';
import { BaseVisualizer } from './BaseVisualizer.js';

/**
 * ParticlesVisualizer - WebGL particle system visualization
 *
 * Displays a dynamic particle system that reacts to audio.
 * Particles move, pulse, and change color based on audio characteristics.
 *
 * Audio Mapping:
 * - energy → particle movement speed and expansion
 * - frequencyData → particle displacement patterns
 * - warmth → particle color hue
 * - richness → color saturation
 */
export class ParticlesVisualizer extends BaseVisualizer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {number} [options.particleCount=1000] - Number of particles
   * @param {number} [options.particleSize=3] - Base particle size
   * @param {number} [options.smoothing=0.1] - Animation smoothing factor
   * @param {number} [options.spread=1.5] - Particle spread radius
   * @param {string} [options.pattern='sphere'] - 'sphere', 'ring', or 'wave'
   */
  constructor(container, options = {}) {
    super(container, options);

    this.particleCount = options.particleCount ?? 1000;
    this.particleSize = options.particleSize ?? 3;
    this.smoothing = options.smoothing ?? 0.1;
    this.spread = options.spread ?? 1.5;
    this.pattern = options.pattern || 'sphere';

    // Smoothed values
    this._smoothedEnergy = 0;
    this._smoothedRichness = 0;
    this._currentHue = 260;
    this._time = 0;

    // Store original positions for animation
    this._originalPositions = null;

    // Pre-allocated color
    this._tempColor = new THREE.Color();
  }

  /**
   * Initialize visualizer-specific elements
   * @override
   */
  setup() {
    // Use perspective camera for 3D depth
    this._setupPerspectiveCamera();

    // Create particle system
    this._createParticles();
  }

  /**
   * Setup perspective camera for 3D effect
   * @private
   */
  _setupPerspectiveCamera() {
    const aspect = this.height > 0 ? this.width / this.height : 1;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
    this.camera.position.z = 3;
  }

  /**
   * Create particle system
   * @private
   */
  _createParticles() {
    const positions = new Float32Array(this.particleCount * 3);
    const colors = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);
    this._originalPositions = new Float32Array(this.particleCount * 3);

    // Initialize particle positions based on pattern
    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;
      let x, y, z;

      switch (this.pattern) {
        case 'ring':
          const ringAngle = (i / this.particleCount) * Math.PI * 2;
          const ringRadius = 0.5 + Math.random() * 0.5;
          x = Math.cos(ringAngle) * ringRadius * this.spread;
          y = Math.sin(ringAngle) * ringRadius * this.spread;
          z = (Math.random() - 0.5) * 0.2;
          break;

        case 'wave':
          x = ((i % 50) / 50 - 0.5) * this.spread * 2;
          y = (Math.floor(i / 50) / 20 - 0.5) * this.spread;
          z = (Math.random() - 0.5) * 0.3;
          break;

        case 'sphere':
        default:
          // Random spherical distribution
          const phi = Math.acos(2 * Math.random() - 1);
          const theta = Math.random() * Math.PI * 2;
          const r = Math.pow(Math.random(), 0.5) * this.spread; // sqrt for uniform volume
          x = r * Math.sin(phi) * Math.cos(theta);
          y = r * Math.sin(phi) * Math.sin(theta);
          z = r * Math.cos(phi);
          break;
      }

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      // Store original positions
      this._originalPositions[i3] = x;
      this._originalPositions[i3 + 1] = y;
      this._originalPositions[i3 + 2] = z;

      // Initial color from gradient
      const color = this.getGradientColor(i / this.particleCount);
      colors[i3] = color.r;
      colors[i3 + 1] = color.g;
      colors[i3 + 2] = color.b;

      // Random size variation
      sizes[i] = this.particleSize * (0.5 + Math.random() * 0.5);
    }

    this._geometry = new THREE.BufferGeometry();
    this._geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this._geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    this._material = new THREE.PointsMaterial({
      size: this.particleSize,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });

    this._particles = new THREE.Points(this._geometry, this._material);
    this.scene.add(this._particles);
  }

  /**
   * Update visualizer based on audio data
   * @override
   */
  update(audioData, deltaTime) {
    // Guard against destroyed state
    if (!this._geometry || !this._material) return;

    // Frame-rate independent smoothing
    const dt = Math.max(deltaTime, 0.001);
    const smoothFactor = 1 - Math.pow(1 - this.smoothing, dt * 60);
    const colorSmoothFactor = 1 - Math.pow(1 - this.smoothing * 0.3, dt * 60);

    // Update time
    this._time += dt;

    // Smooth values
    this._smoothedEnergy = this.lerp(
      this._smoothedEnergy,
      audioData.energy || 0,
      smoothFactor
    );
    this._smoothedRichness = this.lerp(
      this._smoothedRichness,
      audioData.richness || 0,
      smoothFactor
    );

    // Update hue from warmth
    const targetHue = this.mapRange(
      Math.min(audioData.warmth || 0, 4000),
      0, 4000,
      260, 360
    );
    this._currentHue = this.lerp(this._currentHue, targetHue, colorSmoothFactor);

    // Update particle positions
    this._updateParticlePositions(audioData.frequencyData);

    // Update particle colors
    this._updateParticleColors();

    // Update particle sizes
    this._updateParticleSizes();

    // Slowly rotate the entire system
    if (this._particles) {
      this._particles.rotation.y += dt * 0.1 * (0.5 + this._smoothedEnergy * 0.5);
      this._particles.rotation.x = Math.sin(this._time * 0.2) * 0.1;
    }
  }

  /**
   * Update particle positions based on audio
   * @private
   */
  _updateParticlePositions(freqData) {
    const positions = this._geometry.attributes.position.array;
    const original = this._originalPositions;

    // Expansion based on energy
    const expansion = 1 + this._smoothedEnergy * 0.3;

    // Frequency-based displacement
    const hasFreqData = freqData && freqData.length > 0;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Get frequency displacement for this particle
      let freqDisp = 0;
      if (hasFreqData) {
        const freqIndex = Math.floor((i / this.particleCount) * freqData.length);
        freqDisp = (freqData[freqIndex] / 255) * 0.2;
      }

      // Wave animation
      const waveOffset = Math.sin(this._time * 2 + i * 0.01) * 0.02;

      // Calculate direction from center for expansion
      const ox = original[i3];
      const oy = original[i3 + 1];
      const oz = original[i3 + 2];
      const dist = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;

      // New position with expansion and displacement
      const scale = expansion + freqDisp + waveOffset;
      positions[i3] = ox * scale;
      positions[i3 + 1] = oy * scale;
      positions[i3 + 2] = oz * scale;
    }

    this._geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Update particle colors based on audio
   * @private
   */
  _updateParticleColors() {
    const colors = this._geometry.attributes.color.array;
    const saturation = 0.6 + this._smoothedRichness * 0.3;
    const lightness = 0.4 + this._smoothedEnergy * 0.2;

    for (let i = 0; i < this.particleCount; i++) {
      const i3 = i * 3;

      // Calculate hue with variation per particle
      const hueVariation = (i / this.particleCount) * 60 - 30; // ±30 degrees
      const hue = ((this._currentHue + hueVariation) % 360) / 360;

      this._tempColor.setHSL(hue, saturation, lightness);

      // Smooth color transition
      colors[i3] = this.lerp(colors[i3], this._tempColor.r, 0.05);
      colors[i3 + 1] = this.lerp(colors[i3 + 1], this._tempColor.g, 0.05);
      colors[i3 + 2] = this.lerp(colors[i3 + 2], this._tempColor.b, 0.05);
    }

    this._geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Update particle sizes based on energy
   * @private
   */
  _updateParticleSizes() {
    // Update global size based on energy
    const sizeScale = 1 + this._smoothedEnergy * 0.5;
    this._material.size = this.particleSize * sizeScale;

    // Update opacity
    this._material.opacity = 0.6 + this._smoothedEnergy * 0.3;
  }

  /**
   * Handle resize
   * @override
   */
  onResize(width, height) {
    const aspect = height > 0 ? width / height : 1;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Cleanup
   * @override
   */
  onDestroy() {
    // Dispose particles
    if (this._particles) {
      this.scene.remove(this._particles);
    }
    if (this._geometry) {
      this._geometry.dispose();
    }
    if (this._material) {
      this._material.dispose();
    }

    // Clear references
    this._particles = null;
    this._geometry = null;
    this._material = null;
    this._originalPositions = null;
    this._tempColor = null;
  }

  /**
   * Get visualizer name
   * @override
   */
  get name() {
    return 'Particles';
  }

  /**
   * Get visualizer description
   * @override
   */
  get description() {
    return 'Dynamic particle system reacting to audio';
  }
}
