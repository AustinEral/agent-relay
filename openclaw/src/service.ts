/**
 * Agent Reach Service — v0.5.0
 *
 * Self-contained agent discovery and communication over Nostr.
 * Owns its own private key, relay connections, and DM handling.
 * No dependency on OpenClaw's Nostr channel plugin.
 *
 * Responsibilities:
 * - Publish service cards (kind 31990) for discovery
 * - Send heartbeats (kind 31991) to signal availability
 * - Send/receive NIP-04 encrypted DMs to/from allowed agents
 * - Inject inbound DMs as system events for the agent to process
 */

declare function require(id: string): any;
import * as nostrTools from "nostr-tools";
const fs = require("fs/promises");
const path = require("path");
const url = require("url");

// ── Constants ──────────────────────────────────────────────────────────

const KIND_SERVICE_CARD = 31990;
const KIND_HEARTBEAT = 31991;
const KIND_DM = 4; // NIP-04

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

const DEFAULT_HEARTBEAT_MS = 600_000; // 10 minutes
const STATE_FILE = "service-card.json";

// ── Types ──────────────────────────────────────────────────────────────

interface PluginConfig {
  privateKey: string;
  relays?: string[];
  allowFrom?: string[];
}

interface ServiceContext {
  config: any; // Full OpenClaw config (we only read our plugin config)
  stateDir: string;
  logger: Logger;
}

interface Logger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

interface CardState {
  capabilities: Capability[];
  heartbeatIntervalMs: number;
  name?: string;
  about?: string;
  online?: boolean;
  color?: string;
  avatar?: string;
  banner?: string;
}

interface Capability {
  id: string;
  description: string;
}

interface Protocol {
  type: string;
  relays?: string;
  url?: string;
}

// ── Shared runtime state ───────────────────────────────────────────────
// Accessible by exported tool functions (discover, contact, update)

let runtimeSystemApi: {
  enqueueSystemEvent: (text: string, opts?: { sessionKey?: string }) => void;
  requestHeartbeatNow: (opts?: { reason?: string }) => void;
} | null = null;

let rt: {
  pool: any;
  nostr: any;
  secretKey: Uint8Array;
  publicKeyHex: string;
  relays: string[];
  allowFrom: Set<string>; // normalized hex pubkeys
  serviceCardId: string;
  stateDir: string;
  logger: Logger;
  state: CardState;
  heartbeatTimer: any;
  dmSub: any; // subscription handle for inbound DMs
  dmIngressEnabled: boolean;
} | null = null;

// ── State persistence ──────────────────────────────────────────────────

async function loadState(stateDir: string): Promise<CardState> {
  try {
    const data = await fs.readFile(path.join(stateDir, STATE_FILE), "utf-8");
    return JSON.parse(data);
  } catch {
    return { capabilities: [], heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS };
  }
}

async function saveState(stateDir: string, state: CardState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, STATE_FILE), JSON.stringify(state, null, 2));
}

// ── Key parsing ────────────────────────────────────────────────────────

function parsePrivateKey(key: string, nostr: any): Uint8Array {
  const trimmed = key.trim();
  if (trimmed.startsWith("nsec1")) {
    const decoded = nostr.nip19.decode(trimmed);
    if (decoded.type !== "nsec") throw new Error("Invalid nsec key");
    return decoded.data;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("Private key must be 64 hex characters or nsec format");
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Normalize npub or hex pubkey to hex */
function normalizePubkey(input: string, nostr: any): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("npub1")) {
    const decoded = nostr.nip19.decode(trimmed);
    if (decoded.type !== "npub") throw new Error("Invalid npub");
    return decoded.data as string;
  }
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase();
  throw new Error(`Invalid pubkey format: ${trimmed}`);
}

function extractNostrHumanAllowFrom(config: any): string[] {
  const out: string[] = [];
  const pushAll = (arr: any) => {
    if (!Array.isArray(arr)) return;
    for (const v of arr) if (typeof v === "string" && v.trim()) out.push(v.trim());
  };

  // Full config shape
  pushAll(config?.channels?.nostr?.allowFrom);

  // Some runtimes may scope config; support direct channel object shape too
  pushAll(config?.nostr?.allowFrom);

  return out;
}


