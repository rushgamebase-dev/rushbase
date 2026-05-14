// ============================================
// GAME ENGINE - Deterministic Battle Simulation
// ============================================

import {
  Agent,
  AgentMood,
  AgentUpdate,
  Arena,
  ArenaPhase,
  BoostEffect,
  BoostType,
  CombatConfig,
  CombatStyle,
  GameEvent,
  GameEventType,
  MatchConfig,
  MatchState,
  MatchStatus,
  ParticipantData,
  Projectile,
  ProjectileType,
  ProjectileUpdate,
  ShrinkPhase,
  TickUpdate,
  Vector2,
} from './types';

// ============================================
// GAME CONFIG VERSION
// Increment this when changing ANY game parameter
// This ensures replays use the correct config
// ============================================
export const GAME_CONFIG_VERSION = '1.0.0';

// Combat style modifiers
const STYLE_MODIFIERS = {
  [CombatStyle.RUSHER]: { shootChance: 1.3, preferredRange: 0.4, aggression: 1.4 },
  [CombatStyle.SNIPER]: { shootChance: 0.8, preferredRange: 0.9, aggression: 0.7 },
  [CombatStyle.COWARD]: { shootChance: 0.5, preferredRange: 0.7, aggression: 0.3 },
  [CombatStyle.CHAOTIC]: { shootChance: 1.0, preferredRange: 0.6, aggression: 1.0 },
};

// Movement behavior modifiers based on combat style
const MOVEMENT_MODIFIERS = {
  [CombatStyle.RUSHER]: {
    approachSpeed: 1.4,      // Rushes towards enemies
    strafeAmount: 0.3,       // Less strafing, more direct
    fleeThreshold: 0.15,     // Only flees at very low health
    repulsionStrength: 0.2,  // Gets close to others
  },
  [CombatStyle.SNIPER]: {
    approachSpeed: 0.3,      // Maintains distance
    strafeAmount: 0.6,       // More circular movement
    fleeThreshold: 0.35,     // Cautious about health
    repulsionStrength: 0.5,  // Keeps distance from others
  },
  [CombatStyle.COWARD]: {
    approachSpeed: -0.2,     // Negative = retreats
    strafeAmount: 0.4,       // Moderate strafing
    fleeThreshold: 0.5,      // Flees at half health
    repulsionStrength: 0.7,  // Avoids everyone
  },
  [CombatStyle.CHAOTIC]: {
    approachSpeed: 0.8,      // Variable
    strafeAmount: 0.8,       // Erratic movement
    fleeThreshold: 0.25,     // Unpredictable
    repulsionStrength: 0.4,  // Normal spacing
  },
};

const COMBAT_STYLES = [CombatStyle.RUSHER, CombatStyle.SNIPER, CombatStyle.COWARD, CombatStyle.CHAOTIC];

// Deterministic random number generator (seeded)
class SeededRandom {
  private seed: number;

  constructor(seed: bigint) {
    this.seed = Number(seed % BigInt(2147483647));
    if (this.seed <= 0) this.seed += 2147483646;
  }

  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }

  nextRange(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.nextRange(min, max + 1));
  }
}

// Agent colors - distinct and visible
const AGENT_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
  '#F8B500', '#00CED1', '#FF6347', '#7B68EE', '#3CB371',
  '#FF69B4', '#00FA9A', '#FFD700', '#1E90FF', '#FF4500',
];

const AGENT_SHAPES: ('circle' | 'hexagon' | 'diamond')[] = ['circle', 'hexagon', 'diamond'];

export class GameEngine {
  private state: MatchState;
  private config: MatchConfig;
  private rng: SeededRandom;
  private currentShrinkPhase: number = 0;
  private holdStartTick: number = -1; // Tick when HOLD phase started (-1 = not in hold)
  private shrinkPhaseStarted: boolean = false; // Guards against re-triggering phase start during HOLD

  // Pre-allocated buffers to reduce GC pressure (reused every tick)
  private agentUpdateBuffer: AgentUpdate[] = [];
  private projectileUpdateBuffer: ProjectileUpdate[] = [];
  private aliveAgentsCache: Agent[] = [];
  private hitProjectileIds: Set<string> = new Set();

  constructor(config: MatchConfig, participants: ParticipantData[]) {
    this.config = config;
    this.rng = new SeededRandom(config.seed);

    this.state = {
      matchId: `match_${config.arenaId}_${Date.now()}`,
      arenaId: config.arenaId,
      tick: 0,
      status: MatchStatus.WAITING,
      agents: new Map(),
      projectiles: new Map(),
      arena: {
        center: { x: 0, y: 0 },
        currentRadius: config.arenaRadius,
        targetRadius: config.arenaRadius,
        shrinkRate: 0,
        damagePerTick: config.zoneDamage,
        phase: ArenaPhase.WARMUP,
      },
      events: [],
      seed: config.seed,
      startedAt: Date.now(),
    };

    this.spawnAgents(participants);
  }

  private spawnAgents(participants: ParticipantData[]): void {
    const angleStep = (2 * Math.PI) / participants.length;
    const spawnRadius = this.config.arenaRadius * 0.7;

    participants.forEach((p, index) => {
      const angle = angleStep * index + this.rng.nextRange(-0.2, 0.2);
      const radius = spawnRadius + this.rng.nextRange(-50, 50);

      // Random combat style creates personality
      const style = COMBAT_STYLES[this.rng.nextInt(0, COMBAT_STYLES.length - 1)];

      const agent: Agent = {
        id: `agent_${p.agentId}`,
        agentId: p.agentId,
        owner: p.owner,
        position: {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        },
        velocity: { x: 0, y: 0 },
        health: 100,
        maxHealth: 100,
        isAlive: true,
        color: AGENT_COLORS[index % AGENT_COLORS.length],
        shape: AGENT_SHAPES[index % AGENT_SHAPES.length],
        size: 20,
        boosts: this.createBoostEffects(p.boostIds),
        // Combat state
        shotCooldownRemaining: 0,
        ultimateReady: false,
        ultimateCharge: 0,
        kills: 0,
        lastDamageTick: 0,
        // Behavior - creates personality
        mood: AgentMood.CAUTIOUS,
        style,
        strafePhaseOffset: 0, // v1 legacy: not used
      };

      this.state.agents.set(agent.id, agent);
      this.emitEvent(GameEventType.AGENT_SPAWNED, {
        agentId: agent.id,
        position: agent.position,
        color: agent.color,
      });
    });
  }

