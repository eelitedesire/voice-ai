'use client';

import { useState, useEffect } from 'react';
import { Brain, Tag, Clock, Trash2, Search } from 'lucide-react';
import { motion } from 'framer-motion';

interface MemoryFact {
  id: string;
  content: string;
  category: string;
  extractedAt: number;
  speaker?: string;
}

export function SessionMemory() {
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = [
    { id: 'all', label: 'All', color: 'bg-gray-500' },
    { id: 'personal', label: 'Personal', color: 'bg-blue-500' },
    { id: 'relationship', label: 'Relationship', color: 'bg-purple-500' },
    { id: 'emotional', label: 'Emotional', color: 'bg-pink-500' },
    { id: 'goal', label: 'Goals', color: 'bg-green-500' },
  ];

  useEffect(() => {
    fetchMemories();
  }, []);

  const fetchMemories = async () => {
    try {
      const res = await fetch('/api/memory');
      if (res.ok) {
        const data = await res.json();
        setMemories(data.memories || []);
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    }
  };

  const deleteMemory = async (id: string) => {
    try {
      const res = await fetch(`/api/memory?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMemories(prev => prev.filter(m => m.id !== id));
      }
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const filteredMemories = memories.filter(m => {
    const matchesSearch = m.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || m.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-accent" />
          <h3 className="text-lg font-semibold text-primary">Session Memory</h3>
        </div>
        <span className="text-sm text-secondary">{memories.length} facts stored</span>
      </div>

      {/* Search & Filter */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search memories..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-default bg-base text-primary text-sm focus:ring-2 focus:ring-accent focus:border-accent"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2">
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                selectedCategory === cat.id
                  ? `${cat.color} text-white`
                  : 'bg-surface text-secondary border border-default hover:border-accent/50'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Memory List */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {filteredMemories.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
              <Brain className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-sm text-secondary">
              {searchQuery ? 'No memories match your search' : 'No memories stored yet'}
            </p>
          </div>
        )}

        {filteredMemories.map((memory) => {
          const category = categories.find(c => c.id === memory.category);
          return (
            <motion.div
              key={memory.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 rounded-lg border border-default bg-surface hover:border-accent/50 transition-all group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-primary leading-relaxed mb-2">{memory.content}</p>
                  <div className="flex items-center gap-3 text-xs text-secondary">
                    {category && (
                      <div className="flex items-center gap-1.5">
                        <Tag className="w-3 h-3" />
                        <span className={`px-2 py-0.5 rounded-full ${category.color} text-white`}>
                          {category.label}
                        </span>
                      </div>
                    )}
                    {memory.speaker && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                        {memory.speaker}
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {new Date(memory.extractedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => deleteMemory(memory.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-all"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
