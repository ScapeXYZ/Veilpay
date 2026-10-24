//! Strict parsers for the pinned CLI plus scripts/patches/zingo-structured-transport.patch.
//! No memos, keys, or wallet-wide raw history leave this boundary.
use crate::wallet::Network;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WalletError {
    Unsupported,
    Configuration,
    Busy,
    Unavailable,
    InvalidOutput,
    FeeLimit,
}
impl std::fmt::Display for WalletError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "wallet operation unavailable ({self:?})")
    }
}
impl std::error::Error for WalletError {}
pub type WalletResult<T> = Result<T, WalletError>;
pub type DataFuture<'a, T> =
    std::pin::Pin<Box<dyn std::future::Future<Output = WalletResult<T>> + Send + 'a>>;
pub fn json(raw: &[u8]) -> WalletResult<Value> {
    serde_json::from_slice(raw).map_err(|_| WalletError::InvalidOutput)
}
pub fn txid(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}
fn str_field<'a>(v: &'a Value, key: &str) -> WalletResult<&'a str> {
    v[key].as_str().ok_or(WalletError::InvalidOutput)
}
fn number(v: &Value, key: &str) -> WalletResult<u64> {
    v[key].as_u64().ok_or(WalletError::InvalidOutput)
}
pub fn amount(v: &Value, key: &str) -> WalletResult<i64> {
    let n = number(v, key)?;
    if n > 2_100_000_000_000_000 {
        return Err(WalletError::InvalidOutput);
    }
    Ok(n as i64)
}
pub fn orchard_address(v: &Value) -> WalletResult<String> {
    let a = str_field(v, "encoded_address")?;
    if !a.starts_with("utest1")
        || a.len() > 512
        || !a
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        || v["has_orchard"] != true
        || v["has_sapling"] != false
        || v["has_transparent"] != false
    {
        return Err(WalletError::InvalidOutput);
    }
    Ok(a.into())
}
pub fn prepared_ids(v: &Value) -> WalletResult<String> {
    let ids = v["txids"].as_array().ok_or(WalletError::InvalidOutput)?;
    // Multi-step/TEX transactions are not supported by this integration.
    if ids.len() != 1 {
        return Err(WalletError::Unsupported);
    }
    let id = ids[0].as_str().ok_or(WalletError::InvalidOutput)?;
    if !txid(id) {
        return Err(WalletError::InvalidOutput);
    }
    Ok(id.into())
}
pub fn check_server(v: &Value) -> WalletResult<()> {
    if v["chain_name"] != "test" || number(v, "latest_block_height")? == 0 {
        return Err(WalletError::InvalidOutput);
    }
    Ok(())
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReceivedOutput {
    pub txid: String,
    pub index: u64,
    pub address: String,
    pub amount_zat: i64,
    pub timestamp: i64,
    pub status: String,
    pub height: u64,
}
#[derive(Clone, Debug)]
pub struct History {
    pub network: Network,
    pub tip: u64,
    pub scanned: u64,
    pub received: Vec<ReceivedOutput>,
    pub sent: Vec<SentTransaction>,
}
#[derive(Clone, Debug)]
pub struct SentTransaction {
    pub fee_zat: Option<i64>,
    pub unsupported_outputs: bool,
    pub txid: String,
    pub status: String,
    pub height: u64,
    pub recipients: Vec<(String, i64)>,
}
impl History {
    pub fn parse(v: &Value) -> WalletResult<Self> {
        if v["veilpay_schema"] != 1 || v["network"] != "testnet" {
            return Err(WalletError::InvalidOutput);
        }
        let tip = number(v, "tip_height")?;
        let scanned = number(v, "scanned_height")?;
        if tip == 0 || scanned != tip {
            return Err(WalletError::InvalidOutput);
        }
        let mut received = Vec::new();
        for o in v["received_outputs"]
            .as_array()
            .ok_or(WalletError::InvalidOutput)?
        {
            let id = str_field(o, "txid")?;
            if !txid(id) {
                return Err(WalletError::InvalidOutput);
            }
            let status = str_field(o, "status")?;
            if ![
                "confirmed",
                "mempool",
                "transmitted",
                "calculated",
                "failed",
            ]
            .contains(&status)
            {
                return Err(WalletError::InvalidOutput);
            }
            let height = number(o, "blockheight")?;
            if status == "confirmed" && (height == 0 || height > tip) {
                return Err(WalletError::InvalidOutput);
            }
            received.push(ReceivedOutput {
                txid: id.into(),
                index: number(o, "output_index")?,
                address: str_field(o, "address")?.into(),
                amount_zat: amount(o, "value")?,
                timestamp: i64::try_from(number(o, "datetime")?)
                    .map_err(|_| WalletError::InvalidOutput)?,
                status: status.into(),
                height,
            });
        }
        let mut sent = Vec::new();
        for t in v["transaction_summaries"]
            .as_array()
            .ok_or(WalletError::InvalidOutput)?
        {
            if t["kind"] != "sent" {
                continue;
            }
            let id = str_field(t, "txid")?;
            if !txid(id) {
                return Err(WalletError::InvalidOutput);
            }
            let mut recipients = Vec::new();
            for o in t["outgoing_orchard_notes"]
                .as_array()
                .ok_or(WalletError::InvalidOutput)?
            {
                match o["scope"].as_str() {
                    Some("internal") => continue,
                    Some("external") => {}
                    _ => return Err(WalletError::InvalidOutput),
                }
                let a = o["recipient_unified_address"]
                    .as_str()
                    .or_else(|| o["recipient"].as_str())
                    .ok_or(WalletError::InvalidOutput)?;
                recipients.push((a.into(), amount(o, "value")?));
            }
            let unsupported_outputs = [
                "outgoing_sapling_notes",
                "outgoing_ironwood_notes",
                "outgoing_transparent_coins",
            ]
            .iter()
            .any(|key| t[key].as_array().is_none_or(|values| !values.is_empty()));
            let fee_zat = if t["fee"].is_null() {
                None
            } else {
                Some(amount(t, "fee")?)
            };
            sent.push(SentTransaction {
                fee_zat,
                unsupported_outputs,
                txid: id.into(),
                status: str_field(t, "status")?.into(),
                height: number(t, "blockheight")?,
                recipients,
            });
        }
        Ok(Self {
            network: Network::Testnet,
            tip,
            scanned,
            received,
            sent,
        })
    }
}

/// Match only merchant-decrypted outputs. Sender status is never receipt evidence.
pub fn match_invoice(
    history: &History,
    invoice: &Value,
    expected_txid: Option<&str>,
    required: u64,
    previous: Option<&Value>,
    now: i64,
) -> WalletResult<Value> {
    if history.network != Network::Testnet
        || invoice["network"] != "testnet"
        || required == 0
        || history.scanned != history.tip
    {
        return Err(WalletError::InvalidOutput);
    }
    let address = str_field(invoice, "payTo")?;
    let expected = invoice["amountZat"]
        .as_str()
        .and_then(|v| v.parse::<i64>().ok())
        .ok_or(WalletError::InvalidOutput)?;
    let expiry = chrono::DateTime::parse_from_rfc3339(str_field(invoice, "expiresAt")?)
        .map_err(|_| WalletError::InvalidOutput)?
        .timestamp();
    let mut outputs = BTreeMap::new();
    let mut conflict = false;
    for o in history.received.iter().filter(|o| o.address == address) {
        if let Some(old) = outputs.insert((o.txid.clone(), o.index), o)
            && old != o
        {
            conflict = true;
        }
    }
    let ids: std::collections::BTreeSet<_> = outputs.values().map(|o| o.txid.as_str()).collect();
    let mut state = if now >= expiry { "expired" } else { "not_seen" };
    let mut total = 0i64;
    let mut confirmations = 0;
    let mut late = false;
    let mut height = 0;
    let mut matched_id = None;
    if conflict {
        state = "conflicting";
    } else if ids.len() > 1 {
        state = "duplicate";
    } else if let Some(id) = ids.first() {
        matched_id = Some(*id);
        if expected_txid.is_some_and(|expected| expected != *id) {
            state = "conflicting";
        } else {
            let mut all_confirmed = true;
            let mut timestamp = 0;
            let mut status = None;
            for o in outputs.values() {
                total = total
                    .checked_add(o.amount_zat)
                    .ok_or(WalletError::InvalidOutput)?;
                if status.is_some_and(|s| s != o.status.as_str())
                    || (height != 0 && height != o.height)
                {
                    conflict = true;
                }
                status = Some(o.status.as_str());
                height = o.height;
                timestamp = timestamp.max(o.timestamp);
                all_confirmed &= o.status == "confirmed";
            }
            if conflict {
                state = "conflicting";
            } else if matches!(status, Some("failed" | "calculated")) {
                state = "not_seen";
            } else {
                if all_confirmed {
                    confirmations = history
                        .tip
                        .checked_sub(height)
                        .ok_or(WalletError::InvalidOutput)?
                        + 1;
                    late = timestamp > expiry;
                }
                state = if total < expected {
                    "underpaid"
                } else if total > expected {
                    "amount_mismatch"
                } else if expected_txid.is_none() || confirmations < required {
                    "pending"
                } else if late {
                    "late"
                } else {
                    "received"
                };
            }
        }
    }
    if let Some(old) = previous {
        let was_received = matches!(old["state"].as_str(), Some("received" | "late"));
        let rolled_back = history.tip < old["tipHeight"].as_u64().unwrap_or(0)
            || (was_received
                && !matches!(
                    state,
                    "duplicate" | "conflicting" | "underpaid" | "amount_mismatch"
                )
                && (!matches!(state, "received" | "late")
                    || old["blockHeight"].as_u64() != Some(height)
                    || old["txid"].as_str() != matched_id));
        if rolled_back {
            state = "reorged";
        }
    }
    Ok(
        serde_json::json!({"invoiceId":invoice["id"],"state":state,"expectedZat":expected.to_string(),"receivedZat":total.to_string(),"confirmations":confirmations,"confirmationsRequired":required,"late":late,"txid":matched_id,"blockHeight":height,"tipHeight":history.tip,"network":"testnet","method":"merchant_wallet_scan","mock":false,"acknowledgmentEligible":matches!(state,"received"|"late"),"acknowledgmentValid":false}),
    )
}
