'use strict';

import { PitchDetector } from "pitchy";
import * as Meyda from "meyda";
import FrequencyMap from "note-frequency-map";

/**
 * AudioSource - A flexible audio source for visualization
 * Supports both microphone input and external AnalyserNode (e.g., from a music player)
 */
class AudioSource {
  constructor(options = {}) {
    this.audioContext = null;
    this.analyser = null;
    this.meydaAnalyser = null;
    this.pitchDetector = null;
    this.source = null;
    this.scriptProcessor = null;  // Store for cleanup
    this._pollFrameId = null;     // Store animation frame ID for cleanup
    this.isInitialized = false;
    this.isExternal = false;

    // Configurable pitch detection settings
    this._pitchConfig = {
      clarityThreshold: options.clarityThreshold ?? 0.9,
      minFrequency: options.minFrequency ?? 20,
      maxFrequency: options.maxFrequency ?? 4000,
    };

    // Audio features (updated in real-time)
    this._audioData = {
      energy: 0,
      roughness: 0,      // spectralFlatness
      warmth: 0,         // spectralCentroid (hue)
      richness: 0,       // perceptualSpread (saturation)
      sharpness: 0,      // perceptualSharpness (luminance)
      kurtosis: 0,       // spectralKurtosis
      pitch: null,       // detected note name (C, D, E, etc.)
      octave: null,      // detected octave
      dominantFrequency: 0,  // peak frequency from FFT (Hz)
      dominantBin: 0,        // which FFT bin has the most energy
      bassFrequency: 0,      // hue value (0-360) mapped from peak frequency
      bassEnergy: 0,         // energy of peak (0-1)
      frequencyData: null,
      timeDomainData: null,
    };

    // Smoothing factor for less jittery visualization
    this._smoothingFactor = options.smoothingFactor ?? 0.8;
    this._smoothedValues = {
      energy: 0,
      warmth: 0,
      richness: 0,
      sharpness: 0,
    };
  }

  /**
   * Initialize with microphone input
   * @returns {Promise<void>}
   */
  async initMicrophone() {
    if (this.isInitialized) {
      console.warn('AudioSource already initialized. Call destroy() first to reinitialize.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('getUserMedia not supported in this browser');
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.smoothingTimeConstant = 0; // No smoothing - instant response
      this.analyser.fftSize = 8192; // Higher resolution for bass frequencies

      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);

      // NOTE: ScriptProcessorNode is deprecated but still widely supported.
      // Consider migrating to AudioWorkletNode for better performance in future.
      // See: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode
      this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);
      this.analyser.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.audioContext.destination);

      this.scriptProcessor.onaudioprocess = () => {
        this._updateFrequencyData();
        this._updatePitch();
      };

      // Initialize Meyda analyzer
      this._initMeyda(this.source);

