import { DEFAULT_AI_ENGINE, DEFAULT_ENGINE_WARMUP, getDefaultWarmupForEngine } from '../../shared/constants';
import type { AIEngine, RuleConfig } from '../../shared/types';
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

type WarmProviderFactory = (engine: AIEngine, capabilities: WarmCapabilities) => WarmProvider;

function createWarmProvider(
  engine: AIEngine,
  capabilities: WarmCapabilities = {
    isChrome: IS_CHROME,
    isFirefox: IS_FIREFOX,
    canHideTabs: CAN_HIDE_TABS,
  },
): WarmProvider {
  if (capabilities.isChrome) {
    return new ChromeWarmTabProvider(engine);
  }

  if (capabilities.isFirefox && capabilities.canHideTabs) {
    return new FirefoxHiddenTabWarmProvider(engine);
  }

  return new NoopWarmProvider();
}

class WarmService {
  private _provider: WarmProvider;
  private _providerFactory: WarmProviderFactory;
  private _capabilities: WarmCapabilities;
  private _engine: AIEngine;
  private _warmupEnabled: boolean;
  private _syncChain: Promise<void>;

  constructor(
    providerFactory: WarmProviderFactory = createWarmProvider,
    capabilities: WarmCapabilities = {
      isChrome: IS_CHROME,
      isFirefox: IS_FIREFOX,
      canHideTabs: CAN_HIDE_TABS,
    },
  ) {
    this._providerFactory = providerFactory;
    this._capabilities = capabilities;
    this._engine = DEFAULT_AI_ENGINE;
    this._warmupEnabled = DEFAULT_ENGINE_WARMUP.gemini;
    this._provider = this._providerFactory(this._engine, this._capabilities);
    this._syncChain = Promise.resolve();
  }

  async syncConfig(config: RuleConfig) {
    const run = this._syncChain.catch(() => undefined).then(async () => {
      const engine = config.ai.engine;
      const warmupEnabled = typeof config.ai.warmup[engine] === 'boolean'
        ? config.ai.warmup[engine]
        : getDefaultWarmupForEngine(engine);

      if (engine !== this._engine) {
        await this._provider.dispose();
        this._engine = engine;
        this._provider = this._providerFactory(this._engine, this._capabilities);
      }

      this._warmupEnabled = warmupEnabled;

      if (!this._warmupEnabled) {
        await this._provider.close();
        return;
      }

      await this._provider.ensureReady();
    });
    this._syncChain = run;
    await run;
  }

  async ensureReady() {
    if (!this._warmupEnabled) {
      return;
    }
    await this._provider.ensureReady();
  }

  async acquire(timeoutMs?: number): Promise<WarmItem | null> {
    if (!this._warmupEnabled) {
      return null;
    }
    return this._provider.acquire(timeoutMs);
  }

  async shutdown() {
    await this._provider.dispose();
  }

  get engine(): AIEngine {
    return this._engine;
  }

  get warmupEnabled(): boolean {
    return this._warmupEnabled;
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
