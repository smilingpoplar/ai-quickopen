import { getDefaultWarmupForEngine } from '../../shared/constants';
import { loadConfig } from '../../shared/config-storage';
import { DEQUEUE_TIMEOUT_MS, getEngineHomeUrl, resolveEngine } from '../constants';
import { warmService } from '../warm/warm-service';
import { sendQueryToAITab } from './open-engine-flow';

type NavigationSwapDetails = {
  frameId?: number;
  tabId?: number;
  url?: string;
};

type NavigationSwapDeps = {
  acquire: typeof warmService.acquire;
  ensureReady: typeof warmService.ensureReady;
  createTab: typeof browser.tabs.create;
  getTab: typeof browser.tabs.get;
  removeTab: typeof browser.tabs.remove;
  addTabRemovedListener: (listener: (tabId: number) => void) => void;
  removeTabRemovedListener: (listener: (tabId: number) => void) => void;
  sendQuery: typeof sendQueryToAITab;
};

const CLOSE_CONFIRM_TIMEOUT_MS = 120;
const CLOSE_RETRY_CONFIRM_TIMEOUT_MS = 120;

function isTabNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error ? String(error.message || '') : '';
  return message.includes('No tab with id')
    || message.includes('Invalid tab ID');
}

async function tabExists(tabId: number, deps: NavigationSwapDeps): Promise<boolean> {
  try {
    await deps.getTab(tabId);
    return true;
  } catch (error) {
    if (isTabNotFoundError(error)) {
      return false;
    }
    return true;
  }
}

async function waitForTabRemoved(
  tabId: number,
  timeoutMs: number,
  deps: NavigationSwapDeps,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      deps.removeTabRemovedListener(onRemoved);
    };

    const onRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) return;
      cleanup();
      resolve(true);
    };

    deps.addTabRemovedListener(onRemoved);
    timeoutId = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
  });
}

async function closeWithConfirmation(
  tabId: number,
  timeoutMs: number,
  deps: NavigationSwapDeps,
): Promise<boolean> {
  const waitRemoved = waitForTabRemoved(tabId, timeoutMs, deps);
  let removedAlready = false;
  try {
    await deps.removeTab(tabId);
  } catch (error) {
    if (isTabNotFoundError(error)) {
      removedAlready = true;
    }
  }

  if (removedAlready) {
    return true;
  }

  const confirmed = await waitRemoved;
  if (confirmed) {
    return true;
  }

  return !(await tabExists(tabId, deps));
}

async function safeCloseQueryTab(queryTabId: number, deps: NavigationSwapDeps): Promise<void> {
  const closed = await closeWithConfirmation(queryTabId, CLOSE_CONFIRM_TIMEOUT_MS, deps);
  if (closed) {
    return;
  }

  await closeWithConfirmation(queryTabId, CLOSE_RETRY_CONFIRM_TIMEOUT_MS, deps);
}

function createReuseWarmTabForPrewarmNavigation(deps: NavigationSwapDeps) {
  return async function reuseWarmTabForPrewarmNavigation(details: NavigationSwapDetails) {
    if (details.frameId !== 0) return;
    const config = await loadConfig();
    const warmupEnabled = typeof config.ai.warmup[config.ai.engine] === 'boolean'
      ? config.ai.warmup[config.ai.engine]
      : getDefaultWarmupForEngine(config.ai.engine);
    if (!warmupEnabled) return;

    const dispatchEngine = resolveEngine(config.ai.engine);
    const homeUrl = getEngineHomeUrl(dispatchEngine);
    if (!details.url?.startsWith(homeUrl)) return;

    let queryText;
    try {
      const url = new URL(details.url);
      queryText = url.searchParams.get('q');
    } catch {
      return;
    }

    if (!queryText) return;

    const queryTabId = details.tabId;
    const warm = await deps.acquire(DEQUEUE_TIMEOUT_MS);
    const warmTabId = warm?.tabId;

    if (typeof warmTabId !== 'number') return;
    if (queryTabId === warmTabId) return;

    try {
      if (typeof queryTabId === 'number') {
        await safeCloseQueryTab(queryTabId, deps);
      }

      const sent = await deps.sendQuery(warmTabId, queryText, 1, dispatchEngine);
      if (!sent) {
        try {
          await deps.removeTab(warmTabId);
        } catch {
          // noop
        }
        await deps.ensureReady();
        const fallback = await deps.createTab({ url: homeUrl, active: true });
        const fallbackTabId = fallback?.id;
        if (typeof fallbackTabId === 'number') {
          await deps.sendQuery(fallbackTabId, queryText, 1, dispatchEngine);
        }
        return;
      }
    } catch (error) {
      console.error('处理预热导航复用失败:', error);
    }
  };
}

const reuseWarmTabForPrewarmNavigation = createReuseWarmTabForPrewarmNavigation({
  acquire: warmService.acquire.bind(warmService),
  ensureReady: warmService.ensureReady.bind(warmService),
  createTab: browser.tabs.create.bind(browser.tabs),
  getTab: browser.tabs.get.bind(browser.tabs),
  removeTab: browser.tabs.remove.bind(browser.tabs),
  addTabRemovedListener: browser.tabs.onRemoved.addListener.bind(browser.tabs.onRemoved),
  removeTabRemovedListener: browser.tabs.onRemoved.removeListener.bind(browser.tabs.onRemoved),
  sendQuery: sendQueryToAITab,
});

export { createReuseWarmTabForPrewarmNavigation, reuseWarmTabForPrewarmNavigation };
