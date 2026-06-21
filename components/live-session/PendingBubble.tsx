'use client';

import { motion } from 'framer-motion';

interface PendingBubbleProps {
  text: string;
}

export function PendingBubble({ text }: PendingBubbleProps) {
  if (!text) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex items-start gap-3 px-4"
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 dark:bg-gray-700 flex items-center justify-center">
        <motion.div
          className="w-2 h-2 rounded-full bg-gray-500"
          animate={{ scale: [1, 1.2, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </div>
      <div className="flex-1 max-w-[85%]">
        <div className="px-4 py-3 rounded-2xl bg-gray-100/80 dark:bg-gray-800/80 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-tertiary">Live</span>
          </div>
          <motion.p
            className="text-sm text-secondary"
            animate={{ opacity: [0.5, 0.8, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            {text}
            <span className="caret-blink">▍</span>
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
