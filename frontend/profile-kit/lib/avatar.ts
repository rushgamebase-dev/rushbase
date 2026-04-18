export function jazziconSeed(address: string): number {
  const addr = address.slice(2, 10);
  return parseInt(addr, 16);
}

export function colorFromAddress(address: string): string {
  let hash = 0;
  const seed = address || '0x0000';
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return `hsl(${Math.abs(hash % 360)}, 70%, 60%)`;
}

export function getAvatarSrc(avatarUrl: string | null | undefined): string | null {
  if (avatarUrl && avatarUrl.startsWith('http')) return avatarUrl;
  return null;
}

export function getDefaultAvatar(address: string): string {
  return `/avatars/rush-${jazziconSeed(address || '0x00000000') % 8}.webp`;
}
