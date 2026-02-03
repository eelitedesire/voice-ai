export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;

  async initialize(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        }
      });

      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };
    } catch (error) {
      console.error('Failed to initialize audio recorder:', error);
      throw new Error('Microphone access denied or unavailable');
    }
  }

  start(): void {
    if (!this.mediaRecorder) {
      throw new Error('Recorder not initialized');
    }

    this.audioChunks = [];
    this.mediaRecorder.start(100); // Capture in 100ms chunks
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder) {
        reject(new Error('Recorder not initialized'));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        resolve(audioBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  getAudioStream(): MediaStream | null {
    return this.stream;
  }

  cleanup(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }
}

export function convertBlobToWav(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to ArrayBuffer'));
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
