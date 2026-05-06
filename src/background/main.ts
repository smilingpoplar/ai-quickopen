import { installEngineReadyTracker } from './engine-ready-tracker';
import { normalizeConfig } from '../shared/config-core';
import { saveConfig, loadConfig } from '../shared/config-storage';
import { warmService } from './warm/warm-service';
import { openAIEngineForCurrentTab, openAIEngineForTab } from './use-cases/open-engine-flow';
import { reuseWarmTabForPrewarmNavigation } from './use-cases/reuse-warm-tab-for-prewarm-navigation';

async function warmOnInstall() {
  const config = await loadConfig();
  await saveConfig(config);
  await warmService.syncConfig(config);
}

async function warmOnStartup() {
  const config = await loadConfig();
  await warmService.syncConfig(config);
}

export async function bootstrapBackground(): Promise<void> {
  installEngineReadyTracker();

  browser.runtime.onInstalled.addListener(() => {
    void warmOnInstall();
  });

  browser.runtime.onStartup.addListener(() => {
    void warmOnStartup();
  });

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.ruleConfig) return;
    const normalized = normalizeConfig(changes.ruleConfig.newValue || { ruleGroups: [] });
    void warmService.syncConfig(normalized);
  });

  // Chrome MV3 uses `action`, while Firefox MV2 uses `browserAction`.
  const actionApi = browser.action ?? browser.browserAction;

  actionApi?.onClicked.addListener(async (tab) => {
    await openAIEngineForTab(tab);
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command === 'open-engine') {
      await openAIEngineForCurrentTab();
    }
  });

  browser.webNavigation.onCommitted.addListener(reuseWarmTabForPrewarmNavigation);

  await warmOnStartup();
}
