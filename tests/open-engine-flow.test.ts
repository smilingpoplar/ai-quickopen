import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function createImportSafeBrowserMock() {
  const calls = {
    create: [] as any[],
    remove: [] as number[],
  };

  const browserMock = {
    runtime: {
      getURL: () => 'chrome-extension://test-extension/',
    },
    tabs: {
      create: async (config: any) => {
        calls.create.push(config);
        return { id: 999, url: config.url };
      },
      remove: async (tabId: number) => {
        calls.remove.push(tabId);
      },
      query: async () => [{ id: 1, url: 'https://example.com' }],
      sendMessage: async () => ({ ok: true }),
      onRemoved: {
        addListener: () => {},
      },
    },
    windows: {
      onRemoved: {
        addListener: () => {},
      },
      onFocusChanged: {
        addListener: () => {},
      },
    },
  };

  return { browserMock, calls };
}

test('openPrewarmedAI should discard consumed warm tab before fallback open when send fails', async () => {
  const originalBrowser = (globalThis as any).browser;
  const { browserMock, calls } = createImportSafeBrowserMock();
  (globalThis as any).browser = browserMock;

  try {
    const moduleUrl = pathToFileURL(path.resolve('src/background/use-cases/open-engine-flow.ts')).href;
    const { openPrewarmedAI } = await import(moduleUrl);
    const warmServiceUrl = pathToFileURL(path.resolve('src/background/warm/warm-service.ts')).href;
    const { warmService } = await import(warmServiceUrl);

    warmService.acquire = async () => ({ tabId: 701, windowId: 702 });
    browserMock.tabs.sendMessage = async () => {
      throw new Error('receiver missing');
    };

    const result = await openPrewarmedAI('hello');

    assert.equal(result, 999);
    assert.deepEqual(calls.remove, [701]);
    assert.deepEqual(calls.create, [{ url: 'https://gemini.google.com/app', active: true }]);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});
