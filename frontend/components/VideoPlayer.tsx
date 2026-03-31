"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface VideoPlayerProps {
  vehicleCount: number;
  isLive?: boolean;
  cameraName?: string;
  onCountUpdate?: (count: number) => void;
  marketAddress?: string;
  streamUrl?: string;
}

interface OracleMsg {
  type: string;
  count?: number;
  elapsed?: number;
  remaining?: number;
  marketAddress?: string;
  cameraId?: string;
  roundId?: number;
  videoUid?: string;
  state?: string;
}

const CF_SUBDOMAIN = "customer-vn9syvcedwumw0ut.cloudflarestream.com";

const STATIC_ORACLE_WS_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_ORACLE_WS_URL ?? ""
    : "";

export default function VideoPlayer({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vehicleCount: _externalVehicleCount,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isLive: _isLive = true,
  cameraName = "LIVE CAMERA",
  onCountUpdate,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  marketAddress: _marketAddress,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  streamUrl: _streamUrl,
}: VideoPlayerProps) {
  const onCountUpdateRef = useRef(onCountUpdate);
  const disposedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const lastCountRef = useRef(0);

  useEffect(() => { onCountUpdateRef.current = onCountUpdate; }, [onCountUpdate]);

  const [oracleWsUrl, setOracleWsUrl] = useState(STATIC_ORACLE_WS_URL);
  const [oracleConnected, setOracleConnected] = useState(false);
  const [videoUid, setVideoUid] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  // Fetch dynamic oracle URL
  useEffect(() => {
    let cancelled = false;
    let retries = 0;
    async function fetchUrl() {
      try {
        const res = await fetch("/api/oracle-url");
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (data.url && !cancelled) setOracleWsUrl(data.url);
      } catch {
        if (!cancelled) {
          setTimeout(fetchUrl, Math.min(3000 * Math.pow(2, retries++), 30000));
        }
      }
    }
    fetchUrl();
    return () => { cancelled = true; };
  }, []);

  // Beep on vehicle_counted event
  const playBeep = useCallback(() => {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // AudioContext unavailable
    }
  }, []);

  // Unlock audio on user gesture
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
    };
    document.addEventListener("click", unlock, { once: true });
    document.addEventListener("touchstart", unlock, { once: true });
    return () => {
      document.removeEventListener("click", unlock);
      document.removeEventListener("touchstart", unlock);
    };
  }, []);

  // Oracle WebSocket
  const connectOracle = useCallback(() => {
    if (!oracleWsUrl || disposedRef.current) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    let ws: WebSocket;
    try { ws = new WebSocket(oracleWsUrl); } catch { return; }
    wsRef.current = ws;

    ws.onopen = () => {
      setOracleConnected(true);
      retryCountRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) return;
      if (typeof event.data !== "string") return;

      try {
        const msg = JSON.parse(event.data) as OracleMsg;

        // Video UID
        if (msg.videoUid) setVideoUid(msg.videoUid);

        // vehicle_counted event — beep immediately
        if (msg.type === "vehicle_counted") {
          playBeep();
          if (msg.count !== undefined) {
            onCountUpdateRef.current?.(msg.count);
            lastCountRef.current = msg.count;
          }
          return;
        }

        // Count updates (batch) — update count, beep if changed
        if (msg.count !== undefined && msg.count > lastCountRef.current) {
          playBeep();
          lastCountRef.current = msg.count;
          onCountUpdateRef.current?.(msg.count);
        } else if (msg.count !== undefined) {
          onCountUpdateRef.current?.(msg.count);
        }
      } catch {
        // ignore
      }
    };

    ws.onerror = () => {};
    ws.onclose = () => {
      setOracleConnected(false);
      wsRef.current = null;
      if (disposedRef.current) return;
      if (retryCountRef.current < 10) {
        const delay = Math.min(3000 * Math.pow(2, retryCountRef.current++), 30_000);
        retryTimerRef.current = setTimeout(connectOracle, delay);
      }
    };
  }, [oracleWsUrl, playBeep]);

  useEffect(() => {
    disposedRef.current = false;
    connectOracle();
    return () => {
      disposedRef.current = true;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectOracle]);

  const iframeSrc = videoUid
    ? `https://${CF_SUBDOMAIN}/${videoUid}/iframe?autoplay=true&muted=true&loop=true`
    : "";

  return (
    <div
      className="relative w-full"
      style={{
        aspectRatio: "16/9",
        background: "#000",
        borderRadius: "4px",
        overflow: "hidden",
        border: "1px solid #1a1a1a",
      }}
    >
      {iframeSrc ? (
        <iframe
          src={iframeSrc}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "#0a0a0a" }}>
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent mb-3"
            style={{ borderColor: "#00ff8855", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
          <span className="text-sm font-black tracking-widest" style={{ color: "#00ff88", fontFamily: "monospace" }}>
            {oracleConnected ? "LOADING STREAM..." : "CONNECTING TO ORACLE..."}
          </span>
          <span className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>{cameraName}</span>
        </div>
      )}
      <div style={{
        position: "absolute", top: 8, right: 8, width: 8, height: 8, borderRadius: "50%",
        background: oracleConnected ? "#00ff88" : "#ff4444",
        boxShadow: oracleConnected ? "0 0 6px #00ff88" : "0 0 6px #ff4444",
      }} />
    </div>
  );
}
