import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function createBrowserMock({
  popupWindows,
  normalWindows,
  createWindow,
}: {
  popupWindows: any[];
  normalWindows: any[];
  createWindow?: (config: any) => any;
}) {
  const listeners: Record<string, any> = {
    onMessage: null,
  };

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
      get: async (tabId: number) => ({ id: tabId }),
      move: async () => {},
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

        if (windowTypes?.includes('popup')) {
          return popupWindows;
        }

        return [];
      },
      create: async (config: any) => {
        if (createWindow) return createWindow(config);
        queueMicrotask(() => {
          listeners.onMessage?.({ type: 'GEMINI_CONTENT_READY' }, { tab: { id: 1001 } });
        });
        return {
          id: 1000,
          tabs: [{ id: 1001, url: config.url ?? 'about:blank' }],
        };
      },
      update: async () => {},
      remove: async () => {},
      get: async (windowId: number) => ({ id: windowId }),
    },
  };
}

test('state should become ready after fill adopts warm popup', async () => {
  const originalBrowser = (globalThis as any).browser;

  (globalThis as any).browser = createBrowserMock({
    normalWindows: [{ id: 1, focused: true }],
    popupWindows: [{
      id: 900,
      left: 10000,
      top: 10000,
      width: 1,
      height: 1,
      tabs: [{ id: 901, url: 'https://gemini.google.com/app' }],
    }],
  });

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-popup-warm-provider.ts')).href}?state-ready=${Date.now()}`;
    const { ChromePopupWarmProvider } = await import(moduleUrl);
    const provider = new ChromePopupWarmProvider();
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
    popupWindows: [{
      id: 900,
      left: 10000,
      top: 10000,
      width: 1,
      height: 1,
      tabs: [{ id: 901, url: 'https://gemini.google.com/app' }],
    }],
  });

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-popup-warm-provider.ts')).href}?state-recovering=${Date.now()}`;
    const { ChromePopupWarmProvider } = await import(moduleUrl);
    const provider = new ChromePopupWarmProvider();
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
    popupWindows: [],
    createWindow: async () => ({ id: 1000, tabs: [] }),
  });

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-popup-warm-provider.ts')).href}?state-idle=${Date.now()}`;
    const { ChromePopupWarmProvider } = await import(moduleUrl);
    const provider = new ChromePopupWarmProvider();
    await provider.ensureReady();
    assert.equal(provider.state, 'idle');
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});
