//! Typed wallet boundaries. HTTP submission is disabled; real testnet transport uses the separate operator flow.
use std::{future::Future, pin::Pin};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Network {
    Testnet,
    Mainnet,
    Regtest,
}
impl Network {
    pub fn parse(value: &str) -> Result<Self, &'static str> {
        match value {
            "testnet" => Ok(Self::Testnet),
            "mainnet" => Ok(Self::Mainnet),
            "regtest" => Ok(Self::Regtest),
            _ => Err("Invalid NETWORK"),
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Testnet => "testnet",
            Self::Mainnet => "mainnet",
            Self::Regtest => "regtest",
        }
    }
}

#[derive(Clone, Debug)]
pub struct SendIntent {
    pub operation_id: String,
    pub payment_id: String,
    pub network: Network,
    pub destination: String,
    pub amount_zat: i64,
    pub expected_txid: Option<String>,
}

/// BroadcastDisabled is conclusive only when returned directly from submission,
/// before any transaction was created.
/// Transport errors, panics, cancellation and missing history are always Unknown.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PreCreationRejection {
    InsufficientFunds,
    InvalidDestination,
}
impl PreCreationRejection {
    pub fn code(self) -> &'static str {
        match self {
            Self::InsufficientFunds => "INSUFFICIENT_FUNDS",
            Self::InvalidDestination => "INVALID_DESTINATION",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WalletOutcome {
    Broadcast { txid: String },
    Mined { txid: String, confirmations: u32 },
    BroadcastDisabled,
    RejectedBeforeCreation(PreCreationRejection),
    Unknown,
}
#[derive(Clone, Debug)]
pub struct ReadOnlySnapshot {
    pub address: String,
    pub available_zat: i64,
    pub sync_height: u64,
    pub chain_height: u64,
    /// Wallet-reported observations are not independent chain proof.
    pub observations: crate::zcash::History,
}
pub type WalletFuture<'a> = Pin<Box<dyn Future<Output = WalletOutcome> + Send + 'a>>;

/// Trusted, server-side adapters only. Never accept reconciliation evidence from API callers.
pub trait WalletAdapter: Send + Sync {
    fn network(&self) -> Network;
    fn submit<'a>(&'a self, intent: &'a SendIntent) -> WalletFuture<'a>;
    /// Read-only: never creates, submits, retries, or abandons a transaction.
    fn observe<'a>(&'a self, intent: &'a SendIntent) -> WalletFuture<'a>;
    fn requires_operator(&self) -> bool {
        false
    }
    /// Read-only data from a dedicated viewing wallet. Implementations must never
    /// prepare, sign, submit, or create wallets as a side effect.
    fn read_only_snapshot(&self) -> crate::zcash::DataFuture<'_, ReadOnlySnapshot> {
        Box::pin(async { Err(crate::zcash::WalletError::Unsupported) })
    }
    fn receiving_address(&self) -> crate::zcash::DataFuture<'_, String> {
        Box::pin(async { Err(crate::zcash::WalletError::Unsupported) })
    }
    fn merchant_history(&self) -> crate::zcash::DataFuture<'_, crate::zcash::History> {
        Box::pin(async { Err(crate::zcash::WalletError::Unsupported) })
    }
    fn prepare<'a>(
        &'a self,
        _intent: &'a SendIntent,
        _max_fee: i64,
    ) -> crate::zcash::DataFuture<'a, (String, i64)> {
        Box::pin(async { Err(crate::zcash::WalletError::Unsupported) })
    }
    fn transmit<'a>(&'a self, _txid: &'a str) -> crate::zcash::DataFuture<'a, String> {
        Box::pin(async { Err(crate::zcash::WalletError::Unsupported) })
    }
}

