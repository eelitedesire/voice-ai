#!/usr/bin/env node

/**
 * Voice Enrollment Script
 *
 * This script processes two .wav files (one for therapist, one for client)
 * and generates a speaker_db.json file with voiceprints for speaker identification.
 *
 * Usage:
 *   npm run enroll -- --therapist ./audio/therapist.wav --client ./audio/client.wav
 *
 * Requirements:
 *   - Sherpa-ONNX models must be downloaded to ./models/
 *   - Audio files should be 16kHz mono WAV format
 */

import { SherpaONNXManager } from '../lib/sherpa-onnx';
import * as fs from 'fs';
import * as path from 'path';

interface EnrollmentArgs {
  therapist?: string;
  client?: string;
  output?: string;
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
    }
  }

  return args;
}

async function main() {
  console.log('🎙️  Voice Enrollment System\n');

  const args = parseArgs();

  if (!args.therapist || !args.client) {
    console.error('❌ Error: Both --therapist and --client audio files are required\n');
    console.log('Usage:');
    console.log('  npm run enroll -- --therapist ./audio/therapist.wav --client ./audio/client.wav\n');
    console.log('Options:');
    console.log('  --therapist <path>  Path to therapist audio file (.wav)');
    console.log('  --client <path>     Path to client audio file (.wav)');
    console.log('  --output <path>     Output path for speaker_db.json (default: ./speaker_db.json)');
    process.exit(1);
  }

  // Verify files exist
  if (!fs.existsSync(args.therapist)) {
    console.error(`❌ Therapist audio file not found: ${args.therapist}`);
    process.exit(1);
  }

  if (!fs.existsSync(args.client)) {
    console.error(`❌ Client audio file not found: ${args.client}`);
    process.exit(1);
  }

  const outputPath = args.output || './speaker_db.json';

  console.log('📋 Configuration:');
  console.log(`   Therapist audio: ${args.therapist}`);
  console.log(`   Client audio: ${args.client}`);
  console.log(`   Output database: ${outputPath}\n`);

  try {
    console.log('🔧 Initializing Sherpa-ONNX...');
    const sherpa = new SherpaONNXManager('./models');

    await sherpa.initializeSpeakerEmbedding();
    await sherpa.loadSpeakerDatabase(outputPath);

    console.log('✅ Sherpa-ONNX initialized\n');

    // Enroll therapist
    console.log('🎤 Processing therapist voice...');
    await sherpa.enrollSpeaker('therapist', 'Therapist', args.therapist);
    console.log('✅ Therapist enrolled\n');

    // Enroll client
    console.log('🎤 Processing client voice...');
    await sherpa.enrollSpeaker('client', 'Client', args.client);
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

    sherpa.cleanup();
  } catch (error) {
    console.error('❌ Enrollment failed:', error);
    process.exit(1);
  }
}

main();
