'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Mic, MicOff, Radio } from 'lucide-react';

interface VuMeterProps {
  audioStream: MediaStream | null;
}

export function VuMeter({ audioStream }: VuMeterProps) {
  const [level, setLevel] = useState(0);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!audioStream) {
      setLevel(0);
      setIsActive(false);
      return;
    }

    setIsActive(true); // Set active as soon as stream exists
    
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(audioStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.fftSize);
    let rafId: number;

    const update = () => {
      analyser.getByteTimeDomainData(dataArray);
      
      // Calculate RMS (Root Mean Square) for accurate volume level
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const calculatedLevel = Math.min(100, rms * 200); // Amplify for visibility
      
      setLevel(calculatedLevel);
      rafId = requestAnimationFrame(update);
    };

    update();

    return () => {
      cancelAnimationFrame(rafId);
      audioContext.close();
    };
  }, [audioStream]);

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-gradient-to-r from-base to-surface rounded-xl border border-default shadow-sm min-w-fit">
      {/* Animated Microphone Icon */}
      <div className="relative flex items-center justify-center">
        <motion.div
          animate={{
            scale: isActive && level > 1 ? [1, 1.2, 1] : 1,
            opacity: isActive ? [0.8, 1, 0.8] : 0.6
          }}
          transition={{
            duration: 0.5,
            repeat: isActive && level > 1 ? Infinity : 0
          }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className={`w-10 h-10 rounded-full blur-md transition-colors ${
            !isActive ? 'bg-gray-400/20' :
            level > 70 ? 'bg-red-500/40' :
            level > 40 ? 'bg-yellow-500/40' :
            'bg-green-500/40'
          }`} />
        </motion.div>
        
        <motion.div
          animate={{
            y: isActive && level > 1 ? [0, -2, 0] : 0
          }}
          transition={{
            duration: 0.3,
            repeat: isActive && level > 1 ? Infinity : 0,
            repeatDelay: 0.1
          }}
          className="relative z-10"
        >
          {isActive ? (
            <Mic className={`w-5 h-5 transition-colors ${
              level > 70 ? 'text-red-500' :
              level > 40 ? 'text-yellow-500' :
              'text-green-500'
            }`} />
          ) : (
            <MicOff className="w-5 h-5 text-secondary" />
          )}
        </motion.div>
      </div>

      {/* Label */}
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-primary tracking-wide">INPUT</span>
        <motion.span 
          className="text-[10px] font-medium"
          animate={{ 
            opacity: isActive ? 1 : 0.5,
            color: isActive ? '#10b981' : undefined
          }}
        >
          {isActive ? 'Active' : 'Silent'}
        </motion.span>
      </div>
      
      {/* Advanced VU Meter Bars */}
      <div className="flex items-center gap-1 px-3 py-2 bg-surface/50 rounded-lg border border-default/50">
        {[...Array(16)].map((_, i) => {
          const threshold = (i / 16) * 100;
          const active = isActive && level > threshold;
          const intensity = Math.min(1, level / 100);
          
          return (
            <motion.div
              key={i}
              className={`w-1 rounded-full transition-all duration-75 ${
                active
                  ? i < 10 
                    ? 'bg-gradient-to-t from-green-500 to-green-400 shadow-sm shadow-green-500/50' 
                    : i < 14 
                    ? 'bg-gradient-to-t from-yellow-500 to-yellow-400 shadow-sm shadow-yellow-500/50' 
                    : 'bg-gradient-to-t from-red-500 to-red-400 shadow-sm shadow-red-500/50'
                  : 'bg-gradient-to-t from-gray-300 to-gray-200 dark:from-gray-700 dark:to-gray-600'
              }`}
              style={{ 
                height: `${12 + i * 1.5}px`,
                opacity: active ? 0.9 + (intensity * 0.1) : 0.3
              }}
              animate={{ 
                scaleY: active ? [0.95, 1, 0.95] : 1,
              }}
              transition={{ 
                duration: 0.15,
                repeat: active ? Infinity : 0
              }}
            />
          );
        })}
      </div>

      {/* Peak Indicator */}
      <div className="flex flex-col items-center gap-1">
        <motion.div
          animate={{
            scale: level > 85 ? [1, 1.3, 1] : 1,
            opacity: level > 85 ? [0.6, 1, 0.6] : 0.3
          }}
          transition={{
            duration: 0.5,
            repeat: level > 85 ? Infinity : 0
          }}
        >
          <Radio className={`w-4 h-4 transition-colors ${
            level > 85 ? 'text-red-500' : 'text-secondary/40'
          }`} />
        </motion.div>
        <span className="text-[9px] font-bold text-secondary tracking-wider">PEAK</span>
      </div>
    </div>
  );
}
