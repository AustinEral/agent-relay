//! Agent Bridge CLI - Agent service discovery on Nostr
//!
//! Uses identity from OpenClaw config (channels.nostr.privateKey)

use agent_discovery::{AgentDiscoveryClient, Capability, Protocol, ServiceCard, Status};
use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use nostr::key::Keys;
use nostr::nips::nip19::{FromBech32, ToBech32};
use serde::Deserialize;
use std::path::PathBuf;

/// Agent Bridge - Service discovery for AI agents on Nostr
#[derive(Parser)]
#[command(name = "agent-bridge")]
#[command(about = "Discover and advertise AI agent capabilities on Nostr", long_about = None)]
#[command(version)]
struct Cli {
    /// Path to OpenClaw config (default: ~/.openclaw/openclaw.json)
    #[arg(short, long, global = true, env = "OPENCLAW_CONFIG")]
    config: Option<PathBuf>,

    /// Output as JSON
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Show your identity (from OpenClaw config)
    Whoami,

    /// Publish your service card
    Publish {
        /// Service card ID (default: derived from pubkey)
        #[arg(long)]
        id: Option<String>,

        /// Agent name (uses config profile.name if not specified)
        #[arg(long)]
        name: Option<String>,

        /// Agent description (uses config profile.about if not specified)
        #[arg(long)]
        about: Option<String>,

        /// Capability in format "id:description" (repeatable)
        #[arg(short, long, value_name = "CAP")]
        capability: Vec<String>,

        /// Protocol in format "type:endpoint" (repeatable)
        /// Types: dm, dvm, a2a, mcp, http
        #[arg(short, long, value_name = "PROTO")]
        protocol: Vec<String>,

        /// Relay URL (repeatable, uses config relays if not specified)
        #[arg(short, long)]
        relay: Vec<String>,
    },

    /// Send a heartbeat
    Heartbeat {
        /// Status: available, busy, maintenance
        status: String,

        /// Service card ID (default: derived from pubkey)
        #[arg(long)]
        service_card_id: Option<String>,

        /// Relay URL (repeatable, uses config relays if not specified)
        #[arg(short, long)]
        relay: Vec<String>,
    },

    /// Discover agents
    Discover {
        /// Filter by capability (repeatable, AND logic)
        #[arg(short, long)]
        capability: Vec<String>,

        /// Maximum results
        #[arg(short, long, default_value = "20")]
        limit: usize,

        /// Relay URL (repeatable)
        #[arg(short, long)]
        relay: Vec<String>,
    },

    /// Look up a specific agent
    Lookup {
        /// Agent public key (npub or hex)
        pubkey: String,

        /// Relay URL (repeatable)
        #[arg(short, long)]
        relay: Vec<String>,
    },

    /// Check if an agent is online
    Status {
        /// Agent public key (npub or hex)
        pubkey: String,

        /// Relay URL (repeatable)
        #[arg(short, long)]
        relay: Vec<String>,
    },

    /// Show help for a specific topic
    Help {
        /// Topic to get help on
        topic: Option<String>,
    },
}

// ============================================================================
// OpenClaw Config
// ============================================================================

/// Minimal OpenClaw config structure (just what we need)
#[derive(Deserialize)]
struct OpenClawConfig {
    channels: Option<Channels>,
}

