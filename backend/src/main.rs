use veilpay_backend::{App, Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let app = App::open(Config::from_env()?).await?;
    let listener = tokio::net::TcpListener::bind("0.0.0.0:4000").await?;
    println!("VeilPay mock backend listening on :4000; no blockchain transactions");
    axum::serve(
        listener,
        app.router()
            .into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .await?;
    Ok(())
}
