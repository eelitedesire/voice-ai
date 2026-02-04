import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { spawn } from 'child_process';

interface RecordingOptions {
  duration: number; // seconds
  sampleRate: number;
  channels: number;
}

export class AudioRecorder {
  private readonly defaultOptions: RecordingOptions = {
    duration: 10,
    sampleRate: 16000,
    channels: 1,
  };

  /**
   * Check if SoX (rec command) is available
   */
  async checkSoxAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['rec']);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Prompt user for input
   */
  private async prompt(question: string): Promise<string> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  /**
   * Wait for user to press Enter
   */
  private async waitForEnter(message: string): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.question(message, () => {
        rl.close();
        resolve();
      });
    });
  }

  /**
   * Record audio using SoX
   */
  private async recordWithSox(
    outputPath: string,
    duration: number,
    sampleRate: number,
    channels: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = [
        '-d', // default audio device
        '-r', sampleRate.toString(),
        '-c', channels.toString(),
        '-b', '16', // 16-bit
        outputPath,
        'trim', '0', duration.toString(),
      ];

      console.log(`Recording for ${duration} seconds...`);

      let recordingStarted = false;
      const proc = spawn('rec', args);

      proc.stderr.on('data', (data) => {
        const output = data.toString();
        if (output.includes('Recording') && !recordingStarted) {
          recordingStarted = true;
          console.log('🔴 Recording started! Speak now...');
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Recording complete!');
          resolve();
        } else {
          reject(new Error(`Recording failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start recording: ${err.message}`));
      });
    });
  }

  /**
   * Record audio using FFmpeg (alternative if Sox not available)
   */
  private async recordWithFFmpeg(
    outputPath: string,
    duration: number,
    sampleRate: number,
    channels: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Determine the input format based on platform
      const platform = process.platform;
      let inputFormat = 'avfoundation'; // macOS
      let inputDevice = ':0'; // default audio input

      if (platform === 'linux') {
        inputFormat = 'alsa';
        inputDevice = 'default';
      } else if (platform === 'win32') {
        inputFormat = 'dshow';
        inputDevice = 'audio="Microphone"';
      }

      const args = [
        '-f', inputFormat,
        '-i', inputDevice,
        '-t', duration.toString(),
        '-ar', sampleRate.toString(),
        '-ac', channels.toString(),
        '-y', // overwrite output file
        outputPath,
      ];

      console.log(`Recording for ${duration} seconds...`);
      console.log('🔴 Recording started! Speak now...');

      const proc = spawn('ffmpeg', args);

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Recording complete!');
          resolve();
        } else {
          reject(new Error(`Recording failed with code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to start recording: ${err.message}`));
      });
    });
  }

  /**
   * Check if FFmpeg is available
   */
  async checkFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', ['ffmpeg']);
      proc.on('close', (code) => {
        resolve(code === 0);
      });
      proc.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Interactively record audio
   */
  async recordInteractive(
    role: 'client1' | 'client2',
    outputDir: string = './audio'
  ): Promise<string> {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputPath = path.join(outputDir, `${role}.wav`);
    const displayName = role === 'client1' ? 'CLIENT 1' : 'CLIENT 2';

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎙️  Recording ${displayName} voice sample`);
    console.log(`${'='.repeat(60)}\n`);

    // Get recording duration
    const durationInput = await this.prompt(
      'Recording duration in seconds (default: 10): '
    );
    const duration = durationInput
      ? parseInt(durationInput, 10)
      : this.defaultOptions.duration;

    if (isNaN(duration) || duration <= 0) {
      throw new Error('Invalid duration');
    }

    console.log(`\nRecording will be ${duration} seconds.`);
    console.log('Tips for best results:');
    console.log('  • Find a quiet location');
    console.log('  • Speak naturally at normal volume');
    console.log('  • Position microphone 6-12 inches away');
    console.log('  • Speak continuously for the full duration\n');

    // Display sample text to read
    console.log('📝 Please read the following text during recording:\n');
    console.log('━'.repeat(60));
    console.log('Hello, my name is ' + (role === 'client1' ? 'Sarah' : 'John') + '.');
    console.log('I\'m here today because my partner and I have been experiencing');
    console.log('some challenges in our relationship. We want to work together');
    console.log('to improve our communication and understanding of each other.');
    console.log('I believe that with the right support and guidance, we can');
    console.log('build a stronger, healthier relationship together.');
    console.log('━'.repeat(60));
    console.log('');

    await this.waitForEnter('Press ENTER when ready to start recording...');

    // Check for available recording tools
    const hasSox = await this.checkSoxAvailable();
    const hasFFmpeg = await this.checkFFmpegAvailable();

    if (!hasSox && !hasFFmpeg) {
      throw new Error(
        'No recording tool found. Please install SoX (rec) or FFmpeg:\n' +
        '  macOS:  brew install sox\n' +
        '          brew install ffmpeg\n' +
        '  Linux:  sudo apt-get install sox\n' +
        '          sudo apt-get install ffmpeg\n' +
        '  Windows: Download from https://sox.sourceforge.net/ or https://ffmpeg.org/'
      );
    }

    try {
      // Prefer SoX over FFmpeg
      if (hasSox) {
        await this.recordWithSox(
          outputPath,
          duration,
          this.defaultOptions.sampleRate,
          this.defaultOptions.channels
        );
      } else {
        await this.recordWithFFmpeg(
          outputPath,
          duration,
          this.defaultOptions.sampleRate,
          this.defaultOptions.channels
        );
      }

      // Verify file was created
      if (!fs.existsSync(outputPath)) {
        throw new Error('Recording file was not created');
      }

      const stats = fs.statSync(outputPath);
      console.log(`📁 Saved to: ${outputPath} (${(stats.size / 1024).toFixed(2)} KB)\n`);

      // Ask if user wants to re-record
      const reRecord = await this.prompt('Re-record? (y/N): ');
      if (reRecord.toLowerCase() === 'y' || reRecord.toLowerCase() === 'yes') {
        return this.recordInteractive(role, outputDir);
      }

      return outputPath;
    } catch (error) {
      console.error(`❌ Recording failed: ${error}`);
      throw error;
    }
  }

  /**
   * Record both clients for couple therapy
   */
  async recordBoth(): Promise<{ client1: string; client2: string }> {
    console.log('\n🎤 Interactive Voice Enrollment for Couple Therapy\n');
    console.log('You will record two voice samples:');
    console.log('  1. Client 1 voice');
    console.log('  2. Client 2 voice\n');

    const client1Path = await this.recordInteractive('client1');
    const client2Path = await this.recordInteractive('client2');

    return {
      client1: client1Path,
      client2: client2Path,
    };
  }
}
