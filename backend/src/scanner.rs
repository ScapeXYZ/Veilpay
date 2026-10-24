//! Viewing-only scanner seam. It deliberately contains no key material, transaction
//! construction, signing, or network transport; those stay inside a future observer daemon.
use crate::wallet::Network;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewingKeyKind {
    UnifiedIncoming,
    UnifiedFull,
}

/// A key reference is opaque to VeilPay. The observer resolves it from its private store.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ViewingKeyReference {
    pub source_id: String,
    pub kind: ViewingKeyKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompactBlockFixture {
    pub height: u64,
    pub hash: [u8; 32],
    pub previous_hash: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanRequest {
    pub network: Network,
    pub key: ViewingKeyReference,
    pub blocks: Vec<CompactBlockFixture>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanResult {
    pub scanned_height: u64,
    pub tip_hash: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScanError {
    WrongNetwork,
    EmptyKeyReference,
    EmptyBatch,
    NonContiguous,
    RewindRequired,
}

/// This interface is intentionally unable to construct, sign, or submit transactions.
pub trait ViewingOnlyScanner {
    fn scan(&mut self, request: ScanRequest) -> Result<ScanResult, ScanError>;
}

/// Synthetic scanner used only to test chain-continuity and reorg semantics before a
/// separately reviewed librustzcash observer is introduced.
#[derive(Default)]
pub struct FixtureScanner {
    tip: Option<(u64, [u8; 32])>,
}

impl ViewingOnlyScanner for FixtureScanner {
    fn scan(&mut self, request: ScanRequest) -> Result<ScanResult, ScanError> {
        if request.network != Network::Mainnet {
            return Err(ScanError::WrongNetwork);
        }
        if request.key.source_id.is_empty() {
            return Err(ScanError::EmptyKeyReference);
        }
        let first = request.blocks.first().ok_or(ScanError::EmptyBatch)?;
        if let Some((height, hash)) = self.tip {
            if first.height != height + 1 {
                return Err(ScanError::NonContiguous);
            }
            if first.previous_hash != hash {
                return Err(ScanError::RewindRequired);
            }
        }
        for pair in request.blocks.windows(2) {
            if pair[1].height != pair[0].height + 1 || pair[1].previous_hash != pair[0].hash {
                return Err(ScanError::NonContiguous);
            }
        }
        let last = request.blocks.last().expect("non-empty checked");
        self.tip = Some((last.height, last.hash));
        Ok(ScanResult {
            scanned_height: last.height,
            tip_hash: last.hash,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(height: u64, previous: u8, hash: u8) -> CompactBlockFixture {
        CompactBlockFixture {
            height,
            previous_hash: [previous; 32],
            hash: [hash; 32],
        }
    }
    fn request(blocks: Vec<CompactBlockFixture>) -> ScanRequest {
        ScanRequest {
            network: Network::Mainnet,
            key: ViewingKeyReference {
                source_id: "operator-key-reference".into(),
                kind: ViewingKeyKind::UnifiedIncoming,
            },
            blocks,
        }
    }
    #[test]
    fn synthetic_scanner_accepts_continuous_mainnet_blocks() {
        let mut scanner = FixtureScanner::default();
        let result = scanner
            .scan(request(vec![block(1, 0, 1), block(2, 1, 2)]))
            .unwrap();
        assert_eq!(result.scanned_height, 2);
        assert_eq!(result.tip_hash, [2; 32]);
    }
    #[test]
    fn synthetic_scanner_rejects_network_and_malformed_batches() {
        let mut scanner = FixtureScanner::default();
        let mut bad_network = request(vec![block(1, 0, 1)]);
        bad_network.network = Network::Testnet;
        assert_eq!(scanner.scan(bad_network), Err(ScanError::WrongNetwork));
        assert_eq!(
            scanner.scan(request(vec![block(1, 0, 1), block(3, 1, 3)])),
            Err(ScanError::NonContiguous)
        );
        let mut empty_key = request(vec![block(1, 0, 1)]);
        empty_key.key.source_id.clear();
        assert_eq!(scanner.scan(empty_key), Err(ScanError::EmptyKeyReference));
    }
    #[test]
    fn synthetic_scanner_requests_rewind_for_reorganization() {
        let mut scanner = FixtureScanner::default();
        scanner.scan(request(vec![block(1, 0, 1)])).unwrap();
        assert_eq!(
            scanner.scan(request(vec![block(2, 9, 2)])),
            Err(ScanError::RewindRequired)
        );
    }
}
