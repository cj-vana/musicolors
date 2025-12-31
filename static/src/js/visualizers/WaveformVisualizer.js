import * as THREE from 'three';
import { BaseVisualizer } from './BaseVisualizer.js';

/**
 * WaveformVisualizer - Oscilloscope-style time-domain visualization
 *
 * Displays a smooth line showing the audio waveform in real-time.
 * Features a glow effect and color that responds to audio characteristics.
 *
 * Audio Mapping:
 * - timeDomainData → waveform shape
 * - energy → line thickness/glow intensity
 * - warmth → line color hue
 */
export class WaveformVisualizer extends BaseVisualizer {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {number} [options.linePoints=256] - Number of points in the waveform line
   * @param {number} [options.lineWidth=3] - Base line width in pixels
   * @param {number} [options.smoothing=0.2] - Animation smoothing factor
   * @param {boolean} [options.showGlow=true] - Show glow effect behind line
   * @param {number} [options.glowIntensity=0.5] - Glow intensity (0-1)
   */
  constructor(container, options = {}) {
    super(container, options);

    this.linePoints = options.linePoints ?? 256;
    this.lineWidth = options.lineWidth ?? 3;
    this.smoothing = options.smoothing ?? 0.2;
    this.showGlow = options.showGlow !== false;
    this.glowIntensity = options.glowIntensity ?? 0.5;

    // Smoothed values
    this._smoothedEnergy = 0;
    this._smoothedWarmth = 0;
    this._currentHue = 260;

    // Pre-allocated arrays for waveform points
    this._waveformData = new Float32Array(this.linePoints);
    this._smoothedWaveform = new Float32Array(this.linePoints);

    // Pre-allocated color for updates
    this._tempColor = new THREE.Color();
  }

