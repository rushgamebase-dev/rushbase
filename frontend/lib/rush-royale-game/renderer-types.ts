// ============================================
// GAME TYPES - Shared with server
// ============================================

export interface Vector2 {
  x: number;
  y: number;
}

export interface AgentState {
  id: string;
  agentId: string;
  owner: string;
  name?: string;
  position: Vector2;
  health: number;
  maxHealth: number;
  isAlive: boolean;
  color: string;
  shape: 'circle' | 'hexagon' | 'diamond';
  size: number;
}

export interface ArenaState {
  center: Vector2;
  currentRadius: number;
  phase: ArenaPhase;
}

export enum ArenaPhase {
  WARMUP = 'warmup',
  SHRINKING = 'shrinking',
  HOLD = 'hold',
  FINAL = 'final',
}

export interface GameEvent {
  tick: number;
  type: string;
  data: any;
}

// ============================================
// PROJECTILE SYSTEM
// ============================================

export enum ProjectileType {
  NORMAL = 'normal',
  ULTIMATE = 'ultimate',
}

export interface ProjectileUpdate {
  id: string;
  x: number;
  y: number;
  type: ProjectileType;
}

export interface ProjectileSpawnEvent {
  id: string;
  ownerId: string;
  position: Vector2;
  velocity: Vector2;
  type: ProjectileType;
  damage: number;
  radius: number;
}

export interface ProjectileHitEvent {
  projectileId: string;
  projectileType: ProjectileType;
  targetId: string;
  shooterId: string;
  position: Vector2;
  damage: number;
}

// ============================================
// TICK UPDATES
// ============================================

export interface TickUpdate {
  tick: number;
  agents: AgentUpdate[];
  projectiles: ProjectileUpdate[];
  arena: {
    radius: number;
    phase: ArenaPhase;
  };
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

export interface MatchState {
  matchId: string;
  arenaId: string;
  tick: number;
  status: string;
  agents: AgentState[];
  arena: ArenaState;
  seed: string;
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
    artifacts?: Record<string, any>;
  };
}
