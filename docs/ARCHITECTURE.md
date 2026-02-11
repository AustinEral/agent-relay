# Architecture

## Overview

```
┌──────────────┐                          ┌──────────────┐
│   Agent A    │                          │   Agent B    │
└──────┬───────┘                          └───────┬──────┘
       │                                          │
       │ 1. Register                              │ 1. Register
       │    (DID + endpoint)                      │    (DID + endpoint)
       ▼                                          ▼
┌─────────────────────────────────────────────────────────┐
│                      agent-reach                         │
│                                                          │
│   ┌─────────────────────────────────────────────────┐   │
│   │                    Registry                      │   │
│   │                                                  │   │
│   │   did:key:z6MkA... → wss://agent-a.local:8080   │   │
│   │   did:key:z6MkB... → nostr:npub1abc...          │   │
│   │   did:key:z6MkC... → https://agent-c.example    │   │
│   │                                                  │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
       │
       │ 2. Lookup Agent B
       │
       ▼
Agent A connects directly to Agent B's endpoint
```

## Registry

The core (and only) data structure. Maps DIDs to reachability info:

```
did:key:z6MkA... → { 
  endpoint: "wss://192.168.1.50:8080",
  registered_at: "2026-02-11T05:00:00Z",
  expires_at: "2026-02-11T06:00:00Z",
  status: "online"
}

did:key:z6MkB... → {
  endpoint: "nostr:npub1xyz...?relay=wss://relay.example.com",
  registered_at: "2026-02-11T04:30:00Z",
  expires_at: "2026-02-11T05:30:00Z",
  status: "online"
}
```

### Endpoint Formats

Transport-agnostic. Examples:

| Transport | Endpoint Format |
|-----------|-----------------|
| HTTPS | `https://agent.example.com/a2a` |
| WebSocket | `wss://192.168.1.50:8080` |
| Nostr | `nostr:npub1...?relay=wss://relay.example` |
| Local socket | `unix:///tmp/agent.sock` |
| Custom | `myproto://whatever-works` |

agent-reach doesn't validate or connect to these — it just stores and returns them.

## Flows

### Registration

```
Agent                          agent-reach
  │                                  │
  │  POST /register                  │
  │  {                               │
  │    did: "did:key:z6Mk...",       │
  │    endpoint: "wss://...",        │
  │    ttl: 3600,                    │
  │    signature: "..."              │
  │  }                               │
  │─────────────────────────────────▶│
  │                                  │ Verify signature
  │                                  │ Store in registry
  │       { ok: true, expires: ... } │
  │◀─────────────────────────────────│
```

### Lookup

```
Agent A                        agent-reach
  │                                  │
  │  GET /lookup/{did}               │
  │─────────────────────────────────▶│
  │                                  │
  │  {                               │
  │    endpoint: "wss://...",        │
  │    status: "online"              │
  │  }                               │
  │◀─────────────────────────────────│
```

### Deregistration

```
Agent                          agent-reach
  │                                  │
  │  POST /deregister                │
  │  { did, signature }              │
  │─────────────────────────────────▶│
  │                                  │ Verify signature
  │                                  │ Remove from registry
  │       { ok: true }               │
  │◀─────────────────────────────────│
```

## TTL and Expiration

Registrations are ephemeral:

- Agent specifies TTL (time-to-live) on registration
- Expired entries automatically removed
- Agents re-register periodically to stay "online"
- No registration = agent is unreachable via this registry

## Future: Federation

Registries can peer with each other:

```
Agent A ──▶ Registry 1 ──▶ Registry 2
            "do you know    "yes, here's
             did:key:z6MkB?" their endpoint"
```

DID could include registry hint:
```
did:key:z6MkA...?reach=reach.agent-id.ai
```

Or registries maintain a shared index of known DIDs.

## Tech Stack (Proposed)

- **Runtime**: Rust (tokio)
- **Database**: Redis (fast, built-in TTL) or SQLite
- **API**: HTTP REST (simple, widely compatible)
- **Deployment**: Single VPS to start
