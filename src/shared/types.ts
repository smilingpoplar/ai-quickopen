export type Rule = {
  id: string;
  urlPattern: string;
  cssSelector: string;
};

export type AIEngine = string;

export type EngineWarmupConfig = Record<string, boolean>;

export type AiConfig = {
  engine: AIEngine;
  warmup: EngineWarmupConfig;
};

export type RuleGroup = {
  id: string;
  prompt: string;
  isDefault?: boolean;
  cssSelector?: string;
  rules: Rule[];
};

export type RuleConfig = {
  ai: AiConfig;
  ruleGroups: RuleGroup[];
};

export type MatchedGroup = {
  prompt: string;
  cssSelector: string;
};
