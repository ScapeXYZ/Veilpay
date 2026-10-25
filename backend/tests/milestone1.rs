use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use tower::ServiceExt;
use veilpay_backend::{App, Config};

const ORIGIN: &str = "http://localhost:3000";
#[derive(Clone)]
struct Session {
    cookie: String,
    csrf: String,
}
struct Reply {
    status: u16,
    body: Value,
    raw: Vec<u8>,
    replay: bool,
    cookie: Option<String>,
}
struct Fixture {
    app: App,
    router: Router,
    customer: Session,
    merchant: Session,
}
async fn call(
    router: &Router,
    method: &str,
    path: &str,
    session: Option<&Session>,
    key: Option<&str>,
    body: Value,
) -> Reply {
    let mut req = Request::builder()
        .method(method)
        .uri(format!("/api/{path}"))
        .header("origin", ORIGIN)
        .header("content-type", "application/json");
    if let Some(s) = session {
        req = req
            .header("cookie", &s.cookie)
            .header("x-csrf-token", &s.csrf);
    }
    if let Some(k) = key {
        req = req.header("idempotency-key", k);
    }
    let response = router
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    decode(response).await
}
async fn decode(response: axum::response::Response) -> Reply {
    let status = response.status().as_u16();
    let replay = response
        .headers()
        .get("idempotent-replay")
        .is_some_and(|v| v == "true");
    let cookie = response
        .headers()
        .get("set-cookie")
        .map(|v| v.to_str().unwrap().to_owned());
    let raw = to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    let body = serde_json::from_slice(&raw).unwrap_or(Value::Null);
    Reply {
        status,
        body,
        raw,
        replay,
        cookie,
    }
}
impl Fixture {
    async fn new() -> Self {
        Self::at("sqlite::memory:").await
    }
    async fn at(database_url: &str) -> Self {
        let app = App::open(Config {
            database_url: database_url.into(),
            frontend_origin: ORIGIN.into(),
            network: "testnet".into(),
        })
        .await
        .unwrap();
        let router = app.clone().router();
        let mut sessions = Vec::new();
        for role in ["customer", "merchant"] {
            let r = call(
                &router,
                "POST",
                "session/demo",
                None,
                None,
                json!({"context": role}),
            )
            .await;
            assert_eq!(r.status, 200);
            let cookie = r.cookie.unwrap();
            for attr in [
                "HttpOnly",
                "Secure",
                "SameSite=Strict",
                "Path=/",
                "Max-Age=28800",
            ] {
                assert!(cookie.contains(attr));
            }
            assert!(!cookie.contains("Domain="));
            sessions.push(Session {
                cookie: cookie.split(';').next().unwrap().into(),
                csrf: r.body["csrfToken"].as_str().unwrap().into(),
            });
        }
        Self {
            app,
            router,
            customer: sessions.remove(0),
            merchant: sessions.remove(0),
        }
    }
    async fn agent(&self, cap: &str, budget: &str) -> Value {
        let r = call(
            &self.router,
            "POST",
            "agents",
            Some(&self.customer),
            Some(&uuid::Uuid::new_v4().to_string()),
            json!({"name":"Agent", "policy": rules(cap, budget)}),
        )
        .await;
        assert_eq!(r.status, 201, "{}", r.body);
        r.body
    }
    async fn invoice(&self, amount: &str) -> Value {
        let r = call(
            &self.router,
            "POST",
            "merchant/invoices",
            Some(&self.merchant),
            Some(&uuid::Uuid::new_v4().to_string()),
            json!({"reference":"invoice", "amountZat":amount}),
        )
        .await;
        assert_eq!(r.status, 201);
        r.body
    }
    async fn request(&self, agent: &Value, invoice: &Value, amount: &str, key: &str) -> Reply {
        call(&self.router,"POST","payments/request",Some(&self.customer),Some(key),json!({"agentId":agent["id"],"invoiceId":invoice["id"],"amountZat":amount,"reference":"request"})).await
    }
    async fn execute(&self, payment: &Value, key: &str) -> Reply {
        call(
            &self.router,
            "POST",
            &format!("payments/{}/execute", payment["id"].as_str().unwrap()),
            Some(&self.customer),
            Some(key),
            json!({}),
        )
        .await
    }
    async fn usage(&self, agent: &Value) -> Value {
        call(
            &self.router,
            "GET",
            &format!("agents/{}", agent["id"].as_str().unwrap()),
            Some(&self.customer),
            None,
            json!({}),
        )
        .await
        .body["usage"]
            .clone()
    }
    async fn update(&self, agent: &Value, rules: Value) -> Reply {
        let mut body = rules;
        body["expectedVersion"] = json!(1);
        call(
            &self.router,
            "PUT",
            &format!("agents/{}/policy", agent["id"].as_str().unwrap()),
            Some(&self.customer),
            None,
            body,
        )
        .await
    }
    async fn payment(&self) -> (Value, Value) {
        let a = self.agent("100", "100").await;
        let i = self.invoice("60").await;
        let p = self.request(&a, &i, "60", "request-key").await;
        assert_eq!(p.status, 201);
        assert_eq!(p.body["status"], "authorized");
        (a, p.body)
    }
    async fn ack(&self, p: &Value, key: &str, body: Value) -> Reply {
        call(
            &self.router,
            "POST",
            &format!("payments/{}/acknowledgment", p["id"].as_str().unwrap()),
            Some(&self.merchant),
            Some(key),
            body,
        )
        .await
    }
}
fn rules(cap: &str, budget: &str) -> Value {
    json!({"perTxLimitZat":cap,"totalBudgetZat":budget,"allowedMerchantIds":["mer_demo"],"requestTtlSeconds":900})
}
fn violation(p: &Value, code: &str) -> bool {
    p["decision"]["violations"]
        .as_array()
        .unwrap()
        .iter()
        .any(|v| v["code"] == code)
}

