import { FILL_DELAY_MS, getEngineHomeUrl } from '../../constants';
import type { AIEngine } from '../../../shared/types';
import {
  activateTab,
  focusWindow,
  getWindows,
} from '../../window-utils';
import {
  clearTabReadyStateByEngine,
  installEngineReadyTracker,
  waitForEngineTabReadyState,
} from '../../engine-ready-tracker';
import { WarmResourceStore } from '../warm-resource-store';
import type { WarmItem } from '../types';
import { BaseWarmProvider } from './base-warm-provider';

const WARM_TAB_GROUP_TITLE = 'W';
const GROUP_RETRY_DELAYS_MS = [0, 50, 150];
type BrowserTab = { id?: number; windowId?: number | null; index?: number };
const WARM_LOG_PREFIX = '[warm:chrome-tab-group]';

class ChromeWarmTabProvider extends BaseWarmProvider {
  private _engine: AIEngine;
  private _isCreating: boolean;
  private _isDisposed: boolean;
  private _fillTimer: ReturnType<typeof setTimeout> | null;
  private _store: WarmResourceStore;
  private _onTabRemoved: (removedTabId: number) => Promise<void>;

  constructor(engine: AIEngine = 'gemini', store = new WarmResourceStore()) {
    super();
    installEngineReadyTracker();
    this._engine = engine;
    this._isCreating = false;
    this._isDisposed = false;
    this._fillTimer = null;
    this._store = store;
    this._onTabRemoved = async (removedTabId: number) => {
      await this._handleWarmTabRemoved(removedTabId);
    };
    this._init();
  }

  _init() {
    browser.tabs.onRemoved.addListener(this._onTabRemoved);
    const browserAny = browser as any;
    console.info(`${WARM_LOG_PREFIX} init`, {
      engine: this._engine,
      hasTabsGroup: typeof browserAny.tabs?.group === 'function',
      hasTabGroupsUpdate: typeof browserAny.tabGroups?.update === 'function',
      hasTabGroupsQuery: typeof browserAny.tabGroups?.query === 'function',
    });
  }

  _scheduleEnsureReady(delayMs = FILL_DELAY_MS) {
    if (this._isDisposed) {
      return;
    }
    if (this._fillTimer) {
      clearTimeout(this._fillTimer);
    }

    this._fillTimer = setTimeout(() => {
      this._fillTimer = null;
      console.info(`${WARM_LOG_PREFIX} retry ensureReady`, { delayMs });
      void this.requestEnsureReady();
    }, delayMs);
  }

  async _handleWarmTabRemoved(removedTabId: number) {
    const removedWarmItem = this._removeWarmItemByTabId(removedTabId);
    const stored = await this._getStoredWarmItem();
    const removedStoredItem = stored?.tabId === removedTabId;

    if (removedStoredItem) {
      await this._store.clear();
    }

    if (removedWarmItem || removedStoredItem) {
      this.setWarmState('recovering');
      this._scheduleEnsureReady();
    }
  }

  _removeWarmItemByTabId(tabId: number) {
    if (this.warmItem?.tabId !== tabId) {
      return false;
    }

    this.clearInMemoryWarmItem();
    return true;
  }

  async _getStoredWarmItem() {
    if (this.warmItem) {
      return this.warmItem;
    }

    const stored = await this._store.get('chrome-warm-tab');
    if (!stored) {
      return null;
    }

    try {
      const tab = await browser.tabs.get(stored.tabId);
      return { tabId: stored.tabId, windowId: tab.windowId ?? stored.windowId ?? null };
    } catch {
      this._removeWarmItemByTabId(stored.tabId);
      await this._store.clear();
      return null;
    }
  }

