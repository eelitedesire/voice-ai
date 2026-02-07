/**
 * AudioWorklet processor that captures raw PCM audio and downsamples to 16kHz.
 * Runs in the audio rendering thread for low-latency capture.
 *
 * Posts Float32Array buffers to the main thread via MessagePort.
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 0;
    // We'll send chunks of ~100ms at 16kHz = 1600 samples
    this._chunkSize = 1600;
  }

  /**
   * Linear interpolation downsampling from source rate to 16kHz.
   * More accurate than nearest-neighbor for non-integer ratios.
   */
  _downsample(input, fromRate, toRate) {
    if (fromRate === toRate) return input;

    const ratio = fromRate / toRate;
    const outputLength = Math.floor(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcFloor = Math.floor(srcIndex);
      const srcCeil = Math.min(srcFloor + 1, input.length - 1);
      const frac = srcIndex - srcFloor;
      output[i] = input[srcFloor] * (1 - frac) + input[srcCeil] * frac;
    }

    return output;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0 || !input[0]) return true;

    const channelData = input[0]; // mono channel

    // Downsample from AudioContext sampleRate to 16kHz
    const downsampled = this._downsample(channelData, sampleRate, 16000);

    // Accumulate samples
    for (let i = 0; i < downsampled.length; i++) {
      this._buffer.push(downsampled[i]);
    }
    this._bufferSize += downsampled.length;

    // Send chunks when we have enough
    while (this._bufferSize >= this._chunkSize) {
      const chunk = new Float32Array(this._chunkSize);
      for (let i = 0; i < this._chunkSize; i++) {
        chunk[i] = this._buffer[i];
      }
      this._buffer = this._buffer.slice(this._chunkSize);
      this._bufferSize -= this._chunkSize;

      this.port.postMessage({ type: 'audio', samples: chunk.buffer }, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
