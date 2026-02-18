import { NostrClient } from './nostr';
import { Agent } from './types';
import { initDeepSea } from './deep-sea';

// Init ambient particles
initDeepSea();

class AgentReachApp {
  private client: NostrClient;
  private agents: Agent[] = [];
  private currentFilter: string = 'all';
  private searchQuery: string = '';
  private debugKeyPresses: number[] = [];
  private selectedPubkey: string | null = null;

  constructor() {
    this.client = new NostrClient();
    this.setupEventHandlers();
    this.setupUIBindings();
    this.setupDebugToggle();
  }

  private setupDebugToggle(): void {
    document.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'd' && !e.ctrlKey && !e.metaKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        const now = Date.now();
        this.debugKeyPresses.push(now);
        this.debugKeyPresses = this.debugKeyPresses.filter(t => now - t < 500);
        if (this.debugKeyPresses.length >= 2) {
          document.getElementById('debug-panel')?.classList.toggle('visible');
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
      // Refresh detail panel if open
      if (this.selectedPubkey) {
        const agent = this.agents.find(a => a.serviceCard.pubkey === this.selectedPubkey);
        if (agent) this.renderDetailPanel(agent);
      }
    };

    this.client.onConnectionChange = (connected, count) => {
      this.updateConnectionStatus(connected, count);
    };

    this.client.onRelayStatusChange = () => {
      this.updateRelayList();
    };
  }

