//! Local-only viewing-wallet observer protocol. The observer process owns any approved
//! viewing material; VeilPay only receives a sanitized snapshot and never spawns a wallet.
use crate::{
    wallet::{Network, ReadOnlySnapshot},
    zcash::{self, WalletError, WalletResult},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader},
    net::UnixStream,
    time::timeout,
};

const MAX_LINE: usize = 1 << 20;
const MAX_AGE: u64 = 300;
const FUTURE_SKEW: u64 = 60;

#[derive(Debug, Serialize)]
struct Request<'a> {
    version: u8,
    operation: &'static str,
    token: &'a str,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Response {
    version: u8,
    snapshot: WireSnapshot,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireSnapshot {
    pub network: String,
    pub address: String,
    #[serde(rename = "availableZat")]
    pub available_zat: String,
    #[serde(rename = "scanHeight")]
    pub scan_height: u64,
    #[serde(rename = "chainHeight")]
    pub chain_height: u64,
    #[serde(rename = "observedAt")]
    pub observed_at: u64,
    pub history: Value,
}
impl WireSnapshot {
    pub fn validate(self, now: u64) -> WalletResult<ReadOnlySnapshot> {
        if self.network != "mainnet"
            || self.scan_height == 0
            || self.chain_height == 0
            || self.scan_height != self.chain_height
            || self.observed_at > now.saturating_add(FUTURE_SKEW)
            || now.saturating_sub(self.observed_at) > MAX_AGE
        {
            return Err(WalletError::InvalidOutput);
        }
        if self.available_zat.is_empty()
            || self.available_zat.len() > 16
            || !self.available_zat.bytes().all(|b| b.is_ascii_digit())
            || (self.available_zat.len() > 1 && self.available_zat.starts_with('0'))
        {
            return Err(WalletError::InvalidOutput);
        }
        let available_zat = self
            .available_zat
            .parse::<i64>()
            .map_err(|_| WalletError::InvalidOutput)?;
        let address = zcash::orchard_address_for(
            Network::Mainnet,
            &serde_json::json!({"encoded_address":self.address,"has_orchard":true,"has_sapling":false,"has_transparent":false}),
        )?;
        let observations = zcash::History::parse_for(Network::Mainnet, &self.history)?;
        if observations.tip != self.chain_height || observations.scanned != self.scan_height {
            return Err(WalletError::InvalidOutput);
        }
        Ok(ReadOnlySnapshot {
            address,
            available_zat,
            sync_height: self.scan_height,
            chain_height: self.chain_height,
            observations,
        })
    }
}
#[derive(Clone)]
pub struct LocalObserverClient {
    socket: PathBuf,
    token: String,
    deadline: Duration,
}
impl LocalObserverClient {
    pub fn new(socket: PathBuf, token: String, deadline: Duration) -> WalletResult<Self> {
        if !socket.is_absolute() || token.is_empty() || token.len() > 256 || deadline.is_zero() {
            return Err(WalletError::Configuration);
        }
        observer_socket_is_private(&socket)?;
        Ok(Self {
            socket,
            token,
            deadline,
        })
    }
    pub async fn snapshot(&self) -> WalletResult<ReadOnlySnapshot> {
        let stream = timeout(self.deadline, UnixStream::connect(&self.socket))
            .await
            .map_err(|_| WalletError::Unavailable)?
            .map_err(|_| WalletError::Unavailable)?;
        request_snapshot(stream, &self.token, self.deadline).await
    }
}

