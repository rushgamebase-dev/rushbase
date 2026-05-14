"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { Loader2, Radio, RefreshCw, Target, Trophy, Users, type LucideIcon } from "lucide-react";
import { io, type Socket } from "socket.io-client";
import { GameEngine, createDefaultConfig } from "@/lib/rush-royale-game/engine";
import {
  ArenaPhase,
  GameEventType,
  MatchStatus,
  type ParticipantDataV2,
  type TickUpdate as EngineTickUpdate,
} from "@/lib/rush-royale-game/engine-types";
import type { BattleRenderer as BattleRendererType } from "@/lib/rush-royale-game/renderer";
import type {
  MatchState as RendererMatchState,
  TickUpdate as RendererTickUpdate,
} from "@/lib/rush-royale-game/renderer-types";

type HudState = {
  arenaId: bigint;
  seed: bigint;
  tick: number;
  aliveCount: number;
  arenaRadius: number;
  arenaPhase: ArenaPhase;
};

type KillLine = {
  id: string;
  tick: number;
  victimId: string;
  killerId?: string;
  source: "zone" | "combat";
};

type MatchResult = {
  winnerId: string;
  winnerAgentId: string;
  winnerOwner: string;
  totalTicks: number;
};

type ArenaLifecycleState = 0 | 1 | 2 | 3 | 4 | 5;
type StreamMode = "local" | "server" | "connecting" | "waiting";
type ArenaWebSocketUpdate = {
  type: string;
  arenaId: string;
  data?: {
    matchId?: string;
    [key: string]: unknown;
  };
};
type ServerMatchEnd = {
  winnerId?: string;
  winnerAgentId?: string;
  winnerOwner?: string;
  totalTicks?: number;
};

const TICK_RATE = 20;
const DEMO_AGENT_COUNT = 25;
const LIVE_STREAM_FALLBACK_MS = 6500;

type EngineCanvasParticipant = {
  agentId: bigint;
  owner: `0x${string}`;
  boostIds?: bigint[];
};

