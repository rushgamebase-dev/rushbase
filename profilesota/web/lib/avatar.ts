/**
 * Generate a deterministic seed from an Ethereum address
 * for jazzicon rendering.
 */
export function jazziconSeed(address: string): number {
  const addr = address.slice(2, 10); // first 4 bytes after 0x
  return parseInt(addr, 16);
}

/**
 * Generate a deterministic HSL color from an address.
 * Used as fallback when no avatar is set.
 */
export function colorFromAddress(address: string): string {
  let hash = 0;
  const seed = address || '0x0000';
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Resolve the avatar source for a user.
 * Returns the CDN URL if available, null for jazzicon fallback.
 */
export function getAvatarSrc(
  avatarUrl: string | null | undefined,
): string | null {
  if (avatarUrl && avatarUrl.startsWith('http')) {
    return avatarUrl;
  }
  return null;
}