  private createBoostEffects(boostIds: bigint[]): BoostEffect[] {
    return boostIds.map((id) => {
      const type = Number(id) as BoostType;
      return {
        type,
        value: this.getBoostValue(type),
        remainingTicks: this.getBoostDuration(type),
      };
    });
  }

  private getBoostValue(type: BoostType): number {
    switch (type) {
      case BoostType.SHIELD: return 30; // +30% damage resistance
      case BoostType.SECOND_WIND: return 1; // 1 revive
      case BoostType.LUCKY_CHARM: return 10; // +10% survival chance
      case BoostType.ZONE_RESIST: return 50; // 50% zone damage reduction
      case BoostType.EARLY_BIRD: return 20; // +20% speed early game
      default: return 0;
    }
  }

  private getBoostDuration(type: BoostType): number {
    const tickRate = this.config.tickRate;
    switch (type) {
      case BoostType.SHIELD: return tickRate * 60; // 60 seconds
      case BoostType.SECOND_WIND: return Infinity; // Until used
      case BoostType.LUCKY_CHARM: return Infinity; // Entire match
      case BoostType.ZONE_RESIST: return Infinity; // Entire match
      case BoostType.EARLY_BIRD: return tickRate * 90; // 90 seconds
      default: return 0;
    }
  }

  start(): void {
    this.state.status = MatchStatus.RUNNING;
    this.state.startedAt = Date.now();
    this.emitEvent(GameEventType.MATCH_START, {
      matchId: this.state.matchId,
      agentCount: this.state.agents.size,
    });
  }

  tick(): TickUpdate {
    if (this.state.status !== MatchStatus.RUNNING) {
      return this.createTickUpdate();
    }

    this.state.tick++;
    this.state.events = []; // Clear events for this tick

    // Cache alive agents for this tick (avoids repeated filter calls)
    this.aliveAgentsCache.length = 0;
    for (const agent of this.state.agents.values()) {
      if (agent.isAlive) this.aliveAgentsCache.push(agent);
    }

    // Update arena shrinking
    this.updateArena();

    // Update agents
    this.updateAgents();

    // Projectile-based combat system
    this.processAgentCombat();    // AI shooting decisions + ultimate recharge
    this.updateProjectiles();      // Move projectiles, check TTL
    this.processProjectileHits();  // Circle-circle collision detection

    // Apply zone damage
    this.applyZoneDamage();

    // Check win condition
    this.checkWinCondition();

    return this.createTickUpdate();
  }

  private updateArena(): void {
    const schedule = this.config.shrinkSchedule;
    if (this.currentShrinkPhase >= schedule.length) return;

    // Check if hold phase is complete (tick-based, no setTimeout)
    if (this.state.arena.phase === ArenaPhase.HOLD && this.holdStartTick >= 0) {
      const phase = schedule[this.currentShrinkPhase];
      const ticksInHold = this.state.tick - this.holdStartTick;
      if (ticksInHold >= phase.holdDuration) {
        this.currentShrinkPhase++;
        this.holdStartTick = -1;
        this.shrinkPhaseStarted = false; // Reset flag so next phase can start
        // Fall through — don't return, start next phase immediately if ready
      }
    }

    // Re-check bounds after potential phase increment
    if (this.currentShrinkPhase >= schedule.length) return;
    const currentPhase = schedule[this.currentShrinkPhase];

    // Check if we should start this phase
    // >= handles hold-to-shrink same-tick transition AND floating point rounding
    // shrinkPhaseStarted prevents re-triggering during HOLD (where phase !== SHRINKING but tick >= startTick)
    if (this.state.tick >= currentPhase.startTick && !this.shrinkPhaseStarted) {
      this.shrinkPhaseStarted = true;
      this.state.arena.targetRadius = currentPhase.targetRadius;
      this.state.arena.shrinkRate =
        (this.state.arena.currentRadius - currentPhase.targetRadius) / currentPhase.duration;
      this.state.arena.phase = ArenaPhase.SHRINKING;

      this.emitEvent(GameEventType.ARENA_SHRINK_START, {
        fromRadius: this.state.arena.currentRadius,
        toRadius: currentPhase.targetRadius,
        duration: currentPhase.duration,
      });
    }

    // Shrink the arena
    if (this.state.arena.phase === ArenaPhase.SHRINKING) {
      this.state.arena.currentRadius -= this.state.arena.shrinkRate;

      if (this.state.arena.currentRadius <= this.state.arena.targetRadius) {
        this.state.arena.currentRadius = this.state.arena.targetRadius;
        this.state.arena.phase = ArenaPhase.HOLD;
        this.state.arena.shrinkRate = 0;
        this.holdStartTick = this.state.tick;

        this.emitEvent(GameEventType.ARENA_SHRINK_COMPLETE, {
          radius: this.state.arena.currentRadius,
        });
      }
    }

    // Final phase - very small arena
    if (this.state.arena.currentRadius < 50) {
      this.state.arena.phase = ArenaPhase.FINAL;
      this.state.arena.damagePerTick = this.config.zoneDamage * 3;
    }
  }

