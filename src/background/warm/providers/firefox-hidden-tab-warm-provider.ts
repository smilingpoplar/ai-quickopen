import { FILL_DELAY_MS, getEngineHomeUrl } from '../../constants';
import type { AIEngine } from '../../../shared/types';
import {
  clearTabReadyStateByEngine,
  installEngineReadyTracker,
  waitForEngineTabReadyState,
} from '../../engine-ready-tracker';
import { activateTab, focusWindow } from '../../window-utils';
import { WarmResourceStore } from '../warm-resource-store';
import type { WarmItem } from '../types';
import { BaseWarmProvider } from './base-warm-provider';

class FirefoxHiddenTabWarmProvider extends BaseWarmProvider {
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
      await this._handleWarmSurfaceRemoved(removedTabId);
    };
    this._init();
  }

  _init() {
    browser.tabs.onRemoved.addListener(this._onTabRemoved);
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
      void this.requestEnsureReady();
    }, delayMs);
  }

  _removeWarmItemByTabId(tabId: number) {
    if (this.warmItem?.tabId !== tabId) {
      return false;
    }

    this.clearInMemoryWarmItem();
    return true;
  }

  async _handleWarmSurfaceRemoved(removedTabId: number) {
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

  async _getStoredWarmItem() {
    if (this.warmItem) {
      return this.warmItem;
    }

    const stored = await this._store.get('firefox-hidden-tab');
    if (!stored) {
      return null;
    }

    try {
      await browser.tabs.get(stored.tabId);
      if (typeof stored.windowId === 'number') {
        await browser.windows.get(stored.windowId);
      }
      return { tabId: stored.tabId, windowId: stored.windowId };
    } catch {
      this._removeWarmItemByTabId(stored.tabId);
      await this._store.clear();
      return null;
    }
  }

  protected async ensureFilled() {
    if (this._isDisposed) {
      return;
    }
    if (this.warmItem) {
      return;
    }

    const stored = await this._getStoredWarmItem();
    if (stored) {
      await this.setWarmItem(stored);
      return;
    }

    await this._createHiddenTab();
  }

  protected async consumeWarmItem(item: WarmItem) {
    try {
      await browser.tabs.get(item.tabId);
    } catch {
      await this._store.clear();
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return null;
    }

    await this._store.clear();

    try {
      await browser.tabs.show(item.tabId);
      await activateTab(item.tabId);
      if (typeof item.windowId === 'number') {
        await focusWindow(item.windowId);
      }

      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return item;
    } catch {
      try {
        await browser.tabs.remove(item.tabId);
      } catch {
        // noop
      }
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return null;
    }
  }

  protected async persistWarmItem(item: WarmItem) {
    await this._store.set({
      kind: 'firefox-hidden-tab',
      tabId: item.tabId,
      windowId: item.windowId,
    });
  }

  async _createHiddenTab() {
    if (this._isDisposed || this._isCreating) return;

    this._isCreating = true;
    try {
      const stored = await this._getStoredWarmItem();
      if (stored) {
        await this.setWarmItem(stored);
        return;
      }

      const tab = await browser.tabs.create({ url: getEngineHomeUrl(this._engine), active: false });
      if (!tab?.id) {
        return;
      }

      try {
        await browser.tabs.hide(tab.id);
      } catch {
        await browser.tabs.remove(tab.id);
        await this._store.clear();
        return;
      }

      const isReady = await waitForEngineTabReadyState(this._engine, tab.id);
      if (!isReady) {
        clearTabReadyStateByEngine(this._engine, tab.id);
        await browser.tabs.remove(tab.id);
        await this._store.clear();
        return;
      }

      await this.setWarmItem({ tabId: tab.id, windowId: tab.windowId ?? null });
    } finally {
      this._isCreating = false;
    }
  }

  async close() {
    if (this._fillTimer) {
      clearTimeout(this._fillTimer);
      this._fillTimer = null;
    }
    const item = await this._getStoredWarmItem();
    if (typeof item?.tabId === 'number') {
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

export { FirefoxHiddenTabWarmProvider };
