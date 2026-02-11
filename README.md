# agent-reach

DID-based discovery for AI agents. The phonebook for the agentic web.

## The Problem

Agents have identities (DIDs via [agent-id](https://github.com/AustinEral/agent-id)), but how do they find each other?

- DIDs don't include reachability information
- Agents move around — different IPs, different networks
- A2A and other protocols assume you already have an endpoint

## The Solution

A simple registry that maps DIDs to current reachability:

1. **Register**: "I'm `did:key:z6Mk...`, reach me at `<endpoint>`"
2. **Lookup**: "Where is `did:key:z6Mk...`?" → `<endpoint>`

That's it. How agents actually communicate is up to them — A2A, ACP, raw WebSockets, Nostr, local sockets, whatever works.

## How It Fits

```
┌─────────────────────────────────┐
│     A2A / ACP / custom          │  ← communication protocol
├─────────────────────────────────┤
│     Transport (Nostr, HTTP,     │  ← how messages flow
│     WebSocket, local socket)    │
├─────────────────────────────────┤
│         agent-reach             │  ← where to find agents
├─────────────────────────────────┤
│          agent-id               │  ← who agents are
└─────────────────────────────────┘
```

## Status

🚧 **Early development** — see [docs/](docs/) for design discussions.

## Documentation

- [GOALS.md](docs/GOALS.md) — What we're building
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — How it works
- [PROTOCOL.md](docs/PROTOCOL.md) — Wire protocol (coming soon)

## Related Projects

- [agent-id](https://github.com/AustinEral/agent-id) — Cryptographic identity for agents
- [agent-id-mcp](https://github.com/AustinEral/agent-id-mcp) — MCP server for agent-id
- [Google A2A](https://github.com/google/A2A) — Agent-to-agent communication protocol

## License

Apache-2.0