  async _hideWarmTabViaGroup(tabId: number) {
    const browserAny = browser as any;
    if (typeof browserAny.tabs?.group !== 'function' || typeof browserAny.tabGroups?.update !== 'function') {
      console.warn(`${WARM_LOG_PREFIX} grouping api unavailable`, {
        tabId,
        hasTabsGroup: typeof browserAny.tabs?.group === 'function',
        hasTabGroupsUpdate: typeof browserAny.tabGroups?.update === 'function',
      });
      return null;
    }

    for (const delayMs of GROUP_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const tab = await browser.tabs.get(tabId) as BrowserTab;
        let groupId: number | null = null;
        console.info(`${WARM_LOG_PREFIX} try group`, { tabId, delayMs, windowId: tab.windowId });
        if (typeof browserAny.tabGroups?.query === 'function' && typeof tab.windowId === 'number') {
          try {
            const groups = await browserAny.tabGroups.query({
              windowId: tab.windowId,
              title: WARM_TAB_GROUP_TITLE,
            });
            console.info(`${WARM_LOG_PREFIX} queried groups`, { tabId, count: groups.length });
            const existing = groups.find(group => typeof group.id === 'number') ?? null;
            if (existing && typeof existing.id === 'number') {
              groupId = await browserAny.tabs.group({ groupId: existing.id, tabIds: tabId });
              console.info(`${WARM_LOG_PREFIX} joined existing group`, { tabId, groupId });
            }
          } catch {
            console.warn(`${WARM_LOG_PREFIX} tabGroups.query failed; fallback to new group`, { tabId });
          }
        }
        if (typeof groupId !== 'number') {
          groupId = await browserAny.tabs.group({ tabIds: tabId });
          console.info(`${WARM_LOG_PREFIX} created new group`, { tabId, groupId });
        }
        await browserAny.tabGroups.update(groupId, {
          collapsed: true,
          title: WARM_TAB_GROUP_TITLE,
        });
        console.info(`${WARM_LOG_PREFIX} updated group`, { tabId, groupId, collapsed: true, title: WARM_TAB_GROUP_TITLE });
        return groupId;
      } catch {
        console.warn(`${WARM_LOG_PREFIX} grouping attempt failed`, { tabId, delayMs });
      }
    }

