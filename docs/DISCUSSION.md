# Design Discussion

*Captured from initial brainstorm, 2026-02-11*

## The Problem We're Solving

A2A and other agent protocols handle communication *once connected*, but don't solve:

1. **Discovery**: How do I find an agent by their identity?
2. **Dynamic endpoints**: Agents move around — different IPs, different networks
3. **No standard mapping**: DID alone doesn't tell you where to connect

agent-id gives agents DIDs. But DID alone doesn't tell you how to reach them.

## Key Insight

Agent communication protocols assume you have an endpoint. But how do you get from:

```
"I want to talk to did:key:z6MkkCZkbDtaJA..."
```

to:

```
"Connect to wss://192.168.1.50:8080"
```

That's the gap. That's what we solve.

## What We're NOT Doing

We're not building another communication protocol. We're not relaying messages. We're not storing conversations.

We're building a **phonebook**: look up a DID, get an endpoint, connect directly.

The actual communication can be:
- A2A over HTTPS
- Custom protocol over WebSocket
- Nostr relays
- Local Unix sockets
- Whatever works for the agents

## Integration Points

### With agent-id
- All registrations signed with agent's DID key
- DID is the only identifier needed
- Verification uses agent-id crypto

### With A2A / ACP / etc.
- Agent looks up peer's endpoint via agent-reach
- Connects directly using their preferred protocol
- We're invisible once they're connected

### With OpenClaw
- MCP tools for registration and lookup
- Agent registers on startup
- Looks up other agents by DID when needed

## Centralized vs Decentralized

**Start centralized:**
- Ship fast
- Prove the concept
- One registry at reach.agent-id.ai

**Design for federation:**
- Open protocol
- Anyone can run a registry
- Agents can specify their preferred registry

**Future decentralized (maybe):**
- DHT-based discovery
- No central service
- Complex, solve later

## Open Questions

1. **TTL**: How long should registrations live? Configurable?
2. **Offline status**: Do we track "last seen" for offline agents?
3. **Rate limiting**: How to prevent spam registrations?
4. **Privacy**: Should lookups be public or require authentication?
5. **Multi-registry**: How do agents specify which registry they use?

## Key Decision: Registry Only

We explicitly chose NOT to relay messages. Why?

1. **Solved problem**: Message transport is well-solved (HTTP, WebSocket, Nostr, etc.)
2. **Scope creep**: Building a message broker is a whole different project
3. **Privacy**: We never see the content of agent communications
4. **Simplicity**: Less to build, less to break

We just answer: "Where is this agent right now?"

## Next Steps

1. Define wire protocol (HTTP REST)
2. Build minimal registry server
3. Add MCP tools for OpenClaw integration
4. Deploy at reach.agent-id.ai
5. Test with two OpenClaw agents discovering each other
