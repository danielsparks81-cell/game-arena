'use client';

import { useState } from 'react';
import HeroQuestSandbox from '@/components/HeroQuestSandbox';
import QuestGallery from '@/components/heroquest/QuestGallery';

type Tab = 'gallery' | 'authoring';

export default function SandboxTabs() {
  const [tab, setTab] = useState<Tab>('gallery');
  return (
    <div className="h-screen flex flex-col bg-neutral-950">
      <div className="flex gap-2 px-3 pt-2 border-b border-stone-700 shrink-0">
        {([['gallery', 'Quest 1 Review'], ['authoring', 'Map Authoring']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-semibold rounded-t -mb-px border-b-2 transition ${
              tab === k ? 'border-amber-400 text-amber-200' : 'border-transparent text-stone-400 hover:text-stone-200'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {tab === 'gallery'
          ? <div className="h-full overflow-auto p-4"><QuestGallery /></div>
          : <HeroQuestSandbox />}
      </div>
    </div>
  );
}
