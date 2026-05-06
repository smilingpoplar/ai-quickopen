export type WarmItem = { tabId: number; windowId: number | null };

export type WarmState = 'idle' | 'warming' | 'ready' | 'consuming' | 'recovering';

export type WarmResourceKind = 'chrome-warm-tab' | 'firefox-hidden-tab';

export type WarmResourceRecord = WarmItem & { kind: WarmResourceKind };

export interface WarmProvider {
  ensureReady(): Promise<void>;
  acquire(timeoutMs?: number): Promise<WarmItem | null>;
}
