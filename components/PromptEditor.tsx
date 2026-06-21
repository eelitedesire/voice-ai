'use client';

import { useState, useEffect } from 'react';
import { PromptTemplate } from '@/types';
import { PROMPT_TEMPLATES, DEFAULT_TEMPLATE_ID } from '@/lib/prompt-templates';

interface PromptEditorProps {
  onPromptChange: (prompt: string) => void;
}

export default function PromptEditor({ onPromptChange }: PromptEditorProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [customPrompt, setCustomPrompt] = useState(
    PROMPT_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)?.prompt ?? ''
  );
  const [isEdited, setIsEdited] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    onPromptChange(customPrompt);
  }, []); // emit the default prompt on mount

  const handleTemplateSelect = (templateId: string) => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === templateId);
    if (template) {
      setSelectedTemplateId(templateId);
      setCustomPrompt(template.prompt);
      setIsEdited(false);
      onPromptChange(template.prompt);
    }
  };

  const handlePromptEdit = (value: string) => {
    setCustomPrompt(value);
    setIsEdited(true);
    onPromptChange(value);
  };

  const handleReset = () => {
    const template = PROMPT_TEMPLATES.find((t) => t.id === selectedTemplateId);
    if (template) {
      setCustomPrompt(template.prompt);
      setIsEdited(false);
      onPromptChange(template.prompt);
    }
  };

  const selectedTemplate = PROMPT_TEMPLATES.find((t) => t.id === selectedTemplateId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold text-primary">Supervisor Prompt</h2>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent border border-accent/20 transition-all font-medium text-sm"
        >
          {isExpanded ? (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
              </svg>
              Collapse
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Configure
            </>
          )}
        </button>
      </div>

      {!isExpanded && selectedTemplate && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-secondary">Active:</span>
          <span className="font-medium text-primary">{selectedTemplate.name}</span>
          {isEdited && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium">
              Modified
            </span>
          )}
        </div>
      )}

      {isExpanded && (
        <div className="space-y-4">
          {/* Template selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PROMPT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template.id)}
                className={`text-left p-4 rounded-lg border-2 transition-all ${
                  selectedTemplateId === template.id
                    ? 'border-accent bg-accent/10 shadow-md'
                    : 'border-default hover:border-accent/50 bg-base hover:bg-surface'
                }`}
              >
                <div className="font-semibold text-sm text-primary mb-1">{template.name}</div>
                <div className="text-xs text-secondary leading-relaxed">{template.description}</div>
              </button>
            ))}
          </div>

          {/* Editable prompt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-primary">
                Prompt Text
                {isEdited && (
                  <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs font-medium">
                    Modified
                  </span>
                )}
              </label>
              {isEdited && (
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-secondary hover:text-primary transition-all text-xs font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reset
                </button>
              )}
            </div>
            <textarea
              value={customPrompt}
              onChange={(e) => handlePromptEdit(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-default bg-base text-primary p-4 text-sm font-mono resize-y focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all"
              placeholder="Enter your custom supervisor prompt..."
            />
          </div>
        </div>
      )}
    </div>
  );
}
