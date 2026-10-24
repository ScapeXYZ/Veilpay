//! Testnet-only, allowlisted Zingo process transport. No shell or recovery commands.
use crate::wallet::{Network, SendIntent};
use crate::zcash::*;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub const PIN: &str = "6d43e7c48343cc39cf99bad7e05349baaf4f0b90";
const LIMIT: u64 = 8 * 1024 * 1024;
#[derive(Clone, Copy, Debug)]
pub enum Role {
    Customer,
    Merchant,
}
impl Role {
    fn directory(self) -> &'static str {
        match self {
            Self::Customer => "customer",
            Self::Merchant => "merchant",
        }
    }
}
#[derive(Clone, Debug)]
pub enum Operation {
    SyncHistory,
    Address,
    Balance,
    Prepare {
        destination: String,
        amount: i64,
        max_fee: i64,
    },
    Transmit {
        txid: String,
    },
}
pub trait CliRunner: Send + Sync {
    fn run<'a>(&'a self, role: Role, operation: Operation) -> DataFuture<'a, Value>;
}
#[derive(Clone)]
pub struct TestnetTransport {
    runner: Arc<dyn CliRunner>,
}
impl TestnetTransport {
    pub fn with_runner(runner: Arc<dyn CliRunner>) -> Self {
        Self { runner }
    }
    pub fn from_root(root: PathBuf) -> Self {
        Self {
            runner: Arc::new(ProcessRunner { root }),
        }
    }
    pub async fn address(&self) -> WalletResult<String> {
        orchard_address(&self.runner.run(Role::Merchant, Operation::Address).await?)
    }
    pub async fn balance(&self, role: Role) -> WalletResult<Value> {
        let v = self.runner.run(role, Operation::Balance).await?;
        let mut result = json!({});
        for key in [
            "confirmed_orchard_balance",
            "unconfirmed_orchard_balance",
            "total_orchard_balance",
        ] {
            result[key] = json!(amount(&v, key)?.to_string());
        }
        Ok(result)
    }
    pub async fn history(&self, role: Role) -> WalletResult<History> {
        History::parse(&self.runner.run(role, Operation::SyncHistory).await?)
    }
    pub async fn prepare(&self, intent: &SendIntent, max_fee: i64) -> WalletResult<(String, i64)> {
        if intent.network != Network::Testnet
            || !intent.destination.starts_with("utest1")
            || !(1..=2_100_000_000_000_000).contains(&intent.amount_zat)
            || max_fee < 0
        {
            return Err(WalletError::Configuration);
        }
        let v = self
            .runner
            .run(
                Role::Customer,
                Operation::Prepare {
                    destination: intent.destination.clone(),
                    amount: intent.amount_zat,
                    max_fee,
                },
            )
            .await?;
        let fee = amount(&v, "fee")?;
        if fee > max_fee {
            return Err(WalletError::FeeLimit);
        }
        Ok((prepared_ids(&v)?, fee))
    }
    pub async fn transmit(&self, id: &str) -> WalletResult<String> {
        if !txid(id) {
            return Err(WalletError::Configuration);
        }
        let observed = prepared_ids(
            &self
                .runner
                .run(Role::Customer, Operation::Transmit { txid: id.into() })
                .await?,
        )?;
        if observed != id {
            return Err(WalletError::InvalidOutput);
        }
        Ok(observed)
    }
}
struct ProcessRunner {
    root: PathBuf,
}
struct Process {
    child: tokio::process::Child,
}
impl Drop for Process {
    fn drop(&mut self) {
        // Kill the entire process group (including a proxy) on cancellation/timeout.
        if let Some(pid) = self.child.id() {
            let _ = std::process::Command::new("/bin/kill")
                .args(["-KILL", "--", &format!("-{pid}")])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }
}
impl ProcessRunner {
    fn validate(&self, role: Role) -> WalletResult<(PathBuf, File)> {
        let root = self
            .root
            .canonicalize()
            .map_err(|_| WalletError::Configuration)?;
        let repo = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or(WalletError::Configuration)?;
        if root.starts_with(repo)
            || std::fs::metadata(&root)
                .map_err(|_| WalletError::Configuration)?
                .permissions()
                .mode()
                & 0o077
                != 0
        {
            return Err(WalletError::Configuration);
        }
        let wallet = root.join(role.directory());
        if wallet
            .canonicalize()
            .map_err(|_| WalletError::Configuration)?
            != wallet
        {
            return Err(WalletError::Configuration);
        }
        let dat = std::fs::symlink_metadata(wallet.join("zingo-wallet.dat"))
            .map_err(|_| WalletError::Configuration)?;
        if !dat.is_file() || dat.permissions().mode() & 0o077 != 0 {
            return Err(WalletError::Configuration);
        }
        use std::os::unix::fs::MetadataExt;
        let other = root
            .join(match role {
                Role::Customer => "merchant",
                Role::Merchant => "customer",
            })
            .join("zingo-wallet.dat");
        if std::fs::symlink_metadata(other)
            .is_ok_and(|m| m.dev() == dat.dev() && m.ino() == dat.ino())
        {
            return Err(WalletError::Configuration);
        }
        for name in [
            "source-revision",
            "source-patch-checksum",
            "transport-patch-checksum",
            "binary-checksums",
        ] {
            if !std::fs::symlink_metadata(root.join(name))
                .map_err(|_| WalletError::Configuration)?
                .is_file()
            {
                return Err(WalletError::Configuration);
            }
        }
        // Never read the wallet file, mnemonic metadata, or viewing/spending keys here.
        if std::fs::read_to_string(root.join("source-revision"))
            .map_err(|_| WalletError::Configuration)?
            .trim()
            != PIN
        {
            return Err(WalletError::Configuration);
        }
        let checksum = format!(
            "{:x}",
            Sha256::digest(include_bytes!(
                "../../scripts/patches/zingo-structured-transport.patch"
            ))
        );
        if std::fs::read_to_string(root.join("transport-patch-checksum"))
            .map_err(|_| WalletError::Configuration)?
            .split_whitespace()
            .next()
            != Some(checksum.as_str())
        {
            return Err(WalletError::Configuration);
        }
        let sync_checksum = format!(
            "{:x}",
            Sha256::digest(include_bytes!("../../scripts/patches/zingo-waitsync.patch"))
        );
        if std::fs::read_to_string(root.join("source-patch-checksum"))
            .map_err(|_| WalletError::Configuration)?
            .split_whitespace()
            .next()
            != Some(sync_checksum.as_str())
        {
            return Err(WalletError::Configuration);
        }
        let checks = std::fs::read_to_string(root.join("binary-checksums"))
            .map_err(|_| WalletError::Configuration)?;
        for name in ["zingo-cli", "nym-proxy"] {
            let path = root.join("bin").join(name);
            if path
                .canonicalize()
                .map_err(|_| WalletError::Configuration)?
                != path
            {
                return Err(WalletError::Configuration);
            }
            let mut file = File::open(&path).map_err(|_| WalletError::Configuration)?;
            let mut hash = Sha256::new();
            let mut buffer = [0u8; 65536];
            loop {
                let n = std::io::Read::read(&mut file, &mut buffer)
                    .map_err(|_| WalletError::Configuration)?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            let digest = format!("{:x}", hash.finalize());
            if !checks.lines().any(|l| {
                l.split_whitespace().next() == Some(digest.as_str())
                    && l.split_whitespace().nth(1) == path.to_str()
            }) {
                return Err(WalletError::Configuration);
            }
        }
        let log = root.join("transport-private.log");
        if std::fs::symlink_metadata(&log)
            .is_ok_and(|m| !m.is_file() || m.permissions().mode() & 0o077 != 0)
        {
            return Err(WalletError::Configuration);
        }
        OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(log)
            .map_err(|_| WalletError::Configuration)?;
        let lockpath = root.join("sync.lock");
        if std::fs::symlink_metadata(&lockpath).is_ok_and(|m| !m.is_file()) {
            return Err(WalletError::Configuration);
        }
        let lock = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(lockpath)
            .map_err(|_| WalletError::Configuration)?;
        lock.try_lock().map_err(|_| WalletError::Busy)?;
        Ok((root, lock))
    }
    fn command(root: &Path, role: Role, online: bool) -> tokio::process::Command {
        let mut c = tokio::process::Command::new(root.join("bin/zingo-cli"));
        c.env_clear().env("PATH", "/usr/bin:/bin");
        // Preserve the real home for public proving-parameter caches; never propagate ZINGO_SEED.
        if let Some(home) = std::env::var_os("HOME") {
            c.env("HOME", home);
        }
        c.current_dir(root)
            .args(["--chain", "testnet", "--data-dir"])
            .arg(root.join(role.directory()))
            .arg("--log-file")
            .arg(root.join("transport-private.log"));
        if online {
            c.args([
                "--server",
                "https://testnet.zec.rocks:443",
                "--waitsync",
                "--nym-proxy",
            ])
            .arg(root.join("bin/nym-proxy"));
        } else {
            c.arg("--offline");
        }
        c.process_group(0);
        c.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        c
    }
    async fn one(root: &Path, role: Role, online: bool, args: &[&str]) -> WalletResult<Value> {
        let mut c = Self::command(root, role, online);
        c.args(args);
        let mut p = Process {
            child: c.spawn().map_err(|_| WalletError::Unavailable)?,
        };
        let stdout = p.child.stdout.take().ok_or(WalletError::Unavailable)?;
        let mut data = Vec::new();
        stdout
            .take(LIMIT + 1)
            .read_to_end(&mut data)
            .await
            .map_err(|_| WalletError::Unavailable)?;
        if data.len() as u64 > LIMIT {
            return Err(WalletError::InvalidOutput);
        }
        if !p
            .child
            .wait()
            .await
            .map_err(|_| WalletError::Unavailable)?
            .success()
        {
            return Err(WalletError::Unavailable);
        }
        json(&data)
    }
    async fn response(stdout: &mut BufReader<tokio::process::ChildStdout>) -> WalletResult<Value> {
        let mut line = Vec::new();
        stdout
            .take(65537)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| WalletError::Unavailable)?;
        if line.len() > 65536 {
            return Err(WalletError::InvalidOutput);
        }
        let envelope = json(&line)?;
        if envelope["ok"] != true {
            return Err(WalletError::Unavailable);
        }
        json(
            envelope["output"]
                .as_str()
                .ok_or(WalletError::InvalidOutput)?
                .as_bytes(),
        )
    }
    async fn prepare(
        root: &Path,
        destination: &str,
        zat: i64,
        max_fee: i64,
    ) -> WalletResult<Value> {
        // An offline persistent session is necessary: send's proposal is in memory.
        if !destination.starts_with("utest1")
            || !destination
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        {
            return Err(WalletError::Configuration);
        }
        let mut c = Self::command(root, Role::Customer, false);
        c.env("VEILPAY_MACHINE", "1").stdin(Stdio::piped());
        let mut p = Process {
            child: c.spawn().map_err(|_| WalletError::Unavailable)?,
        };
        let mut input = p.child.stdin.take().ok_or(WalletError::Unavailable)?;
        let mut output = BufReader::new(p.child.stdout.take().ok_or(WalletError::Unavailable)?);
        input
            .write_all(format!("send {destination} {zat}\n").as_bytes())
            .await
            .map_err(|_| WalletError::Unavailable)?;
        let proposal = Self::response(&mut output).await?;
        let fee = amount(&proposal, "fee")?;
        if fee > max_fee {
            return Err(WalletError::FeeLimit);
        }
        input
            .write_all(b"calculate\n")
            .await
            .map_err(|_| WalletError::Unavailable)?;
        let mut prepared = Self::response(&mut output).await?;
        prepared_ids(&prepared)?;
        // Quit persists the signed transaction. It never transmits in this session.
        input
            .write_all(b"quit\n")
            .await
            .map_err(|_| WalletError::Unavailable)?;
        drop(input);
        let mut trailer = Vec::new();
        output
            .take(65537)
            .read_to_end(&mut trailer)
            .await
            .map_err(|_| WalletError::Unavailable)?;
        if trailer.len() > 65536
            || !p
                .child
                .wait()
                .await
                .map_err(|_| WalletError::Unavailable)?
                .success()
        {
            return Err(WalletError::Unavailable);
        }
        // Inspect the persisted signed transaction before it can be approved for
        // transmission. Refuse donations, extra recipients, unknown fees or pools.
        let signed_id = prepared_ids(&prepared)?;
        let history =
            History::parse(&Self::one(root, Role::Customer, false, &["transactions"]).await?)?;
        let matches: Vec<_> = history
            .sent
            .iter()
            .filter(|t| t.txid == signed_id)
            .collect();
        if matches.len() != 1 {
            return Err(WalletError::Unsupported);
        }
        let transaction = matches[0];
        if transaction.status != "calculated"
            || transaction.fee_zat != Some(fee)
            || transaction.unsupported_outputs
            || transaction.recipients.iter().any(|(a, _)| a != destination)
            || transaction
                .recipients
                .iter()
                .try_fold(0i64, |sum, (_, value)| sum.checked_add(*value))
                != Some(zat)
        {
            return Err(WalletError::Unsupported);
        }
        prepared["fee"] = json!(fee);
        Ok(prepared)
    }
}
impl CliRunner for ProcessRunner {
    fn run<'a>(&'a self, role: Role, operation: Operation) -> DataFuture<'a, Value> {
        Box::pin(async move {
            let (root, _lock) = self.validate(role)?;
            tokio::time::timeout(Duration::from_secs(180), async {
                match operation {
                    Operation::Address => {
                        Self::one(&root, role, false, &["new_address", "o"]).await
                    }
                    Operation::Balance => Self::one(&root, role, false, &["balance"]).await,
                    Operation::SyncHistory => {
                        let info = Self::one(&root, role, true, &["info"]).await?;
                        check_server(&info)?;
                        Self::one(&root, role, true, &["transactions"]).await
                    }
                    Operation::Prepare {
                        destination,
                        amount,
                        max_fee,
                    } => Self::prepare(&root, &destination, amount, max_fee).await,
                    Operation::Transmit { txid } => {
                        let info = Self::one(&root, role, true, &["info"]).await?;
                        check_server(&info)?;
                        Self::one(&root, role, true, &["transmit", &txid]).await
                    }
                }
            })
            .await
            .map_err(|_| WalletError::Unavailable)?
        })
    }
}