async fn request_snapshot<S>(
    stream: S,
    token: &str,
    deadline: Duration,
) -> WalletResult<ReadOnlySnapshot>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (read, mut write) = tokio::io::split(stream);
    let request = serde_json::to_vec(&Request {
        version: 1,
        operation: "snapshot",
        token,
    })
    .map_err(|_| WalletError::InvalidOutput)?;
    timeout(deadline, async {
        write.write_all(&request).await?;
        write.write_all(b"\n").await
    })
    .await
    .map_err(|_| WalletError::Unavailable)?
    .map_err(|_| WalletError::Unavailable)?;
    let mut line = String::new();
    let n = timeout(deadline, BufReader::new(read).read_line(&mut line))
        .await
        .map_err(|_| WalletError::Unavailable)?
        .map_err(|_| WalletError::Unavailable)?;
    if n == 0 || n > MAX_LINE {
        return Err(WalletError::InvalidOutput);
    }
    let response: Response = serde_json::from_str(&line).map_err(|_| WalletError::InvalidOutput)?;
    if response.version != 1 {
        return Err(WalletError::InvalidOutput);
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| WalletError::Unavailable)?
        .as_secs();
    response.snapshot.validate(now)
}
pub fn observer_socket_is_private(path: &Path) -> WalletResult<()> {
    use std::os::unix::fs::PermissionsExt;
    let parent = path.parent().ok_or(WalletError::Configuration)?;
    let mode = std::fs::metadata(parent)
        .map_err(|_| WalletError::Configuration)?
        .permissions()
        .mode();
    if mode & 0o077 != 0 {
        Err(WalletError::Configuration)
    } else {
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::wallet::{SendIntent, WalletAdapter, WalletOutcome};
    use std::{fs, os::unix::fs::PermissionsExt};
    use tokio::{
        io::{AsyncBufReadExt, AsyncReadExt},
        net::UnixListener,
    };

    fn wire() -> WireSnapshot {
        WireSnapshot {
            network: "mainnet".into(),
            address: "u1fixture".into(),
            available_zat: "12".into(),
            scan_height: 100,
            chain_height: 100,
            observed_at: 1000,
            history: serde_json::json!({"veilpay_schema":1,"network":"mainnet","tip_height":100,"scanned_height":100,"received_outputs":[],"transaction_summaries":[]}),
        }
    }
    fn private_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("veilpay-observer-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
    async fn mock_once<S>(
        stream: S,
        expected_token: &'static str,
        response: String,
        delay: Duration,
    ) where
        S: AsyncRead + AsyncWrite + Unpin,
    {
        let (read, mut write) = tokio::io::split(stream);
        let mut line = String::new();
        BufReader::new(read).read_line(&mut line).await.unwrap();
        let request: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(request["operation"], "snapshot");
        if request["token"] != expected_token {
            return;
        }
        tokio::time::sleep(delay).await;
        let _ = write.write_all(response.as_bytes()).await;
        let _ = write.write_all(b"\n").await;
    }
    #[test]
    fn fixture_is_mainnet_only_and_fails_closed() {
        assert!(wire().validate(1001).is_ok());
        let mut x = wire();
        x.network = "testnet".into();
        assert!(x.validate(1001).is_err());
        let mut x = wire();
        x.chain_height = 99;
        assert!(x.validate(1001).is_err());
        let mut x = wire();
        x.available_zat = "-1".into();
        assert!(x.validate(1001).is_err());
        let mut x = wire();
        x.observed_at = 1;
        assert!(x.validate(1000).is_err());
        let mut x = wire();
        x.observed_at = 2000;
        assert!(x.validate(1000).is_err());
        let mut x = wire();
        x.history["network"] = serde_json::json!("testnet");
        assert!(x.validate(1001).is_err());
    }
    #[test]
    fn client_rejects_unsafe_configuration() {
        assert!(
            LocalObserverClient::new(
                PathBuf::from("relative.sock"),
                "t".into(),
                Duration::from_secs(1)
            )
            .is_err()
        );
        assert!(
            LocalObserverClient::new(
                PathBuf::from("/run/veilpay.sock"),
                "".into(),
                Duration::from_secs(1)
            )
            .is_err()
        );
    }
    #[test]
    fn client_rejects_a_group_or_world_accessible_socket_directory() {
        let dir = private_dir("permissions");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            LocalObserverClient::new(
                dir.join("observer.sock"),
                "token".into(),
                Duration::from_secs(1)
            )
            .is_err()
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn rejects_agent_attribution_and_unknown_fields() {
        let mut value = serde_json::to_value(wire()).unwrap();
        value["agentId"] = serde_json::json!("agent-1");
        assert!(serde_json::from_value::<WireSnapshot>(value).is_err());
    }
    #[tokio::test]
    async fn ipc_mock_returns_snapshot_without_payment_capabilities() {
        let (client_stream, server_stream) = tokio::io::duplex(8192);
        let mut snapshot = wire();
        snapshot.observed_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let response = serde_json::json!({"version":1,"snapshot":snapshot}).to_string();
        let server = tokio::spawn(mock_once(
            server_stream,
            "approved",
            response,
            Duration::ZERO,
        ));
        assert_eq!(
            request_snapshot(client_stream, "approved", Duration::from_secs(1))
                .await
                .unwrap()
                .available_zat,
            12
        );
        let dir = private_dir("wallet");
        let client = LocalObserverClient::new(
            dir.join("missing.sock"),
            "approved".into(),
            Duration::from_secs(1),
        )
        .unwrap();
        let wallet = crate::wallet::ObserverWallet::new(client);
        let intent = SendIntent {
            operation_id: "o".into(),
            payment_id: "p".into(),
            network: Network::Mainnet,
            destination: "u1fixture".into(),
            amount_zat: 1,
            expected_txid: None,
        };
        assert_eq!(
            wallet.submit(&intent).await,
            WalletOutcome::BroadcastDisabled
        );
        assert!(wallet.prepare(&intent, 1).await.is_err());
        assert!(wallet.transmit("txid").await.is_err());
        server.await.unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    #[tokio::test]
    async fn ipc_fails_closed_for_missing_auth_timeout_and_process_failure() {
        let dir = private_dir("failures");
        let client = LocalObserverClient::new(
            dir.join("missing.sock"),
            "approved".into(),
            Duration::from_millis(20),
        )
        .unwrap();
        assert!(client.snapshot().await.is_err());
        let (client_stream, server_stream) = tokio::io::duplex(8192);
        let server = tokio::spawn(mock_once(
            server_stream,
            "approved",
            "{}".into(),
            Duration::ZERO,
        ));
        assert!(
            request_snapshot(client_stream, "wrong", Duration::from_secs(1))
                .await
                .is_err()
        );
        server.await.unwrap();
        let (client_stream, server_stream) = tokio::io::duplex(8192);
        let response = serde_json::json!({"version":1,"snapshot":wire()}).to_string();
        let server = tokio::spawn(mock_once(
            server_stream,
            "approved",
            response,
            Duration::from_millis(100),
        ));
        assert!(
            request_snapshot(client_stream, "approved", Duration::from_millis(5))
                .await
                .is_err()
        );
        server.await.unwrap();
        let (client_stream, mut server_stream) = tokio::io::duplex(8192);
        let server = tokio::spawn(async move {
            let mut request = [0_u8; 512];
            let _ = server_stream.read(&mut request).await.unwrap();
        });
        assert!(
            request_snapshot(client_stream, "approved", Duration::from_secs(1))
                .await
                .is_err()
        );
        server.await.unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
    /// Runs only where the host permits AF_UNIX binds. It exercises the production
    /// UnixStream path rather than the duplex transport used by ordinary unit tests.
    #[tokio::test]
    #[ignore = "requires a host that permits private AF_UNIX socket binding"]
    async fn unix_socket_acceptance_uses_observer_wallet() {
        let dir = private_dir("acceptance");
        let socket = dir.join("observer.sock");
        let listener = UnixListener::bind(&socket).unwrap();
        let mut snapshot = wire();
        snapshot.observed_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let response = serde_json::json!({"version":1,"snapshot":snapshot}).to_string();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            mock_once(stream, "acceptance-token", response, Duration::ZERO).await;
        });
        let client =
            LocalObserverClient::new(socket, "acceptance-token".into(), Duration::from_secs(1))
                .unwrap();
        let wallet = crate::wallet::ObserverWallet::new(client);
        assert_eq!(wallet.read_only_snapshot().await.unwrap().chain_height, 100);
        server.await.unwrap();
        fs::remove_dir_all(dir).unwrap();
    }
}
