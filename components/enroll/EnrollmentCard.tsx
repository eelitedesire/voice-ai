'use client';

import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, Check, Trash2, AlertTriangle, Square } from 'lucide-react';
import { ENROLLMENT_CONSTRAINTS, verifyConstraints } from '@/lib/audio-constraints';

// ── Conditions (design-B prompts) ───────────────────────────────────────────
const REQUIRED = ['normal', 'loud', 'soft'] as const;
type Condition = (typeof REQUIRED)[number];

const CONDITION_META: Record<Condition, { label: string; prompt: string }> = {
  normal: { label: 'Normal', prompt: 'Speak naturally, as you would in a session.' },
  loud: { label: 'Louder', prompt: 'Speak up — project as if across the room.' },
  soft: { label: 'Softer', prompt: 'Speak quietly — a low, calm voice.' },
};

export interface EnrollResult {
  accepted: boolean;
  condition: string;
  reason?: string;
  conditionsPresent?: string[];
  status?: 'incomplete' | 'complete';
}
export interface FinalizeResult {
  finalized: boolean;
  missing?: string[];
  tightness?: number;
  warnings?: { code: string; message: string }[];
  reason?: string;
}

export interface EnrollSpeaker {
  id: string;
  name: string;
  sampleCount?: number;
  enrollmentStatus?: 'incomplete' | 'complete';
  conditions?: string[];
  remainingConditions?: string[];
}

interface EnrollmentCardProps {
  speaker?: EnrollSpeaker;
  onEnrollCondition: (name: string, condition: Condition, audio: Blob) => Promise<EnrollResult>;
  onFinalize: (name: string) => Promise<FinalizeResult>;
  onRemove?: (id: string) => Promise<void>;
  onRefresh: () => void;
}

