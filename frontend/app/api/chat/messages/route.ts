import { NextRequest, NextResponse } from "next/server";
import { kv, KEYS } from "@/lib/redis";

const MAX_MESSAGES = 200;
const MAX_TEXT_LENGTH = 200;

interface ChatMsg {
  id: string;
  username: string;
  address: string;
  color: string;
  text: string;
  timestamp: number;
}

// GET /api/chat/messages?after=<timestamp>&limit=<n>
export async function GET(req: NextRequest) {
  const after = Number(req.nextUrl.searchParams.get("after") || "0");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "50"), 100);

  const messages = await kv.lrange<ChatMsg>(KEYS.chatMessages, 0, MAX_MESSAGES - 1);

  // Filter messages after timestamp if provided
  const filtered = after > 0
    ? messages.filter((m) => m.timestamp > after)
    : messages;

  // Messages are stored newest-first, reverse for chronological order
  return NextResponse.json({ messages: filtered.slice(0, limit).reverse() });
}

// POST /api/chat/messages
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, address } = body as { text?: string; address?: string };

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    const cleanText = text.trim().slice(0, MAX_TEXT_LENGTH);
    const username = address
      ? `${address.slice(0, 6)}...${address.slice(-4)}`
      : "anon";

    // Deterministic color from address
    let hash = 0;
    const seed = address || "anon";
    for (let i = 0; i < seed.length; i++) {
      hash = seed.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    const color = `hsl(${hue}, 70%, 60%)`;

    const msg: ChatMsg = {
      id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      username,
      address: address || "",
      color,
      text: cleanText,
      timestamp: Date.now(),
    };

    // Push to front of list (newest first)
    await kv.lpush(KEYS.chatMessages, JSON.stringify(msg));
    // Trim to max
    await kv.ltrim(KEYS.chatMessages, 0, MAX_MESSAGES - 1);

    // Update online status
    if (address) {
      await kv.zadd(KEYS.chatOnline, Date.now(), address.toLowerCase());
    }

    return NextResponse.json({ ok: true, message: msg });
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
}
