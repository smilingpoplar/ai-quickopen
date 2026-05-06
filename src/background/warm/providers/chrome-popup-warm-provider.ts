import {
  FILL_DELAY_MS,
  GEMINI_URL,
  STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL,
  WINDOW_ID_NONE,
} from '../../constants';
import {
  activateTab,
  createWindow,
  focusWindow,
  getWindows,
  moveTab,
  removeWindow,
} from '../../window-utils';
import {
  clearGeminiReadyState,
  installGeminiReadyTracker,
  waitForGeminiTabReadyState,
} from '../../gemini-ready-tracker';
import { WarmResourceStore } from '../warm-resource-store';
import type { WarmItem } from '../types';
import { BaseWarmProvider } from './base-warm-provider';

const FOCUS_CHANGE_RECHECK_DELAY_MS = 150;

class ChromePopupWarmProvider extends BaseWarmProvider {
  private _isCreating: boolean;
  private _isEnsuringOnScreenWindow: boolean;
  private _isWaitingForOnScreenWindow: boolean;
  private _suppressWarmPopupActivationUntil: number;
  private _fillTimer: ReturnType<typeof setTimeout> | null;
  private _focusRecheckTimer: ReturnType<typeof setTimeout> | null;
  private _focusRecheckSeq: number;
  private _store: WarmResourceStore;

  constructor(store = new WarmResourceStore()) {
    super();
    installGeminiReadyTracker();
    this._isCreating = false;
    this._isEnsuringOnScreenWindow = false;
    this._isWaitingForOnScreenWindow = false;
    this._suppressWarmPopupActivationUntil = 0;
    this._fillTimer = null;
    this._focusRecheckTimer = null;
    this._focusRecheckSeq = 0;
    this._store = store;
    this._init();
  }