      this.isInitialized = true;
      this.isExternal = false;

    } catch (err) {
      // Clean up partial state on error
      this._cleanupPartialInit();
      throw new Error(`Failed to initialize microphone: ${err.message}`);
    }
  }

  /**
   * Connect to an external AnalyserNode (e.g., from Resonance music player)
   * @param {AnalyserNode} analyserNode - External analyser node
   * @param {AudioContext} audioContext - External audio context
   * @returns {void}
   */
  connectExternalAnalyser(analyserNode, audioContext) {
    if (this.isInitialized) {
      console.warn('AudioSource already initialized. Call destroy() first to reinitialize.');
      return;
    }

    // Validate inputs
    if (!analyserNode || !(analyserNode instanceof AnalyserNode)) {
      throw new Error('analyserNode must be an AnalyserNode instance');
    }
    if (!audioContext || !(audioContext instanceof (window.AudioContext || window.webkitAudioContext))) {
      throw new Error('audioContext must be an AudioContext instance');
    }

    this.audioContext = audioContext;
    this.analyser = analyserNode;
    this.isInitialized = true;
    this.isExternal = true;

    // Initialize pitch detector
    this.pitchDetector = PitchDetector.forFloat32Array(this.analyser.fftSize);

    // For external sources, we need to manually poll for data
    // since we can't inject a script processor into the existing audio graph
    this._startPolling();
  }

  /**
   * Connect to an HTML audio element
   * @param {HTMLAudioElement} audioElement - Audio element to analyze
   * @returns {Promise<void>}
   */
  async connectAudioElement(audioElement) {
    if (this.isInitialized) {
      console.warn('AudioSource already initialized. Call destroy() first to reinitialize.');
      return;
    }

    if (!audioElement || !(audioElement instanceof HTMLAudioElement)) {
      throw new Error('audioElement must be an HTMLAudioElement instance');
    }

    try {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.smoothingTimeConstant = 0; // No smoothing - instant response
      this.analyser.fftSize = 8192; // Higher resolution for bass frequencies

      // This can throw if element already has a source
      this.source = this.audioContext.createMediaElementSource(audioElement);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      // Initialize Meyda analyzer
      this._initMeyda(this.source);

      // Set initialized BEFORE starting polling (poll checks this flag)
      this.isInitialized = true;
      this.isExternal = true;

      // Start polling for data
      this._startPolling();
    } catch (err) {
      // Clean up partial state
      this._cleanupPartialInit();
      throw new Error(`Failed to connect audio element: ${err.message}`);
    }
  }

  /**
   * Clean up partial initialization state on error
   * @private
   */
  _cleanupPartialInit() {
    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  /**
   * Initialize Meyda analyzer for feature extraction
   * @private
   */
  _initMeyda(source) {
    if (this.meydaAnalyser) {
      this.meydaAnalyser.stop();
    }

    this.meydaAnalyser = Meyda.createMeydaAnalyzer({
      audioContext: this.audioContext,
      source: source,
      bufferSize: 512,
      featureExtractors: [
        "energy",
        "perceptualSpread",
        "perceptualSharpness",
        "spectralFlatness",
        "spectralKurtosis",
        "spectralCentroid"
      ],
      callback: (features) => {
        if (features) {
          this._updateFeatures(features);
        }
      }
    });

    this.meydaAnalyser.start();
  }

  /**
   * Start polling for audio data (used for external sources)
   * @private
   */
  _startPolling() {
    const poll = () => {
      if (!this.isInitialized) {
        this._pollFrameId = null;
        return;
      }

      this._updateFrequencyData();
      this._updatePitch();

      // For external sources without Meyda, calculate features from frequency data
      if (this.isExternal && !this.meydaAnalyser) {
        this._calculateFeaturesFromFrequencyData();
      }

      this._pollFrameId = requestAnimationFrame(poll);
    };
    poll();
  }

  /**
   * Update frequency and time domain data
   * @private
   */
  _updateFrequencyData() {
    if (!this.analyser) return;

    const bufferLength = this.analyser.frequencyBinCount;

    if (!this._audioData.frequencyData || this._audioData.frequencyData.length !== bufferLength) {
      this._audioData.frequencyData = new Uint8Array(bufferLength);
      this._audioData.timeDomainData = new Uint8Array(this.analyser.fftSize);
    }

    this.analyser.getByteFrequencyData(this._audioData.frequencyData);
    this.analyser.getByteTimeDomainData(this._audioData.timeDomainData);

    // Find dominant frequency from FFT
    this._updateDominantFrequency();
  }

  /**
   * Find the dominant (peak) frequency from FFT data
   * Also finds dominant bass frequency (20-120Hz) for color mapping
   * @private
   */
  _updateDominantFrequency() {
    if (!this._audioData.frequencyData || !this.audioContext) return;

    const freqData = this._audioData.frequencyData;
    const sampleRate = this.audioContext.sampleRate;
    const binCount = freqData.length;
    const nyquist = sampleRate / 2;
    const binSize = nyquist / binCount;

    // Find loudest frequency in BASS range only (20-120Hz)
    // Map that frequency directly to hue - NO smoothing
    const minBassHz = 20;
    const maxBassHz = 120;
    const minBassBin = Math.floor(minBassHz / binSize);
    const maxBassBin = Math.ceil(maxBassHz / binSize);

    let maxVal = 0;
    let peakBin = minBassBin;

    for (let i = minBassBin; i <= Math.min(maxBassBin, binCount - 1); i++) {
      if (freqData[i] > maxVal) {
        maxVal = freqData[i];
        peakBin = i;
      }
    }

    // Convert bin to frequency
    const peakFreq = peakBin * binSize;

    // Map 20-120Hz to hue 0-360 (linear, simple)
    const normalized = (peakFreq - minBassHz) / (maxBassHz - minBassHz);
    const hue = normalized * 360;

    this._audioData.dominantFrequency = peakFreq;
    this._audioData.dominantBin = peakBin;
    this._audioData.bassFrequency = hue;
    this._audioData.bassEnergy = maxVal / 255;
  }

  /**
   * Update pitch detection
   * @private
   */
  _updatePitch() {
    if (!this.analyser || !this.audioContext) return;

    if (!this.pitchDetector) {
      this.pitchDetector = PitchDetector.forFloat32Array(this.analyser.fftSize);
    }

    const input = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(input);

    try {
      const [pitch, clarity] = this.pitchDetector.findPitch(input, this.audioContext.sampleRate);

      // Only use pitch if clarity is above threshold and within frequency range
      if (clarity > this._pitchConfig.clarityThreshold &&
          pitch > this._pitchConfig.minFrequency &&
          pitch < this._pitchConfig.maxFrequency) {
        const note = FrequencyMap.noteFromFreq(pitch);
        this._audioData.pitch = note.name;
        this._audioData.octave = note.octave;
      } else {
        this._audioData.pitch = null;
        this._audioData.octave = null;
      }
    } catch (e) {
      // Pitch detection can fail on certain inputs - this is expected behavior
      this._audioData.pitch = null;
      this._audioData.octave = null;
    }
  }

  /**
   * Update audio features from Meyda callback
   * @private
   */
  _updateFeatures(features) {
    // Apply smoothing
    this._smoothedValues.energy = this._smooth(this._smoothedValues.energy, features.energy || 0);
    this._smoothedValues.warmth = this._smooth(this._smoothedValues.warmth, features.spectralCentroid || 0);
    this._smoothedValues.richness = this._smooth(this._smoothedValues.richness, features.perceptualSpread || 0);
    this._smoothedValues.sharpness = this._smooth(this._smoothedValues.sharpness, features.perceptualSharpness || 0);

    this._audioData.energy = this._smoothedValues.energy;
    this._audioData.roughness = features.spectralFlatness || 0;
    this._audioData.warmth = this._smoothedValues.warmth;
    this._audioData.richness = this._smoothedValues.richness;
    this._audioData.sharpness = this._smoothedValues.sharpness;
    this._audioData.kurtosis = features.spectralKurtosis || 0;
  }

  /**
   * Calculate audio features from frequency data (fallback when Meyda not available)
   * @private
   */
  _calculateFeaturesFromFrequencyData() {
    if (!this._audioData.frequencyData) return;

    const freqData = this._audioData.frequencyData;
    const len = freqData.length;

    // Calculate energy (RMS of frequency data)
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += freqData[i] * freqData[i];
    }
    const energy = Math.sqrt(sum / len) / 255;

    // Calculate spectral centroid (weighted average frequency)
    let weightedSum = 0;
    let totalWeight = 0;
    for (let i = 0; i < len; i++) {
      weightedSum += i * freqData[i];
      totalWeight += freqData[i];
    }
    const centroid = totalWeight > 0 ? (weightedSum / totalWeight) * (this.audioContext.sampleRate / 2 / len) : 0;

    // Calculate spectral flatness (geometric mean / arithmetic mean)
    let geometricSum = 0;
    let arithmeticSum = 0;
    for (let i = 0; i < len; i++) {
      const val = Math.max(freqData[i], 1); // Avoid log(0)
      geometricSum += Math.log(val);
      arithmeticSum += val;
    }
    const geometricMean = Math.exp(geometricSum / len);
    const arithmeticMean = arithmeticSum / len;
    const flatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

    // Apply smoothing and update
    this._smoothedValues.energy = this._smooth(this._smoothedValues.energy, energy);
    this._smoothedValues.warmth = this._smooth(this._smoothedValues.warmth, Math.min(centroid, 360));

    this._audioData.energy = this._smoothedValues.energy;
    this._audioData.roughness = flatness;
    this._audioData.warmth = this._smoothedValues.warmth;
    this._audioData.richness = Math.min(energy * 2, 1); // Approximation
    this._audioData.sharpness = Math.min(centroid / 1000, 1); // Approximation
  }

  /**
   * Apply smoothing to a value
   * @private
   */
  _smooth(oldValue, newValue) {
    return oldValue * this._smoothingFactor + newValue * (1 - this._smoothingFactor);
  }

  /**
   * Get current audio data
   * @param {boolean} copy - If true, returns a shallow copy (default: false for performance)
   * @returns {Object} Audio data with all features
   */
  getAudioData(copy = false) {
    return copy ? { ...this._audioData } : this._audioData;
  }

  /**
   * Get individual audio features (for backwards compatibility)
   */
  get energy() { return this._audioData.energy; }
  get roughness() { return this._audioData.roughness; }
  get warmth() { return this._audioData.warmth; }
  get richness() { return this._audioData.richness; }
  get sharpness() { return this._audioData.sharpness; }
  get kurtosis() { return this._audioData.kurtosis; }
  get pitch() { return this._audioData.pitch; }
  get octave() { return this._audioData.octave; }
  get dominantFrequency() { return this._audioData.dominantFrequency; }
  get dominantBin() { return this._audioData.dominantBin; }
  get bassFrequency() { return this._audioData.bassFrequency; }
  get bassEnergy() { return this._audioData.bassEnergy; }
  get frequencyData() { return this._audioData.frequencyData; }
  get timeDomainData() { return this._audioData.timeDomainData; }

  /**
   * Set smoothing factor (0-1, higher = smoother but more latency)
   * @param {number} factor
   */
  setSmoothingFactor(factor) {
    this._smoothingFactor = Math.max(0, Math.min(1, factor));
  }

  /**
   * Resume audio context if suspended (required for some browsers)
   */
  async resume() {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  /**
   * Destroy and cleanup
   */
  destroy() {
    // Cancel polling first
    if (this._pollFrameId) {
      cancelAnimationFrame(this._pollFrameId);
      this._pollFrameId = null;
    }

    this.isInitialized = false;

    if (this.meydaAnalyser) {
      this.meydaAnalyser.stop();
      this.meydaAnalyser = null;
    }

    // Clean up script processor
    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.source && !this.isExternal) {
      this.source.disconnect();
    }

    if (this.analyser && !this.isExternal) {
      this.analyser.disconnect();
    }

    if (this.audioContext && !this.isExternal) {
      this.audioContext.close();
    }

    this.source = null;
    this.analyser = null;
    this.audioContext = null;
    this.pitchDetector = null;
  }
}

