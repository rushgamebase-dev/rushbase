export function shortenAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

function compactEth(absNum: number): string {
  if (absNum >= 1_000_000) return `${(absNum / 1_000_000).toFixed(1)}M`;
  if (absNum >= 1_000) return `${(absNum / 1_000).toFixed(1)}k`;
  if (absNum >= 100) return absNum.toFixed(0);
  if (absNum >= 1) return absNum.toFixed(2);
  if (absNum >= 0.01) return absNum.toFixed(3);
  return absNum.toFixed(4);
}

export function formatVolume(ethValue: string): string {
  const num = parseFloat(ethValue);
  if (isNaN(num)) return '0 ETH';
  return `${compactEth(Math.abs(num))} ETH`;
}

export function formatPnl(ethValue: string): { text: string; isPositive: boolean; isZero: boolean } {
  const num = parseFloat(ethValue);
  if (isNaN(num) || num === 0) return { text: '0 ETH', isPositive: true, isZero: true };
  const sign = num > 0 ? '+' : '−';
  return { text: `${sign}${compactEth(Math.abs(num))} ETH`, isPositive: num > 0, isZero: false };
}

export function formatWinRate(rate: number): string {
  if (isNaN(rate)) return '0%';
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatRelativeTime(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  if (secs < 2592000) return `${Math.floor(secs / 604800)}w ago`;
  return new Date(iso).toLocaleDateString();
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function displayName(profile: { handle?: string | null; displayName?: string | null; wallet?: string } | null, wallet?: string): string {
  if (profile?.displayName) return profile.displayName;
  if (profile?.handle) return `@${profile.handle}`;
  const addr = profile?.wallet || wallet;
  return addr ? shortenAddress(addr) : 'Anonymous';
}
