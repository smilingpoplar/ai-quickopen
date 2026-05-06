# AI QuickOpen

- Click toolbar icon -> Send current webpage to AI website for analysis
- Support `?q={query}` query parameter for AI website search
- Pre-warm AI websites (like Gemini) in the background to speed up opening
- In the extension options, add URL rules, CSS selector (optional), and Prompt. If the CSS selector is empty, the URL will be sent; if not empty, text will be extracted from the selected element.

## Install

```bash
git clone https://github.com/smilingpoplar/ai-quickopen.git
cd ai-quickopen
pnpm install
pnpm build
```

### Chrome

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked extension"
4. Select `./dist/chrome-mv3`

### Firefox (Temporary)

1. Open `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `./dist/firefox-mv2/manifest.json`

### Firefox (Permanent)

1. Download [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/)
2. Open `about:addons`
3. Click gear → "Install Add-on From File"
4. Select the generated zip under `./dist/*-firefox.zip`
