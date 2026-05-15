"use client";

import Image from "next/image";
import Link from "next/link";
import { useAccount, useReadContracts } from "wagmi";
import { formatEther } from "viem";
import {
  Activity,
  Bot,
  ChevronRight,
  Coins,
  ExternalLink,
  Gauge,
  Layers,
  Play,
  Radio,
  ShieldCheck,
  Swords,
  Trophy,
  Wallet,
} from "lucide-react";
import Header from "@/components/Header";
import {
  AGENT_REGISTRY_ABI,
  ARENA_MANAGER_ABI,
  BATTLE_ENGINE_ABI,
  RUSH_ARENAS_CONTRACTS,
  basescanAddressUrl,
} from "@/lib/contracts/rushArenas";

type ReadResult = {
  status: "success" | "failure";
  result?: unknown;
};

type ArenaSection = "join" | "fleet" | "watch" | "ledger";

function readBigInt(result: ReadResult | undefined) {
  return result?.status === "success" && typeof result.result === "bigint"
    ? result.result
    : undefined;
}

function readAddress(result: ReadResult | undefined) {
  return result?.status === "success" && typeof result.result === "string"
    ? (result.result as `0x${string}`)
    : undefined;
}

function formatCount(value: bigint | undefined, isLoading: boolean) {
  if (value === undefined) return isLoading ? "..." : "0";
  return Number(value).toLocaleString("en-US");
}

function formatEth(value: bigint | undefined, isLoading: boolean) {
  if (value === undefined) return isLoading ? "..." : "0 ETH";
  const amount = Number(formatEther(value));
  return `${amount.toLocaleString("en-US", {
    maximumFractionDigits: amount < 0.01 ? 4 : 3,
  })} ETH`;
}

function formatBps(value: bigint | undefined, isLoading: boolean) {
  if (value === undefined) return isLoading ? "..." : "0%";
  return `${(Number(value) / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}%`;
}

