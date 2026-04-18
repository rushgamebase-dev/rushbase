import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Rush Profile';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const BACKEND =
  process.env.NEXT_PUBLIC_PROFILE_API_URL || 'https://rush-profiles.onrender.com';
const SITE = 'https://www.rushgame.vip';

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function seed8(address: string): number {
  const hex = (address || '0x00000000').slice(2, 10);
  return parseInt(hex, 16) || 0;
}

function defaultAvatar(address: string): string {
  return `${SITE}/avatars/rush-${seed8(address) % 8}.webp`;
}

function levelForXp(xp: number): number {
  if (xp <= 0) return 1;
  return Math.max(1, Math.floor(Math.pow(xp / 100, 2 / 3)));
}

function formatEth(v: any): string {
  const n = parseFloat(String(v ?? 0));
  if (!isFinite(n) || n === 0) return '0';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

function formatPnl(v: any): { text: string; color: string } {
  const n = parseFloat(String(v ?? 0));
  if (!isFinite(n) || n === 0) return { text: '0 ETH', color: '#888' };
  const sign = n > 0 ? '+' : '−';
  const abs = Math.abs(n);
  const short = abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : abs >= 1 ? abs.toFixed(2) : abs.toFixed(4);
  return { text: `${sign}${short} ETH`, color: n > 0 ? '#00ff88' : '#ff4444' };
}

export default async function Image({ params }: { params: { address: string } }) {
  const addr = (params.address || '').toLowerCase();

  let profile: any = null;
  try {
    const res = await fetch(`${BACKEND}/users/address/${addr}`, { cache: 'no-store' });
    if (res.ok) profile = await res.json();
  } catch {
    /* fall through — render fallback card */
  }

  const handle = profile?.profile?.handle as string | undefined;
  const displayName = profile?.profile?.displayName as string | undefined;
  const name = displayName || (handle ? `@${handle}` : shortAddr(addr));
  const tagline = displayName && handle ? `@${handle}` : shortAddr(addr);

  const xp = Number(profile?.stats?.xp ?? 0);
  const level = levelForXp(xp);
  const totalBets = Number(profile?.stats?.totalBets ?? 0);
  const totalWins = Number(profile?.stats?.totalWins ?? 0);
  const totalLosses = Number(profile?.stats?.totalLosses ?? 0);
  const winRate = totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0;
  const totalVolume = profile?.stats?.totalVolume ?? '0';
  const totalPnl = profile?.stats?.totalPnl ?? '0';

  const avatar = (profile?.profile?.avatarUrl as string | undefined) || defaultAvatar(addr);
  const wrColor = totalBets === 0 ? '#666' : winRate >= 0.6 ? '#00ff88' : winRate >= 0.4 ? '#e0e0e0' : '#ff4444';
  const pnl = formatPnl(totalPnl);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background:
            'radial-gradient(800px circle at 12% 8%, rgba(0,255,136,0.18), transparent 55%),' +
            'radial-gradient(700px circle at 100% 100%, rgba(0,255,136,0.10), transparent 55%),' +
            '#0a0a0a',
          color: '#e0e0e0',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          padding: '56px 64px',
          boxSizing: 'border-box',
        }}
      >
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              fontSize: 28,
              fontWeight: 900,
              letterSpacing: 2,
              color: '#00ff88',
            }}
          >
            <div
              style={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: '#00ff88',
                boxShadow: '0 0 16px #00ff88',
              }}
            />
            RUSH · PROFILE
          </div>
          <div style={{ fontSize: 24, color: '#666', letterSpacing: 4 }}>RUSHGAME.VIP</div>
        </div>

        {/* Identity block */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 56, marginTop: 54, flex: 1 }}>
          <img
            src={avatar}
            width={260}
            height={260}
            style={{
              width: 260,
              height: 260,
              borderRadius: '50%',
              border: '6px solid #00ff88',
              boxShadow: '0 0 40px rgba(0,255,136,0.35)',
              objectFit: 'cover',
              background: '#0a0a0a',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 88,
                fontWeight: 900,
                lineHeight: 1,
                color: '#ffffff',
                letterSpacing: -2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {name}
            </div>
            <div style={{ fontSize: 26, color: '#888', marginTop: 14, letterSpacing: 1 }}>{tagline}</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                marginTop: 22,
                fontSize: 22,
              }}
            >
              <div
                style={{
                  padding: '8px 18px',
                  borderRadius: 8,
                  color: '#00ff88',
                  background: 'rgba(0,255,136,0.08)',
                  border: '2px solid rgba(0,255,136,0.4)',
                  fontWeight: 900,
                  letterSpacing: 2,
                }}
              >
                LV {level}
              </div>
              <div style={{ color: '#666' }}>·</div>
              <div style={{ color: '#aaa' }}>{totalBets.toLocaleString()} bets</div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            gap: 48,
            paddingTop: 36,
            borderTop: '1px solid #1a1a1a',
          }}
        >
          <Stat label="WIN RATE" value={`${Math.round(winRate * 100)}%`} sub={`${totalWins}W / ${totalLosses}L`} color={wrColor} />
          <Stat label="VOLUME" value={`${formatEth(totalVolume)} ETH`} sub="wagered" color="#e0e0e0" />
          <Stat label="ALL-TIME P&L" value={pnl.text} sub=" " color={pnl.color} />
        </div>
      </div>
    ),
    size,
  );
}

function Stat({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ fontSize: 18, color: '#666', letterSpacing: 4, fontWeight: 700 }}>{label}</div>
      <div
        style={{
          fontSize: 62,
          fontWeight: 900,
          color,
          marginTop: 6,
          letterSpacing: -1,
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub.trim() && <div style={{ fontSize: 18, color: '#555', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}
