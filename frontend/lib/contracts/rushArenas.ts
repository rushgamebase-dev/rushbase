import { parseAbi } from "viem";

export type ArenaState = 0 | 1 | 2 | 3 | 4 | 5;
export type ArenaTier = 0 | 1 | 2 | 3;
export type ArenaSection = "join" | "fleet" | "watch" | "ledger";

export type RushAgent = {
  owner: `0x${string}`;
  agentId: bigint;
  createdAt: bigint;
  totalBattles: bigint;
  totalWins: bigint;
  isActive: boolean;
};

export type RushArena = {
  arenaId: bigint;
  tier: ArenaTier;
  entryFee: bigint;
  minPlayers: bigint;
  maxPlayers: bigint;
  registrationStart: bigint;
  registrationEnd: bigint;
  prizePool: bigint;
  state: ArenaState;
  creator: `0x${string}`;
  vrfRequestId: bigint;
  seed: bigint;
  winnerId: bigint;
};

export type RushArenaParticipant = {
  agentId: bigint;
  owner: `0x${string}`;
  boostIds: bigint[];
  joinedAt: bigint;
  eliminated: boolean;
  eliminatedRound: bigint;
};

export type RushBattleResult = {
  arenaId: bigint;
  winnerId: bigint;
  totalRounds: bigint;
  seed: bigint;
  resultHash: `0x${string}`;
  executedAt: bigint;
};

export const RUSH_ARENAS_CONTRACTS = {
  agentRegistry: "0x99ce3Ad5cEd0630011B761a590AEB3f8EA653e24",
  arenaManager: "0xa8452224F005a3e79f391296cD798B6a79724A63",
  battleEngine: "0xFA1a670Ff366faA63E87A6b8977dfe5DC22C23Ed",
  championshipTrophy: "0x4d2C1422Dc6B66C6A771123d63adC475439e84f3",
} as const satisfies Record<string, `0x${string}`>;

export const AGENT_REGISTRY_ABI = parseAbi([
  "function totalAgents() view returns (uint256)",
  "function creationFee() view returns (uint256)",
  "function maxAgentsPerWallet() view returns (uint256)",
  "function creationCooldown() view returns (uint256)",
  "function getAgentsByOwner(address owner) view returns (uint256[])",
  "function getAgent(uint256 agentId) view returns ((address owner,uint256 agentId,uint256 createdAt,uint256 totalBattles,uint256 totalWins,bool isActive))",
  "function isOwner(uint256 agentId,address account) view returns (bool)",
  "function isAgentActive(uint256 agentId) view returns (bool)",
  "function createAgent() payable returns (uint256)",
  "function activateAgent(uint256 agentId)",
  "function deactivateAgent(uint256 agentId)",
  "event AgentCreated(uint256 indexed agentId,address indexed owner,uint256 timestamp)",
  "event AgentActivated(uint256 indexed agentId)",
  "event AgentDeactivated(uint256 indexed agentId)",
  "event AgentStatsUpdated(uint256 indexed agentId,uint256 totalBattles,uint256 totalWins)",
  "error AgentAlreadyActive()",
  "error AgentAlreadyInactive()",
  "error AgentDoesNotExist()",
  "error AgentNotActive()",
  "error CreationCooldownActive()",
  "error InsufficientBalance()",
  "error InsufficientCreationFee()",
  "error MaxAgentsPerWalletReached()",
  "error NotAgentOwner()",
  "error TransferFailed()",
  "error UnauthorizedCaller()",
]);

export const ARENA_MANAGER_ABI = parseAbi([
  "function totalArenas() view returns (uint256)",
  "function battleEngine() view returns (address)",
  "function maxAgentsPerArenaPerWallet() view returns (uint256)",
  "function minRegistrationDuration() view returns (uint256)",
  "function maxRegistrationDuration() view returns (uint256)",
  "function createArena(uint8 tier,uint256 entryFee,uint256 minPlayers,uint256 maxPlayers,uint256 registrationDuration) returns (uint256)",
  "function joinArena(uint256 arenaId,uint256 agentId,uint256[] boostIds) payable",
  "function commitStrategy(uint256 arenaId,uint256 agentId,bytes32 strategyHash)",
  "function lockArena(uint256 arenaId)",
  "function cancelArena(uint256 arenaId)",
  "function autoCancelExpired(uint256 arenaId)",
  "function claimRefund(uint256 arenaId,uint256 agentId)",
  "function bulkRefund(uint256 arenaId)",
  "function getArena(uint256 arenaId) view returns ((uint256 arenaId,uint8 tier,uint256 entryFee,uint256 minPlayers,uint256 maxPlayers,uint256 registrationStart,uint256 registrationEnd,uint256 prizePool,uint8 state,address creator,uint256 vrfRequestId,uint256 seed,uint256 winnerId))",
  "function getArenaParticipants(uint256 arenaId) view returns ((uint256 agentId,address owner,uint256[] boostIds,uint256 joinedAt,bool eliminated,uint256 eliminatedRound)[])",
  "function getParticipantCount(uint256 arenaId) view returns (uint256)",
  "function hasJoined(uint256 arenaId,uint256 agentId) view returns (bool)",
  "function getPrizePool(uint256 arenaId) view returns (uint256)",
  "function getArenaStartedAt(uint256 arenaId) view returns (uint256)",
  "function getArenaLockedAt(uint256 arenaId) view returns (uint256)",
  "function isArenaTimedOut(uint256 arenaId) view returns (bool)",
  "function isLockTimedOut(uint256 arenaId) view returns (bool)",
  "event ArenaCreated(uint256 indexed arenaId,uint8 indexed tier,uint256 entryFee,uint256 minPlayers,uint256 maxPlayers,uint256 registrationEnd,address indexed creator)",
  "event AgentJoinedArena(uint256 indexed arenaId,uint256 indexed agentId,address indexed owner,uint256[] boostIds)",
  "event StrategyCommitted(uint256 indexed arenaId,uint256 indexed agentId,bytes32 strategyHash)",
  "event ArenaLocked(uint256 indexed arenaId,uint256 participantCount,uint256 vrfRequestId)",
  "event ArenaStarted(uint256 indexed arenaId,uint256 seed)",
  "event ArenaFinished(uint256 indexed arenaId,uint256 indexed winnerId,uint256 prizeAmount)",
  "event ArenaCancelled(uint256 indexed arenaId,string reason)",
  "event RefundClaimed(uint256 indexed arenaId,uint256 indexed agentId,address indexed owner,uint256 amount)",
  "error AgentAlreadyJoined()",
  "error AgentNotActive()",
  "error AgentNotInArena()",
  "error ArenaClosed()",
  "error ArenaDoesNotExist()",
  "error ArenaFull()",
  "error ArenaNotCancelled()",
  "error ArenaNotExpired()",
  "error ArenaNotFinished()",
  "error ArenaNotLocked()",
  "error ArenaNotOpen()",
  "error ArenaNotRunning()",
  "error EntryFeeOutOfRange()",
  "error InsufficientEntryFee()",
  "error InvalidArenaParameters()",
  "error InvalidTier()",
  "error MaxAgentsPerArenaReached()",
  "error MinPlayersNotReached()",
  "error NotAgentOwner()",
  "error PlayerCountOutOfRange()",
  "error RefundAlreadyClaimed()",
  "error RegistrationEnded()",
  "error RegistrationNotEnded()",
  "error StrategyAlreadySet()",
  "error TierNotActive()",
  "error TransferFailed()",
  "error UnauthorizedCaller()",
]);

