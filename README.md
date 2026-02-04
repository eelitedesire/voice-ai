# AI Co-Therapist Platform 🎙️

A simple web-based platform designed to assist in 2-person therapeutic sessions (Counselor & Patient). The system captures live audio, identifies speakers based on pre-registered voiceprints, generates therapeutic summaries, and provides AI-powered analysis.

## Features

### ✨ Core Capabilities

- **Live Audio Recording**: Browser-based audio capture using Web Audio API
- **Speaker Identification**: Distinguish between Therapist and Client using Sherpa-ONNX voiceprints
- **Real-Time Transcription**: Speech-to-text with automatic speaker labeling
- **AI Analysis**: Clinical supervisor insights powered by Groq LLM
- **Text-to-Speech**: Listen to AI analysis using Web Speech API

## Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js (App Router) | React framework with server components |
| Audio Capture | Web Audio API | Native browser audio recording |
| ASR & Speaker ID | Sherpa-ONNX | Local speech recognition and voiceprint matching |
| AI Orchestration | Vercel AI SDK | Structured LLM interactions |
| LLM Provider | Groq (Llama 3.3) | Fast inference for therapeutic analysis |
| TTS | Web Speech API | Browser-based text-to-speech |

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Groq API key ([Get one here](https://console.groq.com/keys))
- Two audio samples (.wav files, 16kHz mono) for speaker enrollment

### Installation

1. **Clone and install dependencies**

```bash
npm install

# Verify installation (optional but recommended)
npm run verify
```

2. **Download Sherpa-ONNX models**

```bash
npm run download-models
```

This downloads:
- Speech recognition models (Zipformer)
- Speaker embedding model (WeSpeaker ResNet34)

3. **Configure environment variables**

```bash
cp .env.local.template .env.local
```

Edit `.env.local` and add your Groq API key:

```env
GROQ_API_KEY=your_groq_api_key_here
```

4. **Enroll speakers** (Phase A)

You have two options for enrolling speakers:

**Option A: Interactive Recording (Recommended)**

Record audio samples directly from your microphone:

```bash
# Install recording tool (one-time setup)
# macOS:
brew install sox

# Linux:
sudo apt-get install sox

# Run enrollment (library paths are set automatically)
npm run enroll
```

The script will guide you through recording both speakers interactively.

**Option B: Use Existing Audio Files**

If you already have audio files:
- `therapist.wav` - Sample of therapist's voice (16kHz, mono, 5-10 seconds)
- `client.wav` - Sample of client's voice (16kHz, mono, 5-10 seconds)

```bash
npm run enroll -- --therapist ./audio/therapist.wav --client ./audio/client.wav
```

Both options create `speaker_db.json` with voiceprints for speaker identification.

5. **Start the development server**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Phase B: Recording a Session

1. **Start Session**: Click to begin recording audio
2. **Conduct Session**: Have a normal therapeutic conversation
3. **Stop Session**: Click to end recording and process audio

The transcript appears in real-time with automatic speaker labels ([Therapist] or [Client]).

### Phase C: AI Analysis

After stopping the session:

1. Click **"Analyze Session"**
2. The AI generates:
   - Summary of the session
   - Mood assessment
   - Key emotional breakthroughs
   - Homework assignment
   - Any areas of concern

### Phase D: Review

- **Read**: View the structured analysis
- **Listen**: Click "🔊 Listen to Analysis" for text-to-speech playback
- **New Session**: Reset and start fresh

## Project Structure

```
voice-ai/
├── app/
│   ├── api/
│   │   ├── analyze/route.ts       # Groq LLM analysis endpoint
│   │   └── transcribe/route.ts    # Sherpa-ONNX transcription
│   ├── layout.tsx
│   ├── page.tsx                   # Main UI
│   └── globals.css
├── components/
│   ├── SessionRecorder.tsx        # Recording controls
│   ├── TranscriptDisplay.tsx      # Live transcript view
│   └── AnalysisPanel.tsx          # AI analysis display
├── lib/
│   ├── audio-utils.ts             # Web Audio API wrapper
│   ├── sherpa-onnx.ts             # Sherpa-ONNX integration
│   └── speech-synthesis.ts        # TTS utilities
├── scripts/
│   ├── enroll-speakers.ts         # Voice enrollment CLI
│   └── download-models.sh         # Model download script
├── types/
│   └── index.ts                   # TypeScript definitions
├── models/                        # Sherpa-ONNX models (gitignored)
├── speaker_db.json                # Voiceprint database (gitignored)
└── package.json
```

## API Routes

### POST `/api/transcribe`

Processes audio and returns transcript with speaker labels.

**Request**: FormData with audio file
**Response**:
```json
{
  "transcript": [
    {
      "speaker": "Therapist",
      "text": "How are you feeling?",
      "timestamp": 1234567890
    }
  ]
}
```

### POST `/api/analyze`

Analyzes session transcript using Groq LLM.

**Request**:
```json
{
  "transcript": [/* TranscriptEntry[] */]
}
```

**Response**:
```json
{
  "analysis": {
    "summary": "...",
    "mood": "Anxious",
    "keyBreakthroughs": ["..."],
    "homework": "...",
    "concerns": ["..."]
  }
}
```

## Development Notes

### Audio Format Requirements

Sherpa-ONNX requires:
- Sample rate: 16kHz
- Channels: Mono
- Format: WAV or convertible to WAV

The Web Audio API captures in WebM format, which needs conversion for Sherpa-ONNX processing.

### Speaker Identification

The system uses cosine similarity to match voiceprints:
- Threshold: 0.6 (adjustable in `lib/sherpa-onnx.ts`)
- Requires clean audio samples during enrollment
- Performance improves with longer enrollment samples (10-15 seconds)

### LLM Configuration

The clinical supervisor uses Groq's Llama 3.3 70B model:
- Fast inference (~300 tokens/second)
- Structured output with Zod schema
- Optimized for reasoning tasks

To use a different model, edit `app/api/analyze/route.ts`:

```typescript
model: groq('llama-3.3-70b-versatile') // Change model here
```

## Troubleshooting

### Recording Tools Not Found

If you get "No recording tool found" when running `npm run enroll`:

```bash
# macOS:
brew install sox
# or
brew install ffmpeg

# Linux (Ubuntu/Debian):
sudo apt-get install sox
# or
sudo apt-get install ffmpeg

# Linux (Fedora/RHEL):
sudo dnf install sox
# or
sudo dnf install ffmpeg

# Windows:
# Download and install from:
# https://sox.sourceforge.net/
# or https://ffmpeg.org/
```

### Microphone Access Denied

Ensure your browser has permission to access the microphone. HTTPS is required for production deployments.

### Sherpa-ONNX Errors

**"Could not find sherpa-onnx-node" on macOS:**

If you see an error like "Could not find sherpa-onnx-node", the platform-specific native addon isn't installed:

```bash
# For macOS Apple Silicon (M1/M2/M3)
npm install sherpa-onnx-darwin-arm64

# For macOS Intel
npm install sherpa-onnx-darwin-x64

# Verify installation
npm run check-addon
```

Note: `DYLD_LIBRARY_PATH` is set automatically by the npm scripts - you don't need to set it manually.

**Other common issues:**

1. Verify models are downloaded: `ls models/`
2. Check model paths in `lib/sherpa-onnx.ts`
3. Ensure `speaker_db.json` exists (run enrollment)
4. On Linux, you may need to install `sherpa-onnx-linux-x64` or `sherpa-onnx-linux-arm64`

### Groq API Errors

1. Verify API key in `.env.local`
2. Check API key validity at [console.groq.com](https://console.groq.com)
3. Review rate limits and quotas

### TTS Not Working

Web Speech API requires:
- Modern browser (Chrome, Edge, Safari)
- Internet connection (for some voices)
- User interaction to trigger (not on page load)

## Future Enhancements

- [ ] Real-time streaming transcription (WebSocket)
- [ ] Audio format conversion (WebM → WAV)
- [ ] Session history and persistence
- [ ] Multi-session analysis
- [ ] Export transcripts (PDF, DOCX)
- [ ] Advanced speaker diarization
- [ ] Emotion detection from voice tone

## Security Considerations

- Audio data is processed locally (Sherpa-ONNX)
- Transcripts sent to Groq API (cloud processing)
- No persistent storage of sensitive data
- Use HTTPS in production
- Consider HIPAA compliance for medical use

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please read CONTRIBUTING.md for guidelines.

## Support

For issues and questions:
- GitHub Issues: [voice-ai/issues](https://github.com/yourusername/voice-ai/issues)
- Documentation: [voice-ai/wiki](https://github.com/yourusername/voice-ai/wiki)

---

Built with ❤️ using Next.js, Sherpa-ONNX, and Groq