#[derive(Deserialize)]
struct Channels {
    nostr: Option<NostrConfig>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NostrConfig {
    private_key: Option<String>,
    relays: Option<Vec<String>>,
    profile: Option<NostrProfile>,
}

#[derive(Deserialize)]
struct NostrProfile {
    name: Option<String>,
    about: Option<String>,
}

/// Resolved identity from OpenClaw config
struct Identity {
    keys: Keys,
    pubkey_hex: String,
    npub: String,
    name: String,
    about: String,
    relays: Vec<String>,
}

const DEFAULT_RELAYS: &[&str] = &[
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.nostr.band",
];

fn get_config_path(cli_path: Option<PathBuf>) -> Result<PathBuf> {
    if let Some(path) = cli_path {
        return Ok(path);
    }

    // Check OPENCLAW_CONFIG env var
    if let Ok(path) = std::env::var("OPENCLAW_CONFIG") {
        return Ok(PathBuf::from(path));
    }

    // Default: ~/.openclaw/openclaw.json
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(PathBuf::from(home).join(".openclaw/openclaw.json"))
}

fn load_identity(config_path: &PathBuf) -> Result<Identity> {
    let contents = std::fs::read_to_string(config_path)
        .with_context(|| format!("Could not read config: {}", config_path.display()))?;

    let config: OpenClawConfig =
        serde_json::from_str(&contents).context("Invalid config format")?;

    let nostr = config
        .channels
        .and_then(|c| c.nostr)
        .context("channels.nostr not configured")?;

    let private_key = nostr
        .private_key
        .context("channels.nostr.privateKey not set")?;

    // Parse key (hex or nsec format)
    let secret_key = if private_key.starts_with("nsec1") {
        nostr::SecretKey::from_bech32(&private_key)
            .map_err(|e| anyhow::anyhow!("Invalid nsec key: {}", e))?
    } else {
        nostr::SecretKey::from_hex(&private_key)?
    };

    let keys = Keys::new(secret_key);
    let pubkey_hex = keys.public_key().to_hex();
    let npub = keys.public_key().to_bech32()?;

    let profile = nostr.profile.unwrap_or(NostrProfile {
        name: None,
        about: None,
    });

    let relays = nostr.relays.unwrap_or_else(|| {
        DEFAULT_RELAYS.iter().map(|s| s.to_string()).collect()
    });

    Ok(Identity {
        keys,
        pubkey_hex,
        npub,
        name: profile.name.unwrap_or_else(|| "Agent".to_string()),
        about: profile.about.unwrap_or_default(),
        relays,
    })
}

fn get_relays(cli_relays: Vec<String>, config_relays: &[String]) -> Vec<&'static str> {
    let relays = if cli_relays.is_empty() {
        config_relays.to_vec()
    } else {
        cli_relays
    };

    if relays.is_empty() {
        DEFAULT_RELAYS.to_vec()
    } else {
        // Leak strings to get static lifetime (fine for CLI)
        relays
            .into_iter()
            .map(|s| &*Box::leak(s.into_boxed_str()))
            .collect()
    }
}

fn parse_capability(s: &str) -> Result<Capability> {
    let parts: Vec<&str> = s.splitn(2, ':').collect();
    if parts.len() != 2 {
        anyhow::bail!("Capability must be in format 'id:description'");
    }
    Ok(Capability::new(parts[0], parts[1]))
}

fn parse_protocol(s: &str) -> Result<Protocol> {
    let parts: Vec<&str> = s.splitn(2, ':').collect();
    if parts.len() != 2 {
        anyhow::bail!("Protocol must be in format 'type:endpoint'");
    }
    let endpoint = parts[1];
    match parts[0] {
        "dm" => Ok(Protocol::dm(endpoint)),
        "dvm" => Ok(Protocol::dvm(endpoint, vec![])),
        "a2a" => Ok(Protocol::a2a(endpoint)),
        "mcp" => Ok(Protocol::mcp(endpoint)),
        "http" => Ok(Protocol::http(endpoint)),
        other => Ok(Protocol::custom(other, endpoint)),
    }
}

// ============================================================================
// Commands
// ============================================================================

