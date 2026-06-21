/**
 * Deterministic speaker color assignment
 */

const SPEAKER_COLORS = [
  { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-900 dark:text-blue-100', border: 'border-blue-200 dark:border-blue-800', dot: 'bg-blue-500' },
  { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-900 dark:text-purple-100', border: 'border-purple-200 dark:border-purple-800', dot: 'bg-purple-500' },
  { bg: 'bg-pink-50 dark:bg-pink-950/30', text: 'text-pink-900 dark:text-pink-100', border: 'border-pink-200 dark:border-pink-800', dot: 'bg-pink-500' },
  { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-900 dark:text-orange-100', border: 'border-orange-200 dark:border-orange-800', dot: 'bg-orange-500' },
  { bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-900 dark:text-green-100', border: 'border-green-200 dark:border-green-800', dot: 'bg-green-500' },
  { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-900 dark:text-teal-100', border: 'border-teal-200 dark:border-teal-800', dot: 'bg-teal-500' },
  { bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-900 dark:text-amber-100', border: 'border-amber-200 dark:border-amber-800', dot: 'bg-amber-500' },
  { bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-900 dark:text-red-100', border: 'border-red-200 dark:border-red-800', dot: 'bg-red-500' },
];

const speakerColorMap = new Map<string, number>();
let colorIndex = 0;

export function getSpeakerColor(speakerName: string) {
  if (!speakerColorMap.has(speakerName)) {
    speakerColorMap.set(speakerName, colorIndex++ % SPEAKER_COLORS.length);
  }
  return SPEAKER_COLORS[speakerColorMap.get(speakerName)!];
}

export function resetSpeakerColors() {
  speakerColorMap.clear();
  colorIndex = 0;
}
