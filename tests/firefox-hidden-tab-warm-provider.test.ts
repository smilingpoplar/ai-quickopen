import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function createFirefoxBrowserMock({
  hideShouldFail = false,
}: {
  hideShouldFail?: boolean;
} = {}) {
  const calls: Record<string, any[]> = {
    create: [],
    hide: [],
    show: [],
    remove: [],
    update: [],
    focus: [],
  };
  const listeners: Record<string, any> = {
    onTabRemoved: null,
    onMessage: null,
  };

  const browserMock = {
    runtime: {
      getURL: () => 'moz-extension://test-extension/',
      onMessage: {
        addListener: (handler: unknown) => {
          listeners.onMessage = handler;
        },
      },
    },
    storage: {
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
      local: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    tabs: {
      hide: async (tabId: number) => {
        calls.hide.push(tabId);
        if (hideShouldFail) {
          throw new Error('hide failed');
        }
        queueMicrotask(() => {
          listeners.onMessage?.({ type: 'ENGINE_CONTENT_READY', engine: 'gemini' }, { tab: { id: tabId } });
        });
      },
      show: async (tabId: number) => {
        calls.show.push(tabId);
      },
      remove: async (tabId: number) => {
        calls.remove.push(tabId);
      },
      create: async (config: any) => {
        calls.create.push(config);
        return { id: 701, windowId: 702, url: config.url };
      },
      get: async (tabId: number) => ({ id: tabId }),
      update: async (tabId: number, config: any) => {
        calls.update.push({ tabId, config });
      },
      onRemoved: {
        addListener: (handler: unknown) => {
          listeners.onTabRemoved = handler;
        },
      },
    },
    windows: {
      get: async (windowId: number) => ({ id: windowId }),
      update: async (windowId: number, config: any) => {
        calls.focus.push({ windowId, config });
      },
    },
  };

  return { browserMock, calls, listeners };
}

test('firefox provider should create hidden tab and reveal it on acquire', async () => {
  const originalBrowser = (globalThis as any).browser;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;

  const { browserMock, calls } = createFirefoxBrowserMock();
  (globalThis as any).browser = browserMock;
  (globalThis as any).setTimeout = (handler: TimerHandler) => {
    queueMicrotask(() => {
      if (typeof handler === 'function') {
        handler();
      }
    });
    return 1 as any;
  };
  (globalThis as any).clearTimeout = () => {};

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/firefox-hidden-tab-warm-provider.ts')).href}?firefox=${Date.now()}`;
    const { FirefoxHiddenTabWarmProvider } = await import(moduleUrl);
    const provider = new FirefoxHiddenTabWarmProvider();

    await provider.ensureReady();
    const item = await provider.acquire(20);

    assert.equal(item?.tabId, 701);
    assert.deepEqual(calls.create[0], {
      url: 'https://gemini.google.com/app',
      active: false,
    });
    assert.deepEqual(calls.hide, [701]);
    assert.deepEqual(calls.show, [701]);
    assert.deepEqual(calls.update[0], { tabId: 701, config: { active: true } });
    assert.deepEqual(calls.focus[0], { windowId: 702, config: { focused: true } });
  } finally {
    (globalThis as any).browser = originalBrowser;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test('firefox provider should remove tab when hide fails', async () => {
  const originalBrowser = (globalThis as any).browser;

  const { browserMock, calls } = createFirefoxBrowserMock({ hideShouldFail: true });
  (globalThis as any).browser = browserMock;

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/firefox-hidden-tab-warm-provider.ts')).href}?firefox-hide-fail=${Date.now()}`;
    const { FirefoxHiddenTabWarmProvider } = await import(moduleUrl);
    const provider = new FirefoxHiddenTabWarmProvider();

    await provider.ensureReady();

    assert.deepEqual(calls.remove, [701]);
    assert.equal(provider.state, 'idle');
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});
