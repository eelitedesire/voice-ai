#!/usr/bin/env node

/**
 * Diagnostic script to check sherpa-onnx native addon
 */

import * as fs from 'fs';
import * as path from 'path';

console.log('🔍 Checking sherpa-onnx native addon setup...\n');

const projectRoot = process.cwd();
console.log(`Project root: ${projectRoot}\n`);

// Check if sherpa-onnx-darwin-arm64 exists
const platformPackage = 'sherpa-onnx-darwin-arm64';
const platformPath = path.join(projectRoot, 'node_modules', platformPackage);

console.log(`Checking for ${platformPackage}...`);
if (fs.existsSync(platformPath)) {
  console.log(`✅ Found at: ${platformPath}`);

  // Check for the native addon file
  const addonPath = path.join(platformPath, 'sherpa-onnx.node');
  if (fs.existsSync(addonPath)) {
    const stats = fs.statSync(addonPath);
    console.log(`✅ Native addon exists: ${addonPath}`);
    console.log(`   Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } else {
    console.log(`❌ Native addon NOT found at: ${addonPath}`);
  }

  // List all files in the package
  console.log(`\nFiles in ${platformPackage}:`);
  const files = fs.readdirSync(platformPath);
  files.forEach(file => {
    console.log(`   - ${file}`);
  });
} else {
  console.log(`❌ ${platformPackage} not found`);
}

console.log('\n' + '='.repeat(60));

// Check DYLD_LIBRARY_PATH
console.log('\nDYLD_LIBRARY_PATH:');
const dylibPath = process.env.DYLD_LIBRARY_PATH || '(not set)';
console.log(dylibPath);

console.log('\n' + '='.repeat(60));

// Try to load sherpa-onnx-node
console.log('\nAttempting to load sherpa-onnx-node...');
try {
  const sherpa = require('sherpa-onnx-node');
  console.log('✅ sherpa-onnx-node loaded successfully!');
  console.log(`   Available exports: ${Object.keys(sherpa).join(', ')}`);
} catch (error) {
  console.log('❌ Failed to load sherpa-onnx-node');
  console.log(`   Error: ${error}`);
}