// ============================================
// Legacy exports for backwards compatibility
// ============================================

let legacyAudioSource = null;
let legacyInitialized = false;
let legacyPollFrameId = null;

// Legacy variables that were exported before
let energy = 0, roughness = 0, warmth = 0, richness = 0, sharpness = 0, kurtosis = 0;
let realpitch = null, realoctave = null;
let audioContext = null, analyser = null;
let dataArray = null, bufferLength = 0;

/**
 * Initialize legacy microphone mode (for backwards compatibility)
 * Call this explicitly if you need the legacy API
 * @returns {Promise<void>}
 */
async function initLegacyMicrophone() {
  if (legacyInitialized) return;

  legacyAudioSource = new AudioSource();
  await legacyAudioSource.initMicrophone();

  audioContext = legacyAudioSource.audioContext;
  analyser = legacyAudioSource.analyser;

  // Update legacy variables in animation loop
  const updateLegacy = () => {
    if (!legacyAudioSource || !legacyAudioSource.isInitialized) {
      legacyPollFrameId = null;
      return;
    }

    const data = legacyAudioSource.getAudioData();
    energy = data.energy;
    roughness = data.roughness;
    warmth = data.warmth;
    richness = data.richness;
    sharpness = data.sharpness;
    kurtosis = data.kurtosis;
    realpitch = data.pitch;
    realoctave = data.octave;
    dataArray = data.frequencyData;
    bufferLength = dataArray ? dataArray.length : 0;

    legacyPollFrameId = requestAnimationFrame(updateLegacy);
  };
  updateLegacy();

  legacyInitialized = true;
}

/**
 * Destroy legacy audio source
 */
function destroyLegacyAudio() {
  if (legacyPollFrameId) {
    cancelAnimationFrame(legacyPollFrameId);
    legacyPollFrameId = null;
  }
  if (legacyAudioSource) {
    legacyAudioSource.destroy();
    legacyAudioSource = null;
  }
  legacyInitialized = false;
  energy = roughness = warmth = richness = sharpness = kurtosis = 0;
  realpitch = realoctave = null;
  audioContext = analyser = null;
  dataArray = null;
  bufferLength = 0;
}

// Legacy pitch detector function
function pitchDetector() {
  // This is now handled internally by AudioSource
  // Kept for backwards compatibility
}

// Export new API
export { AudioSource };

// Export legacy initialization function (no longer auto-initializes)
export { initLegacyMicrophone, destroyLegacyAudio };

// Export legacy API for backwards compatibility
export {
  realpitch,
  realoctave,
  audioContext,
  analyser,
  energy,
  roughness,
  warmth,
  richness,
  sharpness,
  kurtosis,
  bufferLength,
  dataArray,
  pitchDetector
};
