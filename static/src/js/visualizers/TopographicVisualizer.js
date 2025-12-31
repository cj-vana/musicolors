import * as THREE from 'three';
import { BaseVisualizer } from './BaseVisualizer.js';

/**
 * TopographicVisualizer - Audio-reactive contour/topographic visualization
 *
 * Displays animated contour lines that morph and distort based on audio.
 * Creates a terrain-like visualization that responds to frequency data.
 *
 * Audio Mapping:
 * - frequencyData → contour distortion
 * - energy → line brightness and animation speed
 * - warmth → color temperature
 * - roughness → line complexity
 */
export class TopographicVisualizer extends BaseVisualizer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {number} [options.contourCount=8] - Number of contour lines
   * @param {number} [options.resolution=64] - Points per contour line
   * @param {number} [options.smoothing=0.12] - Animation smoothing factor
   * @param {number} [options.waveSpeed=0.5] - Base wave animation speed
   */
  constructor(container, options = {}) {
    super(container, options);

    this.contourCount = options.contourCount ?? 8;
    this.resolution = options.resolution ?? 64;
    this.smoothing = options.smoothing ?? 0.12;
    this.waveSpeed = options.waveSpeed ?? 0.5;

    // Smoothed values
    this._smoothedEnergy = 0;
    this._smoothedRoughness = 0;
    this._currentHue = 260;

    // Animation time
    this._time = 0;

    // Frequency-driven displacement
    this._freqDisplacement = new Float32Array(this.resolution);
    this._smoothedDisplacement = new Float32Array(this.resolution);

    // Pre-allocated color
    this._tempColor = new THREE.Color();
  }

  /**
   * Initialize visualizer-specific elements
   * @override
   */
  setup() {
    // Use orthographic camera
    this._setupOrthographicCamera();

    // Create contour lines
    this._createContours();
  }

  /**
   * Setup orthographic camera
   * @private
   */
  _setupOrthographicCamera() {
    const aspect = this.height > 0 ? this.width / this.height : 1;
    const frustumSize = 2;

    this.camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      10
    );
    this.camera.position.z = 1;
  }

  /**
   * Create contour line meshes
   * @private
   */
  _createContours() {
    this.contours = [];
    this.contourMaterials = [];
    this.contourGeometries = [];

    const aspect = this.height > 0 ? this.width / this.height : 1;

    for (let c = 0; c < this.contourCount; c++) {
      const points = [];
      const baseY = ((c / (this.contourCount - 1)) - 0.5) * 1.5;

      // Create initial flat contour line
      for (let i = 0; i < this.resolution; i++) {
        const x = ((i / (this.resolution - 1)) - 0.5) * 2 * aspect;
        points.push(new THREE.Vector3(x, baseY, 0));
      }

      const geometry = new THREE.BufferGeometry().setFromPoints(points);

      // Color based on contour position in gradient
      const color = this.getGradientColor(c / (this.contourCount - 1));

      const material = new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.7 - (c / this.contourCount) * 0.3,
        linewidth: 2,
      });

      const line = new THREE.Line(geometry, material);

      this.scene.add(line);
      this.contours.push(line);
      this.contourMaterials.push(material);
      this.contourGeometries.push(geometry);
    }
  }

  /**
   * Update visualizer based on audio data
   * @override
   */
  update(audioData, deltaTime) {
    // Guard against destroyed state
    if (!this.contours || !this.contourMaterials) return;

    // Frame-rate independent smoothing
    const dt = Math.max(deltaTime, 0.001);
    const smoothFactor = 1 - Math.pow(1 - this.smoothing, dt * 60);
    const colorSmoothFactor = 1 - Math.pow(1 - this.smoothing * 0.3, dt * 60);

    // Update time
    this._time += dt * this.waveSpeed * (0.5 + this._smoothedEnergy);

    // Smooth energy and roughness
    this._smoothedEnergy = this.lerp(
      this._smoothedEnergy,
      audioData.energy || 0,
      smoothFactor
    );
    this._smoothedRoughness = this.lerp(
      this._smoothedRoughness,
      audioData.roughness || 0,
      smoothFactor
    );

    // Update hue from warmth
    const targetHue = this.mapRange(
      Math.min(audioData.warmth || 0, 4000),
      0, 4000,
      260, 360
    );
    this._currentHue = this.lerp(this._currentHue, targetHue, colorSmoothFactor);

    // Process frequency data into displacement
    this._processFrequencyData(audioData.frequencyData, smoothFactor);

    // Update contour lines
    this._updateContours();

    // Update colors
    this._updateColors();
  }

  /**
   * Process frequency data into displacement values
   * @private
   */
  _processFrequencyData(freqData, smoothFactor) {
    if (!freqData || freqData.length === 0) {
      // Smooth toward zero
      for (let i = 0; i < this.resolution; i++) {
        this._smoothedDisplacement[i] = this.lerp(this._smoothedDisplacement[i], 0, smoothFactor);
      }
      return;
    }

    // Sample frequency data to match resolution
    const dataLength = freqData.length;

    for (let i = 0; i < this.resolution; i++) {
      // Logarithmic frequency mapping
      const logIndex = Math.floor(Math.exp(Math.log(dataLength) * (i / this.resolution)));
      const index = Math.min(logIndex, dataLength - 1);

      // Normalize to 0-1
      const value = freqData[index] / 255;

      // Apply non-linearity
      const processed = Math.pow(value, 0.7);

      // Smooth
      this._smoothedDisplacement[i] = this.lerp(
        this._smoothedDisplacement[i],
        processed,
        smoothFactor
      );
    }
  }

  /**
   * Update contour line positions
   * @private
   */
  _updateContours() {
    const aspect = this.height > 0 ? this.width / this.height : 1;
    const baseAmplitude = 0.1 + this._smoothedEnergy * 0.15;
    const complexity = 1 + this._smoothedRoughness * 3;

    for (let c = 0; c < this.contourCount; c++) {
      const geometry = this.contourGeometries[c];
      if (!geometry) continue;

      const positions = geometry.attributes.position.array;
      const baseY = ((c / (this.contourCount - 1)) - 0.5) * 1.5;
      const phaseOffset = c * 0.5;

      for (let i = 0; i < this.resolution; i++) {
        const x = ((i / (this.resolution - 1)) - 0.5) * 2 * aspect;

        // Multiple wave components for organic feel
        let y = baseY;

        // Primary wave - frequency-driven
        const freqDisp = this._smoothedDisplacement[i] * baseAmplitude;

        // Secondary waves - time-based animation
        const wave1 = Math.sin(this._time * 2 + x * complexity + phaseOffset) * 0.03;
        const wave2 = Math.sin(this._time * 1.5 + x * (complexity * 0.7) - phaseOffset) * 0.02;

        // Combine waves
        y += freqDisp + wave1 + wave2;

        // Add subtle energy-based breathing
        y += Math.sin(this._time * 0.5 + phaseOffset) * this._smoothedEnergy * 0.03;

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
      }

      geometry.attributes.position.needsUpdate = true;
    }
  }

  /**
   * Update contour colors based on audio
   * @private
   */
  _updateColors() {
    for (let c = 0; c < this.contourCount; c++) {
      const material = this.contourMaterials[c];
      if (!material) continue;

      // Base gradient color
      const baseColor = this.getGradientColor(c / (this.contourCount - 1));
      const hsl = { h: 0, s: 0, l: 0 };
      baseColor.getHSL(hsl);

      // Shift hue based on audio
      hsl.h = (hsl.h + (this._currentHue - 260) / 360) % 1;

      // Brightness from energy
      hsl.l = Math.min(hsl.l + this._smoothedEnergy * 0.15, 0.8);

      this._tempColor.setHSL(hsl.h, hsl.s, hsl.l);
      material.color.lerp(this._tempColor, 0.08);

      // Opacity from energy
      const baseOpacity = 0.7 - (c / this.contourCount) * 0.3;
      material.opacity = baseOpacity + this._smoothedEnergy * 0.2;
    }
  }

  /**
   * Handle resize
   * @override
   */
  onResize(width, height) {
    const aspect = height > 0 ? width / height : 1;
    const frustumSize = 2;

    this.camera.left = -frustumSize * aspect / 2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;
    this.camera.updateProjectionMatrix();

    // Recreate contours for new aspect ratio
    this._recreateContours();
  }

  /**
   * Recreate contours after resize
   * @private
   */
  _recreateContours() {
    // Dispose existing
    if (this.contours) {
      this.contours.forEach(line => this.scene.remove(line));
      this.contourGeometries?.forEach(g => g.dispose());
      this.contourMaterials?.forEach(m => m.dispose());
    }

    // Clear
    this.contours = null;
    this.contourMaterials = null;
    this.contourGeometries = null;

    // Recreate
    this._createContours();
  }

  /**
   * Cleanup
   * @override
   */
  onDestroy() {
    // Dispose contours
    if (this.contours) {
      this.contours.forEach(line => this.scene.remove(line));
    }
    if (this.contourGeometries) {
      this.contourGeometries.forEach(g => g.dispose());
    }
    if (this.contourMaterials) {
      this.contourMaterials.forEach(m => m.dispose());
    }

    // Clear references
    this.contours = null;
    this.contourMaterials = null;
    this.contourGeometries = null;
    this._freqDisplacement = null;
    this._smoothedDisplacement = null;
    this._tempColor = null;
  }

  /**
   * Get visualizer name
   * @override
   */
  get name() {
    return 'Topographic';
  }

  /**
   * Get visualizer description
   * @override
   */
  get description() {
    return 'Audio-reactive contour lines with wave animation';
  }
}
