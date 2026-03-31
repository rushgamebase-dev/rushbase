'use client';

import type { BadgeEarned, BadgeRarity } from '../../types/profile';

const RARITY_STYLES: Record<BadgeRarity, { border: string; glow: string; bg: string }> = {
  COMMON:    { border: '#666666', glow: 'none', bg: 'rgba(102,102,102,0.08)' },
  UNCOMMON:  { border: '#00ff88', glow: '0 0 6px rgba(0,255,136,0.2)', bg: 'rgba(0,255,136,0.06)' },
  RARE:      { border: '#3b82f6', glow: '0 0 6px rgba(59,130,246,0.3)', bg: 'rgba(59,130,246,0.06)' },
  EPIC:      { border: '#a855f7', glow: '0 0 8px rgba(168,85,247,0.3)', bg: 'rgba(168,85,247,0.06)' },
  LEGENDARY: { border: '#ffd700', glow: '0 0 10px rgba(255,215,0,0.4)', bg: 'rgba(255,215,0,0.08)' },
};

// Emoji icons by badge slug — fallback if no imageUrl
const BADGE_ICONS: Record<string, string> = {
  'first-bet': '🎯',
  'ten-bets': '🎲',
  'fifty-bets': '📊',
  'hundred-bets': '💯',
  'five-hundred-bets': '🏆',
  'first-win': '🏅',
  'ten-wins': '🔥',
  'fifty-wins': '🎖️',
  'streak-3': '⚡',
  'streak-5': '🔥',
  'streak-10': '💎',
  'high-roller': '🎰',
  'whale': '🐋',
  'diamond-hands': '💎',
  'beta-tester': '🧪',
  'early-player': '🌱',
  'verified': '✅',
  'founder': '⭐',
};

interface ProfileBadgesProps {
  badges: BadgeEarned[];
  layout?: 'grid' | 'row';
  maxVisible?: number;
  showLocked?: boolean;
}

export function ProfileBadges({
  badges,
  layout = 'grid',
  maxVisible,
  showLocked = false,
}: ProfileBadgesProps) {
  const visible = showLocked
    ? badges
    : badges.filter((b) => b.isEarned !== false);

  const displayed = maxVisible ? visible.slice(0, maxVisible) : visible;
  const overflow = maxVisible && visible.length > maxVisible ? visible.length - maxVisible : 0;

  if (layout === 'row') {
    return (
      <div className="flex items-center gap-1.5">
        {displayed.map((badge) => {
          const style = RARITY_STYLES[badge.rarity];
          const isLocked = badge.isEarned === false;
          return (
            <div
              key={badge.slug}
              className={`w-6 h-6 rounded flex items-center justify-center text-sm ${
                isLocked ? 'opacity-30 grayscale' : ''
              }`}
              style={{
                border: `1px solid ${style.border}`,
                backgroundColor: style.bg,
                boxShadow: isLocked ? 'none' : style.glow,
              }}
              title={`${badge.name}${isLocked ? ' (Locked)' : ''}`}
            >
              {badge.imageUrl ? (
                <img src={badge.imageUrl} alt={badge.name} className="w-4 h-4" />
              ) : (
                <span className="text-xs">{BADGE_ICONS[badge.slug] || '🏷️'}</span>
              )}
            </div>
          );
        })}
        {overflow > 0 && (
          <span className="text-[10px] font-mono text-[#666666] ml-1">
            +{overflow}
          </span>
        )}
      </div>
    );
  }

  // Grid layout
  return (
    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
      {displayed.map((badge) => {
        const style = RARITY_STYLES[badge.rarity];
        const isLocked = badge.isEarned === false;
        return (
          <div
            key={badge.slug}
            className={`flex flex-col items-center gap-1 group cursor-default ${
              isLocked ? 'opacity-30 grayscale' : ''
            }`}
          >
            <div
              className="w-12 h-12 rounded-lg flex items-center justify-center text-xl transition-transform group-hover:scale-110"
              style={{
                border: `2px solid ${style.border}`,
                backgroundColor: style.bg,
                boxShadow: isLocked ? 'none' : style.glow,
              }}
            >
              {badge.imageUrl ? (
                <img src={badge.imageUrl} alt={badge.name} className="w-8 h-8" />
              ) : (
                BADGE_ICONS[badge.slug] || '🏷️'
              )}
            </div>
            <span className="text-[10px] font-mono text-center text-[#666666] group-hover:text-[#e0e0e0] transition-colors leading-tight">
              {badge.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