  private updateAgents(): void {
    for (const agent of this.state.agents.values()) {
      if (!agent.isAlive) continue;

      // Update boost durations
      agent.boosts = agent.boosts.filter((boost) => {
        boost.remainingTicks--;
        if (boost.remainingTicks <= 0) {
          this.emitEvent(GameEventType.BOOST_EXPIRED, {
            agentId: agent.id,
            boostType: boost.type,
          });
          return false;
        }
        return true;
      });

      // ============================================
      // HEALTH REGENERATION - Out of combat healing
      // Creates comeback potential and longer fights
      // ============================================
      const ticksSinceLastDamage = this.state.tick - agent.lastDamageTick;
      const regenDelay = 60; // 3 seconds before regen starts
      const regenRate = 0.3; // HP per tick when regenerating

      if (ticksSinceLastDamage > regenDelay && agent.health < agent.maxHealth) {
        agent.health = Math.min(agent.maxHealth, agent.health + regenRate);
      }

      // AI Movement - agents move towards center but avoid each other
      this.updateAgentMovement(agent);

      // Apply velocity
      agent.position.x += agent.velocity.x;
      agent.position.y += agent.velocity.y;

      // Friction (slightly less for more dynamic movement)
      agent.velocity.x *= 0.92;
      agent.velocity.y *= 0.92;
    }
  }

