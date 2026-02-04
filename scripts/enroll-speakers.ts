#!/usr/bin/env node

/**
 * Voice Enrollment Script
 *
 * This script processes two audio samples (one for therapist, one for client)
 * and generates a speaker_db.json file with voiceprints for speaker identification.
 *
 * Usage:
 *   Interactive mode (record from microphone):
 *     npm run enroll
 *     npm run enroll -- --record
 *
 *   File mode (use existing .wav files):
 *     npm run enroll -- --therapist ./audio/therapist.wav --client ./audio/client.wav
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
  therapist?: string;
  client?: string;
  output?: string;
  record?: boolean;
}

function parseArgs(): EnrollmentArgs {
  const args: EnrollmentArgs = {};
  const cliArgs = process.argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === '--therapist' && cliArgs[i + 1]) {
      args.therapist = cliArgs[i + 1];
      i++;
    } else if (cliArgs[i] === '--client' && cliArgs[i + 1]) {
      args.client = cliArgs[i + 1];
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
  console.log('🎙️  Voice Enrollment System\n');

  const args = parseArgs();
  let therapistPath = args.therapist;
  let clientPath = args.client;

  // Determine mode: interactive recording or file-based
  const useRecording = args.record || (!args.therapist && !args.client);

  if (useRecording) {
    // Interactive recording mode
    console.log('📍 Mode: Interactive Recording\n');

    try {
      const recorder = new AudioRecorder();
      const recordings = await recorder.recordBoth();
      therapistPath = recordings.therapist;
      clientPath = recordings.client;
    } catch (error) {
      console.error('❌ Recording failed:', error);
      process.exit(1);
    }
  } else {
    // File-based mode
    console.log('📍 Mode: Using Existing Audio Files\n');

    if (!therapistPath || !clientPath) {
      console.error('❌ Error: Both --therapist and --client audio files are required\n');
      console.log('Usage:');
      console.log('  Interactive mode (record from microphone):');
      console.log('    npm run enroll');
      console.log('    npm run enroll -- --record\n');
      console.log('  File mode (use existing .wav files):');
      console.log('    npm run enroll -- --therapist ./audio/therapist.wav --client ./audio/client.wav\n');
      console.log('Options:');
      console.log('  --therapist <path>  Path to therapist audio file (.wav)');
      console.log('  --client <path>     Path to client audio file (.wav)');
      console.log('  --output <path>     Output path for speaker_db.json (default: ./speaker_db.json)');
      console.log('  --record, -r        Record audio interactively');
      process.exit(1);
    }

    // Verify files exist
    if (!fs.existsSync(therapistPath)) {
      console.error(`❌ Therapist audio file not found: ${therapistPath}`);
      process.exit(1);
    }

    if (!fs.existsSync(clientPath)) {
      console.error(`❌ Client audio file not found: ${clientPath}`);
      process.exit(1);
    }
  }

  const outputPath = args.output || './speaker_db.json';

  console.log('📋 Configuration:');
  console.log(`   Therapist audio: ${therapistPath}`);
  console.log(`   Client audio: ${clientPath}`);
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

    const therapistHasSpeech = await vad.hasSpeech(therapistPath);
    if (!therapistHasSpeech) {
      console.error('❌ Therapist audio does not contain detectable speech!');
      console.error('   Please ensure the recording has clear audio.');
      vad.cleanup();
      sherpa.cleanup();
      process.exit(1);
    }
    console.log('✅ Therapist audio validated');

    const clientHasSpeech = await vad.hasSpeech(clientPath);
    if (!clientHasSpeech) {
      console.error('❌ Client audio does not contain detectable speech!');
      console.error('   Please ensure the recording has clear audio.');
      vad.cleanup();
      sherpa.cleanup();
      process.exit(1);
    }
    console.log('✅ Client audio validated\n');

    // Enroll therapist
    console.log('🎤 Processing therapist voice...');
    await sherpa.enrollSpeaker('therapist', 'Therapist', therapistPath);
    console.log('✅ Therapist enrolled\n');

    // Enroll client
    console.log('🎤 Processing client voice...');
    await sherpa.enrollSpeaker('client', 'Client', clientPath);
    console.log('✅ Client enrolled\n');

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
