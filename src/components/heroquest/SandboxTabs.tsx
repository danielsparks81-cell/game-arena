'use client';

import { useState } from 'react';
import HeroQuestSandbox from '@/components/HeroQuestSandbox';
import QuestGallery from '@/components/heroquest/QuestGallery';

type Tab = 'gallery' | 'authoring';

export default function SandboxTabs() {
  const [tab, setTab] = useState<Tab>('gallery');
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex gap-2 mb-4 border-b border-stone-700">
        {([['gallery', 'Quest 1 Review'], ['authoring', 'Map Authoring']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold rounded-t -mb-px border-b-2 transition ${
              tab === k ? 'border-amber-400 text-amber-200' : 'border-transparent text-stone-400 hover:text-stone-200'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'gallery' ? <QuestGallery /> : <HeroQuestSandbox />}
    </div>
  );
}
