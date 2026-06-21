'use client';

import { useRef, useState } from 'react';
import { Upload, File, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface AudioFileUploadProps {
  onUpload: (file: File) => Promise<void>;
  disabled?: boolean;
}

export function AudioFileUpload({ onUpload, disabled }: AudioFileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (file: File) => {
    if (!file || disabled || isUploading) return;

    setFileName(file.name);
    setIsUploading(true);
    setUploadStatus('idle');

    try {
      await onUpload(file);
      setUploadStatus('success');
      setTimeout(() => {
        setUploadStatus('idle');
        setFileName('');
      }, 3000);
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus('error');
      setTimeout(() => {
        setUploadStatus('idle');
        setFileName('');
      }, 3000);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith('audio/') || file.name.endsWith('.wav') || file.name.endsWith('.webm'))) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Upload className="w-4 h-4 text-secondary" />
        <span className="text-sm font-medium text-primary">Upload Audio File</span>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`relative border-2 border-dashed rounded-xl p-4 transition-all ${
          isDragging
            ? 'border-accent bg-accent/5'
            : 'border-default hover:border-accent/50 bg-surface'
        } ${disabled || isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".wav,.webm,audio/*"
          onChange={handleFileInputChange}
          disabled={disabled || isUploading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />

        <div className="flex flex-col items-center gap-2 pointer-events-none">
          <AnimatePresence mode="wait">
            {isUploading ? (
              <motion.div
                key="uploading"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center"
              >
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              </motion.div>
            ) : uploadStatus === 'success' ? (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
              >
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
              </motion.div>
            ) : uploadStatus === 'error' ? (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center"
              >
                <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
              </motion.div>
            ) : (
              <motion.div
                key="idle"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  isDragging ? 'bg-accent/20' : 'bg-gray-100 dark:bg-gray-800'
                }`}
              >
                <File className={`w-5 h-5 ${isDragging ? 'text-accent' : 'text-secondary'}`} />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="text-center">
            {isUploading ? (
              <p className="text-xs font-medium text-primary">Uploading...</p>
            ) : uploadStatus === 'success' ? (
              <>
                <p className="text-xs font-medium text-green-600 dark:text-green-400">Success!</p>
                <p className="text-[10px] text-secondary mt-0.5 truncate max-w-[200px]">{fileName}</p>
              </>
            ) : uploadStatus === 'error' ? (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">Upload failed</p>
            ) : (
              <>
                <p className="text-xs font-medium text-primary">
                  {isDragging ? 'Drop file' : 'Click or drag'}
                </p>
                <p className="text-[10px] text-secondary mt-0.5">WAV, WebM, MP3</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
