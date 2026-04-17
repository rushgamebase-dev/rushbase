'use client';

interface XPBarProps { level: number; currentXp: number; xpToNextLevel: number; variant?: 'full' | 'compact'; }

export function XPBar({ level, currentXp, xpToNextLevel, variant = 'full' }: XPBarProps) {
  const totalForNext = currentXp + xpToNextLevel;
  const progress = totalForNext > 0 ? (currentXp / totalForNext) * 100 : 0;
  const isNearLevelUp = progress > 90;

  if (variant === 'compact') {
    return (
      <div className="w-full">
        <div className="text-[10px] font-mono text-muted mb-0.5">Lv {level}</div>
        <div className="h-1 w-full rounded-full bg-[#1a1a1a] overflow-hidden">
          <div className="h-full rounded-full bg-primary transition-all duration-700 ease-out" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex items-center gap-3">
      <span className="text-sm font-mono font-bold text-primary whitespace-nowrap">Lv {level}</span>
      <div className="flex-1 h-2 rounded-full bg-[#1a1a1a] overflow-hidden relative">
        <div className={`h-full rounded-full bg-primary transition-all duration-700 ease-out ${isNearLevelUp ? 'shadow-[0_0_8px_rgba(0,255,136,0.6)]' : ''}`}
          style={{ width: `${Math.min(progress, 100)}%` }} />
      </div>
      <span className="text-xs font-mono text-muted whitespace-nowrap">{currentXp.toLocaleString()} / {totalForNext.toLocaleString()} XP</span>
    </div>
  );
}
