'use client';

import { motion } from 'framer-motion';
import { Mic, Square } from 'lucide-react';

interface RecordControlProps {
  isRecording: boolean;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
}

export function RecordControl({ isRecording, onStart, onStop, disabled }: RecordControlProps) {
  return (
    <motion.button
      onClick={isRecording ? onStop : onStart}
      disabled={disabled}
      className={`relative flex items-center gap-3 px-6 py-3 rounded-xl font-semibold text-white shadow-lg transition-all ${
        disabled
          ? 'bg-gray-400 cursor-not-allowed'
          : isRecording
          ? 'bg-red-500 hover:bg-red-600'
          : 'bg-accent hover:bg-accent/90'
      }`}
      whileHover={!disabled ? { scale: 1.02 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
    >
      {isRecording ? (
        <>
          <Square className="w-5 h-5 fill-current" />
          <span>Stop Session</span>
        </>
      ) : (
        <>
          <Mic className="w-5 h-5" />
          <span>Start Session</span>
        </>
      )}
      {isRecording && (
        <motion.div
          className="absolute inset-0 rounded-xl border-2 border-red-300"
          animate={{ scale: [1, 1.05, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}
    </motion.button>
  );
}
