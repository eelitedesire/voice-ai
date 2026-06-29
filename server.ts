import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { WebSocketServer, WebSocket } from 'ws';
import { VADSegmentedTranscriber, StreamingEvent } from './lib/streaming-transcription';
import { warmUpModels, getSharedModels } from './lib/model-registry';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Start loading the heavy ASR/speaker models the moment the server boots, so
// they're warm before any user clicks "Start Session". Failures here are
// non-fatal — the first connection will retry the load.
warmUpModels().catch((err) => {
  console.error('[Server] Model warm-up failed (will retry on demand):', err);
});

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // WebSocket server for streaming transcription
  const wss = new WebSocketServer({
    server,
    path: '/ws/transcribe',
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WS] Client connected for streaming transcription');

    let transcriber: VADSegmentedTranscriber | null = null;
    let isReady = false;

    // Build the transcriber from the shared, pre-warmed models. Because the
    // heavy models are already loaded, initialize() only mints a cheap
    // per-connection VAD + ASR stream — startup is effectively instant.
    getSharedModels()
      .then((models) => {
        transcriber = new VADSegmentedTranscriber({ models });
        transcriber.on('event', (event: StreamingEvent) => {
          // Don't forward the internal 'ready' event - we send our own after full init
          if (event.type === 'ready') return;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(event));
          }
        });
        return transcriber.initialize();
      })
      .then(() => {
        isReady = true;
        // Send ready signal to client after full initialization
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ready' }));
          console.log('[WS] Transcriber ready, signaled to client');
        }
      })
      .catch((err) => {
        console.error('[WS] Transcriber init failed:', err);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Failed to initialize transcription engine',
          }));
          ws.close();
        }
      });

    ws.on('message', async (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (!isReady || !transcriber) return;

      if (isBinary) {
        // Binary message = PCM audio data (Float32Array)
        // Copy into an aligned ArrayBuffer since the ws Buffer's byteOffset
        // may not be a multiple of 4 (Float32 alignment requirement).
        const buffer = data instanceof Buffer ? data : Buffer.from(data as ArrayBuffer);
        const aligned = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(aligned).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
        const samples = new Float32Array(aligned);
        transcriber.processAudio(samples);
      } else {
        // Text message = control command
        try {
          const msg = JSON.parse(data.toString());

          switch (msg.type) {
            case 'stop':
              transcriber.finalize();
              break;

            case 'config':
              // Config message (e.g., sample rate) - currently fixed at 16kHz
              console.log('[WS] Config:', msg);
              break;

            default:
              console.warn('[WS] Unknown message type:', msg.type);
          }
        } catch {
          console.warn('[WS] Failed to parse text message');
        }
      }
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
      if (transcriber) {
        try {
          transcriber.finalize();
        } catch {
          // ignore finalization errors on disconnect
        }
        transcriber.cleanup();
        transcriber = null;
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] Error:', err);
      if (transcriber) {
        transcriber.cleanup();
        transcriber = null;
      }
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> WebSocket streaming at ws://${hostname}:${port}/ws/transcribe`);
  });
});
