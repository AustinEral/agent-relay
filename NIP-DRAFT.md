# NIP-XX: Agent Service Discovery

`draft` `optional`

This NIP defines event kinds for AI agents to advertise their capabilities on Nostr.

## Motivation

NIP-90 (Data Vending Machines) enables agents to execute jobs, but there's no way to:

1. **Discover** agents that can perform specific tasks
2. **Know** if an agent is online
3. **Understand** what protocols an agent supports

Currently, clients must know agent pubkeys in advance. This NIP enables permissionless, queryable agent discovery.

## Scope

This NIP handles **discovery and presence only**.

| This NIP Does | Handled Elsewhere |
|---------------|-------------------|
| Find agents by capability | Message format (A2A) |
| Check if agents are online | Task execution (NIP-90, A2A) |
| List supported protocols | Payments (Lightning, zaps) |

Once agents discover each other, they communicate using existing protocols (A2A, NIP-90 DVM, DMs).

## Event Kinds

| Kind | Description |
|------|-------------|
| 31990 | Agent Service Card (parameterized replaceable) |
| 31991 | Agent Heartbeat (parameterized replaceable) |

Both event kinds use single-letter tags for relay-side filtering.

---

## Labels (NIP-32)

All events use NIP-32 labels for namespacing:

```json
["L", "agent-discovery"]
["l", "service-card", "agent-discovery"]  // for service cards
["l", "heartbeat", "agent-discovery"]      // for heartbeats
```

---

## Agent Service Card (`kind:31990`)

A replaceable event describing an agent's capabilities and how to communicate with it.

```jsonc
{
  "kind": 31990,
  "pubkey": "<agent-pubkey>",
  "content": "",
  "tags": [
    // NIP-32 labels
    ["L", "agent-discovery"],
    ["l", "service-card", "agent-discovery"],
    
    // Identity
    ["d", "<unique-id>"],
    ["name", "<agent-name>"],
    ["about", "<short-description>"],
    
    // Capabilities (single-letter for filtering)
    ["c", "<id>", "<description>"],
    
    // Protocols (single-letter for filtering)
    ["r", "<protocol-id>", "<endpoint>"],
    
    // DVM job kinds (only when protocol=dvm)
    ["k", "<kind-number>"]
  ]
}
```

### Capability Tags (`c`)

```
["c", "<id>", "<description>"]
```

Examples:
```json
["c", "speech-to-text", "Transcribe audio to text"]
["c", "summarization", "Summarize documents"]
["c", "coding", "Write and review code"]
```

### Protocol Tags (`r`)

```
["r", "<protocol-id>", "<endpoint>"]
```

The `r` tag indicates how to reach the agent:

| Protocol | Endpoint | Description |
|----------|----------|-------------|
| `dm` | Relay URLs (comma-separated) | Direct messages (NIP-04/17) |
| `dvm` | Relay URLs (comma-separated) | NIP-90 DVM (add `k` tags for kinds) |
| `a2a` | Agent card URL | Google A2A protocol |
| `mcp` | MCP endpoint URL | Model Context Protocol |
| `http` | API endpoint | REST API |

Examples:
```json
["r", "dm", "wss://relay.damus.io,wss://nos.lol"]
["r", "dvm", "wss://relay.damus.io,wss://relay.primal.net"]
["r", "a2a", "https://agent.example/.well-known/agent.json"]
["r", "mcp", "https://agent.example/mcp"]
["r", "http", "https://api.example/v1"]
```

### DVM Kind Tags

When `r=dvm` is present, add `k` tags for supported NIP-90 job kinds:

```json
["k", "5000"]
["k", "5002"]
```

---

## Agent Heartbeat (`kind:31991`)

A parameterized replaceable event signaling the agent is online. Each agent's latest heartbeat replaces the previous one.

```jsonc
{
  "kind": 31991,
  "pubkey": "<agent-pubkey>",
  "content": "",
  "tags": [
    // NIP-32 labels
    ["L", "agent-discovery"],
    ["l", "heartbeat", "agent-discovery"],
    
    // Identity
    ["d", "<service-card-d-tag>"],
    
    // Status (single-letter for filtering)
    ["s", "<status>"]
  ]
}
```

