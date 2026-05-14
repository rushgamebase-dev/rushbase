// ============================================
// GAME TYPES - Arena Royale Core
// ============================================

export interface Vector2 {
  x: number;
  y: number;
}

export interface Agent {
  id: string;
  agentId: bigint;
  owner: string;
  name?: string;
  position: Vector2;
  velocity: Vector2;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  color: string;
  shape: 'circle' | 'hexagon' | 'diamond';
  size: number;
  boosts: BoostEffect[];
  eliminatedAt?: number;
  eliminatedBy?: string;
  lastDamageSource?: 'zone' | 'combat';
  // Combat state
  shotCooldownRemaining: number;
  ultimateReady: boolean;
  ultimateCharge: number;
  kills: number;
  lastDamageTick: number;
  // Behavior system
  mood: AgentMood;
  style: CombatStyle;
  strafePhaseOffset: number; // Random offset [0..1] for strafe oscillation, assigned at spawn
}

export interface BoostEffect {
  type: BoostType;
  value: number;
  remainingTicks: number;
}

export enum BoostType {
  SHIELD = 0,
  SECOND_WIND = 1,
  LUCKY_CHARM = 2,
  ZONE_RESIST = 3,
  EARLY_BIRD = 4,
}

// ============================================
// AGENT BEHAVIOR SYSTEM
// Simple layers that create emergent personality
// ============================================

export enum AgentMood {
  AGGRESSIVE = 'aggressive', // High confidence, seeks fights
  CAUTIOUS = 'cautious',     // Many enemies nearby, careful
  PANIC = 'panic',           // Low health, erratic
  HUNTING = 'hunting',       // Few enemies left, tracking
}

export enum CombatStyle {
  RUSHER = 'rusher',   // Close range, high risk
  SNIPER = 'sniper',   // Long range, patient
  COWARD = 'coward',   // Avoids fights when possible
  CHAOTIC = 'chaotic', // Unpredictable decisions
}

export interface Arena {
  center: Vector2;
  currentRadius: number;
  targetRadius: number;
  shrinkRate: number;
  damagePerTick: number;
  phase: ArenaPhase;
}

export enum ArenaPhase {
  WARMUP = 'warmup',
  SHRINKING = 'shrinking',
  HOLD = 'hold',
  FINAL = 'final',
}

// ============================================
// PROJECTILE SYSTEM
// ============================================

export enum ProjectileType {
  NORMAL = 'normal',
  ULTIMATE = 'ultimate',
}

export interface Projectile {
  id: string;
  ownerId: string;
  position: Vector2;
  velocity: Vector2;
  damage: number;
  radius: number;
  type: ProjectileType;
  remainingTicks: number;
  spawnTick: number;
}

export interface CombatConfig {
  normalShot: {
    damage: number;
    speed: number;
    radius: number;
    cooldownTicks: number;
    ttlTicks: number;
  };
  ultimate: {
    damage: number;
    speed: number;
    radius: number;
    ttlTicks: number;
    rechargeChancePerTick: number;
  };
}

export interface GameEvent {
  tick: number;
  type: GameEventType;
  data: any;
}

export enum GameEventType {
  AGENT_SPAWNED = 'agent_spawned',
  AGENT_MOVED = 'agent_moved',
  AGENT_DAMAGED = 'agent_damaged',
  AGENT_ELIMINATED = 'agent_eliminated',
  AGENT_HEALED = 'agent_healed',
  ARENA_SHRINK_START = 'arena_shrink_start',
  ARENA_SHRINK_COMPLETE = 'arena_shrink_complete',
  COMBAT_START = 'combat_start',
  COMBAT_HIT = 'combat_hit',
  BOOST_ACTIVATED = 'boost_activated',
  BOOST_EXPIRED = 'boost_expired',
  MATCH_START = 'match_start',
  MATCH_END = 'match_end',
  // Projectile events
  PROJECTILE_SPAWNED = 'projectile_spawned',
  PROJECTILE_HIT = 'projectile_hit',
  PROJECTILE_EXPIRED = 'projectile_expired',
  // Ultimate events
  ULTIMATE_READY = 'ultimate_ready',
  ULTIMATE_FIRED = 'ultimate_fired',
}

export interface MatchState {
  matchId: string;
  arenaId: bigint;
  tick: number;
  status: MatchStatus;
  agents: Map<string, Agent>;
  projectiles: Map<string, Projectile>;
  arena: Arena;
  events: GameEvent[];
  seed: bigint;
  startedAt: number;
  winnerId?: string;
}

export enum MatchStatus {
  WAITING = 'waiting',
  STARTING = 'starting',
  RUNNING = 'running',
  FINISHED = 'finished',
}

