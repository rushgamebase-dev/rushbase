'use client';

import { jazziconSeed, getAvatarSrc } from '../../lib/avatar';

interface AvatarProps { address: string; avatarUrl?: string | null; size?: number; className?: string; }

export function Avatar({ address, avatarUrl, size = 40, className = '' }: AvatarProps) {
  const src = getAvatarSrc(avatarUrl);
  if (src) {
    return <img src={src} alt="avatar" width={size} height={size} className={`rounded-full object-cover ${className}`} style={{ width: size, height: size }} />;
  }
  const seed = jazziconSeed(address || '0x00000000');
  const hue1 = seed % 360;
  const hue2 = (seed * 7 + 137) % 360;
  return (
    <div className={`rounded-full flex items-center justify-center font-mono font-bold text-black ${className}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue1}, 70%, 60%), hsl(${hue2}, 70%, 50%))`, fontSize: size * 0.35 }}>
      {(address || '0x').slice(2, 4).toUpperCase()}
    </div>
  );
}
