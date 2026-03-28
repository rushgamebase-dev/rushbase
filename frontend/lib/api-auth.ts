import { NextRequest } from "next/server";

/**
 * Check the x-api-key header against the LEDGER_API_KEY env var.
 * Returns true if the key matches OR if no key is configured (dev mode).
 */
export function requireApiKey(req: NextRequest): boolean {
  const expectedKey = process.env.LEDGER_API_KEY;
  // Dev mode: if no key is configured, allow all requests
  if (!expectedKey) return true;
  const provided = req.headers.get("x-api-key");
  return provided === expectedKey;
}

/**
 * Extract the client IP from standard proxy headers.
 * Vercel sets x-forwarded-for automatically.
 */
export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    // x-forwarded-for can contain multiple IPs; the first is the client
    const first = xff.split(",")[0].trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

/**
 * Validate an Ethereum address: 0x followed by exactly 40 hex characters.
 */
export function validateAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Sanitize user-provided text: trim whitespace, remove control characters,
 * and enforce a maximum length.
 */
export function sanitizeText(text: string, maxLength: number): string {
  // Remove control characters (C0 and C1) except newline and tab
  // eslint-disable-next-line no-control-regex
  const cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");
  return cleaned.trim().slice(0, maxLength);
}