  private updateAgentMovement(agent: Agent): void {
    const arena = this.state.arena;
    const distanceToCenter = this.distance(agent.position, arena.center);
    const moveMod = MOVEMENT_MODIFIERS[agent.style];
    const healthRatio = agent.health / agent.maxHealth;

    // Base speed with boost
    let speed = this.config.agentSpeed;
    const earlyBird = agent.boosts.find((b) => b.type === BoostType.EARLY_BIRD);
    if (earlyBird) {
      speed *= 1 + earlyBird.value / 100;
    }

    // Mood-based speed modifiers
    if (agent.mood === AgentMood.PANIC) {
      speed *= 1.3; // Faster when panicking
    } else if (agent.mood === AgentMood.HUNTING) {
      speed *= 1.1; // Slightly faster when hunting
    }

    // ============================================
    // EVASION AI - Dodge incoming projectiles!
    // Modified by mood: PANIC dodges harder, AGGRESSIVE less
    // ============================================
    let dodgeX = 0;
    let dodgeY = 0;
    let isDodging = false;

    // Dodge sensitivity based on mood
    const dodgeSensitivity = agent.mood === AgentMood.PANIC ? 1.5 :
                            agent.mood === AgentMood.AGGRESSIVE ? 0.6 : 1.0;

    for (const proj of this.state.projectiles.values()) {
      if (proj.ownerId === agent.id) continue;

      const toAgent = {
        x: agent.position.x - proj.position.x,
        y: agent.position.y - proj.position.y,
      };
      const distToProj = Math.sqrt(toAgent.x ** 2 + toAgent.y ** 2);

      // Detection range varies by mood
      const detectRange = 150 * dodgeSensitivity;
      if (distToProj > detectRange) continue;

      const projSpeed = Math.sqrt(proj.velocity.x ** 2 + proj.velocity.y ** 2);
      if (projSpeed === 0) continue;

      const projDir = { x: proj.velocity.x / projSpeed, y: proj.velocity.y / projSpeed };
      const toAgentNorm = this.normalize(toAgent);
      const dot = projDir.x * toAgentNorm.x + projDir.y * toAgentNorm.y;

      if (dot > 0.3) {
        isDodging = true;

        const dodgeDir = (agent.agentId % BigInt(2) === BigInt(0)) ? 1 : -1;
        const perpX = -projDir.y * dodgeDir;
        const perpY = projDir.x * dodgeDir;

        const urgency = (detectRange - distToProj) / detectRange;
        const dodgeStrength = speed * 0.8 * urgency * dodgeSensitivity;

        dodgeX += perpX * dodgeStrength;
        dodgeY += perpY * dodgeStrength;
      }
    }

    if (isDodging) {
      agent.velocity.x += dodgeX;
      agent.velocity.y += dodgeY;
    }

    // ============================================
    // ZONE AWARENESS - Stay in safe zone (IMPROVED)
    // Now predictive and much stronger
    // ============================================

    // Predict where zone will be in 40 ticks (2 seconds)
    const predictedRadius = arena.currentRadius - arena.shrinkRate * 40;
    const safeRadius = Math.min(arena.currentRadius * 0.75, predictedRadius * 0.85);

    if (distanceToCenter > safeRadius) {
      // MUCH stronger urgency - this is life or death!
      const urgencyFactor = agent.mood === AgentMood.PANIC ? 1.2 : 0.9;

      // Extra urgency if already taking damage (outside zone)
      const inDanger = distanceToCenter > arena.currentRadius;
      const dangerMultiplier = inDanger ? 2.0 : 1.0;

      const dirToCenter = this.normalize({
        x: arena.center.x - agent.position.x,
        y: arena.center.y - agent.position.y,
      });

      agent.velocity.x += dirToCenter.x * speed * urgencyFactor * dangerMultiplier;
      agent.velocity.y += dirToCenter.y * speed * urgencyFactor * dangerMultiplier;
    }

    // ============================================
    // MOOD-BASED TACTICAL MOVEMENT
    // ============================================
    const nearestEnemy = this.findNearestTarget(agent);

    if (nearestEnemy && !isDodging) {
      const toEnemy = {
        x: nearestEnemy.position.x - agent.position.x,
        y: nearestEnemy.position.y - agent.position.y,
      };
      const distToEnemy = Math.sqrt(toEnemy.x ** 2 + toEnemy.y ** 2);
      const dirToEnemy = this.normalize(toEnemy);

      // Preferred engagement range based on style (as fraction of arena)
      const styleMod = STYLE_MODIFIERS[agent.style];
      const preferredDist = styleMod.preferredRange * 200; // 80-180 units

      // PANIC BEHAVIOR: Flee from everyone! (BUT NOT INTO THE ZONE!)
      if (agent.mood === AgentMood.PANIC) {
        // Calculate flee direction (away from enemy)
        let fleeX = -dirToEnemy.x;
        let fleeY = -dirToEnemy.y;

        // Check if fleeing would take us outside the zone
        const fleeTarget = {
          x: agent.position.x + fleeX * 100,
          y: agent.position.y + fleeY * 100,
        };
        const fleeDistFromCenter = this.distance(fleeTarget, arena.center);

        // If flee direction goes into danger zone, flee SIDEWAYS instead
        if (fleeDistFromCenter > arena.currentRadius * 0.85) {
          // Perpendicular escape - pick direction that goes more toward center
          const perpLeft = { x: -dirToEnemy.y, y: dirToEnemy.x };
          const perpRight = { x: dirToEnemy.y, y: -dirToEnemy.x };

          const leftTarget = {
            x: agent.position.x + perpLeft.x * 100,
            y: agent.position.y + perpLeft.y * 100,
          };
          const rightTarget = {
            x: agent.position.x + perpRight.x * 100,
            y: agent.position.y + perpRight.y * 100,
          };

          // Choose the direction that keeps us more inside the arena
          if (this.distance(leftTarget, arena.center) < this.distance(rightTarget, arena.center)) {
            fleeX = perpLeft.x;
            fleeY = perpLeft.y;
          } else {
            fleeX = perpRight.x;
            fleeY = perpRight.y;
          }
        }

        // Apply flee velocity
        agent.velocity.x += fleeX * speed * 0.6;
        agent.velocity.y += fleeY * speed * 0.6;

        // Add erratic movement (but less if near zone edge)
        const nearEdge = distanceToCenter > arena.currentRadius * 0.7;
        const erraticStrength = nearEdge ? 0.15 : 0.4;
        const erraticX = this.rng.nextRange(-1, 1) * speed * erraticStrength;
        const erraticY = this.rng.nextRange(-1, 1) * speed * erraticStrength;
        agent.velocity.x += erraticX;
        agent.velocity.y += erraticY;
      }
      // AGGRESSIVE/HUNTING: Chase enemies
      else if (agent.mood === AgentMood.AGGRESSIVE || agent.mood === AgentMood.HUNTING) {
        // Approach based on style
        const approachStrength = moveMod.approachSpeed * 0.3;

        if (distToEnemy > preferredDist) {
          // Too far - move closer
          agent.velocity.x += dirToEnemy.x * speed * approachStrength;
          agent.velocity.y += dirToEnemy.y * speed * approachStrength;
        } else if (distToEnemy < preferredDist * 0.6) {
          // Too close - back off (unless RUSHER)
          if (agent.style !== CombatStyle.RUSHER) {
            agent.velocity.x -= dirToEnemy.x * speed * 0.2;
            agent.velocity.y -= dirToEnemy.y * speed * 0.2;
          }
        }

        // Circle/strafe around target
        const strafeDir = (this.state.tick + Number(agent.agentId)) % 100 < 50 ? 1 : -1;
        const perpX = -toEnemy.y / distToEnemy * strafeDir;
        const perpY = toEnemy.x / distToEnemy * strafeDir;
        agent.velocity.x += perpX * speed * moveMod.strafeAmount;
        agent.velocity.y += perpY * speed * moveMod.strafeAmount;
      }
      // CAUTIOUS: Maintain distance, strafe more
      else if (agent.mood === AgentMood.CAUTIOUS) {
        // Keep at preferred distance
        if (distToEnemy < preferredDist) {
          agent.velocity.x -= dirToEnemy.x * speed * 0.25;
          agent.velocity.y -= dirToEnemy.y * speed * 0.25;
        }

        // More strafing when cautious
        const strafeDir = (this.state.tick + Number(agent.agentId)) % 80 < 40 ? 1 : -1;
        const perpX = -toEnemy.y / distToEnemy * strafeDir;
        const perpY = toEnemy.x / distToEnemy * strafeDir;
        agent.velocity.x += perpX * speed * 0.35;
        agent.velocity.y += perpY * speed * 0.35;
      }
    }

    // ============================================
    // CHAOTIC STYLE: Random direction changes
    // ============================================
    if (agent.style === CombatStyle.CHAOTIC && this.state.tick % 30 === Number(agent.agentId % BigInt(30))) {
      // Sudden direction change
      const angle = this.rng.nextRange(0, Math.PI * 2);
      agent.velocity.x += Math.cos(angle) * speed * 0.5;
      agent.velocity.y += Math.sin(angle) * speed * 0.5;
    }

    // ============================================
    // AGENT REPULSION - Avoid clustering
    // Strength varies by style
    // ============================================
    for (const other of this.state.agents.values()) {
      if (other.id === agent.id || !other.isAlive) continue;

      const dist = this.distance(agent.position, other.position);
      const repulsionRange = 60 * (1 + moveMod.repulsionStrength);

      if (dist < repulsionRange && dist > 0) {
        const away = this.normalize({
          x: agent.position.x - other.position.x,
          y: agent.position.y - other.position.y,
        });
        const repulsionForce = (repulsionRange - dist) / repulsionRange;
        agent.velocity.x += away.x * speed * moveMod.repulsionStrength * repulsionForce;
        agent.velocity.y += away.y * speed * moveMod.repulsionStrength * repulsionForce;
      }
    }

    // Random wandering (less if dodging or panicking)
    const wanderStrength = isDodging ? 0.02 :
                          agent.mood === AgentMood.PANIC ? 0.05 : 0.1;
    agent.velocity.x += this.rng.nextRange(-1, 1) * speed * wanderStrength;
    agent.velocity.y += this.rng.nextRange(-1, 1) * speed * wanderStrength;

    // ============================================
    // VELOCITY CLAMPING
    // Higher when dodging or panicking for dramatic escapes
    // ============================================
    const maxSpeed = isDodging ? speed * 3 :
                    agent.mood === AgentMood.PANIC ? speed * 2.5 : speed * 2;
    const currentSpeed = Math.sqrt(
      agent.velocity.x ** 2 + agent.velocity.y ** 2,
    );
    if (currentSpeed > maxSpeed) {
      agent.velocity.x = (agent.velocity.x / currentSpeed) * maxSpeed;
      agent.velocity.y = (agent.velocity.y / currentSpeed) * maxSpeed;
    }
  }

