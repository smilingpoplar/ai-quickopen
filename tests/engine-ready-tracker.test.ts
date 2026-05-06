import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

test('waitForEngineTabReadyState should resolve when matching ready message arrives', async () => {
  const originalBrowser = (globalThis as any).browser;

  const listeners: Record<string, any> = {
    onMessage: null,
    onRemoved: null,
  };
  (globalThis as any).browser = {
    runtime: {
      onMessage: {
        addListener: (handler: unknown) => {
          listeners.onMessage = handler;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (handler: unknown) => {
          listeners.onRemoved = handler;
        },
      },
    },
  };

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/engine-ready-tracker.ts')).href}?wait-ready=${Date.now()}`;
    const {
      ENGINE_CONTENT_READY,
      installEngineReadyTracker,
      waitForEngineTabReadyState,
    } = await import(moduleUrl);

    installEngineReadyTracker();
    const readyPromise = waitForEngineTabReadyState('gemini', 701, 500);
    listeners.onMessage({ type: ENGINE_CONTENT_READY }, { tab: { id: 701 } });
    const isReady = await readyPromise;

    assert.equal(isReady, true);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});

test('waitForEngineTabReadyState should resolve false on timeout or removal', async () => {
  const originalBrowser = (globalThis as any).browser;

  const listeners: Record<string, any> = {
    onMessage: null,
    onRemoved: null,
  };
  (globalThis as any).browser = {
    runtime: {
      onMessage: {
        addListener: (handler: unknown) => {
          listeners.onMessage = handler;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (handler: unknown) => {
          listeners.onRemoved = handler;
        },
      },
    },
  };

  try {
    const moduleUrl = `${pathToFileURL(path.resolve('src/background/engine-ready-tracker.ts')).href}?install-ready=${Date.now()}`;
    const {
      installEngineReadyTracker,
      waitForEngineTabReadyState,
    } = await import(moduleUrl);

    installEngineReadyTracker();
    assert.equal(typeof listeners.onRemoved, 'function');

    const removedPromise = waitForEngineTabReadyState('gemini', 42, 500);
    listeners.onRemoved(42);
    assert.equal(await removedPromise, false);

    const timeoutResult = await waitForEngineTabReadyState('gemini', 43, 10);
    assert.equal(timeoutResult, false);
  } finally {
    (globalThis as any).browser = originalBrowser;
  }
});
