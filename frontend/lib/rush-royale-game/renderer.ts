// ============================================
// PIXI.JS v8 BATTLE RENDERER - With Ship Sprites
// Clean, high-contrast, watchable
// ============================================

import { Application, Container, Graphics, Text, TextStyle, Sprite, Assets, Texture } from 'pixi.js';
import { AgentState, ArenaPhase, TickUpdate, MatchState, GameEvent, ProjectileType, ProjectileUpdate } from './renderer-types';
import { getLLMBrand, LLM_BRANDS } from './llm-branding';

interface RendererConfig {
  width: number;
  height: number;
  backgroundColor: number;
  arenaRadius: number;
}

interface AgentSprite {
  container: Container;
  shipSprite: Sprite | null;
  body: Graphics; // Fallback if sprite fails
  healthBar: Graphics;
  healthBg: Graphics;
  label: Text;
  glow: Graphics;
  ultimateIndicator: Graphics;
  targetX: number;
  targetY: number;
  targetRotation: number;
  isAlive: boolean;
  ultimateReady: boolean;
  color: number;
  size: number;
}

interface ProjectileSprite {
  container: Container;
  core: Graphics;
  glow: Graphics;
  trail: { x: number; y: number }[];
  type: ProjectileType;
  targetX: number;
  targetY: number;
  ownerId: string;
  spawnTime: number;
}

interface Particle {
  sprite: Graphics;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
}

// Ship sprites — same 20 images used in fleet/inventory (ship-1.png to ship-20.png)
const SHIP_COUNT = 20;
const SHIP_SPRITES = Array.from({ length: SHIP_COUNT }, (_, i) => `/images/ships/ship-${i + 1}.png`);

export class BattleRenderer {
  private app: Application;
  private config: RendererConfig;

  // Layers (bottom to top)
  private backgroundLayer!: Container;
  private gridLayer!: Container;
  private arenaLayer!: Container;
  private projectileLayer!: Container;
  private agentLayer!: Container;
  private effectsLayer!: Container;
  private uiLayer!: Container;

  // Game objects
  private agents: Map<string, AgentSprite> = new Map();
  private projectiles: Map<string, ProjectileSprite> = new Map();
  private arenaCircle!: Graphics;
  private dangerZone!: Graphics;
  private particles: Particle[] = [];

  // Screen shake
  private screenShake = { intensity: 0, duration: 0, time: 0 };

  // Textures
  private shipTextures: Texture[] = [];
  private llmShipTextures: Map<string, Texture> = new Map();
  private texturesLoaded = false;

  // Camera
  private camera = { x: 0, y: 0, zoom: 1, targetZoom: 1 };
  private userControlledZoom = false;
  private userZoomTimeout: ReturnType<typeof setTimeout> | null = null;
  private panOffset = { x: 0, y: 0 };

  // State
  private currentArenaRadius: number = 500;
  private targetArenaRadius: number = 500;
  private arenaPhase: ArenaPhase = ArenaPhase.WARMUP;
  private aliveCount: number = 0;
  private totalAgents: number = 0; // Track initial participant count for zoom calculations
  private tick: number = 0;

  // ============================================
  // KILLCAM REPLAY SYSTEM
  // ============================================
  private tickBuffer: TickUpdate[] = [];
  private readonly BUFFER_SIZE = 80; // ~4 seconds of history
  private isPlayingReplay = false;
  private replayIndex = 0;
  private replaySpeed = 0.15; // Slow-mo factor
  private killcamSafetyTimeout: ReturnType<typeof setTimeout> | null = null;
  private replayAccumulator = 0;
  private finalKillData: {
    killerId: string;
    victimId: string;
    position: { x: number; y: number };
    projectileType: string;
  } | null = null;
  private killcamOverlay: Container | null = null;
  private killcamText: Text | null = null;
  private killcamVignette: Graphics | null = null;

  // Callbacks
  public onAgentClick?: (agentId: string) => void;
  public onReplayEnd?: () => void;

  constructor(canvas: HTMLCanvasElement, config: Partial<RendererConfig> = {}) {
    this.config = {
      width: config.width || 1200,
      height: config.height || 800,
      backgroundColor: config.backgroundColor || 0x0a0a0f,
      arenaRadius: config.arenaRadius || 500,
    };

    this.app = new Application();
    this.currentArenaRadius = this.config.arenaRadius;
    this.targetArenaRadius = this.config.arenaRadius;
  }