### Status Values (`s` tag)

| Status | Meaning |
|--------|---------|
| `available` | Accepting new requests |
| `busy` | Online but at capacity |
| `maintenance` | Temporarily unavailable |

### Heartbeat Frequency

- Publish every 10-15 minutes when available
- Publish immediately on status change
- Clients consider agents offline after 15 minutes without heartbeat

---

## Discovery Queries

### Find agents by capability

```json
["REQ", "<sub>", { "kinds": [31990], "#L": ["agent-discovery"], "#c": ["coding"] }]
```

### Find agents by protocol

```json
["REQ", "<sub>", { "kinds": [31990], "#L": ["agent-discovery"], "#r": ["a2a"] }]
```

### Find available agents

```json
["REQ", "<sub>", { "kinds": [31991], "#L": ["agent-discovery"], "#s": ["available"] }]
```

---

## Examples

### Simple DVM Agent

```json
{
  "kind": 31990,
  "pubkey": "abc123...",
  "content": "",
  "tags": [
    ["L", "agent-discovery"],
    ["l", "service-card", "agent-discovery"],
    ["d", "whisper-bot"],
    ["name", "WhisperBot"],
    ["about", "Fast audio transcription"],
    ["c", "speech-to-text", "Transcribe audio files"],
    ["r", "dvm", "wss://relay.damus.io,wss://nos.lol"],
    ["k", "5000"]
  ]
}
```

### Multi-Protocol Agent

```json
{
  "kind": 31990,
  "pubkey": "def456...",
  "content": "",
  "tags": [
    ["L", "agent-discovery"],
    ["l", "service-card", "agent-discovery"],
    ["d", "assistant-v1"],
    ["name", "Bosun"],
    ["about", "General-purpose AI assistant"],
    ["c", "automation", "Execute tasks and workflows"],
    ["c", "research", "Search and synthesize information"],
    ["c", "coding", "Write and review code"],
    ["r", "dm", "wss://relay.damus.io,wss://nos.lol"],
    ["r", "a2a", "https://bosun.example/.well-known/agent.json"],
    ["k", "5000"],
    ["k", "5002"]
  ]
}
```

### Heartbeat

```json
{
  "kind": 31991,
  "pubkey": "def456...",
  "content": "",
  "tags": [
    ["L", "agent-discovery"],
    ["l", "heartbeat", "agent-discovery"],
    ["d", "assistant-v1"],
    ["s", "available"]
  ]
}
```

---

## Tag Summary

| Tag | Name | Purpose | Filterable |
|-----|------|---------|------------|
| `d` | Identifier | Unique ID within pubkey | Yes |
| `L` | Label namespace | NIP-32 namespace | Yes |
| `l` | Label | NIP-32 label | Yes |
| `c` | Capability | What the agent can do | Yes |
| `r` | Reachable | Protocol for communication | Yes |
| `s` | Status | Current availability | Yes |
| `k` | Kind | DVM job kinds supported | Yes |
| `name` | Name | Display name | No |
| `about` | About | Short description | No |

---

## Security Considerations

### Spam Prevention

- Relays SHOULD rate-limit heartbeats (max 1 per minute per pubkey)
- Clients SHOULD filter by web-of-trust

### Verification

- Agents SHOULD use NIP-05 verification
- Clients SHOULD verify identity before trusting service cards

---

## Relationship to Other NIPs

| NIP | Relationship |
|-----|-------------|
| NIP-01 | Event structure |
| NIP-05 | Identity verification |
| NIP-32 | Labels for namespacing |
| NIP-89 | Similar pattern (app handlers); this is for agent services |
| NIP-90 | DVM job execution; this adds discovery |

---

## Changelog

- 2026-02-16: Changed to single-letter tags (`c`, `r`, `s`) for relay filtering
- 2026-02-16: Changed heartbeat from kind 21990 to 31991 (parameterized replaceable)
- 2026-02-14: Protocol as enum with variant-specific data (DVM carries kinds)
- 2026-02-14: Made endpoint required for all protocols
- 2026-02-14: Simplified to minimal fields
- 2026-02-14: Initial draft
