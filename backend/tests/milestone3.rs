//! All wallet responses are synthetic public-schema fixtures. No real CLI/wallet is invoked.
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use tower::ServiceExt;
use veilpay_backend::{
    App, Config,
    manual::{prepare_challenge, submit_challenge},
    transport::{CliRunner, Operation, Role, TestnetTransport},
    wallet::{CliWallet, Network, SendIntent, WalletAdapter, WalletOutcome},
    zcash::{self, DataFuture, History, WalletError},
};
const ORIGIN: &str = "http://localhost:3000";
fn fixture() -> Value {
    serde_json::from_str(include_str!("fixtures/zingo-m3.json")).unwrap()
}
struct FakeCli {
    ambiguous_submit: AtomicBool,
    merchant: Mutex<Value>,
    customer: Mutex<Value>,
    prepares: AtomicUsize,
    submits: AtomicUsize,
    fail: Mutex<bool>,
}
impl FakeCli {
    fn new() -> Self {
        let v = fixture();
        Self {
            ambiguous_submit: AtomicBool::new(false),
            merchant: Mutex::new(v["history"].clone()),
            customer: Mutex::new(v["history"].clone()),
            prepares: AtomicUsize::new(0),
            submits: AtomicUsize::new(0),
            fail: Mutex::new(false),
        }
    }
}
impl CliRunner for FakeCli {
    fn run<'a>(&'a self, role: Role, operation: Operation) -> DataFuture<'a, Value> {
        Box::pin(async move {
            if *self.fail.lock().unwrap() {
                return Err(WalletError::Unavailable);
            }
            Ok(match operation {
                Operation::Address => fixture()["address"].clone(),
                Operation::Balance => fixture()["balance"].clone(),
                Operation::SyncHistory => match role {
                    Role::Merchant => self.merchant.lock().unwrap().clone(),
                    Role::Customer => self.customer.lock().unwrap().clone(),
                },
                Operation::Prepare { .. } => {
                    self.prepares.fetch_add(1, Ordering::SeqCst);
                    json!({"txids":["a".repeat(64)],"fee":1000})
                }
                Operation::Transmit { txid } => {
                    self.submits.fetch_add(1, Ordering::SeqCst);
                    if self.ambiguous_submit.load(Ordering::SeqCst) {
                        return Err(WalletError::Unavailable);
                    }
                    json!({"txids":[txid]})
                }
            })
        })
    }
}
#[derive(Clone)]
struct Session {
    cookie: String,
    csrf: String,
}
async fn call(
    router: &Router,
    method: &str,
    path: &str,
    s: Option<&Session>,
    key: Option<&str>,
    body: Value,
) -> (u16, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(format!("/api/{path}"))
        .header("origin", ORIGIN)
        .header("content-type", "application/json");
    if let Some(s) = s {
        req = req
            .header("cookie", &s.cookie)
            .header("x-csrf-token", &s.csrf);
    }
    if let Some(k) = key {
        req = req.header("idempotency-key", k);
    }
    let r = router
        .clone()
        .oneshot(req.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap();
    let status = r.status().as_u16();
    let raw = to_bytes(r.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&raw).unwrap())
}
struct F {
    app: App,
    router: Router,
    merchant: Session,
    customer: Session,
    cli: Arc<FakeCli>,
}
impl F {
    async fn new() -> Self {
        let cli = Arc::new(FakeCli::new());
        let transport = TestnetTransport::with_runner(cli.clone());
        let app = App::open_with_wallet(
            Config {
                database_url: "sqlite::memory:".into(),
                frontend_origin: ORIGIN.into(),
                network: "testnet".into(),
            },
            Some(Arc::new(CliWallet::new(transport))),
        )
        .await
        .unwrap();
        let router = app.clone().router();
        let mut sessions = Vec::new();
        for role in ["customer", "merchant"] {
            let r = router
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/api/session/demo")
                        .header("origin", ORIGIN)
                        .body(Body::from(json!({"context":role}).to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            let cookie = r.headers()["set-cookie"]
                .to_str()
                .unwrap()
                .split(';')
                .next()
                .unwrap()
                .to_owned();
            let v: Value =
                serde_json::from_slice(&to_bytes(r.into_body(), usize::MAX).await.unwrap())
                    .unwrap();
            sessions.push(Session {
                cookie,
                csrf: v["csrfToken"].as_str().unwrap().into(),
            });
        }
        Self {
            app,
            router,
            merchant: sessions.remove(1),
            customer: sessions.remove(0),
            cli,
        }
    }
    async fn payment(&self) -> (Value, Value, Value) {
        let (status,a)=call(&self.router,"POST","agents",Some(&self.customer),Some("agent-create"),json!({"name":"Agent","policy":{"perTxLimitZat":"100","totalBudgetZat":"100","allowedMerchantIds":["mer_demo"],"requestTtlSeconds":900}})).await;
        assert_eq!(status, 201);
        let (status, i) = call(
            &self.router,
            "POST",
            "merchant/invoices",
            Some(&self.merchant),
            Some("invoice-create"),
            json!({"reference":"invoice","amountZat":"60"}),
        )
        .await;
        assert_eq!(status, 201, "{i}");
        let (status, p) = call(
            &self.router,
            "POST",
            "payments/request",
            Some(&self.customer),
            Some("request-create"),
            json!({"agentId":a["id"],"invoiceId":i["id"],"amountZat":"60","reference":"payment"}),
        )
        .await;
        assert_eq!(status, 201);
        (a, i, p)
    }
    async fn execute(&self, p: &Value, key: &str) -> (u16, Value) {
        call(
            &self.router,
            "POST",
            &format!("payments/{}/execute", p["id"].as_str().unwrap()),
            Some(&self.customer),
            Some(key),
            json!({}),
        )
        .await
    }
    async fn verify(&self, p: &Value) -> (u16, Value) {
        call(
            &self.router,
            "GET",
            &format!("payments/{}/verification", p["id"].as_str().unwrap()),
            Some(&self.merchant),
            None,
            json!({}),
        )
        .await
    }
    async fn usage(&self, a: &Value) -> Value {
        call(
            &self.router,
            "GET",
            &format!("agents/{}", a["id"].as_str().unwrap()),
            Some(&self.customer),
            None,
            json!({}),
        )
        .await
        .1["usage"]
            .clone()
    }
    async fn prepare(&self, p: &Value) {
        let pid = p["id"].as_str().unwrap();
        let review = self.app.testnet_operation_review(pid).await.unwrap();
        self.app
            .manual_testnet_prepare(pid, 1000, &prepare_challenge(&review, 1000))
            .await
            .unwrap();
    }
}
fn invoice() -> Value {
    json!({"id":"inv_fixture","network":"testnet","payTo":"utest1fixture","amountZat":"60","expiresAt":"2030-01-01T00:00:00Z"})
}

#[test]
fn strict_cli_schema_parsers_reject_incomplete_float_and_wrong_network_outputs() {
    let f = fixture();
    assert_eq!(
        zcash::orchard_address(&f["address"]).unwrap(),
        "utest1fixture"
    );
    assert_eq!(
        History::parse(&f["history"]).unwrap().received[0].amount_zat,
        60
    );
    for (field, value) in [
        ("network", json!("mainnet")),
        ("scanned_height", json!(1)),
        ("veilpay_schema", json!(2)),
    ] {
        let mut h = f["history"].clone();
        h[field] = value;
        assert!(History::parse(&h).is_err());
    }
    let mut h = f["history"].clone();
    h["received_outputs"][0]["value"] = json!(60.5);
    assert!(History::parse(&h).is_err());
    let mut a = f["address"].clone();
    a["has_transparent"] = json!(true);
    assert!(zcash::orchard_address(&a).is_err());
    assert!(zcash::prepared_ids(&json!({"txids":["a".repeat(64),"b".repeat(64)]})).is_err());
    assert!(zcash::check_server(&json!({"chain_name":"main","latest_block_height":5})).is_err());
}
#[test]
fn independent_matching_handles_pending_expired_underpaid_duplicate_and_conflicts() {
    let raw = fixture()["history"].clone();
    let inv = invoice();
    let expected = "a".repeat(64);
    let receipt = zcash::match_invoice(
        &History::parse(&raw).unwrap(),
        &inv,
        Some(&expected),
        3,
        None,
        1,
    )
    .unwrap();
    assert_eq!(receipt["state"], "received");
    let mut h = raw.clone();
    h["received_outputs"][0]["status"] = json!("mempool");
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            1
        )
        .unwrap()["state"],
        "pending"
    );
    let mut h = raw.clone();
    h["received_outputs"][0]["value"] = json!(59);
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            1
        )
        .unwrap()["state"],
        "underpaid"
    );
    let mut h = raw.clone();
    h["received_outputs"][0]["value"] = json!(61);
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            1
        )
        .unwrap()["state"],
        "amount_mismatch"
    );
    let mut h = raw.clone();
    let copy = h["received_outputs"][0].clone();
    h["received_outputs"].as_array_mut().unwrap().push(copy);
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            1
        )
        .unwrap()["receivedZat"],
        "60"
    );
    h["received_outputs"][1]["value"] = json!(1);
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            1
        )
        .unwrap()["state"],
        "conflicting"
    );
    h["received_outputs"][1]["txid"] = json!("b".repeat(64));
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            1
        )
        .unwrap()["state"],
        "duplicate"
    );
    let mut h = raw.clone();
    h["received_outputs"] = json!([]);
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            2_000_000_000
        )
        .unwrap()["state"],
        "expired"
    );
    let mut inv = inv.clone();
    inv["expiresAt"] = json!("2020-01-01T00:00:00Z");
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&raw).unwrap(),
            &inv,
            Some(&expected),
            3,
            None,
            2_000_000_000
        )
        .unwrap()["state"],
        "late"
    );
    assert_eq!(
        zcash::match_invoice(
            &History::parse(&raw).unwrap(),
            &invoice(),
            Some(&"b".repeat(64)),
            3,
            None,
            1
        )
        .unwrap()["state"],
        "conflicting"
    );
}
#[test]
fn missing_or_moved_receipt_and_depth_rollback_are_reorg_related() {
    let raw = fixture()["history"].clone();
    let id = "a".repeat(64);
    let inv = invoice();
    let previous =
        zcash::match_invoice(&History::parse(&raw).unwrap(), &inv, Some(&id), 3, None, 1).unwrap();
    for mode in ["missing", "height", "depth"] {
        let mut h = raw.clone();
        match mode {
            "missing" => h["received_outputs"] = json!([]),
            "height" => h["received_outputs"][0]["blockheight"] = json!(4533999),
            _ => {
                h["tip_height"] = json!(4534000);
                h["scanned_height"] = json!(4534000);
            }
        }
        let r = zcash::match_invoice(
            &History::parse(&h).unwrap(),
            &inv,
            Some(&id),
            3,
            Some(&previous),
            1,
        )
        .unwrap();
        assert_eq!(r["state"], "reorged");
        assert_eq!(r["acknowledgmentValid"], false);
    }
}
#[tokio::test]
async fn transport_balance_and_sender_observation_use_structured_fixture_evidence() {
    let cli = Arc::new(FakeCli::new());
    let transport = TestnetTransport::with_runner(cli.clone());
    assert_eq!(
        transport.balance(Role::Customer).await.unwrap()["total_orchard_balance"],
        "100000"
    );
    let wallet = CliWallet::new(transport);
    let mut intent = SendIntent {
        operation_id: "op".into(),
        payment_id: "pay".into(),
        network: Network::Testnet,
        destination: "utest1fixture".into(),
        amount_zat: 60,
        expected_txid: Some("a".repeat(64)),
    };
    assert_eq!(
        wallet.observe(&intent).await,
        WalletOutcome::Mined {
            txid: "a".repeat(64),
            confirmations: 3
        }
    );
    intent.network = Network::Mainnet;
    assert_eq!(wallet.observe(&intent).await, WalletOutcome::Unknown);
    intent.network = Network::Testnet;
    intent.expected_txid = None;
    assert_eq!(wallet.observe(&intent).await, WalletOutcome::Unknown);
    *cli.fail.lock().unwrap() = true;
    assert!(wallet.receiving_address().await.is_err());
    assert_eq!(
        wallet.submit(&intent).await,
        WalletOutcome::BroadcastDisabled
    );
    assert_eq!(cli.submits.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn real_invoice_qr_and_manual_gates_preserve_exact_idempotent_state() {
    let f = F::new().await;
    let (a, i, p) = f.payment().await;
    assert_eq!(
        i["paymentPayload"]["uri"],
        "zcash:utest1fixture?amount=0.00000060"
    );
    assert_eq!(i["paymentPayload"]["spendable"], true);
    let (status, first) = f.execute(&p, "execute-manual").await;
    assert_eq!(status, 202);
    assert_eq!(
        first["walletOperation"]["requiresOperatorConfirmation"],
        true
    );
    let pid = p["id"].as_str().unwrap();
    assert!(
        f.app
            .manual_testnet_prepare(pid, 1000, "wrong")
            .await
            .is_err()
    );
    assert_eq!(f.cli.prepares.load(Ordering::SeqCst), 0);
    f.prepare(&p).await;
    assert_eq!(f.cli.prepares.load(Ordering::SeqCst), 1);
    let review = f.app.testnet_operation_review(pid).await.unwrap();
    assert!(
        f.app
            .manual_testnet_prepare(pid, 1000, &prepare_challenge(&review, 1000))
            .await
            .is_err()
    );
    assert!(f.app.manual_testnet_submit(pid, "wrong").await.is_err());
    assert_eq!(f.cli.submits.load(Ordering::SeqCst), 0);
    let confirmation = submit_challenge(&review);
    let (x, y) = tokio::join!(
        f.app.manual_testnet_submit(pid, &confirmation),
        f.app.manual_testnet_submit(pid, &confirmation)
    );
    assert_ne!(x.is_ok(), y.is_ok());
    assert_eq!(f.cli.submits.load(Ordering::SeqCst), 1);
    assert_eq!(f.execute(&p, "execute-manual").await.1, first);
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(f.usage(&a).await["spentZat"], "60");
    let (_, receipt) = f.verify(&p).await;
    assert_eq!(receipt["state"], "received");
    assert_eq!(receipt["method"], "merchant_wallet_scan");
    let path = format!("payments/{pid}/acknowledgment");
    let (status, ack) = call(
        &f.router,
        "POST",
        &path,
        Some(&f.merchant),
        Some("acknowledge-real"),
        json!({}),
    )
    .await;
    assert_eq!(status, 201);
    assert!(!ack["signature"].as_str().unwrap().starts_with("mock:"));
    f.cli.merchant.lock().unwrap()["received_outputs"] = json!([]);
    let (_, receipt) = f.verify(&p).await;
    assert_eq!(receipt["state"], "reorged");
    assert_eq!(receipt["acknowledgmentValid"], false);
    let stored: String = sqlx::query_scalar("SELECT body FROM records WHERE kind='acknowledgment'")
        .fetch_one(&f.app.pool)
        .await
        .unwrap();
    assert!(serde_json::from_str::<Value>(&stored).unwrap()["invalidatedAt"].is_string());
}
#[tokio::test]
async fn sender_confirmation_never_substitutes_for_merchant_receipt_and_reorg_reholds_budget() {
    let f = F::new().await;
    let (a, _, p) = f.payment().await;
    f.execute(&p, "sender-execute").await;
    f.prepare(&p).await;
    f.cli.merchant.lock().unwrap()["received_outputs"] = json!([]);
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(f.usage(&a).await["spentZat"], "60");
    assert_ne!(f.verify(&p).await.1["state"], "received");
    f.cli.customer.lock().unwrap()["transaction_summaries"][0]["status"] = json!("mempool");
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(f.usage(&a).await["spentZat"], "0");
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    f.app.reconcile_wallet_operations().await.unwrap();
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    assert_eq!(f.cli.submits.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn wallet_failure_keeps_reservation_and_refuses_receipt_acknowledgment() {
    let f = F::new().await;
    let (a, _, p) = f.payment().await;
    f.execute(&p, "failure-execute").await;
    *f.cli.fail.lock().unwrap() = true;
    let pid = p["id"].as_str().unwrap();
    let review = f.app.testnet_operation_review(pid).await.unwrap();
    assert!(
        f.app
            .manual_testnet_prepare(pid, 1000, &prepare_challenge(&review, 1000))
            .await
            .is_err()
    );
    *f.cli.fail.lock().unwrap() = false;
    assert!(
        f.app
            .manual_testnet_prepare(pid, 1000, &prepare_challenge(&review, 1000))
            .await
            .is_err()
    );
    assert_eq!(f.cli.prepares.load(Ordering::SeqCst), 0);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    *f.cli.fail.lock().unwrap() = true;
    assert_eq!(f.verify(&p).await.0, 503);
    assert_eq!(
        call(
            &f.router,
            "POST",
            &format!("payments/{pid}/acknowledgment"),
            Some(&f.merchant),
            Some("failed-ack"),
            json!({})
        )
        .await
        .0,
        503
    );
}

struct ProcessFixture {
    root: std::path::PathBuf,
}
impl ProcessFixture {
    fn new() -> Self {
        use sha2::{Digest, Sha256};
        use std::{fs, os::unix::fs::PermissionsExt};
        let root =
            std::env::temp_dir().join(format!("veilpay-process-fixture-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        for role in ["customer", "merchant"] {
            fs::create_dir(root.join(role)).unwrap();
            fs::write(
                root.join(role).join("zingo-wallet.dat"),
                b"SYNTHETIC FIXTURE; NOT A WALLET",
            )
            .unwrap();
            fs::set_permissions(
                root.join(role).join("zingo-wallet.dat"),
                fs::Permissions::from_mode(0o600),
            )
            .unwrap();
        }
        fs::create_dir(root.join("bin")).unwrap();
        fs::write(
            root.join("bin/zingo-cli"),
            include_bytes!("fixtures/fake-zingo.py"),
        )
        .unwrap();
        fs::set_permissions(
            root.join("bin/zingo-cli"),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        fs::write(
            root.join("bin/nym-proxy"),
            b"not executable; fixture never invokes a proxy",
        )
        .unwrap();
        fs::write(
            root.join("fixture.json"),
            include_bytes!("fixtures/zingo-m3.json"),
        )
        .unwrap();
        fs::write(
            root.join("source-revision"),
            veilpay_backend::transport::PIN,
        )
        .unwrap();
        fs::write(
            root.join("source-patch-checksum"),
            format!(
                "{:x}",
                Sha256::digest(include_bytes!("../../scripts/patches/zingo-waitsync.patch"))
            ),
        )
        .unwrap();
        fs::write(
            root.join("transport-patch-checksum"),
            format!(
                "{:x}",
                Sha256::digest(include_bytes!(
                    "../../scripts/patches/zingo-structured-transport.patch"
                ))
            ),
        )
        .unwrap();
        let checks = ["zingo-cli", "nym-proxy"]
            .into_iter()
            .map(|name| {
                let path = root.join("bin").join(name);
                format!(
                    "{:x}  {}\n",
                    Sha256::digest(fs::read(&path).unwrap()),
                    path.display()
                )
            })
            .collect::<String>();
        fs::write(root.join("binary-checksums"), checks).unwrap();
        Self { root }
    }
}
impl Drop for ProcessFixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
#[tokio::test]
async fn actual_process_boundary_uses_verified_flags_and_never_signs_above_fee_limit() {
    let f = ProcessFixture::new();
    let t = TestnetTransport::from_root(f.root.clone());
    assert_eq!(t.address().await.unwrap(), "utest1fixture");
    assert_eq!(
        t.balance(Role::Merchant).await.unwrap()["confirmed_orchard_balance"],
        "100000"
    );
    assert_eq!(t.history(Role::Merchant).await.unwrap().tip, 4534002);
    let intent = SendIntent {
        operation_id: "fixture-op".into(),
        payment_id: "fixture-pay".into(),
        network: Network::Testnet,
        destination: "utest1fixture".into(),
        amount_zat: 60,
        expected_txid: None,
    };
    assert_eq!(
        t.prepare(&intent, 999).await.unwrap_err(),
        WalletError::FeeLimit
    );
    assert_eq!(
        std::fs::read_to_string(f.root.join("steps.txt")).unwrap(),
        "send\n"
    );
    let (id, fee) = t.prepare(&intent, 1000).await.unwrap();
    assert_eq!(fee, 1000);
    assert_eq!(id, "a".repeat(64));
    assert_eq!(
        std::fs::read_to_string(f.root.join("steps.txt")).unwrap(),
        "send\nsend\ncalculate\nquit\n"
    );
    assert_eq!(t.transmit(&id).await.unwrap(), id);
    let calls = std::fs::read_to_string(f.root.join("calls.jsonl")).unwrap();
    for line in calls.lines() {
        let call: Value = serde_json::from_str(line).unwrap();
        assert_eq!(call["seedPresent"], false);
        assert!(!call["args"].as_array().unwrap().contains(&json!("mainnet")));
    }
    std::fs::write(f.root.join("wrong-network"), b"fixture").unwrap();
    assert!(t.transmit(&id).await.is_err());
    let calls = std::fs::read_to_string(f.root.join("calls.jsonl")).unwrap();
    assert_eq!(calls.lines().filter(|l| l.contains("transmit")).count(), 1);
}
#[tokio::test]
async fn process_boundary_refuses_missing_wallet_modified_binary_and_concurrent_wallet_use() {
    let f = ProcessFixture::new();
    let t = TestnetTransport::from_root(f.root.clone());
    let lock = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(f.root.join("sync.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    assert_eq!(t.address().await.unwrap_err(), WalletError::Busy);
    drop(lock);
    std::fs::remove_file(f.root.join("merchant/zingo-wallet.dat")).unwrap();
    assert_eq!(t.address().await.unwrap_err(), WalletError::Configuration);
    std::fs::write(f.root.join("bin/zingo-cli"), b"MODIFIED FIXTURE").unwrap();
    assert_eq!(
        t.balance(Role::Customer).await.unwrap_err(),
        WalletError::Configuration
    );
    assert!(!f.root.join("calls.jsonl").exists());
}

#[tokio::test]
async fn ambiguous_submission_is_claimed_once_and_never_retried() {
    let f = F::new().await;
    let (a, _, p) = f.payment().await;
    f.execute(&p, "ambiguous-execute").await;
    f.prepare(&p).await;
    f.cli.ambiguous_submit.store(true, Ordering::SeqCst);
    let pid = p["id"].as_str().unwrap();
    let review = f.app.testnet_operation_review(pid).await.unwrap();
    let result = f
        .app
        .manual_testnet_submit(pid, &submit_challenge(&review))
        .await
        .unwrap();
    assert_eq!(result["state"], "unknown");
    assert_eq!(result["phase"], "observing");
    assert!(
        f.app
            .manual_testnet_submit(pid, &submit_challenge(&review))
            .await
            .is_err()
    );
    f.execute(&p, "ambiguous-other-key").await;
    assert_eq!(f.cli.submits.load(Ordering::SeqCst), 1);
    assert_eq!(f.usage(&a).await["reservedZat"], "60");
    assert_eq!(f.usage(&a).await["spentZat"], "0");
}
#[tokio::test]
async fn manual_prepare_and_submit_recheck_current_policy_before_wallet_work() {
    let f = F::new().await;
    let (a, _, p) = f.payment().await;
    f.execute(&p, "policy-execute").await;
    let agent_path = format!("agents/{}", a["id"].as_str().unwrap());
    assert_eq!(
        call(
            &f.router,
            "PATCH",
            &agent_path,
            Some(&f.customer),
            None,
            json!({"status":"paused"})
        )
        .await
        .0,
        200
    );
    let pid = p["id"].as_str().unwrap();
    let review = f.app.testnet_operation_review(pid).await.unwrap();
    assert!(
        f.app
            .manual_testnet_prepare(pid, 1000, &prepare_challenge(&review, 1000))
            .await
            .is_err()
    );
    assert_eq!(f.cli.prepares.load(Ordering::SeqCst), 0);
    call(
        &f.router,
        "PATCH",
        &agent_path,
        Some(&f.customer),
        None,
        json!({"status":"active"}),
    )
    .await;
    f.prepare(&p).await;
    call(
        &f.router,
        "PATCH",
        &agent_path,
        Some(&f.customer),
        None,
        json!({"status":"paused"}),
    )
    .await;
    let review = f.app.testnet_operation_review(pid).await.unwrap();
    assert!(
        f.app
            .manual_testnet_submit(pid, &submit_challenge(&review))
            .await
            .is_err()
    );
    assert_eq!(f.cli.submits.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn incomplete_merchant_sync_never_marks_an_invoice_paid() {
    let f = F::new().await;
    let (_, i, p) = f.payment().await;
    f.execute(&p, "incomplete-execute").await;
    f.prepare(&p).await;
    f.cli.merchant.lock().unwrap()["scanned_height"] = json!(1);
    assert_eq!(f.verify(&p).await.0, 503);
    let result = call(
        &f.router,
        "GET",
        &format!("merchant/invoices/{}", i["id"].as_str().unwrap()),
        Some(&f.merchant),
        None,
        json!({}),
    )
    .await;
    assert_eq!(result.1["status"], "open");
}

#[tokio::test]
async fn signed_output_inspection_refuses_extra_recipients_before_submission() {
    let f = ProcessFixture::new();
    let mut v = fixture();
    v["history"]["transaction_summaries"][0]["outgoing_orchard_notes"].as_array_mut().unwrap().push(json!({"value":1,"recipient":"utest1unexpected","recipient_unified_address":"utest1unexpected","scope":"external"}));
    std::fs::write(f.root.join("fixture.json"), v.to_string()).unwrap();
    let t = TestnetTransport::from_root(f.root.clone());
    let intent = SendIntent {
        operation_id: "fixture-op".into(),
        payment_id: "fixture-pay".into(),
        network: Network::Testnet,
        destination: "utest1fixture".into(),
        amount_zat: 60,
        expected_txid: None,
    };
    assert_eq!(
        t.prepare(&intent, 1000).await.unwrap_err(),
        WalletError::Unsupported
    );
    let calls = std::fs::read_to_string(f.root.join("calls.jsonl")).unwrap();
    assert!(!calls.contains("transmit"));
}
#[test]
fn operator_binary_refuses_mainnet_before_opening_a_database_or_wallet() {
    let f = ProcessFixture::new();
    let db = f.root.join("must-not-exist.db");
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_veilpay-testnet"))
        .env_clear()
        .env("NETWORK", "mainnet")
        .env("WALLET_BACKEND", "zingo-cli")
        .env("DATABASE_URL", format!("sqlite://{}", db.display()))
        .args(["submit", "pay_fixture"])
        .output()
        .unwrap();
    assert!(!result.status.success());
    assert!(!db.exists());
    assert!(!f.root.join("calls.jsonl").exists());
}
