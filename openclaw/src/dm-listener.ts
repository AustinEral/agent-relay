/**
 * DM Listener - Temporary workaround for OpenClaw Nostr bugs #3646 and #4547
 * 
 * Subscribes to Nostr relays for incoming NIP-04 DMs and injects them
 * as system events into the main session via the gateway API.
 * 
 * Remove this file once OpenClaw fixes Nostr DM receiving natively.
 */

declare function require(id: string): any;
declare const fetch: any;
const fs = require("fs/promises");
const path = require("path");

const STATE_FILE = "dm-listener-state.json";

interface DmListenerState {
  lastSeenAt: number; // unix seconds
  seenIds: string[];  // recent event IDs for dedup
}

interface DmListenerDeps {
  nostrTools: any;
  secretKey: Uint8Array;
  publicKey: string;
  relays: string[];
  stateDir: string;
  runtime: any; // PluginRuntime — has runtime.system.enqueueSystemEvent
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
}

let activeSubs: any[] = [];
let activeRelays: any[] = [];

async function loadState(stateDir: string): Promise<DmListenerState> {
  try {
    const data = await fs.readFile(path.join(stateDir, STATE_FILE), "utf-8");
    return JSON.parse(data);
  } catch {
    return {
      lastSeenAt: Math.floor(Date.now() / 1000) - 120,
      seenIds: [],
    };
  }
}

async function saveState(stateDir: string, state: DmListenerState): Promise<void> {
  await fs.mkdir(stateDir, { recursive: true });
  // Keep only last 500 IDs
  state.seenIds = state.seenIds.slice(-500);
  await fs.writeFile(path.join(stateDir, STATE_FILE), JSON.stringify(state, null, 2));
}

function injectMessage(runtime: any, text: string): void {
  runtime.system.enqueueSystemEvent(text, { sessionKey: "agent:main:main" });
}

export async function startDmListener(deps: DmListenerDeps): Promise<{ stop: () => void }> {
  const { nostrTools, secretKey, publicKey, relays, stateDir, runtime, logger } = deps;
  const { Relay } = await import("nostr-tools/relay");
  const nip04 = nostrTools.nip04;

  const state = await loadState(stateDir);
  const seenSet = new Set(state.seenIds);
  const since = Math.max(0, state.lastSeenAt - 60); // 60s lookback

  let saveTimeout: any = null;

  function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      saveState(stateDir, state).catch(err =>
        logger.error(`dm-listener: Failed to save state: ${err}`)
      );
    }, 5000);
  }

  async function handleEvent(event: any) {
    // Dedup
    if (seenSet.has(event.id)) return;
    seenSet.add(event.id);
    state.seenIds.push(event.id);

    // Skip our own messages
    if (event.pubkey === publicKey) return;

    // Must be tagged to us
    const targetsUs = event.tags.some((t: string[]) => t[0] === "p" && t[1] === publicKey);
    if (!targetsUs) return;

    // Decrypt
    let plaintext: string;
    try {
      plaintext = await nip04.decrypt(secretKey, event.pubkey, event.content);
    } catch (err) {
      logger.warn(`dm-listener: Decrypt failed from ${event.pubkey.slice(0, 12)}: ${err}`);
      return;
    }

    // Update state
    state.lastSeenAt = Math.max(state.lastSeenAt, event.created_at);
    scheduleSave();

    // Format sender
    const senderShort = event.pubkey.slice(0, 12) + "...";
    let senderNpub: string;
    try {
      senderNpub = nostrTools.nip19.npubEncode(event.pubkey);
    } catch {
      senderNpub = event.pubkey;
    }

    logger.info(`dm-listener: DM from ${senderShort}: ${plaintext.slice(0, 80)}`);

    // Inject into main session as system event
    const injectedText = `[Nostr DM from ${senderNpub}]\n${plaintext}`;
    try {
      injectMessage(runtime, injectedText);
      logger.debug(`dm-listener: Injected DM into main session`);
    } catch (err) {
      logger.error(`dm-listener: Failed to inject: ${err}`);
    }
  }

  // Connect to each relay individually (Relay.subscribe works, SimplePool doesn't)
  for (const url of relays) {
    try {
      const relay = await Relay.connect(url);
      activeRelays.push(relay);

      const sub = relay.subscribe(
        [{ kinds: [4], "#p": [publicKey], since }],
        {
          onevent: (event: any) => {
            handleEvent(event).catch(err =>
              logger.error(`dm-listener: Event handler error: ${err}`)
            );
          },
          oneose: () => {
            logger.debug(`dm-listener: EOSE from ${url}`);
          },
        }
      );
      activeSubs.push(sub);
      logger.debug(`dm-listener: Subscribed to ${url}`);
    } catch (err) {
      logger.warn(`dm-listener: Failed to connect to ${url}: ${err}`);
    }
  }

  logger.info(`dm-listener: Listening on ${activeRelays.length}/${relays.length} relays`);

  return {
    stop: () => {
      for (const sub of activeSubs) {
        try { sub.close(); } catch {}
      }
      for (const relay of activeRelays) {
        try { relay.close(); } catch {}
      }
      activeSubs = [];
      activeRelays = [];
      if (saveTimeout) clearTimeout(saveTimeout);
      saveState(stateDir, state).catch(() => {});
      logger.info("dm-listener: Stopped");
    },
  };
}
