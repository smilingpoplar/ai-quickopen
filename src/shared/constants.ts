import type { AIEngine } from './types';

export const DEFAULT_PROMPT = '请总结';

const ENGINE_PROFILES = {
  gemini: {
    label: 'Gemini',
  },
  grok: {
    label: 'Grok',
  },
} as const;

type EngineProfile = typeof ENGINE_PROFILES[keyof typeof ENGINE_PROFILES];

export const AI_ENGINES = Object.keys(ENGINE_PROFILES) as Array<AIEngine>;

export const DEFAULT_AI_ENGINE: AIEngine = 'gemini';

export const DEFAULT_ENGINE_WARMUP: Record<string, boolean> = {
  gemini: true,
  grok: false,
};

function getEngineProfile(engine: AIEngine): EngineProfile {
  if (engine in ENGINE_PROFILES) {
    return ENGINE_PROFILES[engine as keyof typeof ENGINE_PROFILES];
  }

  // Unknown engines fall back to the generic label profile.
  return ENGINE_PROFILES.grok;
}

export function getDefaultWarmupForEngine(engine: AIEngine): boolean {
  if (typeof DEFAULT_ENGINE_WARMUP[engine] === 'boolean') {
    return DEFAULT_ENGINE_WARMUP[engine];
  }
  return false;
}

export function getEngineLabel(engine: AIEngine): string {
  if (engine in ENGINE_PROFILES) {
    return getEngineProfile(engine).label;
  }

  return String(engine);
}

export const AI_ENGINE_LABELS: Record<string, string> = {
  gemini: ENGINE_PROFILES.gemini.label,
  grok: ENGINE_PROFILES.grok.label,
};
