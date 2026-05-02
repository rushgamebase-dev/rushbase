use std::collections::HashSet;
use uuid::Uuid;

/// WebSocket session state.
///
/// `token_exp_ms` records the JWT's expiration so a periodic check can
/// kick the socket as soon as the token expires — without it, an
/// authenticated session would survive past JWT expiry until the client
/// reconnects.
pub struct WsSession {
    pub session_id: Uuid,
    pub user_id: Option<Uuid>,
    pub subscriptions: HashSet<String>,
    /// Unix epoch ms; `None` for unauthenticated sessions.
    pub token_exp_ms: Option<i64>,
}

impl WsSession {
    pub fn new() -> Self {
        Self {
            session_id: Uuid::new_v4(),
            user_id: None,
            subscriptions: HashSet::new(),
            token_exp_ms: None,
        }
    }

    pub fn is_authenticated(&self) -> bool {
        self.user_id.is_some()
    }

    /// Returns true once `now_ms >= token_exp_ms`. Unauthenticated
    /// sessions never "expire" — they simply can't access user channels.
    pub fn token_expired(&self, now_ms: i64) -> bool {
        match self.token_exp_ms {
            Some(exp) => now_ms >= exp,
            None => false,
        }
    }

    pub fn authenticate(&mut self, user_id: Uuid, token_exp_ms: Option<i64>) {
        self.user_id = Some(user_id);
        self.token_exp_ms = token_exp_ms;
    }

    pub fn subscribe(&mut self, channel: &str) {
        self.subscriptions.insert(channel.to_string());
    }

    pub fn unsubscribe(&mut self, channel: &str) {
        self.subscriptions.remove(channel);
    }
}

impl Default for WsSession {
    fn default() -> Self {
        Self::new()
    }
}
