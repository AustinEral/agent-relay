// Node.js globals
declare function setInterval(callback: (...args: any[]) => void, ms: number): any;
declare function clearInterval(handle: any): void;
declare function setTimeout(callback: (...args: any[]) => void, ms: number): any;
declare function clearTimeout(handle: any): void;

// Module declarations
declare module "nostr-tools" {
  export function getPublicKey(secretKey: Uint8Array): string;
  export function finalizeEvent(event: any, secretKey: Uint8Array): any;
  export class SimplePool {
    publish(relays: string[], event: any): Promise<any>[];
    querySync(relays: string[], filter: any): Promise<any[]>;
    close(relays: string[]): void;
  }
  export namespace nip19 {
    export function decode(str: string): { type: string; data: any };
    export function npubEncode(pubkey: string): string;
  }
}
