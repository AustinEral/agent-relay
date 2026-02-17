import { NostrClient } from './nostr';
import { Agent } from './types';

class AgentReachApp {
  private client: NostrClient;
  private agents: Agent[] = [];
  private currentFilter: string = 'all';
  private searchQuery: string = '';
  private debugKeyPresses: number[] = [];

  constructor() {
    this.client = new NostrClient();
    this.setupEventHandlers();
    this.setupUIBindings();
    this.setupDebugToggle();
  }
  
  private setupDebugToggle(): void {
    // Press 'D' twice within 500ms to toggle debug panel
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey) {
        const now = Date.now();
        this.debugKeyPresses.push(now);
        // Keep only recent presses
        this.debugKeyPresses = this.debugKeyPresses.filter(t => now - t < 500);
        
        if (this.debugKeyPresses.length >= 2) {
          const panel = document.getElementById('debug-panel');
          panel?.classList.toggle('visible');
          this.debugKeyPresses = [];
        }
      }
    });
  }

  private setupEventHandlers(): void {
    this.client.onAgentUpdate = (agents) => {
      this.agents = agents;
      this.renderAgents();
      this.updateAgentCount();
    };

    this.client.onConnectionChange = (connected, count) => {
      this.updateConnectionStatus(connected, count);
    };

    this.client.onRelayStatusChange = (_statuses) => {
      this.updateRelayList();
    };
  }

  private setupUIBindings(): void {
    // Copy prompt button
    const copyPromptBtn = document.getElementById('copy-prompt');
    copyPromptBtn?.addEventListener('click', async () => {
      const prompt = 'Read https://reach.agent-id.ai/INSTALL.md and follow the instructions to join the agent discovery network.';
      await navigator.clipboard.writeText(prompt);
      copyPromptBtn.textContent = '✓';
      copyPromptBtn.classList.add('copied');
      setTimeout(() => {
        copyPromptBtn.textContent = '⧉';
        copyPromptBtn.classList.remove('copied');
      }, 1500);
    });

    // Search input
    const searchInput = document.querySelector('.search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.renderAgents();
    });

    // Keyboard shortcut for search
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput?.focus();
      }
      if (e.key === 'Escape') {
        searchInput?.blur();
      }
    });

    // Filter buttons
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const filter = target.dataset.filter || 'all';
        
        // Update active state
        filterBtns.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        
        this.currentFilter = filter;
        this.renderAgents();
      });
    });
  }

  async start(): Promise<void> {
    console.log('[AgentReach] Starting...');
    this.updateRelayList();
    await this.client.connect();
  }

  private filterAgents(): Agent[] {
    let filtered = [...this.agents];

    // Apply search filter
    if (this.searchQuery) {
      filtered = filtered.filter(agent => {
        const searchable = [
          agent.serviceCard.name,
          agent.serviceCard.description,
          ...agent.serviceCard.capabilities,
        ].join(' ').toLowerCase();
        return searchable.includes(this.searchQuery);
      });
    }

    // Apply category filter
    if (this.currentFilter !== 'all') {
      if (this.currentFilter === 'online') {
        filtered = filtered.filter(a => a.isOnline);
      } else {
        filtered = filtered.filter(a => 
          a.serviceCard.capabilities.some(c => 
            c.toLowerCase().includes(this.currentFilter)
          )
        );
      }
    }

    // Sort: online first, then by name
    filtered.sort((a, b) => {
      if (a.isOnline !== b.isOnline) {
        return a.isOnline ? -1 : 1;
      }
      return a.serviceCard.name.localeCompare(b.serviceCard.name);
    });

    return filtered;
  }

  private renderAgents(): void {
    const grid = document.getElementById('agent-grid');
    const emptyState = document.getElementById('empty-state');
    
    if (!grid || !emptyState) return;

    const filtered = this.filterAgents();

    if (filtered.length === 0) {
      grid.innerHTML = '';
      emptyState.classList.remove('hidden');
      
      // Update empty state message
      const emptyText = emptyState.querySelector('.empty-text');
      const emptySub = emptyState.querySelector('.empty-sub');
      
      if (this.agents.length === 0) {
        if (emptyText) emptyText.textContent = 'SCANNING RELAYS...';
        if (emptySub) emptySub.textContent = 'Discovering agents on the network';
      } else {
        if (emptyText) emptyText.textContent = 'NO MATCHES';
        if (emptySub) emptySub.textContent = 'Try adjusting your search or filters';
      }
      return;
    }

    emptyState.classList.add('hidden');
    grid.innerHTML = filtered.map(agent => this.renderAgentCard(agent)).join('');
    
    // Add click handlers for cards
    this.setupCardInteractions();
    
    // Update debug panel
    this.updateDebugPanel();
  }
  
  private setupCardInteractions(): void {
    // Card click to expand
    document.querySelectorAll('.agent-card').forEach(card => {
      card.addEventListener('click', (e) => {
        // Don't toggle if clicking a button
        if ((e.target as HTMLElement).closest('.copy-btn')) return;
        card.classList.toggle('expanded');
      });
    });
    
    // Copy buttons
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const npub = (btn as HTMLElement).dataset.npub;
        if (npub) {
          await navigator.clipboard.writeText(npub);
          btn.textContent = '✓';
          btn.classList.add('copied');
          setTimeout(() => {
            btn.textContent = '⧉';
            btn.classList.remove('copied');
          }, 1500);
        }
      });
    });
  }

  private renderAgentCard(agent: Agent): string {
    const { serviceCard, isOnline, lastSeen, heartbeat } = agent;
    const statusClass = isOnline ? 'online' : 'offline';
    
    const lastSeenText = lastSeen 
      ? this.formatTimeAgo(lastSeen)
      : 'Never';
    
    // Show status or last seen time
    const statusText = isOnline 
      ? (heartbeat?.status?.toUpperCase() || 'ONLINE')
      : (lastSeen ? lastSeenText : 'OFFLINE');

    const capabilities = serviceCard.capabilities
      .map(cap => `<span class="capability-tag">${this.escapeHtml(cap)}</span>`)
      .join('');

    return `
      <article class="agent-card ${statusClass}" data-pubkey="${serviceCard.pubkey}">
        <div class="agent-header">
          <div class="agent-identity">
            <h3 class="agent-name">${this.escapeHtml(serviceCard.name)}</h3>
            <span class="agent-npub">
              <span>${serviceCard.npub}</span>
              <button class="copy-btn" data-npub="${serviceCard.npubFull}" title="Copy npub">⧉</button>
            </span>
          </div>
          <div class="agent-status">
            <span class="agent-status-indicator"></span>
            <span class="agent-status-text">${statusText}</span>
          </div>
        </div>
        
        <p class="agent-description">${this.escapeHtml(serviceCard.description) || 'No description provided.'}</p>
        
        <div class="agent-capabilities">
          ${capabilities || '<span class="capability-tag">GENERAL</span>'}
        </div>
        
        <div class="agent-meta">
          <div class="meta-item">
            <span class="meta-label">LAST SEEN</span>
            <span class="meta-value">${lastSeenText}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">VERSION</span>
            <span class="meta-value">v${this.escapeHtml(serviceCard.version)}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">REGISTERED</span>
            <span class="meta-value">${this.formatDate(serviceCard.createdAt)}</span>
          </div>
        </div>
        
        <div class="agent-details">
          <div class="detail-row">
            <span class="detail-label">FULL NPUB</span>
            <span class="detail-value full-npub">${serviceCard.npubFull}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">PUBKEY (HEX)</span>
            <span class="detail-value full-npub">${serviceCard.pubkey}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">SERVICE CARD ID</span>
            <span class="detail-value">${this.escapeHtml(serviceCard.id)}</span>
          </div>
        </div>
        
        <span class="expand-indicator">CLICK TO EXPAND</span>
      </article>
    `;
  }

  private updateAgentCount(): void {
    const countValue = document.querySelector('.count-value');
    if (countValue) {
      countValue.textContent = String(this.agents.length).padStart(2, '0');
    }
    this.updateDebugPanel();
  }
  
  private updateDebugPanel(): void {
    const panel = document.getElementById('debug-content');
    if (!panel) return;
    
    const now = Date.now();
    const lines = this.agents.map(agent => {
      const hb = agent.heartbeat;
      const age = hb ? Math.round((now - hb.timestamp.getTime()) / 1000 / 60) : null;
      const statusClass = agent.isOnline ? 'online' : 'offline';
      return `<div class="debug-line">
        <span class="${statusClass}">${agent.isOnline ? '●' : '○'}</span>
        ${agent.serviceCard.name} |
        hasHB: ${!!hb} |
        status: ${hb?.status || 'none'} |
        age: ${age !== null ? age + 'm' : 'n/a'} |
        online: ${agent.isOnline}
      </div>`;
    });
    
    panel.innerHTML = lines.join('') || 'No agents loaded';
  }

  private updateConnectionStatus(connected: boolean, count: number): void {
    const statusDot = document.querySelector('.status-dot');
    const statusText = document.querySelector('.status-text');
    
    if (statusDot && statusText) {
      if (connected) {
        statusDot.classList.add('connected');
        statusText.textContent = `${count} RELAYS`;
      } else {
        statusDot.classList.remove('connected');
        statusText.textContent = 'CONNECTING';
      }
    }
  }

  private updateRelayList(): void {
    const relayList = document.getElementById('relay-list');
    if (relayList) {
      const relays = this.client.getRelayUrls();
      relayList.textContent = relays
        .map(r => r.replace('wss://', ''))
        .join(' · ');
    }
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize
const app = new AgentReachApp();
app.start().catch(console.error);
