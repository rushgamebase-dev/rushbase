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

// Static env var fallback — dynamic URL from API takes priority
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
  // audioContextRef removed — no beep

  // Stable refs for values used inside WS callbacks
  const marketAddressRef = useRef(marketAddress);
  const onCountUpdateRef = useRef(onCountUpdate);
  const disposedRef = useRef(false);

  useEffect(() => { marketAddressRef.current = marketAddress; }, [marketAddress]);
  useEffect(() => { onCountUpdateRef.current = onCountUpdate; }, [onCountUpdate]);

  // Dynamic oracle URL — fetch ONCE on mount, retry with backoff
  const [oracleWsUrl, setOracleWsUrl] = useState(STATIC_ORACLE_WS_URL);

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
          const delay = Math.min(3000 * Math.pow(2, retries), 30000);
          retries++;
          setTimeout(fetchUrl, delay);
        }
      }
    }

    fetchUrl();
    return () => { cancelled = true; };
  }, []);

  // Oracle connection state
  const [oracleConnected, setOracleConnected] = useState(false);
  const [oracleCount, setOracleCount] = useState(0);
  const [videoUid, setVideoUid] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const vehicleCount = oracleConnected ? oracleCount : externalVehicleCount;
  const prevCountRef = useRef(vehicleCount);

  // No beep — count shown visually only

  // Oracle WebSocket — metadata only (no video frames)
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
    try {
      ws = new WebSocket(oracleWsUrl);
    } catch {
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setOracleConnected(true);
      retryCountRef.current = 0;
    };

    ws.onmessage = (event: MessageEvent) => {
      // Ignore binary frames (legacy compat)
      if (event.data instanceof ArrayBuffer) return;

      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data) as OracleMsg;
          // Count updates
          if (msg.count !== undefined) {
            setOracleCount(msg.count);
            onCountUpdateRef.current?.(msg.count);
          }
          // Video UID from init/status
          if (msg.videoUid) {
            setVideoUid(msg.videoUid);
          }
        } catch {
          // Non-JSON, ignore
        }
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      setOracleConnected(false);
      wsRef.current = null;

      if (disposedRef.current) return;

      if (retryCountRef.current < 10) {
        const delay = Math.min(3000 * Math.pow(2, retryCountRef.current), 30_000);
        retryCountRef.current++;
        retryTimerRef.current = setTimeout(() => {
          connectOracle();
        }, delay);
      }
    };
  }, [oracleWsUrl]);

  useEffect(() => {
    disposedRef.current = false;
    connectOracle();

    return () => {
      disposedRef.current = true;
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
    };
  }, [connectOracle]);

  // Build iframe src
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
      {/* Cloudflare Stream Player */}
      {iframeSrc ? (
        <iframe
          src={iframeSrc}
          style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      ) : (
        /* Connecting overlay */
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "#0a0a0a" }}>
          <div
            className="w-6 h-6 rounded-full border-2 border-t-transparent mb-3"
            style={{
              borderColor: "#00ff8855",
              borderTopColor: "transparent",
              animation: "spin 1s linear infinite",
            }}
          />
          <span
            className="text-sm font-black tracking-widest"
            style={{ color: "#00ff88", fontFamily: "monospace" }}
          >
            {oracleConnected ? "LOADING STREAM..." : "CONNECTING TO ORACLE..."}
          </span>
          <span className="text-xs mt-1" style={{ color: "#555", fontFamily: "monospace" }}>
            {cameraName}
          </span>
        </div>
      )}

      {/* Connection indicator */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: oracleConnected ? "#00ff88" : "#ff4444",
          boxShadow: oracleConnected ? "0 0 6px #00ff88" : "0 0 6px #ff4444",
        }}
      />
    </div>
  );
}