  async init(canvas: HTMLCanvasElement): Promise<void> {
    await this.app.init({
      canvas,
      width: this.config.width,
      height: this.config.height,
      backgroundColor: this.config.backgroundColor,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    // Load ship textures
    await this.loadTextures();

    this.createLayers();
    this.createBackground();
    this.createArena();

    // Start render loop
    this.app.ticker.add(() => this.update());
  }

  private async loadTextures(): Promise<void> {
    try {
      console.log(`[Renderer] Loading ${SHIP_SPRITES.length} ship textures...`);
      const loadPromises = SHIP_SPRITES.map(async (path) => {
        try {
          const texture = await Assets.load(path);
          return texture;
        } catch (e) {
          console.warn(`[Renderer] Failed to load sprite: ${path}`, e);
          return null;
        }
      });

      const results = await Promise.all(loadPromises);
      this.shipTextures = results.filter((t): t is Texture => t !== null);
      this.texturesLoaded = this.shipTextures.length > 0;
      console.log(`[Renderer] Loaded ${this.shipTextures.length}/${SHIP_SPRITES.length} ship textures successfully`);
      if (!this.texturesLoaded) {
        console.warn('[Renderer] No textures loaded - agents will use fallback graphics shapes');
      }

      // Load LLM-specific ship textures
      const llmPromises = Object.entries(LLM_BRANDS).map(async ([name, brand]) => {
        const path = brand.shipImage;
        try {
          const texture = await Assets.load(path);
          this.llmShipTextures.set(name, texture);
        } catch (e) {
          console.warn(`[Renderer] Failed to load LLM ship for ${name}: ${path}`, e);
        }
      });
      await Promise.all(llmPromises);
      console.log(`[Renderer] Loaded ${this.llmShipTextures.size} LLM ship textures`);
    } catch (e) {
      console.error('[Renderer] Failed to load ship textures, using fallback shapes:', e);
      this.texturesLoaded = false;
    }
  }

  private createLayers(): void {
    this.backgroundLayer = new Container();
    this.gridLayer = new Container();
    this.arenaLayer = new Container();
    this.projectileLayer = new Container();
    this.agentLayer = new Container();
    this.effectsLayer = new Container();
    this.uiLayer = new Container();

    this.app.stage.addChild(this.backgroundLayer);
    this.app.stage.addChild(this.gridLayer);
    this.app.stage.addChild(this.arenaLayer);
    this.app.stage.addChild(this.projectileLayer);
    this.app.stage.addChild(this.agentLayer);
    this.app.stage.addChild(this.effectsLayer);
    this.app.stage.addChild(this.uiLayer);

    // Center the game layers
    const centerX = this.config.width / 2;
    const centerY = this.config.height / 2;

    [this.gridLayer, this.arenaLayer, this.projectileLayer, this.agentLayer, this.effectsLayer].forEach(
      (layer) => {
        layer.x = centerX;
        layer.y = centerY;
      },
    );
  }

  private createBackground(): void {
    // Background
    const bg = new Graphics();
    bg.rect(0, 0, this.config.width, this.config.height);
    bg.fill(0x0a0a0f);
    this.backgroundLayer.addChild(bg);

    // Grid
    const grid = new Graphics();
    grid.setStrokeStyle({ width: 1, color: 0x1a1a2f, alpha: 0.3 });

    const gridSize = 50;
    const gridRange = 600;

    for (let x = -gridRange; x <= gridRange; x += gridSize) {
      grid.moveTo(x, -gridRange);
      grid.lineTo(x, gridRange);
    }
    for (let y = -gridRange; y <= gridRange; y += gridSize) {
      grid.moveTo(-gridRange, y);
      grid.lineTo(gridRange, y);
    }
    grid.stroke();

    this.gridLayer.addChild(grid);
  }

  private createArena(): void {
    // Danger zone (outside arena)
    this.dangerZone = new Graphics();
    this.arenaLayer.addChild(this.dangerZone);

    // Arena boundary
    this.arenaCircle = new Graphics();
    this.arenaLayer.addChild(this.arenaCircle);

    this.drawArena();
  }

  private drawArena(): void {
    const radius = this.currentArenaRadius;

    // Danger zone - red overlay outside arena
    this.dangerZone.clear();
    this.dangerZone.rect(-800, -800, 1600, 1600);
    this.dangerZone.fill({ color: 0xff0000, alpha: 0.1 });
    this.dangerZone.circle(0, 0, radius);
    this.dangerZone.cut();

    // Arena circle
    this.arenaCircle.clear();

    // Outer glow
    const glowColor = this.arenaPhase === ArenaPhase.SHRINKING ? 0xff4444 : 0x4488ff;
    for (let i = 3; i >= 0; i--) {
      this.arenaCircle.setStrokeStyle({ width: 2 + i * 2, color: glowColor, alpha: 0.1 - i * 0.02 });
      this.arenaCircle.circle(0, 0, radius + i * 3);
      this.arenaCircle.stroke();
    }

    // Main circle
    this.arenaCircle.setStrokeStyle({ width: 3, color: glowColor, alpha: 0.8 });
    this.arenaCircle.circle(0, 0, radius);
    this.arenaCircle.stroke();

    // Inner safe zone indicator
    this.arenaCircle.setStrokeStyle({ width: 1, color: 0x44ff44, alpha: 0.2 });
    this.arenaCircle.circle(0, 0, radius * 0.3);
    this.arenaCircle.stroke();
  }

  initializeMatch(state: MatchState): void {
    console.log(`[Renderer] Initializing match with ${state.agents.length} agents`);

    // Clear existing agents
    this.agents.forEach((agent) => {
      this.agentLayer.removeChild(agent.container);
    });
    this.agents.clear();

    // Clear existing projectiles
    this.projectiles.forEach((proj) => {
      this.projectileLayer.removeChild(proj.container);
    });
    this.projectiles.clear();

    // Create agent sprites
    for (let i = 0; i < state.agents.length; i++) {
      this.createAgentSprite(state.agents[i], i);
      console.log(`[Renderer] Created sprite for agent: ${state.agents[i].id}`);

      // FIX: If agent is already dead at init time (reconnection), hide immediately
      if (!state.agents[i].isAlive) {
        const sprite = this.agents.get(state.agents[i].id);
        if (sprite) {
          sprite.container.visible = false;
          sprite.container.alpha = 0;
        }
      }
    }

    // Set arena
    this.currentArenaRadius = state.arena.currentRadius;
    this.targetArenaRadius = state.arena.currentRadius;
    this.arenaPhase = state.arena.phase;
    this.totalAgents = state.agents.length; // Store total for zoom calculations
    this.aliveCount = state.agents.filter((a) => a.isAlive).length;

    console.log(`[Renderer] Match initialized: ${this.aliveCount} alive of ${this.totalAgents} total`);

    this.drawArena();
  }

  private createAgentSprite(state: AgentState, index: number): void {
    const container = new Container();
    container.x = state.position.x;
    container.y = state.position.y;
    container.eventMode = 'static';
    container.cursor = 'pointer';

    // Use LLM brand color if agent has a recognized name
    const llmBrand = getLLMBrand(state.name);
    const color = llmBrand ? llmBrand.colorNum : this.hexToNumber(state.color);
    const shipSize = llmBrand ? 48 : 36; // LLM ships larger for visibility

    // Subtle engine glow
    const glow = new Graphics();
    glow.circle(0, 0, shipSize * 0.25);
    glow.fill({ color, alpha: 0.2 });
    container.addChild(glow);

    // Ship sprite or fallback — prefer LLM-specific ship, then generic, then fallback shape
    let shipSprite: Sprite | null = null;
    const body = new Graphics();
    const llmTexture = state.name ? this.llmShipTextures.get(state.name) : undefined;

    if (llmTexture) {
      shipSprite = new Sprite(llmTexture);
      shipSprite.anchor.set(0.5);
      shipSprite.width = shipSize;
      shipSprite.height = shipSize;
      container.addChild(shipSprite);
    } else if (this.texturesLoaded && this.shipTextures.length > 0) {
      // Use agentId to pick texture — same formula as fleet/inventory: (agentId % 20)
      const agentIdNum = parseInt(state.agentId, 10) || 0;
      const textureIndex = agentIdNum % this.shipTextures.length;
      shipSprite = new Sprite(this.shipTextures[textureIndex]);
      shipSprite.anchor.set(0.5);
      shipSprite.width = shipSize;
      shipSprite.height = shipSize;
      container.addChild(shipSprite);
    } else {
      // Use consistent size: shipSize instead of state.size
      this.drawAgentBody(body, color, shipSize);
      container.addChild(body);
      console.log(`[Renderer] Created agent ${state.id} with fallback body (texturesLoaded=${this.texturesLoaded})`);
    }

    // CLEAN: Health ring instead of bar (only visible when damaged)
    const healthBar = new Graphics();
    container.addChild(healthBar);

    // Empty healthBg for interface compatibility
    const healthBg = new Graphics();

    // Ultimate indicator (subtle, only visible when ready)
    const ultimateIndicator = new Graphics();
    container.addChild(ultimateIndicator);

    // Agent ID label - shown above the ship (use LLM brand color if available)
    const labelColor = llmBrand ? llmBrand.colorNum : 0xffffff;
    const labelStyle = new TextStyle({
      fontSize: llmBrand ? 12 : 11,
      fill: labelColor,
      fontFamily: 'monospace',
      fontWeight: 'bold',
      dropShadow: {
        color: 0x000000,
        blur: 2,
        distance: 1,
      },
    });
    const displayName = state.name || `#${state.id}`;
    const label = new Text({ text: displayName, style: labelStyle });
    label.anchor.set(0.5);
    label.y = -shipSize / 2 - 12; // Position above the ship
    container.addChild(label);

    // Click handler
    container.on('pointerdown', () => {
      if (this.onAgentClick) {
        this.onAgentClick(state.id);
      }
    });

    this.agentLayer.addChild(container);

    this.agents.set(state.id, {
      container,
      shipSprite,
      body,
      healthBar,
      healthBg,
      label,
      glow,
      ultimateIndicator,
      targetX: state.position.x,
      targetY: state.position.y,
      targetRotation: 0,
      isAlive: state.isAlive,
      ultimateReady: false,
      color,
      size: shipSize,
    });
  }

  // CLEAN HEALTH: Subtle ring only when damaged
  private drawHealthRing(graphics: Graphics, health: number, maxHealth: number, size: number, color: number): void {
    graphics.clear();
    const pct = Math.max(0, health / maxHealth);
    if (pct >= 0.99) return; // Full health = no ring

    const r = size * 0.55;
    const start = -Math.PI / 2;
    const end = start + Math.PI * 2 * pct;

    // Color by health
    let c = 0x44ff44;
    if (pct < 0.3) c = 0xff4444;
    else if (pct < 0.6) c = 0xffaa44;

    graphics.setStrokeStyle({ width: 2.5, color: c, alpha: 0.85 });
    graphics.arc(0, 0, r, start, end);
    graphics.stroke();
  }

  private drawAgentBody(graphics: Graphics, color: number, size: number): void {
    graphics.clear();
    // Simple triangle ship shape as fallback
    const points = [0, -size, size * 0.7, size * 0.7, 0, size * 0.3, -size * 0.7, size * 0.7];

    // Fill the polygon
    graphics.poly(points);
    graphics.fill(color);

    // Stroke requires re-defining the path in PIXI v8
    graphics.poly(points);
    graphics.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.8 });
    graphics.stroke();
  }

