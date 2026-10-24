//! Separate manual operator flow. No HTTP endpoint can reach these actions.
use std::io::{IsTerminal, Write};
use veilpay_backend::{
    App, Config,
    manual::{prepare_challenge, submit_challenge},
};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let config = Config::from_env()?;
    if config.network != "testnet" || std::env::var("WALLET_BACKEND").as_deref() != Ok("zingo-cli")
    {
        return Err("Requires NETWORK=testnet and WALLET_BACKEND=zingo-cli".into());
    }
    if args.len() == 2 && ["sync", "balance"].contains(&args[0].as_str()) {
        let role = match args[1].as_str() {
            "customer" => veilpay_backend::transport::Role::Customer,
            "merchant" => veilpay_backend::transport::Role::Merchant,
            _ => return Err("Role must be customer or merchant".into()),
        };
        let root = std::env::var_os("VEILPAY_WALLET_ROOT").ok_or("VEILPAY_WALLET_ROOT required")?;
        let transport = veilpay_backend::transport::TestnetTransport::from_root(root.into());
        let output = if args[0] == "balance" {
            transport.balance(role).await?
        } else {
            let history = transport.history(role).await?;
            serde_json::json!({"network":"testnet","tipHeight":history.tip,"scannedHeight":history.scanned})
        };
        println!("{}", serde_json::to_string_pretty(&output)?);
        return Ok(());
    }
    if !(args.len() == 2 && ["review", "submit"].contains(&args[0].as_str())
        || args.len() == 3 && args[0] == "prepare")
    {
        return Err("Usage: veilpay-testnet sync ROLE | balance ROLE | review PAYMENT_ID | prepare PAYMENT_ID MAX_FEE_ZAT | submit PAYMENT_ID".into());
    }
    // No wallet is touched by review except startup's read-only reconciliation.
    let app = App::open(config).await?;
    let review = app.testnet_operation_review(&args[1]).await?;
    if args[0] == "review" {
        println!("{}", serde_json::to_string_pretty(&review)?);
        return Ok(());
    }
    if !std::io::stdin().is_terminal() {
        return Err("Operator terminal required; piped confirmation is refused".into());
    }
    let max_fee = if args[0] == "prepare" {
        args[2].parse::<i64>()?
    } else {
        0
    };
    let challenge = if args[0] == "prepare" {
        prepare_challenge(&review, max_fee)
    } else {
        submit_challenge(&review)
    };
    println!("{}", serde_json::to_string_pretty(&review)?);
    println!("Type the following exact line to authorize this testnet operation:\n{challenge}");
    std::io::stdout().flush()?;
    let mut answer = String::new();
    std::io::stdin().read_line(&mut answer)?;
    if answer.trim_end() != challenge {
        return Err("Operator confirmation declined".into());
    }
    let result = if args[0] == "prepare" {
        app.manual_testnet_prepare(&args[1], max_fee, answer.trim_end())
            .await?
    } else {
        app.manual_testnet_submit(&args[1], answer.trim_end())
            .await?
    };
    println!("{}", serde_json::to_string_pretty(&result)?);
    if args[0] == "submit" && result["state"] == "unknown" {
        return Err(
            "Outcome unknown: submission claim consumed; never resubmit; reconcile read-only"
                .into(),
        );
    }
    Ok(())
}
