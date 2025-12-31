import * as THREE from 'three';
import { Noise } from 'noisejs';
import { BaseVisualizer } from './BaseVisualizer.js';

/**
 * SphereVisualizer - Pulsing sphere with energy-reactive colors
 *
 * Features:
 * - Color shifts through gradient on energy transients (kicks, hits)
 * - Perlin noise vertex deformation for timbre
 */
export class SphereVisualizer extends BaseVisualizer {
  constructor(container, options = {}) {
    super(container, options);

    // Perlin noise generator
    this._noise = new Noise(Math.random());

    // Current size (used for noise threshold)
    this._size = 0;

    // Smoothed values
    this._smoothedEnergy = 0;
    this._smoothedRoughness = 0;

    // Energy normalization
    this._maxEnergySeen = 0.1;

    // Transient detection for gradient palette shifts
    this._prevEnergy = 0;
    this._transientThreshold = 0.12; // Energy jump needed to trigger palette shift
    this._currentPaletteIndex = 0;

    // Multiple gradient palettes - vibrant colors (no black/gray)
    this._palettes = [
      // Purple royalty
      ['#552586', '#6A359C', '#804FB3', '#B589D6'],
      // Blue to purple
      ['#2A1AD8', '#4E26E2', '#7231EC', '#B948FF'],
      // Violet blue
      ['#3A41C6', '#4634A7', '#4C2C96', '#6A359C'],
      // Electric purple
      ['#aa00ff', '#9600ff', '#6f00ff', '#5512fb'],
      // Ocean violet
      ['#3D3BBB', '#5B21B6', '#7C3AED', '#A78BFA'],
      // Pink magenta
      ['#BE185D', '#DB2777', '#EC4899', '#F472B6'],
      // Rose pink
      ['#9F1239', '#BE123C', '#E11D48', '#FB7185'],
      // Teal cyan
      ['#0F766E', '#14B8A6', '#2DD4BF', '#5EEAD4'],
      // Indigo blend
      ['#3730A3', '#4F46E5', '#6366F1', '#818CF8'],
      // Fuchsia pop
      ['#A21CAF', '#C026D3', '#D946EF', '#E879F9'],
      // Warm purple
      ['#6B21A8', '#7C3AED', '#8B5CF6', '#A78BFA'],
      // Blue electric
      ['#1D4ED8', '#2563EB', '#3B82F6', '#60A5FA'],
      // Violet pink
      ['#7C3AED', '#8B5CF6', '#A855F7', '#D946EF'],
      // Coral sunset
      ['#DC2626', '#EF4444', '#F87171', '#FCA5A5'],
      // Emerald
      ['#047857', '#059669', '#10B981', '#34D399'],
      // Soft lavender
      ['#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD'],
    ];

  }

  /**
   * Calculate the maximum sphere scale that fits within viewport
   * @private
   */
  _calculateMaxScale() {
    // Split the difference: sphere can take up to ~50% of viewport
    // Max scale of 1.8 gives radius 0.54, diameter 1.08
    // Visible height at z=4 with FOV 30 ≈ 2.14
    // 1.08 / 2.14 ≈ 50% of viewport height
    this._maxSphereScale = 1.8;
  }

  /**
   * Setup - matches original init()
   * @override
   */
  setup() {
    // Camera setup - viewing from front
    const aspect = this.width / this.height;
    this.camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000);
    this.camera.position.set(0, 0.3, 4);
    this.camera.lookAt(0, 0, 0);

    // Calculate max scale for this viewport
    this._calculateMaxScale();

    // Lighting - same as original
    const ambientLight = new THREE.AmbientLight(0xaaaaaa);
    this.scene.add(ambientLight);

    const spotLight = new THREE.SpotLight(0xffffff);
    spotLight.intensity = 0.9;
    spotLight.position.set(-10, 40, 20);
    spotLight.castShadow = true;
    this.scene.add(spotLight);

    // Create group for sphere
    this._group = new THREE.Group();
    this.scene.add(this._group);

