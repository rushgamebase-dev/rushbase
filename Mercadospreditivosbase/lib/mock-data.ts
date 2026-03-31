import { Market, MarketDisplay, PricePoint, ActivityItem, MarketCategory } from "@/types/market";

// Helper functions
export function shortAddress(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

export function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function formatVolume(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth >= 1000) return `${(eth / 1000).toFixed(1)}K ETH`;
  if (eth >= 1) return `${eth.toFixed(2)} ETH`;
  return `${eth.toFixed(4)} ETH`;
}

export function calculateOdds(totalPool: bigint, outcomePool: bigint): number {
  if (outcomePool === BigInt(0)) return 0;
  return Number(totalPool) / Number(outcomePool);
}

export function calculateProbability(totalPool: bigint, outcomePool: bigint): number {
  if (totalPool === BigInt(0)) return 0;
  return Math.round((Number(outcomePool) / Number(totalPool)) * 100);
}

// Generate 10 mock markets
const now = Date.now();
const DAY = 86400000;

export const MOCK_MARKETS: Market[] = [
  {
    id: "market-1",
    address: "0x1a2b3c4d5e6f7890abcdef1234567890abcdef01",
    title: "Will Base Chain surpass Solana's daily volume by July?",
    description: "Base's daily transaction volume will exceed Solana's on any single day before July 31, 2026.",
    category: "base-chain",
    outcomes: [
      { id: "m1-yes", label: "Yes", probability: 62, odds: 1.61, pool: BigInt("3100000000000000000") },
      { id: "m1-no", label: "No", probability: 38, odds: 2.63, pool: BigInt("1900000000000000000") },
    ],
    totalPool: BigInt("5000000000000000000"),
    poolByOutcome: { "Yes": BigInt("3100000000000000000"), "No": BigInt("1900000000000000000") },
    status: "open",
    closeDate: new Date("2026-07-31"),
    resolutionDate: new Date("2026-08-01"),
    resolutionSource: "DefiLlama API — daily volume",
    createdAt: new Date(now - 5 * DAY),
    icon: "🔵",
    isHot: true,
  },
  {
    id: "market-2",
    address: "0x2b3c4d5e6f7890abcdef1234567890abcdef0102",
    title: "How many times will Jesse Pollak tweet 'build' this week?",
    description: "Total tweet count from @jessepollak containing the word 'build' (case insensitive) from Monday to Sunday.",
    category: "community",
    outcomes: [
      { id: "m2-under5", label: "0-5", probability: 15, odds: 6.67, pool: BigInt("150000000000000000") },
      { id: "m2-6to10", label: "6-10", probability: 35, odds: 2.86, pool: BigInt("350000000000000000") },
      { id: "m2-11to15", label: "11-15", probability: 30, odds: 3.33, pool: BigInt("300000000000000000") },
      { id: "m2-over15", label: "16+", probability: 20, odds: 5.0, pool: BigInt("200000000000000000") },
    ],
    totalPool: BigInt("1000000000000000000"),
    poolByOutcome: { "0-5": BigInt("150000000000000000"), "6-10": BigInt("350000000000000000"), "11-15": BigInt("300000000000000000"), "16+": BigInt("200000000000000000") },
    status: "open",
    closeDate: new Date(now + 5 * DAY),
    resolutionDate: new Date(now + 6 * DAY),
    resolutionSource: "Twitter API — manually verified count",
    createdAt: new Date(now - 2 * DAY),
    icon: "🏗️",
    isHot: true,
  },
  {
    id: "market-3",
    address: "0x3c4d5e6f7890abcdef1234567890abcdef010203",
    title: "What will Base's volume be in April? (in billions USD)",
    description: "Total transaction volume on the Base chain during April 2026, measured in billions of dollars.",
    category: "base-chain",
    outcomes: [
      { id: "m3-low", label: "< $5B", probability: 20, odds: 5.0, pool: BigInt("400000000000000000") },
      { id: "m3-mid", label: "$5B - $10B", probability: 45, odds: 2.22, pool: BigInt("900000000000000000") },
      { id: "m3-high", label: "> $10B", probability: 35, odds: 2.86, pool: BigInt("700000000000000000") },
    ],
    totalPool: BigInt("2000000000000000000"),
    poolByOutcome: { "< $5B": BigInt("400000000000000000"), "$5B - $10B": BigInt("900000000000000000"), "> $10B": BigInt("700000000000000000") },
    status: "open",
    closeDate: new Date("2026-04-30"),
    resolutionDate: new Date("2026-05-02"),
    resolutionSource: "Basescan + DefiLlama on-chain data",
    createdAt: new Date(now - 3 * DAY),
    icon: "📊",
    isHot: false,
  },
  {
    id: "market-4",
    address: "0x4d5e6f7890abcdef1234567890abcdef01020304",
    title: "Will Mario Nawfal tweet more than 50 times in a day this week?",
    description: "On any day this week (Mon-Sun), will Mario Nawfal (@MarioNawfal) post more than 50 tweets?",
    category: "social",
    outcomes: [
      { id: "m4-yes", label: "Obviously yes", probability: 78, odds: 1.28, pool: BigInt("2340000000000000000") },
      { id: "m4-no", label: "No", probability: 22, odds: 4.55, pool: BigInt("660000000000000000") },
    ],
    totalPool: BigInt("3000000000000000000"),
    poolByOutcome: { "Obviously yes": BigInt("2340000000000000000"), "No": BigInt("660000000000000000") },
    status: "open",
    closeDate: new Date(now + 4 * DAY),
    resolutionDate: new Date(now + 5 * DAY),
    resolutionSource: "Twitter API — post count",
    createdAt: new Date(now - 1 * DAY),
    icon: "🐦",
    isHot: true,
  },
  {
    id: "market-5",
    address: "0x5e6f7890abcdef1234567890abcdef0102030405",
    title: "Will ETH hit $5,000 before June?",
    description: "The ETH/USD price will reach $5,000 on any major exchange before June 1, 2026.",
    category: "crypto",
    outcomes: [
      { id: "m5-yes", label: "Yes", probability: 42, odds: 2.38, pool: BigInt("4200000000000000000") },
      { id: "m5-no", label: "No", probability: 58, odds: 1.72, pool: BigInt("5800000000000000000") },
    ],
    totalPool: BigInt("10000000000000000000"),
    poolByOutcome: { "Yes": BigInt("4200000000000000000"), "No": BigInt("5800000000000000000") },
    status: "open",
    closeDate: new Date("2026-06-01"),
    resolutionDate: new Date("2026-06-02"),
    resolutionSource: "CoinGecko API — ETH/USD price",
    createdAt: new Date(now - 10 * DAY),
    icon: "💎",
    isHot: false,
  },
  {
    id: "market-6",
    address: "0x6f7890abcdef1234567890abcdef010203040506",
    title: "How many new protocols will launch on Base in April?",
    description: "Number of new protocols/dApps that will deploy on Base chain during April 2026, according to DappRadar.",
    category: "base-chain",
    outcomes: [
      { id: "m6-few", label: "< 20", probability: 25, odds: 4.0, pool: BigInt("125000000000000000") },
      { id: "m6-mid", label: "20-50", probability: 40, odds: 2.5, pool: BigInt("200000000000000000") },
      { id: "m6-many", label: "51-100", probability: 25, odds: 4.0, pool: BigInt("125000000000000000") },
      { id: "m6-ton", label: "100+", probability: 10, odds: 10.0, pool: BigInt("50000000000000000") },
    ],
    totalPool: BigInt("500000000000000000"),
    poolByOutcome: { "< 20": BigInt("125000000000000000"), "20-50": BigInt("200000000000000000"), "51-100": BigInt("125000000000000000"), "100+": BigInt("50000000000000000") },
    status: "open",
    closeDate: new Date("2026-04-30"),
    resolutionDate: new Date("2026-05-05"),
    resolutionSource: "DappRadar + Basescan verified contracts",
    createdAt: new Date(now - 7 * DAY),
    icon: "🚀",
    isHot: false,
  },
  {
    id: "market-7",
    address: "0x7890abcdef1234567890abcdef01020304050607",
    title: "Will Coinbase list a new Base-native token this month?",
    description: "Coinbase will add at least 1 token native to the Base chain to its exchange listing by end of month.",
    category: "base-chain",
    outcomes: [
      { id: "m7-yes", label: "Yes", probability: 55, odds: 1.82, pool: BigInt("825000000000000000") },
      { id: "m7-no", label: "No", probability: 45, odds: 2.22, pool: BigInt("675000000000000000") },
    ],
    totalPool: BigInt("1500000000000000000"),
    poolByOutcome: { "Yes": BigInt("825000000000000000"), "No": BigInt("675000000000000000") },
    status: "open",
    closeDate: new Date("2026-04-30"),
    resolutionDate: new Date("2026-05-01"),
    resolutionSource: "Coinbase official announcements",
    createdAt: new Date(now - 4 * DAY),
    icon: "🏦",
    isHot: false,
  },
  {
    id: "market-8",
    address: "0x890abcdef1234567890abcdef0102030405060708",
    title: "Will Aerodrome have more TVL than Uniswap on Base?",
    description: "Aerodrome Finance's TVL on Base will exceed Uniswap's TVL on Base by April 15.",
    category: "base-chain",
    outcomes: [
      { id: "m8-yes", label: "Aerodrome wins", probability: 67, odds: 1.49, pool: BigInt("1340000000000000000") },
      { id: "m8-no", label: "Uniswap holds", probability: 33, odds: 3.03, pool: BigInt("660000000000000000") },
    ],
    totalPool: BigInt("2000000000000000000"),
    poolByOutcome: { "Aerodrome wins": BigInt("1340000000000000000"), "Uniswap holds": BigInt("660000000000000000") },
    status: "locked",
    closeDate: new Date(now - 1 * DAY),
    resolutionDate: new Date(now + 1 * DAY),
    resolutionSource: "DefiLlama TVL data",
    createdAt: new Date(now - 14 * DAY),
    icon: "✈️",
    isHot: false,
  },
  {
    id: "market-9",
    address: "0x90abcdef1234567890abcdef010203040506070809",
    title: "What will Base's average gas be next week? (in gwei)",
    description: "Average gas price on Base chain during the full next week (Mon-Sun), measured in gwei.",
    category: "base-chain",
    outcomes: [
      { id: "m9-low", label: "< 0.01 gwei", probability: 60, odds: 1.67, pool: BigInt("600000000000000000") },
      { id: "m9-mid", label: "0.01-0.05 gwei", probability: 30, odds: 3.33, pool: BigInt("300000000000000000") },
      { id: "m9-high", label: "> 0.05 gwei", probability: 10, odds: 10.0, pool: BigInt("100000000000000000") },
    ],
    totalPool: BigInt("1000000000000000000"),
    poolByOutcome: { "< 0.01 gwei": BigInt("600000000000000000"), "0.01-0.05 gwei": BigInt("300000000000000000"), "> 0.05 gwei": BigInt("100000000000000000") },
    status: "resolved",
    closeDate: new Date(now - 7 * DAY),
    resolutionDate: new Date(now - 6 * DAY),
    resolutionSource: "Basescan gas tracker",
    createdAt: new Date(now - 14 * DAY),
    icon: "⛽",
    isHot: false,
  },
  {
    id: "market-10",
    address: "0x0abcdef1234567890abcdef01020304050607080910",
    title: "Will Farcaster have more than 100k DAU on Base this week?",
    description: "The Farcaster protocol will register more than 100,000 daily active users on at least one day this week.",
    category: "community",
    outcomes: [
      { id: "m10-yes", label: "Yes", probability: 48, odds: 2.08, pool: BigInt("720000000000000000") },
      { id: "m10-no", label: "No", probability: 52, odds: 1.92, pool: BigInt("780000000000000000") },
    ],
    totalPool: BigInt("1500000000000000000"),
    poolByOutcome: { "Yes": BigInt("720000000000000000"), "No": BigInt("780000000000000000") },
    status: "open",
    closeDate: new Date(now + 6 * DAY),
    resolutionDate: new Date(now + 7 * DAY),
    resolutionSource: "Dune Analytics — Farcaster DAU",
    createdAt: new Date(now - 1 * DAY),
    icon: "🟪",
    isHot: false,
  },
];

