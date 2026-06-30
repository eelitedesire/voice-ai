import { Platform } from 'react-native';

// Default server URL — Android emulator uses 10.0.2.2 to reach host localhost
const DEFAULT_SERVER_HOST = Platform.select({
  android: '10.0.2.2',
  ios: 'localhost',
  default: 'localhost',
});

export const DEFAULT_SERVER_URL = `http://${DEFAULT_SERVER_HOST}:3000`;
export const DEFAULT_WS_URL = `ws://${DEFAULT_SERVER_HOST}:3000`;

export const API_ENDPOINTS = {
  transcribe: '/api/transcribe',
  analyze: '/api/analyze',
  therapistChat: '/api/therapist-chat',
  enroll: '/api/enroll',
  speakers: '/api/speakers',
  memory: '/api/memory',
  memoryExtract: '/api/memory/extract',
  rag: '/api/rag',
  clinicalKb: '/api/clinical-kb',
} as const;

export const WS_ENDPOINTS = {
  streamingTranscribe: '/ws/transcribe',
} as const;

export const AUDIO_CONFIG = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 32, // Float32
  bufferSize: 4096,
} as const;

// Model file paths (relative to app's document directory)
// Using int8 quantized models for mobile efficiency
export const MODEL_PATHS = {
  asrEncoder: 'models/encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
  asrDecoder: 'models/decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
  asrJoiner: 'models/joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx',
  asrTokens: 'models/tokens.txt',
  vad: 'models/silero_vad.onnx',
  speakerEncoder: 'models/wespeaker_en_voxceleb_resnet34.onnx',
} as const;
