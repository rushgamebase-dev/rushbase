'use client';

import type { BadgeEarned } from '../../types/profile';
import { BadgeMedia } from './BadgeMedia';

const BADGE_ICONS: Record<string, string> = {
  'first-bet': '🎯', 'ten-bets': '🎲', 'fifty-bets': '📊', 'hundred-bets': '💯',
  'five-hundred-bets': '🏆', 'first-win': '🏅', 'ten-wins': '🔥', 'fifty-wins': '🎖️',
  'streak-3': '⚡', 'streak-5': '🔥', 'streak-10': '💎', 'high-roller': '🎰',
  'whale': '🐋', 'diamond-hands': '💎', 'beta-tester': '🧪', 'early-player': '🌱',
  'verified': '✅', 'founder': '⭐',
};

const BADGE_UNLOCK: Record<string, string> = {
  'first-bet': 'Place 1 bet', 'ten-bets': 'Place 10 bets', 'fifty-bets': 'Place 50 bets',
  'hundred-bets': 'Place 100 bets', 'five-hundred-bets': 'Place 500 bets',
  'first-win': 'Win 1 bet', 'ten-wins': 'Win 10 bets', 'fifty-wins': 'Win 50 bets',
  'streak-3': '3-win streak', 'streak-5': '5-win streak', 'streak-10': '10-win streak',
  'high-roller': 'Wager 1 ETH', 'whale': 'Wager 10 ETH', 'diamond-hands': 'Wager 50 ETH',
  'beta-tester': 'Granted in beta', 'early-player': 'Granted in early days',
  'verified': 'Manual grant', 'founder': 'Manual grant',
};

interface ProfileBadgesProps {
  badges: BadgeEarned[];
  layout?: 'grid' | 'row';
  maxVisible?: number;
  showLocked?: boolean;
}

export function ProfileBadges({ badges, layout = 'grid', maxVisible, showLocked = false }: ProfileBadgesProps) {
  const visible = showLocked ? badges : badges.filter((b) => b.isEarned !== false);
  const displayed = maxVisible ? visible.slice(0, maxVisible) : visible;
  const overflow = maxVisible && visible.length > maxVisible ? visible.length - maxVisible : 0;

  // Row layout — compact horizontal pill (used in hero card contexts only)
  if (layout === 'row') {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        {displayed.map((badge) => {
          const isLocked = badge.isEarned === false;
          return (
            <div
              key={badge.slug}
              className={`w-6 h-6 rounded flex items-center justify-center text-sm ${isLocked ? 'opacity-30 grayscale' : ''}`}
              style={{
                border: '1px solid #1a1a1a',
                backgroundColor: 'rgba(0,255,136,0.06)',
                boxShadow: isLocked ? 'none' : '0 0 6px rgba(0,255,136,0.15)',
              }}
              title={`${badge.name}${isLocked ? ' — locked' : ''}`}
            >
              {badge.imageUrl
                ? <BadgeMedia url={badge.imageUrl} alt={badge.name} className="w-4 h-4" />
                : <span className="text-xs">{BADGE_ICONS[badge.slug] || '🏷️'}</span>
              }
            </div>
          );
        })}
        {overflow > 0 && <span className="text-[10px] font-mono text-[#666] ml-1">+{overflow}</span>}
      </div>
    );
  }

  // Grid layout — detailed collection page. Split earned vs locked into sections.
  const earned = displayed.filter((b) => b.isEarned !== false);
  const locked = displayed.filter((b) => b.isEarned === false);

  return (
    <div className="space-y-6">
      {earned.length > 0 && (
        <BadgeSection title="Earned" count={earned.length} accent="#00ff88">
          {earned.map((b) => <BadgeTile key={b.slug} badge={b} state="earned" />)}
        </BadgeSection>
      )}

      {locked.length > 0 && (
        <BadgeSection title="Locked" count={locked.length} accent="#555">
          {locked.map((b) => <BadgeTile key={b.slug} badge={b} state="locked" />)}
        </BadgeSection>
      )}

      {earned.length === 0 && locked.length === 0 && (
        <div className="text-center text-sm font-mono text-[#666] py-8">
          No badges available
        </div>
      )}
    </div>
  );
}

function BadgeSection({
  title, count, accent, children,
}: { title: string; count: number; accent: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[10px] font-mono uppercase tracking-[0.22em]" style={{ color: accent }}>
          {title}
        </span>
        <span className="text-[10px] font-mono text-[#555]">({count})</span>
      </div>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}
      >
        {children}
      </div>
    </section>
  );
}

function BadgeTile({ badge, state }: { badge: BadgeEarned; state: 'earned' | 'locked' }) {
  const unlock = BADGE_UNLOCK[badge.slug] ?? badge.description ?? '';
  const icon = BADGE_ICONS[badge.slug] || (state === 'locked' ? '🔒' : '🏷️');
  const isEarned = state === 'earned';

  return (
    <div
      className="relative group flex flex-col items-center gap-1.5 p-2 rounded-lg cursor-default transition-all"
      style={{
        background: isEarned ? 'rgba(0,255,136,0.04)' : '#0e0e0e',
        border: isEarned ? '1px solid rgba(0,255,136,0.22)' : '1px solid #1a1a1a',
      }}
    >
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl transition-transform group-hover:scale-110"
        style={{
          background: isEarned
            ? 'linear-gradient(135deg, rgba(0,255,136,0.18), rgba(0,255,136,0.04))'
            : '#141414',
          border: isEarned ? '1.5px solid rgba(0,255,136,0.4)' : '1px solid #222',
          boxShadow: isEarned ? '0 0 12px rgba(0,255,136,0.25)' : 'none',
          filter: isEarned ? 'none' : 'grayscale(1) brightness(0.55)',
        }}
      >
        {badge.imageUrl
          ? <BadgeMedia url={badge.imageUrl} alt={badge.name} className="w-10 h-10" />
          : icon
        }
      </div>
      <div
        className="text-center text-[10px] font-mono font-bold leading-tight w-full truncate"
        style={{ color: isEarned ? '#e0e0e0' : '#666' }}
      >
        {badge.name}
      </div>
      <div
        className="text-center text-[9px] font-mono leading-tight w-full truncate"
        style={{ color: isEarned ? '#00ff88' : '#555' }}
        title={unlock}
      >
        {isEarned ? '✓ Unlocked' : unlock || 'Locked'}
      </div>
    </div>
  );
}
