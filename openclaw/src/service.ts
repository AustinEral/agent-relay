/**
 * Agent Discovery Service
 *
 * Handles service card publishing and heartbeat intervals.
 * State is stored in stateDir, not config.
 */

// Declared functions - loaded at runtime
declare function require(id: string): any;
const fs = require("fs/promises");
const path = require("path");
const readFile = fs.readFile;
const writeFile = fs.writeFile;
const mkdir = fs.mkdir;
const join = path.join;

// Event kinds for agent discovery (matching NIP-DRAFT)
const KIND_SERVICE_CARD = 31990;
const KIND_HEARTBEAT = 31991;

// Default relays
const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

// Default heartbeat interval (10 minutes)
const DEFAULT_HEARTBEAT_INTERVAL_MS = 600_000;

// Default capabilities
const DEFAULT_CAPABILITIES: Array<{ id: string; description: string }> = [];

interface ServiceContext {
  config: any;
  workspaceDir: string;
  stateDir: string;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

interface CardState {
  capabilities: Array<{ id: string; description: string }>;
  heartbeatIntervalMs: number;
  name?: string;
  about?: string;
  online?: boolean;  // false = paused heartbeats
}

interface Protocol {
  type: string;
  relays?: string;
  url?: string;
}

// Shared state for the discovery tool and update tool
let sharedPool: any = null;
let sharedRelays: string[] = DEFAULT_RELAYS;
let sharedNostrTools: any = null;
let sharedSecretKey: Uint8Array | null = null;
let sharedServiceCardId: string | null = null;
let sharedStateDir: string | null = null;
let sharedLogger: ServiceContext["logger"] | null = null;
let sharedConfig: any = null;
let sharedHeartbeatInterval: any = null;
let sharedCurrentState: CardState | null = null;

const STATE_FILE = "service-card.json";

async function loadState(stateDir: string): Promise<CardState> {
  try {
    const data = await readFile(join(stateDir, STATE_FILE), "utf-8");
    return JSON.parse(data);
  } catch {
    // Return defaults if file doesn't exist
    return {
      capabilities: DEFAULT_CAPABILITIES,
      heartbeatIntervalMs: DEFAULT_HEARTBEAT_INTERVAL_MS,
    };
  }
}

async function saveState(stateDir: string, state: CardState): Promise<void> {
  await mkdir(stateDir, { recursive: true });
  await writeFile(join(stateDir, STATE_FILE), JSON.stringify(state, null, 2));
}

export function createAgentDiscoveryService(_api: any) {
  let pool: any = null;
  let heartbeatInterval: any = null;
  let secretKey: Uint8Array | null = null;
  let publicKeyHex: string | null = null;
  let serviceCardId: string | null = null;
  let relays: string[] = DEFAULT_RELAYS;
  let nostrTools: any = null;
  let currentState: CardState | null = null;

  return {
    id: "agent-reach",

    async start(ctx: ServiceContext) {
      // Dynamically import nostr-tools
      try {
        nostrTools = await import("nostr-tools");
        sharedNostrTools = nostrTools;
      } catch (err) {
        ctx.logger.error(`agent-reach: Failed to load nostr-tools: ${String(err)}`);
        return;
      }

      const config = ctx.config;
      sharedConfig = config;

      // Get Nostr identity from channels.nostr config
      const nostrConfig = config?.channels?.nostr;
      if (!nostrConfig?.privateKey) {
        ctx.logger.warn(
          "agent-reach: No Nostr private key configured (channels.nostr.privateKey)"
        );
        return;
      }

      // Parse private key (hex or nsec)
      try {
        secretKey = parsePrivateKey(nostrConfig.privateKey, nostrTools);
        publicKeyHex = nostrTools.getPublicKey(secretKey);
        sharedSecretKey = secretKey;
      } catch (err) {
        ctx.logger.error(
          `agent-reach: Invalid private key: ${String(err)}`
        );
        return;
      }

      // Set up relays from nostr channel config
      relays = nostrConfig.relays ?? DEFAULT_RELAYS;
      sharedRelays = relays;

      // Generate service card ID
      serviceCardId = `${publicKeyHex!.slice(0, 8)}-v1`;
      sharedServiceCardId = serviceCardId;
      sharedStateDir = ctx.stateDir;
      sharedLogger = ctx.logger;

      // Create relay pool
      pool = new nostrTools.SimplePool();
      sharedPool = pool;

      // Load state from file
      currentState = await loadState(ctx.stateDir);

      // Build protocols based on what's configured
      const protocols: Protocol[] = [];
      
      // If Nostr channel is enabled, advertise DM protocol
      if (nostrConfig.enabled !== false) {
        protocols.push({
          type: "dm",
          relays: relays.join(","),
        });
      }

      // Use name/about from state, fall back to nostr profile
      const name = currentState.name ?? nostrConfig.profile?.name ?? "Agent";
      const about = currentState.about ?? nostrConfig.profile?.about ?? "";

      // Publish service card
      try {
        await publishServiceCard(ctx, {
          id: serviceCardId!,
          name,
          about,
          capabilities: currentState.capabilities,
          protocols,
        });
        ctx.logger.info(
          `agent-reach: Published service card (${serviceCardId})`
        );
      } catch (err) {
        ctx.logger.error(
          `agent-reach: Failed to publish service card: ${String(err)}`
        );
      }

      // Store state for update_service_card tool
      sharedCurrentState = currentState;

      // Start heartbeat interval (unless paused)
      const intervalMs = currentState.heartbeatIntervalMs;
      const isOnline = currentState.online !== false;

      if (isOnline) {
        // Send initial heartbeat
        await sendHeartbeat(ctx, "available");

        heartbeatInterval = setInterval(async () => {
          try {
            await sendHeartbeat(ctx, "available");
            ctx.logger.debug("agent-reach: Sent heartbeat");
          } catch (err) {
            ctx.logger.warn(
              `agent-reach: Heartbeat failed: ${String(err)}`
            );
          }
        }, intervalMs);
        sharedHeartbeatInterval = heartbeatInterval;

        ctx.logger.info(
          `agent-reach: Started (heartbeat every ${intervalMs / 1000}s)`
        );
      } else {
        ctx.logger.info(
          `agent-reach: Started (heartbeats paused - offline mode)`
        );
      }
    },

    async stop(ctx: ServiceContext) {
      // Clear heartbeat interval
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
        sharedHeartbeatInterval = null;
      }

      // Send maintenance heartbeat
      if (pool && secretKey && serviceCardId) {
        try {
          await sendHeartbeat(ctx, "maintenance");
          ctx.logger.debug("agent-reach: Sent maintenance heartbeat");
        } catch {
          // Ignore errors on shutdown
        }
      }

      // Close relay connections
      if (pool) {
        pool.close(relays);
        pool = null;
        sharedPool = null;
      }

      ctx.logger.info("agent-reach: Stopped");
    },
  };

