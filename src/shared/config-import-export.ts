import yaml from 'js-yaml';
import { DEFAULT_ENGINE_WARMUP, DEFAULT_PROMPT, getDefaultWarmupForEngine } from './constants';
import { createDefaultAiConfig, generateId } from './config-core';
import type { AIEngine, RuleConfig, RuleGroup } from './types';

export function exportToYaml(config: RuleConfig): string {
  const customGroups = config.ruleGroups.filter((group) => !group.isDefault);

  const exportData = {
    ai: {
      engine: config.ai.engine,
      warmup: { ...config.ai.warmup },
    },
    ruleGroups: customGroups
      .map((group) => ({
        prompt: group.prompt,
        rules: group.rules
          .map((rule) => ({
            urlPattern: rule.urlPattern,
            cssSelector: rule.cssSelector || undefined,
          }))
          .filter((rule) => rule.urlPattern),
      }))
      .filter((group) => group.rules.length > 0 || group.prompt),
  };

  return yaml.dump(exportData, { indent: 2, lineWidth: -1 });
}

function normalizeImportedEngine(engine: unknown): AIEngine {
  if (typeof engine !== 'string') {
    return 'gemini';
  }

  const normalized = engine.trim();
  return normalized || 'gemini';
}

function normalizeImportedWarmup(warmup: unknown) {
  const source = typeof warmup === 'object' && warmup !== null
    ? warmup as Record<string, unknown>
    : {};

  const normalized: Record<string, boolean> = {};
  for (const [engine, value] of Object.entries(source)) {
    if (typeof value === 'boolean') {
      normalized[engine] = value;
    }
  }

  if (typeof normalized.gemini !== 'boolean') {
    normalized.gemini = DEFAULT_ENGINE_WARMUP.gemini;
  }
  if (typeof normalized.grok !== 'boolean') {
    normalized.grok = DEFAULT_ENGINE_WARMUP.grok;
  }

  return normalized;
}

export function importFromYaml(yamlString: string): RuleConfig {
  const data = yaml.load(yamlString);

  if (!data || typeof data !== 'object' || !Array.isArray((data as RuleConfig).ruleGroups)) {
    throw new Error('无效的 YAML 格式');
  }

  const raw = data as {
    ai?: {
      engine?: unknown;
      warmup?: unknown;
    };
    ruleGroups: RuleGroup[];
  };

  const importedAi = raw.ai;
  const fallbackAi = createDefaultAiConfig();
  const engine = normalizeImportedEngine(importedAi?.engine ?? fallbackAi.engine);
  const warmup = normalizeImportedWarmup(importedAi?.warmup ?? fallbackAi.warmup);
  if (typeof warmup[engine] !== 'boolean') {
    warmup[engine] = getDefaultWarmupForEngine(engine);
  }

  return {
    ai: {
      engine,
      warmup,
    },
    ruleGroups: raw.ruleGroups.map((group) => ({
      id: generateId(),
      prompt: group.prompt || DEFAULT_PROMPT,
      cssSelector: group.cssSelector || '',
      rules: (group.rules || []).map((rule) => ({
        id: generateId(),
        urlPattern: rule.urlPattern || '',
        cssSelector: rule.cssSelector || '',
      })),
    })),
  };
}

export function downloadYaml(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
}

export function selectYamlFile(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml';

    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        reject(new Error('未选择文件'));
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => resolve(String(loadEvent.target?.result ?? ''));
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsText(file);
    };

    input.onerror = () => reject(new Error('无法打开文件选择器'));
    input.click();
  });
}
