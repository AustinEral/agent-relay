//! WASM exports for use from JavaScript

use wasm_bindgen::prelude::*;

use crate::{Heartbeat, ServiceCard, KIND_HEARTBEAT, KIND_SERVICE_CARD};

/// Event kind for service cards (31990)
#[wasm_bindgen]
pub fn kind_service_card() -> u16 {
    KIND_SERVICE_CARD
}

/// Event kind for heartbeats (21990)
#[wasm_bindgen]
pub fn kind_heartbeat() -> u16 {
    KIND_HEARTBEAT
}

/// Build tags for a service card event.
///
/// Input: ServiceCard as JSON
/// Output: Array of tag arrays as JSON (e.g., `[["d", "id"], ["name", "Agent"]]`)
#[wasm_bindgen]
pub fn build_service_card_tags(card_json: &str) -> Result<String, JsError> {
    let card: ServiceCard = serde_json::from_str(card_json)
        .map_err(|e| JsError::new(&format!("invalid service card JSON: {e}")))?;

    let tags: Vec<Vec<String>> = card
        .to_tags()
        .into_iter()
        .map(|tag| tag.as_slice().iter().map(|s| s.to_string()).collect())
        .collect();

    serde_json::to_string(&tags).map_err(|e| JsError::new(&format!("serialization error: {e}")))
}

/// Build tags for a heartbeat event.
///
/// Input: Heartbeat as JSON
/// Output: Array of tag arrays as JSON
#[wasm_bindgen]
pub fn build_heartbeat_tags(heartbeat_json: &str) -> Result<String, JsError> {
    let heartbeat: Heartbeat = serde_json::from_str(heartbeat_json)
        .map_err(|e| JsError::new(&format!("invalid heartbeat JSON: {e}")))?;

    let tags: Vec<Vec<String>> = heartbeat
        .to_tags()
        .into_iter()
        .map(|tag| tag.as_slice().iter().map(|s| s.to_string()).collect())
        .collect();

    serde_json::to_string(&tags).map_err(|e| JsError::new(&format!("serialization error: {e}")))
}

/// Parse a Nostr event into a ServiceCard.
///
/// Input: Nostr event as JSON (with tags array)
/// Output: ServiceCard as JSON
#[wasm_bindgen]
pub fn parse_service_card(event_json: &str) -> Result<String, JsError> {
    use nostr::Event;

    let event: Event = serde_json::from_str(event_json)
        .map_err(|e| JsError::new(&format!("invalid event JSON: {e}")))?;

    let card = ServiceCard::try_from(&event)
        .map_err(|e| JsError::new(&format!("failed to parse service card: {e}")))?;

    serde_json::to_string(&card).map_err(|e| JsError::new(&format!("serialization error: {e}")))
}

/// Parse a Nostr event into a Heartbeat.
///
/// Input: Nostr event as JSON (with tags array)
/// Output: Heartbeat as JSON
#[wasm_bindgen]
pub fn parse_heartbeat(event_json: &str) -> Result<String, JsError> {
    use nostr::Event;

    let event: Event = serde_json::from_str(event_json)
        .map_err(|e| JsError::new(&format!("invalid event JSON: {e}")))?;

    let heartbeat = Heartbeat::try_from(&event)
        .map_err(|e| JsError::new(&format!("failed to parse heartbeat: {e}")))?;

    serde_json::to_string(&heartbeat)
        .map_err(|e| JsError::new(&format!("serialization error: {e}")))
}