export const BATTLE_ENGINE_ABI = parseAbi([
  "function protocolFeeBps() view returns (uint256)",
  "function treasuryAddress() view returns (address)",
  "function revealDelay() view returns (uint256)",
  "function callbackGasLimit() view returns (uint32)",
  "function requestConfirmations() view returns (uint16)",
  "function commitRevealEnabled() view returns (bool)",
  "function estimateVRFCost() view returns (uint256)",
  "function pendingFees() view returns (uint256)",
  "function authorizedExecutors(address executor) view returns (bool)",
  "function getBattleResult(uint256 arenaId) view returns ((uint256 arenaId,uint256 winnerId,uint256 totalRounds,uint256 seed,bytes32 resultHash,uint256 executedAt))",
  "function getSeed(uint256 arenaId) view returns (uint256)",
  "function getVRFRequest(uint256 arenaId) view returns (uint256)",
  "function getCommitment(uint256 arenaId) view returns (bytes32)",
  "function getCommitTimestamp(uint256 arenaId) view returns (uint256)",
  "function requestRandomness(uint256 arenaId) returns (uint256)",
  "function distributePrizes(uint256 arenaId)",
  "event VRFRequested(uint256 indexed arenaId,uint256 indexed requestId)",
  "event VRFFulfilled(uint256 indexed arenaId,uint256 indexed requestId,uint256 seed)",
  "event BattleExecuted(uint256 indexed arenaId,uint256 indexed winnerId,uint256 totalRounds,bytes32 resultHash)",
  "event BattleResultCommitted(uint256 indexed arenaId,bytes32 commitHash)",
  "event BattleResultRevealed(uint256 indexed arenaId,uint256 indexed winnerId,uint256 totalRounds,bytes32 resultHash)",
  "event PayoutDistributed(uint256 indexed arenaId,uint256 indexed winnerId,address winner,uint256 winnerPrize,uint256 protocolFee)",
  "error ArenaNotLocked()",
  "error ArenaNotReady()",
  "error BattleAlreadyExecuted()",
  "error CommitmentAlreadyExists()",
  "error InsufficientVRFBalance()",
  "error InvalidCommitment()",
  "error InvalidFeeBps()",
  "error InvalidResultSubmission()",
  "error InvalidSeed()",
  "error InvalidVRFRequest()",
  "error InvalidWinnerAddress()",
  "error InvalidWinnerId()",
  "error NoCommitmentFound()",
  "error NoPendingFees()",
  "error NoVRFRequestToClear()",
  "error PayoutFailed()",
  "error RevealTooEarly()",
  "error UnauthorizedCaller()",
]);

export function basescanAddressUrl(address: `0x${string}`) {
  return `https://basescan.org/address/${address}`;
}

export function basescanTxUrl(hash: `0x${string}`) {
  return `https://basescan.org/tx/${hash}`;
}

export const ARENA_STATE_LABELS: Record<ArenaState, string> = {
  0: "Created",
  1: "Open",
  2: "Locked",
  3: "Running",
  4: "Finished",
  5: "Cancelled",
};

export const ARENA_TIER_LABELS: Record<ArenaTier, string> = {
  0: "Bronze",
  1: "Silver",
  2: "Gold",
  3: "Diamond",
};

export const ARENA_TIER_LIMITS: Record<
  ArenaTier,
  { minFeeEth: string; maxFeeEth: string; minPlayers: number; maxPlayers: number }
> = {
  0: { minFeeEth: "0", maxFeeEth: "0", minPlayers: 2, maxPlayers: 50 },
  1: { minFeeEth: "0.006", maxFeeEth: "0.02", minPlayers: 10, maxPlayers: 100 },
  2: { minFeeEth: "0.021", maxFeeEth: "0.1", minPlayers: 20, maxPlayers: 100 },
  3: { minFeeEth: "0.101", maxFeeEth: "10", minPlayers: 20, maxPlayers: 50 },
};