#[tokio::test]
async fn policy_cap_budget_allowlist_pause_and_amount_are_enforced() {
    let f = Fixture::new().await;
    for (cap, budget, merchant, status, amount, code) in [
        ("50", "100", "mer_demo", "active", "60", "CAP_EXCEEDED"),
        ("100", "50", "mer_demo", "active", "60", "BUDGET_EXCEEDED"),
        (
            "100",
            "100",
            "mer_other",
            "active",
            "60",
            "MERCHANT_NOT_ALLOWED",
        ),
        ("100", "100", "mer_demo", "paused", "60", "AGENT_PAUSED"),
        ("100", "100", "mer_demo", "active", "59", "AMOUNT_MISMATCH"),
    ] {
        let a = f.agent(cap, budget).await;
        let i = f.invoice("60").await;
        if merchant != "mer_demo" {
            let mut p = rules(cap, budget);
            p["allowedMerchantIds"] = json!([merchant]);
            assert_eq!(f.update(&a, p).await.status, 200);
        }
        if status == "paused" {
            assert_eq!(
                call(
                    &f.router,
                    "PATCH",
                    &format!("agents/{}", a["id"].as_str().unwrap()),
                    Some(&f.customer),
                    None,
                    json!({"status":status})
                )
                .await
                .status,
                200
            );
        }
        let r = f
            .request(&a, &i, amount, &uuid::Uuid::new_v4().to_string())
            .await;
        assert_eq!(r.status, 201);
        assert_eq!(r.body["status"], "rejected");
        assert!(violation(&r.body, code));
        assert_eq!(f.usage(&a).await["reservedZat"], "0");
    }
}
#[tokio::test]
async fn reservations_prevent_overspend_and_execute_reuses_own_reservation() {
    let f = Fixture::new().await;
    let (a, p) = f.payment().await;
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    let i = f.invoice("60").await;
    let denied = f.request(&a, &i, "60", "second-request").await;
    assert!(violation(&denied.body, "BUDGET_EXCEEDED"));
    assert_eq!(f.execute(&p, "execute-key").await.status, 202);
    let u = f.usage(&a).await;
    assert_eq!(u["spentZat"], "60");
    assert_eq!(u["reservedZat"], "0");
    assert_eq!(u["pendingCount"], 0);
}
#[tokio::test]
async fn execute_rechecks_current_policy_and_releases_once() {
    let f = Fixture::new().await;
    let (a, p) = f.payment().await;
    assert_eq!(f.update(&a, rules("50", "50")).await.status, 200);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    let r = f.execute(&p, "execute-key").await;
    assert_eq!(r.body["code"], "POLICY_REJECTED");
    assert_eq!(f.usage(&a).await["reservedZat"], "0");
    assert_eq!(
        f.execute(&p, "execute-again").await.body["code"],
        "INVALID_TRANSITION"
    );
    let saved = call(
        &f.router,
        "GET",
        &format!("payments/{}", p["id"].as_str().unwrap()),
        Some(&f.customer),
        None,
        json!({}),
    )
    .await
    .body;
    assert_eq!(saved["decision"]["policyVersion"], 2);
    assert!(violation(&saved, "CAP_EXCEEDED"));
    let operations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM wallet_operations")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(operations, 0);
}
#[tokio::test]
async fn pause_before_execute_releases_reservation() {
    let f = Fixture::new().await;
    let (a, p) = f.payment().await;
    call(
        &f.router,
        "PATCH",
        &format!("agents/{}", a["id"].as_str().unwrap()),
        Some(&f.customer),
        None,
        json!({"status":"paused"}),
    )
    .await;
    assert_eq!(
        f.execute(&p, "execute-key").await.body["code"],
        "POLICY_REJECTED"
    );
    assert_eq!(f.usage(&a).await["reservedZat"], "0");
}
#[tokio::test]
async fn request_replay_returns_original_bytes_even_after_execution() {
    let f = Fixture::new().await;
    let a = f.agent("100", "100").await;
    let i = f.invoice("60").await;
    let first = f.request(&a, &i, "60", "request-key").await;
    f.execute(&first.body, "execute-key").await;
    let replay = f.request(&a, &i, "60", "request-key").await;
    assert_eq!(replay.status, 201);
    assert!(replay.replay);
    assert_eq!(first.raw, replay.raw);
    assert_eq!(
        f.request(&a, &i, "59", "request-key").await.body["code"],
        "IDEMPOTENCY_MISMATCH"
    );
    assert_eq!(f.usage(&a).await["spentZat"], "60");
}
#[tokio::test]
async fn concurrent_different_requests_never_jointly_overspend() {
    let f = Fixture::new().await;
    let a = f.agent("100", "100").await;
    let i = f.invoice("60").await;
    let j = f.invoice("60").await;
    let (x, y) = tokio::join!(
        f.request(&a, &i, "60", "request-one"),
        f.request(&a, &j, "60", "request-two")
    );
    assert_eq!((x.status, y.status), (201, 201));
    assert_eq!(
        [&x.body, &y.body]
            .iter()
            .filter(|p| p["status"] == "authorized")
            .count(),
        1
    );
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
}
#[tokio::test]
async fn concurrent_same_key_requests_reserve_once() {
    let f = Fixture::new().await;
    let a = f.agent("100", "100").await;
    let i = f.invoice("60").await;
    let (x, y) = tokio::join!(
        f.request(&a, &i, "60", "same-key"),
        f.request(&a, &i, "60", "same-key")
    );
    assert_eq!((x.status, y.status), (201, 201));
    assert_eq!(x.raw, y.raw);
    assert_ne!(x.replay, y.replay);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
}
#[tokio::test]
async fn concurrent_execute_same_key_replays_and_different_key_never_sends_twice() {
    let f = Fixture::new().await;
    let (a, p) = f.payment().await;
    let (x, y) = tokio::join!(f.execute(&p, "same-key"), f.execute(&p, "same-key"));
    assert_eq!((x.status, y.status), (202, 202));
    assert_eq!(x.raw, y.raw);
    assert_ne!(x.replay, y.replay);
    let (x, y) = tokio::join!(
        f.execute(&p, "other-key-one"),
        f.execute(&p, "other-key-two")
    );
    assert_eq!((x.status, y.status), (202, 202));
    let operations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM wallet_operations")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(operations, 1);
    assert_eq!(f.usage(&a).await["spentZat"], "60");
}
#[tokio::test]
async fn concurrent_different_key_first_execution_has_one_operation() {
    let f = Fixture::new().await;
    let (a, p) = f.payment().await;
    let (x, y) = tokio::join!(f.execute(&p, "execute-one"), f.execute(&p, "execute-two"));
    assert_eq!((x.status, y.status), (202, 202));
    assert_eq!(
        x.body["walletOperation"]["id"],
        y.body["walletOperation"]["id"]
    );
    let operations: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM wallet_operations")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(operations, 1);
    assert_eq!(f.usage(&a).await["spentZat"], "60");
}
#[tokio::test]
async fn mock_execution_and_verification_never_claim_chain_activity() {
    let f = Fixture::new().await;
    let (_, p) = f.payment().await;
    let r = f.execute(&p, "execute-key").await;
    assert_eq!(r.status, 202);
    assert_eq!(r.body["status"], "confirmed");
    assert!(r.body["txid"].is_null());
    assert!(r.body["pool"].is_null());
    assert!(r.body["mockRef"].as_str().unwrap().starts_with("mock_"));
    assert!(
        r.body["timeline"].as_array().unwrap().last().unwrap()["note"]
            .as_str()
            .unwrap()
            .contains("MOCK")
    );
    let h = call(&f.router, "GET", "health", None, None, json!({}))
        .await
        .body;
    assert_eq!(h["mode"], "mock");
    assert!(h["chainHeight"].is_null());
    let v = call(
        &f.router,
        "GET",
        &format!("payments/{}/verification", p["id"].as_str().unwrap()),
        Some(&f.merchant),
        None,
        json!({}),
    )
    .await
    .body;
    assert_eq!(v["method"], "mock");
    assert_eq!(v["mock"], true);
    assert_eq!(v["state"], "received");
    assert_eq!(v["receivedZat"], "60");
    let txid: Option<String> = sqlx::query_scalar("SELECT txid FROM wallet_operations")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert!(txid.is_none());
}
#[tokio::test]
async fn acknowledgment_is_signed_persisted_replayed_and_unique() {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;
    let f = Fixture::new().await;
    let (_, p) = f.payment().await;
    assert_eq!(
        f.ack(&p, "early-key", json!({})).await.body["code"],
        "NOT_YET_RECEIVED"
    );
    f.execute(&p, "execute-key").await;
    let first = f
        .ack(&p, "ack-key-one", json!({"note":"Mock receipt accepted"}))
        .await;
    assert_eq!(first.status, 201);
    assert_eq!(
        first.body["statementType"],
        "merchant_acknowledgment_simulation_not_settlement_proof"
    );
    let secret: String =
        sqlx::query_scalar("SELECT value FROM app_secrets WHERE name='merchant_ack'")
            .fetch_one(&f.app.pool)
            .await
            .unwrap();
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
    mac.update(
        json!([p["id"], "60", first.body["at"]])
            .to_string()
            .as_bytes(),
    );
    assert_eq!(
        first.body["signature"],
        format!("mock:hmac-sha256:{:x}", mac.finalize().into_bytes())
    );
    let replay = f
        .ack(&p, "ack-key-one", json!({"note":"Mock receipt accepted"}))
        .await;
    assert!(replay.replay);
    assert_eq!(first.raw, replay.raw);
    assert_eq!(
        f.ack(&p, "ack-key-one", json!({"note":"changed"}))
            .await
            .body["code"],
        "IDEMPOTENCY_MISMATCH"
    );
    assert_eq!(
        f.ack(&p, "ack-key-two", json!({})).await.body["code"],
        "ALREADY_ACKNOWLEDGED"
    );
    assert_eq!(
        f.ack(&p, "ack-key-bad", json!({"note":"x".repeat(281)}))
            .await
            .status,
        400
    );
}
#[tokio::test]
async fn role_isolation_and_record_scope_are_enforced() {
    let f = Fixture::new().await;
    let (_, p) = f.payment().await;
    for (role, method, path) in [
        (&f.customer, "GET", "merchant/invoices".into()),
        (
            &f.customer,
            "GET",
            format!("payments/{}/verification", p["id"].as_str().unwrap()),
        ),
        (
            &f.customer,
            "POST",
            format!("payments/{}/acknowledgment", p["id"].as_str().unwrap()),
        ),
        (&f.merchant, "GET", "payments".into()),
        (&f.merchant, "POST", "agents".into()),
        (
            &f.merchant,
            "POST",
            format!("payments/{}/execute", p["id"].as_str().unwrap()),
        ),
    ] {
        assert_eq!(
            call(
                &f.router,
                method,
                &path,
                Some(role),
                Some("wrong-role"),
                json!({})
            )
            .await
            .body["code"],
            "WRONG_CONTEXT"
        );
    }
    sqlx::query("UPDATE records SET owner='other_customer' WHERE kind='payment'")
        .execute(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(
        call(
            &f.router,
            "GET",
            &format!("payments/{}", p["id"].as_str().unwrap()),
            Some(&f.customer),
            None,
            json!({})
        )
        .await
        .status,
        404
    );
    sqlx::query(
        "UPDATE records SET body=json_set(body,'$.merchantId','mer_other') WHERE kind='payment'",
    )
    .execute(&f.app.pool)
    .await
    .unwrap();
    assert_eq!(f.ack(&p, "foreign-key", json!({})).await.status, 404);
}
#[tokio::test]
async fn csrf_requires_origin_and_session_bound_token() {
    let f = Fixture::new().await;
    for (origin, csrf) in [
        (None, Some(f.customer.csrf.as_str())),
        (Some("http://evil.example"), Some(f.customer.csrf.as_str())),
        (Some(ORIGIN), None),
        (Some(ORIGIN), Some(f.merchant.csrf.as_str())),
    ] {
        let mut req = Request::builder()
            .method("POST")
            .uri("/api/agents")
            .header("cookie", &f.customer.cookie)
            .header("idempotency-key", "csrf-key");
        if let Some(o) = origin {
            req = req.header("origin", o)
        }
        if let Some(c) = csrf {
            req = req.header("x-csrf-token", c)
        }
        let r = decode(
            f.router
                .clone()
                .oneshot(req.body(Body::from("{}")).unwrap())
                .await
                .unwrap(),
        )
        .await;
        assert_eq!(r.status, 403);
        assert_eq!(r.body["code"], "CSRF_FAILED");
    }
    let req = Request::builder()
        .method("POST")
        .uri("/api/session/demo")
        .body(Body::from(r#"{"context":"customer"}"#))
        .unwrap();
    assert_eq!(
        f.router.clone().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn session_rotation_invalidates_old_cookie_and_missing_session_is_unauthorized() {
    let f = Fixture::new().await;
    assert_eq!(
        call(&f.router, "GET", "payments", None, None, json!({}))
            .await
            .status,
        401
    );
    assert_eq!(
        call(
            &f.router,
            "POST",
            "session/demo",
            Some(&f.customer),
            None,
            json!({"context":"merchant"})
        )
        .await
        .status,
        200
    );
    assert_eq!(
        call(
            &f.router,
            "GET",
            "session",
            Some(&f.customer),
            None,
            json!({})
        )
        .await
        .status,
        401
    );
}
#[tokio::test]
async fn validation_rejects_noninteger_money_and_invalid_policy() {
    let f = Fixture::new().await;
    for amount in [
        json!(1.5),
        json!(1),
        json!("01"),
        json!("-1"),
        json!("1.0"),
        json!("10000000000000000"),
    ] {
        let mut p = rules("100", "100");
        p["perTxLimitZat"] = amount;
        assert_eq!(
            call(
                &f.router,
                "POST",
                "agents",
                Some(&f.customer),
                Some("validation-key"),
                json!({"name":"test","policy":p})
            )
            .await
            .status,
            400
        );
    }
    for ttl in [29, 86401] {
        let mut p = rules("100", "100");
        p["requestTtlSeconds"] = json!(ttl);
        assert_eq!(
            call(
                &f.router,
                "POST",
                "agents",
                Some(&f.customer),
                Some("validation-key"),
                json!({"name":"test","policy":p})
            )
            .await
            .status,
            400
        );
    }
}
#[tokio::test]
async fn policy_version_conflict_preserves_history() {
    let f = Fixture::new().await;
    let (a, p) = f.payment().await;
    assert_eq!(f.update(&a, rules("70", "100")).await.status, 200);
    assert_eq!(
        f.update(&a, rules("10", "10")).await.body["code"],
        "VERSION_CONFLICT"
    );
    let r = f.execute(&p, "execute-key").await;
    assert_eq!(r.status, 202);
    assert_eq!(r.body["decision"]["policyVersion"], 2);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM records WHERE kind='policy'")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(n, 2);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM records WHERE kind='decision'")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(n, 2);
}
#[tokio::test]
async fn expiration_releases_unsent_reservation_once() {
    let f = Fixture::new().await;
    let (a, p) = f.payment().await;
    sqlx::query("UPDATE records SET body=json_set(body,'$.expiresAt','2000-01-01T00:00:00Z') WHERE kind='payment' AND id=?").bind(p["id"].as_str().unwrap()).execute(&f.app.pool).await.unwrap();
    for _ in 0..2 {
        let u = f.usage(&a).await;
        assert_eq!(u["reservedZat"], "0");
        assert_eq!(u["pendingCount"], 0);
    }
    assert_eq!(
        f.execute(&p, "expired-key").await.body["code"],
        "INVALID_TRANSITION"
    );
}
#[tokio::test]
async fn concurrent_acknowledgment_has_one_winner() {
    let f = Fixture::new().await;
    let (_, p) = f.payment().await;
    f.execute(&p, "execute-key").await;
    let (x, y) = tokio::join!(
        f.ack(&p, "ack-key-one", json!({})),
        f.ack(&p, "ack-key-two", json!({}))
    );
    let mut statuses = [x.status, y.status];
    statuses.sort();
    assert_eq!(statuses, [201, 409]);
}

#[tokio::test]
async fn acknowledgment_handles_late_mismatched_and_unconfirmed_mock_receipts() {
    let f = Fixture::new().await;
    let (_, p) = f.payment().await;
    f.execute(&p, "execute-key").await;
    // Inject receipt observations into this isolated mock database; no wallet or chain involved.
    sqlx::query("UPDATE records SET body=json_set(body,'$.expiresAt','2000-01-01T00:00:00Z') WHERE kind='invoice'").execute(&f.app.pool).await.unwrap();
    let path = format!("payments/{}/verification", p["id"].as_str().unwrap());
    let v = call(&f.router, "GET", &path, Some(&f.merchant), None, json!({}))
        .await
        .body;
    assert_eq!(v["state"], "late");
    assert_eq!(v["late"], true);
    sqlx::query("UPDATE records SET body=json_set(body,'$.confirmations',0) WHERE kind='payment'")
        .execute(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(
        f.ack(&p, "pending-ack", json!({})).await.body["code"],
        "NOT_YET_RECEIVED"
    );
    sqlx::query("UPDATE records SET body=json_set(body,'$.confirmations',1,'$.amountZat','59') WHERE kind='payment'").execute(&f.app.pool).await.unwrap();
    let v = call(&f.router, "GET", &path, Some(&f.merchant), None, json!({}))
        .await
        .body;
    assert_eq!(v["state"], "amount_mismatch");
    assert_eq!(v["late"], true);
    assert_eq!(
        f.ack(&p, "mismatch-ack", json!({})).await.body["code"],
        "AMOUNT_MISMATCH"
    );
    sqlx::query("UPDATE records SET body=json_set(body,'$.amountZat','60') WHERE kind='payment'")
        .execute(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(f.ack(&p, "late-ack-key", json!({})).await.status, 201);
}
#[tokio::test]
async fn expired_invoices_and_requests_cannot_reserve_budget() {
    let f = Fixture::new().await;
    let a = f.agent("100", "100").await;
    let i = f.invoice("60").await;
    let r=call(&f.router,"POST","payments/request",Some(&f.customer),Some("expired-request"),json!({"agentId":a["id"],"invoiceId":i["id"],"amountZat":"60","reference":"expired","expiresAt":"2000-01-01T00:00:00Z"})).await;
    assert!(violation(&r.body, "REQUEST_EXPIRED"));
    sqlx::query("UPDATE records SET body=json_set(body,'$.expiresAt','2000-01-01T00:00:00Z') WHERE kind='invoice'").execute(&f.app.pool).await.unwrap();
    let r = f.request(&a, &i, "60", "expired-invoice").await;
    assert!(violation(&r.body, "INVOICE_NOT_PAYABLE"));
    assert_eq!(f.usage(&a).await["reservedZat"], "0");
}
#[tokio::test]
async fn idempotency_keys_are_required_and_scoped_to_operation_and_principal() {
    let f = Fixture::new().await;
    for key in [None, Some("short"), Some("")] {
        assert_eq!(
            call(
                &f.router,
                "POST",
                "agents",
                Some(&f.customer),
                key,
                json!({"name":"test","policy":rules("100","100")})
            )
            .await
            .status,
            400
        );
    }
    let body = json!({"name":"test","policy":rules("100","100")});
    let a = call(
        &f.router,
        "POST",
        "agents",
        Some(&f.customer),
        Some("shared-key"),
        body.clone(),
    )
    .await;
    assert_eq!(a.status, 201);
    let i = call(
        &f.router,
        "POST",
        "merchant/invoices",
        Some(&f.merchant),
        Some("shared-key"),
        json!({"reference":"test","amountZat":"60"}),
    )
    .await;
    assert_eq!(i.status, 201);
    assert!(!i.replay);
    let p = f.request(&a.body, &i.body, "60", "shared-key").await;
    assert_eq!(p.status, 201);
    assert!(!p.replay);
    let replay = call(
        &f.router,
        "POST",
        "agents",
        Some(&f.customer),
        Some("shared-key"),
        body,
    )
    .await;
    assert!(replay.replay);
    assert_eq!(a.raw, replay.raw);
}
#[tokio::test]
async fn mainnet_disables_demo_bootstrap() {
    let app = App::open_with_wallet(
        Config {
            database_url: "sqlite::memory:".into(),
            frontend_origin: ORIGIN.into(),
            network: "mainnet".into(),
        },
        Some(Arc::new(ZingoWallet::new(Network::Mainnet))),
    )
    .await
    .unwrap();
    let r = call(
        &app.router(),
        "POST",
        "session/demo",
        None,
        None,
        json!({"context":"customer"}),
    )
    .await;
    assert_eq!(r.status, 404);
}
#[tokio::test]
async fn demo_rate_limits_use_connection_ip() {
    use axum::extract::ConnectInfo;
    use std::net::SocketAddr;
    let f = Fixture::new().await;
    for attempt in 0..31 {
        let req = Request::builder()
            .method("POST")
            .uri("/api/session/demo")
            .header("origin", ORIGIN)
            .extension(ConnectInfo("127.0.0.2:1234".parse::<SocketAddr>().unwrap()))
            .body(Body::from(r#"{"context":"customer"}"#))
            .unwrap();
        let r = f.router.clone().oneshot(req).await.unwrap();
        assert_eq!(r.status().as_u16(), if attempt < 30 { 200 } else { 429 });
    }
    // Another IP is not blocked by the first IP's counter.
    let req = Request::builder()
        .method("POST")
        .uri("/api/session/demo")
        .header("origin", ORIGIN)
        .extension(ConnectInfo("127.0.0.3:1234".parse::<SocketAddr>().unwrap()))
        .body(Body::from(r#"{"context":"customer"}"#))
        .unwrap();
    assert_eq!(
        f.router.oneshot(req).await.unwrap().status(),
        StatusCode::OK
    );
}
#[tokio::test]
async fn cors_allows_only_configured_origin_with_credentials() {
    let f = Fixture::new().await;
    for origin in [ORIGIN, "http://evil.example"] {
        let req = Request::builder()
            .method("OPTIONS")
            .uri("/api/agents")
            .header("origin", origin)
            .header("access-control-request-method", "POST")
            .header(
                "access-control-request-headers",
                "x-csrf-token,idempotency-key",
            )
            .body(Body::empty())
            .unwrap();
        let r = f.router.clone().oneshot(req).await.unwrap();
        assert_eq!(r.headers()["access-control-allow-origin"], ORIGIN);
        assert_eq!(r.headers()["access-control-allow-credentials"], "true");
        if origin != ORIGIN {
            assert_ne!(r.headers()["access-control-allow-origin"], origin);
        }
    }
}

#[tokio::test]
async fn health_read_does_not_compete_for_the_writer_lock() {
    let path = std::env::temp_dir().join(format!("veilpay-health-{}.db", uuid::Uuid::new_v4()));
    let url = format!("sqlite://{}", path.display());
    let f = Fixture::at(&url).await;

    // Hold SQLite's one writer slot. A health probe is read-only and must stay
    // available rather than waiting for the write busy timeout and becoming a
    // backend 500.
    let mut writer = f.app.pool.acquire().await.unwrap();
    sqlx::query("BEGIN IMMEDIATE")
        .execute(&mut *writer)
        .await
        .unwrap();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        f.router.clone().oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("health must not wait on a write lock")
    .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    sqlx::query("ROLLBACK").execute(&mut *writer).await.unwrap();
    drop(writer);
    f.app.pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn acknowledgment_and_signing_key_survive_database_reopen() {
    let path = std::env::temp_dir().join(format!("veilpay-test-{}.db", uuid::Uuid::new_v4()));
    let url = format!("sqlite://{}", path.display());
    let mut f = Fixture::at(&url).await;
    let (_, p) = f.payment().await;
    let executed = f.execute(&p, "execute-key").await;
    let first = f.ack(&p, "acknowledge-key", json!({})).await;
    assert_eq!(first.status, 201);
    let secret: String =
        sqlx::query_scalar("SELECT value FROM app_secrets WHERE name='merchant_ack'")
            .fetch_one(&f.app.pool)
            .await
            .unwrap();
    f.app.pool.close().await;
    let app = App::open(Config {
        database_url: url,
        frontend_origin: ORIGIN.into(),
        network: "testnet".into(),
    })
    .await
    .unwrap();
    f.router = app.clone().router();
    f.app = app;
    let restored: String =
        sqlx::query_scalar("SELECT value FROM app_secrets WHERE name='merchant_ack'")
            .fetch_one(&f.app.pool)
            .await
            .unwrap();
    assert_eq!(secret, restored);
    let replay = f.ack(&p, "acknowledge-key", json!({})).await;
    assert_eq!(replay.status, 201);
    assert!(replay.replay);
    assert_eq!(replay.raw, first.raw);
    let replay = f.execute(&p, "execute-key").await;
    assert_eq!(replay.raw, executed.raw);
    assert!(replay.replay);
    assert_eq!(
        f.ack(&p, "another-ack-key", json!({})).await.body["code"],
        "ALREADY_ACKNOWLEDGED"
    );
    f.app.pool.close().await;
    std::fs::remove_file(path).unwrap();
}
#[test]
fn configuration_errors_remain_strings_and_fail_closed() {
    for (network, origin, expected) in [
        ("invalid", ORIGIN, "Invalid NETWORK"),
        (
            "testnet",
            "http://localhost\nInjected: bad",
            "Invalid FRONTEND_ORIGIN",
        ),
    ] {
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_veilpay-backend"))
            .env("NETWORK", network)
            .env("FRONTEND_ORIGIN", origin)
            .output()
            .unwrap();
        assert!(!output.status.success());
        assert!(String::from_utf8_lossy(&output.stderr).contains(expected));
    }
}

#[tokio::test]
async fn invoice_amounts_expiry_and_mock_qr_are_exact() {
    let f = Fixture::new().await;
    for amount in [
        json!(1),
        json!(1.5),
        json!("0"),
        json!("01"),
        json!("-1"),
        json!("1.0"),
        json!("2100000000000001"),
    ] {
        let r = call(
            &f.router,
            "POST",
            "merchant/invoices",
            Some(&f.merchant),
            Some("invalid-invoice"),
            json!({"reference":"invoice","amountZat":amount}),
        )
        .await;
        assert_eq!(r.status, 400, "{amount}");
    }
    for extra in [
        json!({"reference":" ","amountZat":"1"}),
        json!({"reference":"invoice","amountZat":"1","expiresAt":"2000-01-01T00:00:00Z"}),
        json!({"reference":"invoice","amountZat":"1","expiresAt":null}),
    ] {
        assert_eq!(
            call(
                &f.router,
                "POST",
                "merchant/invoices",
                Some(&f.merchant),
                Some("bad-expiration"),
                extra
            )
            .await
            .status,
            400
        );
    }
    for amount in ["1", "2100000000000000"] {
        let i = f.invoice(amount).await;
        assert_eq!(i["amountZat"], amount);
        assert!(
            chrono::DateTime::parse_from_rfc3339(i["expiresAt"].as_str().unwrap()).unwrap()
                > chrono::Utc::now()
        );
        assert_eq!(i["paymentPayload"]["spendable"], false);
        assert_eq!(
            i["paymentPayload"]["uri"],
            format!(
                "veilpay-mock:{}?amountZat={amount}",
                i["id"].as_str().unwrap()
            )
        );
    }
}

#[tokio::test]
async fn invoice_detail_is_scoped_and_expiry_is_persisted() {
    let f = Fixture::new().await;
    let i = f.invoice("1").await;
    let j = f.invoice("1").await;
    assert_ne!(i["id"], j["id"]);
    let path = format!("merchant/invoices/{}", i["id"].as_str().unwrap());
    assert_eq!(
        call(&f.router, "GET", &path, Some(&f.customer), None, json!({}))
            .await
            .status,
        403
    );
    sqlx::query("UPDATE records SET body=json_set(body,'$.expiresAt','2000-01-01T00:00:00Z') WHERE kind='invoice' AND id=?").bind(i["id"].as_str().unwrap()).execute(&f.app.pool).await.unwrap();
    assert_eq!(
        call(&f.router, "GET", &path, Some(&f.merchant), None, json!({}))
            .await
            .body["status"],
        "expired"
    );
    let stored: String = sqlx::query_scalar(
        "SELECT json_extract(body,'$.status') FROM records WHERE kind='invoice' AND id=?",
    )
    .bind(i["id"].as_str().unwrap())
    .fetch_one(&f.app.pool)
    .await
    .unwrap();
    assert_eq!(stored, "expired");
    sqlx::query("UPDATE records SET owner='mer_other' WHERE kind='invoice' AND id=?")
        .bind(i["id"].as_str().unwrap())
        .execute(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(
        call(&f.router, "GET", &path, Some(&f.merchant), None, json!({}))
            .await
            .status,
        404
    );
    let listed = call(
        &f.router,
        "GET",
        "merchant/invoices",
        Some(&f.merchant),
        None,
        json!({}),
    )
    .await;
    assert_eq!(listed.body["items"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn concurrent_invoice_retries_create_one_invoice() {
    let f = Fixture::new().await;
    let body = json!({"reference":"retry","amountZat":"1"});
    let (a, b) = tokio::join!(
        call(
            &f.router,
            "POST",
            "merchant/invoices",
            Some(&f.merchant),
            Some("concurrent-invoice"),
            body.clone()
        ),
        call(
            &f.router,
            "POST",
            "merchant/invoices",
            Some(&f.merchant),
            Some("concurrent-invoice"),
            body.clone()
        )
    );
    assert_eq!(a.status, 201);
    assert_eq!(b.status, 201);
    assert_eq!(a.raw, b.raw);
    assert_ne!(a.replay, b.replay);
    let mismatch = call(
        &f.router,
        "POST",
        "merchant/invoices",
        Some(&f.merchant),
        Some("concurrent-invoice"),
        json!({"reference":"retry","amountZat":"2"}),
    )
    .await;
    assert_eq!(mismatch.status, 409);
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM records WHERE kind='invoice'")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
}

// Milestone 2: every adapter below is an in-memory fake; no wallet commands run.
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use veilpay_backend::wallet::{
    Network, SendIntent, WalletAdapter, WalletFuture, WalletOutcome, ZingoWallet,
};

struct FakeWallet {
    network: Option<Network>,
    submits: AtomicUsize,
    observations: AtomicUsize,
    outcome: Mutex<WalletOutcome>,
    block: bool,
    entered: tokio::sync::Notify,
}
impl FakeWallet {
    fn new(outcome: WalletOutcome) -> Self {
        Self {
            network: None,
            submits: AtomicUsize::new(0),
            observations: AtomicUsize::new(0),
            outcome: Mutex::new(outcome),
            block: false,
            entered: tokio::sync::Notify::new(),
        }
    }
}
impl WalletAdapter for FakeWallet {
    fn network(&self) -> Network {
        self.network.unwrap_or(Network::Testnet)
    }
    fn submit<'a>(&'a self, _: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async move {
            self.submits.fetch_add(1, Ordering::SeqCst);
            self.entered.notify_one();
            if self.block {
                std::future::pending::<()>().await;
            }
            self.outcome.lock().unwrap().clone()
        })
    }
    fn observe<'a>(&'a self, _: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async move {
            self.observations.fetch_add(1, Ordering::SeqCst);
            self.outcome.lock().unwrap().clone()
        })
    }
}

async fn adapter_fixture(adapter: Arc<dyn WalletAdapter>) -> (Fixture, String, std::path::PathBuf) {
    let path = std::env::temp_dir().join(format!("veilpay-execution-{}.db", uuid::Uuid::new_v4()));
    let url = format!("sqlite://{}", path.display());
    let mut f = Fixture::at(&url).await;
    f.app.pool.close().await;
    f.app = App::open_with_wallet(
        Config {
            database_url: url.clone(),
            frontend_origin: ORIGIN.into(),
            network: "testnet".into(),
        },
        Some(adapter),
    )
    .await
    .unwrap();
    f.router = f.app.clone().router();
    (f, url, path)
}
async fn executable_payment(f: &Fixture) -> (Value, Value) {
    let (a, p) = f.payment().await;
    // Synthetic fixture receiver, never a real address or wallet.
    sqlx::query("UPDATE records SET body=json_set(body,'$.payTo','fixture-only-receiver') WHERE kind='invoice'").execute(&f.app.pool).await.unwrap();
    (a, p)
}
async fn current_payment(f: &Fixture, p: &Value) -> Value {
    call(
        &f.router,
        "GET",
        &format!("payments/{}", p["id"].as_str().unwrap()),
        Some(&f.customer),
        None,
        json!({}),
    )
    .await
    .body
}
async fn cleanup_fixture(f: Fixture, path: std::path::PathBuf) {
    f.app.pool.close().await;
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn disabled_adapter_releases_once_and_does_not_fake_verification() {
    let (f, _, path) = adapter_fixture(Arc::new(ZingoWallet::new(Network::Testnet))).await;
    let (a, p) = f.payment().await;
    let first = f.execute(&p, "disabled-execute").await;
    assert_eq!(first.status, 202);
    assert_eq!(first.body["walletOperation"]["state"], "pending");
    let saved = current_payment(&f, &p).await;
    assert_eq!(saved["status"], "failed");
    assert_eq!(saved["walletOperation"]["state"], "failed_definitive");
    assert_eq!(saved["failure"]["code"], "WALLET_BROADCAST_DISABLED");
    assert!(saved["txid"].is_null());
    assert_eq!(f.usage(&a).await["reservedZat"], "0");
    assert_eq!(f.usage(&a).await["spentZat"], "0");
    assert_eq!(f.execute(&p, "disabled-execute").await.raw, first.raw);
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(f.usage(&a).await["reservedZat"], "0");
    let verification = call(
        &f.router,
        "GET",
        &format!("payments/{}/verification", p["id"].as_str().unwrap()),
        Some(&f.merchant),
        None,
        json!({}),
    )
    .await;
    assert_eq!(verification.status, 409);
    assert_eq!(verification.body["code"], "VERIFICATION_UNAVAILABLE");
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn unknown_holds_reservation_across_concurrent_retries_and_restart() {
    let adapter = Arc::new(FakeWallet::new(WalletOutcome::Unknown));
    let (mut f, url, path) = adapter_fixture(adapter.clone()).await;
    let (a, p) = executable_payment(&f).await;
    let (first, replay) = tokio::join!(
        f.execute(&p, "durable-execute"),
        f.execute(&p, "durable-execute")
    );
    assert_eq!(first.raw, replay.raw);
    assert_ne!(first.replay, replay.replay);
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 1);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    assert_eq!(
        current_payment(&f, &p).await["failure"]["code"],
        "OUTCOME_UNKNOWN"
    );
    sqlx::query("UPDATE wallet_operations SET created_at='2000-01-01T00:00:00Z'")
        .execute(&f.app.pool)
        .await
        .unwrap();
    f.app.pool.close().await;
    f.app = App::open_with_wallet(
        Config {
            database_url: url,
            frontend_origin: ORIGIN.into(),
            network: "testnet".into(),
        },
        Some(adapter.clone()),
    )
    .await
    .unwrap();
    f.router = f.app.clone().router();
    assert_eq!(
        current_payment(&f, &p).await["walletOperation"]["needsOperator"],
        true
    );
    assert_eq!(f.execute(&p, "durable-execute").await.raw, first.raw);
    f.execute(&p, "another-execute").await;
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 1);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM wallet_operations")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(count, 1);
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn reconciliation_requires_matching_txid_and_spends_reservation_once() {
    let txid = "a".repeat(64);
    let adapter = Arc::new(FakeWallet::new(WalletOutcome::Broadcast {
        txid: txid.clone(),
    }));
    let (f, _, path) = adapter_fixture(adapter.clone()).await;
    let (a, p) = executable_payment(&f).await;
    f.execute(&p, "broadcast-fixture").await;
    assert_eq!(
        current_payment(&f, &p).await["walletOperation"]["state"],
        "broadcast"
    );
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    *adapter.outcome.lock().unwrap() = WalletOutcome::Mined {
        txid: "b".repeat(64),
        confirmations: 4,
    };
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(
        current_payment(&f, &p).await["walletOperation"]["state"],
        "unknown"
    );
    assert_eq!(f.usage(&a).await["spentZat"], "0");
    *adapter.outcome.lock().unwrap() = WalletOutcome::Mined {
        txid: txid.clone(),
        confirmations: 0,
    };
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(f.usage(&a).await["spentZat"], "0");
    *adapter.outcome.lock().unwrap() = WalletOutcome::Mined {
        txid,
        confirmations: 1,
    };
    let (x, y) = tokio::join!(
        f.app.reconcile_wallet_operations(),
        f.app.reconcile_wallet_operations()
    );
    x.unwrap();
    y.unwrap();
    assert_eq!(f.usage(&a).await["spentZat"], "60");
    assert_eq!(f.usage(&a).await["reservedZat"], "0");
    assert_eq!(current_payment(&f, &p).await["status"], "confirmed");
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 1);
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn cancellation_after_claim_recovers_without_resubmission() {
    let adapter = Arc::new(FakeWallet {
        block: true,
        ..FakeWallet::new(WalletOutcome::Unknown)
    });
    let (mut f, url, path) = adapter_fixture(adapter.clone()).await;
    let (a, p) = executable_payment(&f).await;
    let router = f.router.clone();
    let session = f.customer.clone();
    let payment = p.clone();
    let task = tokio::spawn(async move {
        call(
            &router,
            "POST",
            &format!("payments/{}/execute", payment["id"].as_str().unwrap()),
            Some(&session),
            Some("cancelled-execute"),
            json!({}),
        )
        .await
    });
    tokio::time::timeout(
        std::time::Duration::from_secs(5),
        adapter.entered.notified(),
    )
    .await
    .unwrap();
    // A separate connection can read the claim while the adapter is blocked.
    let state: String = sqlx::query_scalar("SELECT state FROM wallet_operations")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert_eq!(state, "unknown");
    task.abort();
    let _ = task.await;
    f.app.pool.close().await;
    f.app = App::open_with_wallet(
        Config {
            database_url: url,
            frontend_origin: ORIGIN.into(),
            network: "testnet".into(),
        },
        Some(adapter.clone()),
    )
    .await
    .unwrap();
    f.router = f.app.clone().router();
    assert!(f.execute(&p, "cancelled-execute").await.replay);
    f.execute(&p, "cancelled-another").await;
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 1);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn wallet_and_database_networks_are_enforced_without_opening_wallets() {
    assert_ne!(
        ZingoWallet::new(Network::Testnet).network(),
        ZingoWallet::new(Network::Mainnet).network()
    );
    for network in [Network::Testnet, Network::Mainnet] {
        let wallet = ZingoWallet::new(network);
        let intent = SendIntent {
            expected_txid: None,
            operation_id: "op".into(),
            payment_id: "pay".into(),
            network,
            destination: "fixture".into(),
            amount_zat: 1,
        };
        assert_eq!(
            wallet.submit(&intent).await,
            WalletOutcome::BroadcastDisabled
        );
        assert_eq!(wallet.observe(&intent).await, WalletOutcome::Unknown);
    }
    let config = || Config {
        database_url: "sqlite::memory:".into(),
        frontend_origin: ORIGIN.into(),
        network: "mainnet".into(),
    };
    assert!(
        App::open_with_wallet(config(), Some(Arc::new(ZingoWallet::new(Network::Testnet))))
            .await
            .is_err()
    );
    assert!(App::open_with_wallet(config(), None).await.is_err());
    let adapter = Arc::new(FakeWallet::new(WalletOutcome::Unknown));
    let (f, url, path) = adapter_fixture(adapter).await;
    assert!(
        App::open_with_wallet(
            Config {
                database_url: url,
                frontend_origin: ORIGIN.into(),
                network: "mainnet".into()
            },
            Some(Arc::new(ZingoWallet::new(Network::Mainnet)))
        )
        .await
        .is_err()
    );
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn mainnet_gate_blocks_even_an_injected_adapter() {
    let adapter = Arc::new(FakeWallet {
        network: Some(Network::Mainnet),
        ..FakeWallet::new(WalletOutcome::Unknown)
    });
    let app = App::open_with_wallet(
        Config {
            database_url: "sqlite::memory:".into(),
            frontend_origin: ORIGIN.into(),
            network: "mainnet".into(),
        },
        Some(adapter.clone()),
    )
    .await
    .unwrap();
    // Test-only authenticated sessions; mainnet has no public demo login.
    for role in ["customer", "merchant"] {
        sqlx::query("INSERT INTO sessions VALUES(?,?,?,?)")
            .bind(role)
            .bind(role)
            .bind(role)
            .bind("2099-01-01T00:00:00Z")
            .execute(&app.pool)
            .await
            .unwrap();
    }
    let f = Fixture {
        router: app.clone().router(),
        app,
        customer: Session {
            cookie: "__Host-veilpay_session=customer".into(),
            csrf: "customer".into(),
        },
        merchant: Session {
            cookie: "__Host-veilpay_session=merchant".into(),
            csrf: "merchant".into(),
        },
    };
    let (a, p) = executable_payment(&f).await;
    f.execute(&p, "mainnet-execute").await;
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 0);
    assert_eq!(
        current_payment(&f, &p).await["failure"]["code"],
        "WALLET_BROADCAST_DISABLED"
    );
    assert_eq!(f.usage(&a).await["reservedZat"], "0");
    let health = call(&f.router, "GET", "health", None, None, json!({})).await;
    assert_eq!(health.body["mode"], "disabled");
    assert_eq!(health.body["wallet"], "broadcast_disabled");
}

#[tokio::test]
async fn distinct_payments_cannot_execute_the_same_unresolved_invoice() {
    let adapter = Arc::new(FakeWallet::new(WalletOutcome::Unknown));
    let (f, _, path) = adapter_fixture(adapter.clone()).await;
    let a = f.agent("100", "200").await;
    let i = f.invoice("60").await;
    let p = f.request(&a, &i, "60", "invoice-request-one").await.body;
    let q = f.request(&a, &i, "60", "invoice-request-two").await.body;
    sqlx::query("UPDATE records SET body=json_set(body,'$.payTo','fixture-only-receiver') WHERE kind='invoice'").execute(&f.app.pool).await.unwrap();
    assert_eq!(f.usage(&a).await["reservedZat"], "120");
    let (x, y) = tokio::join!(
        f.execute(&p, "invoice-execute-one"),
        f.execute(&q, "invoice-execute-two")
    );
    assert!((x.status == 202 && y.status == 409) || (x.status == 409 && y.status == 202));
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 1);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    assert_eq!(f.usage(&a).await["spentZat"], "0");
    let health = call(&f.router, "GET", "health", None, None, json!({})).await;
    assert_eq!(health.body["reconciler"]["unresolved"], 1);
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn startup_pending_operations_are_observed_and_never_dispatched() {
    let adapter = Arc::new(FakeWallet::new(WalletOutcome::Unknown));
    let (mut f, url, path) = adapter_fixture(adapter.clone()).await;
    let (a, p) = executable_payment(&f).await;
    f.execute(&p, "pending-execute").await;
    // Model the durable intent checkpoint before the dispatch claim.
    sqlx::query("UPDATE wallet_operations SET state='pending'")
        .execute(&f.app.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE records SET body=json_set(body,'$.walletOperation.state','pending') WHERE kind='payment'").execute(&f.app.pool).await.unwrap();
    adapter.submits.store(0, Ordering::SeqCst);
    f.app.pool.close().await;
    f.app = App::open_with_wallet(
        Config {
            database_url: url,
            frontend_origin: ORIGIN.into(),
            network: "testnet".into(),
        },
        Some(adapter.clone()),
    )
    .await
    .unwrap();
    f.router = f.app.clone().router();
    assert_eq!(
        current_payment(&f, &p).await["walletOperation"]["state"],
        "unknown"
    );
    f.execute(&p, "pending-new-key").await;
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 0);
    assert!(adapter.observations.load(Ordering::SeqCst) > 0);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn wallet_schema_upgrade_preserves_existing_mock_operations() {
    let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0001_initial.sql"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO wallet_operations VALUES('op','pay',1,'mock','final','mockref',NULL,'2026-01-01','2026-01-01')").execute(&pool).await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0003_wallet_lifecycle.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let row: (String, String, Option<String>) =
        sqlx::query_as("SELECT state,network,txid FROM wallet_operations WHERE id='op'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(row, ("final".into(), "legacy_mock".into(), None));
    assert!(
        sqlx::query("UPDATE wallet_operations SET attempt=2 WHERE id='op'")
            .execute(&pool)
            .await
            .is_err()
    );
    assert!(
        sqlx::query("UPDATE wallet_operations SET txid='fake' WHERE id='op'")
            .execute(&pool)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn adapter_deadline_is_unknown_and_holds_the_reservation() {
    let adapter = Arc::new(FakeWallet {
        block: true,
        ..FakeWallet::new(WalletOutcome::Unknown)
    });
    let (f, _, path) = adapter_fixture(adapter.clone()).await;
    let (a, p) = executable_payment(&f).await;
    let router = f.router.clone();
    let session = f.customer.clone();
    let payment = p.clone();
    let task = tokio::spawn(async move {
        call(
            &router,
            "POST",
            &format!("payments/{}/execute", payment["id"].as_str().unwrap()),
            Some(&session),
            Some("timeout-execute"),
            json!({}),
        )
        .await
    });
    adapter.entered.notified().await;
    tokio::time::pause();
    tokio::time::advance(std::time::Duration::from_secs(31)).await;
    tokio::time::resume();
    assert_eq!(task.await.unwrap().status, 202);
    assert_eq!(
        current_payment(&f, &p).await["failure"]["code"],
        "OUTCOME_UNKNOWN"
    );
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    f.execute(&p, "timeout-new-key").await;
    assert_eq!(adapter.submits.load(Ordering::SeqCst), 1);
    cleanup_fixture(f, path).await;
}

#[tokio::test]
async fn only_submission_can_release_a_definitive_pre_creation_rejection() {
    use veilpay_backend::wallet::PreCreationRejection;
    let adapter = Arc::new(FakeWallet::new(WalletOutcome::Unknown));
    let (f, _, path) = adapter_fixture(adapter.clone()).await;
    let (a, p) = executable_payment(&f).await;
    f.execute(&p, "uncertain-then-rejected").await;
    *adapter.outcome.lock().unwrap() =
        WalletOutcome::RejectedBeforeCreation(PreCreationRejection::InsufficientFunds);
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    assert_eq!(
        current_payment(&f, &p).await["failure"]["code"],
        "OUTCOME_UNKNOWN"
    );
    cleanup_fixture(f, path).await;
    for reason in [
        PreCreationRejection::InsufficientFunds,
        PreCreationRejection::InvalidDestination,
    ] {
        let adapter = Arc::new(FakeWallet::new(WalletOutcome::RejectedBeforeCreation(
            reason,
        )));
        let (f, _, path) = adapter_fixture(adapter.clone()).await;
        let (a, p) = executable_payment(&f).await;
        f.execute(&p, "definitive-execute").await;
        assert_eq!(
            current_payment(&f, &p).await["walletOperation"]["state"],
            "failed_definitive"
        );
        assert_eq!(
            current_payment(&f, &p).await["failure"]["code"],
            "REJECTED_BY_WALLET_PRE_BROADCAST"
        );
        assert_eq!(f.usage(&a).await["reservedZat"], "0");
        f.execute(&p, "definitive-execute-again").await;
        assert_eq!(adapter.submits.load(Ordering::SeqCst), 1);
        cleanup_fixture(f, path).await;
    }
}
