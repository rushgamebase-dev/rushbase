//! Admin role gate. Wrap any scope/route with `HttpAuthentication::bearer(admin_validator)`
//! or stack it on top of the regular `validator` to require both auth
//! and `users.is_admin = true`. Banning persists via `is_active`; admin
//! permission persists via `is_admin`.

use actix_web::{dev::ServiceRequest, web, Error, HttpMessage};
use actix_web_httpauth::extractors::bearer::BearerAuth;
use uuid::Uuid;

use crate::api::middleware::AuthenticatedUser;
use crate::api::state::AppState;

/// Marker inserted on the request when the caller is a confirmed admin.
/// Handlers that need admin capability extract this; the `AuthenticatedUser`
/// stays usable for normal user fields.
#[derive(Clone, Debug)]
pub struct AuthenticatedAdmin {
    pub user_id: Uuid,
    pub wallet: String,
}

impl actix_web::FromRequest for AuthenticatedAdmin {
    type Error = actix_web::Error;
    type Future = std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<Self, Self::Error>>>,
    >;

    fn from_request(
        req: &actix_web::HttpRequest,
        _payload: &mut actix_web::dev::Payload,
    ) -> Self::Future {
        let req = req.clone();
        Box::pin(async move {
            req.extensions()
                .get::<AuthenticatedAdmin>()
                .cloned()
                .ok_or_else(|| actix_web::error::ErrorForbidden("Admin role required"))
        })
    }
}

/// Combined validator: requires a valid JWT, an active user, AND
/// `is_admin = true`. Reuses the regular `validator` first to keep the
/// is_active / rate-limit gates in one place.
pub async fn admin_validator(
    req: ServiceRequest,
    credentials: BearerAuth,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    // Run the standard user validator first. If it fails (bad token,
    // banned user, rate-limited), the admin gate inherits the same 4xx.
    let req = super::auth::validator(req, credentials).await?;

    let user = req
        .extensions()
        .get::<AuthenticatedUser>()
        .cloned();
    let user = match user {
        Some(u) => u,
        None => {
            return Err((
                actix_web::error::ErrorUnauthorized("Authentication required"),
                req,
            ));
        }
    };

    let app_state = req
        .app_data::<web::Data<AppState>>()
        .expect("AppState not found");

    let is_admin: Option<bool> = sqlx::query_scalar("SELECT is_admin FROM users WHERE id = $1")
        .bind(user.user_id)
        .fetch_optional(&app_state.pool)
        .await
        .unwrap_or(None);

    if is_admin == Some(true) {
        let admin = AuthenticatedAdmin {
            user_id: user.user_id,
            wallet: user.wallet.clone(),
        };
        req.extensions_mut().insert(admin);
        Ok(req)
    } else {
        Err((
            actix_web::error::ErrorForbidden("Admin role required"),
            req,
        ))
    }
}
