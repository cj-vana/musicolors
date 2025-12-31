import * as THREE from 'three';
import { BaseVisualizer } from './BaseVisualizer.js';

/**
 * MinimalVisualizer - Subtle ambient glow visualization
 *
 * A low-prominence visualizer suitable as an album art background.
 * Features a pulsing glow that changes color based on audio characteristics.
 *
 * Audio Mapping:
 * - energy → glow intensity/size
 * - warmth → hue shift
 * - roughness → glow sharpness
 * - richness → color saturation
 */
export class MinimalVisualizer extends BaseVisualizer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {number} [options.glowLayers=5] - Number of glow layers
   * @param {number} [options.baseSize=0.3] - Base glow size (0-1 of viewport)
   * @param {number} [options.smoothing=0.08] - Animation smoothing factor
   * @param {boolean} [options.showCore=true] - Show bright center core
   */
  constructor(container, options = {}) {
    super(container, options);

    this.glowLayers = options.glowLayers || 5;
    this.baseSize = options.baseSize || 0.3;
    this.smoothing = options.smoothing || 0.08;
    this.showCore = options.showCore !== false;

    // Smoothed values for animation
    this._smoothedEnergy = 0;
    this._smoothedWarmth = 0;
    this._smoothedRoughness = 0;
    this._smoothedRichness = 0;

    // Color state
    this._currentHue = 260; // Start at indigo-ish
    this._targetHue = 260;

    // Pre-allocated color objects to avoid GC pressure in animation loop
    this._glowColorTemp = new THREE.Color();
    this._coreColorTemp = new THREE.Color();
    this._tintColorTemp = new THREE.Color();
  }

  /**
   * Initialize visualizer-specific elements
   * @override
   */
  setup() {
    // Use orthographic camera for 2D effect
    this._setupOrthographicCamera();

    // Create glow layers
    this._createGlowLayers();

    // Create optional core
    if (this.showCore) {
      this._createCore();
    }
  }

  /**
   * Setup orthographic camera for 2D rendering
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
   * Create layered glow effect
   * @private
   */
  _createGlowLayers() {
    this.glowMeshes = [];
    this.glowMaterials = [];

    const baseColor = new THREE.Color(this.colors.primary);

    for (let i = 0; i < this.glowLayers; i++) {
      // Each layer gets progressively larger and more transparent
      const layerRatio = (i + 1) / this.glowLayers;
      const size = this.baseSize * (1 + layerRatio * 2);
      const opacity = 0.4 * (1 - layerRatio * 0.7);

      const geometry = new THREE.CircleGeometry(size, 64);
      const material = new THREE.MeshBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = -0.01 * i; // Slight depth separation

      this.scene.add(mesh);
      this.glowMeshes.push(mesh);
      this.glowMaterials.push(material);
    }
  }

  /**
   * Create bright center core
   * @private
   */
  _createCore() {
    const geometry = new THREE.CircleGeometry(this.baseSize * 0.15, 32);
    this.coreMaterial = new THREE.MeshBasicMaterial({
      color: this.colors.highlight,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.coreMesh = new THREE.Mesh(geometry, this.coreMaterial);
    this.coreMesh.position.z = 0.01;
    this.scene.add(this.coreMesh);
  }

  /**
   * Update visualizer based on audio data
   * @override
   * @param {Object} audioData - Audio data from AudioSource
   * @param {number} deltaTime - Time since last frame in seconds
   */
  update(audioData, deltaTime) {
    // Frame-rate independent smoothing factor
    // Normalized to 60fps baseline: factor = 1 - (1 - smoothing)^(deltaTime * 60)
    const dt = Math.max(deltaTime, 0.001); // Prevent zero deltaTime
    const smoothFactor = 1 - Math.pow(1 - this.smoothing, dt * 60);
    const colorSmoothFactor = 1 - Math.pow(1 - this.smoothing * 0.5, dt * 60);

    // Smooth the audio values for fluid animation
    this._smoothedEnergy = this.lerp(
      this._smoothedEnergy,
      audioData.energy || 0,
      smoothFactor
    );
    this._smoothedWarmth = this.lerp(
      this._smoothedWarmth,
      audioData.warmth || 0,
      colorSmoothFactor // Slower color changes
    );
    this._smoothedRoughness = this.lerp(
      this._smoothedRoughness,
      audioData.roughness || 0,
      smoothFactor
    );
    this._smoothedRichness = this.lerp(
      this._smoothedRichness,
      audioData.richness || 0,
      smoothFactor
    );

    // Calculate target hue from warmth (spectral centroid)
    // Map warmth (typically 0-4000 Hz) to hue (260-360 for indigo-pink range)
    this._targetHue = this.mapRange(
      Math.min(this._smoothedWarmth, 4000),
      0, 4000,
      260, 360
    );
    const hueSmoothFactor = 1 - Math.pow(1 - this.smoothing * 0.3, dt * 60);
    this._currentHue = this.lerp(this._currentHue, this._targetHue, hueSmoothFactor);

    // Calculate saturation from richness
    const saturation = 60 + this._smoothedRichness * 30; // 60-90%

    // Calculate lightness with energy influence
    const baseLightness = 40;
    const energyBoost = this._smoothedEnergy * 20;
    const lightness = Math.min(baseLightness + energyBoost, 70);

    // Update glow layers
    this._updateGlowLayers(saturation, lightness);

    // Update core
    if (this.showCore && this.coreMesh) {
      this._updateCore();
    }
  }

  /**
   * Update glow layer colors and sizes
   * @private
   */
  _updateGlowLayers(saturation, lightness) {
    // Guard against destroyed state
    if (!this.glowMeshes || !this.glowMaterials) return;

    // Use pre-allocated color to avoid GC pressure
    this._glowColorTemp.setHSL(this._currentHue / 360, saturation / 100, lightness / 100);

    // Energy affects glow size - subtle scaling
    const energyScale = 1 + this._smoothedEnergy * 0.5;

    // Roughness affects edge sharpness - higher roughness = sharper edges
    const sharpness = 1 - this._smoothedRoughness * 0.3;

    for (let i = 0; i < this.glowMeshes.length; i++) {
      const mesh = this.glowMeshes[i];
      const material = this.glowMaterials[i];
      const layerRatio = (i + 1) / this.glowLayers;

      // Update color
      material.color.copy(this._glowColorTemp);

      // Update opacity based on energy and layer
      const baseOpacity = 0.4 * (1 - layerRatio * 0.7);
      const energyOpacity = baseOpacity * (0.5 + this._smoothedEnergy * 0.5);
      material.opacity = energyOpacity * sharpness;

      // Update scale
      const baseScale = 1 + layerRatio * 2;
      const scale = baseScale * energyScale;
      mesh.scale.setScalar(scale);
    }
  }

  /**
   * Update core appearance
   * @private
   */
  _updateCore() {
    // Guard against destroyed state
    if (!this.coreMesh || !this.coreMaterial) return;

    // Core pulses with energy
    const coreScale = 1 + this._smoothedEnergy * 0.3;
    this.coreMesh.scale.setScalar(coreScale);

    // Core opacity based on energy
    this.coreMaterial.opacity = 0.6 + this._smoothedEnergy * 0.4;

    // Subtle color tint on core using pre-allocated colors
    const tintAmount = this._smoothedEnergy * 0.3;
    this._coreColorTemp.set(this.colors.highlight);
    this._tintColorTemp.setHSL(this._currentHue / 360, 0.70, 0.80);
    this._coreColorTemp.lerp(this._tintColorTemp, tintAmount);
    this.coreMaterial.color.copy(this._coreColorTemp);
  }

  /**
   * Handle resize
   * @override
   */
  onResize(width, height) {
    // Update orthographic camera for new aspect ratio
    const aspect = height > 0 ? width / height : 1;
    const frustumSize = 2;

    this.camera.left = -frustumSize * aspect / 2;
    this.camera.right = frustumSize * aspect / 2;
    this.camera.top = frustumSize / 2;
    this.camera.bottom = -frustumSize / 2;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Cleanup
   * @override
   */
  onDestroy() {
    // Dispose glow geometries and materials
    if (this.glowMeshes) {
      this.glowMeshes.forEach((mesh) => {
        this.disposeObject(mesh);
      });
    }

    // Dispose core
    if (this.coreMesh) {
      this.disposeObject(this.coreMesh);
    }

    // Clear references
    this.glowMeshes = null;
    this.glowMaterials = null;
    this.coreMesh = null;
    this.coreMaterial = null;
    this._glowColorTemp = null;
    this._coreColorTemp = null;
    this._tintColorTemp = null;
  }

  /**
   * Get visualizer name
   * @override
   */
  get name() {
    return 'Minimal';
  }

  /**
   * Get visualizer description
   * @override
   */
  get description() {
    return 'Subtle ambient glow that pulses with the music';
  }
}
