'use client';

import { useState } from 'react';
import { TranscriptEntry, TherapeuticAnalysis } from '@/types';
import { TextToSpeech } from '@/lib/speech-synthesis';

interface AnalysisPanelProps {
  transcript: TranscriptEntry[];
  systemPrompt?: string;
  onAnalysisComplete?: (analysis: TherapeuticAnalysis) => void;
}

export default function AnalysisPanel({ transcript, systemPrompt, onAnalysisComplete }: AnalysisPanelProps) {
  const [analysis, setAnalysis] = useState<TherapeuticAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (transcript.length === 0) {
      setError('No transcript available to analyze');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ transcript, systemPrompt }),
      });

      if (!response.ok) {
        throw new Error('Analysis failed');
      }

      const result = await response.json();
      setAnalysis(result.analysis);

      if (onAnalysisComplete) {
        onAnalysisComplete(result.analysis);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze session');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSpeakAnalysis = async () => {
    if (!analysis) return;

    setIsSpeaking(true);

    try {
      const tts = new TextToSpeech();

      const fullText = `
        Session Summary: ${analysis.summary}

        Mood Assessment: ${analysis.mood}

        Key Breakthroughs: ${analysis.keyBreakthroughs.join('. ')}

        Homework Assignment: ${analysis.homework}

        ${analysis.concerns ? `Areas of Concern: ${analysis.concerns.join('. ')}` : ''}
      `;

      await tts.speak(fullText);
    } catch (err) {
      console.error('Failed to speak analysis:', err);
      setError('Text-to-speech failed. This feature requires browser support.');
    } finally {
      setIsSpeaking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Therapeutic Analysis</h2>
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing || transcript.length === 0}
          className={`px-6 py-3 rounded-lg font-semibold text-white transition-all ${
            isAnalyzing || transcript.length === 0
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-purple-500 hover:bg-purple-600 active:scale-95'
          }`}
        >
          {isAnalyzing ? 'Analyzing...' : 'Analyze Session'}
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {analysis && (
        <div className="bg-white border border-gray-300 rounded-lg p-6 space-y-4">
          <div>
            <h3 className="font-semibold text-lg mb-2">Summary</h3>
            <p className="text-gray-700">{analysis.summary}</p>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-2">Mood Assessment</h3>
            <span className="inline-block bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full">
              {analysis.mood}
            </span>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-2">Key Breakthroughs</h3>
            <ul className="list-disc list-inside space-y-1">
              {analysis.keyBreakthroughs.map((breakthrough, index) => (
                <li key={index} className="text-gray-700">
                  {breakthrough}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold text-lg mb-2">Homework Assignment</h3>
            <p className="text-gray-700 bg-blue-50 p-3 rounded">{analysis.homework}</p>
          </div>

          {analysis.concerns && analysis.concerns.length > 0 && (
            <div>
              <h3 className="font-semibold text-lg mb-2">Areas of Concern</h3>
              <ul className="list-disc list-inside space-y-1">
                {analysis.concerns.map((concern, index) => (
                  <li key={index} className="text-red-700">
                    {concern}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleSpeakAnalysis}
            disabled={isSpeaking}
            className={`w-full px-6 py-3 rounded-lg font-semibold text-white transition-all ${
              isSpeaking
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-indigo-500 hover:bg-indigo-600 active:scale-95'
            }`}
          >
            {isSpeaking ? 'Speaking...' : '🔊 Listen to Analysis'}
          </button>
        </div>
      )}
    </div>
  );
}