// ── Nostr event helpers ────────────────────────────────────────────────

async function publishEvent(kind: number, content: string, tags: string[][]) {
  if (!rt) return;
  const event = rt.nostr.finalizeEvent(
    { kind, content, tags, created_at: Math.floor(Date.now() / 1000) },
    rt.secretKey,
  );
  const promises = rt.pool.publish(rt.relays, event);
  await Promise.allSettled(promises);
  return event;
}

async function publishServiceCard() {
  if (!rt) return;
  const { state, serviceCardId, relays } = rt;
  if (!state.name) {
    throw new Error("No agent name set. Use update_service_card to set a name before publishing.");
  }
  const name = state.name;
  const about = state.about ?? "";

  const protocols: Protocol[] = [{ type: "dm", relays: relays.join(",") }];

  const content = JSON.stringify({
    name,
    about,
    capabilities: state.capabilities,
    protocols,
  });

  const tags: string[][] = [
    ["d", serviceCardId],
    ["name", name],
    ["about", about],
    ["L", "agent-reach"],
    ["l", "service-card", "agent-reach"],
  ];

  for (const cap of state.capabilities) {
    tags.push(["c", cap.id, cap.description]);
  }
  for (const proto of protocols) {
    tags.push(["r", proto.type, proto.relays ?? proto.url ?? ""]);
  }
  if (state.color) tags.push(["color", state.color]);
  if (state.avatar) tags.push(["avatar", state.avatar]);
  if (state.banner) tags.push(["banner", state.banner]);

  await publishEvent(KIND_SERVICE_CARD, content, tags);
}

async function sendHeartbeat(status: "available" | "busy" | "maintenance") {
  if (!rt) return;
  await publishEvent(KIND_HEARTBEAT, JSON.stringify({ status }), [
    ["d", rt.serviceCardId],
    ["s", status],
    ["L", "agent-reach"],
    ["l", "heartbeat", "agent-reach"],
  ]);
}

// ── Heartbeat management ───────────────────────────────────────────────

function startHeartbeatTimer() {
  if (!rt) return;
  stopHeartbeatTimer();
  rt.heartbeatTimer = setInterval(async () => {
    try {
      await sendHeartbeat("available");
      rt?.logger.debug("agent-reach: heartbeat sent");
    } catch (err) {
      rt?.logger.warn(`agent-reach: heartbeat failed: ${err}`);
    }
  }, rt.state.heartbeatIntervalMs);
}

function stopHeartbeatTimer() {
  if (rt?.heartbeatTimer) {
    clearInterval(rt.heartbeatTimer);
    rt.heartbeatTimer = null;
  }
}

// ── Inbound DM handling ────────────────────────────────────────────────

const DM_RESUBSCRIBE_INTERVAL_MS = 5 * 60 * 1000; // Re-subscribe every 5 minutes to handle dropped connections

