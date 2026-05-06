import { CAN_HIDE_TABS, IS_CHROME, IS_FIREFOX } from '../constants';
import { ChromeWarmTabProvider } from './providers/chrome-warm-tab-provider';
import { FirefoxHiddenTabWarmProvider } from './providers/firefox-hidden-tab-warm-provider';
import { NoopWarmProvider } from './providers/noop-warm-provider';
import type { WarmItem, WarmProvider, WarmState } from './types';

type WarmCapabilities = {
  canHideTabs: boolean;
  isChrome: boolean;
  isFirefox: boolean;
};

function createWarmProvider(
  capabilities: WarmCapabilities = {
    isChrome: IS_CHROME,
    isFirefox: IS_FIREFOX,
    canHideTabs: CAN_HIDE_TABS,
  },
): WarmProvider {
  if (capabilities.isChrome) {
    return new ChromeWarmTabProvider();
  }

  if (capabilities.isFirefox && capabilities.canHideTabs) {
    return new FirefoxHiddenTabWarmProvider();
  }

  return new NoopWarmProvider();
}

class WarmService {
  private _provider: WarmProvider;

  constructor(provider: WarmProvider = createWarmProvider()) {
    this._provider = provider;
  }

  async ensureReady() {
    await this._provider.ensureReady();
  }

  async acquire(timeoutMs?: number): Promise<WarmItem | null> {
    return this._provider.acquire(timeoutMs);
  }

  get state(): WarmState | null {
    if ('state' in this._provider) {
      return (this._provider as WarmProvider & { state?: WarmState }).state ?? null;
    }

    return null;
  }
}

const warmService = new WarmService();

export { WarmService, warmService, createWarmProvider };