fn cmd_whoami(identity: &Identity, json: bool) -> Result<()> {
    if json {
        let output = serde_json::json!({
            "name": identity.name,
            "about": identity.about,
            "pubkey": identity.pubkey_hex,
            "npub": identity.npub,
            "relays": identity.relays,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Identity (from OpenClaw config):");
        println!("  Name:   {}", identity.name);
        println!("  About:  {}", identity.about);
        println!("  npub:   {}", identity.npub);
        println!("  pubkey: {}", identity.pubkey_hex);
        println!("  Relays: {}", identity.relays.join(", "));
    }

    Ok(())
}

async fn cmd_publish(
    identity: &Identity,
    id: Option<String>,
    name: Option<String>,
    about: Option<String>,
    capabilities: Vec<String>,
    protocols: Vec<String>,
    relays: Vec<String>,
    json_output: bool,
) -> Result<()> {
    let relays = get_relays(relays, &identity.relays);

    let card_id = id.unwrap_or_else(|| format!("{}-v1", &identity.pubkey_hex[..8]));
    let card_name = name.unwrap_or_else(|| identity.name.clone());
    let card_about = about.unwrap_or_else(|| identity.about.clone());

    let mut builder = ServiceCard::builder(&card_id, &card_name).about(&card_about);

    for cap_str in &capabilities {
        let cap = parse_capability(cap_str)?;
        builder = builder.capability(cap.id, cap.description);
    }

    for proto_str in &protocols {
        let proto = parse_protocol(proto_str)?;
        builder = builder.protocol(proto);
    }

    let card = builder.build();

    let client = AgentDiscoveryClient::new(identity.keys.clone()).await?;
    client.connect(&relays).await?;

    let event_id = client.publish_service_card(&card).await?;

    client.disconnect().await?;

    if json_output {
        let output = serde_json::json!({
            "event_id": event_id.to_hex(),
            "service_card_id": card_id,
            "relays": relays,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("✓ Published service card");
        println!("  ID:       {}", card_id);
        println!("  Event:    {}", event_id.to_hex());
        println!(
            "  Relays:   {}",
            relays.iter().copied().collect::<Vec<_>>().join(", ")
        );
    }

    Ok(())
}

async fn cmd_heartbeat(
    identity: &Identity,
    status_str: String,
    service_card_id: Option<String>,
    relays: Vec<String>,
    json_output: bool,
) -> Result<()> {
    let relays = get_relays(relays, &identity.relays);

    let status: Status = status_str.parse()?;
    let card_id = service_card_id.unwrap_or_else(|| format!("{}-v1", &identity.pubkey_hex[..8]));

    let client = AgentDiscoveryClient::new(identity.keys.clone()).await?;
    client.connect(&relays).await?;

    let event_id = client.send_heartbeat(&card_id, status).await?;

    client.disconnect().await?;

    if json_output {
        let output = serde_json::json!({
            "event_id": event_id.to_hex(),
            "status": status_str,
            "service_card_id": card_id,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("✓ Sent heartbeat: {}", status_str);
    }

    Ok(())
}

async fn cmd_discover(
    relays: Vec<String>,
    default_relays: &[String],
    capabilities: Vec<String>,
    limit: usize,
    json_output: bool,
) -> Result<()> {
    let keys = Keys::generate(); // Anonymous for read-only
    let relays = get_relays(relays, default_relays);

    let client = AgentDiscoveryClient::new(keys).await?;
    client.connect(&relays).await?;

    let cap_refs: Vec<&str> = capabilities.iter().map(|s| s.as_str()).collect();
    let agents = client.discover_agents(limit, None, &cap_refs).await?;

    client.disconnect().await?;

    if json_output {
        let output: Vec<_> = agents
            .iter()
            .map(|(card, event)| {
                serde_json::json!({
                    "id": card.id,
                    "name": card.name,
                    "about": card.about,
                    "capabilities": card.capabilities,
                    "protocols": card.protocols,
                    "pubkey": event.pubkey.to_hex(),
                })
            })
            .collect();
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("Found {} agent(s):\n", agents.len());
        for (card, event) in &agents {
            println!("  {} ({})", card.name, card.id);
            println!("    Author: {}...", &event.pubkey.to_hex()[..16]);
            if !card.about.is_empty() {
                println!("    About:  {}", card.about);
            }
            if !card.capabilities.is_empty() {
                let caps: Vec<&str> = card.capabilities.iter().map(|c| c.id.as_str()).collect();
                println!("    Capabilities: {}", caps.join(", "));
            }
            println!();
        }
    }

    Ok(())
}

async fn cmd_lookup(
    pubkey: String,
    relays: Vec<String>,
    default_relays: &[String],
    json_output: bool,
) -> Result<()> {
    let keys = Keys::generate();
    let relays = get_relays(relays, default_relays);

    let target_pk = if pubkey.starts_with("npub") {
        nostr::nips::nip19::FromBech32::from_bech32(&pubkey)?
    } else {
        nostr::PublicKey::from_hex(&pubkey)?
    };

    let client = AgentDiscoveryClient::new(keys).await?;
    client.connect(&relays).await?;

    let agents = client.discover_agents(10, Some(target_pk), &[]).await?;

    client.disconnect().await?;

    if agents.is_empty() {
        if json_output {
            println!("null");
        } else {
            println!("No service card found for {}", pubkey);
        }
        return Ok(());
    }

    let (card, event) = &agents[0];

    if json_output {
        let output = serde_json::json!({
            "id": card.id,
            "name": card.name,
            "about": card.about,
            "capabilities": card.capabilities,
            "protocols": card.protocols,
            "pubkey": event.pubkey.to_hex(),
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        println!("{} ({})", card.name, card.id);
        println!("  Author: {}", event.pubkey.to_hex());
        if !card.about.is_empty() {
            println!("  About:  {}", card.about);
        }
        println!("\n  Capabilities:");
        for cap in &card.capabilities {
            println!("    - {}: {}", cap.id, cap.description);
        }
        println!("\n  Protocols:");
        for proto in &card.protocols {
            println!("    - {}: {}", proto.id(), proto.endpoint());
        }
    }

    Ok(())
}

async fn cmd_status(
    pubkey: String,
    relays: Vec<String>,
    default_relays: &[String],
    json_output: bool,
) -> Result<()> {
    let keys = Keys::generate();
    let relays = get_relays(relays, default_relays);

    let target_pk = if pubkey.starts_with("npub") {
        nostr::nips::nip19::FromBech32::from_bech32(&pubkey)?
    } else {
        nostr::PublicKey::from_hex(&pubkey)?
    };

    let client = AgentDiscoveryClient::new(keys).await?;
    client.connect(&relays).await?;

    // First find their service card to get the ID
    let agents = client.discover_agents(1, Some(target_pk), &[]).await?;

    if agents.is_empty() {
        client.disconnect().await?;
        if json_output {
            println!(r#"{{"online": false, "reason": "no service card"}}"#);
        } else {
            println!("Agent not found (no service card)");
        }
        return Ok(());
    }

    let (card, _) = &agents[0];

    // Now get their heartbeats
    let heartbeats = client.get_heartbeats(target_pk, &card.id, 1).await?;

    client.disconnect().await?;

    if heartbeats.is_empty() {
        if json_output {
            println!(r#"{{"online": false, "reason": "no heartbeat"}}"#);
        } else {
            println!("{} - No heartbeat found", card.name);
        }
        return Ok(());
    }

    let (hb, event) = &heartbeats[0];
    let created_at = event.created_at.as_u64();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let age_secs = now.saturating_sub(created_at);
    let online = age_secs < 900; // Consider online if heartbeat < 15 min old

    if json_output {
        let output = serde_json::json!({
            "online": online,
            "status": hb.status.to_string(),
            "last_seen_secs": age_secs,
            "name": card.name,
        });
        println!("{}", serde_json::to_string_pretty(&output)?);
    } else {
        let status_emoji = if online { "🟢" } else { "⚫" };
        let age_str = if age_secs < 60 {
            format!("{}s ago", age_secs)
        } else if age_secs < 3600 {
            format!("{}m ago", age_secs / 60)
        } else {
            format!("{}h ago", age_secs / 3600)
        };

        println!(
            "{} {} - {} (last seen: {})",
            status_emoji, card.name, hb.status, age_str
        );
    }

    Ok(())
}

fn cmd_help(topic: Option<String>) {
    match topic.as_deref() {
        Some("protocols") => {
            println!("Supported protocols:\n");
            println!("  dm:<relays>      Nostr DMs (NIP-04/17)");
            println!("  dvm:<relays>     NIP-90 Data Vending Machine");
            println!("  a2a:<url>        Google A2A agent card URL");
            println!("  mcp:<url>        Model Context Protocol endpoint");
            println!("  http:<url>       REST API endpoint");
            println!("\nExample:");
            println!("  --protocol a2a:https://example.com/.well-known/agent.json");
        }
        Some("capabilities") => {
            println!("Capabilities are in format 'id:description'\n");
            println!("Examples:");
            println!("  --capability transcription:\"Convert audio to text\"");
            println!("  --capability summarization:\"Summarize documents\"");
            println!("  --capability coding:\"Write and review code\"");
        }
        Some("relays") => {
            println!("Relay configuration:");
            println!();
            println!("  Uses relays from OpenClaw config (channels.nostr.relays)");
            println!("  Override with --relay (can be repeated):");
            println!("    --relay wss://relay.example.com --relay wss://other.relay");
        }
        Some("config") => {
            println!("Configuration:");
            println!();
            println!("  agent-bridge reads identity from OpenClaw config:");
            println!("    ~/.openclaw/openclaw.json");
            println!();
            println!("  Required fields:");
            println!("    channels.nostr.privateKey  - hex or nsec1 format");
            println!();
            println!("  Optional fields:");
            println!("    channels.nostr.relays      - array of relay URLs");
            println!("    channels.nostr.profile.name");
            println!("    channels.nostr.profile.about");
            println!();
            println!("  Override config path with --config or OPENCLAW_CONFIG env var");
        }
        _ => {
            println!("agent-bridge - Service discovery for AI agents on Nostr\n");
            println!("Topics:");
            println!("  agent-bridge help config        Configuration");
            println!("  agent-bridge help protocols     Protocol formats");
            println!("  agent-bridge help capabilities  Capability formats");
            println!("  agent-bridge help relays        Relay configuration");
            println!("\nCommands:");
            println!("  whoami     Show your identity (from OpenClaw config)");
            println!("  publish    Publish your service card");
            println!("  heartbeat  Send a status heartbeat");
            println!("  discover   Find agents");
            println!("  lookup     Look up a specific agent");
            println!("  status     Check if an agent is online");
        }
    }
}

// ============================================================================
// Main
// ============================================================================

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    let config_path = get_config_path(cli.config)?;

    // Commands that don't need identity
    match &cli.command {
        Commands::Help { topic } => {
            cmd_help(topic.clone());
            return Ok(());
        }
        Commands::Discover {
            capability,
            limit,
            relay,
        } => {
            // Try to load config for default relays, but don't require it
            let default_relays = match load_identity(&config_path) {
                Ok(id) => id.relays,
                Err(_) => DEFAULT_RELAYS.iter().map(|s| s.to_string()).collect(),
            };
            return cmd_discover(relay.clone(), &default_relays, capability.clone(), *limit, cli.json).await;
        }
        Commands::Lookup { pubkey, relay } => {
            let default_relays = match load_identity(&config_path) {
                Ok(id) => id.relays,
                Err(_) => DEFAULT_RELAYS.iter().map(|s| s.to_string()).collect(),
            };
            return cmd_lookup(pubkey.clone(), relay.clone(), &default_relays, cli.json).await;
        }
        Commands::Status { pubkey, relay } => {
            let default_relays = match load_identity(&config_path) {
                Ok(id) => id.relays,
                Err(_) => DEFAULT_RELAYS.iter().map(|s| s.to_string()).collect(),
            };
            return cmd_status(pubkey.clone(), relay.clone(), &default_relays, cli.json).await;
        }
        _ => {}
    }

    // Commands that need identity
    let identity = load_identity(&config_path)?;

    match cli.command {
        Commands::Whoami => cmd_whoami(&identity, cli.json),
        Commands::Publish {
            id,
            name,
            about,
            capability,
            protocol,
            relay,
        } => {
            cmd_publish(
                &identity,
                id,
                name,
                about,
                capability,
                protocol,
                relay,
                cli.json,
            )
            .await
        }
        Commands::Heartbeat {
            status,
            service_card_id,
            relay,
        } => cmd_heartbeat(&identity, status, service_card_id, relay, cli.json).await,
        // Already handled above
        Commands::Discover { .. } | Commands::Lookup { .. } | Commands::Status { .. } | Commands::Help { .. } => {
            unreachable!()
        }
    }
}
