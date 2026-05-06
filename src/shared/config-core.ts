import { DEFAULT_AI_ENGINE, DEFAULT_ENGINE_WARMUP, DEFAULT_PROMPT, getDefaultWarmupForEngine } from './constants';
import type { AiConfig, AIEngine, EngineWarmupConfig, RuleConfig, RuleGroup } from './types';

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function isDefaultGroup(group?: RuleGroup): boolean {
  return group?.isDefault === true;
}

export function createDefaultGroup(): RuleGroup {
  return {
    id: generateId(),
    prompt: DEFAULT_PROMPT,
    isDefault: true,
    cssSelector: '',
    rules: [],
  };
}

export function createDefaultAiConfig(): AiConfig {
  return {
    engine: DEFAULT_AI_ENGINE,
    warmup: { ...DEFAULT_ENGINE_WARMUP },
  };
}

function normalizeEngine(engine: unknown): AIEngine {
  if (typeof engine !== 'string') {
    return DEFAULT_AI_ENGINE;
  }

  const normalized = engine.trim();
  return normalized || DEFAULT_AI_ENGINE;
}

function normalizeWarmup(warmup: unknown): EngineWarmupConfig {
  const source = typeof warmup === 'object' && warmup !== null
    ? warmup as Record<string, unknown>
    : {};

  const normalized: EngineWarmupConfig = {};
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

export function normalizeConfig(config: unknown): RuleConfig {
  if (Array.isArray(config)) {
    return {
      ai: createDefaultAiConfig(),
      ruleGroups: [createDefaultGroup()],
    };
  }

  if (typeof config === 'object' && config !== null) {
    const sourceConfig = config as Partial<RuleConfig> & {
      engine?: unknown;
      warmup?: unknown;
    };
    const source = sourceConfig.ruleGroups ?? [];
    const groups: RuleGroup[] = source.map((group) => ({
      ...group,
      cssSelector: group.cssSelector || '',
      rules: (group.rules || []).map((rule) => ({
        id: rule.id || generateId(),
        urlPattern: rule.urlPattern || '',
        cssSelector: rule.cssSelector || '',
      })),
    }));

    if (!groups.some(isDefaultGroup)) {
      groups.push(createDefaultGroup());
    }

    const sourceAi = typeof sourceConfig.ai === 'object' && sourceConfig.ai !== null
      ? sourceConfig.ai
      : null;

    const engine = normalizeEngine(sourceAi?.engine ?? sourceConfig.engine);
    const warmup = normalizeWarmup(sourceAi?.warmup ?? sourceConfig.warmup);
    if (typeof warmup[engine] !== 'boolean') {
      warmup[engine] = getDefaultWarmupForEngine(engine);
    }

    return {
      ai: {
        engine,
        warmup,
      },
      ruleGroups: groups,
    };
  }

  return {
    ai: createDefaultAiConfig(),
    ruleGroups: [createDefaultGroup()],
  };
}
