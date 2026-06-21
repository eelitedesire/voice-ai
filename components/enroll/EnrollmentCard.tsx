'use client';

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Check, Trash2, Play, Pause, Volume2 } from 'lucide-react';

interface EnrollmentCardProps {
  speaker?: { id: string; name: string; sampleCount?: number };
  onEnroll: (name: string, audioBlob: Blob) => Promise<void>;
  onRemove?: (id: string) => Promise<void>;
}

export function EnrollmentCard({ speaker, onEnroll, onRemove }: EnrollmentCardProps) {
  const [name, setName] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const recorderRef = useRef<{ recorder: MediaRecorder; timer: NodeJS.Timeout; analyser?: AnalyserNode } | null>(null);

  const startRecording = async () => {
    if (!name.trim() && !speaker) return;
    
    setIsRecording(true);
    setRecordingTime(0);
    
    const timer = setInterval(() => setRecordingTime(t => t + 1), 1000);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Audio level visualization
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const updateLevel = () => {
      if (!isRecording) return;
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b) / dataArray.length;
      setAudioLevel(Math.min(100, (avg / 255) * 150));
      requestAnimationFrame(updateLevel);
    };
    updateLevel();
    
    const mediaRecorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];

    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      clearInterval(timer);
      stream.getTracks().forEach(t => t.stop());
      audioContext.close();
      setIsRecording(false);
      setAudioLevel(0);
      
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      setIsProcessing(true);
      await onEnroll(speaker?.name || name.trim(), audioBlob);
      setIsProcessing(false);
      setName('');
    };

    mediaRecorder.start();
    recorderRef.current = { recorder: mediaRecorder, timer };
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.recorder.stop();
    };
  };

  if (speaker) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="group relative p-6 rounded-xl border border-default bg-surface hover:border-accent/50 transition-all overflow-hidden"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="relative flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent to-accent/60 flex items-center justify-center shadow-lg">
                <span className="text-xl font-bold text-white">
                  {speaker.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-green-500 border-2 border-surface flex items-center justify-center">
                <Check className="w-3 h-3 text-white" />
              </div>
            </div>
            <div>
              <h4 className="text-lg font-semibold text-primary mb-1">{speaker.name}</h4>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-accent/10 text-accent">
                  <Volume2 className="w-3 h-3" />
                  <span className="text-xs font-medium">
                    {speaker.sampleCount || 1} sample{(speaker.sampleCount || 1) > 1 ? 's' : ''}
                  </span>
                </div>
                {(speaker.sampleCount || 1) >= 3 && (
                  <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
                    Optimal
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEnroll(speaker.name, new Blob())}
              className="p-2 hover:bg-accent/10 rounded-lg transition-colors group/btn"
              title="Add more samples"
            >
              <Mic className="w-4 h-4 text-secondary group-hover/btn:text-accent" />
            </button>
            {onRemove && (
              <button
                onClick={() => onRemove(speaker.id)}
                className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors group/btn"
              >
                <Trash2 className="w-4 h-4 text-secondary group-hover/btn:text-red-500" />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-6 rounded-xl border-2 border-dashed border-default bg-surface hover:border-accent/50 transition-all"
    >
      <div className="space-y-4">
        <div className="text-center mb-4">
          <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-3">
            <Mic className="w-6 h-6 text-accent" />
          </div>
          <h4 className="text-sm font-semibold text-primary">Enroll New Speaker</h4>
          <p className="text-xs text-secondary mt-1">Record 10-15 seconds of clear speech</p>
        </div>

        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Enter speaker name"
          disabled={isRecording || isProcessing}
          className="w-full px-4 py-3 rounded-lg border border-default bg-base text-primary placeholder:text-tertiary focus:ring-2 focus:ring-accent focus:border-accent disabled:opacity-50 text-center font-medium"
        />
        
        <AnimatePresence mode="wait">
          {isRecording ? (
            <motion.div
              key="recording"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex flex-col items-center gap-3 py-6">
                <motion.div
                  className="relative w-20 h-20 rounded-full bg-red-500 flex items-center justify-center"
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                >
                  <Mic className="w-10 h-10 text-white" />
                  <motion.div
                    className="absolute inset-0 rounded-full border-4 border-red-300"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.8, 0, 0.8] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                </motion.div>
                
                {/* Audio Level Bars */}
                <div className="flex items-end gap-1 h-12">
                  {[...Array(8)].map((_, i) => {
                    const threshold = (i / 8) * 100;
                    const active = audioLevel > threshold;
                    return (
                      <motion.div
                        key={i}
                        className={`w-2 rounded-full ${
                          active ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-700'
                        }`}
                        style={{ height: `${20 + i * 4}px` }}
                        animate={{ opacity: active ? 1 : 0.3 }}
                        transition={{ duration: 0.1 }}
                      />
                    );
                  })}
                </div>
                
                <div className="text-center">
                  <p className="text-2xl font-bold text-primary mb-1">{recordingTime}s</p>
                  <p className="text-xs text-secondary">Recording...</p>
                </div>
              </div>
              
              <button
                onClick={stopRecording}
                className="w-full px-4 py-3 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Stop Recording
              </button>
            </motion.div>
          ) : (
            <motion.button
              key="start"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              onClick={startRecording}
              disabled={!name.trim() || isProcessing}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-accent to-accent/80 text-white font-medium hover:from-accent/90 hover:to-accent/70 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl"
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Mic className="w-5 h-5" />
                  Start Recording
                </>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
