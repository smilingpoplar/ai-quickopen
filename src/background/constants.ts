import type { AIEngine } from '../shared/types';
import { DEFAULT_AI_ENGINE } from '../shared/constants';

const KNOWN_ENGINE_HOME_URLS: Record<string, string> = {
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com/',
};

export function resolveEngine(engine: AIEngine): AIEngine {
  if (engine in KNOWN_ENGINE_HOME_URLS) {
    return engine;
  }

  return DEFAULT_AI_ENGINE;
}

export function getEngineHomeUrl(engine: AIEngine): string {
  return KNOWN_ENGINE_HOME_URLS[resolveEngine(engine)];
}

export const GEMINI_URL = KNOWN_ENGINE_HOME_URLS.gemini;

export const IS_CHROME = browser.runtime.getURL('').startsWith('chrome-extension://');
export const IS_FIREFOX = browser.runtime.getURL('').startsWith('moz-extension://');
export const CAN_HIDE_TABS = IS_FIREFOX
  && typeof browser.tabs.hide === 'function'
  && typeof browser.tabs.show === 'function';

export const STORAGE_KEY_TAB = 'prerenderTabId';
export const STORAGE_KEY_WINDOW = 'prerenderWindowId';
export const STORAGE_KEY_KIND = 'prerenderKind';
export const STORAGE_KEY_TAB_PERSIST = 'prerenderTabIdPersist';
export const STORAGE_KEY_WINDOW_PERSIST = 'prerenderWindowIdPersist';
export const STORAGE_KEY_KIND_PERSIST = 'prerenderKindPersist';
export const STORAGE_KEY_ENGINE = 'prerenderEngine';
export const STORAGE_KEY_ENGINE_PERSIST = 'prerenderEnginePersist';
export const STORAGE_KEY_WARM_POPUP_SUPPRESS_UNTIL = 'warmPopupSuppressUntil';

export const WINDOW_ID_NONE = browser.windows?.WINDOW_ID_NONE ?? -1;

export const FILL_DELAY_MS = 2000;
export const DEQUEUE_TIMEOUT_MS = 2000;

export const MESSAGE_MAX_RETRIES = 10;
export const MESSAGE_RETRY_DELAY_MS = 500;
