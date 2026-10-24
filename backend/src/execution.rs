use super::*;

impl App {
    pub(crate) async fn operation_intent(&self, op: &str) -> Result<SendIntent> {
        let row = sqlx::query("SELECT payment_id,network,destination,amount_zat,txid FROM wallet_operations WHERE id=? AND backend='zingo' AND network=?")
            .bind(op).bind(&self.config.network).fetch_optional(&self.pool).await?.ok_or(ApiError(404,"NOT_FOUND"))?;
        Ok(SendIntent {
            operation_id: op.into(),
            payment_id: row.get(0),
            network: Network::parse(row.get::<&str, _>(1)).map_err(|_| invalid())?,
            destination: row.get(2),
            amount_zat: row.get(3),
            expected_txid: row.get(4),
        })
    }

    pub(crate) async fn dispatch_wallet_operation(&self, op: &str) -> Result<()> {
        let intent = self.operation_intent(op).await?;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let changed = sqlx::query("UPDATE wallet_operations SET state='unknown',updated_at=? WHERE id=? AND state='pending' AND network=?")
            .bind(now()).bind(op).bind(&self.config.network).execute(&mut *tx).await?.rows_affected();
        if changed == 0 {
            return Ok(());
        }
        let mut payment = owned(&mut tx, "payment", &intent.payment_id, "customer_demo").await?;
        payment["walletOperation"]["state"] = json!("unknown");
        payment["failure"] = json!({"code":"OUTCOME_UNKNOWN","definitive":false,"retriable":false,"message":"Outcome unresolved; reservation held; never automatically resent"});
        put(
            &mut tx,
            "payment",
            &intent.payment_id,
            "customer_demo",
            &payment,
        )
        .await?;
        tx.commit().await?;
        // This commit is the single dispatch claim. Cancellation after it is ambiguous,
        // even when cancellation occurred before the adapter actually created anything.
        let outcome =
            if intent.network == Network::Mainnet || intent.destination.starts_with("mock-only:") {
                WalletOutcome::BroadcastDisabled
            } else if let Some(adapter) = &self.wallet {
                tokio::time::timeout(StdDuration::from_secs(30), adapter.submit(&intent))
                    .await
                    .unwrap_or(WalletOutcome::Unknown)
            } else {
                WalletOutcome::Unknown
            };
        self.apply_wallet_outcome(&intent, outcome, true).await
    }

    /// Read-only reconciliation for a scheduler/operator. It NEVER calls submit.
    /// There is intentionally no client-supplied evidence or HTTP reconciliation route.
    pub async fn reconcile_wallet_operations(&self) -> std::result::Result<(), sqlx::Error> {
        self.reconcile_inner()
            .await
            .map_err(|_| sqlx::Error::Protocol("Reconciliation failed".into()))
    }

    async fn reconcile_inner(&self) -> Result<()> {
        let Some(adapter) = &self.wallet else {
            return Ok(());
        };
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM wallet_operations WHERE backend='zingo' AND network=? AND (state IN ('pending','unknown','broadcast','mined') OR (state='final' AND manual_phase IS NOT NULL))")
            .bind(&self.config.network).fetch_all(&self.pool).await?;
        for op in ids {
            let intent = self.operation_intent(&op).await?;
            let outcome = tokio::time::timeout(
                StdDuration::from_secs(if adapter.requires_operator() { 180 } else { 30 }),
                adapter.observe(&intent),
            )
            .await
            .unwrap_or(WalletOutcome::Unknown);
            self.apply_wallet_outcome(&intent, outcome, false).await?;
        }
        Ok(())
    }

