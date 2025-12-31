/**
 * Musicolors Visualizer Module
 *
 * Provides a unified API for audio-reactive visualizations.
 * Supports multiple preset visualizers and external audio sources.
 *
 * @example
 * // Basic usage with microphone
 * const visualizer = new Visualizer(container, { preset: 'bars' });
 * await visualizer.initWithMicrophone();
 * visualizer.start();
 *
 * @example
 * // Usage with external audio (e.g., from a music player)
 * const visualizer = new Visualizer(container, { preset: 'topographic' });
 * visualizer.initWithAnalyser(audioEngine.getAnalyser(), audioEngine.getAudioContext());
 * visualizer.start();
 *
 * @example
 * // Usage with HTML audio element
 * const audioEl = document.getElementById('audio');
 * const visualizer = new Visualizer(container, { preset: 'circular' });
 * await visualizer.initWithAudioElement(audioEl);
 * visualizer.start();
 */

import { AudioSource } from '../audio.js';
import { BaseVisualizer } from './BaseVisualizer.js';
import { MinimalVisualizer } from './MinimalVisualizer.js';
import { BarsVisualizer } from './BarsVisualizer.js';
import { WaveformVisualizer } from './WaveformVisualizer.js';
import { CircularVisualizer } from './CircularVisualizer.js';
import { TopographicVisualizer } from './TopographicVisualizer.js';
import { ParticlesVisualizer } from './ParticlesVisualizer.js';
import { SphereVisualizer } from './SphereVisualizer.js';

/**
 * Available visualizer presets
 */
export const PRESETS = {
  sphere: SphereVisualizer,
  minimal: MinimalVisualizer,
  bars: BarsVisualizer,
  waveform: WaveformVisualizer,
  circular: CircularVisualizer,
  topographic: TopographicVisualizer,
  particles: ParticlesVisualizer,
};

/**
 * Preset information for UI display
 */
export const PRESET_INFO = {
  sphere: {
    name: 'Sphere',
    description: 'Pulsing sphere with energy-reactive gradient colors',
    icon: 'sphere',
  },
  minimal: {
    name: 'Minimal',
    description: 'Subtle ambient glow that pulses with the music',
    icon: 'glow',
  },
  bars: {
    name: 'Bars',
    description: 'Classic frequency spectrum with vertical bars',
    icon: 'bar-chart',
  },
  waveform: {
    name: 'Waveform',
    description: 'Oscilloscope-style waveform display',
    icon: 'wave',
  },
  circular: {
    name: 'Circular',
    description: 'Radial frequency bars arranged in a circle',
    icon: 'circle',
  },
  topographic: {
    name: 'Topographic',
    description: 'Audio-reactive contour lines with wave animation',
    icon: 'layers',
  },
  particles: {
    name: 'Particles',
    description: 'Dynamic particle system reacting to audio',
    icon: 'sparkles',
  },
};

/**
 * Main Visualizer class - the primary API for consumers
 */
export class Visualizer {
  /**
   * Create a new Visualizer instance
   *
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {string} [options.preset='bars'] - Visualizer preset name
   * @param {Object} [options.presetOptions={}] - Options passed to the preset visualizer
   */
  constructor(container, options = {}) {
    if (!container) {
      throw new Error('Container element is required');
    }

    this.container = container;
    this.preset = options.preset || 'bars';
    this.presetOptions = options.presetOptions || {};

    // Create audio source
    this.audioSource = new AudioSource(options.audioOptions);

    // Visualizer instance (created when initialized)
    this._visualizer = null;
    this._isInitialized = false;
  }

  /**
   * Initialize with microphone input
   * @returns {Promise<void>}
   */
  async initWithMicrophone() {
    await this.audioSource.initMicrophone();
    this._createVisualizer();
    this._isInitialized = true;
  }

