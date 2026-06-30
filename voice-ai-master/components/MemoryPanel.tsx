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
  personal: 'bg-blue-100 text-blue-800',
  relationship: 'bg-pink-100 text-pink-800',
  emotional: 'bg-yellow-100 text-yellow-800',
  goal: 'bg-green-100 text-green-800',
  preference: 'bg-purple-100 text-purple-800',
  history: 'bg-gray-100 text-gray-800',
  other: 'bg-slate-100 text-slate-800',
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
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-semibold">Session Memory</h2>
          <p className="text-gray-500 text-sm mt-1">
            Facts automatically extracted from conversations. Used to provide continuity across sessions.
          </p>
        </div>
        <button
          onClick={fetchMemories}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded text-sm">
          {error}
        </div>
      )}

      {speakers.length === 0 ? (
        <div className="text-gray-400 text-sm py-6 text-center border border-dashed border-gray-300 rounded-lg">
          No memories yet. Memories are extracted automatically after sessions and chat messages.
        </div>
      ) : (
        speakers.map((speaker) => (
          <div key={speaker.name} className="border border-gray-200 rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold text-lg capitalize">{speaker.name}</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">
                  {speaker.facts.length} fact{speaker.facts.length !== 1 ? 's' : ''}
                </span>
                <button
                  onClick={() => handleClearSpeaker(speaker.name)}
                  className="text-xs text-red-500 hover:text-red-700 transition"
                >
                  Clear all
                </button>
              </div>
            </div>
            <ul className="space-y-2">
              {speaker.facts.map((fact) => (
                <li
                  key={fact.id}
                  className="flex items-start justify-between gap-2 text-sm group"
                >
                  <div className="flex items-start gap-2 min-w-0">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium shrink-0 mt-0.5 ${
                        CATEGORY_COLORS[fact.category] || CATEGORY_COLORS.other
                      }`}
                    >
                      {CATEGORY_LABELS[fact.category] || fact.category}
                    </span>
                    <span className="text-gray-700">{fact.content}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteFact(speaker.name, fact.id)}
                    className="text-gray-300 hover:text-red-500 transition opacity-0 group-hover:opacity-100 shrink-0"
                    title="Delete this memory"
                  >
                    &times;
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
