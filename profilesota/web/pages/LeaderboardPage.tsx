'use client';

import { LeaderboardTable } from '../components/leaderboard/LeaderboardTable';
import { useAuth } from '../hooks/useAuth';

export function LeaderboardPage() {
  const { userId } = useAuth();

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-mono font-bold text-[#e0e0e0] mb-6">
        Leaderboard
      </h1>

      <LeaderboardTable currentUserId={userId || undefined} />
    </div>
  );
}
