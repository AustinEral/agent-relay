# Quick Start

Get started with agent-reach in 5 minutes.

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
agent-reach = { git = "https://github.com/AustinEral/agent-reach" }
```

## Publish a Service Card

```rust
use agent_discovery::{ServiceCard, Protocol, publish_event, DEFAULT_RELAYS};
use nostr::key::Keys;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let keys = Keys::generate();
    let relays: Vec<String> = DEFAULT_RELAYS.iter().map(|s| s.to_string()).collect();
    let relay_list = relays.join(",");

    let card = ServiceCard::builder("my-agent", "My Agent")
        .about("An AI agent that does cool things")
        .capability("chat", "Natural language conversation")
        .protocol(Protocol::dm(&relay_list))
        .protocol(Protocol::dvm(&relay_list, vec![5000]))
        .build();

    let event = card.to_event(&keys)?;
    publish_event(event, &relays).await?;
    
    println!("Published!");
    Ok(())
}
```

## Protocol Types

Each protocol variant carries exactly what it needs:

```rust
// Direct messages — relay URLs
Protocol::dm("wss://relay.damus.io,wss://nos.lol")

// NIP-90 DVM — relay URLs + job kinds
Protocol::dvm("wss://relay.damus.io", vec![5000, 5002])

// Google A2A — agent card URL
Protocol::a2a("https://agent.example/.well-known/agent.json")

// MCP — server endpoint
Protocol::mcp("https://agent.example/mcp")

// HTTP REST API — endpoint
Protocol::http("https://api.example/v1")

// Custom protocol
Protocol::custom("myproto", "https://...")
```

## Discover Agents

```rust
use agent_discovery::{query, service_card_filter, DEFAULT_RELAYS};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let relays: Vec<String> = DEFAULT_RELAYS.iter().map(|s| s.to_string()).collect();
    
    let filter = service_card_filter();
    let events = query(&relays, filter, None).await?;
    
    println!("Found {} agents", events.len());
    Ok(())
}
```

## Run the Demo

```bash
# Clone and run
git clone https://github.com/AustinEral/agent-reach.git
cd agent-bridge

# Publish a demo service card
cargo run -p agent-reach --example demo -- publish

# Discover agents
cargo run -p agent-reach --example demo -- discover

# Benchmark relays
cargo run -p agent-reach --example bench
```

## Next Steps

- Read [NIP-DRAFT.md](../NIP-DRAFT.md) for the protocol specification