  // ============================================
  // PROJECTILE COMBAT SYSTEM
  // ============================================

  private processAgentCombat(): void {
    const aliveAgents = this.aliveAgentsCache;
    const aliveCount = aliveAgents.length;

    for (const agent of aliveAgents) {
      // 1. Update mood based on situation
      this.updateAgentMood(agent, aliveCount);

      // 2. Decrement cooldown
      if (agent.shotCooldownRemaining > 0) {
        agent.shotCooldownRemaining--;
      }

      // 3. Ultimate recharge (stochastic)
      if (!agent.ultimateReady) {
        if (this.rng.next() < this.config.combat.ultimate.rechargeChancePerTick) {
          agent.ultimateReady = true;
          this.emitEvent(GameEventType.ULTIMATE_READY, {
            agentId: agent.id,
            position: { ...agent.position },
          });
        }
      }

      // 4. Find target
      const target = this.findNearestTarget(agent);
      if (!target) continue;

      // Skip if target is outside zone (let zone kill them)
      const targetInZone = this.isInSafeZone(target.position);
      if (!targetInZone && this.state.arena.phase !== ArenaPhase.FINAL) continue;

      // 5. Calculate distance and range
      const distToTarget = this.distance(agent.position, target.position);
      const maxRange = this.config.combat.normalShot.speed * this.config.combat.normalShot.ttlTicks;
      const styleMod = STYLE_MODIFIERS[agent.style];
      const preferredRange = maxRange * styleMod.preferredRange;

      // Too far for this style
      if (distToTarget > maxRange * 0.85) continue;

      // 6. PROBABILISTIC SHOOTING (not always shoot!)
      if (agent.shotCooldownRemaining <= 0) {
        const shouldShoot = this.decideToShoot(agent, target, distToTarget, preferredRange);

        if (shouldShoot) {
          // Ultimate decision - smarter usage
          if (agent.ultimateReady && this.shouldUseUltimate(agent, target, aliveCount)) {
            this.fireProjectile(agent, target, ProjectileType.ULTIMATE);
            agent.ultimateReady = false;
            this.emitEvent(GameEventType.ULTIMATE_FIRED, {
              agentId: agent.id,
              targetId: target.id,
              position: { ...agent.position },
            });
          } else if (!agent.ultimateReady || !this.shouldUseUltimate(agent, target, aliveCount)) {
            // Normal shot
            this.fireProjectile(agent, target, ProjectileType.NORMAL);
          }
        }
      }
    }
  }

  // Update agent mood based on situation
  private updateAgentMood(agent: Agent, aliveCount: number): void {
    const healthPercent = agent.health / agent.maxHealth;
    const nearbyEnemies = this.countNearbyEnemies(agent, 150);

    // Mood transitions create emergent behavior
    if (healthPercent < 0.25) {
      agent.mood = AgentMood.PANIC;
    } else if (agent.ultimateReady && healthPercent > 0.5) {
      agent.mood = AgentMood.AGGRESSIVE;
    } else if (aliveCount <= 5) {
      agent.mood = AgentMood.HUNTING;
    } else if (nearbyEnemies >= 3) {
      agent.mood = AgentMood.CAUTIOUS;
    } else if (healthPercent > 0.7 && nearbyEnemies <= 1) {
      agent.mood = AgentMood.AGGRESSIVE;
    }
    // Otherwise keep current mood
  }

  private countNearbyEnemies(agent: Agent, range: number): number {
    let count = 0;
    for (const other of this.state.agents.values()) {
      if (other.id === agent.id || !other.isAlive) continue;
      if (this.distance(agent.position, other.position) < range) count++;
    }
    return count;
  }

  // Probabilistic shooting decision
  private decideToShoot(agent: Agent, target: Agent, dist: number, preferredRange: number): boolean {
    const styleMod = STYLE_MODIFIERS[agent.style];
    let baseChance = 0.6; // Base 60% chance to shoot when possible

    // Style modifier
    baseChance *= styleMod.shootChance;

    // Mood modifier
    switch (agent.mood) {
      case AgentMood.AGGRESSIVE:
        baseChance *= 1.4;
        break;
      case AgentMood.CAUTIOUS:
        baseChance *= 0.6;
        break;
      case AgentMood.PANIC:
        baseChance *= 1.2; // Panic = spray and pray
        break;
      case AgentMood.HUNTING:
        baseChance *= 1.1;
        break;
    }

    // Distance modifier - better chance at preferred range
    const rangeDiff = Math.abs(dist - preferredRange) / preferredRange;
    baseChance *= Math.max(0.4, 1 - rangeDiff * 0.5);

    // Chaotic style adds randomness
    if (agent.style === CombatStyle.CHAOTIC) {
      baseChance += this.rng.nextRange(-0.3, 0.3);
    }

    // Coward rarely shoots unless cornered
    if (agent.style === CombatStyle.COWARD && agent.mood !== AgentMood.PANIC) {
      baseChance *= 0.4;
    }

    return this.rng.next() < Math.min(0.95, Math.max(0.1, baseChance));
  }

