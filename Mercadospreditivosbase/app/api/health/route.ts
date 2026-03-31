import { NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";

export const dynamic = "force-dynamic";

const VERSION = process.env.npm_package_version ?? "0.1.0";

export async function GET() {
  const start = Date.now();
  let redisOk = false;
  let ablyOk = false;
  let marketsCount = 0;

  // Check Redis
  try {
    await kv.set(KEYS.healthPing, String(Date.now()), { ex: 30 });
    const pong = await kv.get(KEYS.healthPing);
    redisOk = pong !== null;
  } catch {
    redisOk = false;
  }

  // Check market count
  try {
    marketsCount = await kv.zcard(KEYS.markets);
  } catch {
    marketsCount = 0;
  }

  // Check Ably (just verify the env key is set — don't make a network call on health check)
  ablyOk = Boolean(process.env.ABLY_API_KEY);

  const latencyMs = Date.now() - start;

  let status: "ok" | "degraded" | "down";
  if (redisOk && ablyOk) {
    status = "ok";
  } else if (!redisOk && !ablyOk) {
    status = "down";
  } else {
    status = "degraded";
  }

  return NextResponse.json({
    status,
    redis: redisOk,
    ably: ablyOk,
    markets: marketsCount,
    serverTime: Date.now(),
    latencyMs,
    version: VERSION,
  });
}
