'use client';

import type { BadgeEarned } from '../../types/profile';

const BADGE_ICONS: Record<string, string> = {
  'first-bet': '🎯', 'ten-bets': '🎲', 'fifty-bets': '📊', 'hundred-bets': '💯',
  'five-hundred-bets': '🏆', 'first-win': '🏅', 'ten-wins': '🔥', 'fifty-wins': '🎖️',
  'streak-3': '⚡', 'streak-5': '🔥', 'streak-10': '💎', 'high-roller': '🎰',
  'whale': '🐋', 'diamond-hands': '💎', 'beta-tester': '🧪', 'early-player': '🌱',
  'verified': '✅', 'founder': '⭐',
};

const BORDER = '#1a1a1a';
const BG = 'rgba(0,255,136,0.06)';
const GLOW = '0 0 6px rgba(0,255,136,0.15)';

interface ProfileBadgesProps { badges: BadgeEarned[]; layout?: 'grid' | 'row'; maxVisible?: number; showLocked?: boolean; }

export function ProfileBadges({ badges, layout = 'grid', maxVisible, showLocked = false }: ProfileBadgesProps) {
  const visible = showLocked ? badges : badges.filter((b) => b.isEarned !== false);
  const displayed = maxVisible ? visible.slice(0, maxVisible) : visible;
  const overflow = maxVisible && visible.length > maxVisible ? visible.length - maxVisible : 0;

  if (layout === 'row') {
    return (
      <div className="flex items-center gap-1.5">
        {displayed.map((badge) => {
          const isLocked = badge.isEarned === false;
          return (
            <div key={badge.slug} className={`w-6 h-6 rounded flex items-center justify-center text-sm ${isLocked ? 'opacity-30 grayscale' : ''}`}
              style={{ border: `1px solid ${BORDER}`, backgroundColor: BG, boxShadow: isLocked ? 'none' : GLOW }}
              title={`${badge.name}${isLocked ? ' (Locked)' : ''}`}>
              {badge.imageUrl ? <img src={badge.imageUrl} alt={badge.name} className="w-4 h-4" /> : <span className="text-xs">{BADGE_ICONS[badge.slug] || '🏷️'}</span>}
            </div>
          );
        })}
        {overflow > 0 && <span className="text-[10px] font-mono text-[#666666] ml-1">+{overflow}</span>}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
      {displayed.map((badge) => {
        const isLocked = badge.isEarned === false;
        return (
          <div key={badge.slug} className={`flex flex-col items-center gap-1 group cursor-default ${isLocked ? 'opacity-30 grayscale' : ''}`}>
            <div className="w-12 h-12 rounded-lg flex items-center justify-center text-xl transition-transform group-hover:scale-110"
              style={{ border: `2px solid ${BORDER}`, backgroundColor: BG, boxShadow: isLocked ? 'none' : GLOW }}>
              {badge.imageUrl ? <img src={badge.imageUrl} alt={badge.name} className="w-8 h-8" /> : BADGE_ICONS[badge.slug] || '🏷️'}
            </div>
            <span className="text-[10px] font-mono text-center text-[#666666] group-hover:text-[#e0e0e0] transition-colors leading-tight">{badge.name}</span>
          </div>
        );
      })}
    </div>
  );
}
