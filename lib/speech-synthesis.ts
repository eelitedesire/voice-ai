export class TextToSpeech {
  private synth: SpeechSynthesis;
  private voices: SpeechSynthesisVoice[] = [];

  constructor() {
    if (typeof window !== 'undefined') {
      this.synth = window.speechSynthesis;
      this.loadVoices();

      // Voices may load async, so listen for the event
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }
    } else {
      throw new Error('TextToSpeech requires browser environment');
    }
  }

  private loadVoices(): void {
    this.voices = this.synth.getVoices();
  }

  speak(text: string, options?: { rate?: number; pitch?: number; volume?: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!text) {
        reject(new Error('No text provided'));
        return;
      }

      // Cancel any ongoing speech
      this.synth.cancel();

      const utterance = new SpeechSynthesisUtterance(text);

      // Set options
      utterance.rate = options?.rate || 1.0;
      utterance.pitch = options?.pitch || 1.0;
      utterance.volume = options?.volume || 1.0;

      // Try to use a good English voice
      const englishVoice = this.voices.find(voice =>
        voice.lang.startsWith('en-') && voice.name.includes('Google')
      ) || this.voices.find(voice => voice.lang.startsWith('en-'));

      if (englishVoice) {
        utterance.voice = englishVoice;
      }

      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(event);

      this.synth.speak(utterance);
    });
  }

  cancel(): void {
    this.synth.cancel();
  }

  isSpeaking(): boolean {
    return this.synth.speaking;
  }
}
