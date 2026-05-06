import { defineConfig } from 'wxt';

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
      name: 'Gemini 快捷打开',
      version: '1.1.0',
      description: '点击插件图标，将当前网页 URL 发送到 Gemini 进行分析',
      permissions,
      host_permissions: ['https://gemini.google.com/*'],
      action: {
        default_title: '在 Gemini 中打开当前页面',
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
        'open-gemini': {
          description: '在 Gemini 中打开当前页面',
        },
      },
      browser_specific_settings: {
        gecko: {
          id: 'gemini-quickopen@quickopen',
          strict_min_version: '128.0',
        },
      },
    };
  },
});