/// Network-separated Zingo boundary based on the existing pinned CLI integration.
/// This build deliberately contains no subprocess or broadcast transport. In particular,
/// constructing or calling it cannot open a wallet or implicitly create one via the CLI.
/// Independent transaction-history parsing remains unavailable, so absence is Unknown.
pub struct ZingoWallet {
    network: Network,
}
impl ZingoWallet {
    pub fn new(network: Network) -> Self {
        Self { network }
    }
}
impl WalletAdapter for ZingoWallet {
    fn network(&self) -> Network {
        self.network
    }
    fn submit<'a>(&'a self, intent: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async move {
            if intent.network != self.network {
                WalletOutcome::Unknown
            } else {
                WalletOutcome::BroadcastDisabled
            }
        })
    }
    fn observe<'a>(&'a self, _intent: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async { WalletOutcome::Unknown })
    }
}

/// The API cannot submit through this adapter. Only the separate operator CLI calls
/// prepare/transmit; observation never signs or broadcasts.
pub struct CliWallet {
    transport: crate::transport::TestnetTransport,
}
impl CliWallet {
    pub fn new(transport: crate::transport::TestnetTransport) -> Self {
        Self { transport }
    }
}
impl WalletAdapter for CliWallet {
    fn network(&self) -> Network {
        Network::Testnet
    }
    fn requires_operator(&self) -> bool {
        true
    }
    fn submit<'a>(&'a self, _intent: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async { WalletOutcome::BroadcastDisabled })
    }
    fn observe<'a>(&'a self, intent: &'a SendIntent) -> WalletFuture<'a> {
        Box::pin(async move {
            if intent.network != Network::Testnet {
                return WalletOutcome::Unknown;
            }
            let Some(expected) = &intent.expected_txid else {
                return WalletOutcome::Unknown;
            };
            let Ok(history) = self
                .transport
                .history(crate::transport::Role::Customer)
                .await
            else {
                return WalletOutcome::Unknown;
            };
            let matches: Vec<_> = history
                .sent
                .iter()
                .filter(|t| &t.txid == expected)
                .collect();
            if matches.len() != 1 {
                return WalletOutcome::Unknown;
            }
            let tx = matches[0];
            if tx.unsupported_outputs
                || tx
                    .recipients
                    .iter()
                    .any(|(address, _)| address != &intent.destination)
            {
                return WalletOutcome::Unknown;
            }
            let exact = tx
                .recipients
                .iter()
                .filter(|(a, _)| a == &intent.destination)
                .try_fold(0i64, |n, (_, v)| n.checked_add(*v));
            if exact != Some(intent.amount_zat) {
                return WalletOutcome::Unknown;
            }
            if tx.status == "confirmed" && tx.height > 0 && tx.height <= history.tip {
                return WalletOutcome::Mined {
                    txid: expected.clone(),
                    confirmations: u32::try_from(history.tip - tx.height + 1).unwrap_or(u32::MAX),
                };
            }
            if matches!(tx.status.as_str(), "transmitted" | "mempool") {
                return WalletOutcome::Broadcast {
                    txid: expected.clone(),
                };
            }
            WalletOutcome::Unknown
        })
    }
    /// Read-only data from a dedicated viewing wallet. Implementations must never
    /// prepare, sign, submit, or create wallets as a side effect.
    fn read_only_snapshot(&self) -> crate::zcash::DataFuture<'_, ReadOnlySnapshot> {
        Box::pin(async { Err(crate::zcash::WalletError::Unsupported) })
    }
    fn receiving_address(&self) -> crate::zcash::DataFuture<'_, String> {
        Box::pin(async { self.transport.address().await })
    }
    fn merchant_history(&self) -> crate::zcash::DataFuture<'_, crate::zcash::History> {
        Box::pin(async {
            self.transport
                .history(crate::transport::Role::Merchant)
                .await
        })
    }
    fn prepare<'a>(
        &'a self,
        intent: &'a SendIntent,
        max_fee: i64,
    ) -> crate::zcash::DataFuture<'a, (String, i64)> {
        Box::pin(async move { self.transport.prepare(intent, max_fee).await })
    }
    fn transmit<'a>(&'a self, id: &'a str) -> crate::zcash::DataFuture<'a, String> {
        Box::pin(async move { self.transport.transmit(id).await })
    }
}
