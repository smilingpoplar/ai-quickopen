import { ENGINE_CONTENT_READY } from '../background/engine-ready-tracker';
import type { AIEngine } from '../shared/types';

function detectEngine(hostname: string): AIEngine | null {
  if (hostname === 'gemini.google.com') return 'gemini';
  if (hostname === 'grok.com') return 'grok';
  return null;
}

function getEditorSelector(): string {
  return 'div[contenteditable="true"]';
}

function waitForElement(selector: string, timeout = 10000): Promise<Element> {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (typeof timeout === 'number' && timeout > 0) {
      timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`在 ${timeout}ms 内未找到元素: ${selector}`));
      }, timeout);
    }

    const observer = new MutationObserver(() => {
      const target = document.querySelector(selector);
      if (target) {
        if (timer) clearTimeout(timer);
        observer.disconnect();
        resolve(target);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type EngineActions = {
  simulateInput: (element: Element, value: string) => void;
  simulateEnter: (element: Element) => void;
};

const defaultActions: EngineActions = {
  simulateInput(element: Element, value: string) {
    (element as HTMLElement).textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true }));
  },
  simulateEnter(element: Element) {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }),
    );
  },
};

// Gemini 的 <rich-textarea> 自定义元素需要 document.execCommand('insertText')
// 且 Enter 需派发在 <rich-textarea> 上而非内部的 contenteditable div
const engineActionsMap: Record<string, EngineActions> = {
  gemini: {
    ...defaultActions,
    simulateInput(element: Element, value: string) {
      document.execCommand('insertText', false, value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true }));
    },
    simulateEnter(_element: Element) {
      const richTextarea = document.querySelector('rich-textarea');
      if (richTextarea) {
        richTextarea.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }),
        );
      }
    },
  },
};

function getEngineActions(engine: AIEngine): EngineActions {
  return engineActionsMap[engine] ?? defaultActions;
}

async function runAutoSubmit(query: string, engine: AIEngine): Promise<boolean> {
  if (!query) return false;

  try {
    const editor = await waitForElement(getEditorSelector(), 15000);
    await delay(500);
    (editor as HTMLElement).focus();
    await delay(100);

    const actions = getEngineActions(engine);
    actions.simulateInput(editor, query);
    await delay(100);
    actions.simulateEnter(editor);
    return true;
  } catch (error) {
    console.error('自动发送失败:', error);
    return false;
  }
}

export default function installEngineMessageListener(): void {
  const engine = detectEngine(window.location.hostname);
  if (!engine) return;

  void browser.runtime.sendMessage({ type: ENGINE_CONTENT_READY, engine }).catch(() => undefined);

  browser.runtime.onMessage.addListener((message: { type?: string; queryText?: string; engine?: AIEngine }) => {
    if (message.type !== 'AI_QUERY') {
      return undefined;
    }

    if (message.engine && message.engine !== engine) {
      return undefined;
    }

    return runAutoSubmit(message.queryText || '', engine).then((ok) => ({ ok }));
  });
}