    // Create sphere (unit size, scaled dynamically)
    this._createSphere();
  }

  /**
   * Create sphere with gradient shader
   * @private
   */
  _createSphere() {
    // Create geometry with small base radius - scale controls final size
    const geometry = new THREE.SphereGeometry(0.3, 128, 128);

    // Store original positions for noise deformation
    const positions = geometry.attributes.position.array;
    this._originalPositions = new Float32Array(positions.length);
    this._originalPositions.set(positions);

    // 4-color radial gradient shader
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color0: { value: new THREE.Color('#4c1d95') },
        color1: { value: new THREE.Color('#6d28d9') },
        color2: { value: new THREE.Color('#8b5cf6') },
        color3: { value: new THREE.Color('#a78bfa') },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormal;

        void main() {
          vUv = uv;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        #define PI 3.14159265359

        uniform vec3 color0;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;

        varying vec2 vUv;
        varying vec3 vNormal;

        void main() {
          // Top to bottom gradient using V coordinate
          float t = vUv.y; // 0 (bottom) to 1 (top)

          // Smooth 4-color gradient from top to bottom
          vec3 color;
          if (t < 0.33) {
            color = mix(color0, color1, t * 3.0);
          } else if (t < 0.66) {
            color = mix(color1, color2, (t - 0.33) * 3.0);
          } else {
            color = mix(color2, color3, (t - 0.66) * 3.0);
          }

          // 3D shading based on normal
          float facing = dot(vNormal, vec3(0.0, 0.0, 1.0));
          float shade = 0.6 + 0.4 * facing;

          // Rim lighting
          float rim = 1.0 - max(0.0, facing);
          rim = pow(rim, 2.0) * 0.2;

          color = color * shade + color * rim;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this._sphere = new THREE.Mesh(geometry, material);
    this._sphere.position.set(0, 0, 0);
    this._group.add(this._sphere);
  }

  /**
   * Update sphere colors based on current palette
   * @private
   */
  _updateColors() {
    if (!this._sphere?.material?.uniforms) return;

    const palette = this._palettes[this._currentPaletteIndex];
    if (!palette) return;

    // Set the 4 colors from current palette
    this._sphere.material.uniforms.color0.value.set(palette[0]);
    this._sphere.material.uniforms.color1.value.set(palette[1]);
    this._sphere.material.uniforms.color2.value.set(palette[2]);
    this._sphere.material.uniforms.color3.value.set(palette[3]);
  }

  /**
   * HSL to Hex - exact copy from original with NaN protection
   * @private
   */
  _HSLToHex(h, s, l) {
    // Protect against NaN/undefined values
    h = Number.isFinite(h) ? h : 200;
    s = Number.isFinite(s) ? s : 50;
    l = Number.isFinite(l) ? l : 50;

    s /= 100;
    l /= 100;

    let c = (1 - Math.abs(2 * l - 1)) * s;
    let x = c * (1 - Math.abs((h / 60) % 2 - 1));
    let m = l - c / 2;
    let r = 0, g = 0, b = 0;

    if (0 <= h && h < 60) {
      r = c; g = x; b = 0;
    } else if (60 <= h && h < 120) {
      r = x; g = c; b = 0;
    } else if (120 <= h && h < 180) {
      r = 0; g = c; b = x;
    } else if (180 <= h && h < 240) {
      r = 0; g = x; b = c;
    } else if (240 <= h && h < 300) {
      r = x; g = 0; b = c;
    } else if (300 <= h && h < 360) {
      r = c; g = 0; b = x;
    }

    r = Math.round((r + m) * 255).toString(16).padStart(2, '0');
    g = Math.round((g + m) * 255).toString(16).padStart(2, '0');
    b = Math.round((b + m) * 255).toString(16).padStart(2, '0');

    return '#' + r + g + b;
  }

  /**
   * Update - handles transient detection and color shifts
   * @override
   */
  update(audioData, deltaTime) {
    if (!this._sphere) return;

    const dt = Math.max(deltaTime, 0.001);
    const smoothFactor = 1 - Math.pow(0.85, dt * 60);

    // Normalize energy
    const rawEnergy = audioData.energy || 0;
    this._maxEnergySeen = Math.max(this._maxEnergySeen * 0.995, rawEnergy);
    const normalizedRaw = rawEnergy / Math.max(this._maxEnergySeen, 0.001);
    const normalizedEnergy = Math.sqrt(normalizedRaw);
    this._smoothedEnergy = this.lerp(this._smoothedEnergy, normalizedEnergy, smoothFactor);

    // Timbre for noise deformation (rough/immediate response)
    this._smoothedRoughness = this.lerp(this._smoothedRoughness, audioData.roughness || 0, 0.6);

    // === TRANSIENT DETECTION FOR PALETTE SHIFTS ===
    const energyDelta = normalizedEnergy - this._prevEnergy;
    this._prevEnergy = normalizedEnergy;

    // Detect sudden energy increase (transient/hit) - switch to next palette
    if (energyDelta > this._transientThreshold) {
      this._currentPaletteIndex = (this._currentPaletteIndex + 1) % this._palettes.length;
    }

    // === SIZE / SCALE ===
    const maxScale = this._maxSphereScale || 1.8;
    const rawSize = 0.6 + this._smoothedEnergy * 0.8;
    this._size = Math.min(rawSize, maxScale);

    if (this._sphere) {
      this._sphere.scale.setScalar(this._size);
    }

    // Update colors
    this._updateColors();

    // Apply perlin noise deformation for timbre
    this._applyNoiseDeformation();

    // Rotation
    if (this._sphere) {
      this._sphere.rotation.y += dt * (0.3 + this._smoothedEnergy * 0.5);
    }
  }

  /**
   * Apply perlin noise deformation - matches original update() with more drama
   * @private
   */
  _applyNoiseDeformation() {
    if (!this._sphere?.geometry || !this._originalPositions) return;

    const positionAttribute = this._sphere.geometry.getAttribute('position');
    if (!positionAttribute) return;

    const positions = positionAttribute.array;
    const original = this._originalPositions;
    const time = performance.now() * 0.001;

    // Original: scalingFactor = 1 + roughness * 3
    const scalingFactor = 1 + this._smoothedRoughness * 3;

    // Apply noise when there's enough energy - more sensitive than original
    const shouldDeform = this._smoothedEnergy > 0.05;

    // Noise intensity based on roughness (timbre) - MORE dramatic
    const noiseIntensity = 0.4 + this._smoothedRoughness * 0.6; // 0.4 to 1.0

    for (let i = 0; i < positions.length; i += 3) {
      const ox = original[i];
      const oy = original[i + 1];
      const oz = original[i + 2];

      if (shouldDeform) {
        // Animated noise with time component
        const noiseValue = this._noise.perlin3(
          ox * scalingFactor * 3 + time * 0.5,
          oy * scalingFactor * 3 + time * 0.3,
          oz * scalingFactor * 3 + time * 0.4
        );

        if (!isNaN(noiseValue) && isFinite(noiseValue)) {
          // Normalize then scale - exact original approach
          const len = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
          const nx = ox / len;
          const ny = oy / len;
          const nz = oz / len;

          // More dramatic deformation based on roughness
          const scale = len * (1 + noiseIntensity * noiseValue);

          positions[i] = nx * scale;
          positions[i + 1] = ny * scale;
          positions[i + 2] = nz * scale;
        } else {
          positions[i] = ox;
          positions[i + 1] = oy;
          positions[i + 2] = oz;
        }
      } else {
        positions[i] = ox;
        positions[i + 1] = oy;
        positions[i + 2] = oz;
      }
    }

    positionAttribute.needsUpdate = true;
    this._sphere.geometry.computeVertexNormals();
  }

  /**
   * Handle resize
   * @override
   */
  onResize(width, height) {
    if (!this.camera) return;
    const aspect = height > 0 ? width / height : 1;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    // Recalculate max scale for new viewport size
    this._calculateMaxScale();
  }

  /**
   * Cleanup
   * @override
   */
  onDestroy() {
    // Dispose sphere
    if (this._sphere) {
      if (this._sphere.geometry) this._sphere.geometry.dispose();
      if (this._sphere.material) this._sphere.material.dispose();
      this._group?.remove(this._sphere);
      this._sphere = null;
    }

    if (this._group) {
      this.scene.remove(this._group);
      this._group = null;
    }
    this._noise = null;
  }

  get name() {
    return 'Sphere';
  }

  get description() {
    return 'Pulsing sphere with energy-reactive gradient colors';
  }
}
