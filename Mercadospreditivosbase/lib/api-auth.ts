import { NextRequest } from "next/server";

export function requireApiKey(req: NextRequest): boolean {
  const expectedKey = process.env.API_KEY;
  if (!expectedKey) return true; // dev mode
  return req.headers.get("x-api-key") === expectedKey;
}

export function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

export function validateAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

export function sanitizeText(text: string, maxLength: number = 200): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "").trim().slice(0, maxLength);
}
