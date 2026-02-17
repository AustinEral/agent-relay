//! Agent Service Card

use nostr::event::{Event, EventBuilder, Kind};
use nostr::key::Keys;
use nostr::Tag;
use serde::{Deserialize, Serialize};

use crate::{Error, KIND_SERVICE_CARD, LABEL_NAMESPACE, LABEL_SERVICE_CARD};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Capability {
    pub id: String,
    pub description: String,
}

impl Capability {
    pub fn new(id: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            description: description.into(),
        }
    }

    pub fn to_tag(&self) -> Tag {
        Tag::parse(["c", &self.id, &self.description]).unwrap()
    }
}

/// Communication protocol for reaching an agent.
/// Each variant carries exactly the data it needs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Protocol {
    /// Direct messages (NIP-04/17) — relays where agent listens
    Dm { relays: String },

    /// NIP-90 Data Vending Machine — relays + supported job kinds
    Dvm { relays: String, kinds: Vec<u16> },

    /// Google A2A protocol — agent card URL
    A2a { url: String },

    /// Model Context Protocol — MCP server endpoint
    Mcp { url: String },

    /// HTTP REST API — API endpoint
    Http { url: String },

    /// Custom protocol — for extensibility
    Custom { id: String, endpoint: String },
}

impl Protocol {
    // Convenience constructors
    pub fn dm(relays: impl Into<String>) -> Self {
        Self::Dm {
            relays: relays.into(),
        }
    }

    pub fn dvm(relays: impl Into<String>, kinds: Vec<u16>) -> Self {
        Self::Dvm {
            relays: relays.into(),
            kinds,
        }
    }

    pub fn a2a(url: impl Into<String>) -> Self {
        Self::A2a { url: url.into() }
    }

    pub fn mcp(url: impl Into<String>) -> Self {
        Self::Mcp { url: url.into() }
    }

    pub fn http(url: impl Into<String>) -> Self {
        Self::Http { url: url.into() }
    }

    pub fn custom(id: impl Into<String>, endpoint: impl Into<String>) -> Self {
        Self::Custom {
            id: id.into(),
            endpoint: endpoint.into(),
        }
    }

    pub fn id(&self) -> &str {
        match self {
            Self::Dm { .. } => "dm",
            Self::Dvm { .. } => "dvm",
            Self::A2a { .. } => "a2a",
            Self::Mcp { .. } => "mcp",
            Self::Http { .. } => "http",
            Self::Custom { id, .. } => id,
        }
    }

    pub fn endpoint(&self) -> &str {
        match self {
            Self::Dm { relays } => relays,
            Self::Dvm { relays, .. } => relays,
            Self::A2a { url } => url,
            Self::Mcp { url } => url,
            Self::Http { url } => url,
            Self::Custom { endpoint, .. } => endpoint,
        }
    }

