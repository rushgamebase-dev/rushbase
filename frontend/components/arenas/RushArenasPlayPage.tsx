"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  useAccount,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatEther, parseEther } from "viem";
import {
  Activity,
  Bot,
  ChevronRight,
  CircleDollarSign,
  Clock,
  Coins,
  Crown,
  ExternalLink,
  Flame,
  Gauge,
  History,
  Layers,
  Loader2,
  Lock,
  Minus,
  Play,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Header from "@/components/Header";
import { WalletButton } from "@/components/WalletButton";
import {
  AGENT_REGISTRY_ABI,
  ARENA_MANAGER_ABI,
  ARENA_STATE_LABELS,
  ARENA_TIER_LABELS,
  ARENA_TIER_LIMITS,
  BATTLE_ENGINE_ABI,
  RUSH_ARENAS_CONTRACTS,
  type ArenaSection,
  type ArenaState,
  type ArenaTier,
  type RushAgent,
  type RushArena,
  type RushArenaParticipant,
  type RushBattleResult,
  basescanAddressUrl,
} from "@/lib/contracts/rushArenas";

type ReadResult = { status: "success" | "failure"; result?: unknown };
type ArenaSummary = { arena: RushArena; participantCount: bigint; result: RushBattleResult | undefined };

const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const RECENT_ARENA_LIMIT = 16;
const BI_ZERO = BigInt(0);
const BI_ONE = BigInt(1);
const BI_SIX = BigInt(6);
const BI_THIRTEEN = BigInt(13);
const BI_SIXTEEN = BigInt(16);
const BI_TWENTY = BigInt(20);
const BI_HUNDRED = BigInt(100);
const BI_TEN_THOUSAND = BigInt(10000);
const AUTO_CANCEL_GRACE_SECONDS = BigInt(600);
const PSEUDO_A = BigInt(1103515245);
const PSEUDO_B = BigInt(2654435761);
const PSEUDO_C = BigInt(1274126177);

const launchActions = [
  { section: "join", title: "Join Arenas", subtitle: "Open battles and prize pools", href: "/arenas", icon: Swords, accent: "#00ff88" },
  { section: "fleet", title: "Command Fleet", subtitle: "Create and tune fighters", href: "/arenas/fleet", icon: Bot, accent: "#00aaff" },
  { section: "watch", title: "Watch Live", subtitle: "Spectate deterministic replays", href: "/arenas/watch", icon: Play, accent: "#ffd700" },
  { section: "ledger", title: "Proof Ledger", subtitle: "Audit results and payouts", href: "/arenas/ledger", icon: ShieldCheck, accent: "#ff6666" },
] satisfies Array<{
  section: ArenaSection;
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
  accent: string;
}>;

const sectionPanels: Record<ArenaSection, { eyebrow: string; title: string; body: string; bullets: string[]; accent: string }> = {
  join: {
    eyebrow: "arena lobby",
    title: "Create an arena or enter an open battle.",
    body: "Rush Royale is now wired into the Rush surface. Create a fighter, open a paid arena, join with an agent, and follow the state on-chain.",
    bullets: ["Create arena", "Join with fighter", "Lock when ready", "ETH prize pool"],
    accent: "#00ff88",
  },
  fleet: {
    eyebrow: "command fleet",
    title: "Create and manage Rush fighters.",
    body: "Fleet is the fighter-control surface. Your on-chain agents are wallet-bound identities with battle counts, wins, active status, and arena eligibility.",
    bullets: ["Wallet-bound fighters", "Free/fee mint reads", "Activate or park", "Stats on-chain"],
    accent: "#00aaff",
  },
  watch: {
    eyebrow: "watch live",
    title: "Spectate arena state and deterministic seeds.",
    body: "Watch follows recent arenas from open registration through VRF seed, running state, and final result. If a seed exists, the replay preview is deterministic.",
    bullets: ["Live status", "Participants", "Seed preview", "Winner state"],
    accent: "#ffd700",
  },
  ledger: {
    eyebrow: "proof ledger",
    title: "Audit contracts, results, payouts, and refunds.",
    body: "Ledger exposes the on-chain state used by the game: arena config, seed, winner ID, result hash, prize pool, and contract links on Base.",
    bullets: ["Mainnet contracts", "Battle result", "VRF request", "Refund state"],
    accent: "#ff6666",
  },
};

const stateTone: Record<ArenaState, { fg: string; bg: string; label: string }> = {
  0: { fg: "#a3a3a3", bg: "rgba(163,163,163,0.1)", label: "CREATED" },
  1: { fg: "#00ff88", bg: "rgba(0,255,136,0.1)", label: "OPEN" },
  2: { fg: "#ffd700", bg: "rgba(255,215,0,0.12)", label: "LOCKED" },
  3: { fg: "#00aaff", bg: "rgba(0,170,255,0.12)", label: "RUNNING" },
  4: { fg: "#b8ff9f", bg: "rgba(184,255,159,0.1)", label: "FINISHED" },
  5: { fg: "#ff6666", bg: "rgba(255,102,102,0.12)", label: "CANCELLED" },
};

const TIER_ORDER: ArenaTier[] = [0, 1, 2, 3];

const tierVisuals: Record<
  ArenaTier,
  {
    image: string;
    gradient: string;
    border: string;
    text: string;
    bg: string;
    glow: string;
    description: string;
  }
> = {
  0: {
    image: "/images/create-arena/tier-bronze.png",
    gradient: "from-amber-700 to-amber-950",
    border: "border-amber-600/50",
    text: "text-amber-300",
    bg: "bg-amber-500/10",
    glow: "shadow-amber-500/20",
    description: "Entry level battles",
  },
  1: {
    image: "/images/create-arena/tier-silver.png",
    gradient: "from-slate-300 to-slate-700",
    border: "border-slate-300/50",
    text: "text-slate-200",
    bg: "bg-slate-400/10",
    glow: "shadow-slate-300/20",
    description: "Intermediate stakes",
  },
  2: {
    image: "/images/create-arena/tier-gold.png",
    gradient: "from-yellow-500 to-amber-700",
    border: "border-yellow-500/50",
    text: "text-yellow-300",
    bg: "bg-yellow-500/10",
    glow: "shadow-yellow-500/20",
    description: "High roller battles",
  },
  3: {
    image: "/images/create-arena/tier-diamond.png",
    gradient: "from-cyan-300 to-blue-700",
    border: "border-cyan-300/50",
    text: "text-cyan-300",
    bg: "bg-cyan-500/10",
    glow: "shadow-cyan-400/20",
    description: "Elite championship",
  },
};

const stateVisuals: Record<
  ArenaState,
  { image: string; gradient: string; border: string; glow: string; accent: string; pulse: string }
> = {
  0: {
    image: "/images/arenas/start.jpg",
    gradient: "from-zinc-900 via-zinc-800 to-zinc-950",
    border: "border-zinc-700",
    glow: "",
    accent: "text-zinc-400",
    pulse: "bg-zinc-500",
  },
  1: {
    image: "/images/arenas/start.jpg",
    gradient: "from-emerald-950/80 via-zinc-950 to-cyan-950/80",
    border: "border-emerald-500/60",
    glow: "shadow-[0_0_30px_rgba(16,185,129,0.3)]",
    accent: "text-emerald-300",
    pulse: "bg-emerald-500",
  },
  2: {
    image: "/images/arenas/closedarena.jpg",
    gradient: "from-red-950/80 via-zinc-950 to-orange-950/80",
    border: "border-red-500/60",
    glow: "shadow-[0_0_30px_rgba(239,68,68,0.35)]",
    accent: "text-red-300",
    pulse: "bg-red-500",
  },
  3: {
    image: "/images/arenas/battle.jpg",
    gradient: "from-orange-950/80 via-zinc-950 to-red-950/80",
    border: "border-orange-500/60",
    glow: "shadow-[0_0_40px_rgba(249,115,22,0.45)]",
    accent: "text-orange-300",
    pulse: "bg-orange-500",
  },
  4: {
    image: "/images/arenas/end.jpg",
    gradient: "from-violet-950/70 via-zinc-950 to-purple-950/70",
    border: "border-violet-500/60",
    glow: "shadow-[0_0_30px_rgba(139,92,246,0.28)]",
    accent: "text-violet-300",
    pulse: "bg-violet-500",
  },
  5: {
    image: "/images/arenas/closedarena.jpg",
    gradient: "from-zinc-900 via-zinc-800 to-zinc-950",
    border: "border-zinc-600",
    glow: "",
    accent: "text-zinc-400",
    pulse: "bg-zinc-500",
  },
};

export default function RushArenasPlayPage({ section = "join" }: { section?: ArenaSection }) {
  const { address, isConnected } = useAccount();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [selectedArenaId, setSelectedArenaId] = useState<bigint | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<bigint | undefined>();
  const [txLabel, setTxLabel] = useState<string | null>(null);
  const [arenaForm, setArenaForm] = useState({
    tier: 0 as ArenaTier,
    entryFee: "0.001",
    minPlayers: "2",
    maxPlayers: "10",
    durationMinutes: "5",
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);

  const activePanel = sectionPanels[section];

  const { data: baseReads, isLoading: isLoadingBase, refetch: refetchBaseReads } = useReadContracts({
    contracts: [
      { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "totalArenas" },
      { address: RUSH_ARENAS_CONTRACTS.agentRegistry, abi: AGENT_REGISTRY_ABI, functionName: "totalAgents" },
      { address: RUSH_ARENAS_CONTRACTS.agentRegistry, abi: AGENT_REGISTRY_ABI, functionName: "creationFee" },
      { address: RUSH_ARENAS_CONTRACTS.agentRegistry, abi: AGENT_REGISTRY_ABI, functionName: "maxAgentsPerWallet" },
      { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "protocolFeeBps" },
      { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "treasuryAddress" },
      { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "estimateVRFCost" },
      { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "pendingFees" },
      { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "maxAgentsPerArenaPerWallet" },
      { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "commitRevealEnabled" },
    ],
    query: { refetchInterval: 20_000 },
  });

  const baseResults = baseReads as ReadResult[] | undefined;
  const totalArenas = readBigInt(baseResults?.[0]);
  const totalAgents = readBigInt(baseResults?.[1]);
  const creationFee = readBigInt(baseResults?.[2]) ?? BI_ZERO;
  const maxAgentsPerWallet = readBigInt(baseResults?.[3]);
  const protocolFeeBps = readBigInt(baseResults?.[4]);
  const treasury = readAddress(baseResults?.[5]);
  const vrfCost = readBigInt(baseResults?.[6]);
  const pendingFees = readBigInt(baseResults?.[7]);
  const maxAgentsPerArena = readBigInt(baseResults?.[8]);
  const commitRevealEnabled = readBool(baseResults?.[9]);

  const { data: myAgentIdsRaw, refetch: refetchMyAgentIds, isLoading: isLoadingMyAgents } = useReadContract({
    address: RUSH_ARENAS_CONTRACTS.agentRegistry,
    abi: AGENT_REGISTRY_ABI,
    functionName: "getAgentsByOwner",
    args: address ? [address] : undefined,
    query: { enabled: isConnected && !!address, refetchInterval: 20_000 },
  });

  const myAgentIds = useMemo(() => (Array.isArray(myAgentIdsRaw) ? (myAgentIdsRaw as bigint[]) : []), [myAgentIdsRaw]);

  const { data: myAgentReads, refetch: refetchMyAgentReads } = useReadContracts({
    contracts: myAgentIds.map((agentId) => ({
      address: RUSH_ARENAS_CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: "getAgent",
      args: [agentId],
    })),
    query: { enabled: myAgentIds.length > 0, refetchInterval: 20_000 },
  });

  const myAgents = useMemo(() => {
    const rows = (myAgentReads as ReadResult[] | undefined) ?? [];
    return rows.map((row) => normalizeAgent(row.result)).filter((agent): agent is RushAgent => Boolean(agent));
  }, [myAgentReads]);

  useEffect(() => {
    if (!selectedAgentId && myAgents.length > 0) {
      setSelectedAgentId(myAgents.find((a) => a.isActive)?.agentId ?? myAgents[0].agentId);
    }
    if (selectedAgentId && myAgents.length > 0 && !myAgents.some((a) => a.agentId === selectedAgentId)) {
      setSelectedAgentId(myAgents[0].agentId);
    }
  }, [myAgents, selectedAgentId]);

  const recentArenaIds = useMemo(() => {
    const total = totalArenas ? Number(totalArenas) : 0;
    const count = Math.min(total, RECENT_ARENA_LIMIT);
    return Array.from({ length: count }, (_, index) => BigInt(total - index));
  }, [totalArenas]);

  const { data: arenaReads, isLoading: isLoadingArenas, refetch: refetchArenaReads } = useReadContracts({
    contracts: recentArenaIds.flatMap((arenaId) => [
      { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "getArena", args: [arenaId] },
      { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "getParticipantCount", args: [arenaId] },
      { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "getBattleResult", args: [arenaId] },
    ]),
    query: { enabled: recentArenaIds.length > 0, refetchInterval: 15_000 },
  });

  const arenaSummaries = useMemo(() => {
    const rows = (arenaReads as ReadResult[] | undefined) ?? [];
    return recentArenaIds
      .map((arenaId, index) => {
        const offset = index * 3;
        const arena = normalizeArena(rows[offset]?.result);
        if (!arena || arena.arenaId !== arenaId) return undefined;
        return {
          arena,
          participantCount: readBigInt(rows[offset + 1]) ?? BI_ZERO,
          result: normalizeBattleResult(rows[offset + 2]?.result),
        };
      })
      .filter((arena): arena is ArenaSummary => Boolean(arena));
  }, [arenaReads, recentArenaIds]);

  useEffect(() => {
    if (selectedArenaId || arenaSummaries.length === 0) return;
    const preferred =
      arenaSummaries.find((row) => row.arena.state === 3)?.arena.arenaId ??
      arenaSummaries.find((row) => row.arena.state === 2)?.arena.arenaId ??
      arenaSummaries.find((row) => row.arena.state === 1)?.arena.arenaId ??
      arenaSummaries[0].arena.arenaId;
    setSelectedArenaId(preferred);
  }, [arenaSummaries, selectedArenaId]);

  const effectiveSelectedArenaId = selectedArenaId ?? arenaSummaries[0]?.arena.arenaId;

  const { data: selectedReads, refetch: refetchSelectedReads } = useReadContracts({
    contracts: effectiveSelectedArenaId
      ? [
          { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "getArena", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "getArenaParticipants", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "getParticipantCount", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "getBattleResult", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "getVRFRequest", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "getArenaLockedAt", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "getArenaStartedAt", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "isArenaTimedOut", args: [effectiveSelectedArenaId] },
          { address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "isLockTimedOut", args: [effectiveSelectedArenaId] },
        ]
      : [],
    query: { enabled: Boolean(effectiveSelectedArenaId), refetchInterval: 10_000 },
  });

  const selectedResults = selectedReads as ReadResult[] | undefined;
  const selectedArena = normalizeArena(selectedResults?.[0]?.result);
  const selectedParticipants = normalizeParticipants(selectedResults?.[1]?.result);
  const selectedParticipantCount = readBigInt(selectedResults?.[2]);
  const selectedResult = normalizeBattleResult(selectedResults?.[3]?.result);
  const selectedVrfRequest = readBigInt(selectedResults?.[4]);
  const selectedLockedAt = readBigInt(selectedResults?.[5]);
  const selectedStartedAt = readBigInt(selectedResults?.[6]);
  const selectedTimedOut = readBool(selectedResults?.[7]);
  const selectedLockTimedOut = readBool(selectedResults?.[8]);

  const { data: executorAllowed } = useReadContract({
    address: RUSH_ARENAS_CONTRACTS.battleEngine,
    abi: BATTLE_ENGINE_ABI,
    functionName: "authorizedExecutors",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: 30_000 },
  });

  const { data: txHash, writeContract, isPending: isWritePending, error: writeError, reset: resetWrite } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: txSuccess, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!txSuccess) return;
    void refetchBaseReads();
    void refetchMyAgentIds();
    void refetchMyAgentReads();
    void refetchArenaReads();
    void refetchSelectedReads();
  }, [refetchArenaReads, refetchBaseReads, refetchMyAgentIds, refetchMyAgentReads, refetchSelectedReads, txSuccess]);

  const txError = writeError || receiptError;
  const txBusy = isWritePending || isConfirming;

  function refreshAll() {
    void refetchBaseReads();
    void refetchMyAgentIds();
    void refetchMyAgentReads();
    void refetchArenaReads();
    void refetchSelectedReads();
  }

  function createAgent() {
    setTxLabel("Creating fighter");
    resetWrite();
    writeContract({ address: RUSH_ARENAS_CONTRACTS.agentRegistry, abi: AGENT_REGISTRY_ABI, functionName: "createAgent", value: creationFee });
  }

  function toggleAgent(agent: RushAgent) {
    setTxLabel(agent.isActive ? `Parking fighter #${agent.agentId}` : `Activating fighter #${agent.agentId}`);
    resetWrite();
    writeContract({
      address: RUSH_ARENAS_CONTRACTS.agentRegistry,
      abi: AGENT_REGISTRY_ABI,
      functionName: agent.isActive ? "deactivateAgent" : "activateAgent",
      args: [agent.agentId],
    });
  }

  function createArena() {
    const entryFee = safeParseEther(arenaForm.entryFee);
    const minPlayers = BigInt(Math.max(2, Number(arenaForm.minPlayers || 2)));
    const maxPlayers = BigInt(Math.max(Number(minPlayers), Number(arenaForm.maxPlayers || 2)));
    const duration = BigInt(Math.max(5, Number(arenaForm.durationMinutes || 5)) * 60);
    if (entryFee === undefined) {
      setTxLabel("Invalid entry fee");
      return;
    }
    setTxLabel("Creating arena");
    resetWrite();
    writeContract({
      address: RUSH_ARENAS_CONTRACTS.arenaManager,
      abi: ARENA_MANAGER_ABI,
      functionName: "createArena",
      args: [arenaForm.tier, entryFee, minPlayers, maxPlayers, duration],
    });
  }

  function joinArena(arena: RushArena) {
    if (!selectedAgentId) {
      setTxLabel("Create or select a fighter first");
      return;
    }
    setSelectedArenaId(arena.arenaId);
    setTxLabel(`Joining arena #${arena.arenaId}`);
    resetWrite();
    writeContract({
      address: RUSH_ARENAS_CONTRACTS.arenaManager,
      abi: ARENA_MANAGER_ABI,
      functionName: "joinArena",
      args: [arena.arenaId, selectedAgentId, []],
      value: arena.entryFee,
    });
  }

  function lockArena(arenaId: bigint) {
    setTxLabel(`Locking arena #${arenaId}`);
    resetWrite();
    writeContract({ address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "lockArena", args: [arenaId] });
  }

  function requestRandomness(arenaId: bigint) {
    setTxLabel(`Requesting VRF for arena #${arenaId}`);
    resetWrite();
    writeContract({ address: RUSH_ARENAS_CONTRACTS.battleEngine, abi: BATTLE_ENGINE_ABI, functionName: "requestRandomness", args: [arenaId] });
  }

  function autoCancel(arenaId: bigint) {
    setTxLabel(`Auto-cancelling expired arena #${arenaId}`);
    resetWrite();
    writeContract({ address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "autoCancelExpired", args: [arenaId] });
  }

  function claimRefund(arenaId: bigint, agentId: bigint) {
    setTxLabel(`Claiming refund for fighter #${agentId}`);
    resetWrite();
    writeContract({ address: RUSH_ARENAS_CONTRACTS.arenaManager, abi: ARENA_MANAGER_ABI, functionName: "claimRefund", args: [arenaId, agentId] });
  }

  const openArenas = arenaSummaries.filter((row) => row.arena.state === 1);
  const activeArenas = arenaSummaries.filter((row) => row.arena.state === 2 || row.arena.state === 3);
  const finishedArenas = arenaSummaries.filter((row) => row.arena.state === 4);

  return (
    <div className="min-h-screen" style={{ background: "#080808", color: "#e8e8e8" }}>
      <Header />
      <main>
        <section
          className="relative overflow-hidden border-b"
          style={{
            borderColor: "#171717",
            backgroundImage:
              "linear-gradient(90deg, rgba(0,0,0,0.88), rgba(0,0,0,0.54), rgba(0,0,0,0.9)), linear-gradient(0deg, #080808 0%, rgba(8,8,8,0.2) 46%, #080808 100%), url('/images/headers/headerarenas.jpg')",
            backgroundPosition: "center",
            backgroundSize: "cover",
          }}
        >
          <div className="absolute inset-0 opacity-[0.14]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />

          <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-8 md:px-8 md:py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
            <div className="flex min-h-[440px] flex-col justify-center gap-7">
              <div className="flex flex-wrap items-center gap-3">
                <Pill icon={Radio} label="BASE MAINNET" color="#00ff88" />
                <Pill icon={Activity} label="VRF ARENA ENGINE" color="#7ddcff" />
                <Pill icon={ShieldCheck} label="RUSH ROYALE MECHANICS" color="#ffd700" />
              </div>

              <div>
                <div className="relative mb-2 h-16 w-[260px] md:h-20 md:w-[330px]">
                  <Image src="/images/arenas/title-battle-arenas.png" alt="Battle Arenas" fill className="object-contain object-left drop-shadow-[0_0_24px_rgba(139,92,246,0.45)]" priority />
                </div>
                <h1 className="max-w-3xl text-5xl font-black leading-[0.95] md:text-7xl" style={{ color: "#f4f4f4", fontFamily: "ui-monospace, SFMono-Regular, monospace", letterSpacing: 0 }}>
                  RUSH ROYALE
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-300 md:text-lg">
                  Playable arena wiring is now inside Rush: create fighters,
                  open ETH battles, join arenas, watch states, and audit the
                  final ledger from Base mainnet contracts.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {launchActions.map((action) => {
                  const Icon = action.icon;
                  const active = action.section === section;
                  return (
                    <Link key={action.title} href={action.href} className="group flex min-h-[92px] items-center justify-between rounded-lg border p-4 transition-transform hover:-translate-y-0.5" style={{ borderColor: active ? `${action.accent}66` : "#1c1c1c", background: active ? `${action.accent}12` : "#101010", boxShadow: active ? `0 0 28px ${action.accent}18` : "none" }} aria-current={active ? "page" : undefined}>
                      <div className="flex items-center gap-3">
                        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border" style={{ borderColor: `${action.accent}44`, background: `${action.accent}14`, color: action.accent }}>
                          <Icon size={21} />
                        </span>
                        <span>
                          <span className="block text-sm font-black text-white">{action.title}</span>
                          <span className="mt-1 block text-xs leading-5 text-neutral-500">{action.subtitle}</span>
                        </span>
                      </div>
                      <ChevronRight size={17} className="shrink-0 text-neutral-600 transition-colors group-hover:text-white" />
                    </Link>
                  );
                })}
              </div>

              <div className="rounded-lg border p-4" style={{ borderColor: `${activePanel.accent}38`, background: `${activePanel.accent}0f` }}>
                <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: activePanel.accent, fontFamily: "monospace" }}>
                  {activePanel.eyebrow}
                </div>
                <h2 className="text-xl font-black text-white">{activePanel.title}</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-300">{activePanel.body}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {activePanel.bullets.map((bullet) => (
                    <div key={bullet} className="rounded-md border px-3 py-2 text-xs font-bold text-neutral-200" style={{ borderColor: `${activePanel.accent}24`, background: "rgba(0,0,0,0.24)", fontFamily: "monospace" }}>
                      {bullet}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <ArenaStatusPanel
              isLoading={isLoadingBase}
              isConnected={isConnected}
              totalArenas={totalArenas}
              totalAgents={totalAgents}
              creationFee={creationFee}
              protocolFeeBps={protocolFeeBps}
              pendingFees={pendingFees}
              treasury={treasury}
              refreshAll={refreshAll}
            />
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-8 md:px-8">
          <TxStatus label={txLabel} hash={txHash} busy={txBusy} success={txSuccess} error={txError} />

          {section === "join" && (
            <JoinPanel
              address={address}
              isConnected={isConnected}
              myAgents={myAgents}
              selectedAgentId={selectedAgentId}
              setSelectedAgentId={setSelectedAgentId}
              createAgent={createAgent}
              creationFee={creationFee}
              txBusy={txBusy}
              arenaForm={arenaForm}
              setArenaForm={setArenaForm}
              createArena={createArena}
              arenas={arenaSummaries}
              openArenas={openArenas}
              isLoadingArenas={isLoadingArenas}
              now={now}
              onJoin={joinArena}
              onLock={lockArena}
              onAutoCancel={autoCancel}
              setSelectedArenaId={setSelectedArenaId}
            />
          )}

          {section === "fleet" && (
            <FleetPanel
              isConnected={isConnected}
              isLoading={isLoadingMyAgents}
              myAgents={myAgents}
              creationFee={creationFee}
              maxAgentsPerWallet={maxAgentsPerWallet}
              maxAgentsPerArena={maxAgentsPerArena}
              createAgent={createAgent}
              toggleAgent={toggleAgent}
              txBusy={txBusy}
            />
          )}

          {section === "watch" && (
            <WatchPanel
              arenas={arenaSummaries}
              activeArenas={activeArenas}
              selectedArena={selectedArena}
              selectedResult={selectedResult}
              selectedParticipants={selectedParticipants}
              selectedParticipantCount={selectedParticipantCount}
              selectedVrfRequest={selectedVrfRequest}
              selectedLockedAt={selectedLockedAt}
              selectedStartedAt={selectedStartedAt}
              selectedTimedOut={selectedTimedOut}
              selectedLockTimedOut={selectedLockTimedOut}
              selectedArenaId={effectiveSelectedArenaId}
              setSelectedArenaId={setSelectedArenaId}
              now={now}
              lockArena={lockArena}
              requestRandomness={requestRandomness}
              executorAllowed={Boolean(executorAllowed)}
              txBusy={txBusy}
            />
          )}

          {section === "ledger" && (
            <LedgerPanel
              arenas={arenaSummaries}
              finishedArenas={finishedArenas}
              selectedArena={selectedArena}
              selectedResult={selectedResult}
              selectedParticipants={selectedParticipants}
              selectedVrfRequest={selectedVrfRequest}
              selectedLockedAt={selectedLockedAt}
              selectedStartedAt={selectedStartedAt}
              setSelectedArenaId={setSelectedArenaId}
              treasury={treasury}
              vrfCost={vrfCost}
              protocolFeeBps={protocolFeeBps}
              commitRevealEnabled={commitRevealEnabled}
              claimRefund={claimRefund}
              myAgents={myAgents}
              txBusy={txBusy}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function ArenaStatusPanel({ isLoading, isConnected, totalArenas, totalAgents, creationFee, protocolFeeBps, pendingFees, treasury, refreshAll }: { isLoading: boolean; isConnected: boolean; totalArenas?: bigint; totalAgents?: bigint; creationFee: bigint; protocolFeeBps?: bigint; pendingFees?: bigint; treasury?: `0x${string}`; refreshAll: () => void }) {
  return (
    <div className="flex items-center">
      <div className="relative w-full overflow-hidden rounded-lg border p-5" style={{ borderColor: "rgba(0,255,136,0.16)", background: "rgba(10,10,10,0.78)", boxShadow: "0 24px 90px rgba(0,0,0,0.45)" }}>
        <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
          <div>
            <div className="text-xs font-black tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>ARENA STATUS</div>
            <div className="mt-1 text-sm text-neutral-300">{isConnected ? "Wallet connected to Rush Royale" : "Connect wallet to play"}</div>
          </div>
          <button onClick={refreshAll} className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-bold text-neutral-300 transition-colors hover:text-white" style={{ borderColor: "#242424", background: "#111", fontFamily: "monospace" }}>
            <RefreshCw size={14} />
            REFRESH
          </button>
        </div>

        <div className="grid gap-3 py-5 sm:grid-cols-2">
          <MetricCard label="Arenas" value={formatCount(totalArenas, isLoading)} icon={Trophy} accent="#00ff88" />
          <MetricCard label="Fighters" value={formatCount(totalAgents, isLoading)} icon={Bot} accent="#00aaff" />
          <MetricCard label="Create Fee" value={formatEthValue(creationFee)} icon={Coins} accent="#ffd700" />
          <MetricCard label="Protocol Fee" value={formatBps(protocolFeeBps, isLoading)} icon={Gauge} accent="#ff6666" />
        </div>

        <div className="relative min-h-[220px] overflow-hidden rounded-xl border border-white/10 bg-black">
          <Image src="/images/arenas/battle.jpg" alt="Rush arena battle" fill className="object-cover opacity-70" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/50" />
          <div className="absolute inset-8 rounded-full border border-dashed border-emerald-300/25" />
          <div className="absolute inset-16 rounded-full border border-cyan-300/20" />
          <div className="relative flex min-h-[220px] items-center justify-center">
            <div className="grid grid-cols-3 gap-3">
              {[1, 7, 14].map((ship) => (
                <div key={ship} className="relative h-16 w-16 rounded-full border-2 border-black/80 bg-zinc-950/80 p-1 shadow-[0_0_26px_rgba(0,255,136,0.25)]">
                  <Image src={`/images/ships/ship-${ship}.png`} alt="" fill className="object-cover" sizes="64px" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-xs text-neutral-400 sm:grid-cols-2">
          <MiniFact label="Pending fees" value={formatEthValue(pendingFees)} />
          <MiniFact label="Treasury" value={shortAddress(treasury)} />
        </div>
      </div>
    </div>
  );
}

function JoinPanel({ address, isConnected, myAgents, selectedAgentId, setSelectedAgentId, createAgent, creationFee, txBusy, arenaForm, setArenaForm, createArena, arenas, openArenas, isLoadingArenas, now, onJoin, onLock, onAutoCancel, setSelectedArenaId }: { address?: `0x${string}`; isConnected: boolean; myAgents: RushAgent[]; selectedAgentId?: bigint; setSelectedAgentId: (id: bigint | undefined) => void; createAgent: () => void; creationFee: bigint; txBusy: boolean; arenaForm: { tier: ArenaTier; entryFee: string; minPlayers: string; maxPlayers: string; durationMinutes: string }; setArenaForm: (form: { tier: ArenaTier; entryFee: string; minPlayers: string; maxPlayers: string; durationMinutes: string }) => void; createArena: () => void; arenas: ArenaSummary[]; openArenas: ArenaSummary[]; isLoadingArenas: boolean; now: number; onJoin: (arena: RushArena) => void; onLock: (arenaId: bigint) => void; onAutoCancel: (arenaId: bigint) => void; setSelectedArenaId: (arenaId: bigint) => void }) {
  const activeAgents = myAgents.filter((agent) => agent.isActive);
  const selectedAgent = myAgents.find((agent) => agent.agentId === selectedAgentId);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(380px,1.08fr)]">
      <div className="space-y-4">
        <SectionTitle icon={Swords} eyebrow="play now" title="Arena lobby" />
        <Panel>
          {!isConnected ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-6 text-neutral-300">Connect a Base wallet to create fighters, open arenas, and join Rush Royale battles.</p>
              <WalletButton />
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>selected fighter</div>
                {myAgents.length === 0 ? (
                  <div className="rounded-lg border border-[#00aaff]/25 bg-[#00aaff]/10 p-4">
                    <p className="text-sm leading-6 text-[#b9ecff]">This wallet has no fighter yet. Create one first, then enter an arena.</p>
                    <button onClick={createAgent} disabled={txBusy} className="mt-4 inline-flex items-center gap-2 rounded-md border border-[#00aaff]/40 bg-[#00aaff]/15 px-4 py-2 text-sm font-black text-[#9be8ff] disabled:opacity-50">
                      {txBusy ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
                      Create fighter {creationFee === BI_ZERO ? "free" : `(${formatEthValue(creationFee)})`}
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    <select value={selectedAgentId?.toString() ?? ""} onChange={(event) => setSelectedAgentId(event.target.value ? BigInt(event.target.value) : undefined)} className="w-full rounded-md border border-neutral-800 bg-black px-3 py-3 text-sm text-white outline-none focus:border-[#00ff88]/60">
                      {myAgents.map((agent) => (
                        <option key={agent.agentId.toString()} value={agent.agentId.toString()}>
                          Fighter #{agent.agentId.toString()} - {agent.isActive ? "active" : "parked"} - {agent.totalWins.toString()}W/{agent.totalBattles.toString()}B
                        </option>
                      ))}
                    </select>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <MiniFact label="Wallet" value={shortAddress(address)} />
                      <MiniFact label="Active fighters" value={`${activeAgents.length}/${myAgents.length}`} />
                      <MiniFact label="Selected" value={selectedAgent ? `#${selectedAgent.agentId}` : "None"} />
                    </div>
                  </div>
                )}
              </div>

              <CreateArenaConsole arenaForm={arenaForm} setArenaForm={setArenaForm} createArena={createArena} txBusy={txBusy} />
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <SectionTitle icon={Zap} eyebrow={`${openArenas.length} open / ${arenas.length} recent`} title="Recent arenas" />
        {isLoadingArenas ? <LoadingBox label="Loading arenas from Base" /> : arenas.length === 0 ? <EmptyBox title="No arenas yet" body="Create the first Rush Royale arena from the lobby panel." /> : (
          <div className="grid gap-3">
            {arenas.map((row) => (
              <ArenaCard key={row.arena.arenaId.toString()} row={row} now={now} selectedAgentId={selectedAgentId} onJoin={onJoin} onLock={onLock} onAutoCancel={onAutoCancel} onSelect={setSelectedArenaId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateArenaConsole({ arenaForm, setArenaForm, createArena, txBusy }: { arenaForm: { tier: ArenaTier; entryFee: string; minPlayers: string; maxPlayers: string; durationMinutes: string }; setArenaForm: (form: { tier: ArenaTier; entryFee: string; minPlayers: string; maxPlayers: string; durationMinutes: string }) => void; createArena: () => void; txBusy: boolean }) {
  const visual = tierVisuals[arenaForm.tier];
  const limits = ARENA_TIER_LIMITS[arenaForm.tier];
  const minFee = Number(limits.minFeeEth);
  const maxFee = Number(limits.maxFeeEth);
  const rawFee = Number(arenaForm.entryFee);
  const currentFee = Number.isFinite(rawFee) ? Math.min(maxFee, Math.max(minFee, rawFee)) : minFee;
  const feeRange = Math.max(0.001, maxFee - minFee);
  const feePercent = Math.min(100, Math.max(0, ((currentFee - minFee) / feeRange) * 100));
  const maxPlayers = Math.min(limits.maxPlayers, Math.max(limits.minPlayers, Number(arenaForm.maxPlayers || limits.minPlayers)));
  const maxPrize = currentFee * maxPlayers;

  function updateTier(tier: ArenaTier) {
    const next = ARENA_TIER_LIMITS[tier];
    setArenaForm({
      ...arenaForm,
      tier,
      entryFee: next.minFeeEth,
      minPlayers: String(next.minPlayers),
      maxPlayers: String(Math.min(next.maxPlayers, Math.max(next.minPlayers, 20))),
    });
  }

  function updateMaxPlayers(value: number) {
    const next = Math.min(limits.maxPlayers, Math.max(limits.minPlayers, value));
    setArenaForm({ ...arenaForm, minPlayers: String(limits.minPlayers), maxPlayers: String(next) });
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${visual.border} bg-gradient-to-b from-zinc-900 via-zinc-900 to-zinc-950 shadow-2xl ${visual.glow}`}>
      <div className={`absolute inset-x-0 top-0 h-32 bg-gradient-to-b ${visual.gradient} opacity-20`} />

      <div className="relative flex items-center gap-3 border-b border-zinc-800/60 px-4 py-4">
        <div className="relative h-14 w-14 shrink-0">
          <Image src={visual.image} alt={ARENA_TIER_LABELS[arenaForm.tier]} fill className="object-contain drop-shadow-[0_0_12px_rgba(255,255,255,0.35)]" />
        </div>
        <div>
          <div className="text-lg font-black text-white">Create Arena</div>
          <div className={`text-xs font-bold ${visual.text}`}>{ARENA_TIER_LABELS[arenaForm.tier]} Tier</div>
        </div>
      </div>

      <div className="relative space-y-5 p-4">
        <div>
          <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-zinc-500" style={{ fontFamily: "monospace" }}>Select Tier</div>
          <div className="grid grid-cols-4 gap-2">
            {TIER_ORDER.map((tier) => {
              const config = tierVisuals[tier];
              const selected = arenaForm.tier === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  onClick={() => updateTier(tier)}
                  className={`relative flex min-h-[92px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 py-2 transition-all duration-300 ${selected ? `scale-105 bg-gradient-to-b ${config.gradient} border-white/30 shadow-lg` : "border-zinc-700/50 bg-zinc-800/50 hover:border-zinc-500"}`}
                >
                  <span className="relative h-10 w-10 md:h-12 md:w-12">
                    <Image src={config.image} alt={ARENA_TIER_LABELS[tier]} fill className={`object-contain ${selected ? "drop-shadow-[0_0_9px_rgba(255,255,255,0.5)]" : ""}`} />
                  </span>
                  <span className={`text-xs font-black ${selected ? "text-white" : "text-zinc-400"}`}>{ARENA_TIER_LABELS[tier]}</span>
                  {selected && <span className="absolute -bottom-1 left-1/2 h-1 w-5 -translate-x-1/2 rounded-full bg-white" />}
                </button>
              );
            })}
          </div>
          <p className={`mt-3 text-center text-xs font-bold ${visual.text}`}>{visual.description}</p>
        </div>

        <div className={`rounded-xl border p-4 ${visual.border} ${visual.bg}`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-300">
              <Coins className={`h-4 w-4 ${visual.text}`} />
              Entry Fee
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-black ${visual.text}`}>{currentFee.toFixed(3)}</span>
              <span className="text-sm font-bold text-zinc-500">ETH</span>
            </div>
          </div>
          <div className="relative flex h-8 items-center">
            <div className="absolute inset-x-0 h-2 rounded-full bg-zinc-700">
              <div className={`h-full rounded-full bg-gradient-to-r ${visual.gradient}`} style={{ width: `${feePercent}%` }} />
            </div>
            <input
              type="range"
              min={minFee}
              max={maxFee}
              step={0.001}
              value={currentFee}
              onChange={(event) => setArenaForm({ ...arenaForm, entryFee: formatEthInput(Number(event.target.value)), minPlayers: String(limits.minPlayers) })}
              className="absolute inset-x-0 h-8 w-full cursor-pointer opacity-0"
            />
            <div className={`pointer-events-none absolute h-5 w-5 rounded-full border-4 bg-white ${visual.border} shadow-lg`} style={{ left: `calc(${feePercent}% - 10px)` }} />
          </div>
          <div className="mt-1 flex justify-between text-xs text-zinc-500">
            <span>{limits.minFeeEth} ETH</span>
            <span>{limits.maxFeeEth} ETH</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-zinc-400">
              <Users className="h-3.5 w-3.5" />
              Min to Start
            </div>
            <div className="text-center text-2xl font-black text-zinc-200">{limits.minPlayers}</div>
            <div className="mt-1 text-center text-[10px] text-zinc-500">Auto-starts with {limits.minPlayers}+ players</div>
          </div>

          <div className="rounded-xl border border-zinc-700/50 bg-zinc-800/50 p-3">
            <div className="mb-2 text-xs font-bold text-zinc-400">Max Players</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => updateMaxPlayers(maxPlayers - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-700 text-white transition-colors hover:bg-zinc-600">
                <Minus size={14} />
              </button>
              <span className="flex-1 text-center text-2xl font-black text-white">{maxPlayers}</span>
              <button type="button" onClick={() => updateMaxPlayers(maxPlayers + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-700 text-white transition-colors hover:bg-zinc-600">
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-bold text-zinc-400">
            <Clock className="h-3.5 w-3.5" />
            Registration Time
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[5, 10, 15, 30].map((minutes) => {
              const selected = arenaForm.durationMinutes === String(minutes);
              return (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setArenaForm({ ...arenaForm, durationMinutes: String(minutes), minPlayers: String(limits.minPlayers) })}
                  className={`rounded-lg py-2 text-sm font-bold transition-all ${selected ? `bg-gradient-to-r ${visual.gradient} text-white` : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"}`}
                >
                  {minutes}m
                </button>
              );
            })}
          </div>
        </div>

        <div className={`relative overflow-hidden rounded-xl border-2 border-white/10 bg-gradient-to-br ${visual.gradient} p-4`}>
          <div className="absolute -right-2 -top-2 h-20 w-20 opacity-40">
            <Image src="/images/create-arena/icon-prize-pool.png" alt="" fill className="object-contain" />
          </div>
          <div className="relative">
            <div className="mb-1 flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-200" />
              <span className="text-sm font-bold text-white/80">Max Prize Pool</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-white">{maxPrize.toFixed(3)}</span>
              <span className="text-lg font-black text-white/60">ETH</span>
            </div>
            <p className="mt-1 text-xs text-white/55">{maxPlayers} players x {currentFee.toFixed(3)} ETH each</p>
          </div>
        </div>

        <button
          type="button"
          onClick={createArena}
          disabled={txBusy}
          className={`relative w-full overflow-hidden rounded-xl bg-gradient-to-r ${visual.gradient} py-4 text-sm font-black uppercase tracking-[0.16em] text-white shadow-lg transition-all hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60`}
        >
          {txBusy ? (
            <span className="flex items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Creating Arena...</span>
          ) : (
            <span className="flex items-center justify-center gap-2"><Swords className="h-5 w-5" />Create {ARENA_TIER_LABELS[arenaForm.tier]} Arena</span>
          )}
        </button>
      </div>
    </div>
  );
}

function FleetPanel({ isConnected, isLoading, myAgents, creationFee, maxAgentsPerWallet, maxAgentsPerArena, createAgent, toggleAgent, txBusy }: { isConnected: boolean; isLoading: boolean; myAgents: RushAgent[]; creationFee: bigint; maxAgentsPerWallet?: bigint; maxAgentsPerArena?: bigint; createAgent: () => void; toggleAgent: (agent: RushAgent) => void; txBusy: boolean }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(420px,1.2fr)]">
      <div className="space-y-4">
        <SectionTitle icon={Bot} eyebrow="wallet fleet" title="Command Fleet" />
        <Panel>
          {!isConnected ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-6 text-neutral-300">Connect your wallet to read and command your Rush fighters.</p>
              <WalletButton />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <MiniFact label="Fighters owned" value={String(myAgents.length)} />
                <MiniFact label="Max per wallet" value={formatCount(maxAgentsPerWallet, false)} />
                <MiniFact label="Max per arena" value={formatCount(maxAgentsPerArena, false)} />
                <MiniFact label="Create cost" value={creationFee === BI_ZERO ? "Free" : formatEthValue(creationFee)} />
              </div>
              <button onClick={createAgent} disabled={txBusy || (maxAgentsPerWallet !== undefined && BigInt(myAgents.length) >= maxAgentsPerWallet)} className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-[#00aaff]/40 bg-[#00aaff]/14 px-4 py-3 text-sm font-black text-[#9be8ff] transition-colors hover:bg-[#00aaff]/20 disabled:opacity-50">
                {txBusy ? <Loader2 size={16} className="animate-spin" /> : <Bot size={16} />}
                Create Rush fighter
              </button>
            </div>
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <SectionTitle icon={Layers} eyebrow="battle-ready identities" title="Your fighters" />
        {isLoading ? <LoadingBox label="Loading fighters" /> : !isConnected ? <EmptyBox title="Wallet required" body="Your fleet appears here after connecting." /> : myAgents.length === 0 ? <EmptyBox title="No fighters yet" body="Create your first fighter to enter a Rush Royale arena." /> : (
          <div className="grid gap-3 md:grid-cols-2">
            {myAgents.map((agent) => <FighterCard key={agent.agentId.toString()} agent={agent} toggleAgent={toggleAgent} txBusy={txBusy} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function WatchPanel({ arenas, activeArenas, selectedArena, selectedResult, selectedParticipants, selectedParticipantCount, selectedVrfRequest, selectedLockedAt, selectedStartedAt, selectedTimedOut, selectedLockTimedOut, selectedArenaId, setSelectedArenaId, now, lockArena, requestRandomness, executorAllowed, txBusy }: { arenas: ArenaSummary[]; activeArenas: ArenaSummary[]; selectedArena?: RushArena; selectedResult?: RushBattleResult; selectedParticipants: RushArenaParticipant[]; selectedParticipantCount?: bigint; selectedVrfRequest?: bigint; selectedLockedAt?: bigint; selectedStartedAt?: bigint; selectedTimedOut?: boolean; selectedLockTimedOut?: boolean; selectedArenaId?: bigint; setSelectedArenaId: (arenaId: bigint) => void; now: number; lockArena: (arenaId: bigint) => void; requestRandomness: (arenaId: bigint) => void; executorAllowed: boolean; txBusy: boolean }) {
  const [demoMuted, setDemoMuted] = useState(true);
  const lockedNeedsVrf = selectedArena?.state === 2 && (selectedVrfRequest ?? BI_ZERO) === BI_ZERO;
  const openCanLock = selectedArena?.state === 1 && selectedParticipantCount !== undefined && selectedParticipantCount >= selectedArena.minPlayers && (BigInt(now) >= selectedArena.registrationEnd || selectedParticipantCount >= selectedArena.maxPlayers);

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-4">
        <SectionTitle icon={Play} eyebrow={`${activeArenas.length} active`} title="Watch queue" />
        <Panel>
          <div className="grid gap-2">
            {arenas.map((row) => (
              <button key={row.arena.arenaId.toString()} onClick={() => setSelectedArenaId(row.arena.arenaId)} className="flex items-center justify-between rounded-md border px-3 py-3 text-left transition-colors hover:border-[#ffd700]/35" style={{ borderColor: row.arena.arenaId === selectedArenaId ? "#ffd70066" : "#181818", background: row.arena.arenaId === selectedArenaId ? "rgba(255,215,0,0.08)" : "#090909" }}>
                <span>
                  <span className="block text-sm font-black text-white">Arena #{row.arena.arenaId.toString()}</span>
                  <span className="mt-1 block text-xs text-neutral-500">{ARENA_TIER_LABELS[row.arena.tier]} - {formatEthValue(row.arena.entryFee)}</span>
                </span>
                <StateBadge state={row.arena.state} />
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <SectionTitle icon={Radio} eyebrow="demo battle feed" title="Watch Live" />
        <DemoBattlePreview muted={demoMuted} onToggleMute={() => setDemoMuted((value) => !value)} />

        <SectionTitle icon={Swords} eyebrow="deterministic replay" title={selectedArena ? `Arena #${selectedArena.arenaId}` : "Select arena"} />
        {selectedArena ? (
          <>
            <Panel>
              <div className="grid gap-3 sm:grid-cols-4">
                <MiniFact label="State" value={ARENA_STATE_LABELS[selectedArena.state]} />
                <MiniFact label="Participants" value={`${selectedParticipantCount ?? BI_ZERO}/${selectedArena.maxPlayers}`} />
                <MiniFact label="Prize pool" value={formatEthValue(selectedArena.prizePool)} />
                <MiniFact label="VRF request" value={selectedVrfRequest && selectedVrfRequest > BI_ZERO ? `#${selectedVrfRequest}` : "Waiting"} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {openCanLock && <ActionButton disabled={txBusy} onClick={() => lockArena(selectedArena.arenaId)} icon={Lock}>Lock arena</ActionButton>}
                {lockedNeedsVrf && executorAllowed && <ActionButton disabled={txBusy} onClick={() => requestRandomness(selectedArena.arenaId)} icon={Zap}>Request VRF</ActionButton>}
                {lockedNeedsVrf && !executorAllowed && <div className="rounded-md border border-[#ffd700]/25 bg-[#ffd700]/10 px-3 py-2 text-xs text-[#ffe889]">Arena is locked. VRF must be requested by an authorized executor.</div>}
                {selectedLockTimedOut && <div className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">Lock timeout detected. Executor/admin can clear or cancel.</div>}
                {selectedTimedOut && <div className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">Running timeout detected. This arena needs operator resolution.</div>}
              </div>
            </Panel>
            <ReplayPanel arena={selectedArena} result={selectedResult} participants={selectedParticipants} lockedAt={selectedLockedAt} startedAt={selectedStartedAt} now={now} />
          </>
        ) : <EmptyBox title="No arena selected" body="Recent arenas will appear here after the on-chain reads return." />}
      </div>
    </div>
  );
}

function DemoBattlePreview({ muted, onToggleMute }: { muted: boolean; onToggleMute: () => void }) {
  const [demo, setDemo] = useState<DemoBattleState>(() => createDemoBattle(1));
  const aliveFighters = demo.fighters.filter((fighter) => fighter.alive);
  const winner = aliveFighters.length === 1 ? aliveFighters[0] : demo.winner;
  const resetDemo = () => setDemo(createDemoBattle(demo.seed + demo.round + 1));

  useEffect(() => {
    const interval = setInterval(() => {
      setDemo((state) => advanceDemoBattle(state));
    }, 90);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="overflow-hidden rounded-2xl border border-violet-400/30 bg-black shadow-[0_0_46px_rgba(139,92,246,0.22)]">
      <div className="relative min-h-[430px] overflow-hidden">
        <Image src="/images/watch/background.jpg" alt="" fill className="object-cover opacity-45" sizes="(min-width: 1024px) 760px, 100vw" priority={false} />
        <video autoPlay loop muted={muted} playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover opacity-45">
          <source src="/videos/demo-battle.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,transparent_0,rgba(0,0,0,0.18)_45%,rgba(0,0,0,0.88)_100%)]" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/85 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black via-black/72 to-transparent" />

        <div className="absolute inset-0">
          <div className="absolute left-1/2 top-1/2 rounded-full border border-cyan-200/20 bg-cyan-300/[0.03] shadow-[0_0_48px_rgba(34,211,238,0.12)]" style={{ width: `${demo.zoneRadius * 2}%`, height: `${demo.zoneRadius * 2}%`, transform: "translate(-50%, -50%)" }} />
          <div className="absolute left-1/2 top-1/2 h-[68%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-violet-200/20" />
          <div className="absolute left-1/2 top-1/2 h-[38%] w-[38%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-200/15" />
          {demo.shots.map((shot) => {
            const dx = shot.toX - shot.fromX;
            const dy = shot.toY - shot.fromY;
            return (
              <span
                key={shot.id}
                className="absolute h-[2px] origin-left rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(103,232,249,0.95)]"
                style={{
                  left: `${shot.fromX}%`,
                  top: `${shot.fromY}%`,
                  width: `${Math.max(5, Math.hypot(dx, dy))}%`,
                  transform: `rotate(${Math.atan2(dy, dx)}rad)`,
                  opacity: Math.max(0, 1 - (demo.tick - shot.tick) / 8),
                }}
              />
            );
          })}
          {demo.fighters.map((fighter) => (
            <div
              key={fighter.id}
              className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-[left,top,opacity] duration-100 ease-linear"
              style={{ left: `${fighter.x}%`, top: `${fighter.y}%`, opacity: fighter.alive ? 1 : 0.18 }}
            >
              <div className="relative h-12 w-12 overflow-hidden rounded-full border-2 bg-black shadow-[0_0_22px_rgba(0,255,136,0.2)] sm:h-14 sm:w-14" style={{ borderColor: fighter.alive ? fighter.color : "#525252" }}>
                <Image src={shipImageForAgent(BigInt(fighter.ship))} alt={`Demo fighter ${fighter.id}`} fill className="object-cover" sizes="56px" />
              </div>
              {fighter.alive ? (
                <div className="w-16 rounded bg-black/75 p-1 shadow-[0_0_12px_rgba(0,0,0,0.8)]">
                  <div className="h-1 rounded bg-red-950">
                    <div className="h-1 rounded bg-gradient-to-r from-emerald-400 to-cyan-300" style={{ width: `${Math.max(0, Math.min(100, fighter.health))}%` }} />
                  </div>
                  <div className="mt-1 truncate text-center text-[9px] font-black text-white" style={{ fontFamily: "monospace" }}>#{fighter.id}</div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="absolute left-5 top-5 flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-red-400/45 bg-red-500/15 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-red-100" style={{ fontFamily: "monospace" }}>
            <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.9)]" />
            live demo
          </span>
          <span className="rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-100" style={{ fontFamily: "monospace" }}>rush royale</span>
        </div>

        <button type="button" onClick={onToggleMute} className="absolute right-5 top-5 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/70 text-white transition-colors hover:border-cyan-300/50 hover:text-cyan-200" aria-label={muted ? "Unmute demo battle" : "Mute demo battle"}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>

        <div className="absolute inset-x-5 bottom-5">
          <div className="max-w-[520px]">
            <Image src="/images/watch/title-watch-live.png" alt="Watch Live" width={420} height={178} className="h-auto w-full max-w-[360px] drop-shadow-[0_0_24px_rgba(139,92,246,0.55)]" />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={resetDemo} className="transition-transform hover:scale-[1.02]" aria-label="Restart demo battle">
                <Image src="/images/watch/btn-spectate-live.png" alt="Spectate live" width={206} height={58} className="h-auto w-[150px] sm:w-[178px]" />
              </button>
              <button type="button" onClick={resetDemo} className="transition-transform hover:scale-[1.02]" aria-label="Start demo battle">
                <Image src="/images/watch/btn-start-demo.png" alt="Start demo" width={206} height={58} className="h-auto w-[150px] sm:w-[178px]" />
              </button>
            </div>
          </div>
        </div>

        <div className="absolute right-5 bottom-5 hidden w-56 rounded-xl border border-white/10 bg-black/75 p-3 backdrop-blur-sm md:block">
          <div className="grid grid-cols-2 gap-2">
            <MiniFact label="Ships alive" value={`${aliveFighters.length}/18`} />
            <MiniFact label="Zone" value={`${Math.round(demo.zoneRadius * 2)}%`} />
          </div>
          <div className="mt-3 space-y-1">
            {demo.events.slice(0, 3).map((event) => (
              <div key={event.id} className="truncate rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] font-bold text-neutral-200">{event.message}</div>
            ))}
          </div>
        </div>

        {winner ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
            <div className="rounded-2xl border border-yellow-300/40 bg-black/80 px-8 py-6 text-center shadow-[0_0_48px_rgba(250,204,21,0.3)]">
              <Crown className="mx-auto h-10 w-10 text-yellow-300" />
              <div className="mt-2 text-xs font-black uppercase tracking-[0.18em] text-yellow-200" style={{ fontFamily: "monospace" }}>winner takes all</div>
              <div className="mt-2 text-3xl font-black text-white">Fighter #{winner.id}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 border-t border-white/10 bg-black/85 p-4 md:grid-cols-3">
        <WatchInfoCard image="/images/watch/card-agents-enter.png" icon={Swords} label="fighters enter" value="ships drop into orbit" />
        <WatchInfoCard image="/images/watch/card-death-zone.png" icon={Skull} label="death zone" value="arena pressure rises" />
        <WatchInfoCard image="/images/watch/card-winner-takes-all.png" icon={Crown} label="winner takes all" value="last fighter claims" />
      </div>
    </div>
  );
}

type DemoFighter = {
  id: number;
  ship: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  health: number;
  alive: boolean;
  color: string;
  kills: number;
};

type DemoShot = {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tick: number;
};

type DemoEvent = {
  id: string;
  message: string;
};

type DemoBattleState = {
  seed: number;
  round: number;
  tick: number;
  zoneRadius: number;
  fighters: DemoFighter[];
  shots: DemoShot[];
  events: DemoEvent[];
  winner?: DemoFighter;
  restartAt?: number;
};

function WatchInfoCard({ image, icon: Icon, label, value }: { image: string; icon: typeof Swords; label: string; value: string }) {
  return (
    <div className="relative min-h-[118px] overflow-hidden rounded-xl border border-white/10 bg-zinc-950">
      <Image src={image} alt="" fill className="object-cover opacity-80" sizes="(min-width: 768px) 220px, 100vw" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
      <div className="absolute inset-x-4 bottom-4">
        <div className="mb-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-cyan-100" style={{ fontFamily: "monospace" }}><Icon size={13} />{label}</div>
        <div className="text-sm font-black text-white">{value}</div>
      </div>
    </div>
  );
}

function createDemoBattle(seed: number): DemoBattleState {
  const random = seededRandom(seed);
  const colors = ["#22c55e", "#06b6d4", "#a78bfa", "#facc15", "#fb7185", "#38bdf8"];
  const fighters = Array.from({ length: 18 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 18;
    const radius = 30 + random() * 10;
    return {
      id: index + 1,
      ship: index + 1,
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      targetX: 35 + random() * 30,
      targetY: 35 + random() * 30,
      health: 100,
      alive: true,
      color: colors[index % colors.length],
      kills: 0,
    };
  });

  return {
    seed,
    round: seed,
    tick: 0,
    zoneRadius: 43,
    fighters,
    shots: [],
    events: [{ id: `start-${seed}`, message: "18 fighters entered orbit" }],
  };
}

function advanceDemoBattle(state: DemoBattleState): DemoBattleState {
  if (state.restartAt && state.tick >= state.restartAt) {
    return createDemoBattle(state.seed + 1);
  }

  const tick = state.tick + 1;
  const random = seededRandom(state.seed * 10000 + tick);
  const zoneRadius = Math.max(18, 43 - tick * 0.028);
  const events: DemoEvent[] = [...state.events];
  const shots: DemoShot[] = state.shots.filter((shot) => tick - shot.tick < 8);
  let fighters = state.fighters.map((fighter) => ({ ...fighter }));
  const aliveBefore = fighters.filter((fighter) => fighter.alive);

  fighters = fighters.map((fighter) => {
    if (!fighter.alive) return fighter;
    let targetX = fighter.targetX;
    let targetY = fighter.targetY;
    if (tick % (22 + (fighter.id % 7)) === 0) {
      const angle = random() * Math.PI * 2;
      const radius = random() * Math.max(12, zoneRadius - 8);
      targetX = 50 + Math.cos(angle) * radius;
      targetY = 50 + Math.sin(angle) * radius;
    }

    const x = clamp(fighter.x + (targetX - fighter.x) * 0.055 + (random() - 0.5) * 0.55, 8, 92);
    const y = clamp(fighter.y + (targetY - fighter.y) * 0.055 + (random() - 0.5) * 0.55, 10, 90);
    const distanceFromCenter = Math.hypot(x - 50, y - 50);
    const zoneDamage = distanceFromCenter > zoneRadius ? 1.9 : 0;

    return {
      ...fighter,
      x,
      y,
      targetX,
      targetY,
      health: Math.max(0, fighter.health - zoneDamage),
    };
  });

  if (aliveBefore.length > 1 && tick % 6 === 0) {
    const attackers = fighters.filter((fighter) => fighter.alive);
    const attacker = attackers[Math.floor(random() * attackers.length)];
    if (attacker) {
      const targets = fighters
        .filter((fighter) => fighter.alive && fighter.id !== attacker.id)
        .map((fighter) => ({ fighter, distance: Math.hypot(fighter.x - attacker.x, fighter.y - attacker.y) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4);
      const target = targets[Math.floor(random() * targets.length)]?.fighter;
      if (target) {
        const damage = 5 + Math.floor(random() * 13);
        target.health = Math.max(0, target.health - damage);
        shots.push({ id: `${tick}-${attacker.id}-${target.id}`, fromX: attacker.x, fromY: attacker.y, toX: target.x, toY: target.y, tick });
        if (target.health <= 0 && target.alive) {
          target.alive = false;
          attacker.kills += 1;
          events.unshift({ id: `elim-${tick}-${target.id}`, message: `Fighter #${attacker.id} eliminated #${target.id}` });
        }
      }
    }
  }

  fighters.forEach((fighter) => {
    if (fighter.alive && fighter.health <= 0) {
      fighter.alive = false;
      events.unshift({ id: `zone-${tick}-${fighter.id}`, message: `Death zone claimed #${fighter.id}` });
    }
  });

  const aliveAfter = fighters.filter((fighter) => fighter.alive);
  const winner = aliveAfter.length === 1 ? aliveAfter[0] : state.winner;
  const restartAt = winner && !state.restartAt ? tick + 42 : state.restartAt;
  if (winner && !state.winner) {
    events.unshift({ id: `winner-${tick}-${winner.id}`, message: `Fighter #${winner.id} won the demo` });
  }

  return {
    ...state,
    tick,
    zoneRadius,
    fighters,
    shots,
    events: events.slice(0, 5),
    winner,
    restartAt,
  };
}

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function LedgerPanel({ arenas, finishedArenas, selectedArena, selectedResult, selectedParticipants, selectedVrfRequest, selectedLockedAt, selectedStartedAt, setSelectedArenaId, treasury, vrfCost, protocolFeeBps, commitRevealEnabled, claimRefund, myAgents, txBusy }: { arenas: ArenaSummary[]; finishedArenas: ArenaSummary[]; selectedArena?: RushArena; selectedResult?: RushBattleResult; selectedParticipants: RushArenaParticipant[]; selectedVrfRequest?: bigint; selectedLockedAt?: bigint; selectedStartedAt?: bigint; setSelectedArenaId: (arenaId: bigint) => void; treasury?: `0x${string}`; vrfCost?: bigint; protocolFeeBps?: bigint; commitRevealEnabled?: boolean; claimRefund: (arenaId: bigint, agentId: bigint) => void; myAgents: RushAgent[]; txBusy: boolean }) {
  const myAgentIdSet = new Set(myAgents.map((agent) => agent.agentId.toString()));
  const refundable = selectedArena?.state === 5 ? selectedParticipants.filter((participant) => myAgentIdSet.has(participant.agentId.toString())) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-4">
        <SectionTitle icon={History} eyebrow={`${finishedArenas.length} finished in recent window`} title="Arena ledger" />
        <Panel>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-neutral-900 text-xs uppercase tracking-[0.16em] text-neutral-500" style={{ fontFamily: "monospace" }}>
                <tr><th className="py-3">Arena</th><th className="py-3">State</th><th className="py-3">Tier</th><th className="py-3">Prize</th><th className="py-3">Winner</th><th className="py-3">Seed</th></tr>
              </thead>
              <tbody>
                {arenas.map((row) => (
                  <tr key={row.arena.arenaId.toString()} className="cursor-pointer border-b border-neutral-950 text-neutral-300 hover:bg-white/[0.03]" onClick={() => setSelectedArenaId(row.arena.arenaId)}>
                    <td className="py-3 font-black text-white">#{row.arena.arenaId.toString()}</td>
                    <td className="py-3"><StateBadge state={row.arena.state} /></td>
                    <td className="py-3">{ARENA_TIER_LABELS[row.arena.tier]}</td>
                    <td className="py-3">{formatEthValue(row.arena.prizePool)}</td>
                    <td className="py-3">{row.arena.winnerId > BI_ZERO ? `#${row.arena.winnerId}` : "-"}</td>
                    <td className="py-3">{row.arena.seed > BI_ZERO ? shortBigInt(row.arena.seed) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <SectionTitle icon={ShieldCheck} eyebrow="selected proof" title={selectedArena ? `Arena #${selectedArena.arenaId}` : "Proof"} />
        {selectedArena ? (
          <Panel>
            <div className="grid gap-2">
              <MiniFact label="State" value={ARENA_STATE_LABELS[selectedArena.state]} />
              <MiniFact label="Entry fee" value={formatEthValue(selectedArena.entryFee)} />
              <MiniFact label="Prize pool" value={formatEthValue(selectedArena.prizePool)} />
              <MiniFact label="Winner ID" value={selectedArena.winnerId > BI_ZERO ? `#${selectedArena.winnerId}` : "Pending"} />
              <MiniFact label="VRF request" value={selectedVrfRequest && selectedVrfRequest > BI_ZERO ? selectedVrfRequest.toString() : "None"} />
              <MiniFact label="Locked at" value={selectedLockedAt && selectedLockedAt > BI_ZERO ? formatUnix(selectedLockedAt) : "-"} />
              <MiniFact label="Started at" value={selectedStartedAt && selectedStartedAt > BI_ZERO ? formatUnix(selectedStartedAt) : "-"} />
              <MiniFact label="Seed" value={selectedArena.seed > BI_ZERO ? shortBigInt(selectedArena.seed) : "-"} />
              <MiniFact label="Result hash" value={selectedResult?.resultHash && selectedResult.resultHash !== ZERO_HASH ? shortHash(selectedResult.resultHash) : "-"} />
              <MiniFact label="Total rounds" value={selectedResult?.totalRounds ? selectedResult.totalRounds.toString() : "-"} />
            </div>
            {refundable.length > 0 && (
              <div className="mt-4 rounded-lg border border-red-500/25 bg-red-500/10 p-3">
                <div className="text-xs font-black uppercase tracking-[0.16em] text-red-200" style={{ fontFamily: "monospace" }}>refund available</div>
                <div className="mt-3 grid gap-2">
                  {refundable.map((participant) => <ActionButton key={participant.agentId.toString()} disabled={txBusy} onClick={() => claimRefund(selectedArena.arenaId, participant.agentId)} icon={CircleDollarSign}>Claim fighter #{participant.agentId} refund</ActionButton>)}
                </div>
              </div>
            )}
            <div className="mt-5 grid gap-2">
              <ContractLink label="Agent Registry" address={RUSH_ARENAS_CONTRACTS.agentRegistry} />
              <ContractLink label="Arena Manager" address={RUSH_ARENAS_CONTRACTS.arenaManager} />
              <ContractLink label="Battle Engine" address={RUSH_ARENAS_CONTRACTS.battleEngine} />
              {treasury ? <ContractLink label="Treasury" address={treasury} /> : null}
            </div>
            <div className="mt-5 grid gap-2 text-xs text-neutral-400">
              <MiniFact label="Protocol fee" value={formatBps(protocolFeeBps, false)} />
              <MiniFact label="Estimated VRF cost" value={formatEthValue(vrfCost)} />
              <MiniFact label="Commit reveal" value={commitRevealEnabled ? "Enabled" : "Legacy mode"} />
            </div>
          </Panel>
        ) : <EmptyBox title="No arena selected" body="Click a row to inspect its on-chain proof." />}
      </div>
    </div>
  );
}

function ArenaCard({ row, now, selectedAgentId, onJoin, onLock, onAutoCancel, onSelect }: { row: ArenaSummary; now: number; selectedAgentId?: bigint; onJoin: (arena: RushArena) => void; onLock: (arenaId: bigint) => void; onAutoCancel: (arenaId: bigint) => void; onSelect: (arenaId: bigint) => void }) {
  const { arena, participantCount } = row;
  const registrationEnded = BigInt(now) > arena.registrationEnd;
  const full = participantCount >= arena.maxPlayers;
  const canJoin = arena.state === 1 && !registrationEnded && !full && Boolean(selectedAgentId);
  const canLock = arena.state === 1 && participantCount >= arena.minPlayers && (registrationEnded || full);
  const expiredNoPlayers = arena.state === 1 && registrationEnded && participantCount < arena.minPlayers && BigInt(now) > arena.registrationEnd + AUTO_CANCEL_GRACE_SECONDS;
  const visual = stateVisuals[arena.state] ?? stateVisuals[0];
  const tierVisual = tierVisuals[arena.tier] ?? tierVisuals[0];
  const participantNumber = Number(participantCount);
  const maxPlayers = Math.max(1, Number(arena.maxPlayers));
  const fillPercentage = Math.min(100, (participantNumber / maxPlayers) * 100);
  const spotsLeft = Math.max(0, maxPlayers - participantNumber);
  const avatarCount = Math.min(participantNumber, 7);
  const displayPrize = arena.prizePool > BI_ZERO ? arena.prizePool : arena.entryFee * BigInt(participantNumber);

  return (
    <div className={`group relative overflow-hidden rounded-2xl border-2 ${visual.border} ${visual.glow} bg-gradient-to-br ${visual.gradient} transition-all duration-500 hover:-translate-y-1 hover:scale-[1.01]`}>
      {(arena.state === 1 || arena.state === 2 || arena.state === 3) && (
        <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${visual.pulse} opacity-75`} />
            <span className={`relative inline-flex h-3 w-3 rounded-full ${visual.pulse}`} />
          </span>
          <span className={`text-xs font-black uppercase tracking-[0.14em] ${visual.accent}`}>{arena.state === 1 ? "OPEN" : arena.state === 2 ? "STARTING" : "LIVE"}</span>
        </div>
      )}

      <div className="relative z-10 flex items-center gap-3 px-5 pb-3 pt-5">
        <div className="relative h-12 w-12 shrink-0">
          <Image src={tierVisual.image} alt={ARENA_TIER_LABELS[arena.tier]} fill className="object-contain drop-shadow-[0_0_9px_rgba(255,200,100,0.5)]" />
        </div>
        <div>
          <h3 className="text-xl font-black tracking-tight text-white">Arena #{arena.arenaId.toString()}</h3>
          <p className="text-sm font-bold text-zinc-400">{ARENA_TIER_LABELS[arena.tier]} Tier</p>
        </div>
      </div>

      <button onClick={() => onSelect(arena.arenaId)} className="absolute left-4 top-4 z-20 rounded-full border border-white/10 bg-black/70 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:border-white/25 hover:text-white">
        Inspect
      </button>

      <div className="relative mx-4 aspect-[16/9] overflow-hidden rounded-xl border border-white/10">
        <Image src={visual.image} alt={`Arena ${ARENA_STATE_LABELS[arena.state]}`} fill className={`object-cover transition-transform duration-700 group-hover:scale-110 ${arena.state === 3 ? "animate-pulse" : ""}`} sizes="(min-width: 1024px) 420px, 100vw" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/35" />
        {arena.state === 3 && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-black/70 px-3 py-1.5">
            <Flame className="h-4 w-4 animate-pulse text-orange-300" />
            <span className="text-sm font-black text-orange-300">BATTLE IN PROGRESS</span>
          </div>
        )}
        {avatarCount > 0 && (
          <div className="absolute left-3 top-3 flex items-center">
            {Array.from({ length: avatarCount }).map((_, index) => (
              <div key={index} className="-ml-2 first:ml-0 relative h-8 w-8 overflow-hidden rounded-full border-2 border-black/80 bg-zinc-950">
                <Image src={shipImageForSlot(arena.arenaId, index)} alt="" fill className="object-cover" sizes="32px" />
              </div>
            ))}
            {participantNumber > avatarCount && <span className="ml-1 rounded bg-black/65 px-1.5 py-0.5 text-xs font-black text-white/75">+{participantNumber - avatarCount}</span>}
          </div>
        )}
        {arena.state === 2 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <div className="text-center">
              <Sparkles className="mx-auto mb-2 h-8 w-8 animate-pulse text-red-300" />
              <span className="text-lg font-black text-white">STARTING SOON</span>
            </div>
          </div>
        )}
      </div>

      <div className="px-5 pb-2 pt-4">
        <p className="mb-1 text-xs uppercase tracking-[0.14em] text-zinc-500">Prize Pool</p>
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-yellow-300 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)]" />
          <span className="bg-gradient-to-r from-yellow-300 via-amber-200 to-yellow-500 bg-clip-text text-2xl font-black text-transparent">{formatEthValue(displayPrize)}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 px-5 py-3 text-center">
        <div className="rounded-lg bg-black/35 px-1 py-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Entry</p>
          <p className="text-sm font-black text-white">{formatEthValue(arena.entryFee).replace(" ETH", "")}</p>
        </div>
        <div className="rounded-lg bg-black/35 px-1 py-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Players</p>
          <p className={`text-sm font-black ${full ? "text-red-300" : "text-white"}`}>{participantCount.toString()}/{arena.maxPlayers.toString()}</p>
        </div>
        <div className="rounded-lg bg-black/35 px-1 py-2">
          <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">{arena.state === 1 ? "Closes" : "Status"}</p>
          <p className={`text-sm font-black ${visual.accent}`}>{arena.state === 1 ? (registrationEnded ? "Closed" : timeUntil(Number(arena.registrationEnd), now)) : ARENA_STATE_LABELS[arena.state]}</p>
        </div>
      </div>

      {arena.state === 1 && (
        <div className="px-5 pb-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className={`h-full rounded-full transition-all duration-500 ${fillPercentage >= 100 ? "bg-red-500" : fillPercentage > 70 ? "bg-gradient-to-r from-amber-500 to-orange-500" : "bg-gradient-to-r from-emerald-500 to-cyan-500"}`} style={{ width: `${fillPercentage}%` }} />
          </div>
        </div>
      )}

      <div className="px-5 pb-5">
        {canJoin && (
          <button onClick={() => onJoin(arena)} className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 py-3 text-center text-sm font-black uppercase tracking-[0.14em] text-white transition-all group-hover:from-emerald-500 group-hover:to-cyan-500 group-hover:shadow-[0_0_20px_rgba(16,185,129,0.4)]">
            <span className="flex items-center justify-center gap-2"><Zap className="h-4 w-4" />Join Battle · {spotsLeft} {spotsLeft === 1 ? "Spot" : "Spots"} Left</span>
          </button>
        )}
        {arena.state === 1 && !selectedAgentId && <div className="rounded-xl border border-zinc-700/50 bg-black/40 py-3 text-center text-sm font-bold text-zinc-400">Select or create a fighter to join.</div>}
        {canLock && <button onClick={() => onLock(arena.arenaId)} className="w-full rounded-xl bg-gradient-to-r from-red-600 to-orange-600 py-3 text-center text-sm font-black uppercase tracking-[0.14em] text-white"><span className="flex items-center justify-center gap-2"><Lock className="h-4 w-4" />Lock Arena</span></button>}
        {expiredNoPlayers && <button onClick={() => onAutoCancel(arena.arenaId)} className="w-full rounded-xl border border-orange-500/30 bg-orange-500/10 py-3 text-center text-sm font-black uppercase tracking-[0.14em] text-orange-300"><span className="flex items-center justify-center gap-2"><ShieldCheck className="h-4 w-4" />Cancel Expired</span></button>}
        {arena.state === 3 && <div className="w-full rounded-xl bg-gradient-to-r from-orange-600 to-red-600 py-3 text-center text-sm font-black uppercase tracking-[0.14em] text-white"><span className="flex items-center justify-center gap-2"><Swords className="h-4 w-4 animate-pulse" />Watch Live Battle</span></div>}
        {arena.state === 4 && <div className="w-full rounded-xl border border-violet-500/40 bg-gradient-to-r from-violet-500/20 to-purple-500/20 py-3 text-center text-sm font-black text-violet-200"><span className="flex items-center justify-center gap-2"><Crown className="h-5 w-5 text-yellow-300" />Winner: {arena.winnerId > BI_ZERO ? `Fighter #${arena.winnerId}` : "Battle Complete"}</span></div>}
      </div>
    </div>
  );
}

function FighterCard({ agent, toggleAgent, txBusy }: { agent: RushAgent; toggleAgent: (agent: RushAgent) => void; txBusy: boolean }) {
  const winRate = agent.totalBattles > BI_ZERO ? Number((agent.totalWins * BI_TEN_THOUSAND) / agent.totalBattles) / 100 : 0;
  const sprite = Number((agent.agentId % BI_TWENTY) + BI_ONE);
  return (
    <div className="relative overflow-hidden rounded-2xl border border-cyan-400/25 bg-gradient-to-br from-zinc-950 via-zinc-900 to-cyan-950/30 p-4 shadow-[0_0_26px_rgba(0,170,255,0.12)]">
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-cyan-500/12 to-transparent" />
      <div className="relative flex items-start gap-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border border-cyan-300/30 bg-black shadow-[0_0_22px_rgba(0,170,255,0.22)]">
          <Image src={shipImageForAgent(agent.agentId)} alt={`Fighter #${agent.agentId}`} fill className="object-cover" sizes="80px" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black text-white">Fighter #{agent.agentId.toString()}</h3>
            <span className="rounded px-2 py-1 text-[10px] font-black uppercase" style={{ color: agent.isActive ? "#00ff88" : "#ff6666", background: agent.isActive ? "rgba(0,255,136,0.12)" : "rgba(255,102,102,0.12)", fontFamily: "monospace" }}>{agent.isActive ? "active" : "parked"}</span>
          </div>
          <p className="mt-1 text-xs text-cyan-200/60">Ship frame {sprite}</p>
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-3 gap-2"><MiniFact label="Battles" value={agent.totalBattles.toString()} /><MiniFact label="Wins" value={agent.totalWins.toString()} /><MiniFact label="Win rate" value={`${winRate.toFixed(1)}%`} /></div>
      <button onClick={() => toggleAgent(agent)} disabled={txBusy} className="relative mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-black/70 px-4 py-3 text-sm font-black text-cyan-100 transition-colors hover:border-cyan-300/50 disabled:opacity-50">{agent.isActive ? "Park fighter" : "Activate fighter"}</button>
    </div>
  );
}

function ReplayPanel({ arena, result, participants, lockedAt, startedAt, now }: { arena: RushArena; result?: RushBattleResult; participants: RushArenaParticipant[]; lockedAt?: bigint; startedAt?: bigint; now: number }) {
  const seed = arena.seed > BI_ZERO ? arena.seed : result?.seed ?? BI_ZERO;
  const rounds = Math.max(3, Number(result?.totalRounds ?? BI_SIX));
  const winnerId = arena.winnerId > BI_ZERO ? arena.winnerId : result?.winnerId ?? BI_ZERO;
  const visual = stateVisuals[arena.state] ?? stateVisuals[0];
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-4">
        <div><div className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>replay surface</div><div className="mt-1 text-sm text-neutral-300">{seed > BI_ZERO ? "Seed exists. Preview is deterministic from seed + fighter IDs." : "Waiting for VRF seed."}</div></div>
        <StateBadge state={arena.state} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative min-h-[320px] overflow-hidden rounded-2xl border border-white/10 bg-black">
          <Image src={visual.image} alt={`Arena ${ARENA_STATE_LABELS[arena.state]}`} fill className="object-cover opacity-60" sizes="(min-width: 1024px) 640px, 100vw" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-black/60" />
          <div className="absolute inset-8 rounded-full border border-dashed border-cyan-200/20" />
          <div className="absolute inset-16 rounded-full border border-emerald-200/15" />
          {participants.length === 0 ? (
            <div className="relative flex min-h-[320px] items-center justify-center text-sm text-neutral-500">No participants loaded.</div>
          ) : (
            <div className="relative min-h-[320px]">
              {participants.map((participant, index) => {
                const score = seed > BI_ZERO ? pseudoScore(seed, participant.agentId, rounds) : 50 + index * 7;
                const angle = (Math.PI * 2 * index) / Math.max(1, participants.length);
                const radius = 108 + (score % 34);
                const left = 50 + Math.cos(angle) * (radius / 3.8);
                const top = 50 + Math.sin(angle) * (radius / 3.8);
                const won = participant.agentId === winnerId;
                return (
                  <div key={participant.agentId.toString()} className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={{ left: `${left}%`, top: `${top}%` }}>
                    <div className="relative h-16 w-16 overflow-hidden rounded-full border-2 bg-black" style={{ borderColor: won ? "#00ff88" : "#263238", boxShadow: won ? "0 0 34px rgba(0,255,136,0.45)" : "none" }}>
                      <Image src={shipImageForAgent(participant.agentId)} alt={`Fighter #${participant.agentId}`} fill className="object-cover" sizes="64px" />
                    </div>
                    <span className="rounded bg-black/70 px-2 py-1 text-[10px] text-neutral-400">{won ? "WINNER" : participant.eliminated ? `R${participant.eliminatedRound}` : `score ${score}`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <MiniFact label="Locked" value={lockedAt && lockedAt > BI_ZERO ? formatUnix(lockedAt) : "-"} />
          <MiniFact label="Started" value={startedAt && startedAt > BI_ZERO ? formatUnix(startedAt) : "-"} />
          <MiniFact label="Seed" value={seed > BI_ZERO ? shortBigInt(seed) : "Pending"} />
          <MiniFact label="Winner" value={winnerId > BI_ZERO ? `#${winnerId}` : "Pending"} />
          <MiniFact label="Clock" value={arena.state === 1 ? timeUntil(Number(arena.registrationEnd), now) : ARENA_STATE_LABELS[arena.state]} />
        </div>
      </div>
    </Panel>
  );
}

function MetricCard({ label, value, icon: Icon, accent }: { label: string; value: string; icon: typeof Trophy; accent: string }) {
  return <div className="rounded-lg border p-4" style={{ borderColor: "#191919", background: "#0d0d0d" }}><div className="mb-3 flex items-center gap-2 text-xs font-black tracking-[0.14em] text-neutral-500" style={{ fontFamily: "monospace" }}><Icon size={14} style={{ color: accent }} />{label}</div><div className="text-2xl font-black text-white">{value}</div></div>;
}

function SectionTitle({ icon: Icon, eyebrow, title }: { icon: typeof Swords; eyebrow: string; title: string }) {
  return <div><div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}><Icon size={15} />{eyebrow}</div><h2 className="text-2xl font-black text-white">{title}</h2></div>;
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border p-5" style={{ borderColor: "#191919", background: "#0d0d0d" }}>{children}</div>;
}

function Pill({ icon: Icon, label, color }: { icon: typeof Radio; label: string; color: string }) {
  return <span className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black tracking-[0.14em]" style={{ borderColor: `${color}44`, background: `${color}14`, color, fontFamily: "monospace" }}><Icon size={14} />{label}</span>;
}

function StateBadge({ state }: { state: ArenaState }) {
  const tone = stateTone[state] ?? stateTone[0];
  return <span className="inline-flex rounded px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: tone.fg, background: tone.bg, fontFamily: "monospace" }}>{tone.label}</span>;
}

function MiniFact({ label, value }: { label: string; value?: string }) {
  return <div className="rounded-md border border-neutral-900 bg-black/35 px-3 py-2"><div className="text-[9px] font-black uppercase tracking-[0.16em] text-neutral-600" style={{ fontFamily: "monospace" }}>{label}</div><div className="mt-1 break-words text-sm font-bold text-neutral-200">{value ?? "-"}</div></div>;
}

function ActionButton({ children, onClick, disabled, icon: Icon }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; icon: typeof Swords }) {
  return <button onClick={onClick} disabled={disabled} className="inline-flex items-center justify-center gap-2 rounded-md border border-[#00ff88]/35 bg-[#00ff88]/12 px-3 py-2 text-xs font-black text-[#9dffc9] transition-colors hover:bg-[#00ff88]/18 disabled:opacity-50">{disabled ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}{children}</button>;
}

function ContractLink({ label, address }: { label: string; address: `0x${string}` }) {
  return <a href={basescanAddressUrl(address)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-md border px-3 py-3 transition-colors hover:border-[#00ff88]/30" style={{ borderColor: "#181818", background: "#090909" }}><span className="text-sm text-neutral-400">{label}</span><span className="flex items-center gap-2 text-sm font-bold text-white" style={{ fontFamily: "monospace" }}>{shortAddress(address)}<ExternalLink size={14} className="text-neutral-600" /></span></a>;
}

function TxStatus({ label, hash, busy, success, error }: { label: string | null; hash?: `0x${string}`; busy: boolean; success: boolean; error: Error | null }) {
  if (!label && !hash && !error) return null;
  return (
    <div className="mb-6 rounded-lg border border-neutral-900 bg-black/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>transaction</div>
          <div className="mt-1 text-sm text-neutral-200">{busy ? `${label ?? "Waiting"}...` : success ? `${label ?? "Transaction"} confirmed` : label ?? "Ready"}</div>
          {error && <div className="mt-2 max-w-3xl text-xs text-red-300">{friendlyError(error)}</div>}
        </div>
        {hash && <a href={`https://basescan.org/tx/${hash}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-xs font-bold text-neutral-300 hover:text-white">{shortHash(hash)}<ExternalLink size={13} /></a>}
      </div>
    </div>
  );
}

function LoadingBox({ label }: { label: string }) {
  return <Panel><div className="flex items-center justify-center gap-3 py-10 text-sm text-neutral-400"><Loader2 size={18} className="animate-spin" />{label}</div></Panel>;
}

function EmptyBox({ title, body }: { title: string; body: string }) {
  return <Panel><div className="py-8 text-center"><h3 className="text-lg font-black text-white">{title}</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-neutral-500">{body}</p></div></Panel>;
}

function readBigInt(result: ReadResult | undefined): bigint | undefined {
  return result?.status === "success" && typeof result.result === "bigint" ? result.result : undefined;
}

function readAddress(result: ReadResult | undefined): `0x${string}` | undefined {
  return result?.status === "success" && typeof result.result === "string" ? (result.result as `0x${string}`) : undefined;
}

function readBool(result: ReadResult | undefined): boolean | undefined {
  return result?.status === "success" && typeof result.result === "boolean" ? result.result : undefined;
}

function normalizeArena(raw: unknown): RushArena | undefined {
  if (!raw) return undefined;
  const value = raw as Record<string, unknown> & unknown[];
  return {
    arenaId: asBigInt(value.arenaId ?? value[0]),
    tier: Number(value.tier ?? value[1]) as ArenaTier,
    entryFee: asBigInt(value.entryFee ?? value[2]),
    minPlayers: asBigInt(value.minPlayers ?? value[3]),
    maxPlayers: asBigInt(value.maxPlayers ?? value[4]),
    registrationStart: asBigInt(value.registrationStart ?? value[5]),
    registrationEnd: asBigInt(value.registrationEnd ?? value[6]),
    prizePool: asBigInt(value.prizePool ?? value[7]),
    state: Number(value.state ?? value[8]) as ArenaState,
    creator: (value.creator ?? value[9]) as `0x${string}`,
    vrfRequestId: asBigInt(value.vrfRequestId ?? value[10]),
    seed: asBigInt(value.seed ?? value[11]),
    winnerId: asBigInt(value.winnerId ?? value[12]),
  };
}

function normalizeAgent(raw: unknown): RushAgent | undefined {
  if (!raw) return undefined;
  const value = raw as Record<string, unknown> & unknown[];
  return {
    owner: (value.owner ?? value[0]) as `0x${string}`,
    agentId: asBigInt(value.agentId ?? value[1]),
    createdAt: asBigInt(value.createdAt ?? value[2]),
    totalBattles: asBigInt(value.totalBattles ?? value[3]),
    totalWins: asBigInt(value.totalWins ?? value[4]),
    isActive: Boolean(value.isActive ?? value[5]),
  };
}

function normalizeParticipants(raw: unknown): RushArenaParticipant[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const value = item as Record<string, unknown> & unknown[];
    return {
      agentId: asBigInt(value.agentId ?? value[0]),
      owner: (value.owner ?? value[1]) as `0x${string}`,
      boostIds: Array.isArray(value.boostIds ?? value[2]) ? ((value.boostIds ?? value[2]) as bigint[]) : [],
      joinedAt: asBigInt(value.joinedAt ?? value[3]),
      eliminated: Boolean(value.eliminated ?? value[4]),
      eliminatedRound: asBigInt(value.eliminatedRound ?? value[5]),
    };
  });
}

function normalizeBattleResult(raw: unknown): RushBattleResult | undefined {
  if (!raw) return undefined;
  const value = raw as Record<string, unknown> & unknown[];
  const arenaId = asBigInt(value.arenaId ?? value[0]);
  const executedAt = asBigInt(value.executedAt ?? value[5]);
  const winnerId = asBigInt(value.winnerId ?? value[1]);
  if (arenaId === BI_ZERO && executedAt === BI_ZERO && winnerId === BI_ZERO) return undefined;
  return {
    arenaId,
    winnerId,
    totalRounds: asBigInt(value.totalRounds ?? value[2]),
    seed: asBigInt(value.seed ?? value[3]),
    resultHash: (value.resultHash ?? value[4] ?? ZERO_HASH) as `0x${string}`,
    executedAt,
  };
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value !== "") return BigInt(value);
  return BI_ZERO;
}

function shipImageForAgent(agentId: bigint) {
  return `/images/ships/ship-${Number((agentId % BI_TWENTY) + BI_ONE)}.png`;
}

function shipImageForSlot(arenaId: bigint, index: number) {
  return `/images/ships/ship-${Number(((arenaId + BigInt(index)) % BI_TWENTY) + BI_ONE)}.png`;
}

function formatEthInput(value: number) {
  if (!Number.isFinite(value)) return "0.001";
  return value.toFixed(3);
}

function formatCount(value: bigint | undefined, isLoading: boolean) {
  if (value === undefined) return isLoading ? "..." : "0";
  return Number(value).toLocaleString("en-US");
}

function formatEthValue(value: bigint | undefined) {
  if (value === undefined) return "-";
  if (value === BI_ZERO) return "0 ETH";
  const amount = Number(formatEther(value));
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: amount < 0.01 ? 4 : 3 })} ETH`;
}

function formatBps(value: bigint | undefined, isLoading: boolean) {
  if (value === undefined) return isLoading ? "..." : "0%";
  return `${(Number(value) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function safeParseEther(value: string) {
  try { return parseEther(value); } catch { return undefined; }
}

function shortAddress(address: `0x${string}` | undefined) {
  if (!address) return "Not set";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortHash(hash: `0x${string}`) {
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function shortBigInt(value: bigint) {
  const text = value.toString();
  if (text.length <= 14) return text;
  return `${text.slice(0, 7)}...${text.slice(-5)}`;
}

function formatUnix(value: bigint) {
  return new Date(Number(value) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeUntil(target: number, now: number) {
  const diff = target - now;
  if (diff <= 0) return "ended";
  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m ${seconds}s`;
}

function pseudoScore(seed: bigint, agentId: bigint, rounds: number) {
  let x = seed ^ (agentId * PSEUDO_A) ^ BigInt(rounds) * PSEUDO_B;
  x ^= x >> BI_THIRTEEN;
  x *= PSEUDO_C;
  x ^= x >> BI_SIXTEEN;
  return Number((x < BI_ZERO ? -x : x) % BI_HUNDRED);
}

function friendlyError(error: Error) {
  const text = error.message || String(error);
  if (text.includes("User rejected") || text.includes("User denied")) return "Transaction rejected in wallet.";
  if (text.includes("ArenaNotOpen")) return "Arena is not open.";
  if (text.includes("RegistrationEnded")) return "Registration already ended.";
  if (text.includes("InsufficientEntryFee")) return "Entry fee was not enough.";
  if (text.includes("NotAgentOwner")) return "Selected fighter is not owned by this wallet.";
  if (text.includes("AgentAlreadyJoined")) return "This fighter already joined that arena.";
  if (text.includes("CreationCooldownActive")) return "Creation cooldown is active for this wallet.";
  if (text.includes("MaxAgentsPerWalletReached")) return "This wallet reached the fighter limit.";
  if (text.includes("RegistrationNotEnded")) return "Registration has not ended yet.";
  if (text.includes("MinPlayersNotReached")) return "Minimum players not reached yet.";
  if (text.includes("UnauthorizedCaller")) return "Wallet is not authorized for that operator action.";
  return text.split("\n")[0].slice(0, 260);
}
