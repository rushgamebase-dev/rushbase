//! WebSocket actor for real-time price feed + bet placement notifications.

use crate::api::state::AppState;
use crate::db::repositories::{TouchBetRepository, UserRepository};
use crate::market_feed::RealPriceFeed;
use crate::ws::broadcaster::Broadcaster;
use crate::ws::messages::{BetData, ClientMessage, PriceData, ServerMessage};
use crate::ws::session::WsSession;
use actix::{Actor, ActorContext, AsyncContext, Handler, Message, StreamHandler};
use actix_web::{web, HttpRequest, HttpResponse};
use actix_web_actors::ws;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const CLIENT_TIMEOUT: Duration = Duration::from_secs(30);
/// How often to re-check the session's JWT against its `exp` claim.
/// Must be ≤ HEARTBEAT_INTERVAL × N for tight enforcement; 5 s matches
/// the heartbeat so we piggy-back on its tick.
const TOKEN_CHECK_INTERVAL: Duration = Duration::from_secs(5);

pub struct WsActor {
    session: WsSession,
    hb: Instant,
    app_state: web::Data<AppState>,
    rx: Option<mpsc::UnboundedReceiver<ServerMessage>>,
    tx: mpsc::UnboundedSender<ServerMessage>,
}

impl WsActor {
    pub fn new(app_state: web::Data<AppState>) -> Self {
        let (tx, rx) = mpsc::unbounded_channel();
        Self {
            session: WsSession::new(),
            hb: Instant::now(),
            app_state,
            rx: Some(rx),
            tx,
        }
    }

    fn schedule_heartbeat(&self, ctx: &mut <Self as Actor>::Context) {
        ctx.run_interval(HEARTBEAT_INTERVAL, |act, ctx| {
            if Instant::now().duration_since(act.hb) > CLIENT_TIMEOUT {
                act.app_state
                    .broadcaster
                    .unregister(act.session.session_id, act.session.user_id);
                ctx.stop();
                return;
            }
            ctx.ping(b"");
        });
    }

    /// Periodic JWT freshness check. The HTTP layer revalidates on
    /// every authenticated request, but a long-lived WS session needs
    /// its own loop — otherwise an expired token stays "live" until
    /// the socket is closed for some other reason. We send an explicit
    /// `Error{TOKEN_EXPIRED}` so clients know to re-auth before
    /// reconnecting (the AuthGate redirects them through SIWE).
    fn schedule_token_check(&self, ctx: &mut <Self as Actor>::Context) {
        ctx.run_interval(TOKEN_CHECK_INTERVAL, |act, ctx| {
            if !act.session.is_authenticated() {
                return;
            }
            let now_ms = chrono::Utc::now().timestamp_millis();
            if act.session.token_expired(now_ms) {
                act.send(
                    ctx,
                    ServerMessage::Error {
                        code: "TOKEN_EXPIRED".into(),
                        message: "Session token expired; reconnect with a fresh JWT.".into(),
                    },
                );
                act.app_state
                    .broadcaster
                    .unregister(act.session.session_id, act.session.user_id);
                ctx.stop();
            }
        });
    }

    fn pump_outbound(&mut self, ctx: &mut <Self as Actor>::Context) {
        if let Some(mut rx) = self.rx.take() {
            let addr = ctx.address();
            actix::spawn(async move {
                while let Some(msg) = rx.recv().await {
                    addr.do_send(BroadcastMessage(msg));
                }
            });
        }
    }

    fn send(&self, ctx: &mut <Self as Actor>::Context, msg: ServerMessage) {
        if let Ok(j) = serde_json::to_string(&msg) {
            ctx.text(j);
        }
    }

