'use client';

import { useState, useEffect, useCallback } from 'react';
import { MemoryFact } from '@/types';

interface SpeakerMemoryView {
  name: string;
  facts: MemoryFact[];
  updatedAt: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  personal: 'Personal',
  relationship: 'Relationship',
  emotional: 'Emotional',
  goal: 'Goal',
  preference: 'Preference',
  history: 'History',
  other: 'Other',
};

const CATEGORY_COLORS: Record<string, string> = {
  personal: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800',
  relationship: 'bg-pink-100 dark:bg-pink-900/30 text-pink-800 dark:text-pink-300 border border-pink-200 dark:border-pink-800',
  emotional: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 border border-yellow-200 dark:border-yellow-800',
  goal: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800',
  preference: 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800',
  history: 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700',
  other: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
};

export default function MemoryPanel() {
  const [speakers, setSpeakers] = useState<SpeakerMemoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch('/api/memory');
      if (!res.ok) throw new Error('Failed to fetch memories');
      const data = await res.json();

      const views: SpeakerMemoryView[] = [];
      if (data.speakers) {
        for (const [name, mem] of Object.entries(data.speakers)) {
          const memory = mem as { facts: MemoryFact[]; updatedAt: number };
          if (memory.facts.length > 0) {
            views.push({ name, facts: memory.facts, updatedAt: memory.updatedAt });
          }
        }
      }
      views.sort((a, b) => b.updatedAt - a.updatedAt);
      setSpeakers(views);
      setError(null);
    } catch {
      setError('Failed to load memories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
    // Refresh every 10 seconds to pick up async extractions
    const interval = setInterval(fetchMemories, 10000);
    return () => clearInterval(interval);
  }, [fetchMemories]);

  const handleDeleteFact = async (speakerName: string, factId: string) => {
    try {
      const res = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker: speakerName, factId }),
      });
      if (res.ok) {
        fetchMemories();
      }
    } catch {
      setError('Failed to delete memory');
    }
  };

  const handleClearSpeaker = async (speakerName: string) => {
    if (!confirm(`Clear all memories for ${speakerName}?`)) return;
    try {
      const res = await fetch('/api/memory', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speaker: speakerName }),
      });
      if (res.ok) {
        fetchMemories();
      }
    } catch {
      setError('Failed to clear memories');
    }
  };

  if (loading) {
    return (
      <div className="text-gray-500 text-sm py-4">Loading memories...</div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-semibold text-primary">Session Memory</h2>
          <p className="text-secondary text-sm mt-1">
            Facts automatically extracted from conversations. Used to provide continuity across sessions.
          </p>
        </div>
        <button
          onClick={fetchMemories}
          aria-label="Refresh memories"
          className="self-start sm:self-auto shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent/10 hover:bg-accent/20 active:bg-accent/30 text-accent border border-accent/20 transition-colors font-medium text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {speakers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border-2 border-dashed border-default rounded-xl bg-base">
          <svg className="w-16 h-16 text-tertiary mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm text-secondary font-medium">No memories yet</p>
          <p className="text-xs text-tertiary mt-1">Memories are extracted automatically after sessions and chat messages</p>
        </div>
      ) : (
        speakers.map((speaker) => (
          <div key={speaker.name} className="border border-default rounded-xl p-6 bg-surface hover:border-accent/50 transition-all">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold text-lg capitalize text-primary">{speaker.name}</h3>
              <div className="flex items-center gap-3">
                <span className="px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-medium">
                  {speaker.facts.length} fact{speaker.facts.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => handleClearSpeaker(speaker.name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 transition-all text-xs font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear all
                </button>
              </div>
            </div>
            <ul className="space-y-3">
              {speaker.facts.map((fact) => (
                <li
                  key={fact.id}
                  className="flex items-start justify-between gap-3 text-sm group p-3 rounded-lg hover:bg-base transition-all"
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <span
                      className={`inline-block px-2 py-1 rounded-md text-xs font-semibold shrink-0 mt-0.5 ${
                        CATEGORY_COLORS[fact.category] || CATEGORY_COLORS.other
                      }`}
                    >
                      {CATEGORY_LABELS[fact.category] || fact.category}
                    </span>
                    <span className="text-primary leading-relaxed">{fact.content}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteFact(speaker.name, fact.id)}
                    className="text-tertiary hover:text-red-500 transition opacity-0 group-hover:opacity-100 shrink-0 p-1 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    title="Delete this memory"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
