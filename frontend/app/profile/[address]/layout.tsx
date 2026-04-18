import type { Metadata } from 'next';

const BACKEND =
  process.env.NEXT_PUBLIC_PROFILE_API_URL || 'https://rush-profiles.onrender.com';

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export async function generateMetadata({
  params,
}: {
  params: { address: string };
}): Promise<Metadata> {
  const addr = (params.address || '').toLowerCase();
  type ProfileShape = {
    profile?: { handle?: string; displayName?: string };
    stats?: { totalBets?: number; totalWins?: number; totalLosses?: number };
  };
  let profile: ProfileShape | null = null;
  try {
    const res = await fetch(`${BACKEND}/users/address/${addr}`, { cache: 'no-store' });
    if (res.ok) profile = (await res.json()) as ProfileShape;
  } catch {
    /* silent fallback to anonymous card */
  }

  const handle = profile?.profile?.handle;
  const displayName = profile?.profile?.displayName;
  const shown = displayName || (handle ? `@${handle}` : shortAddr(addr));
  const bets = Number(profile?.stats?.totalBets ?? 0);
  const wins = Number(profile?.stats?.totalWins ?? 0);
  const losses = Number(profile?.stats?.totalLosses ?? 0);
  const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;

  const title = `${shown} — Rush Profile`;
  const desc = bets > 0
    ? `${bets.toLocaleString()} bets · ${winRate}% win rate · Rush prediction market`
    : 'Live prediction market on Base — predict, win, verify.';

  return {
    title,
    description: desc,
    openGraph: {
      title,
      description: desc,
      type: 'profile',
      siteName: 'Rush',
      url: `https://www.rushgame.vip/profile/${addr}`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: desc,
    },
  };
}

export default function ProfileAddressLayout({ children }: { children: React.ReactNode }) {
  return children;
}
