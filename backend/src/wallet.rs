//! Wallet boundary. No shell, recovery commands, key material, or live send implementation.
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
pub type WalletFuture<'a> = Pin<Box<dyn Future<Output = WalletOutcome> + Send + 'a>>;

/// Trusted, server-side adapters only. Never accept reconciliation evidence from API callers.
pub trait WalletAdapter: Send + Sync {
    fn network(&self) -> Network;
    fn submit<'a>(&'a self, intent: &'a SendIntent) -> WalletFuture<'a>;
    /// Read-only: never creates, submits, retries, or abandons a transaction.
    fn observe<'a>(&'a self, intent: &'a SendIntent) -> WalletFuture<'a>;
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
