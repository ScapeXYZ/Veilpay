mod execution;
pub mod manual;
mod merchant;
pub mod transport;
pub mod wallet;
pub mod zcash;
use axum::{
    Router,
    body::Bytes,
    extract::{ConnectInfo, Extension, OriginalUri, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
};
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{
    Row, SqliteConnection, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
};
use std::sync::Arc;
use std::{net::SocketAddr, str::FromStr, time::Duration as StdDuration};
use tower_http::cors::CorsLayer;
use wallet::{CliWallet, Network, SendIntent, WalletAdapter, WalletOutcome, ZingoWallet};

#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub frontend_origin: String,
    pub network: String,
}
impl Config {
    pub fn from_env() -> std::result::Result<Self, String> {
        let c = Self {
            // Never reuse the historical demo database for a mainnet process.
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or("sqlite://veilpay-mainnet.db".into()),
            frontend_origin: std::env::var("FRONTEND_ORIGIN")
                .unwrap_or("http://localhost:3100".into()),
            network: std::env::var("NETWORK").unwrap_or("mainnet".into()),
        };
        if !["testnet", "regtest", "mainnet"].contains(&c.network.as_str()) {
            return Err("Invalid NETWORK".into());
        }
        c.frontend_origin
            .parse::<axum::http::HeaderValue>()
            .map_err(|_| "Invalid FRONTEND_ORIGIN".to_owned())?;
        Ok(c)
    }
}
#[derive(Clone)]
pub struct App {
    pub pool: SqlitePool,
    config: Config,
    wallet: Option<Arc<dyn WalletAdapter>>,
    operator_read_token_hash: Option<[u8; 32]>,
    // Only the loopback regtest/mock browser harness may raise this from the
    // production-safe default. It prevents one serialized test suite from
    // exhausting its own shared fixture IP budget.
    demo_session_rate_limit: i64,
}
type Result<T> = std::result::Result<T, ApiError>;
#[derive(Debug)]
struct ApiError(u16, &'static str);
impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("database error: {e}");
        Self(500, "INTERNAL")
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        reply(
            self.0,
            &json!({"code":self.1,"message":self.1.replace('_'," ")}),
            false,
        )
    }
}
fn reply(status: u16, body: &Value, replay: bool) -> Response {
    let mut r = (
        StatusCode::from_u16(status).unwrap(),
        [("content-type", "application/json")],
        body.to_string(),
    )
        .into_response();
    r.headers_mut()
        .insert("cache-control", "no-store".parse().unwrap());
    if replay {
        r.headers_mut()
            .insert("Idempotent-Replay", "true".parse().unwrap());
    }
    r
}
fn now() -> String {
    Utc::now().to_rfc3339()
}
fn id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}
fn session_token() -> String {
    // 256 bits of browser-held entropy. The database holds only its SHA-256
    // digest, never this bearer credential.
    format!("ses_{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple())
}
fn token_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}
fn invalid() -> ApiError {
    ApiError(400, "VALIDATION_FAILED")
}
fn text<'a>(v: &'a Value, k: &str, max: usize) -> Result<&'a str> {
    let s = v[k].as_str().ok_or_else(invalid)?;
    if s.chars().count() > max {
        return Err(invalid());
    }
    Ok(s)
}
fn zat(v: &Value, k: &str) -> Result<i64> {
    let s = text(v, k, 16)?;
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) || (s.len() > 1 && s.starts_with('0'))
    {
        return Err(invalid());
    }
    s.parse().map_err(|_| invalid())
}
fn date(s: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.with_timezone(&Utc))
        .map_err(|_| invalid())
}
fn policy(v: &Value, version: i64) -> Result<Value> {
    zat(v, "perTxLimitZat")?;
    zat(v, "totalBudgetZat")?;
    let a = v["allowedMerchantIds"].as_array().ok_or_else(invalid)?;
    if a.is_empty() || a.iter().any(|x| !x.is_string()) {
        return Err(invalid());
    }
    let ttl = v
        .get("requestTtlSeconds")
        .map(|x| x.as_i64().ok_or_else(invalid))
        .transpose()?
        .unwrap_or(900);
    if !(30..=86400).contains(&ttl) {
        return Err(invalid());
    }
    let expires = v
        .get("expiresAt")
        .map(|x| date(x.as_str().ok_or_else(invalid)?))
        .transpose()?;
    // A policy that is already expired could look valid in a browser while
    // silently rejecting every request. Refuse it at write time instead.
    if expires.is_some_and(|expiry| expiry <= Utc::now()) {
        return Err(invalid());
    }
    let mut out = json!({"perTxLimitZat":v["perTxLimitZat"],"totalBudgetZat":v["totalBudgetZat"],"allowedMerchantIds":a,"requestTtlSeconds":ttl,"version":version,"updatedAt":now()});
    // Optional contract fields are absent when unset. Returning JSON null here
    // would make a strict client mistake a valid policy for a malformed one.
    if let Some(expiry) = expires {
        out["expiresAt"] = json!(expiry.to_rfc3339());
    }
    Ok(out)
}
async fn get(c: &mut SqliteConnection, kind: &str, key: &str) -> Result<(String, Value)> {
    let r = sqlx::query("SELECT owner,body FROM records WHERE kind=? AND id=?")
        .bind(kind)
        .bind(key)
        .fetch_optional(c)
        .await?
        .ok_or(ApiError(404, "NOT_FOUND"))?;
    Ok((
        r.get(0),
        serde_json::from_str(r.get(1)).map_err(|_| ApiError(500, "INTERNAL"))?,
    ))
}
async fn put(
    c: &mut SqliteConnection,
    kind: &str,
    key: &str,
    owner: &str,
    v: &Value,
) -> Result<()> {
    sqlx::query("INSERT INTO records(kind,id,owner,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").bind(kind).bind(key).bind(owner).bind(v.to_string()).execute(c).await?;
    Ok(())
}
async fn owned(c: &mut SqliteConnection, kind: &str, key: &str, owner: &str) -> Result<Value> {
    let (o, v) = get(c, kind, key).await?;
    if o != owner {
        return Err(ApiError(404, "NOT_FOUND"));
    }
    Ok(v)
}
async fn list(c: &mut SqliteConnection, kind: &str, owner: &str) -> Result<Vec<Value>> {
    let rows = sqlx::query("SELECT body FROM records WHERE kind=? AND owner=? ORDER BY id")
        .bind(kind)
        .bind(owner)
        .fetch_all(c)
        .await?;
    rows.iter()
        .map(|r| serde_json::from_str(r.get(0)).map_err(|_| ApiError(500, "INTERNAL")))
        .collect()
}
impl App {
    pub async fn open(config: Config) -> std::result::Result<Self, sqlx::Error> {
        let network =
            Network::parse(&config.network).map_err(|e| sqlx::Error::Protocol(e.into()))?;
        let wallet: Option<Arc<dyn WalletAdapter>> = match std::env::var("WALLET_BACKEND")
            .as_deref()
        {
            Ok("zingo-cli") if network == Network::Testnet => {
                use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
                let options = SqliteConnectOptions::from_str(&config.database_url)?;
                let file = options.get_filename();
                let parent = file
                    .parent()
                    .filter(|_| file.is_absolute())
                    .ok_or_else(|| {
                        sqlx::Error::Protocol(
                            "Live testnet database must be an absolute path outside the repository"
                                .into(),
                        )
                    })?;
                let parent = parent.canonicalize()?;
                let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .unwrap();
                if parent.starts_with(repo)
                    || std::fs::metadata(&parent)?.permissions().mode() & 0o077 != 0
                    || std::fs::symlink_metadata(file)
                        .is_ok_and(|m| !m.is_file() || m.permissions().mode() & 0o077 != 0)
                {
                    return Err(sqlx::Error::Protocol(
                        "Live testnet database must use a private directory and file".into(),
                    ));
                }
                std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .mode(0o600)
                    .open(file)?;
                let root = std::env::var_os("VEILPAY_WALLET_ROOT").ok_or_else(|| {
                    sqlx::Error::Protocol("VEILPAY_WALLET_ROOT required for zingo-cli".into())
                })?;
                Some(Arc::new(CliWallet::new(
                    transport::TestnetTransport::from_root(root.into()),
                )))
            }
            Ok("zingo") => Some(Arc::new(ZingoWallet::new(network))),
            Ok("mock") | Err(std::env::VarError::NotPresent) if network != Network::Mainnet => None,
            Err(std::env::VarError::NotPresent) => Some(Arc::new(ZingoWallet::new(network))),
            _ => {
                return Err(sqlx::Error::Protocol(
                    "Invalid or unsafe WALLET_BACKEND".into(),
                ));
            }
        };
        let token = std::env::var("VEILPAY_OPERATOR_READ_TOKEN").ok();
        Self::open_with_wallet_and_operator_token(config, wallet, token.as_deref()).await
    }
    /// Adapter injection is a server-side integration seam; no HTTP route configures it.
    pub async fn open_with_wallet(
        config: Config,
        wallet: Option<Arc<dyn WalletAdapter>>,
    ) -> std::result::Result<Self, sqlx::Error> {
        Self::open_with_wallet_and_operator_token(config, wallet, None).await
    }
    /// The token is accepted only at construction and retained as a hash. This
    /// test/integration seam never reads wallets or exposes the token.
    pub async fn open_with_wallet_and_operator_token(
        config: Config,
        wallet: Option<Arc<dyn WalletAdapter>>,
        operator_read_token: Option<&str>,
    ) -> std::result::Result<Self, sqlx::Error> {
        let network =
            Network::parse(&config.network).map_err(|e| sqlx::Error::Protocol(e.into()))?;
        if wallet.as_ref().is_some_and(|w| w.network() != network)
            || (network == Network::Mainnet && wallet.is_none())
        {
            return Err(sqlx::Error::Protocol(
                "Wallet network mismatch or mainnet mock mode".into(),
            ));
        }
        let opts = SqliteConnectOptions::from_str(&config.database_url)?
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .busy_timeout(StdDuration::from_secs(30));
        let pool = SqlitePoolOptions::new()
            .max_connections(8)
            .connect_with(opts)
            .await?;
        sqlx::migrate!().run(&pool).await?;
        sqlx::query("INSERT OR IGNORE INTO deployment_network VALUES(1,?)")
            .bind(network.as_str())
            .execute(&pool)
            .await?;
        let stored: String =
            sqlx::query_scalar("SELECT network FROM deployment_network WHERE singleton=1")
                .fetch_one(&pool)
                .await?;
        if stored != network.as_str() {
            return Err(sqlx::Error::Protocol(
                "Database belongs to a different network".into(),
            ));
        }
        // A server-only signing key survives restarts; never returned by an API.
        sqlx::query("INSERT OR IGNORE INTO app_secrets(name, value) VALUES('merchant_ack', ?)")
            .bind(format!(
                "{}{}",
                uuid::Uuid::new_v4().simple(),
                uuid::Uuid::new_v4().simple()
            ))
            .execute(&pool)
            .await?;
        let operator_read_token_hash =
            operator_read_token.map(|token| Sha256::digest(token.as_bytes()).into());
        let demo_session_rate_limit = if config.network == "regtest" && wallet.is_none() {
            std::env::var("VEILPAY_DEMO_SESSION_RATE_LIMIT")
                .ok()
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|value| *value >= 30 && *value <= 10_000)
                .unwrap_or(30)
        } else {
            30
        };
        let app = Self {
            pool,
            config,
            wallet,
            operator_read_token_hash,
            demo_session_rate_limit,
        };
        // Read-only recovery; pending operations are never submitted on startup.
        app.reconcile_wallet_operations()
            .await
            .map_err(|_| sqlx::Error::Protocol("Wallet recovery failed".into()))?;
        Ok(app)
    }
    pub(crate) async fn mainnet_read_only_snapshot(&self) -> Result<Value> {
        if self.config.network != "mainnet" {
            return Err(ApiError(404, "NOT_FOUND"));
        }
        let wallet = self
            .wallet
            .as_ref()
            .ok_or(ApiError(503, "WALLET_UNAVAILABLE"))?;
        let snapshot = wallet
            .read_only_snapshot()
            .await
            .map_err(|_| ApiError(503, "WALLET_UNAVAILABLE"))?;
        if wallet.network() != Network::Mainnet
            || snapshot.sync_height == 0
            || snapshot.chain_height == 0
            || snapshot.sync_height != snapshot.chain_height
            || snapshot.observations.network != Network::Mainnet
            || snapshot.observations.tip != snapshot.chain_height
            || snapshot.observations.scanned != snapshot.sync_height
            || snapshot.available_zat < 0
            || zcash::orchard_address_for(Network::Mainnet, &json!({"encoded_address":snapshot.address,"has_orchard":true,"has_sapling":false,"has_transparent":false})).is_err()
        {
            return Err(ApiError(503, "WALLET_UNAVAILABLE"));
        }
        let observations: Vec<Value> = snapshot.observations.received.iter().map(|o| json!({"txid":o.txid,"status":o.status,"blockHeight":o.height,"confirmations":if o.status=="confirmed" { snapshot.chain_height.saturating_sub(o.height)+1 } else { 0 }})).collect();
        Ok(
            json!({"network":"mainnet","address":snapshot.address,"availableZat":snapshot.available_zat.to_string(),"sync":{"walletReportedHeight":snapshot.sync_height,"stale":false},"chainEvidence":{"trusted":false,"height":null,"reason":"wallet-reported lightwallet observation; no independently pinned full-node evidence configured"},"observations":observations}),
        )
    }
    fn operator_token_matches(&self, candidate: Option<&str>) -> bool {
        let Some(expected) = self.operator_read_token_hash else {
            return false;
        };
        let actual: [u8; 32] = Sha256::digest(candidate.unwrap_or("").as_bytes()).into();
        expected
            .iter()
            .zip(actual)
            .fold(0u8, |d, (a, b)| d | (a ^ b))
            == 0
    }
    pub fn router(self) -> Router {
        let cors = CorsLayer::new()
            .allow_origin(
                self.config
                    .frontend_origin
                    .parse::<axum::http::HeaderValue>()
                    .expect("valid frontend origin"),
            )
            .allow_credentials(true)
            .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
            .allow_headers([
                "content-type".parse().unwrap(),
                "x-csrf-token".parse().unwrap(),
                "idempotency-key".parse().unwrap(),
            ])
            .expose_headers(["idempotent-replay".parse().unwrap()]);
        Router::new()
            .route("/api/{*path}", any(handle))
            .fallback(|| async { ApiError(404, "NOT_FOUND") })
            .layer(cors)
            .with_state(self)
    }
}

