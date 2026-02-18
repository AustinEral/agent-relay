import { 
  SimplePool, 
  nip19,
  type Event as NostrEvent,
  type Filter
} from 'nostr-tools';
import { 
  Agent, 
  AgentServiceCard, 
  AgentHeartbeat, 
  RelayStatus,
  EVENT_KINDS,
  LABELS,
} from './types';

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];

const HEARTBEAT_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes (matches CLI)

export class NostrClient {
  private pool: SimplePool;
  private relays: string[];
  private agents: Map<string, Agent> = new Map();
  private pendingHeartbeats: Map<string, AgentHeartbeat> = new Map();
  private relayStatuses: Map<string, RelayStatus> = new Map();
  private isLoading: boolean = true; // Suppress renders during initial load
  
  public onAgentUpdate?: (agents: Agent[]) => void;
  public onRelayStatusChange?: (statuses: RelayStatus[]) => void;
  public onConnectionChange?: (connected: boolean, count: number) => void;

  constructor(relays: string[] = DEFAULT_RELAYS) {
    this.pool = new SimplePool();
    this.relays = relays;
    
    // Initialize relay statuses
    for (const relay of relays) {
      this.relayStatuses.set(relay, { url: relay, connected: false });
    }
  }

  async connect(): Promise<void> {
    console.log('[NostrClient] Connecting to relays:', this.relays);
    
    // Query both in parallel (faster)
    await Promise.all([
      this.queryServiceCards(),
      this.queryHeartbeats()
    ]);
    
    // Now match any pending heartbeats to agents
    this.matchPendingHeartbeats();
    
    // Loading complete - enable renders
    this.isLoading = false;
    
    // Single render with complete data
    this.notifyAgentUpdate();
    
    // Fetch profile pictures (non-blocking, updates cards as they arrive)
    this.queryProfiles();
    
    // Mark relays as connected
    for (const relay of this.relays) {
      this.relayStatuses.set(relay, { url: relay, connected: true });
    }
    this.onRelayStatusChange?.(Array.from(this.relayStatuses.values()));
    this.onConnectionChange?.(true, this.relays.length);
    
    // Set up subscriptions for real-time updates
    this.subscribeToServiceCards();
    this.subscribeToHeartbeats();
  }
  
  private matchPendingHeartbeats(): void {
    for (const [pubkey, heartbeat] of this.pendingHeartbeats) {
      const agent = this.agents.get(pubkey);
      if (agent) {
        agent.heartbeat = heartbeat;
        agent.lastSeen = heartbeat.timestamp;
        this.updateOnlineStatus(agent);
        console.log('[NostrClient] Matched pending heartbeat to', agent.serviceCard.name);
      }
    }
    this.pendingHeartbeats.clear();
  }
  
  private async queryServiceCards(): Promise<void> {
    console.log('[NostrClient] Querying service cards...');
    try {
      const events = await this.pool.querySync(this.relays, {
        kinds: [EVENT_KINDS.SERVICE_CARD],
        '#L': [LABELS.NAMESPACE],  // Filter by agent-reach namespace
        limit: 100,
      });
      console.log(`[NostrClient] Found ${events.length} service cards`);
      for (const event of events) {
        this.handleServiceCard(event);
      }
    } catch (e) {
      console.error('[NostrClient] Failed to query service cards:', e);
    }
  }
  
  private async queryHeartbeats(): Promise<void> {
    console.log('[NostrClient] Querying heartbeats...');
    console.log('[NostrClient] Current agents in map:', Array.from(this.agents.keys()).map(k => k.slice(0,8)));
    try {
      const events = await this.pool.querySync(this.relays, {
        kinds: [EVENT_KINDS.HEARTBEAT],
        '#L': [LABELS.NAMESPACE],
        since: Math.floor(Date.now() / 1000) - 3600,
        limit: 500,
      });
      console.log(`[NostrClient] Found ${events.length} heartbeats`);
      for (const event of events) {
        this.handleHeartbeat(event);
      }
      // Log final state
      console.log('[NostrClient] After heartbeats, agents online status:');
      for (const [_pk, agent] of this.agents) {
        console.log(`  - ${agent.serviceCard.name}: online=${agent.isOnline}, lastSeen=${agent.lastSeen?.toISOString() || 'never'}, hasHeartbeat=${!!agent.heartbeat}`);
      }
    } catch (e) {
      console.error('[NostrClient] Failed to query heartbeats:', e);
    }
  }