  private drawHealthBar(graphics: Graphics, health: number, maxHealth: number, shipSize: number): void {
    graphics.clear();

    const width = 38;
    const height = 4;
    const healthPercent = Math.max(0, health / maxHealth);

    // Color based on health
    let color = 0x44ff44; // Green
    if (healthPercent < 0.3) {
      color = 0xff4444; // Red
    } else if (healthPercent < 0.6) {
      color = 0xffaa44; // Orange
    }

    graphics.roundRect(-19, -shipSize / 2 - 13, width * healthPercent, height, 2);
    graphics.fill(color);
  }

  applyTick(update: TickUpdate): void {
    // Don't process new ticks during replay
    if (this.isPlayingReplay) return;

    this.tick = update.tick;

    // Skip rendering if match not initialized yet (mobile race condition)
    if (this.agents.size === 0 && update.agents.length > 0) {
      return;
    }

    // Buffer ticks for killcam replay
    this.tickBuffer.push(JSON.parse(JSON.stringify(update))); // Deep copy
    if (this.tickBuffer.length > this.BUFFER_SIZE) {
      this.tickBuffer.shift();
    }

    // Update arena
    this.targetArenaRadius = update.arena.radius;
    this.arenaPhase = update.arena.phase;

    // Update alive count directly from tick data (more reliable than sprite counting)
    const newAliveCount = update.agents.filter(a => a.isAlive).length;
    if (newAliveCount !== this.aliveCount) {
      console.log(`[Renderer] Alive count changed: ${this.aliveCount} -> ${newAliveCount} at tick ${update.tick}`);
    }
    this.aliveCount = newAliveCount;

    // Update agents
    for (const agentUpdate of update.agents) {
      const sprite = this.agents.get(agentUpdate.id);
      if (!sprite) {
        // Sprite doesn't exist - this can happen if match state wasn't received yet
        // or if there's an ID mismatch. Log warning and skip.
        console.warn(`Agent sprite not found for ID: ${agentUpdate.id}`);
        continue;
      }

      // Calculate movement direction for rotation
      const dx = agentUpdate.x - sprite.targetX;
      const dy = agentUpdate.y - sprite.targetY;

      if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
        // Rotate to face movement direction
        // atan2 gives angle from positive X axis, we need to adjust for ship facing up
        sprite.targetRotation = Math.atan2(dy, dx) + Math.PI / 2;
      }

      sprite.targetX = agentUpdate.x;
      sprite.targetY = agentUpdate.y;

      // Update health
      this.drawHealthRing(sprite.healthBar, agentUpdate.health, 100, sprite.size, sprite.color);

      // Update ultimate state
      sprite.ultimateReady = agentUpdate.ultReady || false;

      // Handle death
      if (!agentUpdate.isAlive && sprite.isAlive) {
        sprite.isAlive = false;
        this.playDeathEffect(sprite);
      }
    }

    // Update projectiles from tick data
    this.updateProjectilesFromTick(update.projectiles || []);

