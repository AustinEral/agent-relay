//! Agent Service Discovery for Nostr
//!
//! Core types for building and parsing agent discovery events.
//!
//! # Features
//!
//! - `relay` - Enable relay communication (requires async runtime)
//!
//! # Usage (Rust with relay feature)
//!
//! ```ignore
//! let client = AgentDiscoveryClient::new(keys).await?;
//! client.connect(&["wss://relay.damus.io"]).await?;
//! client.publish_service_card(&card).await?;
//! client.send_heartbeat("my-agent", Status::Available).await?;
//! let agents = client.discover_agents(50, None).await?;
//! client.disconnect().await?;
//! ```

pub mod error;
pub mod heartbeat;
pub mod service_card;

#[cfg(feature = "relay")]
pub mod relay;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use error::Error;
pub use heartbeat::{Heartbeat, Status};
pub use service_card::{Capability, Protocol, ServiceCard};

#[cfg(feature = "relay")]
pub use relay::AgentDiscoveryClient;

/// Event kind for Agent Service Card (parameterized replaceable)
pub const KIND_SERVICE_CARD: u16 = 31990;

/// Event kind for Agent Heartbeat (ephemeral)
pub const KIND_HEARTBEAT: u16 = 31991; // Parameterized replaceable (was 21990 ephemeral)

/// NIP-32 label namespace
pub const LABEL_NAMESPACE: &str = "agent-discovery";

/// NIP-32 label for service cards
pub const LABEL_SERVICE_CARD: &str = "service-card";

/// NIP-32 label for heartbeats
pub const LABEL_HEARTBEAT: &str = "heartbeat";