  private async queryProfiles(): Promise<void> {
    const pubkeys = Array.from(this.agents.keys());
    if (pubkeys.length === 0) return;
    
    console.log('[NostrClient] Querying profiles for', pubkeys.length, 'agents');
    try {
      const events = await this.pool.querySync(this.relays, {
        kinds: [0],  // NIP-01 metadata
        authors: pubkeys,
      });
      
      console.log(`[NostrClient] Found ${events.length} profile events`);
      
      // Keep only the latest kind 0 per pubkey
      const latest = new Map<string, NostrEvent>();
      for (const event of events) {
        const existing = latest.get(event.pubkey);
        if (!existing || event.created_at > existing.created_at) {
          latest.set(event.pubkey, event);
        }
      }
      
      let updated = false;
      for (const [pubkey, event] of latest) {
        try {
          const profile = JSON.parse(event.content);
          const agent = this.agents.get(pubkey);
          if (agent) {
            // Only use profile picture if no avatar set via service card tag
            if (profile.picture && !agent.serviceCard.picture) {
              agent.serviceCard.picture = profile.picture;
              updated = true;
              console.log('[NostrClient] Got profile picture for', agent.serviceCard.name);
            }
          }
        } catch {
          // Invalid JSON in profile, skip
        }
      }
      
      if (updated) this.notifyAgentUpdate();
    } catch (e) {
      console.error('[NostrClient] Failed to query profiles:', e);
    }
  }

  private subscribeToServiceCards(): void {
    const filter = {
      kinds: [EVENT_KINDS.SERVICE_CARD],
      '#L': [LABELS.NAMESPACE],
    } as Filter;

    console.log('[NostrClient] Subscribing to service cards with filter:', filter);

    // @ts-ignore - nostr-tools type issue with #L filter
    this.pool.subscribeMany(
      this.relays,
      [filter],
      {
        onevent: (event: NostrEvent) => {
          console.log('[NostrClient] Received service card event:', event.id?.slice(0, 8), 'from', event.pubkey?.slice(0, 8));
          this.handleServiceCard(event);
        },
        oneose: () => {
          console.log('[NostrClient] End of stored service cards, total agents:', this.agents.size);
        },
      }
    );
  }

  private subscribeToHeartbeats(): void {
    const filter = {
      kinds: [EVENT_KINDS.HEARTBEAT],
      '#L': [LABELS.NAMESPACE],
      since: Math.floor(Date.now() / 1000) - 3600,
    } as Filter;

    // @ts-ignore - nostr-tools type issue with #L filter
    this.pool.subscribeMany(
      this.relays,
      [filter],
      {
        onevent: (event: NostrEvent) => {
          this.handleHeartbeat(event);
        },
        oneose: () => {
          console.log('[NostrClient] End of stored heartbeats');
        },
      }
    );
  }

