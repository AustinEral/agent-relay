//! Relay communication for agent discovery.
//!
//! Feature-gated behind `relay` feature. Excluded from WASM builds.

use std::time::Duration;

use nostr_sdk::prelude::*;

use crate::{
    Error, Heartbeat, ServiceCard, Status, KIND_HEARTBEAT, KIND_SERVICE_CARD, LABEL_NAMESPACE,
};

/// Client for agent discovery operations.
pub struct AgentDiscoveryClient {
    client: Client,
}

impl AgentDiscoveryClient {
    /// Create a new client with the given keys.
    pub async fn new(keys: Keys) -> Result<Self, Error> {
        let client = Client::new(keys);
        Ok(Self { client })
    }

    /// Connect to relays.
    pub async fn connect(&self, relays: &[&str]) -> Result<(), Error> {
        for relay in relays {
            self.client
                .add_relay(*relay)
                .await
                .map_err(|e| Error::RelayError(e.to_string()))?;
        }
        self.client.connect().await;
        Ok(())
    }

    /// Disconnect from all relays.
    pub async fn disconnect(&self) -> Result<(), Error> {
        let _ = self.client.disconnect().await;
        Ok(())
    }

    /// Publish a service card.
    pub async fn publish_service_card(&self, card: &ServiceCard) -> Result<EventId, Error> {
        let builder = EventBuilder::from(card);
        let output = self
            .client
            .send_event_builder(builder)
            .await
            .map_err(|e| Error::RelayError(e.to_string()))?;
        Ok(output.val)
    }

    /// Send a heartbeat.
    pub async fn send_heartbeat(
        &self,
        service_card_id: &str,
        status: Status,
    ) -> Result<EventId, Error> {
        let heartbeat = Heartbeat::new(service_card_id, status);
        let builder = EventBuilder::from(&heartbeat);
        let output = self
            .client
            .send_event_builder(builder)
            .await
            .map_err(|e| Error::RelayError(e.to_string()))?;
        Ok(output.val)
    }

    /// Discover agents, optionally filtered by capabilities (AND logic).
    pub async fn discover_agents(
        &self,
        limit: usize,
        author: Option<PublicKey>,
        capabilities: &[&str],
    ) -> Result<Vec<(ServiceCard, Event)>, Error> {
        let mut filter = Filter::new()
            .kind(Kind::Custom(KIND_SERVICE_CARD))
            .custom_tag(SingleLetterTag::uppercase(Alphabet::L), [LABEL_NAMESPACE])
            .limit(limit);

        if let Some(pk) = author {
            filter = filter.author(pk);
        }

        // Multiple capabilities = OR (matches Nostr filter semantics)
        if !capabilities.is_empty() {
            filter = filter.custom_tag(SingleLetterTag::lowercase(Alphabet::C), capabilities.to_vec());
        }

        let events = self
            .client
            .fetch_events(vec![filter], Some(Duration::from_secs(10)))
            .await
            .map_err(|e| Error::RelayError(e.to_string()))?;

        let mut cards = Vec::new();
        for event in events {
            match ServiceCard::try_from(&event) {
                Ok(card) => cards.push((card, event)),
                Err(e) => eprintln!("Failed to parse service card: {e}"),
            }
        }

        Ok(cards)
    }

    /// Get heartbeats for a service card.
    pub async fn get_heartbeats(
        &self,
        author: PublicKey,
        service_card_id: &str,
        limit: usize,
    ) -> Result<Vec<(Heartbeat, Event)>, Error> {
        let filter = Filter::new()
            .kind(Kind::Custom(KIND_HEARTBEAT))
            .author(author)
            .custom_tag(SingleLetterTag::lowercase(Alphabet::D), [service_card_id])
            .limit(limit);

        let events = self
            .client
            .fetch_events(vec![filter], Some(Duration::from_secs(10)))
            .await
            .map_err(|e| Error::RelayError(e.to_string()))?;

        let mut heartbeats = Vec::new();
        for event in events {
            match Heartbeat::try_from(&event) {
                Ok(hb) => heartbeats.push((hb, event)),
                Err(e) => eprintln!("Failed to parse heartbeat: {e}"),
            }
        }

        Ok(heartbeats)
    }
}
