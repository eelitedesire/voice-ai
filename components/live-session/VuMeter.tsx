'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

interface VuMeterProps {
  audioStream: MediaStream | null;
}

export function VuMeter({ audioStream }: VuMeterProps) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!audioStream) {
      setLevel(0);
      return;
    }

    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(audioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let rafId: number;

    const update = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setLevel(Math.min(100, (avg / 255) * 150));
      rafId = requestAnimationFrame(update);
    };

    update();

    return () => {
      cancelAnimationFrame(rafId);
      audioContext.close();
    };
  }, [audioStream]);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-secondary">Input</span>
      <div className="flex items-end gap-0.5 h-6">
        {[...Array(12)].map((_, i) => {
          const threshold = (i / 12) * 100;
          const active = level > threshold;
          return (
            <motion.div
              key={i}
              className={`w-1 rounded-full ${
                active
                  ? i < 8 ? 'bg-green-500' : i < 10 ? 'bg-yellow-500' : 'bg-red-500'
                  : 'bg-gray-300 dark:bg-gray-700'
              }`}
              style={{ height: `${20 + i * 3}px` }}
              animate={{ opacity: active ? 1 : 0.3 }}
              transition={{ duration: 0.1 }}
            />
          );
        })}
      </div>
    </div>
  );
}
