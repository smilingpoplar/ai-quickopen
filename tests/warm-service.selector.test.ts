import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function createImportSafeBrowserMock(runtimeUrl: string, withTabHide = false) {
  return {
    runtime: {
      getURL: () => runtimeUrl,
    },
    tabs: withTabHide
      ? {
          hide: async () => {},
          show: async () => {},
          onRemoved: { addListener: () => {} },
        }
      : {
          onRemoved: { addListener: () => {} },
        },
    windows: {
      onRemoved: { addListener: () => {} },
      onFocusChanged: { addListener: () => {} },
    },
  };
}

test('warm service should select chrome warm tab provider in chrome', async () => {
  const originalBrowser = (globalThis as any).browser;
  (globalThis as any).browser = createImportSafeBrowserMock('chrome-extension://test-extension/');

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/warm-service.ts')).href}?selector-chrome=${Date.now()}`;
    const { createWarmProvider } = await import(moduleUrl);
    const provider = createWarmProvider({
      isChrome: true,
      isFirefox: false,
      canHideTabs: false,
    });
    assert.equal(provider.constructor.name, 'ChromeWarmTabProvider');
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('warm service should select firefox hidden-tab provider in firefox with tabHide', async () => {
  const originalBrowser = (globalThis as any).browser;
  (globalThis as any).browser = createImportSafeBrowserMock('moz-extension://test-extension/', true);

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/warm/warm-service.ts')).href}?selector-firefox=${Date.now()}`;
    const { createWarmProvider } = await import(moduleUrl);
    const provider = createWarmProvider({
      isChrome: false,
      isFirefox: true,
      canHideTabs: true,
    });
    assert.equal(provider.constructor.name, 'FirefoxHiddenTabWarmProvider');
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});
