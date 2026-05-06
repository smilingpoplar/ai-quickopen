import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function createBrowserMock({
  normalWindows,
  createTab,
}: {
  normalWindows: any[];
  createTab?: (config: any) => any;
}) {
  const listeners: Record<string, any> = { onMessage: null };

  return {
    runtime: {
      getURL: () => 'chrome-extension://test-extension/',
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
      onRemoved: {
        addListener: () => {},
      },
      create: async (config: any) => {
        if (createTab) return createTab(config);
        queueMicrotask(() => {
          listeners.onMessage?.({ type: 'GEMINI_CONTENT_READY' }, { tab: { id: 1001 } });
        });
        return {
          id: 1001,
          windowId: config.windowId ?? 1,
          url: config.url ?? 'about:blank',
        };
      },
      get: async (tabId: number) => ({ id: tabId, windowId: 1 }),
      update: async () => {},
      move: async () => {},
      group: async () => 11,
      ungroup: async () => {},
    },
    tabGroups: {
      update: async () => {},
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onRemoved: {
        addListener: () => {},
      },
      onFocusChanged: {
        addListener: () => {},
      },
      getAll: async ({ windowTypes }: { windowTypes?: string[] }) => {
        if (windowTypes?.includes('normal')) {
          return normalWindows;
        }
        return [];
      },
      create: async () => ({ id: 1000, tabs: [{ id: 1001, windowId: 1000, url: 'https://gemini.google.com/app' }] }),
      update: async () => {},
      remove: async () => {},
      get: async (windowId: number) => ({ id: windowId }),
    },
  };
}

test('state should become ready after fill creates warm tab', async () => {
  const originalBrowser = (globalThis as any).browser;

  (globalThis as any).browser = createBrowserMock({
    normalWindows: [{ id: 1, focused: true }],
  });

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-warm-tab-provider.ts')).href}?state-ready=${Date.now()}`;
    const { ChromeWarmTabProvider } = await import(moduleUrl);
    const provider = new ChromeWarmTabProvider();
    await provider.ensureReady();
    assert.equal(provider.state, 'ready');
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('state should become recovering right after dequeue consumes a warm item', async () => {
  const originalBrowser = (globalThis as any).browser;

  (globalThis as any).browser = createBrowserMock({
    normalWindows: [{ id: 1, focused: true }],
    createTab: async (config: any) => {
      return {
        id: 901,
        windowId: config.windowId ?? 1,
        url: config.url ?? 'https://gemini.google.com/app',
      };
    },
  });

  (globalThis as any).browser.storage.session.get = async () => ({
    prerenderKind: 'chrome-warm-tab',
    prerenderTabId: 901,
    prerenderWindowId: 1,
  });

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-warm-tab-provider.ts')).href}?state-recovering=${Date.now()}`;
    const { ChromeWarmTabProvider } = await import(moduleUrl);
    const provider = new ChromeWarmTabProvider();
    await provider.ensureReady();
    const consumed = await provider.acquire(20);
    assert.equal(consumed?.tabId, 901);
    assert.equal(provider.state, 'recovering');
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('state should return to idle when fill cannot create a usable warm item', async () => {
  const originalBrowser = (globalThis as any).browser;

  (globalThis as any).browser = createBrowserMock({
    normalWindows: [{ id: 1, focused: true }],
    createTab: async () => ({ id: undefined, windowId: 1, url: 'https://gemini.google.com/app' }),
  });

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-warm-tab-provider.ts')).href}?state-idle=${Date.now()}`;
    const { ChromeWarmTabProvider } = await import(moduleUrl);
    const provider = new ChromeWarmTabProvider();
    await provider.ensureReady();
    assert.equal(provider.state, 'idle');
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});