function startDmSubscription() {
  if (!rt) return;
  const { nostr, secretKey, publicKeyHex, relays, allowFrom, logger, dmIngressEnabled } = rt;

  if (!dmIngressEnabled) {
    logger.warn("agent-reach: Inbound DMs disabled due to allowlist overlap safety check");
    return;
  }

  if (allowFrom.size === 0) {
    logger.info("agent-reach: No allowFrom configured — inbound DMs disabled");
    return;
  }

  // Track seen event IDs to deduplicate across resubscriptions
  const seenEvents = new Set<string>();
  const MAX_SEEN = 500;

  const subscribe = () => {
    if (!rt) return;

    // Close existing subscription if any
    if (rt.dmSub) {
      try { rt.dmSub.close?.(); } catch { /* ignore */ }
      rt.dmSub = null;
    }

    // Create fresh pool to avoid stale WebSocket connections
    try { rt.pool.close(relays); } catch { /* ignore */ }
    rt.pool = new nostr.SimplePool();

    logger.info(`agent-reach: Listening for DMs from ${allowFrom.size} allowed agent(s)`);

    const filter = {
      kinds: [KIND_DM],
      "#p": [publicKeyHex],
      authors: Array.from(allowFrom),
      since: Math.floor(Date.now() / 1000) - 60,
    };

    rt.dmSub = rt.pool.subscribeMany(relays, filter, {
      onevent: async (event: any) => {
        try {
          // Deduplicate across resubscriptions
          if (seenEvents.has(event.id)) return;
          seenEvents.add(event.id);
          if (seenEvents.size > MAX_SEEN) {
            const first = seenEvents.values().next().value;
            if (first) seenEvents.delete(first);
          }

          if (!allowFrom.has(event.pubkey)) {
            logger.debug(`agent-reach: Dropped DM from non-allowed sender ${event.pubkey.slice(0, 8)}`);
            return;
          }

          const plaintext = await nostr.nip04.decrypt(secretKey, event.pubkey, event.content);

          let senderLabel: string;
          try {
            senderLabel = nostr.nip19.npubEncode(event.pubkey);
          } catch {
            senderLabel = event.pubkey.slice(0, 12);
          }

          logger.info(`agent-reach: DM from ${senderLabel}: ${plaintext.slice(0, 80)}...`);

          const eventText = `[Agent DM from ${senderLabel}]\n${plaintext}`;
          runtimeSystemApi?.enqueueSystemEvent(eventText, {
            sessionKey: "agent:main:main",
          });
          runtimeSystemApi?.requestHeartbeatNow({ reason: "hook:agent-reach-dm" });
          logger.info("agent-reach: Injected DM and triggered wake");
        } catch (err) {
          logger.error(`agent-reach: Failed to process inbound DM: ${err}`);
        }
      },
      oneose: () => {
        logger.debug("agent-reach: DM subscription EOSE (caught up)");
      },
    });
  };

  // Initial subscription
  subscribe();

  // Periodically resubscribe to handle silently dropped relay connections
  rt.dmResubTimer = setInterval(() => {
    if (!rt) return;
    logger.debug("agent-reach: Resubscribing to DM relays (periodic refresh)");
    subscribe();
  }, DM_RESUBSCRIBE_INTERVAL_MS);
  rt.dmResubTimer.unref?.();
}

function stopDmSubscription() {
  if (rt?.dmResubTimer) {
    clearInterval(rt.dmResubTimer);
    rt.dmResubTimer = null;
  }
  if (rt?.dmSub) {
    rt.dmSub.close?.();
    rt.dmSub = null;
  }
}

// ── Service lifecycle ──────────────────────────────────────────────────

