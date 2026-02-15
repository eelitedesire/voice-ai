export const colors = {
  // Primary palette
  primary: '#6366F1',       // Indigo-500
  primaryDark: '#4F46E5',   // Indigo-600
  primaryLight: '#818CF8',  // Indigo-400

  // Functional
  success: '#10B981',       // Emerald-500
  warning: '#F59E0B',       // Amber-500
  error: '#EF4444',         // Red-500
  info: '#3B82F6',          // Blue-500

  // Neutrals
  background: '#0F172A',    // Slate-900
  surface: '#1E293B',       // Slate-800
  surfaceLight: '#334155',  // Slate-700
  border: '#475569',        // Slate-600
  textPrimary: '#F8FAFC',   // Slate-50
  textSecondary: '#94A3B8', // Slate-400
  textMuted: '#64748B',     // Slate-500

  // Speaker colors
  speaker1: '#06B6D4',      // Cyan-500
  speaker2: '#F472B6',      // Pink-400

  // Recording state
  recording: '#EF4444',
  recordingPulse: '#FCA5A5',
  processing: '#F59E0B',
  idle: '#6366F1',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '600' as const, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  bodySmall: { fontSize: 14, fontWeight: '400' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  label: { fontSize: 14, fontWeight: '600' as const, lineHeight: 18 },
} as const;

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;