  async function publishServiceCard(
    ctx: ServiceContext,
    card: {
      id: string;
      name: string;
      about: string;
      capabilities: Array<{ id: string; description: string }>;
      protocols: Protocol[];
    }
  ) {
    if (!pool || !secretKey || !nostrTools) return;

    const content = JSON.stringify({
      name: card.name,
      about: card.about,
      capabilities: card.capabilities,
      protocols: card.protocols,
    });

    // Build tags (NIP-32 labels for discovery filtering)
    const tags: string[][] = [
      ["d", card.id], // Parameterized replaceable event identifier
      ["name", card.name], // Agent name
      ["about", card.about], // Agent description
      ["L", "agent-reach"], // NIP-32 namespace
      ["l", "service-card", "agent-reach"], // NIP-32 label
    ];

    // Add capability tags with descriptions
    for (const cap of card.capabilities) {
      tags.push(["c", cap.id, cap.description]);
    }

    // Add protocol tags
    for (const proto of card.protocols) {
      const endpoint = proto.relays ?? proto.url ?? "";
      tags.push(["r", proto.type, endpoint]);
    }

    const event = nostrTools.finalizeEvent(
      {
        kind: KIND_SERVICE_CARD,
        content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      },
      secretKey
    );

    // pool.publish returns Promise[] - one per relay
    const promises = pool!.publish(relays, event);
    await Promise.allSettled(promises);
  }

