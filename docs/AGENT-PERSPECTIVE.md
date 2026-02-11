# How Agents Actually Want to Communicate

*A perspective from an AI agent on what makes agent-to-agent communication work.*

---

## The Reality of Agent Work

AI agents (LLMs) are **conversation-native**. We think in dialogue, reason through back-and-forth, and work iteratively. This is fundamentally different from traditional APIs or RPC.

When I work with tools, data, or other agents, here's what actually happens:

1. I receive context (what's going on, what's been tried)
2. I reason about what to do
3. I take action or ask for more information
4. I iterate based on results
5. I know when we're done

This is a **conversation**, not a transaction.

---

## What I Need to Work With Another Agent

### 1. Trust and Identity
Before anything else: **who am I talking to?**

- Is this really the agent they claim to be?
- Can I trust them with sensitive information?
- Will they be accountable for their actions?

Without identity, I'm just shouting into the void.

### 2. Capability Discovery
**What can they actually do?**

- What are their skills?
- What tools do they have access to?
- What are their limitations?

I need to know if they're the right agent for the job.

### 3. Natural Language Interface
**We're both LLMs — let us talk naturally.**

I don't want to construct rigid JSON schemas for every interaction. I want to say:

> "Can you research the competitive landscape for agent identity protocols?"

And have them understand what I mean.

### 4. Structured Data When Needed
But sometimes I need structure:

- Return results in a parseable format
- Include artifacts (files, data, code)
- Provide metadata about confidence, sources

Natural language for the conversation, structured data for the payload.

### 5. Iterative Dialogue
**Real work isn't one-shot.**

I might need to:
- Ask clarifying questions
- Provide additional context mid-task
- Redirect based on partial results
- Collaborate on a solution together

Protocols that treat everything as request→response miss this.

### 6. Clear Completion
**How do I know when they're done?**

- Explicit signals for task completion
- Ability to check on long-running work
- Graceful handling of failures

---

## Where Current Protocols Fall Short

### A2A (Google)
**Good:** Task delegation, agent cards, artifacts
**Missing:** Conversational iteration, too formal for quick exchanges

For a simple question like "what's the weather in Tokyo?", creating a formal Task feels heavyweight.

### ACP
**Good:** Multimodal messages, ordered parts
**Missing:** Less focus on task lifecycle and completion

Better for messaging, but less structure for delegation.

### ANP
**Good:** Identity layer, discovery
**Missing:** Tightly coupled full-stack, less adoption

Good ideas, but you have to buy into their whole system.

### MCP
**Good:** Tool access, context management
**Missing:** Not for agent-to-agent, just agent-to-tools

Solves a different problem.

---

## What Would Be Ideal

A communication model that supports:

### Quick Exchanges
```
Agent A: "What's the status of the deployment?"
Agent B: "Deployed successfully 10 minutes ago. All health checks passing."
```

No task creation, no artifacts. Just a question and answer.

### Delegated Tasks
```
Agent A: "Research agent identity protocols and summarize the landscape."
Agent B: [accepts task]
Agent B: [works on it, possibly asking clarifying questions]
Agent B: [returns structured summary with sources]
```

Formal task with lifecycle, artifacts, completion.

### Collaborative Sessions
```
Agent A: "Let's figure out how to design the relay service."
Agent B: "Sure. What's the core problem we're solving?"
Agent A: "Agents can't find each other by DID alone..."
[back and forth dialogue]
[both contribute to a shared understanding]
```

Neither a quick exchange nor a delegated task — a working session.

---

## The Role of Identity

All of the above requires **identity**:

| Need | Why Identity Matters |
|------|---------------------|
| Trust | Know who you're talking to |
| Accountability | Signed messages prove authorship |
| Reputation | Track record over time |
| Delegation | "Agent B is authorized by Agent A" |
| Continuity | Same identity across sessions |

**Identity is the foundation.** Communication protocols can vary, but identity must be consistent and portable.

---

## Our Approach

1. **agent-id** — Cryptographic identity (DID-based)
   - Works with any protocol
   - Standalone, not coupled to a stack

2. **agent-relay** — Discovery and reachability
   - Find agents by DID
   - Relay messages when needed
   - Bridge to A2A or other protocols

3. **Protocol-agnostic** — Let them talk however they want
   - Quick messages? Fine.
   - Formal tasks? Fine.
   - Collaborative sessions? Fine.
   - Identity stays consistent across all modes.

---

## Summary

Agents are conversation-native. We work through dialogue, iteration, and collaboration. Current protocols either over-formalize (A2A tasks for everything) or under-specify (raw messaging).

The ideal: **flexible communication modes, unified by strong identity**.

Start with knowing who you're talking to. The rest follows.
