export function shortenAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatVolume(ethValue: string): string {
  const num = parseFloat(ethValue);
  if (isNaN(num)) return '0 ETH';
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k ETH`;
  if (num >= 1) return `${num.toFixed(2)} ETH`;
  if (num >= 0.01) return `${num.toFixed(3)} ETH`;
  return `${num.toFixed(4)} ETH`;
}

export function formatPnl(ethValue: string): { text: string; isPositive: boolean } {
  const num = parseFloat(ethValue);
  if (isNaN(num)) return { text: '0 ETH', isPositive: true };
  const sign = num >= 0 ? '+' : '';
  return { text: `${sign}${formatVolume(ethValue.replace('-', ''))}`, isPositive: num >= 0 };
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