  // Smarter ultimate usage
  private shouldUseUltimate(agent: Agent, target: Agent, aliveCount: number): boolean {
    // Don't waste on first frame
    if (this.state.tick < 100) return false;

    const targetHealth = target.health / target.maxHealth;
    const nearbyEnemies = this.countNearbyEnemies(agent, 200);

    // Good reasons to use ultimate:
    // 1. Target is low health (finish them!)
    if (targetHealth < 0.4) return true;

    // 2. Multiple enemies nearby (splash value)
    if (nearbyEnemies >= 2) return true;

    // 3. Agent is panicking (desperate)
    if (agent.mood === AgentMood.PANIC) return true;

    // 4. Final showdown (few left)
    if (aliveCount <= 4) return true;

    // 5. Zone is closing in final phase
    if (this.state.arena.phase === ArenaPhase.FINAL) return true;

    // Otherwise save it
    return false;
  }

  private findNearestTarget(agent: Agent): Agent | null {
    let nearest: Agent | null = null;
    let minDist = Infinity;

    for (const other of this.state.agents.values()) {
      if (other.id === agent.id || !other.isAlive) continue;

      const dist = this.distance(agent.position, other.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = other;
      }
    }

    return nearest;
  }

  private isInSafeZone(position: Vector2): boolean {
    return this.distance(position, this.state.arena.center) <= this.state.arena.currentRadius;
  }

  private fireProjectile(owner: Agent, target: Agent, type: ProjectileType): void {
    const config = type === ProjectileType.ULTIMATE
      ? this.config.combat.ultimate
      : this.config.combat.normalShot;

    // Calculate direction toward target with PREDICTION
    // Agents try to lead their shots but aren't perfect
    const dx = target.position.x - owner.position.x;
    const dy = target.position.y - owner.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist === 0) return;

    // Imperfect prediction - agents guess where target will be
    const timeToHit = dist / config.speed;
    const predictionError = this.rng.nextRange(0.3, 0.8); // 30-80% accurate prediction
    const predictedX = target.position.x + target.velocity.x * timeToHit * predictionError;
    const predictedY = target.position.y + target.velocity.y * timeToHit * predictionError;

    const pdx = predictedX - owner.position.x;
    const pdy = predictedY - owner.position.y;
    const pdist = Math.sqrt(pdx * pdx + pdy * pdy);

    let dirX = pdx / pdist;
    let dirY = pdy / pdist;

    // Add spread - MORE spread for excitement and misses
    const spread = type === ProjectileType.NORMAL
      ? 0.35  // ~20 degree spread - lots of near misses!
      : 0.15; // Ultimates more accurate but still can miss

    dirX += this.rng.nextRange(-spread, spread);
    dirY += this.rng.nextRange(-spread, spread);
    const len = Math.sqrt(dirX * dirX + dirY * dirY);
    dirX /= len;
    dirY /= len;

    const projectile: Projectile = {
      id: `proj_${this.state.tick}_${owner.id}_${type}`,
      ownerId: owner.id,
      position: { ...owner.position },
      velocity: {
        x: dirX * config.speed,
        y: dirY * config.speed,
      },
      damage: config.damage,
      radius: config.radius,
      type,
      remainingTicks: config.ttlTicks,
      spawnTick: this.state.tick,
    };

    this.state.projectiles.set(projectile.id, projectile);

    // Set cooldown (randomized for normal shots for variety)
    const cooldownConfig = this.config.combat.normalShot.cooldownTicks;
    owner.shotCooldownRemaining = type === ProjectileType.NORMAL
      ? this.rng.nextInt(
          Math.floor(cooldownConfig * 0.8),
          Math.floor(cooldownConfig * 1.2)
        )
      : cooldownConfig * 2; // Longer cooldown after ultimate

