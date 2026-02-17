export interface AgentServiceCard {
  id: string;
  pubkey: string;
  npub: string;        // Truncated for display
  npubFull: string;    // Full npub for copying
  name: string;
  description: string;
  capabilities: string[];
  version: string;
  createdAt: Date;
}

export interface AgentHeartbeat {
  pubkey: string;
  status: 'available' | 'busy' | 'offline';
  timestamp: Date;
  message?: string;
}

export interface Agent {
  serviceCard: AgentServiceCard;
  heartbeat?: AgentHeartbeat;
  isOnline: boolean;
  lastSeen?: Date;
}

export interface RelayStatus {
  url: string;
  connected: boolean;
}

// Nostr event kinds
export const EVENT_KINDS = {
  SERVICE_CARD: 31990,  // Replaceable event (NIP-89 style)
  HEARTBEAT: 31991,     // Parameterized replaceable (stores latest per agent)
} as const;

// NIP-32 labels for filtering
export const LABELS = {
  NAMESPACE: 'agent-reach',
  SERVICE_CARD: 'service-card',
  HEARTBEAT: 'heartbeat',
} as const;

// Service card content structure (from tags, not content)
export interface ServiceCardContent {
  name: string;
  description: string;
  capabilities: string[];
  version: string;
}