export function RushRoyaleEngineCanvas({ arenaId, arenaState, seed, participants = [] }: { arenaId?: bigint; arenaState?: ArenaLifecycleState; seed?: bigint; participants?: EngineCanvasParticipant[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BattleRendererType | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restartRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const demoIndexRef = useRef(0);
  const mountedRef = useRef(false);
  const usingServerStreamRef = useRef(false);
  const serverCompletedRef = useRef(false);
  const latestServerTickRef = useRef(0);
  const liveMatchIdRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [hud, setHud] = useState<HudState>(() => createInitialHud(0));
  const [killFeed, setKillFeed] = useState<KillLine[]>([]);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [streamMode, setStreamMode] = useState<StreamMode>("waiting");
  const { participants: engineParticipants } = useStableEngineParticipants(participants);
  const hasArenaSelection = arenaId !== undefined;
  const hasActualMatch = arenaId !== undefined && seed !== undefined && seed > BigInt(0) && engineParticipants.length >= 2;
  const expectsServerStream = hasActualMatch && arenaState === 3;

  const clearTimers = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (restartRef.current) {
      clearTimeout(restartRef.current);
      restartRef.current = null;
    }
  }, []);

  const startMatch = useCallback((nextIndex: number) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    clearTimers();
    usingServerStreamRef.current = false;
    serverCompletedRef.current = false;
    latestServerTickRef.current = 0;
    demoIndexRef.current = nextIndex;
    setIsRestarting(false);
    setResult(null);
    setKillFeed([]);
    setStreamMode("local");

    const matchArenaId = hasActualMatch && arenaId !== undefined ? arenaId : BigInt(900000 + nextIndex);
    const matchSeed = hasActualMatch && seed !== undefined ? seed : BigInt(857209 + nextIndex * 15485863);
    const matchParticipants = hasActualMatch ? engineParticipants : createDemoParticipants();
    const engine = new GameEngine(createDefaultConfig(matchArenaId, matchSeed), matchParticipants);
    engine.start();
    engineRef.current = engine;

    const fullState = engine.getFullState() as RendererMatchState;
    renderer.initializeMatch(fullState);
    setHud({
      arenaId: matchArenaId,
      seed: matchSeed,
      tick: 0,
      aliveCount: matchParticipants.length,
      arenaRadius: fullState.arena.currentRadius,
      arenaPhase: fullState.arena.phase,
    });

    intervalRef.current = setInterval(() => {
      const activeEngine = engineRef.current;
      const activeRenderer = rendererRef.current;
      if (!activeEngine || !activeRenderer) return;

      const update = activeEngine.tick();
      activeRenderer.applyTick(update as unknown as RendererTickUpdate);
      collectKillFeed(update, setKillFeed);

      if (update.tick % 4 === 0) {
        setHud({
          arenaId: matchArenaId,
          seed: matchSeed,
          tick: update.tick,
          aliveCount: update.agents.filter((agent) => agent.isAlive).length,
          arenaRadius: update.arena.radius,
          arenaPhase: update.arena.phase,
        });
      }

      const endEvent = update.events.find((event) => event.type === GameEventType.MATCH_END);
      if (endEvent || activeEngine.getStatus() === MatchStatus.FINISHED) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }

        const winner = activeEngine.getWinner();
        const winnerData = endEvent?.data ?? {
          winnerId: winner?.id ?? "agent_0",
          winnerAgentId: winner?.agentId.toString() ?? "0",
          winnerOwner: winner?.owner ?? "0x0000000000000000000000000000000000000000",
          totalTicks: update.tick,
        };

        activeRenderer.onMatchEnd(winnerData);
        setResult({
          winnerId: winnerData.winnerId,
          winnerAgentId: winnerData.winnerAgentId,
          winnerOwner: winnerData.winnerOwner,
          totalTicks: winnerData.totalTicks ?? update.tick,
        });
        setIsRestarting(true);

        if (!hasArenaSelection) {
          restartRef.current = setTimeout(() => {
            if (mountedRef.current) startMatch(demoIndexRef.current + 1);
          }, 5200);
        }
      }
    }, 1000 / TICK_RATE);
  }, [arenaId, clearTimers, engineParticipants, hasActualMatch, hasArenaSelection, seed]);

  const initializeServerMatch = useCallback((state: RendererMatchState) => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    clearTimers();
    usingServerStreamRef.current = true;
    latestServerTickRef.current = state.tick ?? 0;
    liveMatchIdRef.current = state.matchId;
    engineRef.current = null;
    renderer.initializeMatch(state);
    setStreamMode("server");
    setIsRestarting(false);
    setResult(null);
    setKillFeed([]);
    setHud({
      arenaId: BigInt(state.arenaId),
      seed: BigInt(state.seed),
      tick: state.tick,
      aliveCount: state.agents.filter((agent) => agent.isAlive).length,
      arenaRadius: Math.round(state.arena.currentRadius),
      arenaPhase: state.arena.phase,
    });
  }, [clearTimers]);

  const applyServerTick = useCallback((update: EngineTickUpdate) => {
    if (!usingServerStreamRef.current || update.tick <= latestServerTickRef.current) return;
    const renderer = rendererRef.current;
    if (!renderer) return;

    latestServerTickRef.current = update.tick;
    renderer.applyTick(update as unknown as RendererTickUpdate);
    collectKillFeed(update, setKillFeed);

    if (update.tick % 4 === 0) {
      setHud((current) => ({
        ...current,
        tick: update.tick,
        aliveCount: update.agents.filter((agent) => agent.isAlive).length,
        arenaRadius: Math.round(update.arena.radius),
        arenaPhase: update.arena.phase,
      }));
    }
  }, []);

  const handleServerMatchEnd = useCallback((serverResult: ServerMatchEnd) => {
    if (!usingServerStreamRef.current) return;
    const renderer = rendererRef.current;
    const winnerAgentId = serverResult.winnerAgentId ?? normalizeWinnerAgentId(serverResult.winnerId);
    const winnerId = normalizeRendererWinnerId(serverResult.winnerId, winnerAgentId);
    const totalTicks = serverResult.totalTicks ?? latestServerTickRef.current;

    renderer?.onMatchEnd({ ...serverResult, winnerId, winnerAgentId, totalTicks });
    serverCompletedRef.current = true;
    setResult({
      winnerId,
      winnerAgentId,
      winnerOwner: serverResult.winnerOwner ?? "0x0000000000000000000000000000000000000000",
      totalTicks,
    });
    setIsRestarting(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: BattleRendererType | null = null;
    let resizeObserver: ResizeObserver | null = null;

    void (async () => {
      const { BattleRenderer } = await import("@/lib/rush-royale-game/renderer");
      if (!mountedRef.current) return;

      renderer = new BattleRenderer(canvas, {
        width: container.clientWidth || 1200,
        height: container.clientHeight || 640,
      });

      try {
        await renderer.init(canvas);
        if (!mountedRef.current) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        setReady(true);

        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry || !rendererRef.current) return;
          rendererRef.current.resize(entry.contentRect.width, entry.contentRect.height);
        });
        resizeObserver.observe(container);
      } catch (error) {
        console.error("[RushRoyaleEngineCanvas] renderer init failed", error);
      }
    })();

    return () => {
      mountedRef.current = false;
      clearTimers();
      socketRef.current?.disconnect();
      socketRef.current = null;
      resizeObserver?.disconnect();
      engineRef.current = null;
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, [clearTimers]);

  useEffect(() => {
    if (!ready || !expectsServerStream || arenaId === undefined) return;

    const socket = io(getGameServerUrl(), {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 4,
      reconnectionDelay: 800,
    });
    socketRef.current = socket;
    usingServerStreamRef.current = false;
    serverCompletedRef.current = false;
    latestServerTickRef.current = 0;
    liveMatchIdRef.current = null;
    setStreamMode("connecting");

    const arenaIdString = arenaId.toString();
    const fallback = window.setTimeout(() => {
      if (mountedRef.current && !usingServerStreamRef.current) {
        setStreamMode("local");
        socket.disconnect();
        startMatch(0);
      }
    }, LIVE_STREAM_FALLBACK_MS);

    const spectateMatch = (matchId?: string) => {
      if (!matchId || liveMatchIdRef.current === matchId) return;
      liveMatchIdRef.current = matchId;
      socket.emit("spectate", { matchId });
    };

    socket.on("connect", () => {
      socket.emit("subscribe_arena", { arenaId: arenaIdString });
      socket.emit("spectate_arena", { arenaId: arenaIdString });
    });

    socket.on("arena_update", (update: ArenaWebSocketUpdate) => {
      if (update.arenaId !== arenaIdString) return;
      if (update.type === "match_ready") {
        spectateMatch(update.data?.matchId);
      }
    });

    socket.on("match_state", (state: RendererMatchState) => {
      if (state.arenaId !== arenaIdString) return;
      window.clearTimeout(fallback);
      initializeServerMatch(state);
      spectateMatch(state.matchId);
    });

    socket.on("tick", (update: EngineTickUpdate) => {
      applyServerTick(update);
    });

    socket.on("match_end", (serverResult: ServerMatchEnd) => {
      window.clearTimeout(fallback);
      handleServerMatchEnd(serverResult);
    });

    socket.on("connect_error", () => {
      setStreamMode((current) => current === "server" ? current : "connecting");
    });

    return () => {
      window.clearTimeout(fallback);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      usingServerStreamRef.current = false;
      latestServerTickRef.current = 0;
      liveMatchIdRef.current = null;
    };
  }, [applyServerTick, arenaId, expectsServerStream, handleServerMatchEnd, initializeServerMatch, ready, startMatch]);

  useEffect(() => {
    if (!ready) return;
    if (hasArenaSelection && !hasActualMatch) {
      clearTimers();
      engineRef.current = null;
      setResult(null);
      setKillFeed([]);
      setHud(createStaticHud(arenaId ?? BigInt(0), seed ?? BigInt(0), engineParticipants.length));
      return;
    }
    if (expectsServerStream) {
      clearTimers();
      setStreamMode("connecting");
      setHud(createStaticHud(arenaId ?? BigInt(0), seed ?? BigInt(0), engineParticipants.length));
      return;
    }
    if (arenaState === 4 && serverCompletedRef.current) {
      return;
    }
    startMatch(0);
  }, [arenaId, arenaState, clearTimers, engineParticipants.length, expectsServerStream, hasActualMatch, hasArenaSelection, ready, seed, startMatch]);

  return (
    <div className="overflow-hidden rounded-lg border border-violet-400/25 bg-black shadow-[0_0_38px_rgba(139,92,246,0.18)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-zinc-950 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-red-400/45 bg-red-500/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-red-100" style={{ fontFamily: "monospace" }}>
            <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.9)]" />
            {getModeLabel(streamMode, hasActualMatch, hasArenaSelection)}
          </span>
          <span className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100" style={{ fontFamily: "monospace" }}>arena #{hud.arenaId.toString()}</span>
          <span className="text-xs font-black uppercase tracking-[0.16em] text-neutral-500" style={{ fontFamily: "monospace" }}>seed {hud.seed.toString()}</span>
        </div>
        <button
          type="button"
          onClick={() => startMatch(demoIndexRef.current + 1)}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/60 text-white transition-colors hover:border-cyan-300/50 hover:text-cyan-200 disabled:opacity-50"
          disabled={!ready}
          aria-label="Restart Rush Royale engine demo"
        >
          {isRestarting ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      <div ref={containerRef} className="relative h-[620px] min-h-[520px] w-full bg-zinc-950">
        <canvas ref={canvasRef} className="h-full w-full" style={{ display: "block" }} />

        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
          <HudPill icon={Users} value={`${hud.aliveCount} alive`} />
          <HudPill icon={Target} value={`${hud.arenaRadius}m`} />
          <HudPill icon={Radio} value={hud.arenaPhase} danger={hud.arenaPhase === ArenaPhase.SHRINKING || hud.arenaPhase === ArenaPhase.FINAL} />
          <HudPill icon={Trophy} value={`T${hud.tick}`} />
        </div>

        {killFeed.length > 0 && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[360px] flex-col gap-1.5">
            {killFeed.slice(0, 5).map((line) => (
              <div key={line.id} className="rounded-md border border-white/10 bg-black/75 px-3 py-2 text-xs font-bold text-neutral-200 shadow-lg">
                <span className="text-red-300">{line.victimId.replace("agent_", "#")}</span>
                <span className="text-neutral-500"> eliminated </span>
                {line.killerId ? <span className="text-cyan-200">by {line.killerId.replace("agent_", "#")}</span> : <span className="text-orange-200">by zone</span>}
              </div>
            ))}
          </div>
        )}

        {result && (
          <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center px-4">
            <div className="rounded-xl border border-yellow-300/35 bg-black/80 px-5 py-3 text-center shadow-[0_0_36px_rgba(250,204,21,0.28)]">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-yellow-200" style={{ fontFamily: "monospace" }}>winner takes all</div>
              <div className="mt-1 text-xl font-black text-white">Fighter #{result.winnerAgentId}</div>
            </div>
          </div>
        )}

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950">
            <div className="text-center text-neutral-400">
              <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-violet-400" />
              <div className="text-sm font-bold">Loading battle engine...</div>
            </div>
          </div>
        )}

        {ready && hasArenaSelection && !hasActualMatch && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/92">
            <div className="rounded-xl border border-yellow-300/25 bg-black/70 px-5 py-4 text-center shadow-[0_0_30px_rgba(250,204,21,0.12)]">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-yellow-200" />
              <div className="text-xs font-black uppercase tracking-[0.16em] text-yellow-100" style={{ fontFamily: "monospace" }}>
                arena #{hud.arenaId.toString()}
              </div>
              <div className="mt-1 text-sm font-bold text-neutral-300">Waiting for VRF seed</div>
            </div>
          </div>
        )}

        {ready && expectsServerStream && streamMode === "connecting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/84">
            <div className="rounded-xl border border-cyan-300/25 bg-black/70 px-5 py-4 text-center shadow-[0_0_30px_rgba(103,232,249,0.12)]">
              <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-cyan-200" />
              <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-100" style={{ fontFamily: "monospace" }}>
                arena #{hud.arenaId.toString()}
              </div>
              <div className="mt-1 text-sm font-bold text-neutral-300">Connecting to official match stream</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getGameServerUrl() {
  return process.env.NEXT_PUBLIC_GAME_SERVER_URL || "https://api.rushgame.vip";
}

function getModeLabel(mode: StreamMode, hasActualMatch: boolean, hasArenaSelection: boolean) {
  if (mode === "server") return "official live";
  if (mode === "connecting") return "syncing live";
  if (hasActualMatch) return "deterministic replay";
  return hasArenaSelection ? "waiting seed" : "engine demo";
}

function normalizeWinnerAgentId(winnerId?: string) {
  if (!winnerId) return "0";
  return winnerId.startsWith("agent_") ? winnerId.replace("agent_", "") : winnerId;
}

function normalizeRendererWinnerId(winnerId?: string, winnerAgentId?: string) {
  if (winnerId?.startsWith("agent_")) return winnerId;
  return `agent_${winnerAgentId ?? winnerId ?? "0"}`;
}

function useStableEngineParticipants(source: EngineCanvasParticipant[]): { participants: ParticipantDataV2[]; signature: string } {
  const normalized = useMemo(
    () => source.map((participant) => ({
      agentId: participant.agentId,
      owner: participant.owner,
      boostIds: participant.boostIds ?? [],
    })),
    [source],
  );
  const signature = useMemo(() => buildParticipantSignature(normalized), [normalized]);
  const stableRef = useRef<{ participants: ParticipantDataV2[]; signature: string }>({
    participants: [],
    signature: "",
  });

  if (stableRef.current.signature !== signature) {
    stableRef.current = { participants: normalized, signature };
  }

  return stableRef.current;
}

function buildParticipantSignature(participants: ParticipantDataV2[]): string {
  return participants
    .map((participant) => [
      participant.agentId.toString(),
      participant.owner.toLowerCase(),
      participant.boostIds.map((boostId) => boostId.toString()).join(","),
    ].join(":"))
    .join("|");
}

function createInitialHud(index: number): HudState {
  return {
    arenaId: BigInt(900000 + index),
    seed: BigInt(857209 + index * 15485863),
    tick: 0,
    aliveCount: DEMO_AGENT_COUNT,
    arenaRadius: 500,
    arenaPhase: ArenaPhase.WARMUP,
  };
}

function createStaticHud(arenaId: bigint, seed: bigint, aliveCount: number): HudState {
  return {
    arenaId,
    seed,
    tick: 0,
    aliveCount,
    arenaRadius: 500,
    arenaPhase: ArenaPhase.WARMUP,
  };
}

function createDemoParticipants(): ParticipantDataV2[] {
  return Array.from({ length: DEMO_AGENT_COUNT }, (_, index) => {
    const agentId = BigInt(index + 1);
    return {
      agentId,
      owner: `0x${agentId.toString().padStart(40, "0")}`,
      boostIds: index % 5 === 0 ? [BigInt(0)] : [],
    };
  });
}

function collectKillFeed(update: EngineTickUpdate, setKillFeed: Dispatch<SetStateAction<KillLine[]>>) {
  const eliminations = update.events.filter((event) => event.type === GameEventType.AGENT_ELIMINATED);
  if (eliminations.length === 0) return;

  setKillFeed((previous) => {
    const next = eliminations.map((event) => ({
      id: `${event.tick}-${event.data.agentId}`,
      tick: event.tick,
      victimId: event.data.agentId,
      killerId: event.data.eliminatedBy,
      source: event.data.eliminatedBy ? "combat" as const : "zone" as const,
    }));
    return [...next, ...previous].slice(0, 8);
  });
}

function HudPill({ icon: Icon, value, danger }: { icon: LucideIcon; value: string; danger?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-black uppercase tracking-[0.08em] backdrop-blur-sm ${danger ? "border-red-400/40 bg-red-500/20 text-red-100" : "border-white/10 bg-black/70 text-neutral-100"}`} style={{ fontFamily: "monospace" }}>
      <Icon size={14} />
      {value}
    </span>
  );
}
