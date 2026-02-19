# Voice AI — React Native Mobile App

Mobile client for the Voice AI couples therapy platform. Prioritizes on-device processing for privacy and performance.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  React Native UI                 │
│  (Screens, Components, Navigation, Hooks)        │
├──────────┬──────────┬───────────────────────────┤
│ On-Device│ Hybrid   │ Server Mode               │
│ Pipeline │ Pipeline │ Pipeline                  │
│          │          │                           │
│ Audio ──►│ Audio ──►│ Audio ──► WebSocket ──►   │
│ VAD   ──►│ VAD   ──►│          Server ASR       │
│ ASR   ──►│ ASR   ──►│                           │
│ Speaker──►│ Speaker──►│                           │
│          │          │                           │
│ (local)  │ Analysis │ (all server-side)         │
│          │ via API  │                           │
└──────────┴──────────┴───────────────────────────┘
         Native Modules (Swift / Kotlin)
    ┌────────────┬──────────┬──────────┐
    │AudioCapture│SherpaOnnx│   VAD    │
    │ AVAudioEng │ C API    │ Silero   │
    │ AudioRecord│ ONNX RT  │ ONNX RT  │
    └────────────┴──────────┴──────────┘
```

## Processing Modes

| Mode | Audio | ASR | Speaker ID | Analysis | Chat |
|------|-------|-----|------------|----------|------|
| **On-Device** | Local | Local | Local | — | — |
| **Hybrid** (default) | Local | Local | Local | Server | Server |
| **Server** | Stream | Server | Server | Server | Server |

## On-Device Models

All speech models run via sherpa-onnx with hardware acceleration:
- **iOS**: CoreML execution provider (Neural Engine on A-series/M-series)
- **Android**: NNAPI delegate (Qualcomm Hexagon DSP, Samsung NPU, MediaTek APU)

| Model | Size | Purpose |
|-------|------|---------|
| Zipformer (encoder+decoder+joiner) | ~70MB | Streaming ASR |
| Silero VAD v5 | ~2MB | Voice activity detection |
| WeSpeaker ResNet34 | ~25MB | Speaker voiceprint extraction |

## Project Structure

```
mobile/
├── src/
│   ├── App.tsx                    # Root component
│   ├── config/api.ts              # Server URLs, audio config, model paths
│   ├── types/index.ts             # TypeScript types (shared with web app)
│   ├── theme/index.ts             # Colors, typography, spacing
│   │
│   ├── native/                    # Native module TypeScript bridges
│   │   ├── AudioCapture.ts        # Microphone capture (16kHz mono Float32)
│   │   ├── SherpaOnnx.ts          # ASR + speaker embedding extraction
│   │   └── VAD.ts                 # Voice activity detection
│   │
│   ├── services/                  # Business logic
│   │   ├── OnDeviceASR.ts         # Full on-device pipeline orchestrator
│   │   ├── StreamingService.ts    # WebSocket streaming to server
│   │   ├── APIService.ts          # REST API client
│   │   ├── StorageService.ts      # MMKV local storage
│   │   └── SpeakerIdentification.ts # Voiceprint matching
│   │
│   ├── hooks/                     # React hooks
│   │   ├── useAudioCapture.ts     # Audio recording state
│   │   ├── useTranscription.ts    # Transcription pipeline manager
│   │   ├── useSession.ts          # Session lifecycle + analysis
│   │   └── useOnDeviceModels.ts   # Model download/status
│   │
│   ├── screens/                   # Full-page views
│   │   ├── HomeScreen.tsx         # Dashboard with quick actions
│   │   ├── SessionScreen.tsx      # Recording + live transcript
│   │   ├── EnrollmentScreen.tsx   # Speaker voice enrollment
│   │   ├── ChatScreen.tsx         # AI therapist chat
│   │   ├── AnalysisScreen.tsx     # Session analysis results
│   │   ├── HistoryScreen.tsx      # Past sessions list
│   │   └── SettingsScreen.tsx     # Processing mode, server, models
│   │
│   ├── components/                # Reusable UI
│   │   ├── RecordButton.tsx       # Animated record/stop button
│   │   ├── AudioWaveform.tsx      # Real-time audio level bars
│   │   ├── TranscriptView.tsx     # Scrollable transcript list
│   │   ├── ChatBubble.tsx         # Chat message bubble
│   │   ├── SpeakerBadge.tsx       # Speaker name pill
│   │   └── ProcessingIndicator.tsx # Mode + connection status
│   │
│   └── navigation/
│       └── AppNavigator.tsx       # Tab + stack navigation
│
├── ios/VoiceAI/NativeModules/     # iOS Swift implementations
│   ├── AudioCaptureModule.swift   # AVAudioEngine input tap
│   ├── SherpaOnnxModule.swift     # sherpa-onnx C API wrapper
│   └── VADModule.swift            # Silero VAD via ORT Mobile
│
├── android/.../modules/           # Android Kotlin implementations
│   ├── AudioCaptureModule.kt      # AudioRecord (ENCODING_PCM_FLOAT)
│   ├── SherpaOnnxModule.kt        # sherpa-onnx JNI wrapper
│   ├── VADModule.kt               # Silero VAD via ORT Mobile
│   └── VoiceAIPackage.kt          # React Native package registry
│
├── package.json
├── tsconfig.json
├── metro.config.js
└── babel.config.js
```

## Setup

```bash
# Install JS dependencies
cd mobile
npm install

# iOS
cd ios && pod install && cd ..
npx react-native run-ios

# Android
npx react-native run-android
```

## Downloading Models

### In-App Download (Recommended)

Models are downloaded at runtime through the Settings screen:

1. **Launch the app** and navigate to the Settings tab
2. **Select processing mode**: Choose "Hybrid" or "On-Device" mode
3. **Tap "Download All Models"** to download:
   - **ASR Models** (Zipformer encoder, decoder, joiner + tokens) - ~70MB
   - **Speaker Model** (WeSpeaker ResNet34) - ~26MB
   - **VAD Model** (Silero VAD) - ~2MB
4. **Wait for download** to complete - Progress bars show individual model status
5. **Models are ready** when all show "Ready" status

Models are downloaded from:
- **HuggingFace**: `csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26` (ASR)
- **GitHub Releases**: `k2-fsa/sherpa-onnx/releases` (Speaker, VAD)

### Model Storage

- **Location**: `{DocumentDirectory}/models/`
- **iOS**: `~/Library/Application Support/.../{AppID}/Documents/models/`
- **Android**: `/data/data/{package}/files/models/`
- **Total Size**: ~100MB after download

### Managing Models

In the Settings screen:
- **Check Status**: Model status indicators show Ready/Missing/Downloading
- **Delete Models**: Free up ~100MB storage space (can re-download anytime)
- **Re-download**: Models are cached - re-downloading is fast if files still exist

## Key Dependencies

- **react-native** 0.77 — Latest with new architecture support
- **react-native-mmkv** — Fast synchronous storage (30x faster than AsyncStorage)
- **react-native-reanimated** — 60fps animations on UI thread
- **@react-navigation** — Native stack + bottom tabs
- **react-native-screens** — Native screen containers

## Server Connection

The mobile app connects to the same voice-ai server. Start the server:

```bash
# From project root
npm run dev
```

Configure the server URL in Settings. Defaults:
- iOS Simulator: `http://localhost:3000`
- Android Emulator: `http://10.0.2.2:3000`
- Physical device: Use your machine's local IP