    // Process events
    for (const event of update.events) {
      this.handleEvent(event);
    }
  }

  private handleEvent(event: GameEvent): void {
    switch (event.type) {
      case 'agent_eliminated':
        this.spawnDeathParticles(event.data.position.x, event.data.position.y);
        // ALWAYS track as potential final kill (even zone deaths!)
        this.finalKillData = {
          killerId: event.data.eliminatedBy || 'ZONE',
          victimId: event.data.agentId,
          position: event.data.position,
          projectileType: event.data.eliminatedBy ? 'combat' : 'zone',
        };
        break;

      case 'combat_hit':
        // Add hit sparks (legacy proximity combat)
        if (event.data.position) {
          this.spawnHitParticles(event.data.position.x, event.data.position.y);
        }
        break;

      case 'arena_shrink_start':
        // Visual feedback that arena is shrinking
        break;

      // ============================================
      // PROJECTILE EVENTS
      // ============================================

      case 'projectile_spawned':
        this.createProjectileSprite(event.data);
        break;

      case 'projectile_hit':
        this.handleProjectileHit(event.data);
        break;

      case 'projectile_expired':
        this.removeProjectile(event.data.id);
        break;

      // ============================================
      // ULTIMATE EVENTS
      // ============================================

      case 'ultimate_ready':
        this.handleUltimateReady(event.data);
        break;

      case 'ultimate_fired':
        this.handleUltimateFired(event.data);
        break;

      case 'match_end':
        // Killcam is triggered from the public onMatchEnd() method (called by BattleCanvas)
        // to avoid race condition where killcam starts before onReplayEnd callback is set.
        break;
    }
  }

  // Track potential final kills
  private trackFinalKill(hitData: any): void {
    // Always update - the last one before match_end is the final kill
    this.finalKillData = {
      killerId: hitData.shooterId,
      victimId: hitData.targetId,
      position: hitData.position,
      projectileType: hitData.projectileType,
    };
  }

  private playDeathEffect(sprite: AgentSprite): void {
    if (!sprite || !sprite.container || sprite.container.destroyed) return;

    // Explosion effect
    this.spawnDeathParticles(sprite.container.x, sprite.container.y);

    // Fade out
    const fadeOut = () => {
      try {
        if (!sprite.container || sprite.container.destroyed) return;
        sprite.container.alpha -= 0.08;
        sprite.container.scale.set(sprite.container.scale.x * 0.95);
        if (sprite.container.alpha > 0) {
          requestAnimationFrame(fadeOut);
        } else {
          sprite.container.visible = false;
        }
      } catch (e) {
        // Container destroyed
      }
    };
    fadeOut();
  }

  // CLEAN: Subtle death effect - fewer, smaller particles
  private spawnDeathParticles(x: number, y: number): void {
    const particleCount = 12; // Reduced from 30
    const colors = [0xff6644, 0xffaa66];

    for (let i = 0; i < particleCount; i++) {
      const particle = new Graphics();
      const size = 1.5 + Math.random() * 2;
      particle.circle(0, 0, size);
      const color = colors[Math.floor(Math.random() * colors.length)];
      particle.fill(color);
      particle.x = x;
      particle.y = y;

      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 3;

      this.particles.push({
        sprite: particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6,
        maxLife: 0.6,
        color,
      });

      this.effectsLayer.addChild(particle);
    }
  }

  // CLEAN: Minimal hit particles
  private spawnHitParticles(x: number, y: number): void {
    const particleCount = 4; // Reduced

    for (let i = 0; i < particleCount; i++) {
      const particle = new Graphics();
      particle.circle(0, 0, 1.5);
      particle.fill(0xffffaa);
      particle.x = x;
      particle.y = y;

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 2;

      this.particles.push({
        sprite: particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.3,
        maxLife: 0.3,
        color: 0xffffaa,
      });

      this.effectsLayer.addChild(particle);
    }
  }

  // ============================================
  // PROJECTILE SYSTEM
  // ============================================

  // CLEAN: Simple projectile visuals
  private createProjectileSprite(data: any): void {
    if (!this.projectileLayer || this.projectileLayer.destroyed) return;

    // Silently skip if projectile already exists (can happen during reconnection/replay)
    if (this.projectiles.has(data.id)) return;

    const isUltimate = data.type === ProjectileType.ULTIMATE;
    const ownerSprite = this.agents.get(data.ownerId);
    const baseColor = isUltimate ? 0xffcc00 : (ownerSprite?.color || 0xaaddff);

    const container = new Container();
    container.x = data.position.x;
    container.y = data.position.y;

    // Simple glow - no multiple layers
    const glow = new Graphics();
    const glowRadius = isUltimate ? 12 : 6;
    glow.circle(0, 0, glowRadius);
    glow.fill({ color: baseColor, alpha: 0.3 });
    container.addChild(glow);

    // Core - clean circle
    const core = new Graphics();
    const coreRadius = isUltimate ? 5 : 3;
    core.circle(0, 0, coreRadius);
    core.fill(isUltimate ? 0xffffff : baseColor);
    container.addChild(core);

    this.projectileLayer.addChild(container);

    this.projectiles.set(data.id, {
      container,
      core,
      glow,
      trail: [{ x: data.position.x, y: data.position.y }],
      type: data.type,
      targetX: data.position.x,
      targetY: data.position.y,
      ownerId: data.ownerId,
      spawnTime: Date.now(),
    });

    // Only log ultimate projectiles to reduce spam
    if (isUltimate) {
      console.log(`[Renderer] Created ULTIMATE projectile: ${data.id}, total projectiles: ${this.projectiles.size}`);
    }
  }

  private updateProjectilesFromTick(projectileUpdates: ProjectileUpdate[]): void {
    // Create set of current projectile IDs
    const currentIds = new Set(projectileUpdates.map(p => p.id));

    // Remove projectiles that are no longer in the update
    let removedCount = 0;
    for (const [id, sprite] of this.projectiles) {
      if (!currentIds.has(id)) {
        this.projectileLayer.removeChild(sprite.container);
        this.projectiles.delete(id);
        removedCount++;
      }
    }

    // Only log if many projectiles removed (potential issue)
    if (removedCount > 5) {
      console.log(`[Renderer] Removed ${removedCount} expired projectiles`);
    }

    // Update existing projectiles or create missing ones
    for (const update of projectileUpdates) {
      let sprite = this.projectiles.get(update.id);

      if (!sprite) {
        // FIX: Create sprite on-the-fly for projectiles we missed (reconnection)
        // Extract owner ID from projectile ID if possible (format: "proj_X_Y_Z")
        const idParts = update.id.split('_');
        const ownerId = idParts.length > 1 ? idParts[1] : 'unknown';

        this.createProjectileSprite({
          id: update.id,
          ownerId,
          position: { x: update.x, y: update.y },
          type: update.type,
        });
        sprite = this.projectiles.get(update.id);
      }

      if (sprite) {
        // Store old position for trail
        sprite.trail.push({ x: sprite.container.x, y: sprite.container.y });
        if (sprite.trail.length > (update.type === ProjectileType.ULTIMATE ? 12 : 6)) {
          sprite.trail.shift();
        }

        // Update target position
        sprite.targetX = update.x;
        sprite.targetY = update.y;
      }
    }
  }

  // CLEAN: Reduced impact effects
  private handleProjectileHit(data: any): void {
    const isUltimate = data.projectileType === ProjectileType.ULTIMATE;

    // Track for killcam
    this.trackFinalKill(data);

    // Subtle screen shake (only for ultimates)
    if (isUltimate) {
      this.triggerScreenShake(6, 150);
    }

    // Minimal particles
    const particleCount = isUltimate ? 10 : 5;
    const colors = isUltimate ? [0xffaa00, 0xffdd00] : [0xffffcc];

    for (let i = 0; i < particleCount; i++) {
      const particle = new Graphics();
      const size = isUltimate ? 2 + Math.random() * 2 : 1.5;
      particle.circle(0, 0, size);
      particle.fill(colors[Math.floor(Math.random() * colors.length)]);
      particle.x = data.position.x;
      particle.y = data.position.y;

      const angle = Math.random() * Math.PI * 2;
      const speed = isUltimate ? 3 + Math.random() * 3 : 2;

      this.particles.push({
        sprite: particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: isUltimate ? 0.5 : 0.3,
        maxLife: isUltimate ? 0.5 : 0.3,
        color: colors[0],
      });

      this.effectsLayer.addChild(particle);
    }

    // NO damage numbers during gameplay (too cluttered)
    // this.spawnDamageNumber(data.position, data.damage, isUltimate);

    this.removeProjectile(data.projectileId);
  }

  private removeProjectile(id: string): void {
    const sprite = this.projectiles.get(id);
    if (sprite) {
      this.projectileLayer.removeChild(sprite.container);
      this.projectiles.delete(id);
    }
  }

  private spawnDamageNumber(position: { x: number; y: number }, damage: number, isCrit: boolean): void {
    const style = new TextStyle({
      fontSize: isCrit ? 28 : 18,
      fill: isCrit ? 0xffaa00 : 0xff4444,
      fontFamily: 'monospace',
      fontWeight: 'bold',
      dropShadow: {
        color: 0x000000,
        blur: 4,
        distance: 2,
      },
    });

    const text = new Text({ text: `-${Math.round(damage)}`, style });
    text.anchor.set(0.5);
    text.x = position.x;
    text.y = position.y;
    text.alpha = 1;

    this.effectsLayer.addChild(text);

    // Animate up and fade
    let lifetime = 0;
    const animate = () => {
      lifetime += 0.016;
      text.y -= 1.5;
      text.alpha = 1 - lifetime / 1;
      text.scale.set(1 + lifetime * 0.3);

      if (lifetime < 1) {
        requestAnimationFrame(animate);
      } else {
        this.effectsLayer.removeChild(text);
      }
    };
    animate();
  }

  // ============================================
  // ULTIMATE SYSTEM
  // ============================================

  private handleUltimateReady(data: any): void {
    const sprite = this.agents.get(data.agentId);
    if (!sprite) return;

    sprite.ultimateReady = true;

    // Spawn ready effect particles
    const particleCount = 20;
    for (let i = 0; i < particleCount; i++) {
      const particle = new Graphics();
      particle.circle(0, 0, 3);
      particle.fill(0xffdd00);
      particle.x = data.position.x;
      particle.y = data.position.y;

      const angle = (i / particleCount) * Math.PI * 2;
      const speed = 4;

      this.particles.push({
        sprite: particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.8,
        maxLife: 0.8,
        color: 0xffdd00,
      });

      this.effectsLayer.addChild(particle);
    }
  }

  private handleUltimateFired(data: any): void {
    const sprite = this.agents.get(data.agentId);
    if (sprite) {
      sprite.ultimateReady = false;
    }

    // Shockwave ring effect
    this.spawnShockwave(data.position.x, data.position.y);

    // Camera zoom pulse
    this.camera.targetZoom = this.camera.zoom * 1.08;
    setTimeout(() => {
      this.camera.targetZoom = this.camera.zoom / 1.08;
    }, 200);
  }

  private spawnShockwave(x: number, y: number): void {
    if (!this.effectsLayer || this.effectsLayer.destroyed) return;

    const ring = new Graphics();
    ring.x = x;
    ring.y = y;
    let radius = 15;
    let alpha = 1;

    this.effectsLayer.addChild(ring);

    const animate = () => {
      try {
        if (ring.destroyed) return;

        ring.clear();
        ring.setStrokeStyle({ width: 4, color: 0xffaa00, alpha });
        ring.circle(0, 0, radius);
        ring.stroke();

        // Inner ring
        ring.setStrokeStyle({ width: 2, color: 0xffffff, alpha: alpha * 0.5 });
        ring.circle(0, 0, radius * 0.7);
        ring.stroke();

        radius += 6;
        alpha -= 0.04;

        if (alpha > 0) {
          requestAnimationFrame(animate);
        } else if (!ring.destroyed && this.effectsLayer && !this.effectsLayer.destroyed) {
          this.effectsLayer.removeChild(ring);
        }
      } catch (e) {
        // Ring destroyed
      }
    };
    animate();
  }

  // CLEAN: Subtle ultimate indicator - just a soft glow
  private drawUltimateIndicator(sprite: AgentSprite): void {
    const indicator = sprite.ultimateIndicator;
    if (!indicator || indicator.destroyed) return;
    indicator.clear();

    if (!sprite.ultimateReady || !sprite.isAlive) return;

    // Simple subtle outer ring - no particles, no orbiting
    const pulse = Math.sin(Date.now() * 0.006) * 0.15 + 0.6;
    const radius = sprite.size * 0.75;

    indicator.setStrokeStyle({ width: 2, color: 0xffcc00, alpha: pulse });
    indicator.circle(0, 0, radius);
    indicator.stroke();
  }

  private triggerScreenShake(intensity: number, duration: number): void {
    this.screenShake.intensity = intensity;
    this.screenShake.duration = duration;
    this.screenShake.time = 0;
  }

  // ============================================
  // KILLCAM REPLAY SYSTEM
  // ============================================

  private startKillcamReplay(): void {
    if (this.isPlayingReplay || !this.finalKillData) return;

    console.log('Starting killcam replay!', this.finalKillData);

    this.isPlayingReplay = true;
    this.replayIndex = Math.max(0, this.tickBuffer.length - 60); // Start ~3s before end
    this.replayAccumulator = 0;

    // Create killcam overlay
    this.createKillcamOverlay();

    // Zoom camera to the action
    const killPos = this.finalKillData.position;
    this.camera.targetZoom = 1.8;

    // Focus layers on kill position
    this.focusOnPosition(killPos.x, killPos.y);

    // Safety timeout: force-end killcam after 6 seconds to prevent stuck state
    this.killcamSafetyTimeout = setTimeout(() => {
      if (this.isPlayingReplay) {
        console.warn('[Renderer] Killcam safety timeout — forcing end');
        this.endKillcamReplay();
      }
    }, 6000);
  }

  private createKillcamOverlay(): void {
    // Vignette effect (dark edges)
    this.killcamVignette = new Graphics();
    const w = this.config.width;
    const h = this.config.height;

    // Create radial gradient effect with concentric rectangles
    for (let i = 0; i < 20; i++) {
      const alpha = (i / 20) * 0.6;
      const inset = i * 30;
      this.killcamVignette.rect(inset, inset, w - inset * 2, h - inset * 2);
      this.killcamVignette.stroke({ width: 30, color: 0x000000, alpha });
    }
    this.uiLayer.addChild(this.killcamVignette);

    // "FINAL KILL" text
    const style = new TextStyle({
      fontSize: 64,
      fill: 0xffaa00,
      fontFamily: 'Impact, Arial Black, sans-serif',
      fontWeight: 'bold',
      letterSpacing: 8,
      dropShadow: {
        color: 0x000000,
        blur: 8,
        distance: 4,
        angle: Math.PI / 4,
      },
      stroke: {
        color: 0xff6600,
        width: 3,
      },
    });

    this.killcamText = new Text({ text: 'FINAL KILL', style });
    this.killcamText.anchor.set(0.5);
    this.killcamText.x = this.config.width / 2;
    this.killcamText.y = 80;
    this.killcamText.alpha = 0;
    this.uiLayer.addChild(this.killcamText);

    // Animate text in
    let textAlpha = 0;
    const animateText = () => {
      if (!this.isPlayingReplay || !this.killcamText || this.killcamText.destroyed) return;
      try {
        textAlpha += 0.05;
        this.killcamText.alpha = Math.min(1, textAlpha);
        this.killcamText.scale.set(1 + Math.sin(Date.now() * 0.005) * 0.05);
        if (textAlpha < 1 && this.isPlayingReplay) {
          requestAnimationFrame(animateText);
        }
      } catch (e) {
        // Animation target destroyed
      }
    };
    animateText();

    // "SLOW MOTION" subtitle
    const subStyle = new TextStyle({
      fontSize: 24,
      fill: 0xffffff,
      fontFamily: 'monospace',
      letterSpacing: 4,
    });
    const subText = new Text({ text: '◀◀ SLOW MOTION ◀◀', style: subStyle });
    subText.anchor.set(0.5);
    subText.x = this.config.width / 2;
    subText.y = 130;
    subText.alpha = 0.7;
    this.uiLayer.addChild(subText);

    // Store reference for cleanup
    (this.killcamVignette as any).subText = subText;
  }

  private focusOnPosition(x: number, y: number): void {
    // Calculate offset to center the position
    const centerX = this.config.width / 2;
    const centerY = this.config.height / 2;

    // Animate camera pan
    const targetX = centerX - x * this.camera.targetZoom;
    const targetY = centerY - y * this.camera.targetZoom;

    // Store target for smooth interpolation
    (this.camera as any).targetX = x;
    (this.camera as any).targetY = y;
  }

  private updateKillcamReplay(): void {
    if (!this.isPlayingReplay) return;

    // Advance replay at slow speed
    this.replayAccumulator += this.replaySpeed;

    if (this.replayAccumulator >= 1) {
      this.replayAccumulator = 0;
      this.replayIndex++;

      if (this.replayIndex >= this.tickBuffer.length) {
        // Replay finished
        this.endKillcamReplay();
        return;
      }

      // Apply the buffered tick (without buffering it again)
      const replayTick = this.tickBuffer[this.replayIndex];
      try {
        this.applyReplayTick(replayTick);
      } catch (e) {
        console.warn('[Renderer] Error during replay tick, ending killcam:', e);
        this.endKillcamReplay();
        return;
      }
    }

    // Pulse effect on the killer and victim
    if (this.finalKillData) {
      const killer = this.agents.get(this.finalKillData.killerId);
      const victim = this.agents.get(this.finalKillData.victimId);

      try {
        if (killer && killer.isAlive && killer.container && !killer.container.destroyed) {
          const pulse = Math.sin(Date.now() * 0.01) * 0.2 + 1.2;
          killer.container.scale.set(pulse);
        }

        if (victim && victim.isAlive && victim.glow && !victim.glow.destroyed) {
          // Red tint for the victim about to die
          victim.glow.tint = 0xff0000;
        }
      } catch (e) {
        // Sprites destroyed during replay
      }
    }

    // Slow-mo camera tracking
    if ((this.camera as any).targetX !== undefined) {
      const targetX = (this.camera as any).targetX;
      const targetY = (this.camera as any).targetY;

      // Smoothly pan towards the action
      try {
        [this.gridLayer, this.arenaLayer, this.projectileLayer, this.agentLayer, this.effectsLayer].forEach(
          (layer) => {
            if (layer && !layer.destroyed) {
              const desiredX = this.config.width / 2 - targetX * this.camera.zoom;
              const desiredY = this.config.height / 2 - targetY * this.camera.zoom;
              layer.x += (desiredX - layer.x) * 0.05;
              layer.y += (desiredY - layer.y) * 0.05;
            }
          },
        );
      } catch (e) {
        // Layers destroyed
      }
    }
  }

  private applyReplayTick(update: TickUpdate): void {
    // Similar to applyTick but for replay
    this.tick = update.tick;
    this.targetArenaRadius = update.arena.radius;
    this.arenaPhase = update.arena.phase;

    for (const agentUpdate of update.agents) {
      const sprite = this.agents.get(agentUpdate.id);
      if (!sprite || !sprite.container || sprite.container.destroyed) continue;

      try {
        const dx = agentUpdate.x - sprite.targetX;
        const dy = agentUpdate.y - sprite.targetY;

        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
          sprite.targetRotation = Math.atan2(dy, dx) + Math.PI / 2;
        }

        sprite.targetX = agentUpdate.x;
        sprite.targetY = agentUpdate.y;

        if (sprite.healthBar && !sprite.healthBar.destroyed) {
          this.drawHealthRing(sprite.healthBar, agentUpdate.health, 100, sprite.size, sprite.color);
        }

        if (!agentUpdate.isAlive && sprite.isAlive) {
          sprite.isAlive = false;
          // Extra dramatic death in slow-mo
          this.playSlowMoDeathEffect(sprite);
        }
      } catch (e) {
        // Sprite destroyed during replay
      }
    }

    this.updateProjectilesFromTick(update.projectiles || []);

    // Process events but with extra drama
    // NOTE: Skip projectile_spawned — updateProjectilesFromTick already creates missing sprites.
    // Processing both causes duplicate creation attempts and console spam.
    for (const event of update.events) {
      if (event.type === 'projectile_hit') {
        this.handleProjectileHitSlowMo(event.data);
      }
    }
  }

  private handleProjectileHitSlowMo(data: any): void {
    const isUltimate = data.projectileType === ProjectileType.ULTIMATE;

    // Extra particles for slow-mo impact
    const particleCount = isUltimate ? 60 : 30;
    const colors = isUltimate
      ? [0xffaa00, 0xffdd00, 0xff6600, 0xffffff, 0xff4400]
      : [0xffff88, 0xffffff, 0xaaaaff, 0xffaaaa];

    for (let i = 0; i < particleCount; i++) {
      const particle = new Graphics();
      const size = isUltimate ? 4 + Math.random() * 8 : 3 + Math.random() * 5;
      particle.circle(0, 0, size);
      const color = colors[Math.floor(Math.random() * colors.length)];
      particle.fill(color);
      particle.x = data.position.x;
      particle.y = data.position.y;

      const angle = Math.random() * Math.PI * 2;
      // Slower particles for slow-mo effect
      const speed = (isUltimate ? 2 + Math.random() * 4 : 1 + Math.random() * 2) * this.replaySpeed * 3;

      this.particles.push({
        sprite: particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: isUltimate ? 3 : 2,
        maxLife: isUltimate ? 3 : 2,
        color,
      });

      this.effectsLayer.addChild(particle);
    }

    // Spawn dramatic shockwave
    this.spawnSlowMoShockwave(data.position.x, data.position.y, isUltimate);

    this.removeProjectile(data.projectileId);
  }

  private spawnSlowMoShockwave(x: number, y: number, isUltimate: boolean): void {
    if (!this.effectsLayer || this.effectsLayer.destroyed) return;

    const ring = new Graphics();
    ring.x = x;
    ring.y = y;
    let radius = 10;
    let alpha = 1;
    const maxRadius = isUltimate ? 150 : 80;
    const color = isUltimate ? 0xffaa00 : 0xffffff;

    this.effectsLayer.addChild(ring);

    const animate = () => {
      try {
        if (!this.isPlayingReplay || ring.destroyed) {
          if (!ring.destroyed && this.effectsLayer && !this.effectsLayer.destroyed) {
            this.effectsLayer.removeChild(ring);
          }
          return;
        }

        ring.clear();

        // Multiple rings
        for (let i = 0; i < 3; i++) {
          const r = radius - i * 15;
          if (r > 0) {
            ring.setStrokeStyle({ width: 4 - i, color, alpha: alpha * (1 - i * 0.3) });
            ring.circle(0, 0, r);
            ring.stroke();
          }
        }

        radius += 3 * this.replaySpeed * 2;
        alpha -= 0.02 * this.replaySpeed * 2;

        if (alpha > 0 && radius < maxRadius) {
          requestAnimationFrame(animate);
        } else if (!ring.destroyed && this.effectsLayer && !this.effectsLayer.destroyed) {
          this.effectsLayer.removeChild(ring);
        }
      } catch (e) {
        // Animation target destroyed
      }
    };
    animate();
  }

  private playSlowMoDeathEffect(sprite: AgentSprite): void {
    if (!sprite || !sprite.container || sprite.container.destroyed) return;

    // Massive particle explosion
    const particleCount = 50;
    const colors = [0xff4444, 0xff8844, 0xffaa44, 0xffff44, 0xffffff];
    const startX = sprite.container.x;
    const startY = sprite.container.y;

    for (let i = 0; i < particleCount; i++) {
      const particle = new Graphics();
      const size = 3 + Math.random() * 6;
      particle.circle(0, 0, size);
      const color = colors[Math.floor(Math.random() * colors.length)];
      particle.fill(color);
      particle.x = startX;
      particle.y = startY;

      const angle = Math.random() * Math.PI * 2;
      const speed = (2 + Math.random() * 4) * this.replaySpeed * 2;

      this.particles.push({
        sprite: particle,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 3,
        maxLife: 3,
        color,
      });

      this.effectsLayer.addChild(particle);
    }

    // Slow fade out with null checks
    const fadeOut = () => {
      try {
        if (!this.isPlayingReplay || !sprite.container || sprite.container.destroyed) {
          if (sprite.container && !sprite.container.destroyed) {
            sprite.container.visible = false;
          }
          return;
        }
        sprite.container.alpha -= 0.02;
        sprite.container.scale.set(sprite.container.scale.x * 0.98);
        if (sprite.container.alpha > 0) {
          requestAnimationFrame(fadeOut);
        } else {
          sprite.container.visible = false;
        }
      } catch (e) {
        // Container was destroyed during animation
      }
    };
    fadeOut();
  }

  private endKillcamReplay(): void {
    this.isPlayingReplay = false;

    // Clear safety timeout
    if (this.killcamSafetyTimeout) {
      clearTimeout(this.killcamSafetyTimeout);
      this.killcamSafetyTimeout = null;
    }

    try {
      // Clean up overlay
      if (this.killcamVignette && !this.killcamVignette.destroyed) {
        const subText = (this.killcamVignette as any).subText;
        if (subText && !subText.destroyed && this.uiLayer && !this.uiLayer.destroyed) {
          this.uiLayer.removeChild(subText);
        }
        if (this.uiLayer && !this.uiLayer.destroyed) {
          this.uiLayer.removeChild(this.killcamVignette);
        }
      }
      this.killcamVignette = null;

      if (this.killcamText && !this.killcamText.destroyed) {
        if (this.uiLayer && !this.uiLayer.destroyed) {
          this.uiLayer.removeChild(this.killcamText);
        }
      }
      this.killcamText = null;

      // Reset camera
      this.camera.targetZoom = 1;
      (this.camera as any).targetX = undefined;
      (this.camera as any).targetY = undefined;

      const centerX = this.config.width / 2;
      const centerY = this.config.height / 2;
      [this.gridLayer, this.arenaLayer, this.projectileLayer, this.agentLayer, this.effectsLayer].forEach(
        (layer) => {
          if (layer && !layer.destroyed) {
            layer.x = centerX;
            layer.y = centerY;
          }
        },
      );

      // Reset agent scales
      for (const sprite of this.agents.values()) {
        if (sprite.container && !sprite.container.destroyed) {
          sprite.container.scale.set(1);
        }
        if (sprite.glow && !sprite.glow.destroyed) {
          sprite.glow.tint = 0xffffff;
        }
      }
    } catch (e) {
      console.warn('Error during killcam cleanup:', e);
    }

    // Clear buffer
    this.tickBuffer = [];
    this.finalKillData = null;

    // Notify callback
    if (this.onReplayEnd) {
      this.onReplayEnd();
    }

    console.log('Killcam replay ended');
  }

  // Public method to trigger killcam when match ends
  public onMatchEnd(result: any): void {
    console.log('Match ended, triggering killcam...', result, this.finalKillData);

    // Give a small delay to ensure last tick is processed
    setTimeout(() => {
      // Lower threshold: 10 ticks is enough (~0.5 seconds of history)
      if (this.finalKillData && this.tickBuffer.length > 10) {
        this.startKillcamReplay();
      } else if (this.tickBuffer.length > 10) {
        // Fallback: create kill data from winner info in result
        const winnerId = result.winnerId;
        const winnerSprite = winnerId ? this.agents.get(winnerId) : null;

        this.finalKillData = {
          killerId: winnerId || 'WINNER',
          victimId: 'last_eliminated',
          position: winnerSprite
            ? { x: winnerSprite.targetX, y: winnerSprite.targetY }
            : { x: 0, y: 0 },
          projectileType: 'victory',
        };
        this.startKillcamReplay();
      } else {
        console.log('Not enough buffer for killcam, skipping');
        // Still notify that "replay" ended so victory screen can show
        if (this.onReplayEnd) {
          this.onReplayEnd();
        }
      }
    }, 100);
  }

  // Public method to manually trigger replay (for testing)
  public triggerTestReplay(): void {
    if (this.tickBuffer.length > 20) {
      // Create fake final kill data for testing
      const agents = Array.from(this.agents.keys());
      if (agents.length >= 2) {
        const killer = this.agents.get(agents[0]);
        this.finalKillData = {
          killerId: agents[0],
          victimId: agents[1],
          position: { x: killer?.targetX || 0, y: killer?.targetY || 0 },
          projectileType: 'ultimate',
        };
        this.startKillcamReplay();
      }
    }
  }

  // Check if replay is active
  public isReplayActive(): boolean {
    return this.isPlayingReplay;
  }

  private update(): void {
    const deltaTime = 1 / 60; // Approximate frame time

    // Handle killcam replay
    if (this.isPlayingReplay) {
      this.updateKillcamReplay();
    }

    // Smooth arena radius interpolation
    this.currentArenaRadius +=
      (this.targetArenaRadius - this.currentArenaRadius) * 0.05;
    this.drawArena();

    // Smooth agent position and rotation interpolation
    for (const sprite of this.agents.values()) {
      if (!sprite.isAlive) continue;

      const dx = sprite.targetX - sprite.container.x;
      const dy = sprite.targetY - sprite.container.y;

      // Smooth position
      sprite.container.x += dx * 0.12;
      sprite.container.y += dy * 0.12;

      // Smooth rotation (for ship sprite or body)
      const rotatable = sprite.shipSprite || sprite.body;
      if (rotatable) {
        // Normalize angle difference
        let angleDiff = sprite.targetRotation - rotatable.rotation;
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        rotatable.rotation += angleDiff * 0.1;
      }

      // Engine glow pulse and position
      const speed = Math.sqrt(dx * dx + dy * dy);
      const glowIntensity = Math.min(1, speed * 0.1 + 0.3);
      const pulse = Math.sin(Date.now() * 0.01) * 0.1 + 0.9;
      sprite.glow.alpha = glowIntensity * pulse;
      sprite.glow.scale.set(pulse * (0.8 + speed * 0.05));

      // Update ultimate indicator
      this.drawUltimateIndicator(sprite);
    }

    // Update projectiles (smooth interpolation + trail rendering)
    for (const sprite of this.projectiles.values()) {
      // Smooth position interpolation
      const dx = sprite.targetX - sprite.container.x;
      const dy = sprite.targetY - sprite.container.y;
      sprite.container.x += dx * 0.3; // Faster interpolation for projectiles
      sprite.container.y += dy * 0.3;

      // Pulse effect for ultimates
      if (sprite.type === ProjectileType.ULTIMATE) {
        const pulse = Math.sin(Date.now() * 0.02) * 0.2 + 1;
        sprite.glow.scale.set(pulse);
        sprite.core.scale.set(0.9 + pulse * 0.1);
      }

      // Draw trail
      this.drawProjectileTrail(sprite);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.sprite.x += p.vx;
      p.sprite.y += p.vy;
      p.vy += 0.05; // Light gravity
      p.vx *= 0.98; // Drag
      p.vy *= 0.98;
      p.life -= 0.02;
      p.sprite.alpha = p.life / p.maxLife;
      p.sprite.scale.set(p.life / p.maxLife);

      if (p.life <= 0) {
        this.effectsLayer.removeChild(p.sprite);
        this.particles.splice(i, 1);
      }
    }

    // Update screen shake
    if (this.screenShake.duration > 0) {
      this.screenShake.time += deltaTime * 1000;
      if (this.screenShake.time < this.screenShake.duration) {
        const decay = 1 - this.screenShake.time / this.screenShake.duration;
        const shakeX = (Math.random() - 0.5) * this.screenShake.intensity * decay;
        const shakeY = (Math.random() - 0.5) * this.screenShake.intensity * decay;
        this.app.stage.x = shakeX;
        this.app.stage.y = shakeY;
      } else {
        this.screenShake.duration = 0;
        this.app.stage.x = 0;
        this.app.stage.y = 0;
      }
    }

    // AUTO-ZOOM: Gradually zoom in as fewer agents remain (only if user isn't manually controlling)
    if (!this.isPlayingReplay && !this.userControlledZoom) {
      const baseZoom = 0.85;
      const maxZoom = 1.4;
      const maxAgents = Math.max(this.totalAgents, 2); // Use actual participant count
      const aliveRatio = Math.max(0.1, this.aliveCount / maxAgents);
      const targetZoom = baseZoom + (1 - aliveRatio) * (maxZoom - baseZoom);
      this.camera.targetZoom = targetZoom;
    }

    // Camera zoom interpolation
    this.camera.zoom += (this.camera.targetZoom - this.camera.zoom) * 0.02; // Slower for smoothness

    // Apply camera
    const scale = this.camera.zoom;
    const centerX = this.config.width / 2;
    const centerY = this.config.height / 2;
    [this.gridLayer, this.arenaLayer, this.projectileLayer, this.agentLayer, this.effectsLayer].forEach(
      (layer) => {
        if (layer && !layer.destroyed) {
          layer.scale.set(scale);
          // Apply pan offset (skip during replay which controls its own positions)
          if (!this.isPlayingReplay) {
            layer.x = centerX + this.panOffset.x;
            layer.y = centerY + this.panOffset.y;
          }
        }
      },
    );
  }

  private drawProjectileTrail(sprite: ProjectileSprite): void {
    if (sprite.trail.length < 2) return;

    const isUltimate = sprite.type === ProjectileType.ULTIMATE;
    const trailColor = isUltimate ? 0xffaa00 : 0x44aaff;

    // Draw trail as fading line segments
    for (let i = 0; i < sprite.trail.length - 1; i++) {
      const alpha = (i / sprite.trail.length) * 0.5;
      const width = isUltimate ? 4 - (i / sprite.trail.length) * 2 : 2;

      // Create trail particle at each point (simple approach)
      if (i === sprite.trail.length - 2 && Math.random() > 0.5) {
        const particle = new Graphics();
        particle.circle(0, 0, isUltimate ? 3 : 1.5);
        particle.fill({ color: trailColor, alpha: 0.6 });
        particle.x = sprite.trail[i].x;
        particle.y = sprite.trail[i].y;

        this.particles.push({
          sprite: particle,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          life: 0.3,
          maxLife: 0.3,
          color: trailColor,
        });

        this.effectsLayer.addChild(particle);
      }
    }
  }

  setZoom(zoom: number): void {
    this.camera.targetZoom = Math.max(0.4, Math.min(3, zoom));

    // Mark as user-controlled permanently — once the user zooms, they keep control
    this.userControlledZoom = true;
    if (this.userZoomTimeout) {
      clearTimeout(this.userZoomTimeout);
      this.userZoomTimeout = null;
    }
  }

  getZoom(): number {
    return this.camera.zoom;
  }

  setPanOffset(x: number, y: number): void {
    this.panOffset.x = x;
    this.panOffset.y = y;

    // If user is actively panning, disable auto-zoom permanently
    if (x !== 0 || y !== 0) {
      this.userControlledZoom = true;
    }
  }

  resetPan(): void {
    this.panOffset.x = 0;
    this.panOffset.y = 0;
  }

  // Enable/disable auto-zoom
  setAutoZoom(enabled: boolean): void {
    this.userControlledZoom = !enabled;
  }

  focusOnAgent(agentId: string): void {
    const sprite = this.agents.get(agentId);
    if (sprite) {
      this.camera.x = sprite.container.x;
      this.camera.y = sprite.container.y;
    }
  }

  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    this.config.width = width;
    this.config.height = height;

    // Re-center layers
    const centerX = width / 2;
    const centerY = height / 2;

    [this.gridLayer, this.arenaLayer, this.projectileLayer, this.agentLayer, this.effectsLayer].forEach(
      (layer) => {
        layer.x = centerX;
        layer.y = centerY;
      },
    );
  }

  getAliveCount(): number {
    return this.aliveCount;
  }

  getTick(): number {
    return this.tick;
  }

  getArenaRadius(): number {
    return Math.round(this.currentArenaRadius);
  }

  getArenaPhase(): ArenaPhase {
    return this.arenaPhase;
  }

  destroy(): void {
    try {
      if (this.app && this.app.stage) {
        this.app.destroy(true, { children: true, texture: true });
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  private hexToNumber(hex: string): number {
    return parseInt(hex.replace('#', ''), 16);
  }
}