    fn dispatch(&mut self, msg: ClientMessage, ctx: &mut <Self as Actor>::Context) {
        match msg {
            ClientMessage::Authenticate { token } => {
                if let Ok(claims) = self.app_state.jwt_service.validate_access_token(&token) {
                    let exp_ms = claims.exp.saturating_mul(1_000);
                    self.session.authenticate(claims.sub, Some(exp_ms));
                    self.app_state
                        .broadcaster
                        .associate_user(self.session.session_id, claims.sub);
                    self.send(
                        ctx,
                        ServerMessage::AuthResult {
                            success: true,
                            user_id: Some(claims.sub),
                            wallet: Some(claims.wallet),
                            error: None,
                        },
                    );
                } else {
                    self.send(
                        ctx,
                        ServerMessage::AuthResult {
                            success: false,
                            user_id: None,
                            wallet: None,
                            error: Some("Invalid or expired token".into()),
                        },
                    );
                }
            }
            ClientMessage::SubscribePrices { symbols } => {
                for s in symbols {
                    let channel = format!("prices:{}", s.to_uppercase());
                    self.session.subscribe(&channel);
                    self.app_state
                        .broadcaster
                        .subscribe(self.session.session_id, &channel);
                    self.send(ctx, ServerMessage::Subscribed { channel });
                }
            }
            ClientMessage::UnsubscribePrices { symbols } => {
                for s in symbols {
                    let channel = format!("prices:{}", s.to_uppercase());
                    self.session.unsubscribe(&channel);
                    self.app_state
                        .broadcaster
                        .unsubscribe(self.session.session_id, &channel);
                    self.send(ctx, ServerMessage::Unsubscribed { channel });
                }
            }
            ClientMessage::SubscribeBets => {
                let Some(uid) = self.session.user_id else {
                    self.send(ctx, auth_required());
                    return;
                };
                let channel = format!("bets:{}", uid);
                self.session.subscribe(&channel);
                self.app_state
                    .broadcaster
                    .subscribe(self.session.session_id, &channel);
                self.send(ctx, ServerMessage::Subscribed { channel });
            }
            ClientMessage::UnsubscribeBets => {
                if let Some(uid) = self.session.user_id {
                    let channel = format!("bets:{}", uid);
                    self.session.unsubscribe(&channel);
                    self.app_state
                        .broadcaster
                        .unsubscribe(self.session.session_id, &channel);
                    self.send(ctx, ServerMessage::Unsubscribed { channel });
                }
            }
            ClientMessage::SubscribeAccount => {
                let Some(uid) = self.session.user_id else {
                    self.send(ctx, auth_required());
                    return;
                };
                let channel = format!("account:{}", uid);
                self.session.subscribe(&channel);
                self.app_state
                    .broadcaster
                    .subscribe(self.session.session_id, &channel);
                self.send(ctx, ServerMessage::Subscribed { channel });
            }
            ClientMessage::Ping { timestamp } => {
                self.send(
                    ctx,
                    ServerMessage::Pong {
                        timestamp,
                        server_time: chrono::Utc::now().timestamp_millis(),
                    },
                );
            }
            ClientMessage::GetPrices => {
                let snap = self.app_state.arena_index.snapshot();
                let mut prices = vec![PriceData {
                    symbol: snap.symbol,
                    price_q8: snap.price_q8.to_string(),
                    timestamp: snap.timestamp_ms,
                }];
                prices.extend(
                    self.app_state
                        .real_price_feed
                        .snapshots()
                        .into_iter()
                        .map(|p| PriceData {
                            symbol: p.symbol,
                            price_q8: p.price_q8.to_string(),
                            timestamp: p.timestamp_ms,
                        }),
                );
                self.send(ctx, ServerMessage::PricesSnapshot { prices });
            }
            ClientMessage::GetActiveBets => {
                let Some(uid) = self.session.user_id else {
                    self.send(ctx, auth_required());
                    return;
                };
                let pool = self.app_state.pool.clone();
                let addr = ctx.address();
                actix::spawn(async move {
                    let repo = TouchBetRepository::new(pool);
                    let response = match repo.get_user_active(uid).await {
                        Ok(bets) => ServerMessage::BetsSnapshot {
                            bets: bets.iter().map(BetData::from).collect(),
                        },
                        Err(e) => ServerMessage::Error {
                            code: "DB_ERROR".into(),
                            message: e.to_string(),
                        },
                    };
                    addr.do_send(BroadcastMessage(response));
                });
            }
            ClientMessage::GetBalance => {
                let Some(uid) = self.session.user_id else {
                    self.send(ctx, auth_required());
                    return;
                };
                let pool = self.app_state.pool.clone();
                let addr = ctx.address();
                actix::spawn(async move {
                    let repo = UserRepository::new(pool);
                    let response = match repo.find_by_id(uid).await {
                        Ok(Some(u)) => ServerMessage::BalanceUpdate {
                            deposited_wei: u.deposited_wei.to_string(),
                            withdrawn_wei: u.withdrawn_wei.to_string(),
                            realized_pnl_wei: u.realized_pnl_wei.to_string(),
                            locked_margin_wei: u.locked_margin_wei.to_string(),
                            free_balance_wei: u.free_balance_wei().to_string(),
                        },
                        Ok(None) => ServerMessage::Error {
                            code: "USER_NOT_FOUND".into(),
                            message: "User not found".into(),
                        },
                        Err(e) => ServerMessage::Error {
                            code: "DB_ERROR".into(),
                            message: e.to_string(),
                        },
                    };
                    addr.do_send(BroadcastMessage(response));
                });
            }
        }
    }
}

