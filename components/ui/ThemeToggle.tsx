'use client';

import { useTheme } from '@/lib/hooks/useTheme';
import { Sun, Moon } from 'lucide-react';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-lg hover:bg-surface transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'light' ? (
        <Moon className="w-5 h-5 text-secondary" />
      ) : (
        <Sun className="w-5 h-5 text-secondary" />
      )}
    </button>
  );
}
