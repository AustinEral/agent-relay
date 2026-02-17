/**
 * OpenClaw Agent Discovery Extension
 *
 * Publishes service cards and heartbeats to Nostr for agent discovery.
 * Uses the same identity as the Nostr channel plugin (channels.nostr.privateKey).
 * 
 * State (capabilities, etc.) is stored in stateDir, not config.
 * Config only contains "enabled: true".
 */

import { createAgentDiscoveryService, discoverAgents, updateServiceCard } from "./service.js";

// Helper to format JSON results (matching OpenClaw's jsonResult format)
function jsonResult(payload: any) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

// Tool definition for discover_agents
const discoverAgentsTool = {
  label: "Discover Agents",
  name: "discover_agents",
  description: `Search for other AI agents by capability. Returns agents registered on the decentralized agent-reach network.

Use this when:
- You need help with a task you can't do
- You want to find an agent with specific capabilities
- You need to delegate work to a specialist

The returned agents include their npub (Nostr public key) which you can use to contact them via Nostr DM.`,
  parameters: {
    type: "object" as const,
    properties: {
      capability: {
        type: "string",
        description: "Capability to search for (e.g., 'transcription', 'coding', 'research', 'image-generation'). Leave empty to list all agents.",
      },
      limit: {
        type: "number",
        description: "Maximum number of agents to return (default: 10)",
      },
    },
    required: [] as string[],
    additionalProperties: false,
  },
  execute: async (_toolCallId: string, params: { capability?: string; limit?: number }) => {
    const agents = await discoverAgents({
      capability: params.capability,
      limit: params.limit ?? 10,
    });
    return jsonResult({
      agents,
      count: agents.length,
      query: params.capability || "all",
    });
  },
};

// Tool definition for update_service_card
const updateServiceCardTool = {
  label: "Update Service Card",
  name: "update_service_card",
  description: `Update your agent service card on the discovery network. Use this to advertise new capabilities or update your description.

Changes take effect immediately and are published to Nostr relays.

Set online=false to pause heartbeats and save tokens when you don't need to be discoverable.`,
  parameters: {
    type: "object" as const,
    properties: {
      capabilities: {
        type: "array",
        items: { type: "string" },
        description: "List of capabilities (e.g., ['coding', 'research', 'image-generation']). Replaces existing capabilities.",
      },
      name: {
        type: "string",
        description: "Display name for your agent (optional, defaults to Nostr profile name)",
      },
      about: {
        type: "string",
        description: "Description of your agent (optional, defaults to Nostr profile about)",
      },
      heartbeatIntervalMs: {
        type: "number",
        description: "Heartbeat interval in milliseconds (default: 600000 = 10 minutes)",
      },
      online: {
        type: "boolean",
        description: "Set to false to pause heartbeats (go offline), true to resume. Saves tokens when you don't need to be discoverable.",
      },
    },
    required: [] as string[],
    additionalProperties: false,
  },
  execute: async (_toolCallId: string, params: { 
    capabilities?: string[]; 
    name?: string;
    about?: string;
    heartbeatIntervalMs?: number;
    online?: boolean;
  }) => {
    const result = await updateServiceCard(params);
    return jsonResult(result);
  },
};

// Plugin registration
export default function register(api: any) {
  // Register the background service for heartbeats
  api.registerService(createAgentDiscoveryService(api));

  // Register tools
  api.registerTool(discoverAgentsTool);
  api.registerTool(updateServiceCardTool);
}
