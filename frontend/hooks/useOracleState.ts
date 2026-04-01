"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

export type OraclePhase = "idle" | "betting" | "counting" | "final";

export interface OracleState {
  connected: boolean;
  phase: OraclePhase;
  roundId: number | null;
  marketAddress: string | null;
  cameraId: string | null;
  liveCount: number;
  countIn: number;
  countOut: number;
  elapsed: number;
  remaining: number;
  videoUid: string;
  /** How we got the current liveCount value */
  countSource: "oracle-ws" | "contract" | "none";
}

interface OracleMsg {
  type: string;
  count?: number;
  count_in?: number;
  count_out?: number;
  elapsed?: number;
  remaining?: number;
  marketAddress?: string;
  cameraId?: string;
  roundId?: number;
  videoUid?: string;
  state?: string;
  seq?: number;
  // vehicle_counted fields
  trackId?: number;
  lineId?: string;
  timestamp?: number;
  classId?: number;
  direction?: string;
  ts?: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const STATIC_ORACLE_WS_URL =
  typeof window !== "undefined"
    ? process.env.NEXT_PUBLIC_ORACLE_WS_URL ?? ""
    : "";

const MAX_RETRIES = 10;

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * Centralized Oracle WebSocket state.
 *
 * Owns the WS connection, validates roundId/marketAddress on every message,
 * handles init/count/idle/final/vehicle_counted, and exposes clean read-only
 * state for all components.
 *
 * @param currentMarketAddress - the currently active market (from useActiveMarket)
 *   Used to discard stale messages from previous rounds.
 */
export function useOracleState(
  currentMarketAddress: string | null | undefined,
): OracleState & { beepCount: number; frameUrl: string } {
  // ── State ───────────────────────────────────────────────────────────────
  const [connected, setConnected] = useState(false);
  const [phase, setPhase] = useState<OraclePhase>("idle");
  const [roundId, setRoundId] = useState<number | null>(null);
  const [wsMarketAddress, setWsMarketAddress] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [liveCount, setLiveCount] = useState(0);
  const [countIn, setCountIn] = useState(0);
  const [countOut, setCountOut] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [videoUid, setVideoUid] = useState("");
  const [countSource, setCountSource] = useState<OracleState["countSource"]>("none");
  const [beepCount, setBeepCount] = useState(0);
  const [frameUrl, setFrameUrl] = useState("");
  const prevFrameUrlRef = useRef("");

  // ── Refs (mutable, not in render) ───────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const disposedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBeepCountRef = useRef(0);
  const lastKnownRoundIdRef = useRef<number | null>(null);
  const currentMarketRef = useRef(currentMarketAddress);

  // Keep ref in sync with prop
  useEffect(() => {
    currentMarketRef.current = currentMarketAddress;
  }, [currentMarketAddress]);

  // Reset ALL state when market changes (new round)
  useEffect(() => {
    setPhase("idle");
    setLiveCount(0);
    setCountIn(0);
    setCountOut(0);
    setCountSource("none");
    setElapsed(0);
    setRemaining(0);
    lastBeepCountRef.current = 0;
    lastKnownRoundIdRef.current = null;
  }, [currentMarketAddress]);

  // ── Oracle WS URL resolution ────────────────────────────────────────────
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
          setTimeout(fetchUrl, Math.min(3000 * Math.pow(2, retries++), 30000));
        }
      }
    }
    fetchUrl();
    return () => { cancelled = true; };
  }, []);

  // ── Message handler ─────────────────────────────────────────────────────

  const handleMessage = useCallback((event: MessageEvent) => {
    // Binary frame = JPEG from YOLO worker (LIVE GAME MODE)
    if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
      const blob = event.data instanceof Blob
        ? event.data
        : new Blob([event.data], { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      // Revoke previous URL with delay so the browser has time to render it
      const old = prevFrameUrlRef.current;
      if (old) setTimeout(() => URL.revokeObjectURL(old), 200);
      prevFrameUrlRef.current = url;
      setFrameUrl(url);
      return;
    }
    if (typeof event.data !== "string") return;

    let msg: OracleMsg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    // Always accept videoUid (not round-specific)
    if (msg.videoUid) setVideoUid(msg.videoUid);

    // ── Stale event filtering ───────────────────────────────────────────
    // Discard messages from a different market (wrong round)
    const mktRef = currentMarketRef.current;
    if (msg.marketAddress && mktRef && msg.marketAddress.toLowerCase() !== mktRef.toLowerCase()) {
      return; // stale — different market
    }
    // Discard messages from an older round
    if (msg.roundId !== undefined && lastKnownRoundIdRef.current !== null && msg.roundId < lastKnownRoundIdRef.current) {
      return; // stale — older round
    }

    // ── Handle by type ──────────────────────────────────────────────────

    if (msg.type === "init") {
      // First message on connect — set state immediately (no jump from 0)
      const wsPhase = msg.state === "counting" ? "counting" : "idle";
      setPhase(wsPhase);
      if (msg.count !== undefined) {
        setLiveCount(msg.count);
        lastBeepCountRef.current = msg.count; // don't beep on init
        setCountSource("oracle-ws");
      }
      if (msg.roundId !== undefined) {
        setRoundId(msg.roundId);
        lastKnownRoundIdRef.current = msg.roundId;
      }
      if (msg.marketAddress) setWsMarketAddress(msg.marketAddress);
      if (msg.cameraId) setCameraId(msg.cameraId);
      if (msg.elapsed !== undefined) setElapsed(msg.elapsed);
      if (msg.remaining !== undefined) setRemaining(msg.remaining);
      if (msg.count_in !== undefined) setCountIn(msg.count_in);
      if (msg.count_out !== undefined) setCountOut(msg.count_out);
      return;
    }

    if (msg.type === "vehicle_counted") {
      // Discrete crossing event — one beep per event
      const tRecv = performance.now();
      const tDetect = msg.ts ? msg.ts * 1000 : 0; // backend ts is seconds, convert to ms
      const tNow = Date.now();
      const latencyMs = tDetect > 0 ? tNow - tDetect : -1;
      // eslint-disable-next-line no-console
      console.log(
        `[TIMING] vehicle_counted #${msg.count} | detect=${tDetect > 0 ? new Date(tDetect).toISOString() : "?"} | recv=${new Date(tNow).toISOString()} | latency=${latencyMs.toFixed(0)}ms | perfNow=${tRecv.toFixed(1)}`
      );
      if (msg.count !== undefined) {
        setLiveCount(msg.count);
        lastBeepCountRef.current = msg.count;
        setCountSource("oracle-ws");
      }
      setBeepCount((c) => c + 1);
      return;
    }

    if (msg.type === "count") {
      // Per-frame count update
      if (msg.count !== undefined) {
        // Beep on delta (if no vehicle_counted events handled it already)
        const delta = msg.count - lastBeepCountRef.current;
        if (delta > 0) {
          const beeps = Math.min(delta, 5);
          // eslint-disable-next-line no-console
          console.log(
            `[TIMING] count delta=${delta} count=${msg.count} | beeps=${beeps} | recv=${new Date().toISOString()} | perfNow=${performance.now().toFixed(1)}`
          );
          setBeepCount((c) => c + beeps);
          lastBeepCountRef.current = msg.count;
        }
        setLiveCount(msg.count);
        setCountSource("oracle-ws");
      }
      if (msg.count_in !== undefined) setCountIn(msg.count_in);
      if (msg.count_out !== undefined) setCountOut(msg.count_out);
      if (msg.elapsed !== undefined) setElapsed(msg.elapsed);
      if (msg.remaining !== undefined) setRemaining(msg.remaining);
      if (msg.roundId !== undefined) {
        setRoundId(msg.roundId);
        lastKnownRoundIdRef.current = msg.roundId;
      }
      if (msg.marketAddress) setWsMarketAddress(msg.marketAddress);
      if (msg.cameraId) setCameraId(msg.cameraId);
      // Set phase to counting if oracle says so
      if (msg.state === "counting") setPhase("counting");
      return;
    }

    if (msg.type === "idle") {
      setPhase("idle");
      // Don't reset liveCount — let page.tsx decide what to show
      setRemaining(0);
      setElapsed(0);
      return;
    }

    if (msg.type === "final" || msg.type === "round_complete") {
      setPhase("final");
      if (msg.count !== undefined) {
        setLiveCount(msg.count);
        lastBeepCountRef.current = msg.count;
        setCountSource("oracle-ws");
      }
      setRemaining(0);
      return;
    }
  }, []);

  // ── WebSocket connection ────────────────────────────────────────────────

  const connectOracle = useCallback(() => {
    if (!oracleWsUrl || disposedRef.current) return;

    // Clean up previous
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
      setConnected(true);
      retryCountRef.current = 0;
    };

    ws.onmessage = handleMessage;

    ws.onerror = () => {};
    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      if (disposedRef.current) return;
      if (retryCountRef.current < MAX_RETRIES) {
        const delay = Math.min(3000 * Math.pow(2, retryCountRef.current++), 30_000);
        retryTimerRef.current = setTimeout(connectOracle, delay);
      }
    };
  }, [oracleWsUrl, handleMessage]);

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

  return {
    connected,
    phase,
    roundId,
    marketAddress: wsMarketAddress,
    cameraId,
    liveCount,
    countIn,
    countOut,
    elapsed,
    remaining,
    videoUid,
    countSource,
    beepCount,
    frameUrl,
  };
}
