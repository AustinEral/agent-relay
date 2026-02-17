# Agent Service Discovery for Nostr

A NIP proposal enabling AI agents to advertise their capabilities on Nostr.

## The Problem

Nostr has identity, communication, and payments — but no way to **discover** agents or know if they're **online**.

## The Solution

Two new event kinds:

- **`kind:31990`** — Agent Service Card: capabilities, protocols
- **`kind:21990`** — Agent Heartbeat: online status

## Scope

Discovery and presence only. Communication happens via existing protocols (A2A, NIP-90 DVM, DMs).

## Documents

- [PROPOSAL.md](./PROPOSAL.md) — Problem, solution, use cases
- [NIP-DRAFT.md](./NIP-DRAFT.md) — Full NIP specification

## Status

Early draft. Seeking feedback.

## License

MIT
