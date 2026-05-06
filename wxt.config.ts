import { defineConfig } from 'wxt';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  description: string;
  version: string;
};

export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => {
    const permissions = ['activeTab', 'storage', 'scripting', 'webNavigation'];
    if (browser === 'chrome') {
      permissions.push('tabGroups');
    }
    if (browser === 'firefox') {
      permissions.push('tabHide');
    }

    return {
      name: 'AI 快捷打开',
      version: '1.2.0',
      description: '点击插件图标，将当前网页发送到AI引擎分析',
      permissions,
      host_permissions: ['https://gemini.google.com/*', 'https://grok.com/*'],
      action: {
        default_title: '在AI引擎中打开当前页面',
        default_icon: {
          '16': 'icons/icon16.png',
          '32': 'icons/icon32.png',
          '48': 'icons/icon48.png',
          '128': 'icons/icon128.png',
        },
      },
      options_page: 'settings.html',
      icons: {
        '16': 'icons/icon16.png',
        '32': 'icons/icon32.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
      commands: {
        'open-engine': {
          description: '在当前AI引擎中打开当前页面',
        },
      },
      browser_specific_settings: {
        gecko: {
          id: 'ai-quickopen@quickopen',
          strict_min_version: '128.0',
        },
      },
    };
  },
});
