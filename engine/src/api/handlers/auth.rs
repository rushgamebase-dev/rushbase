use crate::api::dto::{
    is_valid_wallet, AuthResponse, SiweNonceRequest, SiweNonceResponse, SiweVerifyRequest,
    UserResponse,
};
use crate::api::middleware::AuthenticatedUser;
use crate::api::state::AppState;
use crate::audit::{event, record_async, Severity};
use crate::auth::generate_nonce;
use crate::db::repositories::UserRepository;
use crate::errors::ApiError;
use actix_web::{web, HttpRequest, HttpResponse};
use actix_web_httpauth::extractors::bearer::BearerAuth;
use chrono::{Duration, Utc};

/// `POST /api/v1/auth/siwe/nonce` — issue a fresh SIWE nonce for a wallet.
pub async fn siwe_nonce(
    app_state: web::Data<AppState>,
    req: HttpRequest,
    body: web::Json<SiweNonceRequest>,
) -> Result<HttpResponse, ApiError> {
    if !is_valid_wallet(&body.wallet) {
        return Err(ApiError::validation_error("Invalid wallet address"));
    }
    let wallet = body.wallet.to_lowercase();
    let nonce = generate_nonce();
    let expires_at = Utc::now() + Duration::seconds(app_state.siwe_nonce_ttl_secs);
    // Capture the source IP as text and let Postgres cast to INET — keeps
    // sqlx free of the optional ipnetwork feature flag.
    let ip_text: Option<String> = req
        .connection_info()
        .realip_remote_addr()
        .map(|s| s.to_string());

    sqlx::query(
        r#"
        INSERT INTO siwe_nonces (nonce, wallet_address, ip_address, expires_at)
        VALUES ($1, $2, $3::INET, $4)
        "#,
    )
    .bind(&nonce)
    .bind(&wallet)
    .bind(ip_text)
    .bind(expires_at)
    .execute(&app_state.pool)
    .await
    .map_err(|e| ApiError::internal(format!("Failed to store nonce: {}", e)))?;

    Ok(HttpResponse::Ok().json(SiweNonceResponse {
        nonce,
        expires_at: expires_at.timestamp(),
    }))
}

/// `POST /api/v1/auth/siwe/verify` — verify a SIWE message + signature, mint
/// the user row if needed, and return an access token.
pub async fn siwe_verify(
    app_state: web::Data<AppState>,
    body: web::Json<SiweVerifyRequest>,
) -> Result<HttpResponse, ApiError> {
    use siwe::Message as SiweMsg;
    use std::str::FromStr;

    // Pre-parse to extract the nonce + wallet for the nonce lookup.
    let parsed = SiweMsg::from_str(&body.message)
        .map_err(|e| ApiError::validation_error(format!("Invalid SIWE message: {}", e)))?;
    let nonce_value = parsed.nonce.clone();
    let wallet = format!(
        "0x{:x}",
        alloy::primitives::Address::from(parsed.address)
    );

    // Atomically consume the nonce (must exist, not consumed, not expired,
    // and bound to this wallet).
    let consumed = sqlx::query_scalar::<_, String>(
        r#"
        UPDATE siwe_nonces
           SET consumed_at = NOW()
         WHERE nonce = $1
           AND wallet_address = $2
           AND consumed_at IS NULL
           AND expires_at > NOW()
        RETURNING nonce
        "#,
    )
    .bind(&nonce_value)
    .bind(&wallet)
    .fetch_optional(&app_state.pool)
    .await
    .map_err(|e| ApiError::internal(format!("Nonce store error: {}", e)))?;

    if consumed.is_none() {
        record_async(
            app_state.pool.clone(),
            None,
            event::SIWE_LOGIN_FAILED,
            Severity::Warn,
            Some(serde_json::json!({
                "reason": "nonce_not_found_or_expired",
                "wallet": wallet,
            })),
        );
        return Err(ApiError::unauthorized("SIWE nonce not found, expired, or already consumed"));
    }

    let verified = app_state
        .siwe_verifier
        .verify(&body.message, &body.signature, &nonce_value)
        .await
        .map_err(|e| {
            record_async(
                app_state.pool.clone(),
                None,
                event::SIWE_LOGIN_FAILED,
                Severity::Warn,
                Some(serde_json::json!({
                    "reason": "signature_invalid",
                    "wallet": wallet,
                    "detail": e.to_string(),
                })),
            );
            ApiError::unauthorized(format!("SIWE verification failed: {}", e))
        })?;

    let user_repo = UserRepository::new(app_state.pool.clone());
    let user = user_repo
        .upsert_by_wallet(&verified.wallet)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to upsert user: {}", e)))?;

    let token = app_state
        .jwt_service
        .issue(user.id, &user.wallet_address)
        .map_err(|e| ApiError::internal(format!("Failed to issue token: {}", e)))?;

    record_async(
        app_state.pool.clone(),
        Some(user.id),
        event::SIWE_LOGIN_OK,
        Severity::Info,
        Some(serde_json::json!({ "wallet": user.wallet_address })),
    );

    Ok(HttpResponse::Ok().json(AuthResponse {
        access_token: token.access_token,
        token_type: token.token_type,
        expires_in: token.expires_in,
        user: UserResponse {
            id: user.id,
            wallet_address: user.wallet_address.clone(),
            username: user.username.clone(),
            deposited_wei: user.deposited_wei.to_string(),
            withdrawn_wei: user.withdrawn_wei.to_string(),
            realized_pnl_wei: user.realized_pnl_wei.to_string(),
            locked_margin_wei: user.locked_margin_wei.to_string(),
            free_balance_wei: user.free_balance_wei().to_string(),
        },
    }))
}

