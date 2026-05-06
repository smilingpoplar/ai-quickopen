import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_PROMPT, getEngineLabel } from '../../src/shared/constants';
import { exportToYaml, importFromYaml, downloadYaml, selectYamlFile } from '../../src/shared/config-import-export';
import { createDefaultAiConfig, createDefaultGroup, generateId, isDefaultGroup, normalizeConfig } from '../../src/shared/config-core';
import { saveConfig as persistConfig } from '../../src/shared/config-storage';
import type { AIEngine, Rule, RuleConfig, RuleGroup } from '../../src/shared/types';

export function useConfig() {
  const [config, setConfig] = useState<RuleConfig>({
    ai: createDefaultAiConfig(),
    ruleGroups: [],
  });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const result = await browser.storage.sync.get(['ruleConfig']);
      const normalized = normalizeConfig(result.ruleConfig || { ruleGroups: [] });
      setConfig(normalized);
    } catch (error) {
      console.error('Failed to load config:', error);
      setConfig({
        ai: createDefaultAiConfig(),
        ruleGroups: [createDefaultGroup()],
      });
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = useCallback(async (newConfig: RuleConfig) => {
    await persistConfig(newConfig);
  }, []);

  const showStatus = useCallback((message) => {
    setStatus(message);
    setTimeout(() => setStatus(''), 1500);
  }, []);

  const updateGroup = useCallback((groupId: string, field: keyof RuleGroup, value: string) => {
    setConfig(prev => {
      const newConfig = {
        ...prev,
        ruleGroups: prev.ruleGroups.map(g =>
          g.id === groupId ? { ...g, [field]: value } : g
        )
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, [saveConfig]);

  const updateRule = useCallback((groupId: string, ruleId: string, field: keyof Rule, value: string) => {
    setConfig(prev => {
      const newConfig = {
        ...prev,
        ruleGroups: prev.ruleGroups.map(g => {
          if (g.id !== groupId) return g;
          if (g.isDefault && field === 'cssSelector') {
            return { ...g, cssSelector: value };
          }
          return {
            ...g,
            rules: g.rules.map(r =>
              r.id === ruleId ? { ...r, [field]: value } : r
            )
          };
        })
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, [saveConfig]);

  const addGroup = useCallback(() => {
    const newGroup = {
      id: generateId(),
      prompt: DEFAULT_PROMPT,
      isDefault: false,
      cssSelector: '',
      rules: [{ id: generateId(), urlPattern: '', cssSelector: '' }]
    };
    setConfig(prev => {
      const newConfig = {
        ...prev,
        ruleGroups: [newGroup, ...prev.ruleGroups]
      };
      saveConfig(newConfig);
      showStatus('已添加规则组');
      return newConfig;
    });
    return newGroup.id;
  }, [saveConfig, showStatus]);

  const deleteGroup = useCallback((groupId: string) => {
    setConfig(prev => {
      const group = prev.ruleGroups.find(g => g.id === groupId);
      if (isDefaultGroup(group)) {
        showStatus('默认规则不能删除');
        return prev;
      }
      const newConfig = {
        ...prev,
        ruleGroups: prev.ruleGroups.filter(g => g.id !== groupId)
      };
      saveConfig(newConfig);
      showStatus('已删除');
      return newConfig;
    });
  }, [saveConfig, showStatus]);

  const addRule = useCallback((groupId: string) => {
    setConfig(prev => {
      const newConfig = {
        ...prev,
        ruleGroups: prev.ruleGroups.map(g => {
          if (g.id !== groupId || g.isDefault) return g;
          return {
            ...g,
            rules: [...g.rules, { id: generateId(), urlPattern: '', cssSelector: '' }]
          };
        })
      };
      saveConfig(newConfig);
      return newConfig;
    });
  }, [saveConfig]);

  const deleteRule = useCallback((groupId: string, ruleId: string) => {
    setConfig(prev => {
      const newConfig = {
        ...prev,
        ruleGroups: prev.ruleGroups.map(g => {
          if (g.id !== groupId || g.isDefault) return g;
          return {
            ...g,
            rules: g.rules.filter(r => r.id !== ruleId)
          };
        })
      };
      saveConfig(newConfig);
      showStatus('已删除');
      return newConfig;
    });
  }, [saveConfig, showStatus]);

  const reorderGroups = useCallback((newOrder: RuleGroup[]) => {
    setConfig(prev => {
      const newConfig = { ...prev, ruleGroups: newOrder };
      saveConfig(newConfig);
      showStatus('顺序已更新');
      return newConfig;
    });
  }, [saveConfig, showStatus]);

  const reorderRules = useCallback((groupId: string, newOrder: Rule[]) => {
    setConfig(prev => {
      const newConfig = {
        ...prev,
        ruleGroups: prev.ruleGroups.map(g =>
          g.id === groupId ? { ...g, rules: newOrder } : g
        )
      };
      saveConfig(newConfig);
      showStatus('顺序已更新');
      return newConfig;
    });
  }, [saveConfig, showStatus]);

  const exportConfig = useCallback(() => {
    const yamlContent = exportToYaml(config);
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadYaml(yamlContent, `rule-config-${timestamp}.yaml`);
    showStatus('已导出');
  }, [config, showStatus]);

  const importConfig = useCallback(async () => {
    try {
      const yamlContent = await selectYamlFile();
      const importedConfig = importFromYaml(yamlContent);
      const defaultGroup = config.ruleGroups.find(g => g.isDefault);
      const newConfig = {
        ai: importedConfig.ai,
        ruleGroups: defaultGroup ? [defaultGroup, ...importedConfig.ruleGroups] : importedConfig.ruleGroups,
      };
      await saveConfig(newConfig);
      setConfig(newConfig);
      showStatus('已导入');
    } catch (error) {
      console.error('Import failed:', error);
      showStatus('导入失败');
    }
  }, [config, saveConfig, showStatus]);

  const updateAIEngine = useCallback((engine: AIEngine) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        ai: {
          ...prev.ai,
          engine,
        },
      };
      saveConfig(newConfig);
      showStatus(`已切换到 ${getEngineLabel(engine)}`);
      return newConfig;
    });
  }, [saveConfig, showStatus]);

  const updateEngineWarmup = useCallback((engine: AIEngine, enabled: boolean) => {
    setConfig((prev) => {
      const newConfig = {
        ...prev,
        ai: {
          ...prev.ai,
          warmup: {
            ...prev.ai.warmup,
            [engine]: enabled,
          },
        },
      };
      saveConfig(newConfig);
      showStatus(`${getEngineLabel(engine)} 预热${enabled ? '已开启' : '已关闭'}`);
      return newConfig;
    });
  }, [saveConfig, showStatus]);

  return {
    config,
    loading,
    status,
    isDefaultGroup,
    updateGroup,
    updateRule,
    addGroup,
    deleteGroup,
    addRule,
    deleteRule,
    reorderGroups,
    reorderRules,
    exportConfig,
    importConfig,
    updateAIEngine,
    updateEngineWarmup,
  };
}
