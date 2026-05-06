import {
  STORAGE_KEY_KIND,
  STORAGE_KEY_KIND_PERSIST,
  STORAGE_KEY_TAB,
  STORAGE_KEY_TAB_PERSIST,
  STORAGE_KEY_WINDOW,
  STORAGE_KEY_WINDOW_PERSIST,
} from '../constants';
import type { WarmResourceKind, WarmResourceRecord } from './types';

class WarmResourceStore {
  private _memory: WarmResourceRecord | null;

  constructor() {
    this._memory = null;
  }

  _normalizeRecord(kind: unknown, tabId: unknown, windowId: unknown): WarmResourceRecord | null {
    if (kind !== 'chrome-warm-tab' && kind !== 'firefox-hidden-tab') {
      return null;
    }

    if (typeof tabId !== 'number') {
      return null;
    }

    return {
      kind,
      tabId,
      windowId: typeof windowId === 'number' ? windowId : null,
    };
  }

  _normalizeLegacyRecord(tabId: unknown, windowId: unknown): WarmResourceRecord | null {
    if (typeof tabId !== 'number' || typeof windowId !== 'number') {
      return null;
    }

    return {
      kind: 'chrome-warm-tab',
      tabId,
      windowId,
    };
  }

  async _readFromStorage() {
    const sessionResult = await browser.storage.session.get([
      STORAGE_KEY_KIND,
      STORAGE_KEY_TAB,
      STORAGE_KEY_WINDOW,
    ]);
    const sessionRecord = this._normalizeRecord(
      sessionResult[STORAGE_KEY_KIND],
      sessionResult[STORAGE_KEY_TAB],
      sessionResult[STORAGE_KEY_WINDOW],
    );
    if (sessionRecord) {
      return sessionRecord;
    }

    const localResult = await browser.storage.local.get([
      STORAGE_KEY_KIND_PERSIST,
      STORAGE_KEY_TAB_PERSIST,
      STORAGE_KEY_WINDOW_PERSIST,
    ]);
    const localRecord = this._normalizeRecord(
      localResult[STORAGE_KEY_KIND_PERSIST],
      localResult[STORAGE_KEY_TAB_PERSIST],
      localResult[STORAGE_KEY_WINDOW_PERSIST],
    );
    if (localRecord) {
      return localRecord;
    }

    return this._normalizeLegacyRecord(
      sessionResult[STORAGE_KEY_TAB] ?? localResult[STORAGE_KEY_TAB_PERSIST],
      sessionResult[STORAGE_KEY_WINDOW] ?? localResult[STORAGE_KEY_WINDOW_PERSIST],
    );
  }

  async get(expectedKind?: WarmResourceKind) {
    if (this._memory && (!expectedKind || this._memory.kind === expectedKind)) {
      return this._memory;
    }

    const record = await this._readFromStorage();
    this._memory = record;

    if (!record) {
      return null;
    }

    if (expectedKind && record.kind !== expectedKind) {
      return null;
    }

    await this.set(record);
    return record;
  }

  async set(record: WarmResourceRecord | null) {
    this._memory = record;
    await browser.storage.session.remove([STORAGE_KEY_KIND, STORAGE_KEY_TAB, STORAGE_KEY_WINDOW]);
    await browser.storage.local.remove([STORAGE_KEY_KIND_PERSIST, STORAGE_KEY_TAB_PERSIST, STORAGE_KEY_WINDOW_PERSIST]);

    if (!record) {
      return;
    }

    const sessionData: Record<string, number | string> = {
      [STORAGE_KEY_KIND]: record.kind,
      [STORAGE_KEY_TAB]: record.tabId,
    };
    const localData: Record<string, number | string> = {
      [STORAGE_KEY_KIND_PERSIST]: record.kind,
      [STORAGE_KEY_TAB_PERSIST]: record.tabId,
    };

    if (record.windowId !== null) {
      sessionData[STORAGE_KEY_WINDOW] = record.windowId;
      localData[STORAGE_KEY_WINDOW_PERSIST] = record.windowId;
    }

    await browser.storage.session.set(sessionData);
    await browser.storage.local.set(localData);
  }

  async clear() {
    await this.set(null);
  }
}

export { WarmResourceStore };
