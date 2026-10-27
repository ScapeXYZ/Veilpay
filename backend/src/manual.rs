//! Operator-only library entry points, deliberately absent from the HTTP router.
use super::*;
impl App {
    pub async fn testnet_operation_review(
        &self,
        payment_id: &str,
    ) -> std::result::Result<Value, String> {
        self.manual_review(payment_id)
            .await
            .map_err(|_| "Testnet operation unavailable".into())
    }
    async fn manual_review(&self, pid: &str) -> Result<Value> {
        if self.config.network != "testnet"
            || !self.wallet.as_ref().is_some_and(|w| w.requires_operator())
        {
            return Err(ApiError(409, "UNSUPPORTED_WALLET_CAPABILITY"));
        }
        let row=sqlx::query("SELECT id,state,manual_phase,destination,amount_zat,txid,fee_zat FROM wallet_operations WHERE payment_id=? AND network='testnet' AND backend='zingo'").bind(pid).fetch_optional(&self.pool).await?.ok_or(ApiError(404,"NOT_FOUND"))?;
        Ok(
            json!({"operationId":row.get::<String,_>(0),"state":row.get::<String,_>(1),"phase":row.get::<Option<String>,_>(2),"destination":row.get::<String,_>(3),"amountZat":row.get::<i64,_>(4).to_string(),"txid":row.get::<Option<String>,_>(5),"feeZat":row.get::<Option<i64>,_>(6).map(|v|v.to_string()),"network":"testnet"}),
        )
    }
    pub async fn manual_testnet_prepare(
        &self,
        pid: &str,
        max_fee: i64,
        confirmation: &str,
    ) -> std::result::Result<Value, String> {
        self.manual_prepare(pid, max_fee, confirmation)
            .await
            .map_err(|_| {
                "Preparation failed or outcome unknown; inspect payment, never retry automatically"
                    .into()
            })
    }
    async fn recheck(&self, c: &mut SqliteConnection, pid: &str) -> Result<()> {
        let mut payment = owned(c, "payment", pid, "customer_demo").await?;
        let agent = owned(
            c,
            "agent",
            payment["agentId"].as_str().ok_or_else(invalid)?,
            "customer_demo",
        )
        .await?;
        let (_, invoice) = get(
            c,
            "invoice",
            payment["invoiceId"].as_str().ok_or_else(invalid)?,
        )
        .await?;
        let violations = evaluate(
            &agent,
            &invoice,
            zat(&payment, "amountZat")?,
            payment["expiresAt"].as_str().ok_or_else(invalid)?,
            zat(&payment, "amountZat")?,
        )?;
        let request = owned(c, "payment_request", pid, "customer_demo").await?;
        payment["decision"] = decision(
            c,
            "customer_demo",
            &request,
            &agent["policy"],
            violations.clone(),
        )
        .await?;
        put(c, "payment", pid, "customer_demo", &payment).await?;
        if !violations.is_empty() {
            return Err(ApiError(409, "POLICY_REJECTED"));
        }
        Ok(())
    }
    async fn manual_prepare(&self, pid: &str, max_fee: i64, confirmation: &str) -> Result<Value> {
        let review = self.manual_review(pid).await?;
        if max_fee < 0 || confirmation != prepare_challenge(&review, max_fee) {
            return Err(ApiError(403, "OPERATOR_CONFIRMATION_REQUIRED"));
        }
        let op = review["operationId"].as_str().ok_or_else(invalid)?;
        let intent = self.operation_intent(op).await?;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        self.recheck(&mut tx, pid).await?;
        let n=sqlx::query("UPDATE wallet_operations SET manual_phase='preparing',state='unknown',updated_at=? WHERE id=? AND manual_phase='awaiting_operator' AND txid IS NULL").bind(now()).bind(op).execute(&mut *tx).await?.rows_affected();
        if n != 1 {
            return Err(ApiError(409, "INVALID_TRANSITION"));
        }
        let mut p = owned(&mut tx, "payment", pid, "customer_demo").await?;
        p["walletOperation"]["state"] = json!("unknown");
        p["walletOperation"]["phase"] = json!("preparing");
        p["walletOperation"]["requiresOperatorConfirmation"] = json!(false);
        p["failure"] = json!({"code":"OUTCOME_UNKNOWN","definitive":false,"retriable":false,"message":"Manual preparation claimed; reservation held"});
        put(&mut tx, "payment", pid, "customer_demo", &p).await?;
        tx.commit().await?;
        let (id, fee) = self
            .wallet
            .as_ref()
            .ok_or_else(invalid)?
            .prepare(&intent, max_fee)
            .await
            .map_err(|_| ApiError(409, "OUTCOME_UNKNOWN"))?;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        sqlx::query("UPDATE wallet_operations SET manual_phase='prepared',txid=?,fee_zat=?,updated_at=? WHERE id=? AND manual_phase='preparing'").bind(&id).bind(fee).bind(now()).bind(op).execute(&mut *tx).await?;
        let mut p = owned(&mut tx, "payment", pid, "customer_demo").await?;
        p["txid"] = json!(id);
        p["failure"] = Value::Null;
        p["walletOperation"]["phase"] = json!("prepared");
        p["walletOperation"]["requiresOperatorConfirmation"] = json!(true);
        p["walletOperation"]["feeZat"] = json!(fee.to_string());
        let status = p["status"].as_str().ok_or_else(invalid)?.to_owned();
        event(
            &mut p,
            &status,
            "wallet",
            "Operator prepared a signed testnet transaction; not submitted",
        );
        put(&mut tx, "payment", pid, "customer_demo", &p).await?;
        tx.commit().await?;
        self.manual_review(pid).await
    }
    pub async fn manual_testnet_submit(
        &self,
        pid: &str,
        confirmation: &str,
    ) -> std::result::Result<Value, String> {
        self.manual_submit(pid, confirmation).await.map_err(|_| {
            "Submission unavailable or outcome unknown; never resend; reconcile read-only".into()
        })
    }
    async fn manual_submit(&self, pid: &str, confirmation: &str) -> Result<Value> {
        let review = self.manual_review(pid).await?;
        if confirmation != submit_challenge(&review) {
            return Err(ApiError(403, "OPERATOR_CONFIRMATION_REQUIRED"));
        }
        let op = review["operationId"].as_str().ok_or_else(invalid)?;
        let id = review["txid"].as_str().ok_or_else(invalid)?;
        let intent = self.operation_intent(op).await?;
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        self.recheck(&mut tx, pid).await?;
        let n=sqlx::query("UPDATE wallet_operations SET manual_phase='submitting',state='unknown',updated_at=? WHERE id=? AND manual_phase='prepared' AND state IN ('pending','unknown') AND txid=?").bind(now()).bind(op).bind(id).execute(&mut *tx).await?.rows_affected();
        if n != 1 {
            return Err(ApiError(409, "INVALID_TRANSITION"));
        }
        let mut p = owned(&mut tx, "payment", pid, "customer_demo").await?;
        p["walletOperation"]["state"] = json!("unknown");
        p["walletOperation"]["phase"] = json!("submitting");
        p["walletOperation"]["requiresOperatorConfirmation"] = json!(false);
        p["failure"] = json!({"code":"OUTCOME_UNKNOWN","definitive":false,"retriable":false,"message":"Operator submission claimed; never resubmit on ambiguity"});
        put(&mut tx, "payment", pid, "customer_demo", &p).await?;
        tx.commit().await?;
        let outcome = match self.wallet.as_ref().ok_or_else(invalid)?.transmit(id).await {
            Ok(returned) if returned == id => WalletOutcome::Broadcast { txid: returned },
            _ => WalletOutcome::Unknown,
        };
        self.apply_wallet_outcome(&intent, outcome, false).await?;
        sqlx::query("UPDATE wallet_operations SET manual_phase='observing' WHERE id=? AND manual_phase='submitting'").bind(op).execute(&self.pool).await?;
        self.manual_review(pid).await
    }
}
pub fn prepare_challenge(v: &Value, max_fee: i64) -> String {
    format!(
        "PREPARE TESTNET {} {} {} MAX_FEE {}",
        v["operationId"].as_str().unwrap_or(""),
        v["destination"].as_str().unwrap_or(""),
        v["amountZat"].as_str().unwrap_or(""),
        max_fee
    )
}
pub fn submit_challenge(v: &Value) -> String {
    format!(
        "BROADCAST TESTNET {} {} {} {} FEE {}",
        v["operationId"].as_str().unwrap_or(""),
        v["txid"].as_str().unwrap_or(""),
        v["destination"].as_str().unwrap_or(""),
        v["amountZat"].as_str().unwrap_or(""),
        v["feeZat"].as_str().unwrap_or("")
    )
}
