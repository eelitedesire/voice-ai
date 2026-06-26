/**
 * Microphone capture constraints — shared by enrollment and live capture.
 *
 * Both paths default to a DYNAMIC-RANGE-PRESERVING config (autoGainControl and
 * noiseSuppression OFF) so embeddings don't shift between enrollment and a live
 * session, and so multi-condition enrollment's loud/soft contrast survives.
 *
 * Enrollment is fixed (a controlled quiet moment). Live capture is configurable
 * (a real, possibly noisy conversation) so noiseSuppression — or AGC — can be
 * flipped back on for a noisy room WITHOUT touching enrollment, via NEXT_PUBLIC_*
 * env. We do not bake a clean-room assumption irreversibly into the live path.
 *
 * Constraints are REQUESTS the browser may silently ignore, so callers must read
 * back `track.getSettings()` with `verifyConstraints` and surface mismatches.
 */

export interface CaptureConstraints {
  channelCount: number;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

/** Enrollment: always range-preserving; not configurable. */
export const ENROLLMENT_CONSTRAINTS: CaptureConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

function envBool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

/**
 * Live capture constraints. Defaults match enrollment (AGC/NS off). Override per
 * deployment via:
 *   NEXT_PUBLIC_LIVE_NOISE_SUPPRESSION=true   (noisy rooms)
 *   NEXT_PUBLIC_LIVE_AUTO_GAIN=true
 *   NEXT_PUBLIC_LIVE_ECHO_CANCELLATION=true
 */
export function liveCaptureConstraints(): CaptureConstraints {
  return {
    channelCount: 1,
    echoCancellation: envBool(process.env.NEXT_PUBLIC_LIVE_ECHO_CANCELLATION, false),
    noiseSuppression: envBool(process.env.NEXT_PUBLIC_LIVE_NOISE_SUPPRESSION, false),
    autoGainControl: envBool(process.env.NEXT_PUBLIC_LIVE_AUTO_GAIN, false),
  };
}

export type ConstraintState = 'disabled' | 'enabled' | 'unknown';

export interface ConstraintReadback {
  requested: CaptureConstraints;
  autoGainControl: ConstraintState;
  noiseSuppression: ConstraintState;
  echoCancellation: ConstraintState;
  /** True ONLY when AGC and NS are CONFIRMED disabled (dynamic range preserved). */
  rangePreserved: boolean;
  settings: MediaTrackSettings;
}

function readState(v: boolean | undefined): ConstraintState {
  return v === false ? 'disabled' : v === true ? 'enabled' : 'unknown';
}

/**
 * Read back what the browser ACTUALLY applied. getSettings() may omit a field
 * (→ 'unknown'); rangePreserved requires both AGC and NS *confirmed* disabled,
 * so an 'unknown' is treated as not-confirmed (the caller should warn).
 */
export function verifyConstraints(
  track: MediaStreamTrack,
  requested: CaptureConstraints,
): ConstraintReadback {
  const settings = track.getSettings();
  const autoGainControl = readState(settings.autoGainControl);
  const noiseSuppression = readState(settings.noiseSuppression);
  return {
    requested,
    autoGainControl,
    noiseSuppression,
    echoCancellation: readState(settings.echoCancellation),
    rangePreserved: autoGainControl === 'disabled' && noiseSuppression === 'disabled',
    settings,
  };
}

export function formatReadback(r: ConstraintReadback): string {
  return `AGC=${r.autoGainControl}, NS=${r.noiseSuppression}, EC=${r.echoCancellation}`;
}
