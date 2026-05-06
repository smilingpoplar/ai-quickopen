import { useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { AI_ENGINE_LABELS, AI_ENGINES } from '../../src/shared/constants';
import { useConfig } from './use-config';
import { RuleGroup } from './components/RuleGroup';
import type { AIEngine, RuleGroup as RuleGroupType } from '../../src/shared/types';

export function App() {
  const {
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
  } = useConfig();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<'group' | 'rule' | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  const customGroups = config.ruleGroups.filter(g => !isDefaultGroup(g));
  const defaultGroup = config.ruleGroups.find(g => isDefaultGroup(g));
  const composeOrderedGroups = (groups: RuleGroupType[], fallback?: RuleGroupType) =>
    fallback ? [...groups, fallback] : groups;

  const handleDragStart = (event: any) => {
    const { active } = event;
    const activeGroup = config.ruleGroups.find(g => g.id === active.id);
    if (activeGroup) {
      setActiveId(active.id);
      setActiveType('group');
      return;
    }
    for (const group of config.ruleGroups) {
      const rule = group.rules.find(r => r.id === active.id);
      if (rule) {
        setActiveId(active.id);
        setActiveType('rule');
        setActiveGroupId(group.id);
        return;
      }
    }
  };

  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const handleDragEnd = (event: any) => {
    const { active, over } = event;

    if (!over) {
      setActiveId(null);
      setActiveType(null);
      setActiveGroupId(null);
      return;
    }

    if (activeType === 'group') {
      const oldIndex = customGroups.findIndex(g => g.id === active.id);
      const newIndex = customGroups.findIndex(g => g.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const newOrder = [...customGroups];
        const [removed] = newOrder.splice(oldIndex, 1);
        newOrder.splice(newIndex, 0, removed);
        reorderGroups(composeOrderedGroups(newOrder, defaultGroup));
      }
    } else if (activeType === 'rule' && activeGroupId) {
      const group = config.ruleGroups.find(g => g.id === activeGroupId);
      if (group) {
        const oldIndex = group.rules.findIndex(r => r.id === active.id);
        const newIndex = group.rules.findIndex(r => r.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          const newOrder = [...group.rules];
          const [removed] = newOrder.splice(oldIndex, 1);
          newOrder.splice(newIndex, 0, removed);
          reorderRules(activeGroupId, newOrder);
        }
      }
    }

    setActiveId(null);
    setActiveType(null);
    setActiveGroupId(null);
  };

  const handleAddGroup = () => {
    const newGroupId = addGroup();
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>(`[data-group-id="${newGroupId}"] .url-input`);
      if (input) input.focus();
    }, 50);
  };

  const getActiveGroup = () => {
    if (activeType === 'group') {
      return config.ruleGroups.find(g => g.id === activeId);
    }
    return null;
  };

  if (loading) {
    return (
      <div className="container">
        <div className="loading">加载中...</div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <div className="header-title">
          <h1>设置</h1>
        </div>
        <div className="header-actions">
          <button className="action-btn" onClick={importConfig}>导入</button>
          <button className="action-btn" onClick={exportConfig}>导出</button>
        </div>
      </div>
      <div className="engine-toolbar">
        <div className="engine-card">
          <div className="engine-row">
            <label className="engine-label" htmlFor="engineSelect">默认引擎</label>
            <select
              id="engineSelect"
              className="engine-select"
              value={config.ai.engine}
              onChange={(event) => updateAIEngine(event.target.value as AIEngine)}
            >
              {AI_ENGINES.map((engine) => (
                <option key={engine} value={engine}>
                  {AI_ENGINE_LABELS[engine]}
                </option>
              ))}
            </select>
            <label className="warmup-item engine-inline-warmup">
              <input
                type="checkbox"
                checked={Boolean(config.ai.warmup[config.ai.engine])}
                onChange={(event) => updateEngineWarmup(config.ai.engine, event.target.checked)}
              />
              <span>预热</span>
            </label>
          </div>
        </div>
      </div>
      <p className="rules-title">规则设置</p>
      <p className="subtitle">为不同网址分配提示词和可选 CSS 提取规则</p>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="rules-container" id="rulesContainer">
          {customGroups.length === 0 && !defaultGroup ? (
            <div className="empty-state">暂无规则，点击下方添加</div>
          ) : (
            <SortableContext
              items={customGroups.map(g => g.id)}
              strategy={verticalListSortingStrategy}
            >
              {customGroups.map(group => (
                <RuleGroup
                  key={group.id}
                  group={group}
                  isDefault={false}
                  onUpdateGroup={updateGroup}
                  onUpdateRule={updateRule}
                  onDeleteGroup={deleteGroup}
                  onAddRule={addRule}
                  onDeleteRule={deleteRule}
                />
              ))}
            </SortableContext>
          )}
          {defaultGroup && (
            <RuleGroup
              key={defaultGroup.id}
              group={defaultGroup}
              isDefault={true}
              onUpdateGroup={updateGroup}
              onUpdateRule={updateRule}
              onDeleteGroup={deleteGroup}
              onAddRule={addRule}
              onDeleteRule={deleteRule}
            />
          )}
        </div>
        <DragOverlay>
          {activeId && activeType === 'group' && getActiveGroup() && (
            <div className="prompt-group">
              <div className="group-side-actions">
                <div className="group-drag-handle group-side-drag-handle">⋮⋮</div>
              </div>
              <div className="group-main">
                <div className="group-content" />
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <button className="add-btn" id="addBtn" onClick={handleAddGroup}>
        + 添加规则组
      </button>

      <div className={`status ${status ? 'show' : ''}`} id="status">
        {status}
      </div>
    </div>
  );
}
