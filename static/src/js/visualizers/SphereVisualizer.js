import * as THREE from 'three';
import { Noise } from 'noisejs';
import { BaseVisualizer } from './BaseVisualizer.js';

// Material mode constants
const MATERIAL_MODE = {
  GRADIENT: 0,
  GLASS: 1,
  METALLIC: 2,
};

/**
 * SphereVisualizer - Pulsing sphere with multiple material modes
 *
 * Features:
 * - Color shifts through gradient on energy transients (kicks, hits)
 * - Perlin noise vertex deformation for timbre
 * - Background metallic particles that scatter on beats
 * - Three material modes: Gradient, Glass, Metallic
 * - Auto-switching materials on silence (song changes)
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

    // Material mode system
    this._materialMode = MATERIAL_MODE.GRADIENT;
    this._materials = {}; // Cached materials by mode
    this._currentMetallicIndex = 0; // For cycling metallic colors

    // Silence detection for auto-switching materials
    // Note: Uses raw energy (not normalized) for reliable detection
    this._silenceThreshold = 0.005; // Raw energy below this is silence
    this._silenceExitThreshold = 0.02; // Higher threshold to exit silence (hysteresis)
    this._silenceDuration = 0; // Accumulated silence time in seconds
    this._silenceSwitchTime = 4; // Seconds of silence before switching material
    this._isSilent = false; // Track silence state for hysteresis
    this._lastSwitchTime = 0; // Timestamp of last material switch
    this._switchCooldown = 8; // Minimum seconds between material switches

    // Metallic color options (chrome + tinted metals)
    this._metallicColors = [
      { name: 'Chrome', color: 0xffffff, roughness: 0.05 },
      { name: 'Gold', color: 0xffd700, roughness: 0.2 },
      { name: 'Copper', color: 0xb87333, roughness: 0.25 },
      { name: 'Silver', color: 0xc0c0c0, roughness: 0.15 },
      { name: 'Rose Gold', color: 0xb76e79, roughness: 0.2 },
    ];

    // Particle system settings
    this._particleCount = 200;
    this._particles = null;
    this._particlePositions = null;
    this._particleVelocities = null;
    this._particleColors = null;
    this._particleHomePositions = null;
    this._currentParticlePaletteIndex = 0;

    // Reusable THREE.Color object to avoid allocations in hot path
    this._tempColor = new THREE.Color();

    // Metallic particle palettes
    this._particlePalettes = [
      // Gold
      ['#FFD700', '#FFC125', '#DAA520', '#B8860B'],
      // Silver
      ['#C0C0C0', '#A8A8A8', '#D4D4D4', '#E8E8E8'],
      // Copper/Bronze
      ['#B87333', '#CD7F32', '#8B4513', '#A0522D'],
      // Platinum
      ['#E5E4E2', '#D4D4D4', '#C0C0C0', '#B8B8B8'],
      // Rose Gold
      ['#B76E79', '#E0BFB8', '#C9A9A6', '#D4A5A5'],
    ];

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

    // Lighting - enhanced for glass/metallic materials
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    const spotLight = new THREE.SpotLight(0xffffff);
    spotLight.intensity = 0.9;
    spotLight.position.set(-10, 40, 20);
    spotLight.castShadow = true;
    this.scene.add(spotLight);

    // Add point lights for better reflections on glass/metallic
    const pointLight1 = new THREE.PointLight(0x6366f1, 0.5);
    pointLight1.position.set(3, 2, 3);
    this.scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0x8b5cf6, 0.3);
    pointLight2.position.set(-3, -2, 2);
    this.scene.add(pointLight2);

    // Create simple environment map for glass/metallic reflections
    this._createEnvironmentMap();

    // Create group for sphere
    this._group = new THREE.Group();
    this.scene.add(this._group);

    // Create sphere (unit size, scaled dynamically)
    this._createSphere();

    // Create background particles
    this._createParticles();
  }

  /**
   * Create a simple procedural environment map for reflections
   * @private
   */
  _createEnvironmentMap() {
    // Use PMREMGenerator to create an environment map
    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    pmremGenerator.compileEquirectangularShader();

    // Create a simple scene with a colored background for the env map
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x1a1a2e);

    // Add some colored lights to the env scene for reflections
    const envLight1 = new THREE.PointLight(0x6366f1, 2);
    envLight1.position.set(5, 5, 5);
    envScene.add(envLight1);

    const envLight2 = new THREE.PointLight(0x8b5cf6, 1.5);
    envLight2.position.set(-5, 3, 5);
    envScene.add(envLight2);

    const envLight3 = new THREE.PointLight(0x22c55e, 1);
    envLight3.position.set(0, -5, 5);
    envScene.add(envLight3);

    // Generate the environment map
    this._envMap = pmremGenerator.fromScene(envScene, 0.04).texture;

    // Cleanup temporary resources
    pmremGenerator.dispose();
    envLight1.dispose();
    envLight2.dispose();
    envLight3.dispose();
    envScene.background = null;
  }

  /**
   * Create sphere with initial gradient material
   * @private
   */
  _createSphere() {
    // Create geometry with small base radius - scale controls final size
    const geometry = new THREE.SphereGeometry(0.3, 128, 128);

    // Store original positions for noise deformation
    const positions = geometry.attributes.position.array;
    this._originalPositions = new Float32Array(positions.length);
    this._originalPositions.set(positions);

    // Create and cache the gradient material
    this._materials.gradient = this._createGradientMaterial();

    this._sphere = new THREE.Mesh(geometry, this._materials.gradient);
    this._sphere.position.set(0, 0, 0);
    this._group.add(this._sphere);
  }

  /**
   * Create background particle system with metallic colors
   * @private
   */
  _createParticles() {
    const count = this._particleCount;
    const geometry = new THREE.BufferGeometry();

    // Initialize position, velocity, and color arrays
    this._particlePositions = new Float32Array(count * 3);
    this._particleVelocities = new Float32Array(count * 3);
    this._particleHomePositions = new Float32Array(count * 3);
    this._particleColors = new Float32Array(count * 3);

    // Get current metallic palette
    const palette = this._particlePalettes[this._currentParticlePaletteIndex];

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Distribute particles in a sphere shell behind the main sphere
      // Radius between 1.5 and 3.5, positioned behind (negative z bias)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 1.5 + Math.random() * 2.0;

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = -Math.abs(radius * Math.cos(phi)) - 0.5; // Push behind sphere

      this._particlePositions[i3] = x;
      this._particlePositions[i3 + 1] = y;
      this._particlePositions[i3 + 2] = z;

      // Store home positions for return animation
      this._particleHomePositions[i3] = x;
      this._particleHomePositions[i3 + 1] = y;
      this._particleHomePositions[i3 + 2] = z;

      // Initialize velocities to zero
      this._particleVelocities[i3] = 0;
      this._particleVelocities[i3 + 1] = 0;
      this._particleVelocities[i3 + 2] = 0;

      // Assign random color from palette (reuse tempColor to avoid allocations)
      const colorHex = palette[Math.floor(Math.random() * palette.length)];
      this._tempColor.set(colorHex);
      this._particleColors[i3] = this._tempColor.r;
      this._particleColors[i3 + 1] = this._tempColor.g;
      this._particleColors[i3 + 2] = this._tempColor.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(this._particlePositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this._particleColors, 3));

    // Create particle material with vertex colors
    const material = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
    });

    this._particles = new THREE.Points(geometry, material);
    this._particles.position.set(0, 0, 0);

    // Add behind sphere (render order)
    this._particles.renderOrder = -1;
    this.scene.add(this._particles);
  }

  /**
   * Scatter particles on transient/beat hit
   * @private
   */
  _scatterParticles() {
    if (!this._particleVelocities) return;

    const count = this._particleCount;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Random outward velocity
      const speed = 0.5 + Math.random() * 1.5;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      this._particleVelocities[i3] = speed * Math.sin(phi) * Math.cos(theta);
      this._particleVelocities[i3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
      this._particleVelocities[i3 + 2] = speed * Math.cos(phi) * -0.5; // Slight backward bias
    }
  }

  /**
   * Update particle positions - animate scatter and return to home
   * @private
   */
  _updateParticles(deltaTime) {
    if (!this._particles?.geometry || !this._particlePositions) return;

    const positions = this._particlePositions;
    const velocities = this._particleVelocities;
    const homePositions = this._particleHomePositions;
    const count = this._particleCount;

    // Frame-rate independent damping: 0.96^(dt*60) gives consistent decay
    // At 60fps: dt=0.0167, damping = 0.96^1 = 0.96
    // At 120fps: dt=0.0083, damping = 0.96^0.5 ≈ 0.98
    const effectiveDamping = Math.pow(0.96, deltaTime * 60);
    const returnForce = 0.8;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Apply velocity
      positions[i3] += velocities[i3] * deltaTime;
      positions[i3 + 1] += velocities[i3 + 1] * deltaTime;
      positions[i3 + 2] += velocities[i3 + 2] * deltaTime;

      // Calculate return force toward home position
      const dx = homePositions[i3] - positions[i3];
      const dy = homePositions[i3 + 1] - positions[i3 + 1];
      const dz = homePositions[i3 + 2] - positions[i3 + 2];

      // Add return acceleration
      velocities[i3] += dx * returnForce * deltaTime;
      velocities[i3 + 1] += dy * returnForce * deltaTime;
      velocities[i3 + 2] += dz * returnForce * deltaTime;

      // Apply frame-rate independent damping
      velocities[i3] *= effectiveDamping;
      velocities[i3 + 1] *= effectiveDamping;
      velocities[i3 + 2] *= effectiveDamping;
    }

    // Update buffer
    this._particles.geometry.attributes.position.needsUpdate = true;
  }

  /**
   * Change particle palette (cycles through metallic colors)
   * @private
   */
  _cycleParticlePalette() {
    if (!this._particleColors || !this._particles?.geometry?.attributes?.color) return;

    this._currentParticlePaletteIndex =
      (this._currentParticlePaletteIndex + 1) % this._particlePalettes.length;
    const palette = this._particlePalettes[this._currentParticlePaletteIndex];

    const count = this._particleCount;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const colorHex = palette[Math.floor(Math.random() * palette.length)];
      this._tempColor.set(colorHex);  // Reuse to avoid GC pressure
      this._particleColors[i3] = this._tempColor.r;
      this._particleColors[i3 + 1] = this._tempColor.g;
      this._particleColors[i3 + 2] = this._tempColor.b;
    }

    this._particles.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * Create Glass material
   * @private
   */
  _createGlassMaterial() {
    if (this._materials.glass) return this._materials.glass;

    this._materials.glass = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.05,
      transmission: 0.95,
      thickness: 0.5,
      ior: 1.5,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      transparent: true,
      envMap: this._envMap,
      envMapIntensity: 1.0,
    });

    return this._materials.glass;
  }

  /**
   * Create Metallic material
   * @private
   */
  _createMetallicMaterial() {
    const metalConfig = this._metallicColors[this._currentMetallicIndex];

    // Create or update metallic material
    if (!this._materials.metallic) {
      this._materials.metallic = new THREE.MeshStandardMaterial({
        color: metalConfig.color,
        metalness: 1.0,
        roughness: metalConfig.roughness,
        envMap: this._envMap,
        envMapIntensity: 1.2,
      });
    } else {
      this._materials.metallic.color.setHex(metalConfig.color);
      this._materials.metallic.roughness = metalConfig.roughness;
    }

    return this._materials.metallic;
  }

  /**
   * Switch to the next material mode
   * @private
   */
  _switchMaterial() {
    if (!this._sphere) return;

    // Cycle to next mode: GRADIENT -> GLASS -> METALLIC -> GRADIENT
    const modeCount = Object.keys(MATERIAL_MODE).length;
    this._materialMode = (this._materialMode + 1) % modeCount;

    let newMaterial;
    switch (this._materialMode) {
      case MATERIAL_MODE.GLASS:
        newMaterial = this._createGlassMaterial();
        break;
      case MATERIAL_MODE.METALLIC:
        // Cycle metallic color on each switch to metallic
        this._currentMetallicIndex =
          (this._currentMetallicIndex + 1) % this._metallicColors.length;
        newMaterial = this._createMetallicMaterial();
        break;
      case MATERIAL_MODE.GRADIENT:
      default:
        // Use cached gradient material or create it
        if (!this._materials.gradient) {
          this._materials.gradient = this._createGradientMaterial();
        }
        newMaterial = this._materials.gradient;
        break;
    }

    // Swap the material
    this._sphere.material = newMaterial;
  }

  /**
   * Create the gradient shader material (original style)
   * @private
   */
  _createGradientMaterial() {
    const palette = this._palettes[this._currentPaletteIndex];

    return new THREE.ShaderMaterial({
      uniforms: {
        color0: { value: new THREE.Color(palette[0]) },
        color1: { value: new THREE.Color(palette[1]) },
        color2: { value: new THREE.Color(palette[2]) },
        color3: { value: new THREE.Color(palette[3]) },
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
  }

  /**
   * Update sphere colors based on current palette (gradient mode only)
   * @private
   */
  _updateColors() {
    // Only update colors in gradient mode
    if (this._materialMode !== MATERIAL_MODE.GRADIENT) return;
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

      // Scatter particles and cycle their color palette on beats
      this._scatterParticles();
      this._cycleParticlePalette();
    }

    // === SILENCE DETECTION FOR MATERIAL AUTO-SWITCH ===
    // Uses raw energy (not normalized) for reliable detection with hysteresis
    if (this._isSilent) {
      // Currently in silence - check if we should exit (higher threshold)
      if (rawEnergy > this._silenceExitThreshold) {
        this._isSilent = false;
        this._silenceDuration = 0;
      }
    } else {
      // Not in silence - check if we should enter
      if (rawEnergy < this._silenceThreshold) {
        this._silenceDuration += dt;
        const now = performance.now() / 1000;
        const cooldownElapsed = now - this._lastSwitchTime > this._switchCooldown;
        if (this._silenceDuration > this._silenceSwitchTime && cooldownElapsed) {
          this._isSilent = true;
          this._switchMaterial();
          this._silenceDuration = 0;
          this._lastSwitchTime = now;
        }
      } else {
        this._silenceDuration = 0;
      }
    }

    // === SIZE / SCALE ===
    const maxScale = this._maxSphereScale || 1.8;
    const rawSize = 0.6 + this._smoothedEnergy * 0.8;
    this._size = Math.min(rawSize, maxScale);

    // Scale sphere (early return guarantees _sphere exists)
    this._sphere.scale.setScalar(this._size);

    // Update colors
    this._updateColors();

    // Apply perlin noise deformation for timbre
    this._applyNoiseDeformation();

    // Rotation
    this._sphere.rotation.y += dt * (0.3 + this._smoothedEnergy * 0.5);

    // Update particle positions (scatter animation)
    this._updateParticles(dt);
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
    // Dispose sphere geometry (material disposed separately below)
    if (this._sphere) {
      if (this._sphere.geometry) this._sphere.geometry.dispose();
      this._group?.remove(this._sphere);
      this._sphere = null;
    }

    // Clear envMap references from materials before disposing
    if (this._materials) {
      if (this._materials.glass) {
        this._materials.glass.envMap = null;
      }
      if (this._materials.metallic) {
        this._materials.metallic.envMap = null;
      }

      // Dispose all cached materials
      if (this._materials.gradient) this._materials.gradient.dispose();
      if (this._materials.glass) this._materials.glass.dispose();
      if (this._materials.metallic) this._materials.metallic.dispose();
      this._materials = {};
    }

    // Dispose environment map
    if (this._envMap) {
      this._envMap.dispose();
      this._envMap = null;
    }

    // Dispose particles
    if (this._particles) {
      if (this._particles.geometry) this._particles.geometry.dispose();
      if (this._particles.material) this._particles.material.dispose();
      this.scene.remove(this._particles);
      this._particles = null;
    }

    // Clear particle arrays
    this._particlePositions = null;
    this._particleVelocities = null;
    this._particleHomePositions = null;
    this._particleColors = null;
    this._particlePalettes = null;

    // Clear sphere arrays and helpers
    this._originalPositions = null;
    this._tempColor = null;
    this._metallicColors = null;

    // Reset silence detection state
    this._silenceDuration = 0;
    this._isSilent = false;
    this._lastSwitchTime = 0;

    if (this._group) {
      this.scene.remove(this._group);
      this._group = null;
    }
    this._noise = null;
    this._palettes = null;
  }

  get name() {
    return 'Sphere';
  }

  get description() {
    return 'Pulsing sphere with energy-reactive gradient colors';
  }
}
