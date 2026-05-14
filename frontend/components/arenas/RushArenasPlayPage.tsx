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
  Coins,
  ExternalLink,
  Gauge,
  History,
  Layers,
  Loader2,
  Lock,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Swords,
  Trophy,
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
    maxPlayers: "2",
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
            background: "radial-gradient(circle at 18% 18%, rgba(0,255,136,0.16), transparent 30%), radial-gradient(circle at 84% 22%, rgba(0,170,255,0.12), transparent 26%), #080808",
          }}
        >
          <div className="absolute inset-0 opacity-[0.18]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />

          <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-8 md:px-8 md:py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
            <div className="flex min-h-[440px] flex-col justify-center gap-7">
              <div className="flex flex-wrap items-center gap-3">
                <Pill icon={Radio} label="BASE MAINNET" color="#00ff88" />
                <Pill icon={Activity} label="VRF ARENA ENGINE" color="#7ddcff" />
                <Pill icon={ShieldCheck} label="AGENT ROYALE MECHANICS" color="#ffd700" />
              </div>

              <div>
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

        <div className="relative min-h-[220px] overflow-hidden rounded-lg border" style={{ borderColor: "#191919", background: "#050505" }}>
          <div className="absolute inset-0 opacity-60" style={{ background: "radial-gradient(circle at center, rgba(0,255,136,0.16), transparent 38%), conic-gradient(from 90deg, rgba(0,255,136,0.12), rgba(0,170,255,0.1), rgba(255,215,0,0.08), rgba(0,255,136,0.12))" }} />
          <div className="absolute inset-8 rounded-full border border-dashed border-neutral-700" />
          <div className="absolute inset-16 rounded-full border border-neutral-800" />
          <div className="relative flex min-h-[220px] items-center justify-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[#00ff88]/30 bg-black/70 shadow-[0_0_42px_rgba(0,255,136,0.25)]">
              <Image src="/logo.png" alt="Rush" width={64} height={64} className="h-16 w-auto" priority />
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
  const limits = ARENA_TIER_LIMITS[arenaForm.tier];

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

              <div className="border-t border-neutral-900 pt-5">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>create arena</div>
                <div className="grid gap-3">
                  <label className="grid gap-1 text-xs text-neutral-500">
                    Tier
                    <select value={arenaForm.tier} onChange={(event) => {
                      const tier = Number(event.target.value) as ArenaTier;
                      const next = ARENA_TIER_LIMITS[tier];
                      setArenaForm({ ...arenaForm, tier, entryFee: next.minFeeEth, minPlayers: String(next.minPlayers), maxPlayers: String(next.minPlayers) });
                    }} className="rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#00ff88]/60">
                      {([0, 1, 2, 3] as ArenaTier[]).map((tier) => (
                        <option key={tier} value={tier}>{ARENA_TIER_LABELS[tier]} ({ARENA_TIER_LIMITS[tier].minFeeEth}-{ARENA_TIER_LIMITS[tier].maxFeeEth} ETH)</option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="Entry fee ETH" value={arenaForm.entryFee} onChange={(entryFee) => setArenaForm({ ...arenaForm, entryFee })} />
                    <Input label="Duration minutes" value={arenaForm.durationMinutes} onChange={(durationMinutes) => setArenaForm({ ...arenaForm, durationMinutes })} />
                    <Input label={`Min players (${limits.minPlayers}+ required)`} value={arenaForm.minPlayers} onChange={(minPlayers) => setArenaForm({ ...arenaForm, minPlayers })} />
                    <Input label="Max players" value={arenaForm.maxPlayers} onChange={(maxPlayers) => setArenaForm({ ...arenaForm, maxPlayers })} />
                  </div>
                  <button onClick={createArena} disabled={txBusy || !isConnected} className="inline-flex items-center justify-center gap-2 rounded-md border border-[#00ff88]/35 bg-[#00ff88]/12 px-4 py-3 text-sm font-black text-[#9dffc9] transition-colors hover:bg-[#00ff88]/18 disabled:opacity-50">
                    {txBusy ? <Loader2 size={16} className="animate-spin" /> : <Swords size={16} />}
                    Create arena
                  </button>
                </div>
              </div>
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
        <SectionTitle icon={Radio} eyebrow="deterministic replay" title={selectedArena ? `Arena #${selectedArena.arenaId}` : "Select arena"} />
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
  return (
    <div className="rounded-lg border border-neutral-900 bg-[#0d0d0d] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2"><h3 className="text-lg font-black text-white">Arena #{arena.arenaId.toString()}</h3><StateBadge state={arena.state} /></div>
          <div className="mt-1 text-xs text-neutral-500">{ARENA_TIER_LABELS[arena.tier]} - entry {formatEthValue(arena.entryFee)}</div>
        </div>
        <button onClick={() => onSelect(arena.arenaId)} className="rounded-md border border-neutral-800 bg-black px-2 py-1 text-xs text-neutral-400 hover:text-white">inspect</button>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <MiniFact label="Players" value={`${participantCount}/${arena.maxPlayers}`} />
        <MiniFact label="Min" value={arena.minPlayers.toString()} />
        <MiniFact label="Prize" value={formatEthValue(arena.prizePool)} />
      </div>
      <div className="mt-3 text-xs text-neutral-500">Registration {registrationEnded ? "ended" : `ends ${timeUntil(Number(arena.registrationEnd), now)}`}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        {canJoin && <ActionButton onClick={() => onJoin(arena)} icon={Swords}>Join with #{selectedAgentId?.toString()}</ActionButton>}
        {arena.state === 1 && !selectedAgentId && <div className="rounded-md border border-neutral-800 bg-black px-3 py-2 text-xs text-neutral-500">Select or create a fighter to join.</div>}
        {canLock && <ActionButton onClick={() => onLock(arena.arenaId)} icon={Lock}>Lock arena</ActionButton>}
        {expiredNoPlayers && <ActionButton onClick={() => onAutoCancel(arena.arenaId)} icon={ShieldCheck}>Cancel expired</ActionButton>}
      </div>
    </div>
  );
}

function FighterCard({ agent, toggleAgent, txBusy }: { agent: RushAgent; toggleAgent: (agent: RushAgent) => void; txBusy: boolean }) {
  const winRate = agent.totalBattles > BI_ZERO ? Number((agent.totalWins * BI_TEN_THOUSAND) / agent.totalBattles) / 100 : 0;
  const sprite = Number((agent.agentId % BI_TWENTY) + BI_ONE);
  return (
    <div className="rounded-lg border border-neutral-900 bg-[#0d0d0d] p-4">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-[#00aaff]/25 bg-[#00aaff]/10"><Bot size={28} className="text-[#00aaff]" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-black text-white">Fighter #{agent.agentId.toString()}</h3>
            <span className="rounded px-2 py-1 text-[10px] font-black uppercase" style={{ color: agent.isActive ? "#00ff88" : "#ff6666", background: agent.isActive ? "rgba(0,255,136,0.12)" : "rgba(255,102,102,0.12)", fontFamily: "monospace" }}>{agent.isActive ? "active" : "parked"}</span>
          </div>
          <p className="mt-1 text-xs text-neutral-500">Rush sprite seed {sprite}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2"><MiniFact label="Battles" value={agent.totalBattles.toString()} /><MiniFact label="Wins" value={agent.totalWins.toString()} /><MiniFact label="Win rate" value={`${winRate.toFixed(1)}%`} /></div>
      <button onClick={() => toggleAgent(agent)} disabled={txBusy} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-neutral-800 bg-black px-4 py-2 text-sm font-bold text-neutral-200 hover:border-[#00aaff]/40 disabled:opacity-50">{agent.isActive ? "Park fighter" : "Activate fighter"}</button>
    </div>
  );
}

function ReplayPanel({ arena, result, participants, lockedAt, startedAt, now }: { arena: RushArena; result?: RushBattleResult; participants: RushArenaParticipant[]; lockedAt?: bigint; startedAt?: bigint; now: number }) {
  const seed = arena.seed > BI_ZERO ? arena.seed : result?.seed ?? BI_ZERO;
  const rounds = Math.max(3, Number(result?.totalRounds ?? BI_SIX));
  const winnerId = arena.winnerId > BI_ZERO ? arena.winnerId : result?.winnerId ?? BI_ZERO;
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-900 pb-4">
        <div><div className="text-xs font-black uppercase tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>replay surface</div><div className="mt-1 text-sm text-neutral-300">{seed > BI_ZERO ? "Seed exists. Preview is deterministic from seed + fighter IDs." : "Waiting for VRF seed."}</div></div>
        <StateBadge state={arena.state} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative min-h-[320px] overflow-hidden rounded-lg border border-neutral-900 bg-black" style={{ background: "radial-gradient(circle at 50% 50%, rgba(0,170,255,0.12), transparent 34%), radial-gradient(circle at 20% 20%, rgba(255,215,0,0.1), transparent 22%), #050505" }}>
          <div className="absolute inset-8 rounded-full border border-dashed border-neutral-800" />
          <div className="absolute inset-16 rounded-full border border-neutral-900" />
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
                    <div className="flex h-14 w-14 items-center justify-center rounded-full border bg-black text-sm font-black" style={{ borderColor: won ? "#00ff88" : "#263238", color: won ? "#00ff88" : "#8aa", boxShadow: won ? "0 0 34px rgba(0,255,136,0.4)" : "none" }}>#{participant.agentId.toString()}</div>
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

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="grid gap-1 text-xs text-neutral-500">{label}<input value={value} onChange={(event) => onChange(event.target.value)} className="rounded-md border border-neutral-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-[#00ff88]/60" /></label>;
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