    pub(crate) async fn apply_wallet_outcome(
        &self,
        intent: &SendIntent,
        outcome: WalletOutcome,
        submission: bool,
    ) -> Result<()> {
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let row = sqlx::query(
            "SELECT state,txid,created_at,manual_phase FROM wallet_operations WHERE id=? AND network=?",
        )
        .bind(&intent.operation_id)
        .bind(intent.network.as_str())
        .fetch_one(&mut *tx)
        .await?;
        let state: String = row.get(0);
        if state == "failed_definitive"
            || (state == "final" && !self.wallet.as_ref().is_some_and(|w| w.requires_operator()))
        {
            return Ok(());
        }
        let known_txid: Option<String> = row.get(1);
        let mut payment = owned(&mut tx, "payment", &intent.payment_id, "customer_demo").await?;
        let mut agent = owned(
            &mut tx,
            "agent",
            payment["agentId"].as_str().ok_or_else(invalid)?,
            "customer_demo",
        )
        .await?;
        let checked = now();
        let mut txid = known_txid.clone();
        let valid_txid = |id: &str| {
            id.len() == 64
                && id.bytes().all(|b| b.is_ascii_hexdigit())
                && known_txid.as_ref().is_none_or(|old| old == id)
        };
        let required = if self.wallet.as_ref().is_some_and(|w| w.requires_operator()) {
            3
        } else {
            1
        };
        let still_final = matches!(&outcome,WalletOutcome::Mined{txid,confirmations} if valid_txid(txid) && *confirmations>=required);
        if state == "final" && !still_final {
            // Reorg/uncertainty moves spent value back to a held reservation, once.
            usage(&mut agent, -intent.amount_zat, intent.amount_zat)?;
            agent["usage"]["pendingCount"] =
                json!(agent["usage"]["pendingCount"].as_i64().unwrap() + 1);
            save_agent(&mut tx, &agent).await?;
            payment["confirmations"] = json!(0);
        }
        let (next, status, note) = match outcome {
            WalletOutcome::Broadcast { txid: id } if valid_txid(&id) => {
                txid = Some(id);
                payment["failure"] = Value::Null;
                (
                    "broadcast",
                    "submitted",
                    "Wallet reported a transaction; confirmation pending",
                )
            }
            WalletOutcome::Mined {
                txid: id,
                confirmations,
            } if valid_txid(&id) && confirmations >= required => {
                txid = Some(id);
                payment["failure"] = Value::Null;
                payment["confirmations"] = json!(confirmations);
                // One confirmation is the existing API's configured finality threshold.
                if state != "final" {
                    usage(&mut agent, intent.amount_zat, -intent.amount_zat)?;
                    agent["usage"]["pendingCount"] =
                        json!(agent["usage"]["pendingCount"].as_i64().unwrap() - 1);
                    save_agent(&mut tx, &agent).await?;
                }
                (
                    "final",
                    "confirmed",
                    "Wallet observed a mined transaction; merchant receipt not verified",
                )
            }
            WalletOutcome::Mined {
                txid: id,
                confirmations,
            } if valid_txid(&id) && confirmations > 0 => {
                txid = Some(id);
                payment["confirmations"] = json!(confirmations);
                payment["failure"] = Value::Null;
                (
                    "mined",
                    "confirming",
                    "Wallet observed transaction below required confirmation depth",
                )
            }
            WalletOutcome::RejectedBeforeCreation(reason)
                if submission && known_txid.is_none() && state == "unknown" =>
            {
                usage(&mut agent, 0, -intent.amount_zat)?;
                agent["usage"]["pendingCount"] =
                    json!(agent["usage"]["pendingCount"].as_i64().unwrap() - 1);
                save_agent(&mut tx, &agent).await?;
                payment["failure"] = json!({"code":"REJECTED_BY_WALLET_PRE_BROADCAST","definitive":true,"retriable":false,"message":"Wallet confirmed rejection before transaction creation","details":{"reason":reason.code()}});
                (
                    "failed_definitive",
                    "failed",
                    "Wallet rejected before transaction creation; reservation released",
                )
            }
            WalletOutcome::BroadcastDisabled
                if submission && known_txid.is_none() && state == "unknown" =>
            {
                usage(&mut agent, 0, -intent.amount_zat)?;
                agent["usage"]["pendingCount"] =
                    json!(agent["usage"]["pendingCount"].as_i64().unwrap() - 1);
                save_agent(&mut tx, &agent).await?;
                payment["failure"] = json!({"code":"WALLET_BROADCAST_DISABLED","definitive":true,"retriable":false,"message":"No transaction created; broadcasting disabled"});
                (
                    "failed_definitive",
                    "failed",
                    "Broadcast disabled before transaction creation; reservation released",
                )
            }
            _ => {
                payment["failure"] = json!({"code":"OUTCOME_UNKNOWN","definitive":false,"retriable":false,"message":"No conclusive evidence; reservation held; never automatically resent"});
                (
                    "unknown",
                    "submitted",
                    "Wallet outcome unresolved; reservation held",
                )
            }
        };
        let manual_phase: Option<String> = row.get(3);
        if let Some(phase) = manual_phase {
            payment["walletOperation"]["requiresOperatorConfirmation"] = json!(
                matches!(phase.as_str(), "awaiting_operator" | "prepared")
                    && !matches!(next, "broadcast" | "mined" | "final")
            );
            payment["walletOperation"]["phase"] = json!(if phase == "submitting"
                || matches!(next, "broadcast" | "mined" | "final")
            {
                "observing"
            } else {
                &phase
            });
        }
        if matches!(next, "unknown" | "broadcast") {
            payment["confirmations"] = json!(0);
        }
        let age = Utc::now() - date(row.get::<&str, _>(2))?;
        payment["txid"] = json!(txid);
        payment["walletOperation"]["state"] = json!(next);
        payment["walletOperation"]["lastReconciledAt"] = json!(checked);
        payment["walletOperation"]["needsOperator"] =
            json!(next == "unknown" && age >= Duration::hours(2));
        if payment["status"] != status || state != next {
            event(&mut payment, status, "status", note);
        }
        sqlx::query("UPDATE wallet_operations SET state=?,txid=?,updated_at=?,last_reconciled_at=?,manual_phase=CASE WHEN manual_phase IS NOT NULL AND (manual_phase='submitting' OR ? IN ('broadcast','mined','final')) THEN 'observing' ELSE manual_phase END WHERE id=?")
            .bind(next).bind(txid).bind(&checked).bind(&checked).bind(next).bind(&intent.operation_id).execute(&mut *tx).await?;
        put(
            &mut tx,
            "payment",
            &intent.payment_id,
            "customer_demo",
            &payment,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