  private handleServiceCard(event: NostrEvent): void {
    try {
      const npub = nip19.npubEncode(event.pubkey);
      
      // Parse from tags (NIP-32 style)
      let dTag = 'default';
      let name = 'Unknown Agent';
      let about = '';
      let color: string | undefined;
      let avatar: string | undefined;
      let banner: string | undefined;
      const capabilities: string[] = [];
      
      for (const tag of event.tags) {
        if (tag[0] === 'd' && tag[1]) {
          dTag = tag[1];
        } else if (tag[0] === 'name' && tag[1]) {
          name = tag[1];
        } else if (tag[0] === 'about' && tag[1]) {
          about = tag[1];
        } else if (tag[0] === 'c' && tag[1]) {
          capabilities.push(tag[1]);
        } else if (tag[0] === 'color' && tag[1]) {
          color = tag[1];
        } else if (tag[0] === 'avatar' && tag[1]) {
          avatar = tag[1];
        } else if (tag[0] === 'banner' && tag[1]) {
          banner = tag[1];
        }
      }
      
      const serviceCard: AgentServiceCard = {
        id: `${event.pubkey.slice(0, 8)}-${dTag}`,
        pubkey: event.pubkey,
        npub: `${npub.slice(0, 12)}...${npub.slice(-8)}`,
        npubFull: npub,
        name,
        description: about,
        capabilities,
        version: '1.0',
        createdAt: new Date(event.created_at * 1000),
        color,
        picture: avatar,  // Service card avatar takes priority, profile pic is fallback
        banner,
      };

      console.log('[NostrClient] Parsed service card:', name, 'caps:', capabilities, 'pubkey:', event.pubkey.slice(0, 8));

      // Update or create agent
      const existing = this.agents.get(event.pubkey);
      if (existing) {
        existing.serviceCard = serviceCard;
        this.updateOnlineStatus(existing);
      } else {
        const agent: Agent = {
          serviceCard,
          isOnline: false,
        };
        
        // Check for pending heartbeat
        const pendingHeartbeat = this.pendingHeartbeats.get(event.pubkey);
        if (pendingHeartbeat) {
          console.log('[NostrClient] Found pending heartbeat for', name);
          agent.heartbeat = pendingHeartbeat;
          agent.lastSeen = pendingHeartbeat.timestamp;
          this.pendingHeartbeats.delete(event.pubkey);
          this.updateOnlineStatus(agent);
        }
        
        this.agents.set(event.pubkey, agent);
      }

      this.notifyAgentUpdate();
    } catch (e) {
      console.error('[NostrClient] Failed to parse service card:', e);
    }
  }

  private handleHeartbeat(event: NostrEvent): void {
    try {
      // Parse from tags
      let status: 'available' | 'busy' | 'offline' = 'available';
      
      for (const tag of event.tags) {
        if (tag[0] === 's' && tag[1]) {
          const s = tag[1].toLowerCase();
          if (s === 'available' || s === 'busy' || s === 'maintenance') {
            status = s === 'maintenance' ? 'offline' : s;
          }
        }
      }
      
      const heartbeat: AgentHeartbeat = {
        pubkey: event.pubkey,
        status,
        timestamp: new Date(event.created_at * 1000),
      };

      console.log('[NostrClient] Parsed heartbeat:', event.pubkey.slice(0, 8), 'status:', status, 'timestamp:', heartbeat.timestamp.toISOString());

      // Update agent heartbeat
      const agent = this.agents.get(event.pubkey);
      console.log('[NostrClient] Agent match for heartbeat:', agent ? agent.serviceCard.name : 'NOT FOUND (storing as pending)');
      
      if (agent) {
        // Only update if this heartbeat is newer
        if (!agent.heartbeat || heartbeat.timestamp > agent.heartbeat.timestamp) {
          agent.heartbeat = heartbeat;
          agent.lastSeen = heartbeat.timestamp;
          this.updateOnlineStatus(agent);
        }
      } else {
        // Store as pending - will be matched when service card arrives
        const existing = this.pendingHeartbeats.get(event.pubkey);
        if (!existing || heartbeat.timestamp > existing.timestamp) {
          this.pendingHeartbeats.set(event.pubkey, heartbeat);
        }
      }

      this.notifyAgentUpdate();
    } catch (e) {
      console.error('[NostrClient] Failed to parse heartbeat:', e);
    }
  }

  private updateOnlineStatus(agent: Agent): void {
    if (!agent.heartbeat) {
      agent.isOnline = false;
      return;
    }

    const timeSinceHeartbeat = Date.now() - agent.heartbeat.timestamp.getTime();
    agent.isOnline = timeSinceHeartbeat < HEARTBEAT_TIMEOUT_MS && 
                     agent.heartbeat.status !== 'offline';
  }

  private notifyAgentUpdate(): void {
    // Skip renders during initial load
    if (this.isLoading) return;
    
    // Refresh online statuses
    for (const agent of this.agents.values()) {
      this.updateOnlineStatus(agent);
    }
    
    this.onAgentUpdate?.(Array.from(this.agents.values()));
  }

  getAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  getRelayStatuses(): RelayStatus[] {
    return Array.from(this.relayStatuses.values());
  }

  getRelayUrls(): string[] {
    return this.relays;
  }

  disconnect(): void {
    this.pool.close(this.relays);
  }
}
