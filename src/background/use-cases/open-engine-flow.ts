import { DEFAULT_PROMPT } from '../../shared/constants';
import { loadConfig } from '../../shared/config-storage';
import { findMatchingGroup } from '../../shared/url-pattern';
import type { AIEngine } from '../../shared/types';
import {
  DEQUEUE_TIMEOUT_MS,
  getEngineHomeUrl,
  MESSAGE_MAX_RETRIES,
  MESSAGE_RETRY_DELAY_MS,
  resolveEngine,
} from '../constants';
import { normalizeContentText, extractTextBySelector } from '../text-extractor';
import { warmService } from '../warm/warm-service';

export async function getCurrentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export async function buildAIQueryText(currentUrl, tabId, matchedResult) {
  const prompt = matchedResult.prompt || DEFAULT_PROMPT;
  const cssSelector = (matchedResult.cssSelector || '').trim();

  if (!cssSelector || typeof tabId !== 'number') {
    return `${currentUrl}\n${prompt}`;
  }

  const extractedText = normalizeContentText(await extractTextBySelector(tabId, cssSelector));
  return `${currentUrl}\n${prompt}\n${extractedText}`;
}

export async function sendQueryToAITab(
  targetTabId,
  queryText,
  attempt = 1,
  engine: AIEngine = 'gemini',
): Promise<boolean> {
  if (typeof targetTabId !== 'number') {
    return false;
  }

  const dispatchEngine = resolveEngine(engine);

  try {
    const response = await browser.tabs.sendMessage(targetTabId, {
      type: 'AI_QUERY',
      engine: dispatchEngine,
      queryText,
    });

    if (!response || response.ok !== true) {
      throw new Error('AI query delivery was not acknowledged');
    }

    return true;
  } catch {
    if (attempt < MESSAGE_MAX_RETRIES) {
      await new Promise(resolve => setTimeout(resolve, MESSAGE_RETRY_DELAY_MS));
      return sendQueryToAITab(targetTabId, queryText, attempt + 1, dispatchEngine);
    }

    return false;
  }
}

async function discardConsumedWarmTab(tabId?: number | null) {
  if (typeof tabId !== 'number') {
    return;
  }

  try {
    await browser.tabs.remove(tabId);
  } catch {
    // noop
  }
}

async function openAITabWithQuery(queryText, engine: AIEngine) {
  const dispatchEngine = resolveEngine(engine);
  const openedTab = await browser.tabs.create({ url: getEngineHomeUrl(dispatchEngine), active: true });
  const openedTabId = openedTab?.id;

  if (queryText && typeof openedTabId === 'number') {
    await sendQueryToAITab(openedTabId, queryText, 1, dispatchEngine);
  }

  return openedTabId;
}

export async function openPrewarmedAI(queryText, engine: AIEngine = 'gemini') {
  const dispatchEngine = resolveEngine(engine);
  const item = await warmService.acquire(DEQUEUE_TIMEOUT_MS);
  const targetTabId = item?.tabId;

  if (typeof targetTabId !== 'number') {
    return openAITabWithQuery(queryText, dispatchEngine);
  }

  if (queryText) {
    const sent = await sendQueryToAITab(targetTabId, queryText, 1, dispatchEngine);
    if (!sent) {
      await discardConsumedWarmTab(targetTabId);
      return openAITabWithQuery(queryText, dispatchEngine);
    }
  }

  return targetTabId;
}

export async function openAIEngineForTab(tab) {
  const resolvedTab = tab?.url ? tab : await getCurrentTab();
  const currentUrl = resolvedTab?.url;
  const tabId = resolvedTab?.id;

  if (!currentUrl || !currentUrl.startsWith('http')) {
    return;
  }

  const config = await loadConfig();
  await warmService.syncConfig(config);
  const engine = config.ai.engine;
  const matchedResult = findMatchingGroup(currentUrl, config);
  const queryText = await buildAIQueryText(currentUrl, tabId, matchedResult);

  await openPrewarmedAI(queryText, engine);
}

export async function openAIEngineForCurrentTab() {
  try {
    const tab = await getCurrentTab();
    await openAIEngineForTab(tab);
  } catch (error) {
    console.error('打开 AI 引擎时出错:', error);
  }
}

export { discardConsumedWarmTab };
