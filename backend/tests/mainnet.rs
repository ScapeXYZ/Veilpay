use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use serde_json::{Value, json};
use std::sync::Arc;
use tower::ServiceExt;
use veilpay_backend::{
    App, Config,
    wallet::{
        Network, ReadOnlySnapshot, SendIntent, WalletAdapter, WalletFuture, WalletOutcome,
        ZingoWallet,
    },
    zcash::{DataFuture, History, WalletError},
};

struct ViewingWallet {
    snapshot: Result<ReadOnlySnapshot, WalletError>,
}
impl WalletAdapter for ViewingWallet {
    fn network(&self) -> Network {
        Network::Mainnet
    }
    fn submit<'a>(&'a self, _: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async { WalletOutcome::BroadcastDisabled })
    }
    fn observe<'a>(&'a self, _: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async { WalletOutcome::Unknown })
    }
    fn read_only_snapshot(&self) -> DataFuture<'_, ReadOnlySnapshot> {
        Box::pin(async move { self.snapshot.clone() })
    }
}
fn history(height: u64) -> History {
    History::parse_for(Network::Mainnet,&json!({"veilpay_schema":1,"network":"mainnet","tip_height":height,"scanned_height":height,"received_outputs":[{"txid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","output_index":0,"address":"u1fixture","value":12,"datetime":1,"status":"confirmed","blockheight":height}],"transaction_summaries":[]})).unwrap()
}
fn wallet(sync: u64, chain: u64) -> Arc<dyn WalletAdapter> {
    Arc::new(ViewingWallet {
        snapshot: Ok(ReadOnlySnapshot {
            address: "u1fixture".into(),
            available_zat: 12,
            sync_height: sync,
            chain_height: chain,
            observations: history(sync),
        }),
    })
}
async fn response(app: App, token: &str) -> (u16, Value) {
    let r = app
        .router()
        .oneshot(
            Request::builder()
                .uri("/api/operator/mainnet/read-only")
                .header("x-veilpay-operator-token", token)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = r.status().as_u16();
    (
        status,
        serde_json::from_slice(&to_bytes(r.into_body(), usize::MAX).await.unwrap()).unwrap(),
    )
}
#[tokio::test]
async fn mainnet_read_only_requires_operator_token_and_labels_wallet_observations() {
    let app = App::open_with_wallet_and_operator_token(
        Config {
            database_url: "sqlite::memory:".into(),
            frontend_origin: "http://localhost:3000".into(),
            network: "mainnet".into(),
        },
        Some(wallet(100, 100)),
        Some("operator-test-token"),
    )
    .await
    .unwrap();
    let (unauthorized_status, unauthorized) = response(app.clone(), "wrong").await;
    assert_eq!(unauthorized_status, 401);
    assert_eq!(unauthorized["code"], "UNAUTHENTICATED");
    let (s, v) = response(app, "operator-test-token").await;
    assert_eq!(s, 200);
    assert_eq!(v.as_object().unwrap().len(), 6);
    assert_eq!(v["network"], "mainnet");
    assert_eq!(v["availableZat"], "12");
    assert_eq!(v["sync"]["walletReportedHeight"], 100);
    assert_eq!(v["sync"]["stale"], false);
    assert_eq!(v["chainEvidence"]["trusted"], false);
    assert!(v["chainEvidence"]["height"].is_null());
    assert_eq!(v["observations"][0]["confirmations"], 1);
}
#[tokio::test]
async fn stale_or_malformed_mainnet_wallet_data_fails_closed() {
    let stale = App::open_with_wallet_and_operator_token(
        Config {
            database_url: "sqlite::memory:".into(),
            frontend_origin: "http://localhost:3000".into(),
            network: "mainnet".into(),
        },
        Some(wallet(99, 100)),
        Some("t"),
    )
    .await
    .unwrap();
    let (stale_status, stale_error) = response(stale, "t").await;
    assert_eq!(stale_status, 503);
    assert_eq!(stale_error["code"], "WALLET_UNAVAILABLE");
    let bad = Arc::new(ViewingWallet {
        snapshot: Err(WalletError::InvalidOutput),
    });
    let app = App::open_with_wallet_and_operator_token(
        Config {
            database_url: "sqlite::memory:".into(),
            frontend_origin: "http://localhost:3000".into(),
            network: "mainnet".into(),
        },
        Some(bad),
        Some("t"),
    )
    .await
    .unwrap();
    let (bad_status, bad_error) = response(app, "t").await;
    assert_eq!(bad_status, 503);
    assert_eq!(bad_error["code"], "WALLET_UNAVAILABLE");
}
#[tokio::test]
async fn read_only_route_is_not_available_outside_mainnet() {
    let app = App::open_with_wallet_and_operator_token(
        Config {
            database_url: "sqlite::memory:".into(),
            frontend_origin: "http://localhost:3000".into(),
            network: "testnet".into(),
        },
        Some(Arc::new(ZingoWallet::new(Network::Testnet))),
        Some("operator-test-token"),
    )
    .await
    .unwrap();
    let (status, error) = response(app, "operator-test-token").await;
    assert_eq!(status, 404);
    assert_eq!(error["code"], "NOT_FOUND");
}
#[test]
fn mainnet_and_testnet_addresses_and_histories_do_not_mix() {
    let main = json!({"encoded_address":"u1fixture","has_orchard":true,"has_sapling":false,"has_transparent":false});
    assert!(veilpay_backend::zcash::orchard_address_for(Network::Mainnet, &main).is_ok());
    assert!(veilpay_backend::zcash::orchard_address_for(Network::Testnet, &main).is_err());
    let raw = json!({"veilpay_schema":1,"network":"mainnet","tip_height":1,"scanned_height":1,"received_outputs":[],"transaction_summaries":[]});
    assert!(History::parse_for(Network::Mainnet, &raw).is_ok());
    assert!(History::parse_for(Network::Testnet, &raw).is_err());
}
