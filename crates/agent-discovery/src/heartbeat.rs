//! Agent Heartbeat

use nostr::event::{Event, EventBuilder, Kind};
use nostr::key::Keys;
use nostr::Tag;
use serde::{Deserialize, Serialize};

use crate::{Error, KIND_HEARTBEAT, LABEL_HEARTBEAT, LABEL_NAMESPACE};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Available,
    Busy,
    Maintenance,
}

impl std::fmt::Display for Status {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Status::Available => write!(f, "available"),
            Status::Busy => write!(f, "busy"),
            Status::Maintenance => write!(f, "maintenance"),
        }
    }
}

impl std::str::FromStr for Status {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "available" => Ok(Status::Available),
            "busy" => Ok(Status::Busy),
            "maintenance" => Ok(Status::Maintenance),
            other => Err(Error::ParseError(format!("unknown status: {other}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Heartbeat {
    pub service_card_id: String,
    pub status: Status,
}

impl Heartbeat {
    pub fn new(service_card_id: impl Into<String>, status: Status) -> Self {
        Self {
            service_card_id: service_card_id.into(),
            status,
        }
    }

    pub fn available(service_card_id: impl Into<String>) -> Self {
        Self::new(service_card_id, Status::Available)
    }

    pub fn busy(service_card_id: impl Into<String>) -> Self {
        Self::new(service_card_id, Status::Busy)
    }

    pub fn maintenance(service_card_id: impl Into<String>) -> Self {
        Self::new(service_card_id, Status::Maintenance)
    }

    pub fn to_tags(&self) -> Vec<Tag> {
        vec![
            Tag::parse(["L", LABEL_NAMESPACE]).unwrap(),
            Tag::parse(["l", LABEL_HEARTBEAT, LABEL_NAMESPACE]).unwrap(),
            Tag::parse(["d", &self.service_card_id]).unwrap(),
            Tag::parse(["s", &self.status.to_string()]).unwrap(),
        ]
    }

    /// Convenience method to sign directly. Equivalent to:
    /// `EventBuilder::from(&heartbeat).sign_with_keys(keys)`
    pub fn to_event(&self, keys: &Keys) -> Result<Event, Error> {
        EventBuilder::from(self).sign_with_keys(keys).map_err(|e| {
            let err = e.to_string();
            Error::SigningError(format!("failed to sign heartbeat: {err}"))
        })
    }
}

impl From<&Heartbeat> for EventBuilder {
    fn from(heartbeat: &Heartbeat) -> Self {
        EventBuilder::new(Kind::Custom(KIND_HEARTBEAT), "").tags(heartbeat.to_tags())
    }
}

impl TryFrom<&Event> for Heartbeat {
    type Error = Error;

    fn try_from(event: &Event) -> Result<Self, Self::Error> {
        let mut service_card_id = None;
        let mut status = None;

        for tag in event.tags.iter() {
            let values: Vec<&str> = tag.as_slice().iter().map(|s| s.as_str()).collect();
            if values.len() < 2 {
                continue;
            }

            match values[0] {
                "d" => service_card_id = Some(values[1].to_string()),
                "s" => status = Some(values[1].parse()?),
                _ => {}
            }
        }

        Ok(Heartbeat {
            service_card_id: service_card_id
                .ok_or_else(|| Error::ParseError("missing 'd' tag".to_string()))?,
            status: status.ok_or_else(|| Error::ParseError("missing 'status' tag".to_string()))?,
        })
    }
}
