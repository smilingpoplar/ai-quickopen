import { createDefaultAiConfig, createDefaultGroup, normalizeConfig } from './config-core';
import type { RuleConfig } from './types';

export async function loadConfig(): Promise<RuleConfig> {
  try {
    const result = await browser.storage.sync.get(['ruleConfig']);
    return normalizeConfig(result.ruleConfig || { ruleGroups: [] });
  } catch (error) {
    console.error('Failed to load config:', error);
    return {
      ai: createDefaultAiConfig(),
      ruleGroups: [createDefaultGroup()],
    };
  }
}

export async function saveConfig(config: RuleConfig): Promise<void> {
  try {
    await browser.storage.sync.set({ ruleConfig: config });
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}
