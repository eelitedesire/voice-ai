'use client';

import { useEffect, useState } from 'react';
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

    setIsActive(true);
    
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
      
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const calculatedLevel = Math.min(100, rms * 200);
      
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
      {/* Microphone Icon */}
      <div className="relative flex items-center justify-center">
        <div className="relative z-10">
          {isActive ? (
            <Mic className={`w-5 h-5 transition-colors ${
              level > 70 ? 'text-red-500' :
              level > 40 ? 'text-yellow-500' :
              'text-green-500'
            }`} />
          ) : (
            <MicOff className="w-5 h-5 text-secondary" />
          )}
        </div>
      </div>

      {/* Label */}
      <div className="flex flex-col">
        <span className="text-xs font-semibold text-primary tracking-wide">INPUT</span>
        <span 
          className={`text-[10px] font-medium transition-opacity ${
            isActive ? 'opacity-100 text-green-500' : 'opacity-50'
          }`}
        >
          {isActive ? 'Active' : 'Silent'}
        </span>
      </div>
      
      {/* VU Meter Bars */}
      <div className="flex items-center gap-1 px-3 py-2 bg-surface/50 rounded-lg border border-default/50">
        {[...Array(16)].map((_, i) => {
          const threshold = (i / 16) * 100;
          const active = isActive && level > threshold;
          
          return (
            <div
              key={i}
              className={`w-1 rounded-full transition-all duration-75 ${
                active
                  ? i < 10 
                    ? 'bg-gradient-to-t from-green-500 to-green-400' 
                    : i < 14 
                    ? 'bg-gradient-to-t from-yellow-500 to-yellow-400' 
                    : 'bg-gradient-to-t from-red-500 to-red-400'
                  : 'bg-gradient-to-t from-gray-300 to-gray-200 dark:from-gray-700 dark:to-gray-600'
              }`}
              style={{ 
                height: `${12 + i * 1.5}px`,
                opacity: active ? 0.9 : 0.3
              }}
            />
          );
        })}
      </div>

      {/* Peak Indicator */}
      <div className="flex flex-col items-center gap-1">
        <div
          className="transition-all duration-200"
          style={{
            opacity: level > 85 ? 1 : 0.3
          }}
        >
          <Radio className={`w-4 h-4 transition-colors ${
            level > 85 ? 'text-red-500' : 'text-secondary/40'
          }`} />
        </div>
        <span className="text-[9px] font-bold text-secondary tracking-wider">PEAK</span>
      </div>
    </div>
  );
}
