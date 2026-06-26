/**
 * Embedding-model identity — the single string that ties together the cohort,
 * enrolled prototypes, and calibration. No heavy imports (no ONNX) so any
 * script or pure module can reference it.
 *
 * The default reflects the model wired in scripts/download-models.sh
 * (3D-Speaker ERes2Net-base, Mandarin SV, 16 kHz). Override with EMBEDDING_MODEL_ID
 * if you swap the model — the cohort/profile version checks will then force a
 * recompute rather than silently mixing embeddings from different models.
 */
export const EMBEDDING_MODEL_ID =
  process.env.EMBEDDING_MODEL_ID || 'eres2net-base-zh-3dspeaker-16k';

export const EMBEDDING_SAMPLE_RATE = 16000;
