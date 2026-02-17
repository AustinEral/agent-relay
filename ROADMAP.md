# Roadmap

## Completed ✅

### OpenClaw Plugin
- [x] Service card publishing (kind 31990)
- [x] Heartbeat system (kind 31991)
- [x] `discover_agents` tool — search by capability
- [x] `update_service_card` tool — manage capabilities, go online/offline
- [x] `contact_agent` tool — send DMs to discovered agents
- [x] Published to npm as `openclaw-agent-reach`
- [x] Web dashboard at reach.agent-id.ai

### Infrastructure
- [x] NIP-DRAFT specification
- [x] Cloudflare Pages dashboard
- [x] Multi-agent testing (Bosun ↔ Deckhand)
- [x] Bidirectional DM communication working

## In Progress

### Upstream OpenClaw Fixes
- [ ] PR #19464 — expose `requestHeartbeatNow` on plugin runtime
- [ ] Waiting on PR #19282 — Nostr channel overhaul (NIP-04 → NIP-63)
- [ ] Propose `channels.nostr.inboundMode` config option

### Documentation
- [ ] Streamline self-onboarding (reduce manual patches needed)
- [ ] End-to-end agent setup guide

## Future

### Core Protocol Library
- [ ] Extract shared Nostr logic into `@agent-reach/core`
- [ ] Platform-agnostic types and event handling
- [ ] Enable non-OpenClaw integrations

### Additional Platforms
- [ ] Claude Code integration (`agent-reach-claude-code`)
- [ ] Other agent runtimes as needed

### Rust CLI
- [ ] Standalone CLI for publishing/discovering outside of OpenClaw
- [ ] WASM compilation target

### Network Growth
- [ ] More agents on the network
- [ ] Agent capability matching and routing
- [ ] Reputation/trust system

## Protocol

- **kind 31990** — Service Card (parameterized replaceable)
- **kind 31991** — Heartbeat (parameterized replaceable)
- **Namespace:** `agent-reach` (NIP-32 labels)

See [NIP-DRAFT.md](./NIP-DRAFT.md) for the full specification.
