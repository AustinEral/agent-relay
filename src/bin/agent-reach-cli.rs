//! agent-reach CLI - interact with agent-reach registry
//!
//! Usage:
//!   agent-reach auth <server>                     # Handshake, output session
//!   agent-reach register <server> -e <endpoint>   # Register (requires auth)
//!   agent-reach lookup <server> <did>             # Look up agent by DID
//!   agent-reach deregister <server>               # Remove registration

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use agent_id::RootKey;
use agent_id_handshake::{
    messages::{Hello, Proof, ProofAccepted},
    protocol::sign_proof,
    Challenge,
};

#[derive(Parser)]
#[command(name = "agent-reach")]
#[command(about = "Interact with agent-reach registry")]
struct Cli {
    /// Path to identity file
    #[arg(short, long, global = true)]
    identity: Option<PathBuf>,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Authenticate with server (handshake), output session ID
    Auth {
        /// Server URL (e.g., http://localhost:3001)
        server: String,
    },
    /// Register endpoint (requires SESSION env var or --session)
    Register {
        /// Server URL
        server: String,
        /// Endpoint where you can be reached
        #[arg(short, long)]
        endpoint: String,
        /// TTL in seconds (default: 3600)
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
    /// Remove registration (requires SESSION env var or --session)
    Deregister {
        /// Server URL
        server: String,
        /// Session ID (or use SESSION env var)
        #[arg(short, long, env = "SESSION")]
        session: String,
    },
}

/// Stored identity file format (matches agent-id CLI)
#[derive(Serialize, Deserialize)]
struct StoredIdentity {
    did: String,
    #[serde(with = "hex_bytes")]
    secret_key: [u8; 32],
}

mod hex_bytes {
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(bytes: &[u8; 32], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&hex::encode(bytes))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 32], D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let bytes = hex::decode(&s).map_err(serde::de::Error::custom)?;
        bytes
            .try_into()
            .map_err(|_| serde::de::Error::custom("invalid key length"))
    }
}

fn get_identity_path(cli_path: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = cli_path {
        return Ok(path);
    }

    let proj_dirs = directories::ProjectDirs::from("ai", "agent-id", "agent-id")
        .context("Could not determine config directory")?;

    Ok(proj_dirs.config_dir().join("identity.json"))
}

fn load_identity(path: &PathBuf) -> Result<RootKey> {
    let contents = std::fs::read_to_string(path)
        .with_context(|| format!("Could not read identity file: {}", path.display()))?;

    let stored: StoredIdentity =
        serde_json::from_str(&contents).context("Invalid identity file format")?;

    let root_key = RootKey::from_bytes(&stored.secret_key)?;
    Ok(root_key)
}

// ============================================================================
// Commands
// ============================================================================

async fn cmd_auth(server: String, identity_path: PathBuf) -> Result<()> {
    let key = load_identity(&identity_path)?;
    let did = key.did();
    let client = Client::new();

    eprintln!("Authenticating with {}...", server);
    eprintln!("  DID: {}", did);

    // Step 1: Hello
    let hello = Hello::new(did.to_string());
    let challenge: Challenge = client
        .post(format!("{}/hello", server))
        .json(&hello)
        .send()
        .await?
        .error_for_status()
        .context("Hello failed")?
        .json()
        .await?;

    eprintln!("  ✓ Received challenge");

    // Step 2: Proof
    let proof = sign_proof(&challenge, &did, &key, Some(challenge.issuer.clone()))?;
    let accepted: ProofAccepted = client
        .post(format!("{}/proof", server))
        .json(&proof)
        .send()
        .await?
        .error_for_status()
        .context("Proof failed")?
        .json()
        .await?;

    eprintln!("  ✓ Handshake complete");
    eprintln!();

    // Output session ID to stdout (for piping)
    println!("{}", accepted.session_id);

    Ok(())
}

#[derive(Deserialize)]
struct RegisterResponse {
    ok: bool,
    did: String,
    expires_at: i64,
}

async fn cmd_register(server: String, endpoint: String, ttl: u64, session: String) -> Result<()> {
    let client = Client::new();

    eprintln!("Registering endpoint...");
    eprintln!("  Endpoint: {}", endpoint);
    eprintln!("  TTL: {}s", ttl);

    let response: RegisterResponse = client
        .post(format!("{}/register", server))
        .header("Authorization", format!("Bearer {}", session))
        .json(&serde_json::json!({
            "endpoint": endpoint,
            "ttl": ttl
        }))
        .send()
        .await?
        .error_for_status()
        .context("Register failed")?
        .json()
        .await?;

    if response.ok {
        eprintln!("  ✓ Registered");
        eprintln!();
        println!("{}", response.did);
    } else {
        anyhow::bail!("Registration failed");
    }

    Ok(())
}

#[derive(Deserialize)]
struct LookupResponse {
    did: String,
    endpoint: String,
    status: String,
    registered_at: i64,
    expires_at: i64,
}

async fn cmd_lookup(server: String, did: String) -> Result<()> {
    let client = Client::new();

    let encoded_did = urlencoding::encode(&did);
    let response: LookupResponse = client
        .get(format!("{}/lookup/{}", server, encoded_did))
        .send()
        .await?
        .error_for_status()
        .context("Lookup failed")?
        .json()
        .await?;

    // Output endpoint to stdout
    println!("{}", response.endpoint);

    // Details to stderr
    eprintln!("DID: {}", response.did);
    eprintln!("Status: {}", response.status);
    eprintln!("Expires: {}", response.expires_at);

    Ok(())
}

#[derive(Deserialize)]
struct DeregisterResponse {
    ok: bool,
}

async fn cmd_deregister(server: String, session: String) -> Result<()> {
    let client = Client::new();

    eprintln!("Deregistering...");

    let response: DeregisterResponse = client
        .post(format!("{}/deregister", server))
        .header("Authorization", format!("Bearer {}", session))
        .send()
        .await?
        .error_for_status()
        .context("Deregister failed")?
        .json()
        .await?;

    if response.ok {
        eprintln!("  ✓ Deregistered");
    } else {
        eprintln!("  (was not registered)");
    }

    Ok(())
}

// ============================================================================
// Main
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let identity_path = get_identity_path(cli.identity)?;

    match cli.command {
        Commands::Auth { server } => cmd_auth(server, identity_path).await,
        Commands::Register { server, endpoint, ttl, session } => {
            cmd_register(server, endpoint, ttl, session).await
        }
        Commands::Lookup { server, did } => cmd_lookup(server, did).await,
        Commands::Deregister { server, session } => cmd_deregister(server, session).await,
    }
}
