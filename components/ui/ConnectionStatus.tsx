'use client';

import { motion } from 'framer-motion';

type ConnectionState = 'disconnected' | 'connecting' | 'connected';

interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus({ state }: ConnectionStatusProps) {
  const config = {
    disconnected: { label: 'Offline', color: 'bg-gray-400', pulse: false },
    connecting: { label: 'Connecting', color: 'bg-yellow-500', pulse: true },
    connected: { label: 'Live', color: 'bg-green-500', pulse: false },
  };

  const { label, color, pulse } = config[state];

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-default">
      <motion.div
        className={`w-2 h-2 rounded-full ${color}`}
        animate={pulse ? { opacity: [1, 0.4, 1] } : {}}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="text-sm font-medium text-secondary">{label}</span>
    </div>
  );
}
