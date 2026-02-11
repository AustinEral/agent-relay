use std::net::SocketAddr;
use std::sync::Arc;

use axum::{routing::{get, post}, Router};
use clap::{Parser, Subcommand};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod cli;
mod error;
mod handlers;
mod registry;
mod types;

use handlers::{AppState, HandshakeState};

#[derive(Parser)]
#[command(name = "agent-reach")]
#[command(about = "DID-based discovery registry for AI agents")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the server (default if no command given)
    Serve {
        /// Port to listen on
        #[arg(short, long, default_value = "3001")]
        port: u16,
    },
    /// Authenticate with a server (handshake)
    Auth {
        /// Server URL (e.g., http://localhost:3001)
        server: String,
        /// Path to identity file
        #[arg(short, long)]
        identity: Option<std::path::PathBuf>,
    },
    /// Register endpoint with a server
    Register {
        /// Server URL
        server: String,
        /// Endpoint where you can be reached
        #[arg(short, long)]
        endpoint: String,
        /// TTL in seconds
        #[arg(short, long, default_value = "3600")]
        ttl: u64,
        /// Session ID (or use SESSION env var)
        #[arg(short, long, env = "SESSION")]
        session: String,
    },
    /// Look up an agent by DID
    Lookup {
        /// Server URL
        server: String,
        /// DID to look up
        did: String,
    },
    /// Remove registration
    Deregister {
        /// Server URL
        server: String,
        /// Session ID (or use SESSION env var)
        #[arg(short, long, env = "SESSION")]
        session: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        None | Some(Commands::Serve { port: 3001 }) => {
            // Default: start server on port 3001
            serve(3001).await
        }
        Some(Commands::Serve { port }) => serve(port).await,
        Some(Commands::Auth { server, identity }) => cli::auth(server, identity).await,
        Some(Commands::Register { server, endpoint, ttl, session }) => {
            cli::register(server, endpoint, ttl, session).await
        }
        Some(Commands::Lookup { server, did }) => cli::lookup(server, did).await,
        Some(Commands::Deregister { server, session }) => {
            cli::deregister(server, session).await
        }
    }
}

async fn serve(port: u16) -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "agent_reach=info,tower_http=debug".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Create state
    let state = AppState {
        registry: registry::Registry::new(),
        handshake: Arc::new(HandshakeState::new()),
    };

    // Build router
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/hello", post(handlers::hello))
        .route("/proof", post(handlers::proof))
        .route("/register", post(handlers::register))
        .route("/deregister", post(handlers::deregister))
        .route("/lookup/:did", get(handlers::lookup))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("agent-reach listening on {}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
