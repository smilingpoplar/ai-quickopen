import { FILL_DELAY_MS, GEMINI_URL } from '../../constants';
import {
  activateTab,
  focusWindow,
  getWindows,
} from '../../window-utils';
import {
  clearGeminiReadyState,
  installGeminiReadyTracker,
  waitForGeminiTabReadyState,
} from '../../gemini-ready-tracker';
import { WarmResourceStore } from '../warm-resource-store';
import type { WarmItem } from '../types';
import { BaseWarmProvider } from './base-warm-provider';

const WARM_TAB_GROUP_TITLE = 'W';
const GROUP_RETRY_DELAYS_MS = [0, 50, 150];
type BrowserTab = { id?: number; windowId?: number | null; index?: number };

class ChromeWarmTabProvider extends BaseWarmProvider {
  private _isCreating: boolean;
  private _fillTimer: ReturnType<typeof setTimeout> | null;
  private _store: WarmResourceStore;

  constructor(store = new WarmResourceStore()) {
    super();
    installGeminiReadyTracker();
    this._isCreating = false;
    this._fillTimer = null;
    this._store = store;
    this._init();
  }

  _init() {
    browser.tabs.onRemoved.addListener(async (removedTabId) => {
      await this._handleWarmTabRemoved(removedTabId);
    });
  }

  _scheduleEnsureReady(delayMs = FILL_DELAY_MS) {
    if (this._fillTimer) {
      clearTimeout(this._fillTimer);
    }

    this._fillTimer = setTimeout(() => {
      this._fillTimer = null;
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
      return null;
    }

    for (const delayMs of GROUP_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }

      try {
        const tab = await browser.tabs.get(tabId) as BrowserTab;
        let groupId: number | null = null;
        if (typeof browserAny.tabGroups?.query === 'function' && typeof tab.windowId === 'number') {
          const groups = await browserAny.tabGroups.query({
            windowId: tab.windowId,
            title: WARM_TAB_GROUP_TITLE,
          });
          const existing = groups.find(group => typeof group.id === 'number') ?? null;
          if (existing && typeof existing.id === 'number') {
            groupId = await browserAny.tabs.group({ groupId: existing.id, tabIds: tabId });
          }
        }
        if (typeof groupId !== 'number') {
          groupId = await browserAny.tabs.group({ tabIds: tabId });
        }
        await browserAny.tabGroups.update(groupId, {
          collapsed: true,
          title: WARM_TAB_GROUP_TITLE,
        });
        return groupId;
      } catch {
        // retry on transient failures
      }
    }

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
    if (this._isCreating) return;

    this._isCreating = true;
    try {
      const stored = await this._getStoredWarmItem();
      if (stored) {
        await this.setWarmItem(stored);
        return;
      }

      const windows = await getWindows();
      const targetWindow = windows.find((w) => w.focused) || windows[0] || null;
      if (!targetWindow?.id || typeof browser.tabs.create !== 'function') {
        return;
      }

      let tab: BrowserTab | null = null;
      tab = await browser.tabs.create({
        url: GEMINI_URL,
        active: false,
        windowId: targetWindow.id,
        index: 0,
      });

      if (!tab?.id) {
        return;
      }

      const groupId = await this._hideWarmTabViaGroup(tab.id);
      await this._moveWarmGroupToFront(tab.id, groupId);

      const isReady = await waitForGeminiTabReadyState(tab.id);
      if (!isReady) {
        clearGeminiReadyState(tab.id);
        try {
          await browser.tabs.remove(tab.id);
        } catch {
          // noop
        }
        return;
      }

      await this.setWarmItem({ tabId: tab.id, windowId: tab.windowId ?? null });
    } finally {
      this._isCreating = false;
    }
  }

  protected async ensureFilled() {
    if (this._isCreating) return;
    if (this.warmItem) return;

    const stored = await this._getStoredWarmItem();
    if (stored) {
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
}

export { ChromeWarmTabProvider };
