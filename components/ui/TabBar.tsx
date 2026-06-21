'use client';

import { motion } from 'framer-motion';

interface Tab {
  id: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function TabBar({ tabs, activeTab, onTabChange }: TabBarProps) {
  return (
    <div className="relative flex gap-1 p-1 bg-surface rounded-xl border border-default shadow-sm overflow-x-auto scrollbar-hide">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`relative z-10 flex shrink-0 items-center justify-center gap-2 px-3 sm:px-6 py-2.5 sm:py-3 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors ${
              isActive
                ? 'text-white shadow-md'
                : 'text-secondary hover:text-primary hover:bg-base'
            }`}
          >
            <span className="shrink-0">{tab.icon}</span>
            <span>{tab.label}</span>
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute inset-0 bg-gradient-to-r from-accent to-accent/80 rounded-lg -z-10"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