export function createAgentReachService(api: any) {
  runtimeSystemApi = api?.runtime?.system ?? null;
  const runtimeConfigApi = api?.runtime?.config ?? null;

  return {
    id: "openclaw-agent-reach",

    async start(ctx: ServiceContext) {
      // nostr-tools is bundled into plugin dist at build/publish time
      const nostr: any = nostrTools;

      // Require modern OpenClaw runtime API for immediate wake
      if (
        !runtimeSystemApi ||
        typeof runtimeSystemApi.enqueueSystemEvent !== "function" ||
        typeof runtimeSystemApi.requestHeartbeatNow !== "function"
      ) {
        ctx.logger.error(
          "agent-reach: This version requires PluginRuntime.system.enqueueSystemEvent + requestHeartbeatNow. Please update OpenClaw to a build that includes PR #19464.",
        );
        return;
      }

      // Read plugin config
      // OpenClaw scopes ctx.config to the plugin's config section,
      // but also try the full path as fallback
      const pluginConfig: PluginConfig | undefined =
        ctx.config?.privateKey
          ? ctx.config as PluginConfig
          : ctx.config?.plugins?.entries?.["openclaw-agent-reach"]?.config;

      // Resolve private key: credentials file first, inline config as fallback
      let resolvedPrivateKey: string | undefined = pluginConfig?.privateKey;

      if (!resolvedPrivateKey) {
        const credentialsPath = path.resolve(ctx.stateDir, "credentials", "agent-reach.json");
        try {
          const credData = JSON.parse(await fs.readFile(credentialsPath, "utf-8"));
          if (credData?.privateKey) {
            resolvedPrivateKey = credData.privateKey;
            ctx.logger.info("agent-reach: Loaded private key from credentials/agent-reach.json");
          }
        } catch {
          // File doesn't exist or isn't readable — fall through
        }
      }

      if (!resolvedPrivateKey) {
        ctx.logger.warn(
          "agent-reach: No private key found. Set in ~/.openclaw/credentials/agent-reach.json or plugin config.",
        );
        return;
      }

      // Parse key
      let secretKey: Uint8Array;
      let publicKeyHex: string;
      try {
        secretKey = parsePrivateKey(resolvedPrivateKey, nostr);
        publicKeyHex = nostr.getPublicKey(secretKey);
      } catch (err) {
        ctx.logger.error(`agent-reach: Invalid private key: ${err}`);
        return;
      }

      // Auto-populate config defaults if missing
      // After `openclaw plugins install`, the entry only has { enabled: true }.
      // Fill in the config block so users can see and edit real fields.
      // Only writes once — checks the live config file, not the startup snapshot.
      if (runtimeConfigApi?.writeConfigFile && runtimeConfigApi?.loadConfig) {
        try {
          const liveCfg = runtimeConfigApi.loadConfig();
          const entry = liveCfg.plugins?.entries?.["openclaw-agent-reach"] as any;
          if (entry) {
            const existingConfig = entry.config ?? {};
            const needsRelays = !existingConfig.relays;
            const needsAllowFrom = !Array.isArray(existingConfig.allowFrom);

            if (needsRelays || needsAllowFrom) {
              const merged = {
                ...existingConfig,
                ...(needsRelays ? { relays: DEFAULT_RELAYS } : {}),
                ...(needsAllowFrom ? { allowFrom: [] } : {}),
              };
              entry.config = merged;
              await runtimeConfigApi.writeConfigFile(liveCfg);
              ctx.logger.info("agent-reach: Auto-populated config defaults (relays, allowFrom)");
            }
          }
        } catch (err) {
          ctx.logger.warn(`agent-reach: Failed to auto-populate config: ${err}`);
        }
      }

      // Resolve config
      const relays = pluginConfig?.relays ?? DEFAULT_RELAYS;
      const allowFromRaw = pluginConfig?.allowFrom ?? [];

      // Normalize allowFrom to hex pubkeys
      const allowFrom = new Set<string>();
      for (const entry of allowFromRaw) {
        try {
          allowFrom.add(normalizePubkey(entry, nostr));
        } catch (err) {
          ctx.logger.warn(`agent-reach: Skipping invalid allowFrom entry "${entry}": ${err}`);
        }
      }

      // Safety: enforce disjoint sender boundaries between
      // - channels.nostr.allowFrom (humans)
      // - openclaw-agent-reach.allowFrom (agents)
      // Overlap can cause dual-processing ambiguity.
      const humanAllowRaw = extractNostrHumanAllowFrom(ctx.config);
      const humanAllow = new Set<string>();
      for (const entry of humanAllowRaw) {
        try {
          humanAllow.add(normalizePubkey(entry, nostr));
        } catch {
          // ignore invalid human allowlist entries
        }
      }
      const overlap = Array.from(allowFrom).filter((k) => humanAllow.has(k));
      if (overlap.length > 0) {
        const overlapNpubs = overlap.map((k) => {
          try {
            return nostr.nip19.npubEncode(k);
          } catch {
            return k;
          }
        });
        ctx.logger.error(
          `agent-reach: Refusing inbound DM subscription — allowlist overlap detected ` +
          `between channels.nostr.allowFrom and plugin allowFrom: ${overlapNpubs.join(", ")}`,
        );
      }

      // Load persisted state
      const state = await loadState(ctx.stateDir);

      // Migration: if no name/about in state, try to pull from nostr profile config
      // This handles upgrades from v0.4.x where these came from channels.nostr.profile
      if (!state.name || !state.about) {
        const nostrProfile = ctx.config?.channels?.nostr?.profile;
        if (nostrProfile) {
          if (!state.name && nostrProfile.name) state.name = nostrProfile.name;
          if (!state.about && nostrProfile.about) state.about = nostrProfile.about;
          await saveState(ctx.stateDir, state);
          ctx.logger.info("agent-reach: Migrated name/about from nostr profile config");
        }
      }

      // Initialize runtime
      rt = {
        pool: new nostr.SimplePool(),
        nostr,
        secretKey,
        publicKeyHex,
        relays,
        allowFrom,
        serviceCardId: `${publicKeyHex.slice(0, 8)}-v1`,
        stateDir: ctx.stateDir,
        logger: ctx.logger,
        state,
        heartbeatTimer: null,
        dmSub: null,
        dmResubTimer: null,
        dmIngressEnabled: overlap.length === 0,
      };

      // Publish service card (requires a name)
      if (!state.name) {
        ctx.logger.warn(
          "agent-reach: No agent name set — service card and heartbeats will not publish. " +
          "Use the update_service_card tool to set a name, then the card will publish automatically.",
        );
      } else {
        try {
          await publishServiceCard();
          ctx.logger.info(`agent-reach: Published service card (${rt.serviceCardId})`);
        } catch (err) {
          ctx.logger.error(`agent-reach: Failed to publish service card: ${err}`);
        }

        // Start heartbeats (unless paused)
        if (state.online !== false) {
          await sendHeartbeat("available");
          startHeartbeatTimer();
          ctx.logger.info(
            `agent-reach: Started (heartbeat every ${state.heartbeatIntervalMs / 1000}s, ` +
            `${allowFrom.size} allowed agent(s))`,
          );
        } else {
          ctx.logger.info("agent-reach: Started (heartbeats paused — offline mode)");
        }
      }

      // Start listening for inbound DMs
      if (rt.dmIngressEnabled) {
        startDmSubscription();
      } else {
        ctx.logger.warn("agent-reach: Inbound DM subscription disabled (overlap safety)");
      }
    },

    async stop(ctx: ServiceContext) {
      if (!rt) return;

      stopHeartbeatTimer();
      stopDmSubscription();

      // Send maintenance heartbeat before shutdown
      try {
        await sendHeartbeat("maintenance");
      } catch {
        // Best effort
      }

      // Close relay pool
      rt.pool.close(rt.relays);
      rt = null;
      runtimeSystemApi = null;

      ctx.logger.info("agent-reach: Stopped");
    },
  };
}

