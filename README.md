# AI网站快捷打开

- 点击工具栏图标 -> 将当前网页发送给AI网站分析
- 支持`?q={query}`查询参数，用AI网站搜索
- 可在后台预热AI网站（如Gemini），加快打开速度
- 在插件选项中，添加URL规则、CSS选择器（可选）、Prompt提示词。CSS选择器为空时发送URL，非空时抽取元素文本。

## 安装

```bash
git clone https://github.com/smilingpoplar/ai-quickopen.git
cd ai-quickopen
pnpm install
pnpm build
```

### Chrome

1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `./dist/chrome-mv3`

### Firefox（临时）

1. 打开 `about:debugging#/runtime/this-firefox`
2. 点击「临时加载附加组件...」
3. 选择 `./dist/firefox-mv2/manifest.json`

### Firefox（永久）

1. 下载 [Firefox 开发者版](https://www.mozilla.org/firefox/developer/)
2. 打开 `about:addons`
3. 点击齿轮 →「从文件安装附加组件」
4. 选择 `./dist/*-firefox.zip`