export function EnrollmentCard({
  speaker,
  onEnrollCondition,
  onFinalize,
  onRemove,
  onRefresh,
}: EnrollmentCardProps) {
  const [name, setName] = useState(speaker?.name ?? '');
  const [passed, setPassed] = useState<string[]>(speaker?.conditions ?? []);
  const [isRecording, setIsRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [constraintWarning, setConstraintWarning] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<{ code: string; message: string }[] | null>(null);
  const [done, setDone] = useState(speaker?.enrollmentStatus === 'complete');

  const mediaRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; timer: ReturnType<typeof setInterval> } | null>(null);
  const recordingRef = useRef(false);

  const effectiveName = speaker?.name ?? name.trim();
  const nextCondition = REQUIRED.find((c) => !passed.includes(c)) ?? null;
  const allCaptured = nextCondition === null;

  // ── Recording ──────────────────────────────────────────────────────────────
  const startRecording = async (condition: Condition) => {
    if (!effectiveName) return;
    setReason(null);
    setConstraintWarning(null);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: ENROLLMENT_CONSTRAINTS });
    const track = stream.getAudioTracks()[0];
    if (track) {
      const rb = verifyConstraints(track, ENROLLMENT_CONSTRAINTS);
      console.log('[Enroll] getUserMedia readback —', `AGC=${rb.autoGainControl}, NS=${rb.noiseSuppression}`);
      if (!rb.rangePreserved) {
        setConstraintWarning(
          "Your browser wouldn't confirm auto-gain/noise-suppression are off. Make the loud and soft samples clearly different — they must differ by ≥3 dB or they'll be rejected.",
        );
      }
    }

    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!recordingRef.current) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(Math.min(100, (avg / 255) * 150));
      requestAnimationFrame(tick);
    };

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onstop = async () => {
      clearInterval(mediaRef.current!.timer);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      setIsRecording(false);
      setLevel(0);
      const blob = new Blob(chunks, { type: 'audio/webm' });
      await submit(condition, blob);
    };

    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    mediaRef.current = { recorder, stream, ctx, timer };
    recordingRef.current = true;
    setSeconds(0);
    setIsRecording(true);
    recorder.start();
    tick();
  };

  const stopRecording = () => {
    recordingRef.current = false;
    mediaRef.current?.recorder.stop();
  };

  const submit = async (condition: Condition, blob: Blob) => {
    setBusy(true);
    try {
      const res = await onEnrollCondition(effectiveName, condition, blob);
      if (res.accepted) {
        setPassed(res.conditionsPresent ?? [...passed, condition]);
        onRefresh();
      } else {
        setReason(res.reason ?? 'Recording rejected — please redo this condition.');
      }
    } catch {
      setReason('Upload failed — please try again.');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    setBusy(true);
    setReason(null);
    try {
      const res = await onFinalize(effectiveName);
      if (res.finalized) {
        setWarnings(res.warnings ?? []);
        setDone(true);
        onRefresh();
      } else {
        setReason(res.reason ?? `Still missing: ${(res.missing ?? []).join(', ')}`);
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Completed speaker ────────────────────────────────────────────────────────
  if (done) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative p-6 rounded-xl border border-default bg-surface">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="relative w-14 h-14 rounded-full bg-gradient-to-br from-accent to-accent/60 flex items-center justify-center shadow-lg">
              <span className="text-xl font-bold text-white">{(speaker?.name ?? name).charAt(0).toUpperCase()}</span>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-surface flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-primary mb-1">{speaker?.name ?? name}</h4>
              <p className="text-xs text-secondary">Enrolled · {(speaker?.conditions ?? passed).join(', ') || 'all conditions'}</p>
            </div>
          </div>
          {onRemove && speaker && (
            <button onClick={() => onRemove(speaker.id)} className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg" title="Remove speaker">
              <Trash2 className="w-4 h-4 text-secondary hover:text-red-500" />
            </button>
          )}
        </div>
        {warnings && warnings.length > 0 && (
          <div className="mt-4 space-y-2">
            {warnings.map((w, i) => (
              <div key={i} className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{w.message}</span>
              </div>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  // ── Guided / resume flow ─────────────────────────────────────────────────────
  const isResuming = !!speaker && speaker.enrollmentStatus === 'incomplete';

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-6 rounded-xl border-2 border-dashed border-default bg-surface">
      <div className="space-y-4">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-2">
            <Mic className="w-6 h-6 text-accent" />
          </div>
          <h4 className="text-sm font-semibold text-primary">
            {isResuming ? `Resume enrolling ${speaker?.name}` : 'Enroll New Speaker'}
          </h4>
          <p className="text-xs text-secondary mt-1">Three short samples: normal, louder, softer (~10s each).</p>
        </div>

        {!speaker && (
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter speaker name"
            disabled={isRecording || busy || passed.length > 0}
            className="w-full px-4 py-3 rounded-lg border border-default bg-base text-primary placeholder:text-tertiary focus:ring-2 focus:ring-accent text-center font-medium disabled:opacity-60"
          />
        )}

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2">
          {REQUIRED.map((c) => {
            const isPassed = passed.includes(c);
            const isCurrent = c === nextCondition;
            return (
              <div
                key={c}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                  isPassed
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : isCurrent
                      ? 'bg-accent/15 text-accent ring-1 ring-accent/40'
                      : 'bg-gray-100 dark:bg-gray-800 text-tertiary'
                }`}
              >
                {isPassed && <Check className="w-3 h-3" />}
                {CONDITION_META[c].label}
              </div>
            );
          })}
        </div>

        {constraintWarning && (
          <div className="flex gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{constraintWarning}</span>
          </div>
        )}
        {reason && (
          <div className="flex gap-2 text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{reason}</span>
          </div>
        )}

        {/* Current step */}
        {!allCaptured && nextCondition && (
          <div className="text-center space-y-3">
            <p className="text-sm text-primary font-medium">{CONDITION_META[nextCondition].label} sample</p>
            <p className="text-xs text-secondary">{CONDITION_META[nextCondition].prompt}</p>

            {isRecording ? (
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="flex items-end gap-1 h-10">
                  {[...Array(8)].map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 rounded-full ${level > (i / 8) * 100 ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-700'}`}
                      style={{ height: `${16 + i * 3}px` }}
                    />
                  ))}
                </div>
                <p className="text-lg font-bold text-primary">{seconds}s</p>
                <button onClick={stopRecording} className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-800">
                  <Square className="w-4 h-4" /> Stop
                </button>
              </div>
            ) : (
              <button
                onClick={() => startRecording(nextCondition)}
                disabled={!effectiveName || busy}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-accent to-accent/80 text-white font-medium disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed shadow-lg"
              >
                {busy ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Checking…
                  </>
                ) : (
                  <>
                    <Mic className="w-5 h-5" /> Record {CONDITION_META[nextCondition].label}
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Finalize */}
        {allCaptured && (
          <button
            onClick={finalize}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-60"
          >
            {busy ? 'Finalizing…' : 'Finish enrollment'}
          </button>
        )}

        {speaker && onRemove && (
          <button onClick={() => onRemove(speaker.id)} className="w-full text-xs text-secondary hover:text-red-500">
            Remove this incomplete speaker
          </button>
        )}
      </div>
    </motion.div>
  );
}
