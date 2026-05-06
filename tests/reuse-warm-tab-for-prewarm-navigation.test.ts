import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function createTabRemovedEventBus() {
  const listeners = new Set<(tabId: number) => void>();
  return {
    addListener(listener: (tabId: number) => void) {
      listeners.add(listener);
    },
    removeListener(listener: (tabId: number) => void) {
      listeners.delete(listener);
    },
    emit(tabId: number) {
      for (const listener of listeners) {
        listener(tabId);
      }
    },
  };
}

function createImportSafeBrowserMock() {
  const tabRemoved = createTabRemovedEventBus();
  return {
    runtime: {
      getURL: () => 'moz-extension://test-extension/',
    },
    tabs: {
      remove: async () => {},
      get: async () => ({ id: 1 }),
      create: async () => ({ id: 1 }),
      onRemoved: tabRemoved,
      hide: async () => {},
      show: async () => {},
    },
    windows: {
      get: async () => ({ id: 1 }),
      update: async () => {},
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
  };
}

test('reuse warm tab for 预热 navigation should close query tab before sending q', async () => {
  const originalBrowser = (globalThis as any).browser;
  (globalThis as any).browser = createImportSafeBrowserMock();

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/use-cases/reuse-warm-tab-for-prewarm-navigation.ts')).href}?firefox-navigation=${Date.now()}`;
    const { createReuseWarmTabForPrewarmNavigation } = await import(moduleUrl);
    const calls = {
      acquire: [] as number[],
      sendQuery: [] as Array<{ tabId: number; queryText: string }>,
      removeTab: [] as number[],
      createTab: [] as Array<{ url: string; active: boolean }>,
      ensureReady: 0,
      order: [] as string[],
    };
    const removedEvents = createTabRemovedEventBus();

    const reuseWarmTabForPrewarmNavigation = createReuseWarmTabForPrewarmNavigation({
      acquire: async (timeoutMs?: number) => {
        calls.acquire.push(timeoutMs ?? -1);
        return { tabId: 701, windowId: 702 };
      },
      createTab: async (createProperties: any) => {
        calls.createTab.push(createProperties);
        return { id: 801 };
      },
      ensureReady: async () => {
        calls.ensureReady += 1;
      },
      getTab: async (tabId: number) => ({ id: tabId }),
      removeTab: async (tabId: number) => {
        calls.order.push(`remove:${tabId}`);
        calls.removeTab.push(tabId);
        removedEvents.emit(tabId);
      },
      addTabRemovedListener: removedEvents.addListener,
      removeTabRemovedListener: removedEvents.removeListener,
      sendQuery: async (tabId: number, queryText: string) => {
        calls.order.push(`send:${tabId}`);
        calls.sendQuery.push({ tabId, queryText });
        return true;
      },
    });

    await reuseWarmTabForPrewarmNavigation({
      frameId: 0,
      tabId: 123,
      url: 'https://gemini.google.com/app?q=hello%20firefox',
    });

    assert.deepEqual(calls.acquire, [2000]);
    assert.deepEqual(calls.sendQuery, [{ tabId: 701, queryText: 'hello firefox' }]);
    assert.deepEqual(calls.removeTab, [123]);
    assert.deepEqual(calls.createTab, []);
    assert.deepEqual(calls.order, ['remove:123', 'send:701']);
    assert.equal(calls.ensureReady, 0);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('reuse warm tab for 预热 navigation should fallback create tab on send failure', async () => {
  const originalBrowser = (globalThis as any).browser;
  (globalThis as any).browser = createImportSafeBrowserMock();

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/use-cases/reuse-warm-tab-for-prewarm-navigation.ts')).href}?firefox-navigation-fail=${Date.now()}`;
    const { createReuseWarmTabForPrewarmNavigation } = await import(moduleUrl);
    const removedEvents = createTabRemovedEventBus();
    const calls = {
      removeTab: [] as number[],
      createTab: [] as Array<{ url: string; active: boolean }>,
      sendQuery: [] as Array<{ tabId: number; queryText: string }>,
      ensureReady: 0,
    };

    const reuseWarmTabForPrewarmNavigation = createReuseWarmTabForPrewarmNavigation({
      acquire: async () => ({ tabId: 701, windowId: 702 }),
      createTab: async (createProperties: any) => {
        calls.createTab.push(createProperties);
        return { id: 801 };
      },
      ensureReady: async () => {
        calls.ensureReady += 1;
      },
      getTab: async (tabId: number) => ({ id: tabId }),
      removeTab: async (tabId: number) => {
        calls.removeTab.push(tabId);
        removedEvents.emit(tabId);
      },
      addTabRemovedListener: removedEvents.addListener,
      removeTabRemovedListener: removedEvents.removeListener,
      sendQuery: async (tabId: number, queryText: string) => {
        calls.sendQuery.push({ tabId, queryText });
        return tabId === 801;
      },
    });

    await reuseWarmTabForPrewarmNavigation({
      frameId: 0,
      tabId: 123,
      url: 'https://gemini.google.com/app?q=hello%20firefox',
    });

    assert.deepEqual(calls.removeTab, [123, 701]);
    assert.deepEqual(calls.sendQuery, [
      { tabId: 701, queryText: 'hello firefox' },
      { tabId: 801, queryText: 'hello firefox' },
    ]);
    assert.deepEqual(calls.createTab, [{ url: 'https://gemini.google.com/app', active: true }]);
    assert.equal(calls.ensureReady, 1);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('safeCloseQueryTab should not treat edit-locked remove errors as already removed', async () => {
  const originalBrowser = (globalThis as any).browser;
  (globalThis as any).browser = createImportSafeBrowserMock();

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/use-cases/reuse-warm-tab-for-prewarm-navigation.ts')).href}?firefox-navigation-edit-locked=${Date.now()}`;
    const { createReuseWarmTabForPrewarmNavigation } = await import(moduleUrl);
    const removedEvents = createTabRemovedEventBus();
    let removeAttempts = 0;
    let getAttempts = 0;
    const calls = {
      sendQuery: [] as Array<{ tabId: number; queryText: string }>,
    };

    const reuseWarmTabForPrewarmNavigation = createReuseWarmTabForPrewarmNavigation({
      acquire: async () => ({ tabId: 701, windowId: 702 }),
      createTab: async () => ({ id: 801 }),
      ensureReady: async () => {},
      getTab: async (tabId: number) => {
        getAttempts += 1;
        return { id: tabId };
      },
      removeTab: async (tabId: number) => {
        removeAttempts += 1;
        if (removeAttempts === 1) {
          throw new Error('Tabs cannot be edited right now');
        }
        removedEvents.emit(tabId);
      },
      addTabRemovedListener: removedEvents.addListener,
      removeTabRemovedListener: removedEvents.removeListener,
      sendQuery: async (tabId: number, queryText: string) => {
        calls.sendQuery.push({ tabId, queryText });
        return true;
      },
    });

    await reuseWarmTabForPrewarmNavigation({
      frameId: 0,
      tabId: 123,
      url: 'https://gemini.google.com/app?q=hello%20firefox',
    });

    assert.equal(removeAttempts, 2);
    assert.equal(getAttempts, 1);
    assert.deepEqual(calls.sendQuery, [{ tabId: 701, queryText: 'hello firefox' }]);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('safeCloseQueryTab should treat timeout + missing tab as closed', async () => {
  const originalBrowser = (globalThis as any).browser;
  (globalThis as any).browser = createImportSafeBrowserMock();

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/use-cases/reuse-warm-tab-for-prewarm-navigation.ts')).href}?firefox-navigation-timeout-missing=${Date.now()}`;
    const { createReuseWarmTabForPrewarmNavigation } = await import(moduleUrl);
    const removedEvents = createTabRemovedEventBus();
    let getAttempts = 0;
    const calls = {
      removeTab: [] as number[],
      sendQuery: [] as Array<{ tabId: number; queryText: string }>,
    };

    const reuseWarmTabForPrewarmNavigation = createReuseWarmTabForPrewarmNavigation({
      acquire: async () => ({ tabId: 701, windowId: 702 }),
      createTab: async () => ({ id: 801 }),
      ensureReady: async () => {},
      getTab: async () => {
        getAttempts += 1;
        throw new Error('No tab with id: 123.');
      },
      removeTab: async (tabId: number) => {
        calls.removeTab.push(tabId);
        // no emit -> close confirmation timeout path
      },
      addTabRemovedListener: removedEvents.addListener,
      removeTabRemovedListener: removedEvents.removeListener,
      sendQuery: async (tabId: number, queryText: string) => {
        calls.sendQuery.push({ tabId, queryText });
        return true;
      },
    });

    await reuseWarmTabForPrewarmNavigation({
      frameId: 0,
      tabId: 123,
      url: 'https://gemini.google.com/app?q=hello%20firefox',
    });

    assert.deepEqual(calls.removeTab, [123]);
    assert.equal(getAttempts, 1);
    assert.deepEqual(calls.sendQuery, [{ tabId: 701, queryText: 'hello firefox' }]);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('safeCloseQueryTab should retry remove once when tab still exists after timeout', async () => {
  const originalBrowser = (globalThis as any).browser;
  (globalThis as any).browser = createImportSafeBrowserMock();

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/use-cases/reuse-warm-tab-for-prewarm-navigation.ts')).href}?firefox-navigation-timeout-retry=${Date.now()}`;
    const { createReuseWarmTabForPrewarmNavigation } = await import(moduleUrl);
    const removedEvents = createTabRemovedEventBus();
    let removeAttempts = 0;
    const calls = {
      sendQuery: [] as Array<{ tabId: number; queryText: string }>,
    };

    const reuseWarmTabForPrewarmNavigation = createReuseWarmTabForPrewarmNavigation({
      acquire: async () => ({ tabId: 701, windowId: 702 }),
      createTab: async () => ({ id: 801 }),
      ensureReady: async () => {},
      getTab: async (tabId: number) => ({ id: tabId }),
      removeTab: async (tabId: number) => {
        removeAttempts += 1;
        if (removeAttempts === 2) {
          removedEvents.emit(tabId);
        }
      },
      addTabRemovedListener: removedEvents.addListener,
      removeTabRemovedListener: removedEvents.removeListener,
      sendQuery: async (tabId: number, queryText: string) => {
        calls.sendQuery.push({ tabId, queryText });
        return true;
      },
    });

    await reuseWarmTabForPrewarmNavigation({
      frameId: 0,
      tabId: 123,
      url: 'https://gemini.google.com/app?q=hello%20firefox',
    });

    assert.equal(removeAttempts, 2);
    assert.deepEqual(calls.sendQuery, [{ tabId: 701, queryText: 'hello firefox' }]);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});
