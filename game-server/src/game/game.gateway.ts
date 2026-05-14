// ============================================
// GAME GATEWAY - WebSocket communication
// ============================================

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, Inject, forwardRef } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { MatchService } from './match.service';
import { LeaderboardService, LeaderboardEntry } from './leaderboard.service';
import { ArenaStoreService, ChainEvent, ArenaSnapshot } from '../arena/arena-store.service';
import { TickUpdate, ArenaWebSocketUpdate } from './types';
import { getAllowedOrigins } from '../config/origins.config';

// Global room for arena list updates
const GLOBAL_ROOM = 'global:arenas';
// Leaderboard room for live updates
const LEADERBOARD_ROOM = 'global:leaderboard';

@WebSocketGateway({
  cors: {
    origin: getAllowedOrigins(),
  },
  transports: ['websocket', 'polling'],
  pingInterval: 30000,
  pingTimeout: 25000,
  perMessageDeflate: {
    threshold: 128,
  },
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);
  private clientRooms: Map<string, Set<string>> = new Map();
  private matchEndResults: Map<string, { result: any; arenaId: string; timestamp: number }> = new Map();
  private eventSeq = 0;

  // WebSocket per-connection rate limiting: 30 messages per 10 seconds
  private readonly WS_RATE_LIMIT = 30;
  private readonly WS_RATE_WINDOW = 10000;
  private clientMessageTimestamps: Map<string, number[]> = new Map();

  constructor(
    private matchService: MatchService,
    @Inject(forwardRef(() => ArenaStoreService))
    private arenaStore: ArenaStoreService,
    @Inject(forwardRef(() => LeaderboardService))
    private leaderboardService: LeaderboardService,
  ) {
    // Cleanup stored match_end results older than 5 minutes
    setInterval(() => {
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const [id, s] of this.matchEndResults) {
        if (s.timestamp < cutoff) this.matchEndResults.delete(id);
      }
    }, 60000);
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
    this.clientRooms.set(client.id, new Set());
    this.clientMessageTimestamps.set(client.id, []);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);

    // Leave all rooms
    const rooms = this.clientRooms.get(client.id);
    if (rooms) {
      for (const room of rooms) {
        this.matchService.unsubscribe(room, client.id);
      }
    }
    this.clientRooms.delete(client.id);
    this.clientMessageTimestamps.delete(client.id);
  }

  /**
   * Per-connection WebSocket rate limiter.
   * Returns true if the client is rate-limited (should be rejected).
   */
  private isWsRateLimited(client: Socket): boolean {
    const now = Date.now();
    const timestamps = this.clientMessageTimestamps.get(client.id) || [];
    const recent = timestamps.filter(t => now - t < this.WS_RATE_WINDOW);
    recent.push(now);
    this.clientMessageTimestamps.set(client.id, recent);

    if (recent.length > this.WS_RATE_LIMIT) {
      this.logger.warn(`WebSocket rate limit exceeded for client ${client.id}`);
      client.emit('error', { message: 'Rate limit exceeded' });
      return true;
    }
    return false;
  }

  // ============================================
  // MATCH SPECTATING
  // ============================================

  @SubscribeMessage('spectate')
  handleSpectate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ) {
    // spectate is NOT rate-limited — dropping it silently causes the client to never receive match_state
    const { matchId } = data;
    this.logger.debug(`Client ${client.id} spectating match ${matchId}`);

    // Join the room
    client.join(matchId);
    this.clientRooms.get(client.id)?.add(matchId);
    this.matchService.subscribe(matchId, client.id);

    // Send current state if match is still active
    const state = this.matchService.getMatchState(matchId);
    if (state) {
      client.emit('match_state', state);
    }

    // Replay stored match_end if match already finished
    const stored = this.matchEndResults.get(matchId);
    if (stored) {
      client.emit('match_end', stored.result);
    }

    // Only emit error if match is truly gone (not active AND no cached result)
    if (!state && !stored) {
      client.emit('error', { message: 'Match not found' });
    }
  }

  @SubscribeMessage('spectate_arena')
  handleSpectateArena(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { arenaId: string },
  ) {
    if (this.isWsRateLimited(client)) return;
    const arenaId = BigInt(data.arenaId);
    const matchId = this.matchService.getMatchByArena(arenaId);

    if (matchId) {
      this.handleSpectate(client, { matchId });
    } else {
      client.emit('error', { message: 'No active match for this arena' });
    }
  }

  @SubscribeMessage('leave')
  handleLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { matchId: string },
  ) {
    if (this.isWsRateLimited(client)) return;
    const { matchId } = data;
    client.leave(matchId);
    this.clientRooms.get(client.id)?.delete(matchId);
    this.matchService.unsubscribe(matchId, client.id);
    this.logger.debug(`Client ${client.id} left match ${matchId}`);
  }

  @SubscribeMessage('get_matches')
  handleGetMatches(@ConnectedSocket() client: Socket) {
    if (this.isWsRateLimited(client)) return;
    const matches = this.matchService.getActiveMatches();
    client.emit('active_matches', { matches });
  }

  // ============================================
  // GLOBAL SUBSCRIPTION (Arena List)
  // ============================================

  @SubscribeMessage('subscribe_global')
  handleSubscribeGlobal(@ConnectedSocket() client: Socket) {
    if (this.isWsRateLimited(client)) return;
    client.join(GLOBAL_ROOM);
    this.clientRooms.get(client.id)?.add(GLOBAL_ROOM);
    this.logger.debug(`Client ${client.id} subscribed to global arena updates`);
    client.emit('global_subscribed', { success: true });
  }

  @SubscribeMessage('unsubscribe_global')
  handleUnsubscribeGlobal(@ConnectedSocket() client: Socket) {
    if (this.isWsRateLimited(client)) return;
    client.leave(GLOBAL_ROOM);
    this.clientRooms.get(client.id)?.delete(GLOBAL_ROOM);
    this.logger.debug(`Client ${client.id} unsubscribed from global arena updates`);
  }

  // ============================================
  // LEADERBOARD SUBSCRIPTION
  // ============================================

  @SubscribeMessage('subscribe_leaderboard')
  handleSubscribeLeaderboard(@ConnectedSocket() client: Socket) {
    if (this.isWsRateLimited(client)) return;
    client.join(LEADERBOARD_ROOM);
    this.clientRooms.get(client.id)?.add(LEADERBOARD_ROOM);
    this.logger.debug(`Client ${client.id} subscribed to leaderboard updates`);

    // Send current top 10 immediately
    const topAgents = this.leaderboardService.getTopAgents(10);
    const stats = this.leaderboardService.getStats();

    client.emit('leaderboard_subscribed', { success: true });
    client.emit('leaderboard_snapshot', {
      top10: topAgents,
      totalAgents: stats.totalAgents,
      lastUpdated: stats.lastUpdated,
    });
  }

  @SubscribeMessage('unsubscribe_leaderboard')
  handleUnsubscribeLeaderboard(@ConnectedSocket() client: Socket) {
    if (this.isWsRateLimited(client)) return;
    client.leave(LEADERBOARD_ROOM);
    this.clientRooms.get(client.id)?.delete(LEADERBOARD_ROOM);
    this.logger.debug(`Client ${client.id} unsubscribed from leaderboard updates`);
  }

  // ============================================
  // ARENA SUBSCRIPTION (Single Arena)
  // ============================================

  @SubscribeMessage('subscribe_arena')
  handleSubscribeArena(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { arenaId: string },
  ) {
    if (this.isWsRateLimited(client)) return;
    const { arenaId } = data;
    const room = `arena:${arenaId}`;

    client.join(room);
    this.clientRooms.get(client.id)?.add(room);

    this.logger.debug(`Client ${client.id} subscribed to arena ${arenaId}`);

    // Send snapshot immediately (late-join fix)
    const snapshot = this.arenaStore.getSnapshot(arenaId);
    if (snapshot) {
      client.emit('arena_snapshot', snapshot);
      this.logger.debug(`Sent snapshot for arena ${arenaId} to client ${client.id}`);
    }

    // Check if there's an active match
    const matchId = this.matchService.getMatchByArena(BigInt(arenaId));
    if (matchId) {
      this.logger.debug(`Sending active matchId ${matchId} to late-joining client ${client.id}`);

      // Send match_ready event
      const update: ArenaWebSocketUpdate = {
        type: 'match_ready',
        arenaId,
        timestamp: Date.now(),
        data: { matchId },
      };
      client.emit('arena_update', update);

      // Also send current match state
      const state = this.matchService.getMatchState(matchId);
      if (state) {
        client.emit('match_state', state);
      }

      // Replay stored match_end if match already finished
      const stored = this.matchEndResults.get(matchId);
      if (stored) {
        client.emit('match_end', stored.result);
      }
    } else {
      // No active match — check if we have a stored match_end for this arena
      const stored = this.getMatchEndByArena(arenaId);
      if (stored) {
        client.emit('match_end', stored);
      }
    }

    // Acknowledge subscription
    client.emit('arena_subscribed', { arenaId });
  }

  @SubscribeMessage('unsubscribe_arena')
  handleUnsubscribeArena(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { arenaId: string },
  ) {
    if (this.isWsRateLimited(client)) return;
    const { arenaId } = data;
    const room = `arena:${arenaId}`;

    client.leave(room);
    this.clientRooms.get(client.id)?.delete(room);

    this.logger.debug(`Client ${client.id} unsubscribed from arena ${arenaId}`);
  }

  // ============================================
  // GET SNAPSHOT (on-demand)
  // ============================================

  @SubscribeMessage('get_arena_snapshot')
  handleGetArenaSnapshot(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { arenaId: string },
  ) {
    if (this.isWsRateLimited(client)) return;
    const { arenaId } = data;
    const snapshot = this.arenaStore.getSnapshot(arenaId);

    if (snapshot) {
      client.emit('arena_snapshot', snapshot);
    } else {
      client.emit('arena_snapshot', {
        arenaId,
        state: 'unknown',
        artifacts: { arenaId },
        recentEvents: [],
        participantCount: 0,
        participants: [],
        updatedAt: Date.now(),
      } as ArenaSnapshot);
    }
  }

  // ============================================
  // MATCH END RESULT GETTERS (for HTTP fallback)
  // ============================================

  getMatchEndResult(matchId: string): any | null {
    return this.matchEndResults.get(matchId)?.result || null;
  }

  getMatchEndByArena(arenaId: string): any | null {
    for (const [, stored] of this.matchEndResults) {
      if (stored.arenaId === arenaId) return stored.result;
    }
    return null;
  }

  clearAllMatchEndResults(): void {
    this.matchEndResults.clear();
  }

  // ============================================
  // MATCH BROADCAST METHODS
  // ============================================

  broadcastTick(matchId: string, update: TickUpdate) {
    this.server.to(matchId).emit('tick', update);
  }

  broadcastMatchEnd(matchId: string, result: any) {
    const arenaId = result?.arenaId?.toString() || '';
    const seq = ++this.eventSeq;
    const enriched = { ...result, seq };

    // Store for replay on reconnect (keyed by matchId, lookup by arenaId via getter)
    this.matchEndResults.set(matchId, {
      result: enriched,
      arenaId,
      timestamp: Date.now(),
    });

    this.server.to(matchId).emit('match_end', enriched);
  }

  // ============================================
  // ARENA BROADCAST METHODS
  // ============================================

  /**
   * Broadcast to global room (affects arena list)
   */
  broadcastGlobal(event: ChainEvent): void {
    this.server.to(GLOBAL_ROOM).emit('global_update', event);
    this.logger.log(`[WS] Global broadcast: ${event.type} arena=${event.arenaId}`);
  }

  /**
   * Broadcast chain event to arena subscribers
   */
  broadcastArenaEvent(arenaId: string, event: ChainEvent): void {
    const room = `arena:${arenaId}`;
    this.server.to(room).emit('arena_event', event);
    this.logger.debug(`Broadcasted ${event.type} to arena ${arenaId}`);
  }

  /**
   * Broadcast arena update (legacy format for compatibility)
   */
  broadcastArenaUpdate(arenaId: string, update: ArenaWebSocketUpdate): void {
    const room = `arena:${arenaId}`;
    this.server.to(room).emit('arena_update', update);
    this.logger.debug(`Broadcasted ${update.type} to arena ${arenaId}`);
  }

  /**
   * Get number of clients subscribed to an arena
   */
  async getArenaSubscriberCount(arenaId: string): Promise<number> {
    const room = `arena:${arenaId}`;
    const sockets = await this.server.in(room).fetchSockets();
    return sockets.length;
  }

  /**
   * Get number of clients subscribed to global updates
   */
  async getGlobalSubscriberCount(): Promise<number> {
    const sockets = await this.server.in(GLOBAL_ROOM).fetchSockets();
    return sockets.length;
  }

  // ============================================
  // LEADERBOARD BROADCAST METHODS
  // ============================================

  /**
   * Broadcast leaderboard update to all subscribers
   * Called when arena finishes and agent stats are updated
   */
  broadcastLeaderboardUpdate(data: {
    updatedAgents: string[];
    top10: LeaderboardEntry[];
    totalAgents: number;
    lastUpdated: number;
  }): void {
    this.server.to(LEADERBOARD_ROOM).emit('leaderboard_update', data);
    this.logger.debug(`Broadcasted leaderboard update: ${data.updatedAgents.length} agents changed`);
  }

  /**
   * Get number of clients subscribed to leaderboard updates
   */
  async getLeaderboardSubscriberCount(): Promise<number> {
    const sockets = await this.server.in(LEADERBOARD_ROOM).fetchSockets();
    return sockets.length;
  }

  // ============================================
  // TOURNAMENT BROADCAST METHODS
  // ============================================

  /**
   * Broadcast tournament_match_ready to ALL connected clients.
   * Called when the orchestrator sets a new active match via POST /tournament/set-active.
   * Frontend tournament page listens for this to skip HTTP polling delay.
   */
  broadcastTournamentMatchReady(matchId: string, metadata: Record<string, any>): void {
    this.server.emit('tournament_match_ready', { matchId, metadata });
    this.logger.log(`[WS] Tournament match ready broadcast: ${matchId}`);
  }

  // ============================================
  // CHAMPIONSHIP SUBSCRIPTION + BROADCAST
  // ============================================

  @SubscribeMessage('subscribe_championship')
  handleSubscribeChampionship(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { championshipId: string },
  ) {
    if (this.isWsRateLimited(client)) return;
    const room = `championship:${data.championshipId}`;
    client.join(room);
    this.clientRooms.get(client.id)?.add(room);
    this.logger.debug(`Client ${client.id} subscribed to championship ${data.championshipId}`);
    client.emit('championship_subscribed', { championshipId: data.championshipId });
  }

  @SubscribeMessage('unsubscribe_championship')
  handleUnsubscribeChampionship(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { championshipId: string },
  ) {
    if (this.isWsRateLimited(client)) return;
    const room = `championship:${data.championshipId}`;
    client.leave(room);
    this.clientRooms.get(client.id)?.delete(room);
  }

  broadcastChampionshipUpdate(championshipId: string, type: string, data: any): void {
    const room = `championship:${championshipId}`;
    this.server.to(room).emit('championship_update', { type, ...data });
    this.logger.log(`[WS] Championship broadcast: ${type} championship=${championshipId}`);
  }
}
