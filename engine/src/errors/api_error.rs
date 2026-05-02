use actix_web::{HttpResponse, ResponseError};
use serde::Serialize;
use std::fmt;

#[derive(Debug)]
pub enum ApiError {
    // Authentication errors
    InvalidCredentials,
    TokenExpired,
    InvalidToken,
    Unauthorized(String),
    Forbidden(String),

    // Validation errors
    ValidationError(String),
    BadRequest(String),

    // Not found
    NotFound(String),

    // Conflict
    Conflict(String),

    // Trading errors
    TradingError(crate::errors::TradingError),

    // 503 — engine is up but not currently serving (breaker tripped,
    // feed stale, etc.). Distinct from `InternalError` (500) so caller
    // retry policy knows the work *might* succeed later without a
    // payload change.
    ServiceUnavailable(String),

    // Internal errors
    InternalError(String),
    DatabaseError(String),
}

#[derive(Debug, Serialize)]
struct ErrorResponse {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ApiError::InvalidCredentials => write!(f, "Invalid credentials"),
            ApiError::TokenExpired => write!(f, "Token expired"),
            ApiError::InvalidToken => write!(f, "Invalid token"),
            ApiError::Unauthorized(msg) => write!(f, "Unauthorized: {}", msg),
            ApiError::Forbidden(msg) => write!(f, "Forbidden: {}", msg),
            ApiError::ValidationError(msg) => write!(f, "Validation error: {}", msg),
            ApiError::BadRequest(msg) => write!(f, "Bad request: {}", msg),
            ApiError::NotFound(msg) => write!(f, "Not found: {}", msg),
            ApiError::Conflict(msg) => write!(f, "Conflict: {}", msg),
            ApiError::TradingError(e) => write!(f, "Trading error: {}", e),
            ApiError::ServiceUnavailable(msg) => write!(f, "Service unavailable: {}", msg),
            ApiError::InternalError(msg) => write!(f, "Internal error: {}", msg),
            ApiError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
        }
    }
}

impl ResponseError for ApiError {
    fn error_response(&self) -> HttpResponse {
        match self {
            ApiError::InvalidCredentials => HttpResponse::Unauthorized().json(ErrorResponse {
                code: "INVALID_CREDENTIALS",
                message: "Invalid email or password".to_string(),
                details: None,
            }),
            ApiError::TokenExpired => HttpResponse::Unauthorized().json(ErrorResponse {
                code: "TOKEN_EXPIRED",
                message: "Your session has expired. Please log in again.".to_string(),
                details: None,
            }),
            ApiError::InvalidToken => HttpResponse::Unauthorized().json(ErrorResponse {
                code: "INVALID_TOKEN",
                message: "Invalid authentication token".to_string(),
                details: None,
            }),
            ApiError::Unauthorized(msg) => HttpResponse::Unauthorized().json(ErrorResponse {
                code: "UNAUTHORIZED",
                message: if msg.is_empty() {
                    "Authentication required".into()
                } else {
                    msg.clone()
                },
                details: None,
            }),
            ApiError::Forbidden(msg) => HttpResponse::Forbidden().json(ErrorResponse {
                code: "FORBIDDEN",
                message: if msg.is_empty() {
                    "Access denied".into()
                } else {
                    msg.clone()
                },
                details: None,
            }),
            ApiError::ValidationError(msg) => HttpResponse::BadRequest().json(ErrorResponse {
                code: "VALIDATION_ERROR",
                message: msg.clone(),
                details: None,
            }),
            ApiError::BadRequest(msg) => HttpResponse::BadRequest().json(ErrorResponse {
                code: "BAD_REQUEST",
                message: msg.clone(),
                details: None,
            }),
            ApiError::NotFound(msg) => HttpResponse::NotFound().json(ErrorResponse {
                code: "NOT_FOUND",
                message: msg.clone(),
                details: None,
            }),
            ApiError::Conflict(msg) => HttpResponse::Conflict().json(ErrorResponse {
                code: "CONFLICT",
                message: msg.clone(),
                details: None,
            }),
            ApiError::TradingError(e) => HttpResponse::BadRequest().json(ErrorResponse {
                code: "TRADING_ERROR",
                message: e.to_string(),
                details: None,
            }),
            ApiError::ServiceUnavailable(msg) => HttpResponse::ServiceUnavailable().json(
                ErrorResponse {
                    code: "SERVICE_UNAVAILABLE",
                    message: msg.clone(),
                    details: None,
                },
            ),
            ApiError::InternalError(_) | ApiError::DatabaseError(_) => {
                HttpResponse::InternalServerError().json(ErrorResponse {
                    code: "INTERNAL_ERROR",
                    message: "An internal error occurred".to_string(),
                    details: None,
                })
            }
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!("Database error: {:?}", err);
        ApiError::DatabaseError(err.to_string())
    }
}

impl From<crate::errors::TradingError> for ApiError {
    fn from(err: crate::errors::TradingError) -> Self {
        ApiError::TradingError(err)
    }
}

impl From<crate::auth::jwt::JwtError> for ApiError {
    fn from(err: crate::auth::jwt::JwtError) -> Self {
        match err {
            crate::auth::jwt::JwtError::TokenExpired => ApiError::TokenExpired,
            _ => ApiError::InvalidToken,
        }
    }
}

// Convenience constructors
impl ApiError {
    pub fn validation_error(msg: impl Into<String>) -> Self {
        ApiError::ValidationError(msg.into())
    }

    pub fn bad_request(msg: impl Into<String>) -> Self {
        ApiError::BadRequest(msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        ApiError::NotFound(msg.into())
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        ApiError::Conflict(msg.into())
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        ApiError::InternalError(msg.into())
    }

    pub fn unauthorized(msg: impl Into<String>) -> Self {
        ApiError::Unauthorized(msg.into())
    }

    pub fn forbidden(msg: impl Into<String>) -> Self {
        ApiError::Forbidden(msg.into())
    }

    pub fn service_unavailable(msg: impl Into<String>) -> Self {
        ApiError::ServiceUnavailable(msg.into())
    }
}
