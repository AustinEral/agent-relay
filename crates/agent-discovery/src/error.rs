//! Error types for agent-discovery

use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Invalid capability: {0}")]
    InvalidCapability(String),

    #[error("Invalid protocol: {0}")]
    InvalidProtocol(String),

    #[error("Relay error: {0}")]
    RelayError(String),

    #[error("Signing error: {0}")]
    SigningError(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),

    #[error("Nostr error: {0}")]
    NostrError(String),
}