// Generate mock price history (50 points over 7 days per market)
export function generateMockPriceHistory(marketId: string): PricePoint[] {
  const market = MOCK_MARKETS.find((m) => m.id === marketId);
  const currentProb = market?.outcomes[0]?.probability ?? 50;
  const points: PricePoint[] = [];
  const startTime = Date.now() - 7 * 86400000;

  let prob = currentProb - 15 + Math.random() * 10;

  for (let i = 0; i < 50; i++) {
    const drift = (Math.random() - 0.48) * 4;
    prob = Math.max(5, Math.min(95, prob + drift));
    points.push({
      timestamp: startTime + i * (7 * 86400000 / 50),
      probability: Math.round(prob * 10) / 10,
      volume: Math.random() * 0.5,
    });
  }

  // Last point matches current probability
  points[points.length - 1].probability = currentProb;

  return points;
}

// Generate mock activity feed
const MOCK_WALLETS = [
  "0x1a2b3c4d5e6f7890abcdef1234567890abcdef01",
  "0xdeadbeef12345678901234567890123456789012",
  "0xcafebabe98765432101234567890abcdef012345",
  "0xf00dbabe55555555555555555555555555555555",
  "0xbaadf00d11111111111111111111111111111111",
  "0xfeed1234abcdef567890abcdef1234567890abcd",
  "0xace09876543210fedcba9876543210fedcba9876",
  "0xbed12345678901234567890123456789012345678",
];