function shortAddress(address: `0x${string}` | undefined) {
  if (!address) return "Not set";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const launchActions = [
  {
    section: "join",
    title: "Join Arenas",
    subtitle: "Open battles, entry fees, prize pools",
    href: "/arenas",
    icon: Swords,
    accent: "#00ff88",
  },
  {
    section: "fleet",
    title: "Command Fleet",
    subtitle: "Create or tune autonomous fighters",
    href: "/arenas/fleet",
    icon: Bot,
    accent: "#00aaff",
  },
  {
    section: "watch",
    title: "Watch Live",
    subtitle: "Spectate deterministic replays",
    href: "/arenas/watch",
    icon: Play,
    accent: "#ffd700",
  },
  {
    section: "ledger",
    title: "Proof Ledger",
    subtitle: "Audit arena results and payouts",
    href: "/arenas/ledger",
    icon: ShieldCheck,
    accent: "#ff6666",
  },
] satisfies Array<{
  section: ArenaSection;
  title: string;
  subtitle: string;
  href: string;
  icon: typeof Swords;
  accent: string;
}>;

const sectionPanels: Record<
  ArenaSection,
  {
    eyebrow: string;
    title: string;
    body: string;
    bullets: string[];
    accent: string;
  }
> = {
  join: {
    eyebrow: "arena lobby",
    title: "Join ETH battles from the Rush arena lobby.",
    body:
      "This is the main entry point for open arenas, entry fees, and prize pools. Players pick an arena, sign the entry transaction, then the engine resolves the battle on Base.",
    bullets: ["Open arenas", "ETH entry fees", "VRF-seeded runs", "Base payouts"],
    accent: "#00ff88",
  },
  fleet: {
    eyebrow: "command fleet",
    title: "Create and manage Rush fighters.",
    body:
      "Fleet is the fighter-control surface: register identities, tune arena-ready profiles, and track which autonomous fighters are ready to enter paid battles.",
    bullets: ["Fighter registry", "Creation fee", "Profile tuning", "Ready status"],
    accent: "#00aaff",
  },
  watch: {
    eyebrow: "watch live",
    title: "Spectate deterministic battle replays.",
    body:
      "Watch is the replay lane for live and recent arenas. The seed is locked before simulation, then the same deterministic run can be replayed for spectators and audits.",
    bullets: ["Live replays", "Locked seed", "Result trace", "No hidden rolls"],
    accent: "#ffd700",
  },
  ledger: {
    eyebrow: "proof ledger",
    title: "Audit contracts, results, and payouts.",
    body:
      "Ledger is the proof surface for Rush Royale: registry, arena manager, battle engine, treasury, and payout trail all stay visible from one route.",
    bullets: ["Mainnet addresses", "Prize accounting", "Fee path", "Basescan links"],
    accent: "#ff6666",
  },
};

const mechanicSteps = [
  "Create a fighter identity on Base",
  "Join an arena with an ETH entry fee",
  "VRF locks the seed before simulation",
  "Deterministic engine resolves the replay",
  "Winner receives the pool minus protocol fee",
];

export default function RushArenasPage({
  section = "join",
}: {
  section?: ArenaSection;
}) {
  const { isConnected } = useAccount();
  const activePanel = sectionPanels[section];

  const { data, isLoading, isError, refetch } = useReadContracts({
    contracts: [
      {
        address: RUSH_ARENAS_CONTRACTS.arenaManager,
        abi: ARENA_MANAGER_ABI,
        functionName: "totalArenas",
      },
      {
        address: RUSH_ARENAS_CONTRACTS.agentRegistry,
        abi: AGENT_REGISTRY_ABI,
        functionName: "totalAgents",
      },
      {
        address: RUSH_ARENAS_CONTRACTS.agentRegistry,
        abi: AGENT_REGISTRY_ABI,
        functionName: "creationFee",
      },
      {
        address: RUSH_ARENAS_CONTRACTS.battleEngine,
        abi: BATTLE_ENGINE_ABI,
        functionName: "protocolFeeBps",
      },
      {
        address: RUSH_ARENAS_CONTRACTS.battleEngine,
        abi: BATTLE_ENGINE_ABI,
        functionName: "treasuryAddress",
      },
    ],
    query: {
      refetchInterval: 30_000,
    },
  });

  const results = data as ReadResult[] | undefined;
  const totalArenas = readBigInt(results?.[0]);
  const totalAgents = readBigInt(results?.[1]);
  const creationFee = readBigInt(results?.[2]);
  const protocolFee = readBigInt(results?.[3]);
  const treasury = readAddress(results?.[4]);

  const statCards = [
    {
      label: "Arenas",
      value: formatCount(totalArenas, isLoading),
      icon: Trophy,
      accent: "#00ff88",
    },
    {
      label: "Fighters",
      value: formatCount(totalAgents, isLoading),
      icon: Bot,
      accent: "#00aaff",
    },
    {
      label: "Create Fee",
      value: formatEth(creationFee, isLoading),
      icon: Coins,
      accent: "#ffd700",
    },
    {
      label: "Protocol Fee",
      value: formatBps(protocolFee, isLoading),
      icon: Gauge,
      accent: "#ff6666",
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#080808", color: "#e8e8e8" }}>
      <Header />

      <main>
        <section
          className="relative overflow-hidden border-b"
          style={{
            borderColor: "#171717",
            background:
              "radial-gradient(circle at 18% 18%, rgba(0,255,136,0.16), transparent 30%), radial-gradient(circle at 84% 22%, rgba(0,170,255,0.12), transparent 26%), #080808",
          }}
        >
          <div
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
              backgroundSize: "44px 44px",
            }}
          />

          <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-8 md:px-8 md:py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
            <div className="flex min-h-[420px] flex-col justify-center gap-7">
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black tracking-[0.14em]"
                  style={{
                    borderColor: "rgba(0,255,136,0.28)",
                    background: "rgba(0,255,136,0.08)",
                    color: "#00ff88",
                    fontFamily: "monospace",
                  }}
                >
                  <Radio size={14} />
                  BASE MAINNET
                </span>
                <span
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-black tracking-[0.14em]"
                  style={{
                    borderColor: "rgba(0,170,255,0.28)",
                    background: "rgba(0,170,255,0.08)",
                    color: "#7ddcff",
                    fontFamily: "monospace",
                  }}
                >
                  <Activity size={14} />
                  VRF ARENA ENGINE
                </span>
              </div>

              <div>
                <h1
                  className="max-w-3xl text-5xl font-black leading-[0.95] md:text-7xl"
                  style={{
                    color: "#f4f4f4",
                    fontFamily: "ui-monospace, SFMono-Regular, monospace",
                    letterSpacing: 0,
                  }}
                >
                  RUSH ROYALE
                </h1>
                <p className="mt-5 max-w-2xl text-base leading-7 text-neutral-300 md:text-lg">
                  Autonomous fighters battle for ETH prize pools. The seed comes
                  from VRF, the replay is deterministic, and payouts settle on
                  Base.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {launchActions.map((action) => {
                  const Icon = action.icon;
                  const active = action.section === section;
                  return (
                    <Link
                      key={action.title}
                      href={action.href}
                      className="group flex min-h-[92px] items-center justify-between rounded-lg border p-4 transition-transform hover:-translate-y-0.5"
                      style={{
                        borderColor: active ? `${action.accent}66` : "#1c1c1c",
                        background: active ? `${action.accent}12` : "#101010",
                        boxShadow: active ? `0 0 28px ${action.accent}18` : "none",
                      }}
                      aria-current={active ? "page" : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border"
                          style={{
                            borderColor: `${action.accent}44`,
                            background: `${action.accent}14`,
                            color: action.accent,
                          }}
                        >
                          <Icon size={21} />
                        </span>
                        <span>
                          <span className="block text-sm font-black text-white">
                            {action.title}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-neutral-500">
                            {action.subtitle}
                          </span>
                        </span>
                      </div>
                      <ChevronRight
                        size={17}
                        className="shrink-0 text-neutral-600 transition-colors group-hover:text-white"
                      />
                    </Link>
                  );
                })}
              </div>

              <div
                className="rounded-lg border p-4"
                style={{
                  borderColor: `${activePanel.accent}38`,
                  background: `${activePanel.accent}0f`,
                }}
              >
                <div
                  className="mb-2 text-[10px] font-black uppercase tracking-[0.22em]"
                  style={{ color: activePanel.accent, fontFamily: "monospace" }}
                >
                  {activePanel.eyebrow}
                </div>
                <h2 className="text-xl font-black text-white">{activePanel.title}</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-300">{activePanel.body}</p>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {activePanel.bullets.map((bullet) => (
                    <div
                      key={bullet}
                      className="rounded-md border px-3 py-2 text-xs font-bold text-neutral-200"
                      style={{
                        borderColor: `${activePanel.accent}24`,
                        background: "rgba(0,0,0,0.24)",
                        fontFamily: "monospace",
                      }}
                    >
                      {bullet}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center">
              <div
                className="relative w-full overflow-hidden rounded-lg border p-5"
                style={{
                  borderColor: "rgba(0,255,136,0.16)",
                  background: "rgba(10,10,10,0.78)",
                  boxShadow: "0 24px 90px rgba(0,0,0,0.45)",
                }}
              >
                <div className="flex items-center justify-between border-b border-neutral-900 pb-4">
                  <div>
                    <div className="text-xs font-black tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>
                      ARENA STATUS
                    </div>
                    <div className="mt-1 text-sm text-neutral-300">
                      {isConnected ? "Wallet connected to Rush" : "Connect wallet from the arena app to join"}
                    </div>
                  </div>
                  <button
                    onClick={() => refetch()}
                    className="rounded-md border px-3 py-2 text-xs font-bold text-neutral-300 transition-colors hover:text-white"
                    style={{ borderColor: "#242424", background: "#111", fontFamily: "monospace" }}
                  >
                    REFRESH
                  </button>
                </div>

                <div className="grid gap-3 py-5 sm:grid-cols-2">
                  {statCards.map((stat) => {
                    const Icon = stat.icon;
                    return (
                      <div
                        key={stat.label}
                        className="rounded-lg border p-4"
                        style={{ borderColor: "#191919", background: "#0d0d0d" }}
                      >
                        <div className="mb-3 flex items-center gap-2 text-xs font-black tracking-[0.14em] text-neutral-500" style={{ fontFamily: "monospace" }}>
                          <Icon size={14} style={{ color: stat.accent }} />
                          {stat.label}
                        </div>
                        <div className="text-2xl font-black text-white">{stat.value}</div>
                      </div>
                    );
                  })}
                </div>

                <div className="relative min-h-[220px] overflow-hidden rounded-lg border" style={{ borderColor: "#191919", background: "#050505" }}>
                  <div
                    className="absolute inset-0 opacity-60"
                    style={{
                      background:
                        "radial-gradient(circle at center, rgba(0,255,136,0.16), transparent 38%), conic-gradient(from 90deg, rgba(0,255,136,0.12), rgba(0,170,255,0.1), rgba(255,215,0,0.08), rgba(0,255,136,0.12))",
                    }}
                  />
                  <div className="absolute inset-8 rounded-full border border-dashed border-neutral-700" />
                  <div className="absolute inset-16 rounded-full border border-neutral-800" />
                  <div className="relative flex min-h-[220px] items-center justify-center">
                    <div className="flex h-24 w-24 items-center justify-center rounded-full border border-[#00ff88]/30 bg-black/70 shadow-[0_0_42px_rgba(0,255,136,0.25)]">
                      <Image
                        src="/logo.png"
                        alt="Rush"
                        width={64}
                        height={64}
                        className="h-16 w-auto"
                        priority
                      />
                    </div>
                  </div>
                </div>

                {isError && (
                  <div className="mt-4 rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                    On-chain arena reads failed. Links still open the mainnet arena app.
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-6 px-4 py-8 md:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(340px,1.1fr)]">
          <div>
            <div className="mb-4 flex items-center gap-2 text-xs font-black tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>
              <Layers size={15} />
              MECHANIC KEPT INTACT
            </div>
            <div className="grid gap-3">
              {mechanicSteps.map((step, index) => (
                <div
                  key={step}
                  className="flex items-center gap-4 rounded-lg border px-4 py-3"
                  style={{ borderColor: "#191919", background: "#0d0d0d" }}
                >
                  <span className="text-sm font-black text-[#00ff88]" style={{ fontFamily: "monospace" }}>
                    {(index + 1).toString().padStart(2, "0")}
                  </span>
                  <span className="text-sm text-neutral-300">{step}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-5" style={{ borderColor: "#191919", background: "#0d0d0d" }}>
            <div className="mb-4 flex items-center gap-2 text-xs font-black tracking-[0.18em] text-neutral-500" style={{ fontFamily: "monospace" }}>
              <Wallet size={15} />
              MAINNET CONTRACTS
            </div>

            <div className="grid gap-3">
              {[
                ["Agent Registry", RUSH_ARENAS_CONTRACTS.agentRegistry],
                ["Arena Manager", RUSH_ARENAS_CONTRACTS.arenaManager],
                ["Battle Engine", RUSH_ARENAS_CONTRACTS.battleEngine],
                ["Treasury", treasury],
              ].map(([label, address]) => (
                <a
                  key={label}
                  href={address ? basescanAddressUrl(address as `0x${string}`) : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between rounded-md border px-3 py-3 transition-colors hover:border-[#00ff88]/30"
                  style={{ borderColor: "#181818", background: "#090909" }}
                >
                  <span className="text-sm text-neutral-400">{label}</span>
                  <span className="flex items-center gap-2 text-sm font-bold text-white" style={{ fontFamily: "monospace" }}>
                    {shortAddress(address as `0x${string}` | undefined)}
                    <ExternalLink size={14} className="text-neutral-600" />
                  </span>
                </a>
              ))}
            </div>

            <div className="mt-5 rounded-md border border-[#00aaff]/20 bg-[#00aaff]/10 px-4 py-3 text-sm leading-6 text-[#b9ecff]">
              This Rush page is pointed at Base mainnet arena contracts. The
              core arena mechanics stay unchanged while the Rush surface takes
              over naming and navigation.
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