    this.emitEvent(GameEventType.PROJECTILE_SPAWNED, {
      id: projectile.id,
      ownerId: owner.id,
      position: { ...projectile.position },
      velocity: { ...projectile.velocity },
      type,
      damage: projectile.damage,
      radius: projectile.radius,
    });
  }

  private updateProjectiles(): void {
    const toRemove: string[] = [];

    for (const proj of this.state.projectiles.values()) {
      // Move
      proj.position.x += proj.velocity.x;
      proj.position.y += proj.velocity.y;

      // TTL
      proj.remainingTicks--;
      if (proj.remainingTicks <= 0) {
        toRemove.push(proj.id);
        this.emitEvent(GameEventType.PROJECTILE_EXPIRED, {
          id: proj.id,
          position: { ...proj.position },
        });
        continue;
      }

      // Out of bounds check (destroy if far outside arena)
      const distFromCenter = this.distance(proj.position, this.state.arena.center);
      if (distFromCenter > this.config.arenaRadius * 1.5) {
        toRemove.push(proj.id);
      }
    }

    for (const id of toRemove) {
      this.state.projectiles.delete(id);
    }
  }

  private processProjectileHits(): void {
    this.hitProjectileIds.clear();

    for (const proj of this.state.projectiles.values()) {
      if (this.hitProjectileIds.has(proj.id)) continue;

      for (const agent of this.state.agents.values()) {
        // Cannot hit owner
        if (agent.id === proj.ownerId) continue;
        if (!agent.isAlive) continue;

        // Circle-circle collision
        const dist = this.distance(proj.position, agent.position);
        const collisionDist = proj.radius + agent.size;

        if (dist <= collisionDist) {
          // HIT!
          this.hitProjectileIds.add(proj.id);

          this.emitEvent(GameEventType.PROJECTILE_HIT, {
            projectileId: proj.id,
            projectileType: proj.type,
            targetId: agent.id,
            shooterId: proj.ownerId,
            position: { ...proj.position },
            damage: proj.damage,
          });

          // Apply damage
          const wasAlive = agent.isAlive;
          this.damageAgent(agent, proj.damage, 'combat', proj.ownerId);

          // Track kill
          if (wasAlive && !agent.isAlive) {
            const shooter = this.state.agents.get(proj.ownerId);
            if (shooter) {
              shooter.kills++;
            }
          }

          break; // Projectile only hits one target
        }
      }
    }

    // Remove hit projectiles
    for (const id of this.hitProjectileIds) {
      this.state.projectiles.delete(id);
    }
  }

  private applyZoneDamage(): void {
    const arena = this.state.arena;

    for (const agent of this.state.agents.values()) {
      if (!agent.isAlive) continue;

      const distanceToCenter = this.distance(agent.position, arena.center);
      if (distanceToCenter > arena.currentRadius) {
        let damage = arena.damagePerTick;

        // Zone resist boost
        const zoneResist = agent.boosts.find(
          (b) => b.type === BoostType.ZONE_RESIST,
        );
        if (zoneResist) {
          damage *= 1 - zoneResist.value / 100;
        }

        // More damage the further outside
        const overflow = distanceToCenter - arena.currentRadius;
        damage *= 1 + overflow / 100;

        this.damageAgent(agent, damage, 'zone');
      }
    }
  }

  private damageAgent(
    agent: Agent,
    damage: number,
    source: 'zone' | 'combat',
    attackerId?: string,
  ): void {
    // Shield boost reduces damage
    const shield = agent.boosts.find((b) => b.type === BoostType.SHIELD);
    if (shield) {
      damage *= 1 - shield.value / 100;
    }

    // Lucky charm gives survival chance
    const luckyCharm = agent.boosts.find((b) => b.type === BoostType.LUCKY_CHARM);
    if (luckyCharm && this.rng.next() < luckyCharm.value / 100) {
      return; // Dodged!
    }

    agent.health -= damage;
    agent.lastDamageSource = source;
    agent.lastDamageTick = this.state.tick;

    this.emitEvent(GameEventType.AGENT_DAMAGED, {
      agentId: agent.id,
      damage,
      source,
      healthRemaining: agent.health,
    });

    if (agent.health <= 0) {
      // Check for second wind
      const secondWind = agent.boosts.findIndex(
        (b) => b.type === BoostType.SECOND_WIND,
      );
      if (secondWind !== -1) {
        agent.health = 50;
        agent.boosts.splice(secondWind, 1);
        this.emitEvent(GameEventType.AGENT_HEALED, {
          agentId: agent.id,
          amount: 50,
          source: 'second_wind',
        });
        return;
      }

      this.eliminateAgent(agent, attackerId);
    }
  }

  private eliminateAgent(agent: Agent, eliminatedBy?: string): void {
    agent.isAlive = false;
    agent.health = 0;
    agent.eliminatedAt = this.state.tick;
    agent.eliminatedBy = eliminatedBy;

    this.emitEvent(GameEventType.AGENT_ELIMINATED, {
      agentId: agent.id,
      eliminatedBy,
      position: agent.position,
      tick: this.state.tick,
    });
  }

  private checkWinCondition(): void {
    // Re-check alive count (agents may have died this tick from zone/combat)
    const alive: Agent[] = [];
    for (const agent of this.state.agents.values()) {
      if (agent.isAlive) alive.push(agent);
    }

    if (alive.length === 1) {
      this.state.winnerId = alive[0].id;
      this.state.status = MatchStatus.FINISHED;

      this.emitEvent(GameEventType.MATCH_END, {
        winnerId: alive[0].id,
        winnerAgentId: alive[0].agentId.toString(),
        winnerOwner: alive[0].owner,
        totalTicks: this.state.tick,
      });
    } else if (alive.length === 0) {
      // Draw - all died on same tick
      // Find the "last survivor" among the dead to determine winner
      const deadAgents = Array.from(this.state.agents.values());
      const lastSurvivor = this.findLastSurvivor(deadAgents);

      this.state.winnerId = lastSurvivor.id;
      this.state.status = MatchStatus.FINISHED;

      this.emitEvent(GameEventType.MATCH_END, {
        winnerId: lastSurvivor.id,
        winnerAgentId: lastSurvivor.agentId.toString(),
        winnerOwner: lastSurvivor.owner,
        totalTicks: this.state.tick,
        resolvedDraw: true,
      });
    }
  }

  /**
   * Find the "last survivor" among dead agents for draw resolution.
   * Tiebreaker order:
   * 1. Who caused the last damage (eliminatedBy - the killer survives longer conceptually)
   * 2. Who had more kills
   * 3. Lower agentId (deterministic fallback)
   */
  private findLastSurvivor(deadAgents: Agent[]): Agent {
    // Sort by priority: eliminatedBy presence, kills, agentId
    const sorted = [...deadAgents].sort((a, b) => {
      // Priority 1: If A killed B, A is the "survivor"
      if (a.eliminatedBy === b.id) return 1;  // B killed A, so B wins
      if (b.eliminatedBy === a.id) return -1; // A killed B, so A wins

      // Priority 2: More kills = survived longer conceptually
      if (a.kills !== b.kills) return b.kills - a.kills;

      // Priority 3: Lower agentId wins (deterministic)
      return Number(a.agentId - b.agentId);
    });

    return sorted[0];
  }

  /**
   * Force a winner when MAX_TICKS is reached without natural conclusion.
   * Called by MatchService when simulation times out.
   * Returns the agent that should be declared winner.
   */
  forceWinnerByTimeout(): Agent {
    const agents = Array.from(this.state.agents.values());
    const winner = this.determineWinnerByStats(agents);

    this.state.winnerId = winner.id;
    this.state.status = MatchStatus.FINISHED;

    this.emitEvent(GameEventType.MATCH_END, {
      winnerId: winner.id,
      winnerAgentId: winner.agentId.toString(),
      winnerOwner: winner.owner,
      totalTicks: this.state.tick,
      forcedTimeout: true,
    });

    return winner;
  }

  /**
   * Determine winner by stats when no natural winner exists.
   * Priority:
   * 1. Most HP remaining
   * 2. Most kills
   * 3. Lower agentId (deterministic)
   */
  private determineWinnerByStats(agents: Agent[]): Agent {
    const sorted = [...agents].sort((a, b) => {
      // Priority 1: Most HP wins
      if (a.health !== b.health) return b.health - a.health;

      // Priority 2: Most kills wins
      if (a.kills !== b.kills) return b.kills - a.kills;

      // Priority 3: Lower agentId wins (deterministic)
      return Number(a.agentId - b.agentId);
    });

    return sorted[0];
  }

  private emitEvent(type: GameEventType, data: any): void {
    this.state.events.push({
      tick: this.state.tick,
      type,
      data,
    });
  }

  private createTickUpdate(): TickUpdate {
    this.agentUpdateBuffer.length = 0;
    for (const a of this.state.agents.values()) {
      this.agentUpdateBuffer.push({
        id: a.id,
        x: Math.round(a.position.x * 10) / 10,
        y: Math.round(a.position.y * 10) / 10,
        health: Math.round(a.health),
        isAlive: a.isAlive,
        ultReady: a.ultimateReady || undefined,
      });
    }

    this.projectileUpdateBuffer.length = 0;
    for (const p of this.state.projectiles.values()) {
      this.projectileUpdateBuffer.push({
        id: p.id,
        x: Math.round(p.position.x * 10) / 10,
        y: Math.round(p.position.y * 10) / 10,
        type: p.type,
      });
    }

    return {
      tick: this.state.tick,
      agents: this.agentUpdateBuffer,
      projectiles: this.projectileUpdateBuffer,
      arena: {
        radius: Math.round(this.state.arena.currentRadius),
        phase: this.state.arena.phase,
      },
      events: this.state.events,
    };
  }

  // Utility functions
  private distance(a: Vector2, b: Vector2): number {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
  }

  private normalize(v: Vector2): Vector2 {
    const len = Math.sqrt(v.x ** 2 + v.y ** 2);
    if (len === 0) return { x: 0, y: 0 };
    return { x: v.x / len, y: v.y / len };
  }

  // Getters
  getState(): MatchState {
    return this.state;
  }

  getStatus(): MatchStatus {
    return this.state.status;
  }

  getWinner(): Agent | undefined {
    if (this.state.winnerId) {
      return this.state.agents.get(this.state.winnerId);
    }
    return undefined;
  }

  getFullState(): any {
    return {
      matchId: this.state.matchId,
      arenaId: this.state.arenaId.toString(),
      tick: this.state.tick,
      status: this.state.status,
      agents: Array.from(this.state.agents.values()).map((a) => ({
        id: a.id,
        agentId: a.agentId.toString(),
        owner: a.owner,
        position: a.position,
        health: a.health,
        maxHealth: a.maxHealth,
        isAlive: a.isAlive,
        color: a.color,
        shape: a.shape,
        size: a.size,
        boosts: a.boosts.map((b) => ({
          type: b.type,
          value: b.value,
          remainingTicks: b.remainingTicks,
        })),
      })),
      arena: this.state.arena,
      seed: this.state.seed.toString(),
    };
  }
}

