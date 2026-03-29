"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface VideoPlayerProps {
  vehicleCount: number;
  isLive?: boolean;
  cameraName?: string;
  onCountUpdate?: (count: number) => void;
  marketAddress?: string;
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

const YOUTUBE_EMBED_URL =
  "https://www.youtube.com/embed/DnUFAShZKus?autoplay=1&mute=1&controls=0";

// Static env var fallback — but dynamic URL from API takes priority
const STATIC_ORACLE_WS_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_ORACLE_WS_URL ?? ""
    : "";

export default function VideoPlayer({
  vehicleCount: externalVehicleCount,
  isLive = true,
  cameraName = "LIVE CAMERA",
  onCountUpdate,
  marketAddress,
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
    const interval = setInterval(fetchUrl, 30_000); // re-check every 30s
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Oracle connection state
  const [oracleConnected, setOracleConnected] = useState(false);
  const [oracleCount, setOracleCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const prevBlobUrlRef = useRef<string | null>(null);
  const oracleImageRef = useRef<HTMLImageElement | null>(null);

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
        // Binary JPEG frame — draw on canvas
        const blob = new Blob([event.data], { type: "image/jpeg" });
        const url = URL.createObjectURL(blob);

        if (prevBlobUrlRef.current) {
          URL.revokeObjectURL(prevBlobUrlRef.current);
        }
        prevBlobUrlRef.current = url;

        const img = new Image();
        img.onload = () => {
          oracleImageRef.current = img;
        };
        img.src = url;
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
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
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
        aspectRatio: "16/9",
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
        /* No oracle: show YouTube live stream embed */
        <>
          <iframe
            src={YOUTUBE_EMBED_URL}
            title="Live camera feed"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              display: "block",
            }}
          />

          {/* HUD overlay on top of YouTube embed */}
          <div
            className="absolute inset-0 pointer-events-none"
            aria-hidden="true"
          >
            {/* LIVE badge */}
            {isLive && (
              <div
                className="absolute top-2 right-2 flex items-center gap-1.5"
                style={{
                  background: "rgba(255,68,68,0.15)",
                  border: "1px solid rgba(255,68,68,0.5)",
                  padding: "3px 8px",
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full"
                  style={{
                    background: "#ff4444",
                    animation: "livePulse 1.2s ease-in-out infinite",
                    boxShadow: "0 0 4px rgba(255,68,68,0.8)",
                  }}
                />
                <span
                  style={{
                    color: "#ff4444",
                    fontFamily: "monospace",
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                >
                  LIVE
                </span>
              </div>
            )}

            {/* Camera name + clock */}
            <div
              className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2"
              style={{
                background: "rgba(0,0,0,0.5)",
                height: 24,
              }}
            >
              <span
                style={{
                  color: "rgba(0,255,136,0.7)",
                  fontFamily: "monospace",
                  fontSize: 9,
                }}
              >
                {cameraName}
              </span>
              <LiveClock />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Clock component that ticks every second
function LiveClock() {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    function tick() {
      const now = new Date();
      const date = now.toLocaleDateString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
      });
      const t = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      setTime(`${date}  ${t}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      style={{
        color: "rgba(200,200,200,0.6)",
        fontFamily: "monospace",
        fontSize: 9,
      }}
    >
      {time}
    </span>
  );
}