  /**
   * Initialize with an external AnalyserNode
   * Use this for integration with existing audio systems (e.g., music players)
   *
   * @param {AnalyserNode} analyserNode - Web Audio API AnalyserNode
   * @param {AudioContext} audioContext - Web Audio API AudioContext
   */
  initWithAnalyser(analyserNode, audioContext) {
    this.audioSource.connectExternalAnalyser(analyserNode, audioContext);
    this._createVisualizer();
    this._isInitialized = true;
  }

  /**
   * Initialize with an HTML audio element
   *
   * @param {HTMLAudioElement} audioElement - HTML audio element
   * @returns {Promise<void>}
   */
  async initWithAudioElement(audioElement) {
    await this.audioSource.connectAudioElement(audioElement);
    this._createVisualizer();
    this._isInitialized = true;
  }

  /**
   * Create the visualizer instance
   * @private
   */
  _createVisualizer() {
    // Destroy existing visualizer if any
    if (this._visualizer) {
      this._visualizer.destroy();
      this._visualizer = null;
    }

    // Get preset class
    const PresetClass = PRESETS[this.preset];
    if (!PresetClass) {
      throw new Error(`Unknown preset: ${this.preset}. Available: ${Object.keys(PRESETS).join(', ')}`);
    }

    // Create visualizer
    this._visualizer = new PresetClass(this.container, this.presetOptions);

    // Connect audio source
    this._visualizer.connectAudioSource(this.audioSource);
  }

  /**
   * Change the visualizer preset
   *
   * @param {string} presetName - Name of the preset to switch to
   * @param {Object} [presetOptions] - New options for the preset
   */
  setPreset(presetName, presetOptions) {
    if (!PRESETS[presetName]) {
      throw new Error(`Unknown preset: ${presetName}. Available: ${Object.keys(PRESETS).join(', ')}`);
    }

    const wasRunning = this._visualizer?.isRunning;

    this.preset = presetName;
    if (presetOptions) {
      this.presetOptions = presetOptions;
    }

    if (this._isInitialized) {
      this._createVisualizer();

      // Resume if was running
      if (wasRunning) {
        this._visualizer.start();
      }
    }
  }

  /**
   * Get list of available preset names
   * @returns {string[]}
   */
  getAvailablePresets() {
    return Object.keys(PRESETS);
  }

  /**
   * Get information about all presets
   * @returns {Object}
   */
  getPresetInfo() {
    return PRESET_INFO;
  }

  /**
   * Start the visualization
   */
  start() {
    if (!this._isInitialized) {
      throw new Error('Visualizer not initialized. Call initWithMicrophone(), initWithAnalyser(), or initWithAudioElement() first.');
    }
    this._visualizer?.start();
  }

  /**
   * Stop the visualization
   */
  stop() {
    this._visualizer?.stop();
  }

  /**
   * Check if the visualizer is running
   * @returns {boolean}
   */
  get isRunning() {
    return this._visualizer?.isRunning || false;
  }

  /**
   * Get the current preset name
   * @returns {string}
   */
  get currentPreset() {
    return this.preset;
  }

  /**
   * Get the current visualizer instance
   * @returns {BaseVisualizer|null}
   */
  get visualizer() {
    return this._visualizer;
  }

  /**
   * Get current audio data (useful for custom visualizations)
   * @returns {Object}
   */
  getAudioData() {
    return this.audioSource.getAudioData();
  }

  /**
   * Resize the visualizer
   * @param {number} width - New width
   * @param {number} height - New height
   */
  resize(width, height) {
    this._visualizer?.resize(width, height);
  }

  /**
   * Cleanup and destroy the visualizer
   */
  destroy() {
    if (this._visualizer) {
      this._visualizer.destroy();
      this._visualizer = null;
    }

    if (this.audioSource) {
      this.audioSource.destroy();
      this.audioSource = null;
    }

    this._isInitialized = false;
    this.container = null;
  }
}

// Export individual visualizers for direct use
export {
  AudioSource,
  BaseVisualizer,
  SphereVisualizer,
  MinimalVisualizer,
  BarsVisualizer,
  WaveformVisualizer,
  CircularVisualizer,
  TopographicVisualizer,
  ParticlesVisualizer,
};

// Default export
export default Visualizer;