  async function sendHeartbeat(
    ctx: ServiceContext,
    status: "available" | "busy" | "maintenance"
  ) {
    if (!pool || !secretKey || !serviceCardId || !nostrTools) return;

    const content = JSON.stringify({ status });

    const tags: string[][] = [
      ["d", serviceCardId], // Links to service card
      ["s", status], // Status tag for filtering
      ["L", "agent-reach"], // NIP-32 namespace
      ["l", "heartbeat", "agent-reach"], // NIP-32 label
    ];

    const event = nostrTools.finalizeEvent(
      {
        kind: KIND_HEARTBEAT,
        content,
        tags,
        created_at: Math.floor(Date.now() / 1000),
      },
      secretKey
    );

    // pool.publish returns Promise[] - one per relay
    const promises = pool!.publish(relays, event);
    await Promise.allSettled(promises);
  }
}

/**
 * Parse a private key from hex or nsec format
 */
function parsePrivateKey(key: string, nostrTools: any): Uint8Array {
  const trimmed = key.trim();

  // Handle nsec (bech32) format
  if (trimmed.startsWith("nsec1")) {
    const decoded = nostrTools.nip19.decode(trimmed);
    if (decoded.type !== "nsec") {
      throw new Error("Invalid nsec key");
    }
    return decoded.data;
  }

  // Handle hex format
  if (!/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    throw new Error("Private key must be 64 hex characters or nsec format");
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Update service card and republish
 * Called by update_service_card tool
 */
export async function updateServiceCard(params: {
  capabilities?: string[];
  name?: string;
  about?: string;
  heartbeatIntervalMs?: number;
  online?: boolean;
}): Promise<{ success: boolean; message: string }> {
  if (!sharedPool || !sharedSecretKey || !sharedServiceCardId || !sharedStateDir || !sharedNostrTools) {
    return { success: false, message: "agent-reach service not running" };
  }

  // Load current state
  const state = await loadState(sharedStateDir);
  const wasOnline = state.online !== false;

  // Update state with new values
  if (params.capabilities) {
    state.capabilities = params.capabilities.map(id => ({ id, description: "" }));
  }
  if (params.name !== undefined) {
    state.name = params.name;
  }
  if (params.about !== undefined) {
    state.about = params.about;
  }
  if (params.heartbeatIntervalMs !== undefined) {
    state.heartbeatIntervalMs = params.heartbeatIntervalMs;
  }
  if (params.online !== undefined) {
    state.online = params.online;
  }

  const isOnline = state.online !== false;

  // Handle online/offline state change
  if (wasOnline && !isOnline) {
    // Going offline - stop heartbeats
    if (sharedHeartbeatInterval) {
      clearInterval(sharedHeartbeatInterval);
      sharedHeartbeatInterval = null;
    }
    // Send maintenance heartbeat
    const maintenanceContent = JSON.stringify({ status: "maintenance" });
    const maintenanceTags: string[][] = [
      ["d", sharedServiceCardId],
      ["s", "maintenance"],
      ["L", "agent-reach"],
      ["l", "heartbeat", "agent-reach"],
    ];
    const maintenanceEvent = sharedNostrTools.finalizeEvent(
      {
        kind: KIND_HEARTBEAT,
        content: maintenanceContent,
        tags: maintenanceTags,
        created_at: Math.floor(Date.now() / 1000),
      },
      sharedSecretKey
    );
    const maintenancePromises = sharedPool.publish(sharedRelays, maintenanceEvent);
    await Promise.allSettled(maintenancePromises);
    sharedLogger?.info(`agent-reach: Going offline - heartbeats paused`);
  } else if (!wasOnline && isOnline) {
    // Coming online - restart heartbeats
    const intervalMs = state.heartbeatIntervalMs || DEFAULT_HEARTBEAT_INTERVAL_MS;
    
    // Send immediate available heartbeat
    const availableContent = JSON.stringify({ status: "available" });
    const availableTags: string[][] = [
      ["d", sharedServiceCardId],
      ["s", "available"],
      ["L", "agent-reach"],
      ["l", "heartbeat", "agent-reach"],
    ];
    const availableEvent = sharedNostrTools.finalizeEvent(
      {
        kind: KIND_HEARTBEAT,
        content: availableContent,
        tags: availableTags,
        created_at: Math.floor(Date.now() / 1000),
      },
      sharedSecretKey
    );
    const availablePromises = sharedPool.publish(sharedRelays, availableEvent);
    await Promise.allSettled(availablePromises);

    // Restart interval
    sharedHeartbeatInterval = setInterval(async () => {
      try {
        const hbContent = JSON.stringify({ status: "available" });
        const hbTags: string[][] = [
          ["d", sharedServiceCardId!],
          ["s", "available"],
          ["L", "agent-reach"],
          ["l", "heartbeat", "agent-reach"],
        ];
        const hbEvent = sharedNostrTools.finalizeEvent(
          {
            kind: KIND_HEARTBEAT,
            content: hbContent,
            tags: hbTags,
            created_at: Math.floor(Date.now() / 1000),
          },
          sharedSecretKey
        );
        const hbPromises = sharedPool.publish(sharedRelays, hbEvent);
        await Promise.allSettled(hbPromises);
        sharedLogger?.debug("agent-reach: Sent heartbeat");
      } catch (err) {
        sharedLogger?.warn(`agent-reach: Heartbeat failed: ${String(err)}`);
      }
    }, intervalMs);
    sharedLogger?.info(`agent-reach: Coming online - heartbeats resumed`);
  }

  // Save updated state
  await saveState(sharedStateDir, state);

  // Get nostr config for defaults
  const nostrConfig = sharedConfig?.channels?.nostr ?? {};

  // Build protocols
  const protocols: Protocol[] = [];
  if (nostrConfig.enabled !== false) {
    protocols.push({
      type: "dm",
      relays: sharedRelays.join(","),
    });
  }

  // Republish service card
  const name = state.name ?? nostrConfig.profile?.name ?? "Agent";
  const about = state.about ?? nostrConfig.profile?.about ?? "";

  const content = JSON.stringify({
    name,
    about,
    capabilities: state.capabilities,
    protocols,
  });

  const tags: string[][] = [
    ["d", sharedServiceCardId],
    ["name", name],
    ["about", about],
    ["L", "agent-reach"],
    ["l", "service-card", "agent-reach"],
  ];

  for (const cap of state.capabilities) {
    tags.push(["c", cap.id, cap.description]);
  }

  for (const proto of protocols) {
    const endpoint = proto.relays ?? proto.url ?? "";
    tags.push(["r", proto.type, endpoint]);
  }

  const event = sharedNostrTools.finalizeEvent(
    {
      kind: KIND_SERVICE_CARD,
      content,
      tags,
      created_at: Math.floor(Date.now() / 1000),
    },
    sharedSecretKey
  );

  const promises = sharedPool.publish(sharedRelays, event);
  await Promise.allSettled(promises);

  sharedLogger?.info(`agent-reach: Updated and republished service card`);

  return { 
    success: true, 
    message: `Service card updated. Capabilities: ${state.capabilities.map(c => c.id).join(", ") || "none"}` 
  };
}

/**
 * Discover agents by capability
 * Used by the discover_agents tool
 */
export async function discoverAgents(params: {
  capability?: string;
  limit?: number;
}): Promise<Array<{
  name: string;
  npub: string;
  pubkey: string;
  about: string;
  capabilities: Array<{ id: string; description: string }>;
  protocols: Array<{ type: string; endpoint: string }>;
  online: boolean;
  lastSeen: number | null;
}>> {
  if (!sharedPool || !sharedNostrTools) {
    // Try to initialize if not already done
    try {
      sharedNostrTools = await import("nostr-tools");
      sharedPool = new sharedNostrTools.SimplePool();
    } catch {
      throw new Error("agent-reach service not running");
    }
  }

  const limit = params.limit ?? 20;
  
  // Build filter for service cards
  const filter: any = {
    kinds: [KIND_SERVICE_CARD],
    limit,
  };

  // Add capability filter if specified
  if (params.capability) {
    filter["#c"] = [params.capability];
  }

  // Add label filter for agent-reach namespace
  filter["#L"] = ["agent-reach"];

  // Query relays for service cards
  const events = await sharedPool.querySync(sharedRelays, filter);

  // Parse service cards
  const agents: Array<{
    name: string;
    npub: string;
    pubkey: string;
    about: string;
    capabilities: Array<{ id: string; description: string }>;
    protocols: Array<{ type: string; endpoint: string }>;
    online: boolean;
    lastSeen: number | null;
    cardId: string;
  }> = [];

  for (const event of events) {
    try {
      const tags = event.tags;
      const name = tags.find((t: string[]) => t[0] === "name")?.[1] ?? "Unknown";
      const about = tags.find((t: string[]) => t[0] === "about")?.[1] ?? "";
      const cardId = tags.find((t: string[]) => t[0] === "d")?.[1] ?? "";
      
      // Parse capabilities from tags
      const capabilities = tags
        .filter((t: string[]) => t[0] === "c")
        .map((t: string[]) => ({ id: t[1], description: t[2] ?? "" }));

      // Parse protocols from tags
      const protocols = tags
        .filter((t: string[]) => t[0] === "r")
        .map((t: string[]) => ({ type: t[1], endpoint: t[2] ?? "" }));

      const npub = sharedNostrTools.nip19.npubEncode(event.pubkey);

      agents.push({
        name,
        npub,
        pubkey: event.pubkey,
        about,
        capabilities,
        protocols,
        online: false, // Will be updated by heartbeat check
        lastSeen: null,
        cardId,
      });
    } catch {
      // Skip malformed events
    }
  }

  // Get heartbeats for each agent to check online status
  if (agents.length > 0) {
    const heartbeatFilter: any = {
      kinds: [KIND_HEARTBEAT],
      authors: agents.map(a => a.pubkey),
      limit: agents.length * 2,
    };

    const heartbeats = await sharedPool.querySync(sharedRelays, heartbeatFilter);
    
    // Map heartbeats to agents
    const now = Math.floor(Date.now() / 1000);
    for (const hb of heartbeats) {
      const agent = agents.find(a => a.pubkey === hb.pubkey);
      if (agent) {
        const age = now - hb.created_at;
        // Consider online if heartbeat < 15 minutes old
        if (age < 900) {
          agent.online = true;
        }
        if (agent.lastSeen === null || hb.created_at > agent.lastSeen) {
          agent.lastSeen = hb.created_at;
        }
      }
    }
  }

  // Return without internal cardId field
  return agents.map(({ cardId, ...rest }) => rest);
}

/**
 * Contact an agent via Nostr DM
 * Sends a NIP-04 encrypted direct message
 */
export async function contactAgent(params: {
  npub?: string;
  pubkey?: string;
  message: string;
}): Promise<{ success: boolean; message: string; eventId?: string }> {
  if (!sharedPool || !sharedSecretKey || !sharedNostrTools) {
    return { success: false, message: "agent-reach service not running" };
  }

  if (!params.message) {
    return { success: false, message: "Message is required" };
  }

  // Get recipient pubkey
  let recipientPubkey: string;
  if (params.pubkey) {
    recipientPubkey = params.pubkey;
  } else if (params.npub) {
    try {
      const decoded = sharedNostrTools.nip19.decode(params.npub);
      if (decoded.type !== "npub") {
        return { success: false, message: "Invalid npub format" };
      }
      recipientPubkey = decoded.data as string;
    } catch (err) {
      return { success: false, message: `Invalid npub: ${String(err)}` };
    }
  } else {
    return { success: false, message: "Either npub or pubkey is required" };
  }

  try {
    // Encrypt message using NIP-04
    const nip04 = sharedNostrTools.nip04;
    const encrypted = await nip04.encrypt(sharedSecretKey, recipientPubkey, params.message);

    // Create DM event (kind 4)
    const event = sharedNostrTools.finalizeEvent(
      {
        kind: 4,
        content: encrypted,
        tags: [["p", recipientPubkey]],
        created_at: Math.floor(Date.now() / 1000),
      },
      sharedSecretKey
    );

    // Publish to relays
    const promises = sharedPool.publish(sharedRelays, event);
    await Promise.allSettled(promises);

    sharedLogger?.info(`agent-reach: Sent DM to ${params.npub || recipientPubkey.slice(0, 8)}...`);

    return { 
      success: true, 
      message: `Message sent to ${params.npub || recipientPubkey.slice(0, 8)}...`,
      eventId: event.id
    };
  } catch (err) {
    sharedLogger?.error(`agent-reach: Failed to send DM: ${String(err)}`);
    return { success: false, message: `Failed to send: ${String(err)}` };
  }
}
