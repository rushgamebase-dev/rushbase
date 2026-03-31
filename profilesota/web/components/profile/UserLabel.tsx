'use client';

import type { UserLabelData } from '../../types/profile';

const LABEL_STYLES: Record<string, { bg: string; text: string; icon: string }> = {
  admin:        { bg: 'rgba(255,68,68,0.1)',   text: '#ff4444', icon: '🛡️' },
  mod:          { bg: 'rgba(168,85,247,0.1)',  text: '#a855f7', icon: '🔰' },
  whale:        { bg: 'rgba(59,130,246,0.1)',  text: '#3b82f6', icon: '🐋' },
  beta_tester:  { bg: 'rgba(0,255,136,0.1)',   text: '#00ff88', icon: '🧪' },
  verified:     { bg: 'rgba(255,215,0,0.1)',   text: '#ffd700', icon: '✓' },
  founder:      { bg: 'rgba(255,215,0,0.15)',  text: '#ffd700', icon: '⭐' },
  early_player: { bg: 'rgba(0,255,136,0.08)',  text: '#00ff88', icon: '🌱' },
};

interface UserLabelProps {
  label: UserLabelData;
  size?: 'sm' | 'md';
}

export function UserLabel({ label, size = 'sm' }: UserLabelProps) {
  const style = LABEL_STYLES[label.label] || {
    bg: 'rgba(255,255,255,0.05)',
    text: label.color || '#e0e0e0',
    icon: '',
  };

  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-0.5';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-mono font-medium ${textSize} ${padding}`}
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {style.icon && <span className="text-[10px]">{style.icon}</span>}
      {label.label.replace('_', ' ')}
    </span>
  );
}
