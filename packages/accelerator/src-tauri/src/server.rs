use axum::{
    Router,
    body::Bytes,
    extract::DefaultBodyLimit,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde_json::json;
use std::net::SocketAddr;
use tokio::net::TcpListener;

use crate::bb;

const PORT: u16 = 59833;

pub async fn start() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let app = router();
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("Accelerator server listening on {addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

pub fn router() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/prove", post(prove))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB — proving payloads can be large
}

async fn health() -> impl IntoResponse {
    axum::Json(json!({ "status": "ok" }))
}

async fn prove(body: Bytes) -> Result<impl IntoResponse, (StatusCode, String)> {
    let proof = bb::prove(&body).await.map_err(|e| {
        tracing::error!("Proving failed: {e}");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
    })?;

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
        let app = router();
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
    async fn prove_returns_error_when_bb_not_found() {
        let app = router();
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
