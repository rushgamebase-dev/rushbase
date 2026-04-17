'use client';

import { useState } from 'react';
import { useProfile } from '../hooks/useProfile';
import { useStats } from '../hooks/useStats';
import { useBadges } from '../hooks/useBadges';
import { useRank } from '../hooks/useRank';
import { ProfileCard } from '../components/profile/ProfileCard';
import { BetHistory } from '../components/bet-history/BetHistory';
import { ProfileBadges } from '../components/profile/ProfileBadges';
import type { ProfileCardData } from '../types/profile';

type Tab = 'history' | 'badges';

export function ProfilePage({ handle, isOwnProfile, onEditClick }: { handle: string; isOwnProfile?: boolean; onEditClick?: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>('history');
  const { data: profile, isLoading } = useProfile(handle);
  const { data: stats } = useStats(profile?.id);
  const { data: badges } = useBadges(profile?.id);
  const { data: rank } = useRank(profile?.id);

  if (isLoading) return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="bg-[#111111] border border-[#1a1a1a] rounded-xl h-64 animate-pulse" />
      <div className="grid grid-cols-5 gap-3">
        <div className="col-span-3 h-32 bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl animate-pulse" />
        <div className="col-span-2 h-32 bg-[#0d0d0d] border border-[#1a1a1a] rounded-xl animate-pulse" />
      </div>
    </div>
  );

  if (!profile) return <div className="max-w-3xl mx-auto p-6 text-center"><div className="text-lg font-mono text-[#666666] py-12">User not found</div></div>;

  const cardData: ProfileCardData = {
    id: profile.id, wallet: profile.wallet, handle: profile.profile?.handle || null,
    displayName: profile.profile?.displayName || null, avatarUrl: profile.profile?.avatarUrl || null,
    level: profile.stats?.level || 1, xp: profile.stats?.xp || 0, xpToNextLevel: profile.stats?.xpToNextLevel || 100,
    totalBets: profile.stats?.totalBets || 0, totalVolume: profile.stats?.totalVolume || '0',
    totalPnl: profile.stats?.totalPnl || '0', winRate: profile.stats?.winRate || 0, bestStreak: profile.stats?.bestStreak || 0,
    badges: (profile.badges || []).filter((b) => b.earnedAt).slice(0, 5).map((b) => ({ slug: b.slug, name: b.name, imageUrl: b.imageUrl })),
    joinedAt: profile.createdAt,
  };

  const tabs: { key: Tab; label: string }[] = [{ key: 'history', label: 'History' }, { key: 'badges', label: 'Badges' }];

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6 space-y-5">
      <ProfileCard data={cardData} stats={stats} rank={rank} badges={badges} isOwnProfile={isOwnProfile} onEditClick={onEditClick} />

      <div className="flex gap-1 border-b border-[#1a1a1a]">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`text-xs font-mono px-4 py-2 border-b-2 transition-colors ${activeTab === tab.key ? 'text-[#00ff88] border-[#00ff88]' : 'text-[#666666] border-transparent hover:text-[#e0e0e0]'}`}>{tab.label}</button>
        ))}
      </div>
      <div>
        {activeTab === 'history' && profile.id && <BetHistory userId={profile.id} />}
        {activeTab === 'badges' && badges && <ProfileBadges badges={badges} layout="grid" showLocked />}
      </div>
    </div>
  );
}
