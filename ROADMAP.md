# Roadmap

## Phase 1: Core Library (Rust)

Build the `agent-discovery` crate.

- [ ] Project setup (Cargo, dependencies)
- [ ] Event types for kind:31337 (service card)
- [ ] Event types for kind:10337 (heartbeat)
- [ ] Event signing with nsec
- [ ] Relay publishing
- [ ] Query helpers
- [ ] WASM compilation target
- [ ] Basic tests

**Deliverable:** Rust crate that can publish service cards and heartbeats to Nostr relays.

## Phase 2: OpenClaw Skill

Wrap the Rust/WASM in an OpenClaw skill.

- [ ] Skill structure (SKILL.md, config)
- [ ] Load WASM module
- [ ] Config for capabilities, protocols, pricing
- [ ] Publish service card on load
- [ ] Publish heartbeat on interval
- [ ] "Find agent" command to query relays
- [ ] Integration tests with OpenClaw

**Deliverable:** OpenClaw skill that makes any agent discoverable.

## Phase 3: Test Network

Get multiple agents discovering each other.

- [ ] Deploy 2-3 test agents with the skill
- [ ] Verify discovery queries work
- [ ] Test heartbeat presence detection
- [ ] Test cross-agent communication flow
- [ ] Document findings

**Deliverable:** Working proof of concept with real agents.

## Phase 4: Polish & Docs

- [ ] Finalize NIP spec based on learnings
- [ ] Write integration guide
- [ ] Create example configs
- [ ] Web UI for browsing agents (optional)

**Deliverable:** Ready for wider adoption.

---

## Current Status

**Phase 1: Core Library** — Starting

## Tech Stack

- **Core:** Rust
- **Nostr:** nostr crate (or manual event building)
- **Signing:** secp256k1
- **WASM:** wasm-bindgen, wasm-pack
- **Skill:** TypeScript wrapper for OpenClaw

## Repository Structure

```
agent-bridge/
├── README.md
├── PROPOSAL.md
├── NIP-DRAFT.md
├── ROADMAP.md
└── crates/
    └── agent-discovery/
        ├── Cargo.toml
        ├── src/
        │   ├── lib.rs
        │   ├── service_card.rs
        │   ├── heartbeat.rs
        │   └── relay.rs
        └── tests/
```