fn auth_required() -> ServerMessage {
    ServerMessage::Error {
        code: "AUTH_REQUIRED".into(),
        message: "Authenticate first".into(),
    }
}

impl Actor for WsActor {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, ctx: &mut Self::Context) {
        self.schedule_heartbeat(ctx);
        self.schedule_token_check(ctx);
        self.pump_outbound(ctx);
        self.app_state.broadcaster.register(
            self.session.session_id,
            self.tx.clone(),
            self.session.user_id,
        );
    }

    fn stopped(&mut self, _: &mut Self::Context) {
        self.app_state
            .broadcaster
            .unregister(self.session.session_id, self.session.user_id);
    }
}

#[derive(Message)]
#[rtype(result = "()")]
struct BroadcastMessage(ServerMessage);

impl Handler<BroadcastMessage> for WsActor {
    type Result = ();
    fn handle(&mut self, msg: BroadcastMessage, ctx: &mut Self::Context) {
        if let Ok(j) = serde_json::to_string(&msg.0) {
            ctx.text(j);
        }
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for WsActor {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                tracing::error!(error = %e, "WS protocol error");
                ctx.stop();
                return;
            }
        };
        match msg {
            ws::Message::Ping(p) => {
                self.hb = Instant::now();
                ctx.pong(&p);
            }
            ws::Message::Pong(_) => {
                self.hb = Instant::now();
            }
            ws::Message::Text(text) => {
                self.hb = Instant::now();
                match serde_json::from_str::<ClientMessage>(&text) {
                    Ok(m) => self.dispatch(m, ctx),
                    Err(e) => self.send(
                        ctx,
                        ServerMessage::Error {
                            code: "INVALID_MESSAGE".into(),
                            message: format!("Failed to parse message: {}", e),
                        },
                    ),
                }
            }
            ws::Message::Close(reason) => {
                ctx.close(reason);
                ctx.stop();
            }
            _ => {}
        }
    }
}

pub async fn ws_handler(
    req: HttpRequest,
    stream: web::Payload,
    app_state: web::Data<AppState>,
) -> Result<HttpResponse, actix_web::Error> {
    ws::start(WsActor::new(app_state), &req, stream)
}

/// Background task: emit `PriceUpdate` to `prices:RUSH_INDEX`
/// whenever the in-process Rush Index moves. The arena advances
/// every `arena_index::TICK_MS`; this loop polls at the same
/// cadence and only emits when q8 changes.
pub async fn start_price_broadcaster(
    broadcaster: Arc<Broadcaster>,
    arena_index: Arc<crate::arena_index::ArenaIndex>,
    real_price_feed: Arc<RealPriceFeed>,
) {
    let mut interval =
        tokio::time::interval(Duration::from_millis(crate::arena_index::TICK_MS as u64));
    let mut last_q8: HashMap<String, i64> = HashMap::new();
    loop {
        interval.tick().await;
        let snap = arena_index.snapshot();
        let changed = last_q8
            .get(&snap.symbol)
            .map_or(true, |last| *last != snap.price_q8);
        if changed {
            last_q8.insert(snap.symbol.clone(), snap.price_q8);
            broadcaster.broadcast_to_channel(
                &format!("prices:{}", snap.symbol),
                ServerMessage::PriceUpdate {
                    symbol: snap.symbol,
                    price_q8: snap.price_q8.to_string(),
                    timestamp: snap.timestamp_ms,
                },
            );
        }

        for price in real_price_feed.snapshots() {
            if price.stale {
                continue;
            }
            let changed = last_q8
                .get(&price.symbol)
                .map_or(true, |last| *last != price.price_q8);
            if !changed {
                continue;
            }
            last_q8.insert(price.symbol.clone(), price.price_q8);
            broadcaster.broadcast_to_channel(
                &format!("prices:{}", price.symbol),
                ServerMessage::PriceUpdate {
                    symbol: price.symbol,
                    price_q8: price.price_q8.to_string(),
                    timestamp: price.timestamp_ms,
                },
            );
        }
    }
}

impl Clone for WsSession {
    fn clone(&self) -> Self {
        Self {
            session_id: self.session_id,
            user_id: self.user_id,
            subscriptions: self.subscriptions.clone(),
            token_exp_ms: self.token_exp_ms,
        }
    }
}