fn cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    headers.get("cookie").and_then(|x| x.to_str().ok()).unwrap_or("")
        .split(';').find_map(|s| s.trim().strip_prefix(&format!("{name}="))).map(str::to_owned)
}
fn cookie_name(config: &Config) -> &'static str {
    // The interactive testnet frontend is deliberately bound to this loopback
    // development origin. All other environments retain the hardened __Host
    // cookie invariant (including fixture coverage).
    if config.frontend_origin == "http://localhost:3200" { "veilpay_session" } else { "__Host-veilpay_session" }
}
fn set_session_cookie(config: &Config, token: &str) -> String {
    if config.frontend_origin == "http://localhost:3200" {
        // Loopback-only local testnet development cannot use a __Host cookie on
        // plain HTTP. Production requires HTTPS above.
        format!("veilpay_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800")
    } else { format!("__Host-veilpay_session={token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800") }
}
fn clear_session_cookie(config: &Config) -> String {
    if config.frontend_origin == "http://localhost:3200" {
        "veilpay_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0".into()
    } else {
        "__Host-veilpay_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0".into()
    }
}
async fn handle(
    State(app): State<App>,
    peer: Option<Extension<ConnectInfo<SocketAddr>>>,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    bytes: Bytes,
) -> Response {
    match dispatch(
        app,
        peer.map(|p| p.0.0.ip().to_string())
            .unwrap_or("local".into()),
        uri,
        method,
        headers,
        bytes,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => e.into_response(),
    }
}
async fn dispatch(
    app: App,
    ip: String,
    uri: axum::http::Uri,
    method: Method,
    h: HeaderMap,
    bytes: Bytes,
) -> Result<Response> {
    let path = uri.path().trim_start_matches("/api/");
    let parts: Vec<_> = path.split('/').collect();
    let write = method != Method::GET;
    // Only state-changing requests need SQLite's writer reservation. Starting
    // every GET with BEGIN IMMEDIATE made the health poll contend with normal
    // writes and could turn a read-only probe into a 500 under load.
    let mut tx = if write {
        app.pool.begin_with("BEGIN IMMEDIATE").await?
    } else {
        app.pool.begin().await?
    };
    if path == "health" && method == Method::GET {
        let unresolved: i64 = sqlx::query_scalar("SELECT count(*) FROM wallet_operations WHERE network=? AND state IN ('pending','unknown','broadcast','mined')").bind(&app.config.network).fetch_one(&mut *tx).await?;
        let last_run: Option<String> = sqlx::query_scalar(
            "SELECT max(last_reconciled_at) FROM wallet_operations WHERE network=?",
        )
        .bind(&app.config.network)
        .fetch_one(&mut *tx)
        .await?;
        return Ok(reply(
            200,
            &json!({"status":"ok","network":app.config.network,"wallet":if app.wallet.as_ref().is_some_and(|w|w.requires_operator()){"operator_required"}else if app.wallet.is_some(){"broadcast_disabled"}else{"ready"},"walletBackend":if app.wallet.as_ref().is_some_and(|w|w.requires_operator()){"zingo-cli"}else if app.wallet.is_some(){"zingo"}else{"mock"},"mode":if app.wallet.as_ref().is_some_and(|w|w.requires_operator()){"testnet_manual"}else if app.wallet.is_some(){"disabled"}else{"mock"},"chainHeight":null,"confirmationsRequired":if app.wallet.as_ref().is_some_and(|w|w.requires_operator()){3}else{1},"reconciler":{"lastRunAt":last_run,"unresolved":unresolved},"chainWatcher":{"supported":false,"lastBlockAt":null,"watchDepth":if app.wallet.as_ref().is_some_and(|w|w.requires_operator()){0}else{100},"deepReorgAlert":false}}),
            false,
        ));
    }
    if path == "operator/mainnet/read-only" && method == Method::GET {
        if !app.operator_token_matches(
            h.get("x-veilpay-operator-token")
                .and_then(|v| v.to_str().ok()),
        ) {
            return Err(ApiError(401, "UNAUTHENTICATED"));
        }
        return Ok(reply(200, &app.mainnet_read_only_snapshot().await?, false));
    }
    if write && h.get("origin").and_then(|x| x.to_str().ok()) != Some(&app.config.frontend_origin) {
        return Err(ApiError(403, "CSRF_FAILED"));
    }
    let body: Value = if bytes.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&bytes).map_err(|_| invalid())?
    };
    let cookie = cookie_value(&h, cookie_name(&app.config)).unwrap_or_default();
    if path == "auth/register" && method == Method::POST {
        if app.config.network == "mainnet" { return Err(ApiError(404, "NOT_FOUND")); }
        let display_name = text(&body, "displayName", 64)?;
        if display_name.trim().is_empty() { return Err(invalid()); }
        let account_type = text(&body, "accountType", 16)?;
        if !["individual", "freelancer", "merchant", "team", "business"].contains(&account_type) { return Err(invalid()); }
        let context = if account_type == "merchant" { "merchant" } else { "customer" };
        let account_id = id("usr");
        let token = session_token();
        let csrf = id("csrf");
        let expires = (Utc::now() + Duration::hours(8)).to_rfc3339();
        sqlx::query("INSERT INTO accounts(id,display_name,account_type,context,created_at) VALUES(?,?,?,?,?)")
            .bind(&account_id).bind(display_name.trim()).bind(account_type).bind(context).bind(now()).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO account_sessions(token_hash,context,csrf,expires_at,principal,account_id) VALUES(?,?,?,?,?,?)")
            .bind(token_hash(&token)).bind(context).bind(&csrf).bind(&expires).bind(&account_id).bind(&account_id).execute(&mut *tx).await?;
        tx.commit().await?;
        let mut r = reply(201, &json!({"authenticated":true,"context":context,"accountId":account_id,"accountType":account_type,"agentId":null,"merchantId":if context=="merchant"{Some(account_id.as_str())}else{None},"csrfToken":csrf,"expiresAt":expires}), false);
        r.headers_mut().insert("set-cookie", set_session_cookie(&app.config, &token).parse().unwrap());
        return Ok(r);
    }
    if path == "session/demo" && method == Method::POST {
        if app.config.network == "mainnet" || (app.wallet.is_some() && app.config.frontend_origin == "http://localhost:3200") {
            return Err(ApiError(404, "NOT_FOUND"));
        }
        let role = text(&body, "context", 8)?;
        if !["customer", "merchant"].contains(&role) {
            return Err(invalid());
        }
        let stamp = Utc::now().timestamp();
        sqlx::query("INSERT INTO demo_rate_limits VALUES(?,?,1) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN window_start<? THEN 1 ELSE count+1 END, window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END").bind(&ip).bind(stamp).bind(stamp-60).bind(stamp-60).execute(&mut *tx).await?;
        let count: i64 = sqlx::query_scalar("SELECT count FROM demo_rate_limits WHERE ip=?")
            .bind(&ip)
            .fetch_one(&mut *tx)
            .await?;
        if count > app.demo_session_rate_limit {
            tx.commit().await?;
            return Err(ApiError(429, "VALIDATION_FAILED"));
        }
        sqlx::query("DELETE FROM sessions WHERE token=?")
            .bind(cookie)
            .execute(&mut *tx)
            .await?;
        let token = session_token();
        let csrf = id("csrf");
        let expires = (Utc::now() + Duration::hours(8)).to_rfc3339();
        sqlx::query("INSERT INTO sessions VALUES(?,?,?,?)")
            .bind(&token)
            .bind(role)
            .bind(&csrf)
            .bind(&expires)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        let mut r = reply(
            200,
            &json!({"authenticated":true,"context":role,"accountId":null,"accountType":null,"merchantId":if role=="merchant"{Some("mer_demo")}else{None},"agentId":null,"csrfToken":csrf,"expiresAt":expires}),
            false,
        );
        r.headers_mut().insert("set-cookie",set_session_cookie(&app.config, &token).parse().unwrap());
        return Ok(r);
    }
    let session = sqlx::query("SELECT context,csrf,expires_at,principal,account_id FROM account_sessions WHERE token_hash=? AND expires_at>?")
        .bind(token_hash(&cookie)).bind(now()).fetch_optional(&mut *tx).await?;
    let session = if let Some(session) = session { Some(session) } else {
        sqlx::query("SELECT context,csrf,expires_at,CASE context WHEN 'customer' THEN 'customer_demo' ELSE 'mer_demo' END as principal,NULL as account_id FROM sessions WHERE token=? AND expires_at>?")
            .bind(&cookie).bind(now()).fetch_optional(&mut *tx).await?
    };
    if path == "session" && method == Method::GET && session.is_none() {
        if app.config.frontend_origin != "http://localhost:3200" {
            return Err(ApiError(401, "UNAUTHENTICATED"));
        }
        return Ok(reply(200, &json!({"authenticated":false,"context":null,"accountId":null,"accountType":null,"agentId":null,"merchantId":null,"csrfToken":null,"expiresAt":null}), false));
    }
    let session = session.ok_or(ApiError(401, "UNAUTHENTICATED"))?;
    let role: String = session.get(0);
    let principal: String = session.get(3);
    if write
        && h.get("x-csrf-token").and_then(|x| x.to_str().ok()) != Some(session.get::<&str, _>(1))
    {
        return Err(ApiError(403, "CSRF_FAILED"));
    }
    if path == "session" && method == Method::GET {
        return Ok(reply(
            200,
            &json!({"authenticated":true,"context":role,"accountId":session.get::<Option<String>,_>(4),"accountType":null,"csrfToken":session.get::<String,_>(1),"expiresAt":session.get::<String,_>(2),"agentId":null,"merchantId":if role=="merchant"{Some(principal)}else{None}}),
            false,
        ));
    }
    if path == "session" && method == Method::DELETE {
        // Revoke the bearer credential server-side before clearing the browser
        // cookie. A copied or restored cookie cannot recover this session.
        sqlx::query("DELETE FROM account_sessions WHERE token_hash=?")
            .bind(token_hash(&cookie))
            .execute(&mut *tx)
            .await?;
        // This only affects the legacy isolated fixture session table. It is
        // harmless for authenticated sessions and keeps logout semantics clear.
        sqlx::query("DELETE FROM sessions WHERE token=?")
            .bind(&cookie)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        let mut r = reply(200, &json!({"authenticated":false,"context":null,"accountId":null,"accountType":null,"agentId":null,"merchantId":null,"csrfToken":null,"expiresAt":null}), false);
        r.headers_mut().insert("set-cookie", clear_session_cookie(&app.config).parse().unwrap());
        return Ok(r);
    }
    let merchant = parts.first() == Some(&"merchant")
        || matches!(parts.get(2), Some(&"verification" | &"acknowledgment"));
    if (merchant && role != "merchant") || (!merchant && role != "customer") {
        return Err(ApiError(403, "WRONG_CONTEXT"));
    }
    let operation = format!("{method} {path}");
    let payload = body.to_string();
    let key = if method == Method::POST {
        let k = h
            .get("idempotency-key")
            .and_then(|x| x.to_str().ok())
            .ok_or_else(invalid)?;
        if !(8..=128).contains(&k.len()) {
            return Err(invalid());
        }
        Some(k)
    } else {
        None
    };
    if let Some(k) = key
        && let Some(r) = sqlx::query("SELECT payload,status,body FROM idempotency WHERE principal=? AND operation=? AND key=?")
            .bind(&principal).bind(&operation).bind(k).fetch_optional(&mut *tx).await?
    {
        if r.get::<String, _>(0) != payload {
            return Err(ApiError(409, "IDEMPOTENCY_MISMATCH"));
        }
        let mut response = (
            StatusCode::from_u16(r.get::<i64, _>(1) as u16).unwrap(),
            [("content-type", "application/json"), ("idempotent-replay", "true")],
            r.get::<String, _>(2),
        ).into_response();
        response.headers_mut().insert("cache-control", "no-store".parse().unwrap());
        return Ok(response);
    }
    let outcome = perform(
        &mut tx,
        &parts,
        &method,
        &body,
        &principal,
        uri.query(),
        &app,
    )
    .await;
    let (status, mut result) = match outcome {
        Ok(x) => x,
        Err(e) if e.0 == 409 => (e.0, json!({"code":e.1,"message":e.1.replace('_'," ")})),
        Err(e) => return Err(e),
    };
    let dispatch_operation = result
        .as_object_mut()
        .and_then(|v| v.remove("_dispatchOperation"))
        .and_then(|v| v.as_str().map(str::to_owned));
    if let Some(k) = key {
        sqlx::query("INSERT INTO idempotency VALUES(?,?,?,?,?,?,?)")
            .bind(principal)
            .bind(operation)
            .bind(k)
            .bind(payload)
            .bind(status as i64)
            .bind(result.to_string())
            .bind(now())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    if let Some(op) = dispatch_operation {
        // Intent and immutable 202 snapshot are durable BEFORE touching an adapter.
        app.dispatch_wallet_operation(&op).await?;
    }
    Ok(reply(status, &result, false))
}
async fn save_agent(c: &mut SqliteConnection, a: &Value) -> Result<()> {
    let (owner, _) = get(c, "agent", a["id"].as_str().unwrap()).await?;
    put(c, "agent", a["id"].as_str().unwrap(), &owner, a).await
}
fn evaluate(a: &Value, i: &Value, amount: i64, expires: &str, own: i64) -> Result<Vec<Value>> {
    let p = &a["policy"];
    let mut violations = vec![];
    let mut add =
        |code: &str| violations.push(json!({"code":code,"message":code.replace('_'," ")}));
    if a["status"] == "paused" {
        add("AGENT_PAUSED")
    }
    if p
        .get("expiresAt")
        .and_then(Value::as_str)
        .map(date)
        .transpose()?
        .is_some_and(|expiry| expiry <= Utc::now())
    {
        add("POLICY_EXPIRED")
    }
    if amount > zat(p, "perTxLimitZat")? {
        add("CAP_EXCEEDED")
    }
    if zat(&a["usage"], "spentZat")? + zat(&a["usage"], "reservedZat")? - own + amount
        > zat(p, "totalBudgetZat")?
    {
        add("BUDGET_EXCEEDED")
    }
    if !p["allowedMerchantIds"]
        .as_array()
        .unwrap()
        .contains(&i["merchantId"])
    {
        add("MERCHANT_NOT_ALLOWED")
    }
    if amount != zat(i, "amountZat")? {
        add("AMOUNT_MISMATCH")
    }
    if i["status"] != "open"
        || i.get("expiresAt")
            .and_then(Value::as_str)
            .map(date)
            .transpose()?
            .is_some_and(|d| d <= Utc::now())
    {
        add("INVOICE_NOT_PAYABLE")
    }
    if date(expires)? <= Utc::now() {
        add("REQUEST_EXPIRED")
    }
    Ok(violations)
}
fn usage(a: &mut Value, spent_delta: i64, reserved_delta: i64) -> Result<()> {
    let spent = zat(&a["usage"], "spentZat")? + spent_delta;
    let reserved = zat(&a["usage"], "reservedZat")? + reserved_delta;
    if spent < 0 || reserved < 0 {
        return Err(ApiError(500, "INTERNAL"));
    }
    a["usage"]["spentZat"] = json!(spent.to_string());
    a["usage"]["reservedZat"] = json!(reserved.to_string());
    a["usage"]["remainingZat"] = json!(
        (zat(&a["policy"], "totalBudgetZat")? - spent - reserved)
            .max(0)
            .to_string()
    );
    Ok(())
}
fn event(p: &mut Value, status: &str, kind: &str, note: &str) {
    p["status"] = json!(status);
    p["timeline"]
        .as_array_mut()
        .unwrap()
        .push(json!({"status":status,"kind":kind,"at":now(),"note":note}));
}
async fn decision(
    c: &mut SqliteConnection,
    owner: &str,
    request: &Value,
    policy: &Value,
    violations: Vec<Value>,
) -> Result<Value> {
    let result = if violations.is_empty() {
        "authorized"
    } else {
        "rejected"
    };
    let d = json!({"id":id("dec"),"result":result,"policyVersion":policy["version"],"evaluatedAt":now(),"violations":violations,"auditHash":format!("{:x}",Sha256::digest(json!([request,policy["version"],result]).to_string().as_bytes()))});
    put(
        c,
        "decision",
        d["id"].as_str().unwrap(),
        owner,
        &d,
    )
    .await?;
    Ok(d)
}
async fn expire(c: &mut SqliteConnection, owner: &str) -> Result<()> {
    for mut p in list(c, "payment", owner).await? {
        if p["status"] == "authorized" && date(p["expiresAt"].as_str().unwrap())? <= Utc::now() {
            let aid = p["agentId"].as_str().unwrap();
            let mut a = owned(c, "agent", aid, owner).await?;
            usage(&mut a, 0, -zat(&p, "amountZat")?)?;
            a["usage"]["pendingCount"] = json!(a["usage"]["pendingCount"].as_i64().unwrap() - 1);
            save_agent(c, &a).await?;
            event(
                &mut p,
                "expired",
                "status",
                "Unsent mock request expired; reservation released",
            );
            put(c, "payment", p["id"].as_str().unwrap(), owner, &p).await?;
        }
    }
    Ok(())
}
async fn invoice_for_payment(c: &mut SqliteConnection, iid: &str) -> Result<Value> {
    let (_, mut invoice) = get(c, "invoice", iid).await?;
    let claimed: i64 = sqlx::query_scalar("SELECT count(*) FROM wallet_operations WHERE invoice_id=? AND backend='zingo' AND state!='failed_definitive'").bind(iid).fetch_one(c).await?;
    if claimed > 0 {
        invoice["status"] = json!("payment_pending");
    }
    Ok(invoice)
}
async fn expire_invoice(c: &mut SqliteConnection, owner: &str, invoice: &mut Value) -> Result<()> {
    if invoice["status"] == "open"
        && invoice
            .get("expiresAt")
            .and_then(Value::as_str)
            .map(date)
            .transpose()?
            .is_some_and(|expiry| expiry <= Utc::now())
    {
        invoice["status"] = json!("expired");
        put(
            c,
            "invoice",
            invoice["id"].as_str().unwrap(),
            owner,
            invoice,
        )
        .await?;
    }
    Ok(())
}
async fn perform(
    c: &mut SqliteConnection,
    p: &[&str],
    m: &Method,
    b: &Value,
    owner: &str,
    query: Option<&str>,
    app: &App,
) -> Result<(u16, Value)> {
    expire(c, owner).await?;
    match (m.as_str(), p) {
        ("GET", ["agents"]) => Ok((200, json!({"items":list(c, "agent", owner).await?}))),
        ("POST", ["agents"]) => {
            let name = text(b, "name", 64)?;
            let pol = policy(&b["policy"], 1)?;
            let a = json!({"id":id("agt"),"name":name,"status":"active","policy":pol,"usage":{"spentZat":"0","reservedZat":"0","remainingZat":pol["totalBudgetZat"],"approvedCount":0,"rejectedCount":0,"pendingCount":0},"createdAt":now()});
            put(c, "agent", a["id"].as_str().unwrap(), owner, &a).await?;
            put(
                c,
                "policy",
                &format!("{}:1", a["id"].as_str().unwrap()),
                owner,
                &pol,
            )
            .await?;
            Ok((201, a))
        }
        ("GET", ["agents", aid]) => Ok((200, owned(c, "agent", aid, owner).await?)),
        ("PATCH", ["agents", aid]) => {
            let status = text(b, "status", 6)?;
            if !["active", "paused"].contains(&status) {
                return Err(invalid());
            }
            let mut a = owned(c, "agent", aid, owner).await?;
            a["status"] = json!(status);
            save_agent(c, &a).await?;
            Ok((200, a))
        }
        ("GET", ["agents", aid, "policy"]) => {
            Ok((200, owned(c, "agent", aid, owner).await?["policy"].clone()))
        }
        ("PUT", ["agents", aid, "policy"]) => {
            let mut a = owned(c, "agent", aid, owner).await?;
            let version = a["policy"]["version"].as_i64().unwrap();
            let expected = b["expectedVersion"].as_i64().ok_or_else(invalid)?;
            if expected < 1 {
                return Err(invalid());
            }
            if expected != version {
                return Err(ApiError(409, "VERSION_CONFLICT"));
            }
            let pol = policy(b, version + 1)?;
            a["policy"] = pol.clone();
            usage(&mut a, 0, 0)?;
            save_agent(c, &a).await?;
            put(c, "policy", &format!("{aid}:{}", version + 1), owner, &pol).await?;
            Ok((200, pol))
        }
        ("POST", ["merchant", "invoices"]) => {
            // A live backend without a verified merchant receiving capability
            // must never mint the mock-only invoice shape.  Keeping fixture
            // invoices behind the no-wallet branch prevents testnet users from
            // mistaking an internal placeholder for a payable Zcash request.
            if app.wallet.is_some()
                && !app.wallet.as_ref().is_some_and(|w| w.requires_operator())
                && app.config.frontend_origin == "http://localhost:3200"
            {
                return Err(ApiError(409, "INVALID_TRANSITION"));
            }
            let reference = text(b, "reference", 64)?;
            let amount = zat(b, "amountZat")?;
            if reference.trim().is_empty() || !(1..=2_100_000_000_000_000).contains(&amount) {
                return Err(invalid());
            }
            let created = Utc::now();
            let expires = match b.get("expiresAt") {
                Some(e) => date(e.as_str().ok_or_else(invalid)?)?,
                None => created + Duration::hours(24),
            };
            if expires <= created {
                return Err(invalid());
            }
            let invoice_id = id("inv");
            // Deliberately not a ZIP-321 URI: mock receivers must never reach a wallet.
            let qr_payload = format!("veilpay-mock:{invoice_id}?amountZat={amount}");
            let mut i = json!({"id":invoice_id,"merchantId":owner,"reference":reference,
                "amountZat":amount.to_string(),"payTo":format!("mock-only:NOT-A-ZCASH-ADDRESS:{}",id("recv")),
                "status":"open","createdAt":created.to_rfc3339(),"expiresAt":expires.to_rfc3339(),
                "paymentPayload":{"format":"veilpay-mock-v1","uri":qr_payload,"mock":true,"spendable":false}});
            if let Some(wallet) = &app.wallet
                && wallet.requires_operator()
            {
                let address = wallet
                    .receiving_address()
                    .await
                    .map_err(|_| ApiError(503, "WALLET_UNAVAILABLE"))?;
                let reused:i64=sqlx::query_scalar("SELECT count(*) FROM records WHERE kind='invoice' AND json_extract(body,'$.network')='testnet' AND json_extract(body,'$.payTo')=?").bind(&address).fetch_one(&mut *c).await?;
                if reused != 0 {
                    return Err(ApiError(503, "WALLET_UNAVAILABLE"));
                }
                let zec = format!("{}.{:08}", amount / 100_000_000, amount % 100_000_000);
                i["network"] = json!("testnet");
                i["payTo"] = json!(address);
                i["paymentPayload"] = json!({"format":"zip321","uri":format!("zcash:{address}?amount={zec}"),"network":"testnet","mock":false,"spendable":true});
            }
            put(c, "invoice", i["id"].as_str().unwrap(), owner, &i).await?;
            Ok((201, i))
        }
        ("GET", ["merchant", "invoices"]) => {
            let mut items = list(c, "invoice", owner).await?;
            for i in &mut items {
                expire_invoice(c, owner, i).await?;
            }
            Ok((200, json!({"items":items})))
        }
        ("GET", ["merchant", "invoices", iid]) => {
            let mut invoice = owned(c, "invoice", iid, owner).await?;
            expire_invoice(c, owner, &mut invoice).await?;
            Ok((200, invoice))
        }
        ("POST", ["payments", "request"]) => {
            let aid = text(b, "agentId", 64)?;
            let iid = text(b, "invoiceId", 64)?;
            text(b, "reference", 64)?;
            let amount = zat(b, "amountZat")?;
            let mut a = owned(c, "agent", aid, owner).await?;
            let i = invoice_for_payment(c, iid).await?;
            let cap =
                Utc::now() + Duration::seconds(a["policy"]["requestTtlSeconds"].as_i64().unwrap());
            let expires = if let Some(e) = b.get("expiresAt") {
                date(e.as_str().ok_or_else(invalid)?)?.min(cap)
            } else {
                cap
            }
            .to_rfc3339();
            let violations = evaluate(&a, &i, amount, &expires, 0)?;
            let d = decision(c, owner, b, &a["policy"], violations).await?;
            let status = d["result"].as_str().unwrap();
            let payment = json!({"id":id("pay"),"agentId":aid,"merchantId":i["merchantId"],"invoiceId":iid,"amountZat":b["amountZat"],"reference":b["reference"],"status":status,"decision":d,"timeline":[{"status":status,"kind":"status","at":now(),"note":if app.wallet.is_some(){"Policy evaluation only; no blockchain activity"}else{"Mock policy evaluation; no blockchain activity"}}],"createdAt":now(),"expiresAt":expires,"pool":null,"txid":null,"mockRef":if app.wallet.is_some(){Value::Null}else{json!(id("mock"))},"confirmations":0,"failure":null,"walletOperation":null});
            let count = if status == "authorized" {
                "approvedCount"
            } else {
                "rejectedCount"
            };
            a["usage"][count] = json!(a["usage"][count].as_i64().unwrap() + 1);
            if status == "authorized" {
                usage(&mut a, 0, amount)?;
                a["usage"]["pendingCount"] = json!(a["usage"]["pendingCount"].as_i64().unwrap() + 1)
            }
            save_agent(c, &a).await?;
            put(
                c,
                "payment_request",
                payment["id"].as_str().unwrap(),
                owner,
                b,
            )
            .await?;
            put(
                c,
                "payment",
                payment["id"].as_str().unwrap(),
                owner,
                &payment,
            )
            .await?;
            Ok((201, payment))
        }
        ("GET", ["payments"]) => {
            let mut status = None;
            let mut cursor = None;
            let mut limit = 20;
            for pair in query.unwrap_or("").split('&').filter(|x| !x.is_empty()) {
                let (k, v) = pair.split_once('=').ok_or_else(invalid)?;
                match k {
                    "status" => {
                        if ![
                            "requested",
                            "rejected",
                            "authorized",
                            "submitted",
                            "confirming",
                            "confirmed",
                            "failed",
                            "expired",
                        ]
                        .contains(&v)
                        {
                            return Err(invalid());
                        }
                        status = Some(v)
                    }
                    "cursor" => cursor = Some(v),
                    "limit" => {
                        limit = v.parse::<usize>().map_err(|_| invalid())?;
                        if !(1..=100).contains(&limit) {
                            return Err(invalid());
                        }
                    }
                    _ => return Err(invalid()),
                }
            }
            let mut items: Vec<_> = list(c, "payment", owner)
                .await?
                .into_iter()
                .filter(|x| {
                    status.is_none_or(|s| x["status"] == s)
                        && cursor.is_none_or(|s| x["id"].as_str().unwrap() > s)
                })
                .collect();
            let next = if items.len() > limit {
                items.truncate(limit);
                Some(items.last().unwrap()["id"].clone())
            } else {
                None
            };
            Ok((200, json!({"items":items,"nextCursor":next})))
        }
        ("GET", ["payments", pid]) => Ok((200, owned(c, "payment", pid, owner).await?)),
        ("POST", ["payments", pid, "execute"]) => {
            // A policy decision is never wallet authority. Live deployments do
            // not expose an execution transition while signing/sending review
            // is incomplete; mock-only fixtures retain their isolated path.
            if app.wallet.is_some() && app.config.frontend_origin == "http://localhost:3200" {
                return Err(ApiError(409, "INVALID_TRANSITION"));
            }
            let mut payment = owned(c, "payment", pid, owner).await?;
            if payment["walletOperation"].is_object() {
                return Ok((202, payment));
            }
            if payment["status"] != "authorized" {
                return Err(ApiError(409, "INVALID_TRANSITION"));
            }
            let aid = payment["agentId"].as_str().unwrap().to_owned();
            let mut a = owned(c, "agent", &aid, owner).await?;
            let iid = payment["invoiceId"].as_str().unwrap().to_owned();
            let mut invoice = invoice_for_payment(c, &iid).await?;
            let amount = zat(&payment, "amountZat")?;
            let violations = evaluate(
                &a,
                &invoice,
                amount,
                payment["expiresAt"].as_str().unwrap(),
                amount,
            )?;
            let request = owned(c, "payment_request", pid, owner).await?;
            payment["decision"] = decision(c, owner, &request, &a["policy"], violations).await?;
            if payment["decision"]["result"] == "rejected" {
                usage(&mut a, 0, -amount)?;
                a["usage"]["pendingCount"] =
                    json!(a["usage"]["pendingCount"].as_i64().unwrap() - 1);
                a["usage"]["rejectedCount"] =
                    json!(a["usage"]["rejectedCount"].as_i64().unwrap() + 1);
                event(
                    &mut payment,
                    "rejected",
                    "status",
                    "Current policy rejected execution; reservation released",
                );
                save_agent(c, &a).await?;
                put(c, "payment", pid, owner, &payment).await?;
                return Err(ApiError(409, "POLICY_REJECTED"));
            }
            if app.wallet.is_some() {
                let op = id("wop");
                sqlx::query("INSERT INTO wallet_operations(id,payment_id,attempt,backend,state,created_at,updated_at,network,invoice_id,destination,amount_zat) VALUES(?,?,1,'zingo','pending',?,?,?,?,?,?)")
                    .bind(&op).bind(pid).bind(now()).bind(now()).bind(&app.config.network)
                    .bind(&iid)
                    .bind(invoice["payTo"].as_str().ok_or_else(invalid)?).bind(amount).execute(&mut *c).await?;
                event(
                    &mut payment,
                    "submitted",
                    "status",
                    "Durable operation recorded; no broadcast established",
                );
                payment["walletOperation"] = json!({"id":op,"state":"pending","attempt":1,"needsOperator":false,"lastReconciledAt":null});
                payment["mockRef"] = Value::Null;
                put(c, "payment", pid, owner, &payment).await?;
                if app.wallet.as_ref().is_some_and(|w| w.requires_operator()) {
                    sqlx::query(
                        "UPDATE wallet_operations SET manual_phase='awaiting_operator' WHERE id=?",
                    )
                    .bind(&op)
                    .execute(&mut *c)
                    .await?;
                    payment["walletOperation"]["requiresOperatorConfirmation"] = json!(true);
                    payment["walletOperation"]["phase"] = json!("awaiting_operator");
                    put(c, "payment", pid, owner, &payment).await?;
                } else {
                    payment["_dispatchOperation"] = json!(op);
                }
                return Ok((202, payment));
            }
            // SQLite's IMMEDIATE write lock serializes the authorization check and operation insertion.
            // The mock engine is a pure database simulation: there is no external send or crash gap.
            let op = id("wop");
            sqlx::query("INSERT INTO wallet_operations(id,payment_id,attempt,backend,state,wallet_op_ref,txid,created_at,updated_at,network) VALUES(?,?,1,'mock','final',?,NULL,?,?,?)")
                .bind(&op)
                .bind(pid)
                .bind(payment["mockRef"].as_str())
                .bind(now())
                .bind(now())
                .bind(&app.config.network)
                .execute(&mut *c)
                .await?;
            event(
                &mut payment,
                "submitted",
                "status",
                "MOCK execution only; nothing broadcast",
            );
            event(
                &mut payment,
                "confirming",
                "status",
                "Simulated receipt; no chain observed",
            );
            event(
                &mut payment,
                "confirmed",
                "status",
                "MOCK completed; simulated payment, not blockchain settlement",
            );
            payment["confirmations"] = json!(1);
            payment["walletOperation"] = json!({"id":op,"state":"final","attempt":1,"needsOperator":false,"lastReconciledAt":null});
            usage(&mut a, amount, -amount)?;
            a["usage"]["pendingCount"] = json!(a["usage"]["pendingCount"].as_i64().unwrap() - 1);
            save_agent(c, &a).await?;
            invoice["status"] = json!("paid");
            put(
                c,
                "invoice",
                &iid,
                invoice["merchantId"].as_str().unwrap(),
                &invoice,
            )
            .await?;
            put(c, "payment", pid, owner, &payment).await?;
            Ok((202, payment))
        }
        ("GET", ["payments", pid, "verification"]) => {
            let (_, payment) = get(c, "payment", pid).await?;
            if payment["merchantId"] != owner {
                return Err(ApiError(404, "NOT_FOUND"));
            }
            let (_, invoice) = get(c, "invoice", payment["invoiceId"].as_str().unwrap()).await?;
            Ok((200, app.verify_payment(c, &payment, &invoice).await?))
        }
        ("POST", ["payments", pid, "acknowledgment"]) => {
            let (_, payment) = get(c, "payment", pid).await?;
            if payment["merchantId"] != owner {
                return Err(ApiError(404, "NOT_FOUND"));
            }
            if b.get("note").is_some() {
                text(b, "note", 280)?;
            }
            let (_, invoice) = get(c, "invoice", payment["invoiceId"].as_str().unwrap()).await?;
            let receipt = app.verify_payment(c, &payment, &invoice).await?;
            if receipt["state"] == "amount_mismatch" {
                return Err(ApiError(409, "AMOUNT_MISMATCH"));
            }
            if !matches!(receipt["state"].as_str(), Some("received" | "late"))
                || receipt["confirmations"].as_i64().unwrap()
                    < receipt["confirmationsRequired"].as_i64().unwrap()
                || receipt["receivedZat"] != receipt["expectedZat"]
            {
                return Err(ApiError(409, "NOT_YET_RECEIVED"));
            }
            if sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM records WHERE kind='acknowledgment' AND id=?",
            )
            .bind(pid)
            .fetch_one(&mut *c)
            .await?
                > 0
            {
                return Err(ApiError(409, "ALREADY_ACKNOWLEDGED"));
            }
            let at = now();
            let secret: String =
                sqlx::query_scalar("SELECT value FROM app_secrets WHERE name='merchant_ack'")
                    .fetch_one(&mut *c)
                    .await?;
            let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
                .map_err(|_| ApiError(500, "INTERNAL"))?;
            mac.update(
                serde_json::to_string(&json!([pid, receipt["receivedZat"], at]))
                    .unwrap()
                    .as_bytes(),
            );
            if receipt["mock"] == false {
                mac.update(
                    serde_json::to_string(&json!([
                        payment["invoiceId"],
                        receipt["network"],
                        receipt["txid"],
                        receipt["confirmations"],
                        "merchant statement; not settlement proof"
                    ]))
                    .unwrap()
                    .as_bytes(),
                );
            }
            // Authenticates a merchant statement, never a cryptographic settlement proof.
            let signature = format!(
                "{}hmac-sha256:{:x}",
                if receipt["mock"] == true { "mock:" } else { "" },
                mac.finalize().into_bytes()
            );
            let mut ack = json!({"paymentId":pid,"merchantId":owner,"at":at,"signature":signature,
            "statementType":if receipt["mock"] == true {
                "merchant_acknowledgment_simulation_not_settlement_proof"
            } else {
                "merchant_acknowledgment_not_settlement_proof"
            }});
            if receipt["mock"] == false {
                ack["evidence"] = receipt.clone();
            }
            if let Some(note) = b.get("note") {
                ack["note"] = note.clone();
            }
            put(c, "acknowledgment", pid, owner, &ack).await?;
            Ok((201, ack))
        }
        _ => Err(ApiError(404, "NOT_FOUND")),
    }
}

