'use client';

import { Avatar } from '../profile/Avatar';
import { shortenAddress } from '../../lib/format';

interface ChatIdentityProps { address: string; handle?: string | null; displayName?: string | null; avatarUrl?: string | null; level?: number; labelColor?: string | null; size?: 'sm' | 'md'; }

export function ChatIdentity({ address, handle, displayName, avatarUrl, level, labelColor, size = 'sm' }: ChatIdentityProps) {
  const avatarSize = size === 'sm' ? 24 : 32;
  const name = displayName || (handle ? `@${handle}` : shortenAddress(address));
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar address={address} avatarUrl={avatarUrl} size={avatarSize} />
      <span className="text-sm font-mono font-medium" style={{ color: labelColor || '#e0e0e0' }}>{name}</span>
      {level && level > 1 && <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88]">{level}</span>}
    </span>
  );
}
