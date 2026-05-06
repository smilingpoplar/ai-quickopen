import type { AIEngine } from '../shared/types';

export const ENGINE_CONTENT_READY = 'ENGINE_CONTENT_READY';
export const DEFAULT_READY_TIMEOUT_MS = 5000;

let installed = false;
const readyTabIdsByEngine = new Map<AIEngine, Set<number>>([
  ['gemini', new Set<number>()],
  ['grok', new Set<number>()],
]);
const waiters = new Map<string, Array<(isReady: boolean) => void>>();

function normalizeEngine(engine: unknown): AIEngine {
  return engine === 'grok' ? 'grok' : 'gemini';
}

function toWaiterKey(engine: AIEngine, tabId: number): string {
  return `${engine}:${tabId}`;
}

function getReadyTabSet(engine: AIEngine): Set<number> {
  const existing = readyTabIdsByEngine.get(engine);
  if (existing) return existing;

  const next = new Set<number>();
  readyTabIdsByEngine.set(engine, next);
  return next;
}

function markEngineTabReady(engine: AIEngine, tabId: number): void {
  getReadyTabSet(engine).add(tabId);
}

function clearEngineReadyState(engine: AIEngine, tabId: number): void {
  getReadyTabSet(engine).delete(tabId);
  const key = toWaiterKey(engine, tabId);
  const tabWaiters = waiters.get(key) ?? [];
  waiters.delete(key);
  for (const resolve of tabWaiters) {
    resolve(false);
  }
}

function clearTabReadyState(tabId: number): void {
  clearEngineReadyState('gemini', tabId);
  clearEngineReadyState('grok', tabId);
}

export function markTabReady(engine: AIEngine, tabId: number): void {
  markEngineTabReady(engine, tabId);
}

export function clearTabReadyStateByEngine(engine: AIEngine, tabId: number): void {
  clearEngineReadyState(engine, tabId);
}

export function waitForEngineTabReadyState(
  engine: AIEngine,
  tabId: number,
  timeoutMs = DEFAULT_READY_TIMEOUT_MS,
): Promise<boolean> {
  if (typeof tabId !== 'number') {
    return Promise.resolve(false);
  }

  if (getReadyTabSet(engine).has(tabId)) {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    const key = toWaiterKey(engine, tabId);
    const tabWaiters = waiters.get(key) ?? [];
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const finish = (isReady: boolean) => {
      if (settled) return;

      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const currentWaiters = waiters.get(key) ?? [];
      const remainingWaiters = currentWaiters.filter(waiter => waiter !== finish);
      if (remainingWaiters.length > 0) {
        waiters.set(key, remainingWaiters);
      } else {
        waiters.delete(key);
      }
      resolve(isReady);
    };

    tabWaiters.push(finish);
    waiters.set(key, tabWaiters);
    timeoutId = setTimeout(() => {
      finish(false);
    }, timeoutMs);
  });
}

export function installEngineReadyTracker(): void {
  if (installed) {
    return;
  }

  installed = true;

  browser.runtime?.onMessage?.addListener?.((message, sender) => {
    if (message?.type !== ENGINE_CONTENT_READY) {
      return undefined;
    }

    const tabId = sender.tab?.id;
    if (typeof tabId === 'number') {
      const engine = normalizeEngine(message?.engine);
      markEngineTabReady(engine, tabId);
      const key = toWaiterKey(engine, tabId);
      const tabWaiters = waiters.get(key) ?? [];
      waiters.delete(key);
      for (const resolve of tabWaiters) {
        resolve(true);
      }
    }

    return undefined;
  });

  browser.tabs?.onRemoved?.addListener?.((tabId) => {
    clearTabReadyState(tabId);
  });
}