/// `POST /api/v1/auth/logout` — revoke just THIS access token. The
/// caller's `jti` is recorded in `jwt_revocations` so any future
/// request bearing the same JWT is rejected. Other devices/sessions
/// of the same wallet keep working — use the admin
/// `/users/:id/revoke_all_tokens` endpoint to kick everything.
///
/// Authenticated: the caller must already hold a valid bearer token
/// (otherwise `401 Unauthorized` from the validator). We need the raw
/// `BearerAuth` extractor because the JWT validator that wraps
/// authenticated scopes drops `jti` after extracting `AuthenticatedUser`.
pub async fn logout(
    app_state: web::Data<AppState>,
    user: AuthenticatedUser,
    bearer: BearerAuth,
) -> Result<HttpResponse, ApiError> {
    // Re-decode the token here ONLY to fish out `jti` and `exp` — both
    // already validated by the bearer middleware.
    let claims = match app_state.jwt_service.validate_access_token(bearer.token()) {
        Ok(c) => c,
        Err(_) => return Err(ApiError::unauthorized("Invalid token at logout")),
    };
    if claims.jti == uuid::Uuid::nil() {
        // Pre-jti tokens — caller's only path is to wait for `exp`.
        // Force-rotate via `revoke_all_tokens` if you need it gone now.
        return Err(ApiError::bad_request(
            "This token predates jti revocation; ask an admin for revoke_all_tokens",
        ));
    }
    let expires_at = chrono::DateTime::<Utc>::from_timestamp(claims.exp, 0)
        .unwrap_or_else(Utc::now);
    let result = sqlx::query(
        "INSERT INTO jwt_revocations (jti, user_id, expires_at, reason) \
         VALUES ($1, $2, $3, 'logout') \
         ON CONFLICT (jti) DO NOTHING",
    )
    .bind(claims.jti)
    .bind(user.user_id)
    .bind(expires_at)
    .execute(&app_state.pool)
    .await
    .map_err(|e| ApiError::internal(format!("Logout write failed: {}", e)))?;

    record_async(
        app_state.pool.clone(),
        Some(user.user_id),
        "AUTH_LOGOUT",
        Severity::Info,
        Some(serde_json::json!({
            "jti": claims.jti,
            "first_revoke": result.rows_affected() == 1,
        })),
    );

    Ok(HttpResponse::Ok().json(serde_json::json!({ "ok": true })))
}
