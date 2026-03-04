use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use http::Method;
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};

use crate::bb;

const PORT: u16 = 59833;

pub type StatusCallback = Arc<dyn Fn(&str) + Send + Sync>;

#[derive(Clone, Default)]
pub struct AppState {
    pub on_status: Option<StatusCallback>,
}

pub async fn start(state: AppState) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = router(state);
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("Accelerator server listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([http::header::CONTENT_TYPE]);

    Router::new()
        .route("/health", get(health))
        .route("/prove", post(prove))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB — proving payloads can be large
        .layer(cors)
        .with_state(state)
}

async fn health() -> impl IntoResponse {
    axum::Json(json!({ "status": "ok" }))
}

async fn prove(
    State(state): State<AppState>,
    body: Bytes,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    if let Some(ref cb) = state.on_status {
        cb("Status: Proving...");
    }

    let result = bb::prove(&body).await;

    match &result {
        Ok(_) => {
            if let Some(ref cb) = state.on_status {
                cb("Status: Idle");
            }
        }
        Err(e) => {
            tracing::error!("Proving failed: {e}");
            if let Some(cb) = state.on_status.clone() {
                cb("Status: Error");
                tokio::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    cb("Status: Idle");
                });
            }
        }
    }

    let proof = result.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &proof);
    Ok(axum::Json(json!({ "proof": encoded })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request;
    use tower::util::ServiceExt;

    #[tokio::test]
    async fn health_returns_ok() {
        let app = router(AppState::default());
        let response: axum::http::Response<_> = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json, json!({ "status": "ok" }));
    }

    #[tokio::test]
    async fn cors_preflight_returns_correct_headers() {
        let app = router(AppState::default());
        let response: axum::http::Response<_> = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/prove")
                    .header("origin", "http://localhost:5173")
                    .header("access-control-request-method", "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("access-control-allow-origin").unwrap(),
            "*"
        );
    }

    #[tokio::test]
    async fn health_includes_cors_headers() {
        let app = router(AppState::default());
        let response: axum::http::Response<_> = app
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header("origin", "http://localhost:5173")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get("access-control-allow-origin").unwrap(),
            "*"
        );
    }

    #[tokio::test]
    async fn prove_returns_error_when_bb_not_found() {
        let app = router(AppState::default());
        let response: axum::http::Response<_> = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/prove")
                    .header("content-type", "application/octet-stream")
                    .body(Body::from(vec![0u8; 10]))
                    .unwrap(),
            )
            .await
            .unwrap();

        // Should fail because bb is not available in test env
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}
