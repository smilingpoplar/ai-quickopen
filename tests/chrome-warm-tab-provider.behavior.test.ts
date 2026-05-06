import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('should create warm tab in normal window and collapse its tab group', async () => {
  const originalBrowser = (globalThis as any).browser;
  const listeners: Record<string, any> = { onMessage: null, onTabRemoved: null };
  const calls = {
    tabsCreate: [] as any[],
    tabsGroup: [] as any[],
    tabGroupsUpdate: [] as any[],
    tabGroupsQuery: [] as any[],
    tabGroupsMove: [] as any[],
    tabsMove: [] as any[],
  };

  (globalThis as any).browser = {
    runtime: {
      getURL: () => 'chrome-extension://test-extension/',
      onMessage: { addListener: (handler: unknown) => { listeners.onMessage = handler; } },
    },
    storage: {
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    tabs: {
      onRemoved: { addListener: (handler: unknown) => { listeners.onTabRemoved = handler; } },
      create: async (config: any) => {
        calls.tabsCreate.push(config);
        queueMicrotask(() => {
          listeners.onMessage?.({ type: 'GEMINI_CONTENT_READY' }, { tab: { id: 1002 } });
        });
        return { id: 1002, windowId: 1, url: config.url };
      },
      group: async (config: any) => {
        calls.tabsGroup.push(config);
        return 73;
      },
      get: async (tabId: number) => ({ id: tabId, windowId: 1 }),
      query: async ({ groupId }: { groupId?: number }) => {
        if (groupId === 73) {
          return [{ id: 1002, index: 3 }];
        }
        return [];
      },
      update: async () => {},
      move: async (tabIds: number | number[], config: any) => {
        calls.tabsMove.push({ tabIds, config });
      },
    },
    tabGroups: {
      query: async (query: any) => {
        calls.tabGroupsQuery.push(query);
        return [];
      },
      update: async (groupId: number, config: any) => {
        calls.tabGroupsUpdate.push({ groupId, config });
      },
      move: async (groupId: number, config: any) => {
        calls.tabGroupsMove.push({ groupId, config });
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onRemoved: { addListener: () => {} },
      onFocusChanged: { addListener: () => {} },
      getAll: async ({ windowTypes }: { windowTypes?: string[] }) => {
        if (windowTypes?.includes('normal')) return [{ id: 1, focused: true }];
        return [];
      },
      create: async () => ({ id: 99, tabs: [{ id: 1999, windowId: 99 }] }),
      update: async () => {},
      remove: async () => {},
      get: async (windowId: number) => ({ id: windowId }),
    },
  };

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-warm-tab-provider.ts')).href}?test=${Date.now()}-warm-tab`;
    const { ChromeWarmTabProvider } = await import(moduleUrl);
    const provider = new ChromeWarmTabProvider();
    await provider.ensureReady();

    assert.deepEqual(calls.tabsCreate[0], {
      url: 'https://gemini.google.com/app',
      active: false,
      windowId: 1,
      index: 0,
    });
    assert.deepEqual(calls.tabsGroup[0], { tabIds: 1002 });
    assert.deepEqual(calls.tabGroupsQuery[0], { windowId: 1, title: 'W' });
    assert.deepEqual(calls.tabGroupsUpdate[0], {
      groupId: 73,
      config: { collapsed: true, title: 'W' },
    });
    assert.deepEqual(calls.tabGroupsMove[0], { groupId: 73, config: { index: 0 } });
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('should reuse dedicated warm tab group when it already exists', async () => {
  const originalBrowser = (globalThis as any).browser;
  const listeners: Record<string, any> = { onMessage: null, onTabRemoved: null };
  const calls = {
    tabsGroup: [] as any[],
    tabGroupsMove: [] as any[],
    tabsMove: [] as any[],
  };

  (globalThis as any).browser = {
    runtime: {
      getURL: () => 'chrome-extension://test-extension/',
      onMessage: { addListener: (handler: unknown) => { listeners.onMessage = handler; } },
    },
    storage: {
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    tabs: {
      onRemoved: { addListener: (handler: unknown) => { listeners.onTabRemoved = handler; } },
      create: async () => {
        queueMicrotask(() => {
          listeners.onMessage?.({ type: 'GEMINI_CONTENT_READY' }, { tab: { id: 3001 } });
        });
        return { id: 3001, windowId: 1, url: 'https://gemini.google.com/app' };
      },
      group: async (config: any) => {
        calls.tabsGroup.push(config);
        return 88;
      },
      get: async (tabId: number) => ({ id: tabId, windowId: 1 }),
      query: async ({ groupId }: { groupId?: number }) => {
        if (groupId === 88) {
          return [{ id: 2001, index: 1 }, { id: 3001, index: 4 }];
        }
        return [];
      },
      update: async () => {},
      move: async (tabIds: number | number[], config: any) => {
        calls.tabsMove.push({ tabIds, config });
      },
    },
    tabGroups: {
      query: async () => [{ id: 88, windowId: 1, title: 'W' }],
      update: async () => {},
      move: async (groupId: number, config: any) => {
        calls.tabGroupsMove.push({ groupId, config });
      },
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onRemoved: { addListener: () => {} },
      onFocusChanged: { addListener: () => {} },
      getAll: async ({ windowTypes }: { windowTypes?: string[] }) => {
        if (windowTypes?.includes('normal')) return [{ id: 1, focused: true }];
        return [];
      },
      create: async () => ({ id: 1, tabs: [{ id: 3001, windowId: 1 }] }),
      update: async () => {},
      remove: async () => {},
      get: async (windowId: number) => ({ id: windowId }),
    },
  };

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-warm-tab-provider.ts')).href}?test=${Date.now()}-reuse-group`;
    const { ChromeWarmTabProvider } = await import(moduleUrl);
    const provider = new ChromeWarmTabProvider();
    await provider.ensureReady();
    assert.deepEqual(calls.tabsGroup[0], { groupId: 88, tabIds: 3001 });
    assert.deepEqual(calls.tabGroupsMove[0], { groupId: 88, config: { index: 0 } });
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('should ungroup warm tab before activating it on consume', async () => {
  const originalBrowser = (globalThis as any).browser;
  const listeners: Record<string, any> = { onMessage: null, onTabRemoved: null };
  const calls = {
    tabsUngroup: [] as any[],
    tabsMove: [] as any[],
    tabsUpdate: [] as any[],
    windowsUpdate: [] as any[],
  };

  (globalThis as any).browser = {
    runtime: {
      getURL: () => 'chrome-extension://test-extension/',
      onMessage: { addListener: (handler: unknown) => { listeners.onMessage = handler; } },
    },
    storage: {
      session: {
        get: async () => ({
          prerenderKind: 'chrome-warm-tab',
          prerenderTabId: 777,
          prerenderWindowId: 5,
        }),
        set: async () => {},
        remove: async () => {},
      },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    tabs: {
      onRemoved: { addListener: (handler: unknown) => { listeners.onTabRemoved = handler; } },
      create: async () => {
        queueMicrotask(() => {
          listeners.onMessage?.({ type: 'GEMINI_CONTENT_READY' }, { tab: { id: 777 } });
        });
        return { id: 777, windowId: 5, url: 'https://gemini.google.com/app' };
      },
      group: async () => 33,
      ungroup: async (tabId: number) => { calls.tabsUngroup.push(tabId); },
      get: async (tabId: number) => ({ id: tabId, windowId: 5 }),
      update: async (tabId: number, config: any) => { calls.tabsUpdate.push({ tabId, config }); },
      move: async (tabId: number | number[], config: any) => { calls.tabsMove.push({ tabId, config }); },
    },
    tabGroups: { update: async () => {} },
    windows: {
      WINDOW_ID_NONE: -1,
      onRemoved: { addListener: () => {} },
      onFocusChanged: { addListener: () => {} },
      getAll: async ({ windowTypes }: { windowTypes?: string[] }) => {
        if (windowTypes?.includes('normal')) return [{ id: 5, focused: true }];
        return [];
      },
      create: async () => ({ id: 5, tabs: [{ id: 777, windowId: 5 }] }),
      update: async (windowId: number, config: any) => { calls.windowsUpdate.push({ windowId, config }); },
      remove: async () => {},
      get: async (windowId: number) => ({ id: windowId }),
    },
  };

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-warm-tab-provider.ts')).href}?test=${Date.now()}-consume-ungroup`;
    const { ChromeWarmTabProvider } = await import(moduleUrl);
    const provider = new ChromeWarmTabProvider();
    await provider.ensureReady();
    const consumed = await provider.acquire(50);

    assert.equal(consumed?.tabId, 777);
    assert.deepEqual(calls.tabsUngroup[0], 777);
    assert.deepEqual(calls.tabsMove[0], { tabId: 777, config: { index: -1 } });
    assert.deepEqual(calls.tabsUpdate[0], { tabId: 777, config: { active: true } });
    assert.deepEqual(calls.windowsUpdate[0], { windowId: 5, config: { focused: true } });
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('should not recreate any window or warm tab when no normal window exists', async () => {
  const originalBrowser = (globalThis as any).browser;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const listeners: Record<string, any> = { onMessage: null, onTabRemoved: null };
  const calls = {
    tabsCreate: [] as any[],
    windowsCreate: [] as any[],
  };

  (globalThis as any).setTimeout = (handler: (...args: any[]) => void) => {
    queueMicrotask(() => {
      handler();
    });
    return 1 as any;
  };
  (globalThis as any).clearTimeout = () => {};

  (globalThis as any).browser = {
    runtime: {
      getURL: () => 'chrome-extension://test-extension/',
      onMessage: { addListener: (handler: unknown) => { listeners.onMessage = handler; } },
    },
    storage: {
      session: {
        get: async () => ({
          prerenderKind: 'chrome-warm-tab',
          prerenderTabId: 901,
          prerenderWindowId: 11,
        }),
        set: async () => {},
        remove: async () => {},
      },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    tabs: {
      onRemoved: { addListener: (handler: unknown) => { listeners.onTabRemoved = handler; } },
      create: async (config: any) => {
        calls.tabsCreate.push(config);
        return { id: 3001, windowId: 1, url: config.url };
      },
      get: async (tabId: number) => ({ id: tabId, windowId: 11 }),
      group: async () => 1,
      query: async () => [],
      update: async () => {},
      move: async () => {},
    },
    tabGroups: {
      query: async () => [],
      update: async () => {},
    },
    windows: {
      WINDOW_ID_NONE: -1,
      onRemoved: { addListener: () => {} },
      onFocusChanged: { addListener: () => {} },
      getAll: async ({ windowTypes }: { windowTypes?: string[] }) => {
        if (windowTypes?.includes('normal')) return [];
        return [];
      },
      create: async (config: any) => {
        calls.windowsCreate.push(config);
        return { id: 10, tabs: [] };
      },
      update: async () => {},
      remove: async () => {},
      get: async (windowId: number) => ({ id: windowId }),
    },
  };

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/providers/chrome-warm-tab-provider.ts')).href}?test=${Date.now()}-no-window-reopen`;
    const { ChromeWarmTabProvider } = await import(moduleUrl);
    const provider = new ChromeWarmTabProvider();
    assert.equal(typeof listeners.onTabRemoved, 'function');
    await listeners.onTabRemoved(901);
    await new Promise<void>(resolve => originalSetTimeout(() => resolve(), 0));
    assert.equal(calls.tabsCreate.length, 0);
    assert.equal(calls.windowsCreate.length, 0);
    assert.notEqual(provider.state, 'warming');
  } finally {
    (globalThis as any).browser = originalBrowser;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
