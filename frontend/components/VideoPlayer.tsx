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

interface OracleCountMsg {
  type: "count";
  count: number;
  elapsed: number;
  remaining: number;
  marketAddress?: string;
  cameraId?: string;
  roundId?: number;
}

interface OracleInitMsg {
  type: "init";
  stream: string;
  duration: number;
  count: number;
  marketAddress?: string;
  cameraId?: string;
  roundId?: number;
}

interface OracleFinalMsg {
  type: "final";
  count: number;
  duration: number;
  marketAddress?: string;
  cameraId?: string;
  roundId?: number;
}

type OracleMsg = OracleInitMsg | OracleCountMsg | OracleFinalMsg;

// YouTube embed removed — some cameras block external embedding.
// Fallback shows "Connecting to oracle..." instead.

// Static env var fallback — but dynamic URL from API takes priority
const STATIC_ORACLE_WS_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_ORACLE_WS_URL ?? ""
    : "";

export default function VideoPlayer({
  vehicleCount: externalVehicleCount,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isLive: _isLive = true,
  cameraName = "LIVE CAMERA",
  onCountUpdate,
  marketAddress,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  streamUrl: _streamUrl,
}: VideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  const animRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Dynamic oracle URL from API
  const [oracleWsUrl, setOracleWsUrl] = useState(STATIC_ORACLE_WS_URL);

  useEffect(() => {
    let cancelled = false;
    async function fetchUrl() {
      try {
        const res = await fetch("/api/oracle-url");
        if (!res.ok) return;
        const data = await res.json();
        if (data.url && !cancelled) setOracleWsUrl(data.url);
      } catch { /* use static fallback */ }
    }
    fetchUrl();
    const interval = setInterval(fetchUrl, 5_000); // check every 5s for fast reconnect
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Oracle connection state
  const [oracleConnected, setOracleConnected] = useState(false);
  const [oracleCount, setOracleCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const oracleImageRef = useRef<HTMLImageElement | null>(null);
  const frameSeqRef = useRef(0);        // monotonic sequence counter
  const renderedSeqRef = useRef(0);     // last seq drawn to canvas

  const vehicleCount = oracleConnected ? oracleCount : externalVehicleCount;
  const prevCountRef = useRef(vehicleCount);

  const playBeep = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // AudioContext unavailable (SSR / no user interaction yet)
    }
  }, []);

  // Beep on count increment
  useEffect(() => {
    if (vehicleCount > prevCountRef.current) {
      playBeep();
    }
    prevCountRef.current = vehicleCount;
  }, [vehicleCount, playBeep]);

  // Oracle WebSocket
  const connectOracle = useCallback(() => {
    if (!oracleWsUrl) return;

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(oracleWsUrl);
    } catch {
      return;
    }

    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setOracleConnected(true);
      retryCountRef.current = 0; // Reset backoff on successful connect
    };

    ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        // Sequence-guarded frame decode — prevents old async decodes
        // from overwriting newer frames (the fake-loop bug).
        const seq = ++frameSeqRef.current;
        const blob = new Blob([event.data], { type: "image/jpeg" });

        createImageBitmap(blob).then((bitmap) => {
          // Only accept if this is still the newest frame
          if (seq >= renderedSeqRef.current) {
            renderedSeqRef.current = seq;
            oracleImageRef.current = bitmap as unknown as HTMLImageElement;
          }
          // bitmap is lightweight, no URL to revoke
        }).catch(() => {});
      } else if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as OracleMsg;
          // Validate market address — reject stale counts from previous rounds
          const msgMarket = msg.marketAddress;
          if (msgMarket && marketAddress && msgMarket.toLowerCase() !== marketAddress.toLowerCase()) {
            return;
          }

          if (msg.type === "count" || msg.type === "init" || msg.type === "final") {
            setOracleCount(msg.count);
            onCountUpdate?.(msg.count);
          }
        } catch {
          // Non-JSON text, ignore
        }
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      setOracleConnected(false);
      oracleImageRef.current = null;
      wsRef.current = null;

      // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
      const delay = Math.min(2000 * Math.pow(2, retryCountRef.current), 30_000);
      retryCountRef.current++;
      retryTimerRef.current = setTimeout(() => {
        connectOracle();
      }, delay);
    };
  }, [oracleWsUrl, marketAddress, onCountUpdate]);

  // Connect on mount or when URL changes, clean up on unmount
  useEffect(() => {
    connectOracle();

    return () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      // No blob URLs to clean — createImageBitmap handles memory
    };
  }, [connectOracle]);

  // Canvas HUD loop — only runs when oracle is connected
  useEffect(() => {
    if (!oracleConnected) {
      cancelAnimationFrame(animRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // HUD removed — all count/timer/status displayed by frontend components outside the video

    function draw() {
      if (!canvas || !ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      const currentFrame = ++frameRef.current;

      if (oracleImageRef.current) {
        ctx.drawImage(oracleImageRef.current, 0, 0, W, H);

        // CRT scanlines overlay
        for (let y = 0; y < H; y += 4) {
          ctx.fillStyle = "rgba(0,0,0,0.05)";
          ctx.fillRect(0, y, W, 2);
        }

        // Scanline sweep
        const sweepY = (currentFrame * 1.5) % H;
        const sweepGrad = ctx.createLinearGradient(0, sweepY - 8, 0, sweepY + 8);
        sweepGrad.addColorStop(0, "rgba(0,255,136,0)");
        sweepGrad.addColorStop(0.5, "rgba(0,255,136,0.03)");
        sweepGrad.addColorStop(1, "rgba(0,255,136,0)");
        ctx.fillStyle = sweepGrad;
        ctx.fillRect(0, sweepY - 8, W, 16);

        // Clean video — no HUD overlay
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oracleConnected, vehicleCount, cameraName]);

  return (
    <div
      className="relative w-full"
      style={{
        aspectRatio: "4/3",
        background: "#000",
        borderRadius: "4px",
        overflow: "hidden",
        border: "1px solid #1a1a1a",
      }}
    >
      {oracleConnected ? (
        /* Oracle connected: show YOLO-processed canvas */
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          style={{ width: "100%", height: "100%", display: "block" }}
          aria-label="Live CCTV feed with oracle vehicle detection"
        />
      ) : (
        /* No oracle connection: show connecting state */
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "#0a0a0a" }}>
          <div className="w-6 h-6 rounded-full border-2 border-t-transparent mb-3" style={{ borderColor: "#00ff8855", borderTopColor: "transparent", animation: "spin 1s linear infinite" }} />
          <span className="text-sm font-black tracking-widest" style={{ color: "#00ff88", fontFamily: "monospace" }}>
            CONNECTING TO ORACLE...
          </span>
          <span className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>
            {cameraName}
          </span>
        </div>
      )}
    </div>
  );
}

// LiveClock removed — was only used in YouTube embed fallback
