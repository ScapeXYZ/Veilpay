use veilpay_backend::{App, Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = App::open(Config::from_env()?).await?;
    let reconciler = app.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            if reconciler.reconcile_merchant_receipts().await.is_err() {
                eprintln!("Merchant reconciliation unavailable");
            }
            if reconciler.reconcile_wallet_operations().await.is_err() {
                eprintln!("Wallet reconciliation failed");
            }
        }
    });
    let listener = tokio::net::TcpListener::bind("0.0.0.0:4000").await?;
    println!(
        "VeilPay backend listening on :4000; HTTP broadcasting disabled; manual testnet operator flow is separate"
    );
    axum::serve(
        listener,
        app.router()
            .into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
