import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeUrlPatternInput,
  urlMatchPatternToRegex,
  findMatchingGroup,
} from '../src/shared/url-pattern';
import { DEFAULT_PROMPT } from '../src/shared/constants';

const ai = { engine: 'gemini', warmup: { gemini: true, grok: false } };

test('normalizeUrlPatternInput should auto-complete bare domains', () => {
  assert.equal(normalizeUrlPatternInput('github.com'), '*://github.com/*');
  assert.equal(normalizeUrlPatternInput('*.youtube.com'), '*://*.youtube.com/*');
});

test('normalizeUrlPatternInput should keep scheme and append path wildcard when missing', () => {
  assert.equal(normalizeUrlPatternInput('https://github.com'), 'https://github.com/*');
  assert.equal(normalizeUrlPatternInput('https://github.com/*'), 'https://github.com/*');
  assert.equal(normalizeUrlPatternInput('wallstreetcn.com/livenews'), '*://wallstreetcn.com/livenews*');
});

test('urlMatchPatternToRegex should match wildcard scheme and host patterns', () => {
  const regex = urlMatchPatternToRegex('*.youtube.com');
  assert.ok(regex);
  assert.equal(regex.test('https://youtube.com/watch?v=1'), true);
  assert.equal(regex.test('http://m.youtube.com/watch?v=1'), true);
  assert.equal(regex.test('https://example.com'), false);
});

test('urlMatchPatternToRegex should match path prefix when path has no wildcard', () => {
  const regex = urlMatchPatternToRegex('wallstreetcn.com/livenews');
  assert.ok(regex);
  assert.equal(regex.test('https://wallstreetcn.com/livenews'), true);
  assert.equal(regex.test('https://wallstreetcn.com/livenews/3055332'), true);
  assert.equal(regex.test('https://wallstreetcn.com/livenews?from=home'), true);
});

test('urlMatchPatternToRegex should return null for invalid pattern', () => {
  const regex = urlMatchPatternToRegex('*foo*');
  assert.equal(regex, null);
});

test('findMatchingGroup should return first matched group by order', () => {
  const config = {
    ai,
    ruleGroups: [
      {
        id: '1',
        prompt: 'rule-1',
        isDefault: false,
        rules: [
          { id: 'r1', urlPattern: '*.github.com', cssSelector: '' },
          { id: 'r2', urlPattern: 'example.com', cssSelector: '' },
        ],
      },
      {
        id: '2',
        prompt: 'rule-2',
        isDefault: false,
        rules: [{ id: 'r3', urlPattern: 'github.com', cssSelector: '' }],
      },
      {
        id: '3',
        prompt: 'default',
        isDefault: true,
        rules: [],
      },
    ],
  };

  const matched = findMatchingGroup('https://docs.github.com/en', config);
  assert.equal(matched.prompt, 'rule-1');
});

test('findMatchingGroup should fallback to default group', () => {
  const config = {
    ai,
    ruleGroups: [
      {
        id: '1',
        prompt: 'rule-1',
        isDefault: false,
        rules: [{ id: 'r1', urlPattern: 'github.com', cssSelector: '' }],
      },
      {
        id: '2',
        prompt: 'default',
        isDefault: true,
        rules: [],
      },
    ],
  };

  const matched = findMatchingGroup('https://news.ycombinator.com', config);
  assert.equal(matched.prompt, 'default');
  assert.equal(matched.cssSelector, '');
});

test('findMatchingGroup should fallback to hardcoded default when no default group', () => {
  const config = {
    ai,
    ruleGroups: [
      {
        id: '1',
        prompt: 'rule-1',
        isDefault: false,
        rules: [{ id: 'r1', urlPattern: 'github.com', cssSelector: '' }],
      },
    ],
  };

  const matched = findMatchingGroup('https://news.ycombinator.com', config);
  assert.equal(matched.prompt, DEFAULT_PROMPT);
  assert.equal(matched.cssSelector, '');
});
