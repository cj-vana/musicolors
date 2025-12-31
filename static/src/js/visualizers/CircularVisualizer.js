import * as THREE from 'three';
import { BaseVisualizer } from './BaseVisualizer.js';

/**
 * CircularVisualizer - Radial frequency bars visualization
 *
 * Displays frequency bars arranged in a circle, radiating outward.
 * Can optionally show a center element or leave it empty for album art.
 *
 * Audio Mapping:
 * - frequencyData → bar heights (radiating outward)
 * - energy → overall scale and glow
 * - warmth → color hue shift
 */
export class CircularVisualizer extends BaseVisualizer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {number} [options.barCount=64] - Number of radial bars
   * @param {number} [options.innerRadius=0.3] - Inner radius (0-1)
   * @param {number} [options.outerRadius=0.9] - Maximum outer radius (0-1)
   * @param {number} [options.smoothing=0.15] - Animation smoothing factor
   * @param {number} [options.rotation=0.1] - Rotation speed (radians per second)
   * @param {boolean} [options.showCenter=false] - Show center glow
   */
  constructor(container, options = {}) {
    super(container, options);

    this.barCount = options.barCount ?? 64;
    this.innerRadius = options.innerRadius ?? 0.3;
    this.outerRadius = options.outerRadius ?? 0.9;
    this.smoothing = options.smoothing ?? 0.15;
    this.rotationSpeed = options.rotation ?? 0.1;
    this.showCenter = options.showCenter || false;

    // Smoothed values
    this._smoothedHeights = new Float32Array(this.barCount);
    this._smoothedEnergy = 0;
    this._currentHue = 260;
    this._currentRotation = 0;

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

    // Create radial bars
    this._createBars();

    // Create center glow if enabled
    if (this.showCenter) {
      this._createCenterGlow();
    }
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
   * Create radial bar meshes
   * @private
   */
  _createBars() {
    this.bars = [];
    this.barMaterials = [];
    this.barGeometries = [];
    this.barGroup = new THREE.Group();

    // Calculate dimensions
    const minDimension = Math.min(this.width, this.height);
    const scale = minDimension / this.height; // Normalize to height
    const innerR = this.innerRadius * scale;
    const barWidth = (2 * Math.PI) / this.barCount * 0.7; // 70% of segment width

    for (let i = 0; i < this.barCount; i++) {
      const angle = (i / this.barCount) * Math.PI * 2;

      // Create bar geometry - a thin rectangle
      const geometry = new THREE.PlaneGeometry(0.02, 0.1);
      // Move origin to bottom edge
      geometry.translate(0, 0.05, 0);

      // Get gradient color
      const color = this.getGradientColor(i / this.barCount);

      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Position at inner radius
      mesh.position.x = Math.cos(angle) * innerR;
      mesh.position.y = Math.sin(angle) * innerR;

      // Rotate to point outward
      mesh.rotation.z = angle - Math.PI / 2;

      // Start with minimal scale
      mesh.scale.y = 0.01;

      this.barGroup.add(mesh);
      this.bars.push(mesh);
      this.barMaterials.push(material);
      this.barGeometries.push(geometry);
    }

    this.scene.add(this.barGroup);
  }

  /**
   * Create center glow effect
   * @private
   */
  _createCenterGlow() {
    const minDimension = Math.min(this.width, this.height);
    const scale = minDimension / this.height;
    const radius = this.innerRadius * scale * 0.8;

    const geometry = new THREE.CircleGeometry(radius, 32);
    const material = new THREE.MeshBasicMaterial({
      color: this.colors.primary,
      transparent: true,
      opacity: 0.3,
      blending: THREE.AdditiveBlending,
    });

    this._centerGlow = new THREE.Mesh(geometry, material);
    this._centerGlow.position.z = -0.01;
    this._centerGeometry = geometry;
    this._centerMaterial = material;
    this.scene.add(this._centerGlow);
  }

  /**
   * Update visualizer based on audio data
   * @override
   */
  update(audioData, deltaTime) {
    // Guard against destroyed state
    if (!this.bars || !this.barMaterials) return;

    // Frame-rate independent smoothing
    const dt = Math.max(deltaTime, 0.001);
    const smoothFactor = 1 - Math.pow(1 - this.smoothing, dt * 60);
    const colorSmoothFactor = 1 - Math.pow(1 - this.smoothing * 0.3, dt * 60);

    // Smooth energy
    this._smoothedEnergy = this.lerp(
      this._smoothedEnergy,
      audioData.energy || 0,
      smoothFactor
    );

    // Update hue from warmth
    const targetHue = this.mapRange(
      Math.min(audioData.warmth || 0, 4000),
      0, 4000,
      260, 360
    );
    this._currentHue = this.lerp(this._currentHue, targetHue, colorSmoothFactor);

    // Update rotation
    this._currentRotation += this.rotationSpeed * dt * (0.5 + this._smoothedEnergy);
    this.barGroup.rotation.z = this._currentRotation;

    // Update bar heights
    this._updateBarHeights(audioData.frequencyData, smoothFactor);

    // Update colors
    this._updateColors();

    // Update center glow
    if (this.showCenter && this._centerGlow) {
      this._updateCenterGlow();
    }
  }

  /**
   * Update bar heights from frequency data
   * @private
   */
  _updateBarHeights(freqData, smoothFactor) {
    const minDimension = Math.min(this.width, this.height);
    const scale = minDimension / this.height;
    const maxBarHeight = (this.outerRadius - this.innerRadius) * scale;

    for (let i = 0; i < this.barCount; i++) {
      let amplitude = 0;

      if (freqData && freqData.length > 0) {
        // Logarithmic frequency mapping
        const freqIndex = this._getFrequencyIndex(i, freqData.length);
        amplitude = freqData[freqIndex] / 255;
      }

      // Apply non-linearity
      amplitude = Math.pow(amplitude, 0.8);

      // Smooth the height
      this._smoothedHeights[i] = this.lerp(
        this._smoothedHeights[i],
        amplitude,
        smoothFactor
      );

      // Update bar scale (use optional chaining to prevent minifier optimization)
      const height = Math.max(this._smoothedHeights[i] * maxBarHeight, 0.01);
      if (this.bars[i]?.scale) {
        this.bars[i].scale.y = height;
      }

      // Update opacity
      if (this.barMaterials[i]) {
        this.barMaterials[i].opacity = 0.5 + this._smoothedHeights[i] * 0.5;
      }
    }
  }

  /**
   * Map bar index to frequency bin with logarithmic scaling
   * @private
   */
  _getFrequencyIndex(barIndex, dataLength) {
    const minLog = Math.log(1);
    const maxLog = Math.log(dataLength);
    const s = (maxLog - minLog) / this.barCount;

    const logIndex = minLog + s * barIndex;
    const index = Math.floor(Math.exp(logIndex));

    return Math.min(index, dataLength - 1);
  }

  /**
   * Update bar colors based on audio
   * @private
   */
  _updateColors() {
    for (let i = 0; i < this.barMaterials.length; i++) {
      const baseColor = this.getGradientColor(i / this.barCount);
      // Shift hue based on audio
      const hsl = { h: 0, s: 0, l: 0 };
      baseColor.getHSL(hsl);
      hsl.h = (hsl.h + (this._currentHue - 260) / 360) % 1;
      hsl.l = Math.min(hsl.l + this._smoothedEnergy * 0.1, 0.8);
      this._tempColor.setHSL(hsl.h, hsl.s, hsl.l);
      this.barMaterials[i].color.lerp(this._tempColor, 0.1);
    }
  }

  /**
   * Update center glow based on energy
   * @private
   */
  _updateCenterGlow() {
    if (!this._centerMaterial) return;

    // Scale with energy
    const scale = 1 + this._smoothedEnergy * 0.3;
    this._centerGlow.scale.setScalar(scale);

    // Opacity with energy
    this._centerMaterial.opacity = 0.2 + this._smoothedEnergy * 0.2;

    // Color shift
    this._tempColor.setHSL(this._currentHue / 360, 0.7, 0.5);
    this._centerMaterial.color.lerp(this._tempColor, 0.05);
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

    // Recreate bars for new dimensions
    this._recreateBars();
  }

  /**
   * Recreate bars after resize
   * @private
   */
  _recreateBars() {
    // Dispose existing
    if (this.barGroup) {
      this.scene.remove(this.barGroup);
      this.barGeometries?.forEach(g => g.dispose());
      this.barMaterials?.forEach(m => m.dispose());
    }

    if (this._centerGlow) {
      this.scene.remove(this._centerGlow);
      this._centerGeometry?.dispose();
      this._centerMaterial?.dispose();
    }

    // Clear
    this.bars = null;
    this.barMaterials = null;
    this.barGeometries = null;
    this._centerGlow = null;
    this._centerGeometry = null;
    this._centerMaterial = null;

    // Recreate
    this._createBars();
    if (this.showCenter) {
      this._createCenterGlow();
    }
  }

  /**
   * Cleanup
   * @override
   */
  onDestroy() {
    // Dispose bars
    if (this.barGeometries) {
      this.barGeometries.forEach(g => g.dispose());
    }
    if (this.barMaterials) {
      this.barMaterials.forEach(m => m.dispose());
    }
    if (this.barGroup) {
      this.scene.remove(this.barGroup);
    }

    // Dispose center
    if (this._centerGlow) {
      this.scene.remove(this._centerGlow);
    }
    if (this._centerGeometry) {
      this._centerGeometry.dispose();
    }
    if (this._centerMaterial) {
      this._centerMaterial.dispose();
    }

    // Clear references
    this.bars = null;
    this.barMaterials = null;
    this.barGeometries = null;
    this.barGroup = null;
    this._centerGlow = null;
    this._centerGeometry = null;
    this._centerMaterial = null;
    this._smoothedHeights = null;
    this._tempColor = null;
  }

  /**
   * Get visualizer name
   * @override
   */
  get name() {
    return 'Circular';
  }

  /**
   * Get visualizer description
   * @override
   */
  get description() {
    return 'Radial frequency bars arranged in a circle';
  }
}