// Mock receipts only: no chain is queried and confirmations are simulated.
fn verification(payment: &Value, invoice: &Value) -> Result<Value> {
    if payment["mockRef"].is_null() {
        return Err(ApiError(409, "VERIFICATION_UNAVAILABLE"));
    }
    let seen = payment["walletOperation"].is_object() && payment["status"] == "confirmed";
    let confirmations = if seen {
        payment["confirmations"].as_i64().unwrap_or(0)
    } else {
        0
    };
    let received = if seen {
        payment["amountZat"].clone()
    } else {
        json!("0")
    };
    let received_at = payment["timeline"]
        .as_array()
        .and_then(|events| events.iter().find(|e| e["status"] == "confirmed"))
        .and_then(|e| e["at"].as_str());
    let late = seen
        && match (received_at, invoice["expiresAt"].as_str()) {
            (Some(at), Some(expiry)) => date(at)? > date(expiry)?,
            _ => false,
        };
    let state = if seen && received != invoice["amountZat"] {
        "amount_mismatch"
    } else if late {
        "late"
    } else if seen && confirmations >= 1 {
        "received"
    } else if seen {
        "pending"
    } else {
        "not_seen"
    };
    Ok(
        json!({"paymentId":payment["id"],"invoiceId":invoice["id"],"reference":payment["reference"],"state":state,"expectedZat":invoice["amountZat"],"receivedZat":received,"confirmations":confirmations,"confirmationsRequired":1,"checkedAt":now(),"method":"mock","mock":true,"late":late}),
    )
}