export function generateMockActivity(marketId: string, count: number = 20): ActivityItem[] {
  const market = MOCK_MARKETS.find((m) => m.id === marketId);
  if (!market) return [];

  const items: ActivityItem[] = [];
  for (let i = 0; i < count; i++) {
    const outcome = market.outcomes[Math.floor(Math.random() * market.outcomes.length)];
    const wallet = MOCK_WALLETS[Math.floor(Math.random() * MOCK_WALLETS.length)];
    items.push({
      id: `activity-${marketId}-${i}`,
      type: "bet",
      marketId,
      user: wallet,
      outcomeLabel: outcome.label,
      amount: Number((Math.random() * 0.1 + 0.001).toFixed(4)),
      txHash: `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`,
      timestamp: Date.now() - Math.floor(Math.random() * 3600000),
    });
  }

  return items.sort((a, b) => b.timestamp - a.timestamp);
}

// Convert Market to MarketDisplay (for cards)
export function marketToDisplay(market: Market): MarketDisplay {
  const eth = Number(market.totalPool) / 1e18;
  let liquidity: "High" | "Medium" | "Low" = "Low";
  if (eth >= 5) liquidity = "High";
  else if (eth >= 1) liquidity = "Medium";

  const daysLeft = Math.max(0, Math.ceil((market.closeDate.getTime() - Date.now()) / 86400000));
  const endDateStr = daysLeft === 0 ? "Ended" : market.closeDate.toLocaleDateString("en-US", { day: "numeric", month: "short" });

  return {
    id: market.id,
    title: market.title,
    category: market.category,
    icon: market.icon || "📊",
    volume: formatVolume(market.totalPool),
    outcomes: market.outcomes.map((o) => ({
      label: o.label,
      prob: o.probability,
      odds: Math.round(o.odds * 100) / 100,
    })),
    endDate: endDateStr,
    isHot: market.isHot ?? false,
    liquidity,
    change24h: Math.round((Math.random() * 10 - 3) * 10) / 10,
    status: market.status,
    totalBettors: Math.floor(Number(market.totalPool) / 1e18 * 15 + Math.random() * 10),
  };
}

// Category metadata
export const CATEGORIES: Record<MarketCategory | "all", { label: string; icon: string }> = {
  all: { label: "All", icon: "🌐" },
  "base-chain": { label: "Base Chain", icon: "🔵" },
  crypto: { label: "Crypto", icon: "₿" },
  social: { label: "Social", icon: "🐦" },
  community: { label: "Community", icon: "🏗️" },
  other: { label: "Other", icon: "📌" },
};