    pub fn to_tags(&self) -> Vec<Tag> {
        let mut tags = vec![Tag::parse(["r", self.id(), self.endpoint()]).unwrap()];

        // DVM adds k tags for supported job kinds
        if let Self::Dvm { kinds, .. } = self {
            for kind in kinds {
                tags.push(Tag::parse(["k", &kind.to_string()]).unwrap());
            }
        }

        tags
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceCard {
    pub id: String,
    pub name: String,
    pub about: String,
    pub capabilities: Vec<Capability>,
    pub protocols: Vec<Protocol>,
}

impl ServiceCard {
    pub fn builder(id: impl Into<String>, name: impl Into<String>) -> ServiceCardBuilder {
        ServiceCardBuilder::new(id, name)
    }

    pub fn to_tags(&self) -> Vec<Tag> {
        let mut tags = vec![
            // NIP-32 labels
            Tag::parse(["L", LABEL_NAMESPACE]).unwrap(),
            Tag::parse(["l", LABEL_SERVICE_CARD, LABEL_NAMESPACE]).unwrap(),
            // Identity
            Tag::parse(["d", &self.id]).unwrap(),
            Tag::parse(["name", &self.name]).unwrap(),
            Tag::parse(["about", &self.about]).unwrap(),
        ];

        // Capabilities
        for cap in &self.capabilities {
            tags.push(cap.to_tag());
        }

        // Protocols (each may produce multiple tags, e.g., DVM adds k tags)
        for proto in &self.protocols {
            tags.extend(proto.to_tags());
        }

        tags
    }

    /// Convenience method to sign directly. Equivalent to:
    /// `EventBuilder::from(&card).sign_with_keys(keys)`
    pub fn to_event(&self, keys: &Keys) -> Result<Event, Error> {
        EventBuilder::from(self).sign_with_keys(keys).map_err(|e| {
            let err = e.to_string();
            Error::SigningError(format!("failed to sign service card: {err}"))
        })
    }
}

impl From<&ServiceCard> for EventBuilder {
    fn from(card: &ServiceCard) -> Self {
        EventBuilder::new(Kind::Custom(KIND_SERVICE_CARD), "").tags(card.to_tags())
    }
}

impl TryFrom<&Event> for ServiceCard {
    type Error = Error;

    fn try_from(event: &Event) -> Result<Self, Self::Error> {
        let mut id = None;
        let mut name = None;
        let mut about = None;
        let mut capabilities = Vec::new();
        let mut protocols = Vec::new();
        let mut dvm_kinds = Vec::new();

        for tag in event.tags.iter() {
            let values: Vec<&str> = tag.as_slice().iter().map(|s| s.as_str()).collect();
            if values.is_empty() {
                continue;
            }

            match values[0] {
                "d" if values.len() >= 2 => id = Some(values[1].to_string()),
                "name" if values.len() >= 2 => name = Some(values[1].to_string()),
                "about" if values.len() >= 2 => about = Some(values[1].to_string()),
                "c" if values.len() >= 3 => {
                    capabilities.push(Capability::new(values[1], values[2]));
                }
                "r" if values.len() >= 2 => {
                    let proto_id = values[1];
                    let endpoint = values.get(2).unwrap_or(&"").to_string();

                    // Build protocol - DVM kinds attached later
                    let proto = match proto_id {
                        "dm" => Protocol::Dm { relays: endpoint },
                        "dvm" => Protocol::Dvm {
                            relays: endpoint,
                            kinds: Vec::new(), // filled in below
                        },
                        "a2a" => Protocol::A2a { url: endpoint },
                        "mcp" => Protocol::Mcp { url: endpoint },
                        "http" => Protocol::Http { url: endpoint },
                        other => Protocol::Custom {
                            id: other.to_string(),
                            endpoint,
                        },
                    };
                    protocols.push(proto);
                }
                "k" if values.len() >= 2 => {
                    if let Ok(kind) = values[1].parse::<u16>() {
                        dvm_kinds.push(kind);
                    }
                }
                _ => {}
            }
        }

        // Attach DVM kinds to DVM protocol
        for proto in &mut protocols {
            if let Protocol::Dvm { kinds, .. } = proto {
                *kinds = dvm_kinds.clone();
            }
        }

        Ok(ServiceCard {
            id: id.ok_or_else(|| Error::ParseError("missing 'd' tag".to_string()))?,
            name: name.ok_or_else(|| Error::ParseError("missing 'name' tag".to_string()))?,
            about: about.unwrap_or_default(),
            capabilities,
            protocols,
        })
    }
}

#[derive(Debug, Clone, Default)]
pub struct ServiceCardBuilder {
    id: String,
    name: String,
    about: String,
    capabilities: Vec<Capability>,
    protocols: Vec<Protocol>,
}

impl ServiceCardBuilder {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            name: name.into(),
            ..Default::default()
        }
    }

    pub fn about(mut self, about: impl Into<String>) -> Self {
        self.about = about.into();
        self
    }

    pub fn capability(mut self, id: impl Into<String>, description: impl Into<String>) -> Self {
        self.capabilities.push(Capability::new(id, description));
        self
    }

    pub fn protocol(mut self, protocol: Protocol) -> Self {
        self.protocols.push(protocol);
        self
    }

    pub fn build(self) -> ServiceCard {
        ServiceCard {
            id: self.id,
            name: self.name,
            about: self.about,
            capabilities: self.capabilities,
            protocols: self.protocols,
        }
    }
}
