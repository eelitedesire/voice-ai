/**
 * useOnDeviceModels — Tracks download/readiness status of on-device ML models.
 */

import { useState, useCallback, useEffect } from 'react';
import { sherpaOnnx } from '../native/SherpaOnnx';
import { MODEL_PATHS } from '../config/api';
import { ModelStatus } from '../types';

interface UseOnDeviceModelsReturn {
  status: ModelStatus;
  allReady: boolean;
  checkModels: () => Promise<void>;
}

export function useOnDeviceModels(documentDir: string): UseOnDeviceModelsReturn {
  const [status, setStatus] = useState<ModelStatus>({
    asr: 'not-downloaded',
    vad: 'not-downloaded',
    speaker: 'not-downloaded',
  });

  const checkModels = useCallback(async () => {
    try {
      const asrPaths = [
        `${documentDir}/${MODEL_PATHS.asrEncoder}`,
        `${documentDir}/${MODEL_PATHS.asrDecoder}`,
        `${documentDir}/${MODEL_PATHS.asrJoiner}`,
        `${documentDir}/${MODEL_PATHS.asrTokens}`,
      ];
      const asrReady = await sherpaOnnx.modelsExist(asrPaths);

      const vadReady = await sherpaOnnx.modelsExist([
        `${documentDir}/${MODEL_PATHS.vad}`,
      ]);

      const speakerReady = await sherpaOnnx.modelsExist([
        `${documentDir}/${MODEL_PATHS.speakerEncoder}`,
      ]);

      setStatus({
        asr: asrReady ? 'ready' : 'not-downloaded',
        vad: vadReady ? 'ready' : 'not-downloaded',
        speaker: speakerReady ? 'ready' : 'not-downloaded',
      });
    } catch {
      setStatus({
        asr: 'error',
        vad: 'error',
        speaker: 'error',
      });
    }
  }, [documentDir]);

  useEffect(() => {
    checkModels();
  }, [checkModels]);

  const allReady =
    status.asr === 'ready' &&
    status.vad === 'ready' &&
    status.speaker === 'ready';

  return { status, allReady, checkModels };
}