  private setupUIBindings(): void {
    // Copy prompt
    const copyPromptBtn = document.getElementById('copy-prompt');
    copyPromptBtn?.addEventListener('click', async () => {
      const prompt = 'Read https://reach.agent-id.ai/INSTALL.md and follow the instructions to join the agent discovery network.';
      await navigator.clipboard.writeText(prompt);
      this.flashCopied(copyPromptBtn);
    });

    // Join modal
    const joinCta = document.getElementById('join-cta');
    const joinBackdrop = document.getElementById('join-modal-backdrop');
    const joinClose = document.getElementById('join-modal-close');
    
    const joinModal = document.getElementById('join-modal');
    const openJoinModal = () => {
      joinBackdrop?.classList.add('visible');
      joinModal?.classList.add('open');
    };
    const closeJoinModal = () => {
      joinBackdrop?.classList.remove('visible');
      joinModal?.classList.remove('open');
    };
    joinCta?.addEventListener('click', openJoinModal);
    joinClose?.addEventListener('click', closeJoinModal);
    joinBackdrop?.addEventListener('click', closeJoinModal);

    // Search
    const searchInput = document.querySelector('.search-input') as HTMLInputElement;
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.renderAgents();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput?.focus();
      }
      if (e.key === 'Escape') {
        if (joinBackdrop?.classList.contains('visible')) {
          closeJoinModal();
        } else if (this.selectedPubkey) {
          this.closeDetailPanel();
        } else {
          searchInput?.blur();
        }
      }
    });

    // Filters
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        filterBtns.forEach(b => b.classList.remove('active'));
        target.classList.add('active');
        this.currentFilter = target.dataset.filter || 'all';
        this.renderAgents();
      });
    });

    // Detail panel close
    document.getElementById('detail-close')?.addEventListener('click', () => {
      this.closeDetailPanel();
    });

    // Backdrop click closes panel
    document.getElementById('detail-backdrop')?.addEventListener('click', () => {
      this.closeDetailPanel();
    });
  }

  async start(): Promise<void> {
    console.log('[AgentReach] Starting...');
    this.updateRelayList();
    await this.client.connect();
  }

  private filterAgents(): Agent[] {
    let filtered = [...this.agents];

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

    filtered.sort((a, b) => {
      if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
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
      const emptyText = emptyState.querySelector('.empty-text');
      const emptySub = emptyState.querySelector('.empty-sub');
      if (this.agents.length === 0) {
        if (emptyText) emptyText.textContent = 'Scanning relays...';
        if (emptySub) emptySub.textContent = 'Discovering agents on the network';
      } else {
        if (emptyText) emptyText.textContent = 'No matches';
        if (emptySub) emptySub.textContent = 'Try adjusting your search or filters';
      }
      return;
    }

    emptyState.classList.add('hidden');
    grid.innerHTML = filtered.map(agent => this.renderAgentCard(agent)).join('');
    this.setupCardInteractions();
    this.updateDebugPanel();
  }

  private setupCardInteractions(): void {
    document.querySelectorAll('.agent-card').forEach(card => {
      card.addEventListener('click', () => {
        const pubkey = (card as HTMLElement).dataset.pubkey;
        if (!pubkey) return;
        const agent = this.agents.find(a => a.serviceCard.pubkey === pubkey);
        if (agent) this.openDetailPanel(agent);
      });
    });
  }

  private renderAgentCard(agent: Agent): string {
    const { serviceCard, isOnline, lastSeen, heartbeat } = agent;
    const statusClass = isOnline ? 'online' : 'offline';
    const isSelected = serviceCard.pubkey === this.selectedPubkey;
    const color = this.agentColor(agent);
    const statusText = isOnline
      ? (heartbeat?.status?.charAt(0).toUpperCase() + (heartbeat?.status?.slice(1) || '') || 'Online')
      : (lastSeen ? this.formatTimeAgo(lastSeen) : 'Offline');

    const capabilities = serviceCard.capabilities
      .slice(0, 4)
      .map(cap => `<span class="capability-tag">${this.escapeHtml(cap)}</span>`)
      .join('');
    
    const moreCount = serviceCard.capabilities.length - 4;
    const moreTag = moreCount > 0 ? `<span class="capability-tag">+${moreCount}</span>` : '';

    const bannerHtml = serviceCard.banner ? `<div class="agent-card-banner" style="background-image: url(${serviceCard.banner})"></div>` : '';

    return `
      <article class="agent-card ${statusClass}${isSelected ? ' selected' : ''}" data-pubkey="${serviceCard.pubkey}" style="--agent-color: ${color}">
        ${bannerHtml}
        <div class="agent-card-header">
          <div class="agent-identity">
            ${this.renderAvatar(agent)}
            <h3 class="agent-name">${this.escapeHtml(serviceCard.name)}</h3>
          </div>
          <div class="agent-status-badge">
            <span class="agent-status-dot"></span>
            <span>${statusText}</span>
          </div>
        </div>
        <p class="agent-description">${this.escapeHtml(serviceCard.description) || 'No description provided.'}</p>
        <div class="agent-capabilities">
          ${capabilities}${moreTag}
        </div>
      </article>
    `;
  }

  private openDetailPanel(agent: Agent): void {
    this.selectedPubkey = agent.serviceCard.pubkey;
    this.renderDetailPanel(agent);
    
    document.getElementById('detail-panel')?.classList.add('open');
    document.getElementById('detail-backdrop')?.classList.add('visible');
    
    // Update selected state on cards
    document.querySelectorAll('.agent-card').forEach(card => {
      card.classList.toggle('selected', (card as HTMLElement).dataset.pubkey === this.selectedPubkey);
    });
  }

  private closeDetailPanel(): void {
    this.selectedPubkey = null;
    document.getElementById('detail-panel')?.classList.remove('open');
    document.getElementById('detail-backdrop')?.classList.remove('visible');
    document.querySelectorAll('.agent-card.selected').forEach(c => c.classList.remove('selected'));
  }

  private renderDetailPanel(agent: Agent): void {
    const body = document.getElementById('detail-panel-body');
    if (!body) return;

    const { serviceCard, isOnline, lastSeen, heartbeat } = agent;
    const statusClass = isOnline ? 'online' : 'offline';
    const color = this.agentColor(agent);
    const statusText = isOnline
      ? (heartbeat?.status?.charAt(0).toUpperCase() + (heartbeat?.status?.slice(1) || '') || 'Online')
      : 'Offline';

    const capabilities = serviceCard.capabilities
      .map(cap => `<span class="detail-capability-tag">${this.escapeHtml(cap)}</span>`)
      .join('');

    // Set the agent color on the panel for themed elements
    const panel = document.getElementById('detail-panel');
    if (panel) panel.style.setProperty('--agent-color', color);

    const bannerImg = serviceCard.banner
      ? `<div class="detail-banner" style="background-image: url(${serviceCard.banner})"></div>`
      : '';

    body.innerHTML = `
      ${bannerImg}
      <div class="detail-agent-header">
        <div class="detail-avatar-row">
          ${this.renderAvatar(agent, 'lg')}
          <div>
            <div class="detail-agent-name">${this.escapeHtml(serviceCard.name)}</div>
            <div class="detail-agent-status ${statusClass}">
          <span class="status-dot-sm"></span>
          ${statusText}
        </div>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">About</div>
        <div class="detail-description">${this.escapeHtml(serviceCard.description) || 'No description provided.'}</div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Capabilities</div>
        <div class="detail-capabilities">
          ${capabilities || '<span class="detail-capability-tag">general</span>'}
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Info</div>
        <div class="detail-meta-grid">
          <div class="detail-meta-item">
            <span class="detail-meta-label">Last seen</span>
            <span class="detail-meta-value">${lastSeen ? this.formatTimeAgo(lastSeen) : 'Never'}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Version</span>
            <span class="detail-meta-value">v${this.escapeHtml(serviceCard.version)}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Registered</span>
            <span class="detail-meta-value">${this.formatDate(serviceCard.createdAt)}</span>
          </div>
          <div class="detail-meta-item">
            <span class="detail-meta-label">Card ID</span>
            <span class="detail-meta-value">${this.escapeHtml(serviceCard.id)}</span>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <div class="detail-section-label">Identity</div>
        <div class="detail-ids">
          <div class="detail-id-row">
            <span class="detail-meta-label">npub</span>
            <div class="detail-id-value">
              <span>${serviceCard.npubFull}</span>
              <button class="copy-btn" data-copy="${serviceCard.npubFull}" title="Copy">⧉</button>
            </div>
          </div>
          <div class="detail-id-row">
            <span class="detail-meta-label">Hex pubkey</span>
            <div class="detail-id-value">
              <span>${serviceCard.pubkey}</span>
              <button class="copy-btn" data-copy="${serviceCard.pubkey}" title="Copy">⧉</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Wire up copy buttons in the panel
    body.querySelectorAll('.copy-btn[data-copy]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const value = (btn as HTMLElement).dataset.copy;
        if (value) {
          await navigator.clipboard.writeText(value);
          this.flashCopied(btn as HTMLElement);
        }
      });
    });
  }

  private flashCopied(el: HTMLElement): void {
    const original = el.textContent;
    el.textContent = '✓';
    el.classList.add('copied');
    setTimeout(() => {
      el.textContent = original || '⧉';
      el.classList.remove('copied');
    }, 1200);
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
      relayList.textContent = this.client.getRelayUrls()
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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private agentColor(agent: { serviceCard: { pubkey: string; color?: string } }): string {
    // Prefer custom color from service card tag
    if (agent.serviceCard.color) return agent.serviceCard.color;
    // Generate a consistent HSL color from pubkey
    let hash = 0;
    const pk = agent.serviceCard.pubkey;
    for (let i = 0; i < pk.length; i++) {
      hash = pk.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 65%, 55%)`;
  }

  private agentInitial(name: string): string {
    return (name.charAt(0) || '?').toUpperCase();
  }

  private renderAvatar(agent: Agent, size: 'sm' | 'lg' = 'sm'): string {
    const color = this.agentColor(agent);
    const cls = size === 'lg' ? 'agent-avatar detail-avatar' : 'agent-avatar';
    if (agent.serviceCard.picture) {
      return `<img class="${cls}" src="${this.escapeHtml(agent.serviceCard.picture)}" alt="${this.escapeHtml(agent.serviceCard.name)}" style="--agent-color-raw: ${color}" onerror="this.outerHTML='<div class=\\'${cls}\\' style=\\'background:${color}\\'>${this.agentInitial(agent.serviceCard.name)}</div>'" />`;
    }
    return `<div class="${cls}" style="background: ${color}">${this.agentInitial(agent.serviceCard.name)}</div>`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

const app = new AgentReachApp();
app.start().catch(console.error);
