import * as THREE from 'three';
import { BaseVisualizer } from './BaseVisualizer.js';

/**
 * BarsVisualizer - Classic frequency spectrum visualization
 *
 * Displays vertical bars representing frequency amplitudes across the spectrum.
 * Each bar's height corresponds to the amplitude at that frequency bin.
 *
 * Audio Mapping:
 * - frequencyData → bar heights
 * - energy → overall brightness/glow
 * - warmth → color gradient position
 */
export class BarsVisualizer extends BaseVisualizer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {number} [options.barCount=64] - Number of frequency bars
   * @param {number} [options.barGap=0.1] - Gap between bars (0-1 relative to bar width)
   * @param {number} [options.smoothing=0.15] - Animation smoothing factor
   * @param {string} [options.colorMode='gradient'] - 'gradient', 'solid', or 'pitch'
   * @param {boolean} [options.showReflection=true] - Show bottom reflection
   */
  constructor(container, options = {}) {
    super(container, options);

    this.barCount = options.barCount ?? 64;
    this.barGap = options.barGap ?? 0.1;
    this.smoothing = options.smoothing ?? 0.15;
    this.colorMode = options.colorMode || 'gradient';
    this.showReflection = options.showReflection !== false;

    // Smoothed bar heights for fluid animation
    this._smoothedHeights = new Float32Array(this.barCount);

    // Pre-allocated color for updates
    this._tempColor = new THREE.Color();

    // Track energy for overall effects
    this._smoothedEnergy = 0;
  }

  /**
   * Initialize visualizer-specific elements
   * @override
   */
  setup() {
    // Use orthographic camera for 2D bar display
    this._setupOrthographicCamera();

    // Create bar meshes
    this._createBars();

    // Create reflection if enabled
    if (this.showReflection) {
      this._createReflection();
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
   * Create bar meshes
   * @private
   */
  _createBars() {
    this.bars = [];
    this.barMaterials = [];
    this.barGeometries = []; // Store individual geometries for disposal
    this.barGroup = new THREE.Group();

    const aspect = this.height > 0 ? this.width / this.height : 1;
    const totalWidth = 2 * aspect * 0.9; // 90% of viewport width
    const barWidth = totalWidth / this.barCount;
    const gapWidth = barWidth * this.barGap;
    const actualBarWidth = barWidth - gapWidth;

    for (let i = 0; i < this.barCount; i++) {
      // Create individual geometry for each bar (avoids shared geometry mutation)
      const geometry = new THREE.PlaneGeometry(actualBarWidth, 1);
      // Translate so origin is at bottom - scaling will grow upward
      geometry.translate(0, 0.5, 0);

      // Calculate bar color based on mode
      const color = this._getBarColor(i / this.barCount);

      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);

      // Position bar
      const x = -totalWidth / 2 + barWidth * i + barWidth / 2;
      mesh.position.x = x;
      mesh.position.y = -0.5; // Start at bottom
      mesh.scale.y = 0.01; // Start with minimal height

      this.barGroup.add(mesh);
      this.bars.push(mesh);
      this.barMaterials.push(material);
      this.barGeometries.push(geometry);
    }

    this.scene.add(this.barGroup);
  }

  /**
   * Create reflection group
   * @private
   */
  _createReflection() {
    this.reflectionBars = [];
    this.reflectionMaterials = [];
    this.reflectionGeometries = []; // Store individual geometries for disposal
    this.reflectionGroup = new THREE.Group();

    const aspect = this.height > 0 ? this.width / this.height : 1;
    const totalWidth = 2 * aspect * 0.9;
    const barWidth = totalWidth / this.barCount;
    const gapWidth = barWidth * this.barGap;
    const actualBarWidth = barWidth - gapWidth;

    for (let i = 0; i < this.barCount; i++) {
      // Create individual geometry for each reflection bar
      const geometry = new THREE.PlaneGeometry(actualBarWidth, 1);
      // Origin at top (which is bottom when flipped)
      geometry.translate(0, 0.5, 0);

      const color = this._getBarColor(i / this.barCount);

      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.2, // Dimmer reflection
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);

      const x = -totalWidth / 2 + barWidth * i + barWidth / 2;
      mesh.position.x = x;
      mesh.position.y = -0.5; // At the same baseline
      mesh.scale.y = 0.01;
      mesh.rotation.x = Math.PI; // Flip upside down

      this.reflectionGroup.add(mesh);
      this.reflectionBars.push(mesh);
      this.reflectionMaterials.push(material);
      this.reflectionGeometries.push(geometry);
    }

    this.reflectionGroup.position.z = -0.01;
    this.scene.add(this.reflectionGroup);
  }

  /**
   * Get color for a bar based on its position and color mode
   * @private
   */
  _getBarColor(position) {
    switch (this.colorMode) {
      case 'solid':
        return new THREE.Color(this.colors.primary);
      case 'pitch':
        // Will be updated dynamically based on pitch
        return new THREE.Color(this.colors.primary);
      case 'gradient':
      default:
        return this.getGradientColor(position);
    }
  }

  /**
   * Update visualizer based on audio data
   * @override
   */
  update(audioData, deltaTime) {
    // Guard against destroyed or partially initialized state
    if (!this.bars || !this.barMaterials) return;

    // Frame-rate independent smoothing
    const dt = Math.max(deltaTime, 0.001);
    const smoothFactor = 1 - Math.pow(1 - this.smoothing, dt * 60);

    // Smooth energy
    this._smoothedEnergy = this.lerp(
      this._smoothedEnergy,
      audioData.energy || 0,
      smoothFactor
    );

    // Get frequency data
    const freqData = audioData.frequencyData;

    // Update bar heights
    this._updateBarHeights(freqData, smoothFactor);

    // Update colors if in pitch mode
    if (this.colorMode === 'pitch' && audioData.pitch) {
      this._updatePitchColors(audioData);
    }

    // Update reflection if enabled
    if (this.showReflection && this.reflectionBars) {
      this._updateReflection();
    }
  }

  /**
   * Update bar heights from frequency data
   * @private
   */
  _updateBarHeights(freqData, smoothFactor) {
    // Guard: ensure bars array is properly initialized
    if (!this.bars || this.bars.length === 0) return;

    const maxHeight = 1.8; // Maximum bar height in world units
    const barLen = this.bars.length;

    for (let i = 0; i < barLen; i++) {
      let amplitude = 0;

      if (freqData && freqData.length > 0) {
        // Map bar index to frequency bin
        // Use logarithmic mapping for better low-frequency representation
        const freqIndex = this._getFrequencyIndex(i, freqData.length);
        amplitude = freqData[freqIndex] / 255; // Normalize to 0-1
      }

      // Apply some non-linearity for more dynamic visuals
      amplitude = Math.pow(amplitude, 0.8);

      // Smooth the height
      this._smoothedHeights[i] = this.lerp(
        this._smoothedHeights[i],
        amplitude,
        smoothFactor
      );

      // Update bar scale
      const height = Math.max(this._smoothedHeights[i] * maxHeight, 0.01);
      const bar = this.bars[i];
      if (bar) {
        bar.scale.y = height;
      }

      // Update opacity based on height and energy
      const mat = this.barMaterials[i];
      if (mat) {
        const baseOpacity = 0.6 + this._smoothedHeights[i] * 0.4;
        mat.opacity = baseOpacity;
      }
    }
  }

  /**
   * Map bar index to frequency bin with logarithmic scaling
   * @private
   */
  _getFrequencyIndex(barIndex, dataLength) {
    // Logarithmic mapping gives more resolution to lower frequencies
    const minLog = Math.log(1);
    const maxLog = Math.log(dataLength);
    const scale = (maxLog - minLog) / this.barCount;

    const logIndex = minLog + scale * barIndex;
    const index = Math.floor(Math.exp(logIndex));

    return Math.min(index, dataLength - 1);
  }

  /**
   * Update colors based on detected pitch
   * @private
   */
  _updatePitchColors(audioData) {
    const pitch = audioData.pitch;
    const noteHues = {
      'C': 0, 'C#': 30, 'D': 60, 'D#': 90,
      'E': 120, 'F': 150, 'F#': 180, 'G': 210,
      'G#': 240, 'A': 270, 'A#': 300, 'B': 330
    };

    const hue = noteHues[pitch] || 260;
    this._tempColor.setHSL(hue / 360, 0.7, 0.5);

    for (let i = 0; i < this.barMaterials.length; i++) {
      // Blend current color toward pitch color
      this.barMaterials[i].color.lerp(this._tempColor, 0.1);
    }
  }

  /**
   * Update reflection bars to match main bars
   * @private
   */
  _updateReflection() {
    // Guard against destroyed or uninitialized state
    if (!this.reflectionBars || this.reflectionBars.length === 0) return;
    if (!this.bars || this.bars.length === 0) return;

    const len = Math.min(this.reflectionBars.length, this.bars.length);
    for (let i = 0; i < len; i++) {
      const refBar = this.reflectionBars[i];
      const mainBar = this.bars[i];
      const refMat = this.reflectionMaterials[i];
      const mainMat = this.barMaterials[i];

      if (refBar && mainBar) {
        // Reflection height matches main bar but scaled down
        refBar.scale.y = mainBar.scale.y * 0.3;
      }

      if (refMat && mainMat) {
        // Match color with reduced opacity
        refMat.color.copy(mainMat.color);
        refMat.opacity = mainMat.opacity * 0.25;
      }
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

    // Recreate bars for new aspect ratio
    this._recreateBars();
  }

  /**
   * Recreate bars after resize
   * @private
   */
  _recreateBars() {
    // Remove existing bars with proper disposal
    if (this.barGroup) {
      this.scene.remove(this.barGroup);
      // Dispose geometries
      this.barGeometries?.forEach(geom => geom.dispose());
      // Dispose materials
      this.barMaterials?.forEach(mat => mat.dispose());
    }

    if (this.reflectionGroup) {
      this.scene.remove(this.reflectionGroup);
      // Dispose geometries
      this.reflectionGeometries?.forEach(geom => geom.dispose());
      // Dispose materials
      this.reflectionMaterials?.forEach(mat => mat.dispose());
    }

    // Reset arrays
    this.bars = null;
    this.barMaterials = null;
    this.barGeometries = null;
    this.reflectionBars = null;
    this.reflectionMaterials = null;
    this.reflectionGeometries = null;

    // Recreate
    this._createBars();
    if (this.showReflection) {
      this._createReflection();
    }
  }

  /**
   * Cleanup
   * @override
   */
  onDestroy() {
    // Dispose bar geometries and materials
    if (this.barGeometries) {
      this.barGeometries.forEach(geom => geom.dispose());
    }
    if (this.barMaterials) {
      this.barMaterials.forEach(mat => mat.dispose());
    }
    if (this.barGroup) {
      this.scene.remove(this.barGroup);
    }

    // Dispose reflection geometries and materials
    if (this.reflectionGeometries) {
      this.reflectionGeometries.forEach(geom => geom.dispose());
    }
    if (this.reflectionMaterials) {
      this.reflectionMaterials.forEach(mat => mat.dispose());
    }
    if (this.reflectionGroup) {
      this.scene.remove(this.reflectionGroup);
    }

    // Clear references
    this.bars = null;
    this.barMaterials = null;
    this.barGeometries = null;
    this.barGroup = null;
    this.reflectionBars = null;
    this.reflectionMaterials = null;
    this.reflectionGeometries = null;
    this.reflectionGroup = null;
    this._smoothedHeights = null;
    this._tempColor = null;
  }

  /**
   * Get visualizer name
   * @override
   */
  get name() {
    return 'Bars';
  }

  /**
   * Get visualizer description
   * @override
   */
  get description() {
    return 'Classic frequency spectrum with vertical bars';
  }
}