export interface MatchConfig {
  configVersion: string; // Versioning for replay compatibility
  arenaId: bigint;
  seed: bigint;
  tickRate: number; // ticks per second
  arenaRadius: number;
  shrinkSchedule: ShrinkPhase[];
  agentSpeed: number;
  zoneDamage: number;
  combat: CombatConfig;
}

export interface ShrinkPhase {
  startTick: number;
  duration: number;
  targetRadius: number;
  holdDuration: number;
}

export interface ParticipantData {
  agentId: bigint;
  owner: string;
  boostIds: bigint[];
}

// ============================================
// STRATEGY TEMPLATE v1 (OpenClaw Integration)
// Template is intention, not power.
// Biases decisions. Never changes mechanics.
// ============================================

export type PositioningBias = 'center' | 'edge' | 'roamer';
export type TargetPriority = 'weakest' | 'closest' | 'threat';
export type UltimatePolicy = 'early' | 'opportunistic' | 'late';

export interface StrategyTemplate {
  aggressiveness: number;      // 0.0 - 1.0
  riskTolerance: number;       // 0.0 - 1.0
  positioningBias: PositioningBias;
  targetPriority: TargetPriority;
  ultimatePolicy: UltimatePolicy;
  evasionSkill: number;        // 0.0 - 1.0 — dodge projectile ability
  shotAccuracy: number;        // 0.0 - 1.0 — shot prediction + spread
  triggerDiscipline: number;   // 0.0 - 1.0 — shooting selectivity (low=spam, high=patient)
  pursuitTenacity: number;     // 0.0 - 1.0 — long-range chase intensity
  strafeCadence: number;       // 0.0 - 1.0 — strafe cycle speed (low=slow, high=twitchy)
}

// Default template produces behavior identical to engine v1 (no template)
export const DEFAULT_STRATEGY_TEMPLATE: StrategyTemplate = {
  aggressiveness: 0.5,
  riskTolerance: 0.5,
  positioningBias: 'roamer',
  targetPriority: 'closest',       // v1 always uses nearest target
  ultimatePolicy: 'opportunistic', // v1 uses mixed conditions
  evasionSkill: 0.5,              // v1 equivalent: mood-only dodge
  shotAccuracy: 0.5,              // v1 equivalent: 0.3-0.8 prediction, 0.35 spread
  triggerDiscipline: 0.5,         // v1 equivalent: 0.6 base chance
  pursuitTenacity: 0.5,           // v1 equivalent: >300u threshold, /200 scaling
  strafeCadence: 0.5,             // v1 equivalent: 100 agg / 80 caut period
};

// Participant data extended with optional strategy template
export interface ParticipantDataV2 extends ParticipantData {
  strategyTemplate?: StrategyTemplate;
  name?: string;
}

// ============================================
// CLIENT MESSAGE TYPES
// ============================================

export interface ClientMessage {
  type: ClientMessageType;
  payload: any;
}

export enum ClientMessageType {
  JOIN_MATCH = 'join_match',
  SPECTATE = 'spectate',
  LEAVE = 'leave',
}

export interface ServerMessage {
  type: ServerMessageType;
  payload: any;
}

export enum ServerMessageType {
  MATCH_STATE = 'match_state',
  TICK_UPDATE = 'tick_update',
  EVENTS = 'events',
  MATCH_END = 'match_end',
  ERROR = 'error',
}

// ============================================
// TICK UPDATE (Optimized for bandwidth)
// ============================================

export interface TickUpdate {
  tick: number;
  agents: AgentUpdate[];
  projectiles: ProjectileUpdate[];
  arena: ArenaUpdate;
  events: GameEvent[];
}

export interface AgentUpdate {
  id: string;
  x: number;
  y: number;
  health: number;
  isAlive: boolean;
  ultReady?: boolean;
}

export interface ProjectileUpdate {
  id: string;
  x: number;
  y: number;
  type: ProjectileType;
}

export interface ArenaUpdate {
  radius: number;
  phase: ArenaPhase;
}

// ============================================
// ARENA WEBSOCKET UPDATES
// ============================================

export type ArenaEventType =
  | 'arena_full'
  | 'arena_locked'
  | 'vrf_requested'
  | 'arena_started'
  | 'match_ready'
  | 'simulation_progress'
  | 'arena_battle_complete'
  | 'arena_finished'
  | 'arena_error';

export interface ArenaWebSocketUpdate {
  type: ArenaEventType;
  arenaId: string;
  timestamp: number;
  data?: {
    seed?: string;
    winnerId?: string;
    winnerOwner?: string;
    matchId?: string;
    participantCount?: number;
    maxPlayers?: number;
    vrfRequestId?: string;
    txHash?: string;
    progress?: number;
    error?: string;
    totalTicks?: number;
    eliminationOrder?: Array<{
      agentId: string;
      eliminatedAt: number;
      source: string;
    }>;
    prizeAmount?: string;
    distributeTxHash?: string;
  };
}
