/**
 * ModelDownloadService — Downloads ML models to device with progress tracking.
 *
 * Downloads models from sherpa-onnx GitHub releases to the device's document directory.
 * Supports progress callbacks and automatic extraction of tar.bz2 archives.
 */

import RNFS from 'react-native-fs';
import { MODEL_PATHS } from '../config/api';

export interface DownloadProgress {
  totalBytes: number;
  downloadedBytes: number;
  progress: number; // 0-100
}

export interface ModelDownloadResult {
  success: boolean;
  error?: string;
  path?: string;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

// Model URLs — Using HuggingFace for direct file downloads (no tar extraction needed)
const HF_REPO = 'csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26';
const HF_BASE_URL = `https://huggingface.co/${HF_REPO}/resolve/main`;

const MODEL_URLS = {
  // ASR models (int8 quantized for mobile efficiency)
  asrEncoder: `${HF_BASE_URL}/encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx`,
  asrDecoder: `${HF_BASE_URL}/decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx`,
  asrJoiner: `${HF_BASE_URL}/joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx`,
  asrTokens: `${HF_BASE_URL}/tokens.txt`,

  // Speaker identification model (WeSpeaker ResNet34)
  speaker: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx',

  // VAD model (Silero)
  vad: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
} as const;

export class ModelDownloadService {
  private documentDir: string;
  private modelsDir: string;

  constructor(documentDir: string) {
    this.documentDir = documentDir;
    this.modelsDir = `${documentDir}/models`;
  }

