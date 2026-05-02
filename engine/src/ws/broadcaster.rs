use crate::ws::messages::ServerMessage;
use dashmap::DashMap;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Session handle for sending messages
pub type SessionSender = mpsc::UnboundedSender<ServerMessage>;

/// Manages WebSocket sessions and message broadcasting
pub struct Broadcaster {
    /// All connected sessions: session_id -> sender
    sessions: Arc<DashMap<Uuid, SessionSender>>,
    /// User ID to session IDs mapping
    user_sessions: Arc<DashMap<Uuid, HashSet<Uuid>>>,
    /// Channel subscribers: channel_name -> session_ids
    channel_subscribers: Arc<DashMap<String, HashSet<Uuid>>>,
}

impl Broadcaster {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            user_sessions: Arc::new(DashMap::new()),
            channel_subscribers: Arc::new(DashMap::new()),
        }
    }

    /// Register a new session
    pub fn register(&self, session_id: Uuid, sender: SessionSender, user_id: Option<Uuid>) {
        self.sessions.insert(session_id, sender);

        if let Some(uid) = user_id {
            self.user_sessions
                .entry(uid)
                .or_insert_with(HashSet::new)
                .insert(session_id);
        }

        tracing::debug!(
            session_id = %session_id,
            user_id = ?user_id,
            "Session registered"
        );
    }

    /// Unregister a session
    pub fn unregister(&self, session_id: Uuid, user_id: Option<Uuid>) {
        self.sessions.remove(&session_id);

        if let Some(uid) = user_id {
            if let Some(mut sessions) = self.user_sessions.get_mut(&uid) {
                sessions.remove(&session_id);
            }
        }

        // Remove from all channels
        for mut entry in self.channel_subscribers.iter_mut() {
            entry.value_mut().remove(&session_id);
        }

        tracing::debug!(session_id = %session_id, "Session unregistered");
    }

    /// Associate a user with a session (after authentication)
    pub fn associate_user(&self, session_id: Uuid, user_id: Uuid) {
        self.user_sessions
            .entry(user_id)
            .or_insert_with(HashSet::new)
            .insert(session_id);
    }

    /// Subscribe session to a channel
    pub fn subscribe(&self, session_id: Uuid, channel: &str) {
        self.channel_subscribers
            .entry(channel.to_string())
            .or_insert_with(HashSet::new)
            .insert(session_id);
    }

    /// Unsubscribe session from a channel
    pub fn unsubscribe(&self, session_id: Uuid, channel: &str) {
        if let Some(mut subs) = self.channel_subscribers.get_mut(channel) {
            subs.remove(&session_id);
        }
    }

    /// Send message to a specific session
    pub fn send_to_session(&self, session_id: Uuid, msg: ServerMessage) {
        if let Some(sender) = self.sessions.get(&session_id) {
            let _ = sender.send(msg);
        }
    }

    /// Send message to all sessions of a user
    pub fn send_to_user(&self, user_id: Uuid, msg: ServerMessage) {
        if let Some(sessions) = self.user_sessions.get(&user_id) {
            for session_id in sessions.iter() {
                self.send_to_session(*session_id, msg.clone());
            }
        }
    }

    /// Broadcast message to all subscribers of a channel
    pub fn broadcast_to_channel(&self, channel: &str, msg: ServerMessage) {
        if let Some(subscribers) = self.channel_subscribers.get(channel) {
            for session_id in subscribers.iter() {
                self.send_to_session(*session_id, msg.clone());
            }
        }
    }

    /// Broadcast message to all connected sessions
    pub fn broadcast_all(&self, msg: ServerMessage) {
        for entry in self.sessions.iter() {
            let _ = entry.value().send(msg.clone());
        }
    }

    /// Get count of connected sessions
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    /// Iterate every authenticated user_id with at least one live
    /// session. Cloned to avoid holding the DashMap shard lock during
    /// the caller's async work (e.g. DB queries).
    pub fn active_user_ids(&self) -> Vec<Uuid> {
        self.user_sessions
            .iter()
            .filter(|e| !e.value().is_empty())
            .map(|e| *e.key())
            .collect()
    }

    /// Drop every session belonging to `user_id` after sending an
    /// optional final message. Used by the WS revalidation loop to kick
    /// banned users without waiting for their JWT to expire.
    pub fn force_disconnect_user(&self, user_id: Uuid, final_msg: Option<ServerMessage>) {
        let session_ids: Vec<Uuid> = match self.user_sessions.get(&user_id) {
            Some(set) => set.iter().copied().collect(),
            None => return,
        };
        for sid in session_ids {
            if let Some(msg) = &final_msg {
                let _ = self
                    .sessions
                    .get(&sid)
                    .and_then(|s| s.send(msg.clone()).ok());
            }
            // Drop the channel sender — the WsActor's stream side sees
            // EOF and tears the WebSocket down on its own.
            self.sessions.remove(&sid);
            for mut entry in self.channel_subscribers.iter_mut() {
                entry.value_mut().remove(&sid);
            }
        }
        self.user_sessions.remove(&user_id);
    }

    /// Get count of subscribers for a channel
    pub fn channel_subscriber_count(&self, channel: &str) -> usize {
        self.channel_subscribers
            .get(channel)
            .map(|s| s.len())
            .unwrap_or(0)
    }
}

impl Default for Broadcaster {
    fn default() -> Self {
        Self::new()
    }
}