    console.error(`${WARM_LOG_PREFIX} grouping failed after retries`, { tabId });
    return null;
  }

  async _moveWarmGroupToFront(tabId: number, groupId: number | null) {
    const browserAny = browser as any;
    if (typeof browser.tabs.move !== 'function') {
      return;
    }

    try {
      if (typeof groupId === 'number' && typeof browserAny.tabGroups?.move === 'function') {
        await browserAny.tabGroups.move(groupId, { index: 0 });
        return;
      }

      if (typeof groupId === 'number' && typeof browserAny.tabs?.query === 'function') {
        const groupedTabs = await browserAny.tabs.query({ groupId });
        const groupedTabIds = groupedTabs
          .filter((tab: BrowserTab) => typeof tab.id === 'number')
          .sort((a: BrowserTab, b: BrowserTab) => (a.index ?? 0) - (b.index ?? 0))
          .map((tab: BrowserTab) => tab.id as number);
        if (groupedTabIds.length > 0) {
          await browser.tabs.move(groupedTabIds, { index: 0 });
          return;
        }
      }

      await browser.tabs.move(tabId, { index: 0 });
    } catch {
      // best effort: keep warm flow working even if move fails
    }
  }

  async _ensureWarmTabGrouped(tabId: number) {
    const groupId = await this._hideWarmTabViaGroup(tabId);
    await this._moveWarmGroupToFront(tabId, groupId);
    console.info(`${WARM_LOG_PREFIX} ensure grouped finished`, { tabId, groupId });
  }

  async _ungroupWarmTab(tabId: number) {
    const browserAny = browser as any;
    if (typeof browserAny.tabs?.ungroup !== 'function') {
      return;
    }

    try {
      await browserAny.tabs.ungroup(tabId);
    } catch {
      // best effort: ungroup should not block warm flow
    }
  }

  async _createWarmTab() {
    if (this._isDisposed || this._isCreating) return;

    this._isCreating = true;
    try {
      const stored = await this._getStoredWarmItem();
      if (stored) {
        await this._ensureWarmTabGrouped(stored.tabId);
        await this.setWarmItem(stored);
        return;
      }

      const windows = await getWindows();
      const targetWindow = windows.find((w) => w.focused) || windows[0] || null;
      if (!targetWindow?.id || typeof browser.tabs.create !== 'function') {
        console.warn(`${WARM_LOG_PREFIX} no target normal window; schedule retry`);
        this._scheduleEnsureReady(500);
        return;
      }

      let tab: BrowserTab | null = null;
      tab = await browser.tabs.create({
        url: getEngineHomeUrl(this._engine),
        active: false,
        windowId: targetWindow.id,
        index: 0,
      });
      console.info(`${WARM_LOG_PREFIX} created warm tab`, { tabId: tab?.id, windowId: tab?.windowId, engine: this._engine });

      if (!tab?.id) {
        console.warn(`${WARM_LOG_PREFIX} created tab missing id; schedule retry`);
        this._scheduleEnsureReady(500);
        return;
      }

      await this._ensureWarmTabGrouped(tab.id);

      const isReady = await waitForEngineTabReadyState(this._engine, tab.id);
      if (!isReady) {
        console.warn(`${WARM_LOG_PREFIX} tab not ready in time; removing`, { tabId: tab.id, engine: this._engine });
        clearTabReadyStateByEngine(this._engine, tab.id);
        try {
          await browser.tabs.remove(tab.id);
        } catch {
          // noop
        }
        return;
      }

      await this.setWarmItem({ tabId: tab.id, windowId: tab.windowId ?? null });
      console.info(`${WARM_LOG_PREFIX} warm tab ready`, { tabId: tab.id, windowId: tab.windowId, engine: this._engine });
    } finally {
      this._isCreating = false;
    }
  }

  protected async ensureFilled() {
    if (this._isDisposed || this._isCreating) return;
    if (this.warmItem) return;

    const stored = await this._getStoredWarmItem();
    if (stored) {
      console.info(`${WARM_LOG_PREFIX} restore stored warm tab`, { tabId: stored.tabId, windowId: stored.windowId });
      await this._ensureWarmTabGrouped(stored.tabId);
      await this.setWarmItem(stored);
      return;
    }

    await this._createWarmTab();
  }

  protected async consumeWarmItem(item: WarmItem) {
    let tab: BrowserTab;
    try {
      tab = await browser.tabs.get(item.tabId);
    } catch {
      await this._store.clear();
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return null;
    }

    await this._store.clear();

    try {
      await this._ungroupWarmTab(item.tabId);
      if (typeof browser.tabs.move === 'function') {
        await browser.tabs.move(item.tabId, { index: -1 });
      }
      await activateTab(item.tabId);
      if (typeof tab.windowId === 'number') {
        await focusWindow(tab.windowId);
      }
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return { tabId: item.tabId, windowId: tab.windowId ?? null };
    } catch {
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return null;
    }
  }

  protected async persistWarmItem(item: WarmItem) {
    await this._store.set({
      kind: 'chrome-warm-tab',
      tabId: item.tabId,
      windowId: item.windowId,
    });
  }

  async close() {
    if (this._fillTimer) {
      clearTimeout(this._fillTimer);
      this._fillTimer = null;
    }
    const item = await this._getStoredWarmItem();
    if (typeof item?.tabId === 'number') {
      console.info(`${WARM_LOG_PREFIX} close warm tab`, { tabId: item.tabId });
      try {
        await browser.tabs.remove(item.tabId);
      } catch {
        // noop
      }
    }
    this.clearInMemoryWarmItem();
    await this._store.clear();
    this.setWarmState('idle');
  }

  async dispose() {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    browser.tabs.onRemoved.removeListener(this._onTabRemoved);
    await this.close();
  }
}

export { ChromeWarmTabProvider };
