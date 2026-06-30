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
        <h2 className="text-2xl font-semibold">Supervisor Prompt</h2>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-sm px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 transition"
        >
          {isExpanded ? 'Collapse' : 'Configure'}
        </button>
      </div>

      {!isExpanded && selectedTemplate && (
        <p className="text-sm text-gray-500">
          Active: <span className="font-medium text-gray-700">{selectedTemplate.name}</span>
          {isEdited && <span className="ml-1 text-amber-600">(edited)</span>}
        </p>
      )}

      {isExpanded && (
        <div className="space-y-4">
          {/* Template selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PROMPT_TEMPLATES.map((template) => (
              <button
                key={template.id}
                onClick={() => handleTemplateSelect(template.id)}
                className={`text-left p-3 rounded-lg border-2 transition ${
                  selectedTemplateId === template.id
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }`}
              >
                <div className="font-medium text-sm">{template.name}</div>
                <div className="text-xs text-gray-500 mt-1">{template.description}</div>
              </button>
            ))}
          </div>

          {/* Editable prompt */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                Prompt Text
                {isEdited && (
                  <span className="ml-2 text-xs text-amber-600 font-normal">(modified)</span>
                )}
              </label>
              {isEdited && (
                <button
                  onClick={handleReset}
                  className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition"
                >
                  Reset to template
                </button>
              )}
            </div>
            <textarea
              value={customPrompt}
              onChange={(e) => handlePromptEdit(e.target.value)}
              rows={10}
              className="w-full rounded-lg border border-gray-300 p-3 text-sm font-mono text-gray-800 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 resize-y"
            />
          </div>
        </div>
      )}
    </div>
  );
}
