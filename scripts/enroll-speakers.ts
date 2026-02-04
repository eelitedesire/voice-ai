#!/usr/bin/env node

/**
 * Voice Enrollment Script for Couple Therapy
 *
 * This script processes two audio samples (one for each client)
 * and generates a speaker_db.json file with voiceprints for speaker identification.
 *
 * Usage:
 *   Interactive mode (record from microphone):
 *     npm run enroll
 *     npm run enroll -- --record
 *
 *   File mode (use existing .wav files):
 *     npm run enroll -- --client1 ./audio/client1.wav --client2 ./audio/client2.wav
 *
 * Requirements:
 *   - Sherpa-ONNX models must be downloaded to ./models/
 *   - For recording: SoX or FFmpeg must be installed
 *   - Audio format: 16kHz mono WAV
 */

import { SherpaONNXManager, VADManager } from '../lib/sherpa-onnx';
import { AudioRecorder } from '../lib/audio-recorder';
import * as fs from 'fs';
import * as path from 'path';

interface EnrollmentArgs {
  client1?: string;
  client2?: string;
  output?: string;
  record?: boolean;
}

function parseArgs(): EnrollmentArgs {
  const args: EnrollmentArgs = {};
  const cliArgs = process.argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === '--client1' && cliArgs[i + 1]) {
      args.client1 = cliArgs[i + 1];
      i++;
    } else if (cliArgs[i] === '--client2' && cliArgs[i + 1]) {
      args.client2 = cliArgs[i + 1];
      i++;
    } else if (cliArgs[i] === '--output' && cliArgs[i + 1]) {
      args.output = cliArgs[i + 1];
      i++;
    } else if (cliArgs[i] === '--record' || cliArgs[i] === '-r') {
      args.record = true;
    }
  }

  return args;
}

async function main() {
  console.log('🎙️  Voice Enrollment System for Couple Therapy\n');

  const args = parseArgs();
  let client1Path = args.client1;
  let client2Path = args.client2;

  // Determine mode: interactive recording or file-based
  const useRecording = args.record || (!args.client1 && !args.client2);

  if (useRecording) {
    // Interactive recording mode
    console.log('📍 Mode: Interactive Recording\n');

    try {
      const recorder = new AudioRecorder();
      const recordings = await recorder.recordBoth();
      client1Path = recordings.client1;
      client2Path = recordings.client2;
    } catch (error) {
      console.error('❌ Recording failed:', error);
      process.exit(1);
    }
  } else {
    // File-based mode
    console.log('📍 Mode: Using Existing Audio Files\n');

    if (!client1Path || !client2Path) {
      console.error('❌ Error: Both --client1 and --client2 audio files are required\n');
      console.log('Usage:');
      console.log('  Interactive mode (record from microphone):');
      console.log('    npm run enroll');
      console.log('    npm run enroll -- --record\n');
      console.log('  File mode (use existing .wav files):');
      console.log('    npm run enroll -- --client1 ./audio/client1.wav --client2 ./audio/client2.wav\n');
      console.log('Options:');
      console.log('  --client1 <path>    Path to Client 1 audio file (.wav)');
      console.log('  --client2 <path>    Path to Client 2 audio file (.wav)');
      console.log('  --output <path>     Output path for speaker_db.json (default: ./speaker_db.json)');
      console.log('  --record, -r        Record audio interactively');
      process.exit(1);
    }

    // Verify files exist
    if (!fs.existsSync(client1Path)) {
      console.error(`❌ Client 1 audio file not found: ${client1Path}`);
      process.exit(1);
    }

    if (!fs.existsSync(client2Path)) {
      console.error(`❌ Client 2 audio file not found: ${client2Path}`);
      process.exit(1);
    }
  }

  const outputPath = args.output || './speaker_db.json';

  console.log('📋 Configuration:');
  console.log(`   Client 1 audio: ${client1Path}`);
  console.log(`   Client 2 audio: ${client2Path}`);
  console.log(`   Output database: ${outputPath}\n`);

  try {
    console.log('🔧 Initializing Sherpa-ONNX and VAD...');
    const sherpa = new SherpaONNXManager('./models');
    const vad = new VADManager('./models');

    await sherpa.initializeSpeakerEmbedding();
    await vad.initialize();
    await sherpa.loadSpeakerDatabase(outputPath);

    console.log('✅ Sherpa-ONNX and VAD initialized\n');

    // Validate recordings contain speech
    console.log('🔍 Validating audio quality with VAD...');

    const client1HasSpeech = await vad.hasSpeech(client1Path);
    if (!client1HasSpeech) {
      console.error('❌ Client 1 audio does not contain detectable speech!');
      console.error('   Please ensure the recording has clear audio.');
      vad.cleanup();
      sherpa.cleanup();
      process.exit(1);
    }
    console.log('✅ Client 1 audio validated');

    const client2HasSpeech = await vad.hasSpeech(client2Path);
    if (!client2HasSpeech) {
      console.error('❌ Client 2 audio does not contain detectable speech!');
      console.error('   Please ensure the recording has clear audio.');
      vad.cleanup();
      sherpa.cleanup();
      process.exit(1);
    }
    console.log('✅ Client 2 audio validated\n');

    // Enroll client 1
    console.log('🎤 Processing Client 1 voice...');
    await sherpa.enrollSpeaker('client1', 'Client 1', client1Path);
    console.log('✅ Client 1 enrolled\n');

    // Enroll client 2
    console.log('🎤 Processing Client 2 voice...');
    await sherpa.enrollSpeaker('client2', 'Client 2', client2Path);
    console.log('✅ Client 2 enrolled\n');

    // Save database
    console.log('💾 Saving speaker database...');
    await sherpa.saveSpeakerDatabase(outputPath);
    console.log(`✅ Speaker database saved to ${outputPath}\n`);

    console.log('🎉 Enrollment complete!\n');
    console.log('Next steps:');
    console.log('  1. Run the development server: npm run dev');
    console.log('  2. Open http://localhost:3000');
    console.log('  3. Start a therapy session\n');

    vad.cleanup();
    sherpa.cleanup();
  } catch (error) {
    console.error('❌ Enrollment failed:', error);
    process.exit(1);
  }
}

main();
