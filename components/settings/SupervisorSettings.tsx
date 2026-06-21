'use client';

import { useState } from 'react';
import { Sparkles, Brain, AlertCircle } from 'lucide-react';

interface SupervisorSettingsProps {
  onPromptChange?: (prompt: string) => void;
}

export function SupervisorSettings({ onPromptChange }: SupervisorSettingsProps) {
  const [activePreset, setActivePreset] = useState('clinical-supervisor');
  const [customPrompt, setCustomPrompt] = useState('');

  const presets = [
    {
      id: 'clinical-supervisor',
      name: 'Clinical Supervisor',
      icon: Brain,
      description: 'Evidence-based therapeutic guidance',
      prompt: 'You are a clinical supervisor providing evidence-based therapeutic guidance. Focus on recognizing patterns, emotional dynamics, and suggesting research-backed interventions.',
    },
    {
      id: 'empathetic-coach',
      name: 'Empathetic Coach',
      icon: Sparkles,
      description: 'Supportive and validating approach',
      prompt: 'You are an empathetic coach providing supportive, validating responses. Prioritize emotional safety and creating a judgment-free space.',
    },
    {
      id: 'behavioral-therapist',
      name: 'Behavioral Therapist',
      icon: AlertCircle,
      description: 'CBT-focused analysis',
      prompt: 'You are a behavioral therapist specializing in CBT. Identify cognitive distortions, behavioral patterns, and suggest concrete action steps.',
    },
  ];

  const handlePresetSelect = (preset: typeof presets[0]) => {
    setActivePreset(preset.id);
    onPromptChange?.(preset.prompt);
  };

  const handleCustomPromptSave = () => {
    if (customPrompt.trim()) {
      setActivePreset('custom');
      onPromptChange?.(customPrompt);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-primary mb-2">AI Supervisor Profile</h3>
        <p className="text-sm text-secondary">Choose how the AI analyzes and responds to sessions</p>
      </div>

      <div className="space-y-3">
        {presets.map((preset) => {
          const Icon = preset.icon;
          return (
            <button
              key={preset.id}
              onClick={() => handlePresetSelect(preset)}
              className={`w-full flex items-start gap-3 p-4 rounded-lg border-2 transition-all text-left ${
                activePreset === preset.id
                  ? 'border-accent bg-accent/5'
                  : 'border-default hover:border-accent/50 bg-base'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                activePreset === preset.id ? 'bg-accent/10' : 'bg-gray-100 dark:bg-gray-800'
              }`}>
                <Icon className={`w-5 h-5 ${activePreset === preset.id ? 'text-accent' : 'text-secondary'}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-primary mb-1">{preset.name}</div>
                <div className="text-xs text-secondary">{preset.description}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div>
        <label className="block text-sm font-medium text-primary mb-2">
          Custom System Prompt
        </label>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="Enter a custom prompt to define AI behavior..."
          className="w-full px-3 py-2 rounded-lg border border-default bg-base text-primary text-sm resize-none focus:ring-2 focus:ring-accent focus:border-accent"
          rows={4}
        />
        <button
          onClick={handleCustomPromptSave}
          disabled={!customPrompt.trim()}
          className="mt-2 w-full px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          Apply Custom Prompt
        </button>
      </div>
    </div>
  );
}
