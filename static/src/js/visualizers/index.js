/**
 * Musicolors Visualizer Module
 *
 * Provides a unified API for audio-reactive sphere visualization.
 * Features multiple material modes and background particle effects.
 *
 * @example
 * // Basic usage with microphone
 * const visualizer = new Visualizer(container);
 * await visualizer.initWithMicrophone();
 * visualizer.start();
 *
 * @example
 * // Usage with external audio (e.g., from a music player)
 * const visualizer = new Visualizer(container);
 * visualizer.initWithAnalyser(audioEngine.getAnalyser(), audioEngine.getAudioContext());
 * visualizer.start();
 *
 * @example
 * // Usage with HTML audio element
 * const audioEl = document.getElementById('audio');
 * const visualizer = new Visualizer(container);
 * await visualizer.initWithAudioElement(audioEl);
 * visualizer.start();
 */

import { AudioSource } from '../audio.js';
import { BaseVisualizer } from './BaseVisualizer.js';
import { SphereVisualizer } from './SphereVisualizer.js';

/**
 * Main Visualizer class - the primary API for consumers
 */
export class Visualizer {
  /**
   * Create a new Visualizer instance
   *
   * @param {HTMLElement} container - DOM element to render into
   * @param {Object} options - Configuration options
   * @param {Object} [options.visualizerOptions={}] - Options passed to the SphereVisualizer
   */
  constructor(container, options = {}) {
    if (!container) {
      throw new Error('Container element is required');
    }

    this.container = container;
    this.visualizerOptions = options.visualizerOptions || {};

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

    // Create sphere visualizer
    this._visualizer = new SphereVisualizer(this.container, this.visualizerOptions);

    // Connect audio source
    this._visualizer.connectAudioSource(this.audioSource);
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
   * Get the current visualizer instance
   * @returns {SphereVisualizer|null}
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

// Export classes for direct use
export {
  AudioSource,
  BaseVisualizer,
  SphereVisualizer,
};

// Default export
export default Visualizer;
