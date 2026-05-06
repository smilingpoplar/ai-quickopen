import { defineContentScript } from 'wxt/utils/define-content-script';
import installEngineMessageListener from '../src/content/main';

export default defineContentScript({
  matches: ['https://gemini.google.com/*', 'https://grok.com/*'],
  runAt: 'document_start',
  main() {
    installEngineMessageListener();
  },
});
