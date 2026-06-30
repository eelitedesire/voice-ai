# Runtime Model Download Setup Guide

## Overview

The mobile app now supports **in-app model downloading** for Hybrid and On-Device processing modes. Models are downloaded at runtime from HuggingFace and GitHub releases.

## What Changed

### New Features ✨

1. **In-App Download UI** - Download models directly from Settings screen
2. **Progress Tracking** - Real-time download progress for each model
3. **Model Management** - Check status, download, and delete models
4. **Storage Display** - Shows total size of downloaded models

### Architecture

```
User taps "Download All Models"
         ↓
ModelDownloadService
         ↓
Downloads individual files from:
  • HuggingFace (ASR models)
  • GitHub Releases (Speaker, VAD)
         ↓
Stores in DocumentDirectory/models/
         ↓
useOnDeviceModels hook detects files
         ↓
On-Device/Hybrid processing enabled ✅
```

## Installation

### 1. Install Dependencies

```bash
cd mobile
npm install
```

This installs the new dependency:
- **react-native-fs** ^2.20.0 - File system access for downloading

### 2. Link Native Modules (iOS)

```bash
cd ios
pod install
cd ..
```

### 3. Permissions (Android)

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
```

## Model Details

### ASR Models (Streaming Zipformer)

- **Source**: HuggingFace `csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26`
- **Files**:
  - `encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx` (~50MB)
  - `decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx` (~2MB)
  - `joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx` (~10MB)
  - `tokens.txt` (~100KB)
- **Total**: ~70MB
- **Quantization**: int8 for mobile efficiency

### Speaker Model (WeSpeaker ResNet34)

- **Source**: GitHub `k2-fsa/sherpa-onnx/releases`
- **File**: `wespeaker_en_voxceleb_resnet34.onnx` (~26MB)
- **Purpose**: Speaker voiceprint extraction

### VAD Model (Silero v5)

- **Source**: GitHub `k2-fsa/sherpa-onnx/releases`
- **File**: `silero_vad.onnx` (~2MB)
- **Purpose**: Voice activity detection

## Usage

### For Users

1. Open the app and go to **Settings**
2. Select **Hybrid** or **On-Device** processing mode
3. Tap **"Download All Models (~100MB)"**
4. Wait for download to complete (WiFi recommended)
5. Models are ready when status shows "Ready" ✅

### For Developers

```typescript
import { getModelDownloadService } from '../services/ModelDownloadService';
import RNFS from 'react-native-fs';

const service = getModelDownloadService(RNFS.DocumentDirectoryPath);

// Download all models
const result = await service.downloadAllModels((model, progress) => {
  console.log(`${model}: ${progress.progress}%`);
});

// Download individual models
await service.downloadASRModels(onProgress);
await service.downloadSpeakerModel(onProgress);
await service.downloadVADModel(onProgress);

// Check models size
const sizeBytes = await service.getModelsSize();

// Delete all models
await service.deleteAllModels();
```

## Troubleshooting

### Download Fails

**Problem**: "Download failed with status 404"
- **Solution**: Check internet connection, try again. Models are hosted on HuggingFace and GitHub.

**Problem**: "No space left on device"
- **Solution**: Free up ~100MB storage space on your device

### Models Not Detected

**Problem**: Downloaded but showing "Missing"
- **Solution**: Restart the app and check again. The `useOnDeviceModels` hook checks on mount.

### Slow Download

**Problem**: Download taking too long
- **Solution**: Use WiFi instead of cellular. Total download is ~100MB.

## File Structure

```
DocumentDirectory/
└── models/
    ├── encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx
    ├── decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx
    ├── joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx
    ├── tokens.txt
    ├── wespeaker_en_voxceleb_resnet34.onnx
    └── silero_vad.onnx
```

## Model URLs

### HuggingFace (ASR)
```
https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx
https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx
https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx
https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/tokens.txt
```

### GitHub Releases
```
https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx
```

## Next Steps

- [ ] Test download on iOS Simulator
- [ ] Test download on Android Emulator
- [ ] Test download on physical devices
- [ ] Verify models work with sherpa-onnx native modules
- [ ] Add download resume capability for interrupted downloads
- [ ] Add WiFi-only download option
- [ ] Add model version checking and updates

## Resources

- [sherpa-onnx Documentation](https://k2-fsa.github.io/sherpa/onnx/)
- [HuggingFace Models](https://huggingface.co/csukuangfj)
- [GitHub Releases](https://github.com/k2-fsa/sherpa-onnx/releases)

Sources:
- [Zipformer Models](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-transducer/zipformer-transducer-models.html)
- [Speaker Recognition Models](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models)
- [WeSpeaker on HuggingFace](https://huggingface.co/Wespeaker/wespeaker-voxceleb-resnet34)
