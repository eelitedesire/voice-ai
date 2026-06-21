'use client';

import { motion } from 'framer-motion';

interface AccuracyBarProps {
  confidence: number; // 0-1
}

export function AccuracyBar({ confidence }: AccuracyBarProps) {
  const percentage = Math.round(confidence * 100);
  const color = confidence > 0.8 ? 'bg-green-500' : confidence > 0.6 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div className="flex items-center gap-3 min-w-[140px]">
      <span className="text-xs font-medium text-secondary whitespace-nowrap">Confidence</span>
      <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full ${color} rounded-full`}
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>
      <span className="text-xs font-semibold text-primary min-w-[3ch]">{percentage}%</span>
    </div>
  );
}
