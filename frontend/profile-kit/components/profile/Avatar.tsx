'use client';

import { getAvatarSrc, getDefaultAvatar } from '../../lib/avatar';

interface AvatarProps { address: string; avatarUrl?: string | null; size?: number; className?: string; }

export function Avatar({ address, avatarUrl, size = 40, className = '' }: AvatarProps) {
  const src = getAvatarSrc(avatarUrl) ?? getDefaultAvatar(address);
  return (
    <img
      src={src}
      alt="avatar"
      width={size}
      height={size}
      className={`rounded-full object-cover bg-[#0a0a0a] ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
