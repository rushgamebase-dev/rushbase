'use client';

import Link from 'next/link';
import { useIdentity } from '../../hooks/useIdentity';
import { Avatar } from '../profile/Avatar';
import { shortenAddress } from '../../lib/format';
import { getLevelTier } from '../../lib/progression';

type Size = 'xs' | 'sm' | 'md';

interface IdentityChipProps {
  address: string;
  size?: Size;
  /** Override the linked route. Pass `false` to render as plain text. */
  linkTo?: string | false;
  /** Show level tag next to name when level > 1 */
  showLevel?: boolean;
  /** Custom classes on the wrapper */
  className?: string;
}

const SIZE_PRESETS: Record<Size, { avatar: number; text: string; levelText: string; gap: string }> = {
  xs: { avatar: 16, text: 'text-xs',    levelText: 'text-[9px]',  gap: 'gap-1' },
  sm: { avatar: 22, text: 'text-sm',    levelText: 'text-[10px]', gap: 'gap-1.5' },
  md: { avatar: 30, text: 'text-base',  levelText: 'text-[11px]', gap: 'gap-2' },
};

export function IdentityChip({
  address,
  size = 'sm',
  linkTo,
  showLevel = true,
  className = '',
}: IdentityChipProps) {
  const { data } = useIdentity(address);
  const preset = SIZE_PRESETS[size];

  const displayed = data?.displayName
    || (data?.handle ? `@${data.handle}` : shortenAddress(address, 4));

  const level = data?.level ?? null;
  const tier = level && level > 1 ? getLevelTier(level) : null;

  const body = (
    <span
      className={`inline-flex items-center ${preset.gap} font-mono ${preset.text} ${className}`}
    >
      <Avatar address={address} avatarUrl={data?.avatarUrl} size={preset.avatar} />
      <span className="text-[#e0e0e0] truncate max-w-[16ch]">{displayed}</span>
      {showLevel && tier && (
        <span
          className={`${preset.levelText} font-bold px-1 py-0.5 rounded leading-none shrink-0`}
          style={{
            background: `${tier.color}14`,
            color: tier.color,
            border: `1px solid ${tier.color}33`,
          }}
        >
          Lv{level}
        </span>
      )}
    </span>
  );

  if (linkTo === false) return body;

  const href = linkTo ?? `/profile/${address}`;
  return (
    <Link href={href} className="hover:underline hover:brightness-110 transition-[filter]">
      {body}
    </Link>
  );
}