  _init() {
    browser.tabs.onRemoved.addListener(async (removedTabId) => {
      await this._handleWarmSurfaceRemoved({ removedTabId });
    });

    browser.windows.onRemoved.addListener(async (removedWindowId) => {
      await this._handleWarmSurfaceRemoved({ removedWindowId });
    });

    browser.windows.onFocusChanged.addListener(async (windowId) => {
      await this._handleFocusChanged(windowId);
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

  async _setWarmPopupSuppressionUntil(until: number) {
    this._suppressWarmPopupActivationUntil = until;
    const payload = { [STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL]: until };
    try {
      await browser.storage.session.set(payload);
    } catch {
      // noop
    }
  }

  async _clearWarmPopupSuppression() {
    this._suppressWarmPopupActivationUntil = 0;
    try {
      await browser.storage.session.remove(STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL);
    } catch {
      // fall through
    }

    try {
      await browser.storage.local.remove(STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL);
    } catch {
      // noop
    }
  }

  _normalizeSuppressionUntil(value: unknown) {
    if (typeof value !== 'number') return 0;
    return Number.isFinite(value) ? value : 0;
  }

  async _getWarmPopupSuppressionUntil() {
    const now = Date.now();
    if (this._suppressWarmPopupActivationUntil > now) {
      return this._suppressWarmPopupActivationUntil;
    }

    try {
      const sessionResult = await browser.storage.session.get(STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL);
      const sessionUntil = this._normalizeSuppressionUntil(sessionResult[STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL]);
      if (sessionUntil > now) {
        this._suppressWarmPopupActivationUntil = sessionUntil;
        return sessionUntil;
      }
    } catch {
      // fall through
    }

    try {
      const localResult = await browser.storage.local.get(STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL);
      const localUntil = this._normalizeSuppressionUntil(localResult[STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL]);
      if (localUntil > now) {
        this._suppressWarmPopupActivationUntil = localUntil;
        return localUntil;
      }
    } catch {
      // noop
    }

    this._suppressWarmPopupActivationUntil = 0;
    return 0;
  }

  _scheduleEnsureOnScreenWindowFromFocusChange(delayMs = FOCUS_CHANGE_RECHECK_DELAY_MS) {
    const seq = ++this._focusRecheckSeq;
    if (this._focusRecheckTimer) {
      clearTimeout(this._focusRecheckTimer);
    }

    this._focusRecheckTimer = setTimeout(() => {
      this._focusRecheckTimer = null;
      void (async () => {
        if (seq !== this._focusRecheckSeq) return;
        if (!this._isWaitingForOnScreenWindow) return;

        const hasOnScreenWindows = await this._hasOnScreenWindows();
        if (hasOnScreenWindows) {
          this._isWaitingForOnScreenWindow = false;
          await this._clearWarmPopupSuppression();
          return;
        }

        const suppressUntil = await this._getWarmPopupSuppressionUntil();
        if (Date.now() < suppressUntil) {
          return;
        }

        void this._ensureOnScreenWindowFromActivation();
      })();
    }, delayMs);
  }

  _removeWarmItemByTabId(tabId: number) {
    if (this.warmItem?.tabId !== tabId) {
      return false;
    }

    this.clearInMemoryWarmItem();
    return true;
  }

  _removeWarmItemByWindowId(windowId: number) {
    if (this.warmItem?.windowId !== windowId) {
      return false;
    }

    this.clearInMemoryWarmItem();
    return true;
  }

  async _handleWarmSurfaceRemoved({
    removedTabId,
    removedWindowId,
  }: {
    removedTabId?: number;
    removedWindowId?: number;
  }) {
    const removedWarmItem = typeof removedTabId === 'number'
      ? this._removeWarmItemByTabId(removedTabId)
      : typeof removedWindowId === 'number'
        ? this._removeWarmItemByWindowId(removedWindowId)
        : false;

    const stored = await this._getStoredWarmItem();
    const removedStoredItem = (typeof removedTabId === 'number' && stored?.tabId === removedTabId)
      || (typeof removedWindowId === 'number' && stored?.windowId === removedWindowId);

    if (removedStoredItem) {
      await this._store.clear();
    }

    const hasWindows = await this._hasOnScreenWindows();
    if (!hasWindows) {
      this._isWaitingForOnScreenWindow = true;
      await this._setWarmPopupSuppressionUntil(Date.now() + 800);
      this._scheduleEnsureReady(0);
      return;
    }

    if (removedWarmItem || removedStoredItem) {
      this.setWarmState('recovering');
      this._scheduleEnsureReady();
    }
  }

  async _handleFocusChanged(windowId: number) {
    if (windowId === WINDOW_ID_NONE) {
      return;
    }

    const hasOnScreenWindows = await this._hasOnScreenWindows();
    if (hasOnScreenWindows) {
      this._isWaitingForOnScreenWindow = false;
      await this._clearWarmPopupSuppression();
      return;
    }

    const isWarmPopup = await this._isWarmPopupWindow(windowId);
    const suppressUntil = await this._getWarmPopupSuppressionUntil();
    if (isWarmPopup && Date.now() < suppressUntil) {
      return;
    }
    if (!isWarmPopup && !this._isWaitingForOnScreenWindow) {
      return;
    }

    this._isWaitingForOnScreenWindow = true;
    await this._clearWarmPopupSuppression();
    this._scheduleEnsureOnScreenWindowFromFocusChange();
  }

  async _hasOnScreenWindows() {
    const windows = await getWindows();
    return windows.length > 0;
  }

  async _findWarmPopupItems() {
    try {
      const popupWindows = await browser.windows.getAll({
        populate: true,
        windowTypes: ['popup']
      });

      return popupWindows
        .map((windowInfo) => {
          const firstTab = windowInfo.tabs?.[0];
          const tabUrl = firstTab?.url || '';
          const isGeminiTab = tabUrl.startsWith(GEMINI_URL);
          const isOffscreenShape = (windowInfo.left ?? 0) === 10000
            && (windowInfo.top ?? 0) === 10000;
          const tabId = firstTab?.id;
          const windowId = windowInfo.id;

          if (!isGeminiTab || !isOffscreenShape) return null;
          if (typeof tabId !== 'number' || typeof windowId !== 'number') return null;
          return { tabId, windowId };
        })
        .filter(item => item !== null);
    } catch {
      return [];
    }
  }

  async _isWarmPopupWindow(windowId: number) {
    if (typeof windowId !== 'number') return false;

    if (this.warmItem?.windowId === windowId) return true;

    const stored = await this._getStoredWarmItem();
    if (stored?.windowId === windowId) return true;

    const warmItems = await this._findWarmPopupItems();
    return warmItems.some(item => item.windowId === windowId);
  }

  async _adoptExistingWarmPopupIfAny() {
    const warmItems = await this._findWarmPopupItems();
    if (warmItems.length === 0) return null;
    const [keepItem, ...redundantItems] = warmItems;

    for (const item of redundantItems) {
      await removeWindow(item.windowId);
    }

    this.clearInMemoryWarmItem();
    await this._store.clear();
    await this.setWarmItem(keepItem);
    return keepItem;
  }

  async _getStoredWarmItem() {
    if (this.warmItem) {
      return this.warmItem;
    }

    const stored = await this._store.get('chrome-popup');
    if (!stored || stored.windowId === null) {
      return null;
    }

    try {
      await browser.tabs.get(stored.tabId);
      await browser.windows.get(stored.windowId);
      return { tabId: stored.tabId, windowId: stored.windowId };
    } catch {
      this._removeWarmItemByTabId(stored.tabId);
      await this._store.clear();
      return null;
    }
  }

  async _ensureOnScreenWindowFromActivation() {
    if (this._isEnsuringOnScreenWindow) return;
    if (!this._isWaitingForOnScreenWindow) return;

    this._isEnsuringOnScreenWindow = true;
    try {
      const hasWindows = await this._hasOnScreenWindows();
      if (hasWindows) {
        this._isWaitingForOnScreenWindow = false;
        this.setWarmState('recovering');
        this._scheduleEnsureReady(0);
        return;
      }

      const stored = await this._getStoredWarmItem();
      if (!stored) {
        await this.requestEnsureReady();
      }

      await createWindow({ type: 'normal', focused: true, state: 'maximized' });
      this._isWaitingForOnScreenWindow = (await getWindows()).length === 0;
      this.setWarmState('recovering');
      this._scheduleEnsureReady();
    } finally {
      this._isEnsuringOnScreenWindow = false;
    }
  }

  protected async ensureFilled() {
    if (this._isCreating) return;

    const hasOnScreenWindows = await this._hasOnScreenWindows();
    this._isWaitingForOnScreenWindow = !hasOnScreenWindows;

    if (this.warmItem) return;

    const adoptedItem = await this._adoptExistingWarmPopupIfAny();
    if (adoptedItem) return;

    const stored = await this._getStoredWarmItem();
    if (stored) {
      await this.setWarmItem(stored);
      return;
    }

    await this._createPopupWindow();
  }

  protected async consumeWarmItem(item: WarmItem) {
    try {
      await browser.tabs.get(item.tabId);
    } catch {
      if (item.windowId) {
        await removeWindow(item.windowId);
      }
      await this._store.clear();
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return null;
    }

    await this._store.clear();

    try {
      const windows = await getWindows();
      const targetWindow = windows.find(w => w.id !== item.windowId && w.focused)
        || windows.find(w => w.id !== item.windowId)
        || null;

      if (!targetWindow || typeof targetWindow.id !== 'number') {
        const createdWindow = await createWindow({
          tabId: item.tabId,
          type: 'normal',
          focused: true,
          state: 'maximized'
        });

        if (item.windowId && item.windowId !== createdWindow.id) {
          await removeWindow(item.windowId);
        }

        this._isWaitingForOnScreenWindow = (await getWindows()).length === 0;
        this.setWarmState('recovering');
        this._scheduleEnsureReady(100);
        return { tabId: item.tabId, windowId: createdWindow.id || null };
      }

      await moveTab(item.tabId, targetWindow.id);
      await activateTab(item.tabId);
      await focusWindow(targetWindow.id);

      if (item.windowId !== targetWindow.id) {
        await removeWindow(item.windowId);
      }

      this._isWaitingForOnScreenWindow = (await getWindows()).length === 0;
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return { tabId: item.tabId, windowId: targetWindow.id };
    } catch {
      if (item.windowId) {
        await removeWindow(item.windowId);
      }
      this.setWarmState('recovering');
      this._scheduleEnsureReady(100);
      return null;
    }
  }

  protected async persistWarmItem(item: WarmItem) {
    await this._store.set({
      kind: 'chrome-popup',
      tabId: item.tabId,
      windowId: item.windowId,
    });
  }

  async _createPopupWindow() {
    if (this._isCreating) return;

    this._isCreating = true;
    try {
      const stored = await this._getStoredWarmItem();
      if (stored) {
        await this.setWarmItem(stored);
        return;
      }

      const adoptedItem = await this._adoptExistingWarmPopupIfAny();
      if (adoptedItem) {
        return;
      }

      const win = await createWindow({
        url: GEMINI_URL,
        type: 'popup',
        left: 10000,
        top: 10000,
        width: 1,
        height: 1,
        focused: false
      });

      const tab = win.tabs?.[0];
      if (!tab?.id || !win.id) {
        return;
      }

      const isReady = await waitForGeminiTabReadyState(tab.id);
      if (!isReady) {
        clearGeminiReadyState(tab.id);
        await removeWindow(win.id);
        return;
      }

      await this.setWarmItem({ tabId: tab.id, windowId: win.id });
    } finally {
      this._isCreating = false;
    }
  }
}

export { ChromePopupWarmProvider };
