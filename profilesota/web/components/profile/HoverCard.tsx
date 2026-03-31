'use client';

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useProfile } from '../../hooks/useProfile';
import { Avatar } from './Avatar';
import { UserLabel } from './UserLabel';
import { shortenAddress, displayName, formatWinRate, formatNumber } from '../../lib/format';
import type { Address } from '../../types/profile';

interface HoverCardProps {
  /** Wallet address to resolve profile for */
  address: Address;
  /** The trigger element that activates the hover card */
  children: ReactNode;
}

/**
 * Shows a mini profile card on hover over the trigger element.
 * Uses a portal-free approach with absolute positioning + collision detection.
 *
 * If @radix-ui/react-hover-card is installed, swap the internals to use it
 * for better portal/collision handling. This implementation works without
 * extra dependencies.
 */
export function HoverCard({ address, children }: HoverCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<'bottom' | 'top'>('bottom');
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  const triggerRef = useRef<HTMLDivElement>(null);

  const { data: profile, isLoading } = useProfile(isOpen ? address : undefined);

  const handleEnter = () => {
    clearTimeout(closeTimer.current);
    openTimer.current = setTimeout(() => {
      // Collision detection: check if card would overflow bottom
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setPosition(spaceBelow < 200 ? 'top' : 'bottom');
      }
      setIsOpen(true);
    }, 300);
  };

  const handleLeave = () => {
    clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setIsOpen(false), 200);
  };

  useEffect(() => {
    return () => {
      clearTimeout(openTimer.current);
      clearTimeout(closeTimer.current);
    };
  }, []);

  const name = profile
    ? displayName(
        { handle: profile.profile?.handle, displayName: profile.profile?.displayName, wallet: profile.wallet },
        profile.wallet,
      )
    : shortenAddress(address);

  return (
    <div
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children}

      {isOpen && (
        <div
          className={`absolute z-50 w-72 bg-[#111111] border border-[#1a1a1a] rounded-xl shadow-2xl p-4 animate-[fadeInUp_0.15s_ease-out] ${
            position === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
          style={{ left: '50%', transform: 'translateX(-50%)' }}
          onMouseEnter={() => clearTimeout(closeTimer.current)}
          onMouseLeave={handleLeave}
        >
          {isLoading || !profile ? (
            // Skeleton
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#1a1a1a] animate-pulse" />
                <div className="flex-1 space-y-1">
                  <div className="h-4 w-24 bg-[#1a1a1a] rounded animate-pulse" />
                  <div className="h-3 w-16 bg-[#1a1a1a] rounded animate-pulse" />
                </div>
              </div>
              <div className="h-3 w-full bg-[#1a1a1a] rounded animate-pulse" />
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center gap-3 mb-3">
                <Avatar
                  address={profile.wallet}
                  avatarUrl={profile.profile?.avatarUrl}
                  size={40}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-mono font-medium text-[#e0e0e0] truncate">
                      {name}
                    </span>
                    {profile.stats && (
                      <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[#00ff88]/10 text-[#00ff88]">
                        {profile.stats.level}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-[#666666]">
                    {shortenAddress(profile.wallet, 6)}
                  </div>
                  {profile.labels.length > 0 && (
                    <div className="flex gap-1 mt-0.5">
                      {profile.labels.slice(0, 2).map((l) => (
                        <UserLabel key={l.label} label={l} size="sm" />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Stats line */}
              {profile.stats && (
                <div className="text-[10px] font-mono text-[#666666] flex items-center gap-2 border-t border-[#1a1a1a] pt-2">
                  <span>
                    <span className="text-[#e0e0e0]">{formatWinRate(profile.stats.winRate)}</span> WR
                  </span>
                  <span className="text-[#1a1a1a]">|</span>
                  <span>
                    <span className="text-[#e0e0e0]">{formatNumber(profile.stats.totalBets)}</span> bets
                  </span>
                  <span className="text-[#1a1a1a]">|</span>
                  <span>
                    Lv <span className="text-[#e0e0e0]">{profile.stats.level}</span>
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