  /**
   * Download ASR models (encoder, decoder, joiner, tokens)
   */
  async downloadASRModels(onProgress?: ProgressCallback): Promise<ModelDownloadResult> {
    try {
      await this.ensureModelsDirectory();

      // Check if already downloaded
      const allExist = await this.checkASRModelsExist();
      if (allExist) {
        return { success: true, path: this.modelsDir };
      }

      // Download each file individually (4 files total)
      const files = [
        { url: MODEL_URLS.asrEncoder, path: MODEL_PATHS.asrEncoder, name: 'encoder' },
        { url: MODEL_URLS.asrDecoder, path: MODEL_PATHS.asrDecoder, name: 'decoder' },
        { url: MODEL_URLS.asrJoiner, path: MODEL_PATHS.asrJoiner, name: 'joiner' },
        { url: MODEL_URLS.asrTokens, path: MODEL_PATHS.asrTokens, name: 'tokens' },
      ];

      let totalDownloaded = 0;
      let totalSize = 0;

      // Download each file sequentially with combined progress
      for (const file of files) {
        const targetPath = `${this.modelsDir}/${file.path}`;

        // Skip if already exists
        const exists = await RNFS.exists(targetPath);
        if (exists) continue;

        console.log(`[ModelDownload] Downloading ${file.name}...`);

        const downloadResult = await RNFS.downloadFile({
          fromUrl: file.url,
          toFile: targetPath,
          progressInterval: 500,
          progressDivider: 1,
          begin: (res) => {
            totalSize += res.contentLength;
          },
          progress: (res) => {
            if (onProgress) {
              const fileProgress = res.bytesWritten;
              onProgress({
                totalBytes: totalSize,
                downloadedBytes: totalDownloaded + fileProgress,
                progress: ((totalDownloaded + fileProgress) / totalSize) * 100,
              });
            }
          },
        }).promise;

        if (downloadResult.statusCode !== 200) {
          throw new Error(`${file.name} download failed with status ${downloadResult.statusCode}`);
        }

        totalDownloaded += downloadResult.bytesWritten;
      }

      return { success: true, path: this.modelsDir };
    } catch (error) {
      console.error('[ModelDownload] ASR models download failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download speaker identification model
   */
  async downloadSpeakerModel(onProgress?: ProgressCallback): Promise<ModelDownloadResult> {
    try {
      await this.ensureModelsDirectory();

      const targetPath = `${this.modelsDir}/${MODEL_PATHS.speakerEncoder}`;

      // Check if already exists
      const exists = await RNFS.exists(targetPath);
      if (exists) {
        return { success: true, path: targetPath };
      }

      // Download directly (single .onnx file)
      const downloadResult = await RNFS.downloadFile({
        fromUrl: MODEL_URLS.speaker,
        toFile: targetPath,
        progressInterval: 500,
        progressDivider: 1,
        begin: (res) => {
          console.log('[ModelDownload] Speaker model download started:', res.contentLength);
        },
        progress: (res) => {
          if (onProgress) {
            onProgress({
              totalBytes: res.contentLength,
              downloadedBytes: res.bytesWritten,
              progress: (res.bytesWritten / res.contentLength) * 100,
            });
          }
        },
      }).promise;

      if (downloadResult.statusCode !== 200) {
        throw new Error(`Download failed with status ${downloadResult.statusCode}`);
      }

      return { success: true, path: targetPath };
    } catch (error) {
      console.error('[ModelDownload] Speaker model download failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download VAD model
   */
  async downloadVADModel(onProgress?: ProgressCallback): Promise<ModelDownloadResult> {
    try {
      await this.ensureModelsDirectory();

      const targetPath = `${this.modelsDir}/${MODEL_PATHS.vad}`;

      // Check if already exists
      const exists = await RNFS.exists(targetPath);
      if (exists) {
        return { success: true, path: targetPath };
      }

      // Download directly (single .onnx file)
      const downloadResult = await RNFS.downloadFile({
        fromUrl: MODEL_URLS.vad,
        toFile: targetPath,
        progressInterval: 500,
        progressDivider: 1,
        begin: (res) => {
          console.log('[ModelDownload] VAD model download started:', res.contentLength);
        },
        progress: (res) => {
          if (onProgress) {
            onProgress({
              totalBytes: res.contentLength,
              downloadedBytes: res.bytesWritten,
              progress: (res.bytesWritten / res.contentLength) * 100,
            });
          }
        },
      }).promise;

      if (downloadResult.statusCode !== 200) {
        throw new Error(`Download failed with status ${downloadResult.statusCode}`);
      }

      return { success: true, path: targetPath };
    } catch (error) {
      console.error('[ModelDownload] VAD model download failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Download all models sequentially
   */
  async downloadAllModels(
    onProgress?: (model: 'asr' | 'speaker' | 'vad', progress: DownloadProgress) => void,
  ): Promise<{ asr: boolean; speaker: boolean; vad: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Download ASR models
    const asrResult = await this.downloadASRModels(
      onProgress ? (p) => onProgress('asr', p) : undefined,
    );
    if (!asrResult.success && asrResult.error) {
      errors.push(`ASR: ${asrResult.error}`);
    }

    // Download speaker model
    const speakerResult = await this.downloadSpeakerModel(
      onProgress ? (p) => onProgress('speaker', p) : undefined,
    );
    if (!speakerResult.success && speakerResult.error) {
      errors.push(`Speaker: ${speakerResult.error}`);
    }

    // Download VAD model
    const vadResult = await this.downloadVADModel(
      onProgress ? (p) => onProgress('vad', p) : undefined,
    );
    if (!vadResult.success && vadResult.error) {
      errors.push(`VAD: ${vadResult.error}`);
    }

    return {
      asr: asrResult.success,
      speaker: speakerResult.success,
      vad: vadResult.success,
      errors,
    };
  }

  /**
   * Delete all downloaded models
   */
  async deleteAllModels(): Promise<void> {
    const exists = await RNFS.exists(this.modelsDir);
    if (exists) {
      await RNFS.unlink(this.modelsDir);
    }
  }

  /**
   * Get total size of downloaded models
   */
  async getModelsSize(): Promise<number> {
    const exists = await RNFS.exists(this.modelsDir);
    if (!exists) return 0;

    const files = await RNFS.readDir(this.modelsDir);
    return files.reduce((total, file) => total + file.size, 0);
  }

  // --- Private helpers ---

  private async ensureModelsDirectory(): Promise<void> {
    const exists = await RNFS.exists(this.modelsDir);
    if (!exists) {
      await RNFS.mkdir(this.modelsDir);
    }
  }

  private async checkASRModelsExist(): Promise<boolean> {
    const paths = [
      `${this.modelsDir}/${MODEL_PATHS.asrEncoder}`,
      `${this.modelsDir}/${MODEL_PATHS.asrDecoder}`,
      `${this.modelsDir}/${MODEL_PATHS.asrJoiner}`,
      `${this.modelsDir}/${MODEL_PATHS.asrTokens}`,
    ];

    const results = await Promise.all(paths.map((p) => RNFS.exists(p)));
    return results.every((exists) => exists);
  }

}

// Singleton instance
let instance: ModelDownloadService | null = null;

export function getModelDownloadService(documentDir: string): ModelDownloadService {
  if (!instance) {
    instance = new ModelDownloadService(documentDir);
  }
  return instance;
}
