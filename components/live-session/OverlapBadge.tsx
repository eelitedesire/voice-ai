'use client';

import { Users } from 'lucide-react';

export function OverlapBadge() {
  return (
    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-300 dark:border-yellow-700">
      <Users className="w-3 h-3 text-yellow-700 dark:text-yellow-500" />
      <span className="text-xs font-medium text-yellow-700 dark:text-yellow-500">Overlap</span>
    </div>
  );
}
