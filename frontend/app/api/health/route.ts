import { NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";

export const dynamic = "force-dynamic";

const startTime = Date.now();

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSec}s`;
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
  return `${Math.floor(ms / 3_600_000)}h`;
}

// GET /api/health
export async function GET() {
  let redisOk = false;
  let oracleUrl: string | null = null;
  let lastRound: { timestamp: number; count: number; ago: string } | null = null;

  // Check Redis connectivity
  try {
    // Attempt a simple read to verify connectivity
    await kv.get<string>("health:ping");
    redisOk = true;
  } catch {
    redisOk = false;
  }

  // Check oracle URL
  if (redisOk) {
    try {
      const url = await kv.get<string>("oracle:ws_url");
      oracleUrl = url || null;
    } catch {
      // ignore
    }
  }

  // Check last round
  if (redisOk) {
    try {
      const raw = await kv.lrange<string>(KEYS.roundsHistory, 0, 0);
      if (raw.length > 0) {
        const entry = typeof raw[0] === "string" ? JSON.parse(raw[0]) : raw[0];
        if (entry && entry.resolvedAt) {
          const ts = typeof entry.resolvedAt === "number" ? entry.resolvedAt : Date.now();
          lastRound = {
            timestamp: ts,
            count: entry.actualCount ?? 0,
            ago: formatAgo(Date.now() - ts),
          };
        }
      }
    } catch {
      // ignore
    }
  }

  // Determine overall status
  let status: "ok" | "degraded" | "down";
  if (!redisOk) {
    status = "down";
  } else if (!oracleUrl) {
    status = "degraded";
  } else {
    status = "ok";
  }

  const uptimeMs = Date.now() - startTime;

  return NextResponse.json({
    status,
    redis: redisOk,
    oracleUrl,
    lastRound,
    uptime: formatDuration(uptimeMs),
    version: "1.0.0",
  });
}
