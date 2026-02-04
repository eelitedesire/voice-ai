#!/usr/bin/env node

/**
 * Setup Verification Script
 *
 * Checks that all dependencies and models are properly installed
 * for the AI Co-Therapist platform.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface CheckResult {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

const results: CheckResult[] = [];

function check(name: string, condition: boolean, passMsg: string, failMsg: string): void {
  results.push({
    name,
    status: condition ? 'pass' : 'fail',
    message: condition ? passMsg : failMsg,
  });
}

function warn(name: string, message: string): void {
  results.push({
    name,
    status: 'warn',
    message,
  });
}

console.log('🔍 Verifying AI Co-Therapist Setup...\n');

// Check Node.js version
const nodeVersion = process.version;
const nodeMajor = parseInt(nodeVersion.split('.')[0].slice(1));
check(
  'Node.js Version',
  nodeMajor >= 18,
  `Node.js ${nodeVersion} (>= 18)`,
  `Node.js ${nodeVersion} - Please upgrade to Node.js 18 or higher`
);

// Check platform
const platform = os.platform();
const arch = os.arch();
console.log(`Platform: ${platform} ${arch}\n`);

// Check for sherpa-onnx-node
const sherpaNodePath = path.join(process.cwd(), 'node_modules', 'sherpa-onnx-node');
check(
  'sherpa-onnx-node',
  fs.existsSync(sherpaNodePath),
  'Installed',
  'Not found - run: npm install'
);

// Check for platform-specific sherpa package
let platformPackage = '';
if (platform === 'darwin' && arch === 'arm64') {
  platformPackage = 'sherpa-onnx-darwin-arm64';
} else if (platform === 'darwin' && arch === 'x64') {
  platformPackage = 'sherpa-onnx-darwin-x64';
} else if (platform === 'linux' && arch === 'x64') {
  platformPackage = 'sherpa-onnx-linux-x64';
} else if (platform === 'linux' && arch === 'arm64') {
  platformPackage = 'sherpa-onnx-linux-arm64';
} else if (platform === 'win32' && arch === 'x64') {
  platformPackage = 'sherpa-onnx-win32-x64';
}

if (platformPackage) {
  const platformPackagePath = path.join(process.cwd(), 'node_modules', platformPackage);
  const nativeAddonPath = path.join(platformPackagePath, 'sherpa-onnx.node');

  check(
    platformPackage,
    fs.existsSync(platformPackagePath),
    'Installed',
    `Not found - run: npm install ${platformPackage}`
  );

  if (fs.existsSync(platformPackagePath)) {
    check(
      'Native Addon',
      fs.existsSync(nativeAddonPath),
      `Found at ${platformPackage}/sherpa-onnx.node`,
      `Native addon missing in ${platformPackage}`
    );
  }
} else {
  warn('Platform Support', `Platform ${platform}-${arch} may not be supported`);
}

// Check DYLD_LIBRARY_PATH on macOS
if (platform === 'darwin') {
  const dylibPath = process.env.DYLD_LIBRARY_PATH || '';
  const expectedPath = path.join(process.cwd(), 'node_modules', platformPackage);

  if (dylibPath.includes(platformPackage) || dylibPath.includes(expectedPath)) {
    check(
      'DYLD_LIBRARY_PATH',
      true,
      'Configured correctly',
      ''
    );
  } else {
    warn(
      'DYLD_LIBRARY_PATH',
      `Not set. Run: export DYLD_LIBRARY_PATH=$(pwd)/node_modules/${platformPackage}:$DYLD_LIBRARY_PATH`
    );
  }
}

// Check for models directory
const modelsPath = path.join(process.cwd(), 'models');
check(
  'Models Directory',
  fs.existsSync(modelsPath),
  'Found',
  'Not found - run: npm run download-models'
);

if (fs.existsSync(modelsPath)) {
  // Check for required model files
  const requiredModels = [
    { name: 'encoder.onnx', minSize: 50 * 1024 * 1024 }, // ~50MB minimum
    { name: 'decoder.onnx', minSize: 1 * 1024 * 1024 },  // ~1MB minimum
    { name: 'joiner.onnx', minSize: 500 * 1024 },        // ~500KB minimum
    { name: 'tokens.txt', minSize: 1000 },               // ~1KB minimum
    { name: 'speaker-embedding.onnx', minSize: 30 * 1024 * 1024 }, // ~30MB minimum
    { name: 'silero_vad.onnx', minSize: 1 * 1024 * 1024 }, // ~1MB minimum (VAD)
  ];

  requiredModels.forEach(model => {
    const modelPath = path.join(modelsPath, model.name);
    const exists = fs.existsSync(modelPath);

    if (exists) {
      const stats = fs.statSync(modelPath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      if (stats.size < model.minSize) {
        check(
          `Model: ${model.name}`,
          false,
          '',
          `Too small (${sizeMB} MB) - likely corrupted. Run: npm run download-models`
        );
      } else {
        check(
          `Model: ${model.name}`,
          true,
          `Found (${sizeMB} MB)`,
          ''
        );
      }
    } else {
      check(
        `Model: ${model.name}`,
        false,
        '',
        'Missing - run: npm run download-models'
      );
    }
  });
}

// Check for .env.local
const envPath = path.join(process.cwd(), '.env.local');
check(
  'Environment File',
  fs.existsSync(envPath),
  'Found',
  'Not found - copy .env.local.template to .env.local'
);

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  check(
    'GROQ_API_KEY',
    envContent.includes('GROQ_API_KEY=') && !envContent.includes('your_groq_api_key_here'),
    'Configured',
    'Not configured in .env.local'
  );
}

// Check for speaker database
const speakerDbPath = path.join(process.cwd(), 'speaker_db.json');
if (fs.existsSync(speakerDbPath)) {
  check(
    'Speaker Database',
    true,
    'Found - speakers enrolled',
    ''
  );
} else {
  warn(
    'Speaker Database',
    'Not found - run enrollment: npm run enroll -- --therapist ./audio/therapist.wav --client ./audio/client.wav'
  );
}

// Print results
console.log('Results:\n');

const passIcon = '✅';
const failIcon = '❌';
const warnIcon = '⚠️ ';

results.forEach(result => {
  const icon = result.status === 'pass' ? passIcon : result.status === 'fail' ? failIcon : warnIcon;
  console.log(`${icon} ${result.name}: ${result.message}`);
});

const failures = results.filter(r => r.status === 'fail').length;
const warnings = results.filter(r => r.status === 'warn').length;

console.log('\n' + '='.repeat(60));
if (failures === 0 && warnings === 0) {
  console.log('✅ All checks passed! Your setup is ready.');
  console.log('\nNext steps:');
  console.log('  1. npm run dev');
  console.log('  2. Open http://localhost:3000');
} else if (failures > 0) {
  console.log(`❌ ${failures} check(s) failed. Please fix the issues above.`);
  process.exit(1);
} else {
  console.log(`⚠️  ${warnings} warning(s). Setup should work, but review warnings above.`);
}
console.log('='.repeat(60) + '\n');
