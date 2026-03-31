import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { getClientIp, validateAddress, sanitizeText } from "@/lib/api-auth";
import { publishEvent } from "@/lib/ably-server";
import { CHANNELS } from "@/lib/ably";

export const dynamic = "force-dynamic";

interface ChatMessage {
  id: string;
  text: string;
  address: string | null;
  timestamp: number;
}

const CHAT_EVENT = "chat_message";

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  // High-frequency read: 120 req/min
  const rl = await rateLimit(ip, "chat-get", 120, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const after = Number(searchParams.get("after") ?? "0");
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));

    const messages = await kv.lrange<ChatMessage>(KEYS.chatMessages, 0, limit - 1);

    const filtered = after > 0
      ? messages.filter((m) => m.timestamp > after)
      : messages;

    return NextResponse.json(
      { messages: filtered },
      { headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[GET /api/chat/messages]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // Rate-limited: 5 req/min per IP
  const rl = await rateLimit(ip, "chat-post", 5, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: rateLimitHeaders(rl) }
    );
  }

  let body: { text?: unknown; address?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawText = typeof body.text === "string" ? body.text : "";
  const rawAddr = typeof body.address === "string" ? body.address : null;

  const text = sanitizeText(rawText, 500);
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  // Validate address if provided
  const address = rawAddr
    ? validateAddress(rawAddr)
      ? rawAddr.toLowerCase()
      : null
    : null;

  try {
    const message: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      address,
      timestamp: Date.now(),
    };

    // Push to list and keep max 200 messages
    await kv.lpush(KEYS.chatMessages, message as unknown as string);
    await kv.ltrim(KEYS.chatMessages, 0, 199);

    // Broadcast via Ably (non-blocking)
    void publishEvent(CHANNELS.BETS, CHAT_EVENT, message);

    return NextResponse.json(
      { ok: true, message },
      { status: 201, headers: rateLimitHeaders(rl) }
    );
  } catch (err) {
    console.error("[POST /api/chat/messages]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
