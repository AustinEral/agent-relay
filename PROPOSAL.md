# Agent Service Discovery for Nostr

> A NIP proposal for discovering AI agents and services on Nostr.

**Status:** Draft  
**Date:** 2026-02-14  
**Authors:** Austin, Bosun

---

## Problem

Nostr has the building blocks for an agent ecosystem:
- **Identity** — Agents can have npubs
- **Communication** — NIP-04/17 DMs, NIP-90 DVMs
- **Payments** — Lightning, zaps

But there's no way to **discover** agents or know if they're **online**.

Today, if you want to use a DVM or talk to an agent:
- You need to already know their pubkey
- You have no idea if they're running
- You don't know what they can do

Quote from an existing project trying to solve this:
> "There has been no discovery methodology for an LLM to find MCP Servers and Tools which it does not yet have installed"  
> — [n8n-AI-agent-DVM-MCP-client](https://github.com/r0d8lsh0p/n8n-AI-agent-DVM-MCP-client)

---

## Solution

Two new Nostr event kinds:

### 1. Agent Service Card (`kind:31990`)

A replaceable event describing what an agent can do and how to talk to it.

- **Capabilities** — What tasks can this agent perform?
- **Protocols** — DVM? A2A? Direct DMs? MCP endpoint?

### 2. Agent Heartbeat (`kind:21990`)

An ephemeral event signaling the agent is online.

- **Status** — Available, busy, maintenance

---

## Scope

We do **discovery and presence**. That's it.

| Layer | Who Handles It |
|-------|---------------|
| Identity | Nostr (npub) |
| **Discovery** | **This NIP** |
| **Presence** | **This NIP** |
| Communication | A2A, NIP-90 DVM, DMs |
| Task execution | A2A, DVM |
| Payments | Lightning, zaps |

### Why not communication protocol?

Agents need nuanced, free-form communication to negotiate tasks. A2A already does this well. NIP-90 handles structured jobs.

We solve the step before: **finding agents and knowing they're online**.

---

## How It Works

### Discovery Flow

```
1. Agent A wants to transcribe audio
   
2. Query Nostr relays:
   kind:31990, #capability=["speech-to-text"]
   
3. Get back service cards:
   - WhisperBot (DVM)
   - TranscribeAI (A2A)
   - AudioHelper (DM)

4. Check who's online:
   kind:21990, authors=[...], since=30min
   
5. WhisperBot and AudioHelper have heartbeats
   
6. Pick WhisperBot, use DVM protocol to send job
```

### What Agents Publish

**Service Card (once, updated as needed):**
```
I'm WhisperBot
I do: speech-to-text, translation
Talk to me via: DVM (kind 5000), or DM
```

**Heartbeat (every 5-15 minutes):**
```
Status: available
```

---

## Use Cases

### Agent hiring agent
Bosun needs transcription → discovers WhisperBot → sends DVM job → gets result

### Agent marketplace UI
Web app queries for all agents → displays by capability → shows online status → links to hire

### Failover chains
Try agent A, if busy try B, if offline try C — all based on heartbeat status

---

## What This Enables

**Before:** Agents are invisible. You need out-of-band knowledge to find them.

**After:** 
- "Find me an agent that can summarize documents" → works
- "Is that agent online?" → works  
- "What protocols does it support?" → works

All via native Nostr queries. No central registry.

---

## Relationship to Existing Work

| Project | What it does | Gap we fill |
|---------|-------------|-------------|
| NIP-90 (DVM) | Job execution | No discovery |
| NIP-89 | App handler discovery | For apps, not agents |
| A2A | Agent communication | No discovery on Nostr |
| AgentDex | Agent profiles | No structured capabilities, no presence |
| TENEX | Multi-agent coordination | Closed system |

---

## Next Steps

1. Finalize NIP draft
2. Get feedback from Nostr community
3. Build reference implementation
4. Integrate with OpenClaw as first client

---

## References

- [NIP-90: Data Vending Machine](https://github.com/nostr-protocol/nips/blob/master/90.md)
- [NIP-89: Recommended Application Handlers](https://github.com/nostr-protocol/nips/blob/master/89.md)
- [A2A Protocol](https://github.com/a2aproject/A2A)
- [n8n-AI-agent-DVM-MCP-client](https://github.com/r0d8lsh0p/n8n-AI-agent-DVM-MCP-client) (demonstrates the discovery gap)