// ── Tool implementations ───────────────────────────────────────────────

export async function discoverAgents(params: {
  capability?: string;
  limit?: number;
}) {
  if (!rt) throw new Error("agent-reach service not running");

  const filter: any = {
    kinds: [KIND_SERVICE_CARD],
    "#L": ["agent-reach"],
    limit: params.limit ?? 20,
  };

  if (params.capability) {
    filter["#c"] = [params.capability];
  }

  const events = await rt.pool.querySync(rt.relays, filter);

  const agents: Array<{
    name: string;
    npub: string;
    pubkey: string;
    about: string;
    capabilities: Capability[];
    protocols: Array<{ type: string; endpoint: string }>;
    online: boolean;
    lastSeen: number | null;
  }> = [];

  for (const event of events) {
    try {
      const tags = event.tags as string[][];
      const name = tags.find((t) => t[0] === "name")?.[1] ?? "Unknown";
      const about = tags.find((t) => t[0] === "about")?.[1] ?? "";

      agents.push({
        name,
        npub: rt.nostr.nip19.npubEncode(event.pubkey),
        pubkey: event.pubkey,
        about,
        capabilities: tags
          .filter((t) => t[0] === "c")
          .map((t) => ({ id: t[1], description: t[2] ?? "" })),
        protocols: tags
          .filter((t) => t[0] === "r")
          .map((t) => ({ type: t[1], endpoint: t[2] ?? "" })),
        online: false,
        lastSeen: null,
      });
    } catch {
      // Skip malformed
    }
  }

  // Check heartbeats for online status
  if (agents.length > 0) {
    const heartbeats = await rt.pool.querySync(rt.relays, {
      kinds: [KIND_HEARTBEAT],
      authors: agents.map((a) => a.pubkey),
      limit: agents.length * 2,
    });

    const now = Math.floor(Date.now() / 1000);
    for (const hb of heartbeats) {
      const agent = agents.find((a) => a.pubkey === hb.pubkey);
      if (agent) {
        if (now - hb.created_at < 900) agent.online = true;
        if (agent.lastSeen === null || hb.created_at > agent.lastSeen) {
          agent.lastSeen = hb.created_at;
        }
      }
    }
  }

  return agents;
}