// Default match configuration
export function createDefaultConfig(
  arenaId: bigint,
  seed: bigint,
): MatchConfig {
  const TICK_RATE = 20; // 20 ticks per second

  return {
    configVersion: GAME_CONFIG_VERSION,
    arenaId,
    seed,
    tickRate: TICK_RATE,
    arenaRadius: 500,
    agentSpeed: 2.5,        // Slightly faster for dodging
    zoneDamage: 1.5,        // Reduced zone damage
    combat: {
      normalShot: {
        damage: 8,            // ~13 hits to kill - longer fights!
        speed: 8,             // SLOWER - more dodgeable, more tense
        radius: 6,            // Smaller hitbox - easier to miss
        cooldownTicks: 25,    // 1.25 seconds - less spam
        ttlTicks: 50,         // 2.5 seconds travel
      },
      ultimate: {
        damage: 35,           // 3 hits to kill - still scary but not instant
        speed: 6,             // Even slower - dramatic tension
        radius: 14,           // Smaller than before
        ttlTicks: 70,         // 3.5 seconds
        // Rarer ultimates = more special when they happen
        rechargeChancePerTick: 0.0004, // ~60-90 seconds average
      },
    },
    shrinkSchedule: [
      // Faster pressure — 2-player battles end in ~30-40s, zone must close before that
      // Formula: nextStart = start + duration + holdDuration
      { startTick: TICK_RATE * 15, duration: TICK_RATE * 20, targetRadius: 400, holdDuration: TICK_RATE * 10 }, // 15s → 500→400 in 20s, hold 10s → ends 45s
      { startTick: TICK_RATE * 45, duration: TICK_RATE * 15, targetRadius: 280, holdDuration: TICK_RATE * 10 }, // 45s → 400→280 in 15s, hold 10s → ends 70s
      { startTick: TICK_RATE * 70, duration: TICK_RATE * 15, targetRadius: 180, holdDuration: TICK_RATE * 10 }, // 70s → 280→180 in 15s, hold 10s → ends 95s
      { startTick: TICK_RATE * 95, duration: TICK_RATE * 12, targetRadius: 100, holdDuration: TICK_RATE * 8 },  // 95s → 180→100 in 12s, hold 8s → ends 115s
      { startTick: TICK_RATE * 115, duration: TICK_RATE * 12, targetRadius: 40, holdDuration: TICK_RATE * 120 }, // 115s → 100→40 in 12s, final
    ],
  };
}
