use super::*;
impl App {
    pub async fn reconcile_merchant_receipts(&self) -> std::result::Result<(), sqlx::Error> {
        if !self.wallet.as_ref().is_some_and(|w| w.requires_operator()) {
            return Ok(());
        }
        let mut tx = self.pool.begin_with("BEGIN IMMEDIATE").await?;
        let payments = list(&mut tx, "payment", "customer_demo")
            .await
            .map_err(|_| sqlx::Error::Protocol("Merchant scan unavailable".into()))?;
        for p in payments {
            if p["mockRef"].is_null() && p["txid"].is_string() {
                let (_, invoice) = get(&mut tx, "invoice", p["invoiceId"].as_str().unwrap_or(""))
                    .await
                    .map_err(|_| sqlx::Error::Protocol("Invoice unavailable".into()))?;
                // Keep the previous observation on a failed scan; never synthesize absence.
                let _ = self.verify_payment(&mut tx, &p, &invoice).await;
            }
        }
        tx.commit().await?;
        Ok(())
    }
    pub(crate) async fn verify_payment(
        &self,
        c: &mut SqliteConnection,
        payment: &Value,
        invoice: &Value,
    ) -> Result<Value> {
        if !payment["mockRef"].is_null() {
            return verification(payment, invoice);
        }
        let Some(wallet) = &self.wallet else {
            return Err(ApiError(409, "VERIFICATION_UNAVAILABLE"));
        };
        if !wallet.requires_operator()
            || self.config.network != "testnet"
            || invoice["network"] != "testnet"
        {
            return Err(ApiError(409, "VERIFICATION_UNAVAILABLE"));
        }
        let history = wallet
            .merchant_history()
            .await
            .map_err(|_| ApiError(503, "WALLET_UNAVAILABLE"))?;
        let pid = payment["id"].as_str().ok_or_else(invalid)?;
        let previous = sqlx::query_scalar::<_, String>(
            "SELECT body FROM records WHERE kind='receipt' AND id=?",
        )
        .bind(pid)
        .fetch_optional(&mut *c)
        .await?
        .map(|s| serde_json::from_str::<Value>(&s))
        .transpose()
        .map_err(|_| ApiError(500, "INTERNAL"))?;
        let mut receipt = zcash::match_invoice(
            &history,
            invoice,
            payment["txid"].as_str(),
            3,
            previous.as_ref(),
            Utc::now().timestamp(),
        )
        .map_err(|_| ApiError(503, "WALLET_UNAVAILABLE"))?;
        receipt["paymentId"] = payment["id"].clone();
        receipt["reference"] = invoice["reference"].clone();
        receipt["checkedAt"] = json!(now());
        let owner = invoice["merchantId"].as_str().ok_or_else(invalid)?;
        let existing_ack = sqlx::query_scalar::<_, String>(
            "SELECT body FROM records WHERE kind='acknowledgment' AND id=?",
        )
        .bind(pid)
        .fetch_optional(&mut *c)
        .await?
        .map(|body| serde_json::from_str::<Value>(&body))
        .transpose()
        .map_err(|_| ApiError(500, "INTERNAL"))?;
        receipt["acknowledgmentValid"] = json!(
            receipt["acknowledgmentEligible"] == true
                && existing_ack
                    .as_ref()
                    .is_some_and(|ack| ack["invalidatedAt"].is_null()
                        && ack["evidence"]["txid"] == receipt["txid"])
        );
        put(c, "receipt", pid, owner, &receipt).await?;
        let mut updated_invoice = invoice.clone();
        updated_invoice["status"] = json!(match receipt["state"].as_str() {
            Some("received") => "paid",
            Some("late") => "paid_late",
            _ if date(invoice["expiresAt"].as_str().ok_or_else(invalid)?)? <= Utc::now() =>
                "expired",
            _ => "open",
        });
        put(
            c,
            "invoice",
            invoice["id"].as_str().ok_or_else(invalid)?,
            owner,
            &updated_invoice,
        )
        .await?;
        if previous
            .as_ref()
            .is_none_or(|old| old["state"] != receipt["state"])
        {
            let mut updated_payment = payment.clone();
            let status = updated_payment["status"]
                .as_str()
                .ok_or_else(invalid)?
                .to_owned();
            event(
                &mut updated_payment,
                &status,
                "verification",
                &format!(
                    "Independent merchant observation: {}",
                    receipt["state"].as_str().unwrap_or("unknown")
                ),
            );
            put(c, "payment", pid, "customer_demo", &updated_payment).await?;
        }
        // Retain the historical signature, but explicitly invalidate current reliance on it.
        if receipt["acknowledgmentEligible"] != true
            && let Some(mut ack) = existing_ack
            && ack["invalidatedAt"].is_null()
        {
            ack["invalidatedAt"] = json!(now());
            ack["invalidationReason"] = receipt["state"].clone();
            put(c, "acknowledgment", pid, owner, &ack).await?;
        }
        Ok(receipt)
    }
}