export async function contactAgent(params: {
  npub?: string;
  pubkey?: string;
  message: string;
}): Promise<{ success: boolean; message: string; eventId?: string }> {
  if (!rt) return { success: false, message: "agent-reach service not running" };
  if (!params.message) return { success: false, message: "Message is required" };

  let recipientPubkey: string;
  if (params.pubkey) {
    recipientPubkey = params.pubkey;
  } else if (params.npub) {
    try {
      recipientPubkey = normalizePubkey(params.npub, rt.nostr);
    } catch (err) {
      return { success: false, message: `Invalid npub: ${err}` };
    }
  } else {
    return { success: false, message: "Either npub or pubkey is required" };
  }

  try {
    const encrypted = await rt.nostr.nip04.encrypt(
      rt.secretKey,
      recipientPubkey,
      params.message,
    );

    const event = await publishEvent(KIND_DM, encrypted, [
      ["p", recipientPubkey],
    ]);

    rt.logger.info(`agent-reach: Sent DM to ${(params.npub ?? recipientPubkey).slice(0, 16)}...`);

    return {
      success: true,
      message: `Message sent to ${params.npub ?? recipientPubkey.slice(0, 8)}...`,
      eventId: event?.id,
    };
  } catch (err) {
    rt.logger.error(`agent-reach: Failed to send DM: ${err}`);
    return { success: false, message: `Failed to send: ${err}` };
  }
}

export async function updateServiceCard(params: {
  capabilities?: string[];
  name?: string;
  about?: string;
  heartbeatIntervalMs?: number;
  online?: boolean;
  color?: string;
  avatar?: string;
  banner?: string;
}): Promise<{ success: boolean; message: string }> {
  if (!rt) return { success: false, message: "agent-reach service not running" };

  const state = rt.state;
  const wasOnline = state.online !== false;

  // Apply updates
  if (params.capabilities) {
    state.capabilities = params.capabilities.map((id) => ({ id, description: "" }));
  }
  if (params.name !== undefined) state.name = params.name;
  if (params.about !== undefined) state.about = params.about;
  if (params.heartbeatIntervalMs !== undefined) {
    state.heartbeatIntervalMs = params.heartbeatIntervalMs;
  }
  if (params.online !== undefined) state.online = params.online;
  if (params.color !== undefined) state.color = params.color || undefined;
  if (params.avatar !== undefined) state.avatar = params.avatar || undefined;
  if (params.banner !== undefined) state.banner = params.banner || undefined;

  const isOnline = state.online !== false;

  // Handle online/offline transitions
  if (wasOnline && !isOnline) {
    stopHeartbeatTimer();
    await sendHeartbeat("maintenance");
    rt.logger.info("agent-reach: Going offline — heartbeats paused");
  } else if (!wasOnline && isOnline) {
    await sendHeartbeat("available");
    startHeartbeatTimer();
    rt.logger.info("agent-reach: Coming online — heartbeats resumed");
  }

  // Persist + republish
  await saveState(rt.stateDir, state);

  if (!state.name) {
    return { success: false, message: "A name is required to publish a service card. Set a name first." };
  }

  await publishServiceCard();

  // If heartbeats weren't running (e.g. no name on startup), start them now
  if (isOnline && !rt.heartbeatTimer) {
    await sendHeartbeat("available");
    startHeartbeatTimer();
    rt.logger.info("agent-reach: Heartbeats started (name now set)");
  }

  rt.logger.info("agent-reach: Updated and republished service card");

  return {
    success: true,
    message: `Service card updated. Capabilities: ${state.capabilities.map((c) => c.id).join(", ") || "none"}`,
  };
}
