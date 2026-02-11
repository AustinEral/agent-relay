# Goals

## What We're Building

A registry that lets agents find each other by DID.

**Core functions:**

1. **Registration** — Agent registers its DID and current endpoint
2. **Discovery** — Look up an agent by DID, get their endpoint
3. **Presence** — Know if an agent is online/available

## What We're NOT Building

- **Message relay** — We don't pass messages through. That's for transport layers.
- **Communication protocol** — A2A, ACP, or custom protocols handle that.
- **Persistent message queues** — Agents handle their own storage.

We're the phonebook, not the phone company.

## Why

Agent identity (agent-id) gives agents DIDs. But a DID alone doesn't tell you *how to reach* the agent.

Current state:
- A2A discovery assumes `/.well-known/agent-card.json` on a domain
- Most agents don't have domains or public IPs
- No standard way to go from DID → reachable endpoint

agent-reach solves this.

## Design Principles

1. **DID-native** — DID is the primary identifier, not URLs or usernames
2. **Signed registrations** — All registrations signed with agent's key
3. **Transport-agnostic** — Endpoints can be HTTP, WebSocket, Nostr, local sockets, anything
4. **Start centralized, design for federation** — Ship fast, decentralize later
5. **Open protocol** — Anyone can run their own registry

## Non-Goals (for now)

- Fully decentralized P2P discovery (future consideration)
- Message storage or relay
- Enforcing specific communication protocols

## Success Criteria

- Agent A can look up Agent B by DID and get a reachable endpoint
- Works regardless of transport choice (HTTP, WebSocket, Nostr, etc.)
- Sub-second lookup latency
- Registrations update dynamically as agents move