  /**
   * Initialize visualizer-specific elements
   * @override
   */
  setup() {
    // Use orthographic camera for 2D display
    this._setupOrthographicCamera();

    // Create glow line (rendered first, behind main line)
    if (this.showGlow) {
      this._createGlowLine();
    }

    // Create main waveform line
    this._createMainLine();
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
   * Create main waveform line
   * @private
   */
  _createMainLine() {
    const aspect = this.height > 0 ? this.width / this.height : 1;
    const points = [];

    // Create initial flat line
    for (let i = 0; i < this.linePoints; i++) {
      const x = (i / (this.linePoints - 1) - 0.5) * 2 * aspect * 0.95;
      points.push(new THREE.Vector3(x, 0, 0));
    }

    this._mainGeometry = new THREE.BufferGeometry().setFromPoints(points);
    this._mainMaterial = new THREE.LineBasicMaterial({
      color: this.colors.primary,
      linewidth: this.lineWidth,
      transparent: true,
      opacity: 1,
    });

    this._mainLine = new THREE.Line(this._mainGeometry, this._mainMaterial);
    this.scene.add(this._mainLine);
  }

  /**
   * Create glow line (thicker, semi-transparent line behind main)
   * @private
   */
  _createGlowLine() {
    const aspect = this.height > 0 ? this.width / this.height : 1;
    const points = [];

    for (let i = 0; i < this.linePoints; i++) {
      const x = (i / (this.linePoints - 1) - 0.5) * 2 * aspect * 0.95;
      points.push(new THREE.Vector3(x, 0, 0));
    }

    this._glowGeometry = new THREE.BufferGeometry().setFromPoints(points);
    this._glowMaterial = new THREE.LineBasicMaterial({
      color: this.colors.primary,
      linewidth: this.lineWidth * 3,
      transparent: true,
      opacity: this.glowIntensity * 0.3,
      blending: THREE.AdditiveBlending,
    });

    this._glowLine = new THREE.Line(this._glowGeometry, this._glowMaterial);
    this._glowLine.position.z = -0.01;
    this.scene.add(this._glowLine);
  }

  /**
   * Update visualizer based on audio data
   * @override
   */
  update(audioData, deltaTime) {
    // Guard against destroyed state
    if (!this._mainGeometry || !this._mainMaterial) return;

    // Frame-rate independent smoothing
    const dt = Math.max(deltaTime, 0.001);
    const smoothFactor = 1 - Math.pow(1 - this.smoothing, dt * 60);
    const colorSmoothFactor = 1 - Math.pow(1 - this.smoothing * 0.3, dt * 60);

    // Smooth energy and warmth
    this._smoothedEnergy = this.lerp(
      this._smoothedEnergy,
      audioData.energy || 0,
      smoothFactor
    );
    this._smoothedWarmth = this.lerp(
      this._smoothedWarmth,
      audioData.warmth || 0,
      colorSmoothFactor
    );

    // Update color based on warmth
    const targetHue = this.mapRange(
      Math.min(this._smoothedWarmth, 4000),
      0, 4000,
      260, 360
    );
    this._currentHue = this.lerp(this._currentHue, targetHue, colorSmoothFactor);

    // Process waveform data
    this._processWaveform(audioData.timeDomainData, smoothFactor);

    // Update line geometry
    this._updateLineGeometry();

    // Update colors
    this._updateColors();
  }

  /**
   * Process time domain data into smoothed waveform
   * @private
   */
  _processWaveform(timeDomainData, smoothFactor) {
    const aspect = this.height > 0 ? this.width / this.height : 1;

    if (!timeDomainData || timeDomainData.length === 0) {
      // No data - smooth toward flat line
      for (let i = 0; i < this.linePoints; i++) {
        this._smoothedWaveform[i] = this.lerp(this._smoothedWaveform[i], 0, smoothFactor);
      }
      return;
    }

    // Sample the time domain data to match our line point count
    const dataLength = timeDomainData.length;

    for (let i = 0; i < this.linePoints; i++) {
      // Map line point to data index
      const dataIndex = Math.floor((i / this.linePoints) * dataLength);

      // Get normalized amplitude (-1 to 1)
      const rawValue = (timeDomainData[dataIndex] - 128) / 128;

      // Scale by energy for more dynamic response
      const scaledValue = rawValue * (0.3 + this._smoothedEnergy * 0.7);

      // Smooth the value
      this._smoothedWaveform[i] = this.lerp(
        this._smoothedWaveform[i],
        scaledValue,
        smoothFactor
      );
    }
  }

  /**
   * Update line geometry with current waveform data
   * @private
   */
  _updateLineGeometry() {
    const aspect = this.height > 0 ? this.width / this.height : 1;
    const positions = this._mainGeometry.attributes.position.array;
    const amplitude = 0.6; // Maximum waveform amplitude in world units

    for (let i = 0; i < this.linePoints; i++) {
      const x = (i / (this.linePoints - 1) - 0.5) * 2 * aspect * 0.95;
      const y = this._smoothedWaveform[i] * amplitude;

      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
    }

    this._mainGeometry.attributes.position.needsUpdate = true;

    // Update glow line to match
    if (this.showGlow && this._glowGeometry) {
      const glowPositions = this._glowGeometry.attributes.position.array;
      for (let i = 0; i < this.linePoints; i++) {
        glowPositions[i * 3] = positions[i * 3];
        glowPositions[i * 3 + 1] = positions[i * 3 + 1];
        glowPositions[i * 3 + 2] = positions[i * 3 + 2];
      }
      this._glowGeometry.attributes.position.needsUpdate = true;
    }
  }

  /**
   * Update line colors based on audio
   * @private
   */
  _updateColors() {
    // Calculate color from hue
    const saturation = 70 + this._smoothedEnergy * 20;
    const lightness = 50 + this._smoothedEnergy * 15;
    this._tempColor.setHSL(this._currentHue / 360, saturation / 100, lightness / 100);

    // Update main line color
    this._mainMaterial.color.copy(this._tempColor);

    // Update glow with same color
    if (this._glowMaterial) {
      this._glowMaterial.color.copy(this._tempColor);
      // Glow opacity based on energy
      this._glowMaterial.opacity = this.glowIntensity * (0.2 + this._smoothedEnergy * 0.3);
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

    // Recreate lines for new aspect ratio
    this._recreateLines();
  }

  /**
   * Recreate lines after resize
   * @private
   */
  _recreateLines() {
    // Dispose existing
    if (this._mainLine) {
      this.scene.remove(this._mainLine);
      this._mainGeometry?.dispose();
      this._mainMaterial?.dispose();
    }

    if (this._glowLine) {
      this.scene.remove(this._glowLine);
      this._glowGeometry?.dispose();
      this._glowMaterial?.dispose();
    }

    // Clear references
    this._mainLine = null;
    this._mainGeometry = null;
    this._mainMaterial = null;
    this._glowLine = null;
    this._glowGeometry = null;
    this._glowMaterial = null;

    // Recreate
    if (this.showGlow) {
      this._createGlowLine();
    }
    this._createMainLine();
  }

  /**
   * Cleanup
   * @override
   */
  onDestroy() {
    // Dispose main line
    if (this._mainLine) {
      this.scene.remove(this._mainLine);
    }
    if (this._mainGeometry) {
      this._mainGeometry.dispose();
    }
    if (this._mainMaterial) {
      this._mainMaterial.dispose();
    }

    // Dispose glow line
    if (this._glowLine) {
      this.scene.remove(this._glowLine);
    }
    if (this._glowGeometry) {
      this._glowGeometry.dispose();
    }
    if (this._glowMaterial) {
      this._glowMaterial.dispose();
    }

    // Clear references
    this._mainLine = null;
    this._mainGeometry = null;
    this._mainMaterial = null;
    this._glowLine = null;
    this._glowGeometry = null;
    this._glowMaterial = null;
    this._waveformData = null;
    this._smoothedWaveform = null;
    this._tempColor = null;
  }

  /**
   * Get visualizer name
   * @override
   */
  get name() {
    return 'Waveform';
  }

  /**
   * Get visualizer description
   * @override
   */
  get description() {
    return 'Oscilloscope-style waveform display';
  }
}
