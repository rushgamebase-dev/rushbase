"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ── Types ──
interface RoundState {
  state: string;
  count: number;
  count_in: number;
  count_out: number;
  threshold: number;
  remaining: number;
  elapsed: number;
  roundId: number;
  videoUid: string;
}

const CF_SUBDOMAIN = "customer-vn9syvcedwumw0ut.cloudflarestream.com";

// ── Sound Effects ──
function createBeep(ctx: AudioContext, freq: number, dur: number, vol: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = freq;
  osc.type = "sine";
  gain.gain.value = vol;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  osc.start();
  osc.stop(ctx.currentTime + dur);
}

// ── Component ──
export default function LiveStreamOverlay({
  wsUrl = "ws://localhost:9000",
  threshold = 50,
  videoUid: initialVideoUid = "",
}: {
  wsUrl?: string;
  threshold?: number;
  videoUid?: string;
}) {
  const [round, setRound] = useState<RoundState>({
    state: "idle",
    count: 0, count_in: 0, count_out: 0,
    threshold, remaining: 0, elapsed: 0, roundId: 0,
    videoUid: initialVideoUid,
  });
  const [connected, setConnected] = useState(false);
  const [flash, setFlash] = useState(false);
  const [pop, setPop] = useState(false);
  const [killFeed, setKillFeed] = useState<number[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const lastCountRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastTickRef = useRef(-1);

  // Audio unlock on first interaction
  const unlockAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
  }, []);

  useEffect(() => {
    const handler = () => unlockAudio();
    document.addEventListener("click", handler, { once: true });
    document.addEventListener("touchstart", handler, { once: true });
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [unlockAudio]);

  // WebSocket connection
  useEffect(() => {
    let ws: WebSocket;
    let reconnTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        reconnTimer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          handleMsg(msg);
        } catch {}
      };
    }

    function handleMsg(msg: any) {
      // Update round state
      if (msg.state) {
        setRound((prev) => ({
          ...prev,
          state: msg.state,
          count: msg.count ?? prev.count,
          count_in: msg.count_in ?? prev.count_in,
          count_out: msg.count_out ?? prev.count_out,
          threshold: msg.threshold ?? prev.threshold,
          remaining: msg.remaining ?? prev.remaining,
          elapsed: msg.elapsed ?? prev.elapsed,
          roundId: msg.roundId ?? prev.roundId,
          videoUid: msg.videoUid || prev.videoUid,
        }));
      }

      // Count increment effects
      const newCount = msg.count ?? 0;
      if (newCount > lastCountRef.current && msg.type === "count") {
        const delta = newCount - lastCountRef.current;
        // Beep
        if (audioCtxRef.current?.state === "running") {
          for (let i = 0; i < Math.min(delta, 3); i++) {
            setTimeout(() => createBeep(audioCtxRef.current!, 1200 + i * 100, 0.08, 0.12), i * 100);
          }
        }
        // Flash + pop
        setFlash(true);
        setPop(true);
        setTimeout(() => setFlash(false), 300);
        setTimeout(() => setPop(false), 200);
        // Kill feed
        const nums: number[] = [];
        for (let i = 0; i < delta; i++) nums.push(lastCountRef.current + i + 1);
        setKillFeed((prev) => [...nums, ...prev].slice(0, 6));
        lastCountRef.current = newCount;
      }

      // Countdown tick sounds (last 10s)
      if (msg.remaining !== undefined && msg.remaining <= 10 && msg.remaining > 0) {
        const sec = Math.floor(msg.remaining);
        if (sec !== lastTickRef.current && audioCtxRef.current?.state === "running") {
          lastTickRef.current = sec;
          createBeep(audioCtxRef.current, sec <= 3 ? 1400 : 800, sec <= 3 ? 0.15 : 0.08, 0.08);
        }
      }
    }

    connect();
    return () => {
      clearTimeout(reconnTimer);
      ws?.close();
    };
  }, [wsUrl]);

  // Auto-clear kill feed entries
  useEffect(() => {
    if (killFeed.length === 0) return;
    const t = setTimeout(() => setKillFeed((prev) => prev.slice(0, -1)), 2500);
    return () => clearTimeout(t);
  }, [killFeed]);

  const videoSrc = round.videoUid
    ? `https://${CF_SUBDOMAIN}/${round.videoUid}/iframe?autoplay=true&muted=true`
    : initialVideoUid
    ? `https://${CF_SUBDOMAIN}/${initialVideoUid}/iframe?autoplay=true&muted=true`
    : "";

  const pct = Math.min(100, (round.count / (round.threshold || 50)) * 100);
  const timerMin = Math.floor(round.remaining / 60);
  const timerSec = Math.floor(round.remaining % 60);
  const isUrgent = round.remaining > 0 && round.remaining <= 30;
  const timerColor = round.remaining > 120 ? "#00ff41" : round.remaining > 30 ? "#ffaa00" : "#ff3b3b";

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16/9",
        borderRadius: 12,
        overflow: "hidden",
        background: "#000",
        boxShadow: flash
          ? "inset 0 0 30px rgba(0,255,65,0.5), 0 0 20px rgba(0,255,65,0.2)"
          : "0 0 0 1px rgba(255,255,255,0.06)",
        transition: "box-shadow 0.3s",
      }}
    >
      {/* Video */}
      {videoSrc && (
        <iframe
          src={videoSrc}
          style={{ width: "100%", height: "100%", border: "none" }}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      )}

      {/* Overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "12px 16px",
          background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, transparent 18%, transparent 72%, rgba(0,0,0,0.55) 100%)",
        }}
      >
        {/* Top bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {round.state !== "idle" && (
              <>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: "#ff3b3b",
                  animation: "pulse 1.5s infinite",
                }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#ff3b3b", letterSpacing: 1.5, textTransform: "uppercase" as const }}>
                  LIVE
                </span>
              </>
            )}
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "3px 10px", borderRadius: 20,
              background: round.state === "counting" ? "rgba(0,255,65,0.12)" : "rgba(255,170,0,0.15)",
              color: round.state === "counting" ? "#00ff41" : "#ffaa00",
              border: `1px solid ${round.state === "counting" ? "rgba(0,255,65,0.3)" : "rgba(255,170,0,0.3)"}`,
              textTransform: "uppercase" as const, letterSpacing: 0.5,
            }}>
              {round.state}
            </span>
          </div>
          {/* Connection dot */}
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: connected ? "#00ff41" : "#ff3b3b",
          }} />
        </div>

        {/* Kill feed */}
        <div style={{ position: "absolute", top: 40, right: 16, display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
          {killFeed.map((n, i) => (
            <div
              key={`${n}-${i}`}
              style={{
                background: "rgba(0,255,65,0.1)",
                border: "1px solid rgba(0,255,65,0.25)",
                color: "#00ff41",
                fontSize: 12,
                fontFamily: "monospace",
                fontWeight: 700,
                padding: "2px 10px",
                borderRadius: 4,
                opacity: 1 - i * 0.15,
              }}
            >
              #{n}
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 14 }}>
          {/* Count */}
          <div style={{
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            border: pop ? "1px solid rgba(0,255,65,0.6)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "10px 16px",
            minWidth: 100,
            transition: "border-color 0.2s, transform 0.15s",
            transform: pop ? "scale(1.04)" : "scale(1)",
          }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: 1.5, fontWeight: 600 }}>
              Vehicles
            </div>
            <div style={{
              fontSize: 40, fontWeight: 900, color: "#00ff41",
              fontFamily: "monospace", lineHeight: 1,
              transform: pop ? "scale(1.12)" : "scale(1)",
              transition: "transform 0.15s",
            }}>
              {round.count}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
              in {round.count_in} / out {round.count_out}
            </div>
          </div>

          {/* Threshold bar */}
          <div style={{
            flex: 1, maxWidth: 260,
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "10px 14px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 600, marginBottom: 6 }}>
              <span style={{ color: "#00ff41" }}>UNDER {round.threshold}</span>
              <span style={{ color: "#ff6b6b" }}>OVER {round.threshold}</span>
            </div>
            <div style={{ height: 6, background: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden", position: "relative" }}>
              <div style={{
                height: "100%", borderRadius: 3,
                width: `${pct}%`,
                background: pct < 60 ? "#00ff41" : pct < 90 ? "#ffaa00" : "#ff3b3b",
                transition: "width 0.5s ease-out, background 0.5s",
              }} />
              <div style={{
                position: "absolute", top: -4, left: "50%", width: 2, height: 14,
                background: "rgba(255,255,255,0.5)", borderRadius: 1,
              }} />
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textAlign: "center", marginTop: 5, fontFamily: "monospace", fontWeight: 700 }}>
              {round.count} / {round.threshold}
            </div>
          </div>

          {/* Timer */}
          <div style={{
            background: "rgba(0,0,0,0.75)",
            backdropFilter: "blur(8px)",
            border: isUrgent ? "1px solid rgba(255,60,60,0.5)" : "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: "10px 16px",
            textAlign: "right" as const,
            minWidth: 90,
            animation: isUrgent ? "urgentPulse 0.6s infinite" : "none",
          }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", textTransform: "uppercase" as const, letterSpacing: 1.5, fontWeight: 600 }}>
              Time
            </div>
            <div style={{
              fontSize: 26, fontWeight: 700, fontFamily: "monospace",
              lineHeight: 1, color: timerColor, transition: "color 0.5s",
            }}>
              {round.remaining > 0 ? `${timerMin}:${timerSec.toString().padStart(2, "0")}` : "--:--"}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes urgentPulse { 50% { border-color: rgba(255,60,60,0.15); } }
      `}</style>
    </div>
  );
}
