import fs from 'node:fs';
import vm from 'node:vm';

const appSource = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const chapter = JSON.parse(fs.readFileSync(new URL('../data/ar/tuta.json', import.meta.url), 'utf8'));
const firstTab = chapter.tabs[0].content_blocks
  ? chapter.tabs[0]
  : JSON.parse(fs.readFileSync(new URL(`../data/ar/${chapter.tabs[0].content_path}`, import.meta.url), 'utf8'));
const block = firstTab.content_blocks[0];
let storedFontScale = null;

const sandbox = {
  console,
  document: {
    addEventListener() {},
    getElementById() { return {}; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { addEventListener() {} },
  },
  localStorage: { getItem(key) { return key === 'articleFontScale' ? storedFontScale : null; }, setItem() {} },
  window: {},
  navigator: {},
  Intl,
  Date,
  URL,
};

vm.createContext(sandbox);
vm.runInContext(`${appSource}\nglobalThis.__renderArticle = buildDocArticle;`, sandbox);
const html = sandbox.__renderArticle(block.items, block.meta);
storedFontScale = '50';
const minFontHtml = sandbox.__renderArticle(block.items, block.meta);
storedFontScale = '150';
const maxFontHtml = sandbox.__renderArticle(block.items, block.meta);

const count = (pattern) => (html.match(pattern) || []).length;
const checks = {
  sectionCards: count(/class="doc-section-card /g),
  tocLinks: count(/data-scroll-target="doc-section-\d+"/g) - 1,
  quickSummaries: count(/class="doc-quick-summary"/g),
  chapterMeters: count(/class="doc-reading-meter"/g),
  shareMenus: count(/class="doc-share-menu"/g),
  tables: count(/class="doc-table"/g),
  listToggles: count(/data-list-toggle=/g),
  compactTermLists: count(/class="doc-term-list"/g),
  readingTools: count(/data-article-action=/g),
  referenceCards: count(/id="reference-\d+"/g),
  nextSectionButton: count(/class="doc-next-section"/g),
};

const expected = {
  sectionCards: 9,
  tocLinks: 9,
  quickSummaries: 0,
  chapterMeters: 0,
  shareMenus: 1,
  tables: 2,
  readingTools: 5,
  referenceCards: 7,
  nextSectionButton: 1,
  listToggles: 0,
};

for (const [name, value] of Object.entries(expected)) {
  if (checks[name] !== value) throw new Error(`${name}: expected ${value}, received ${checks[name]}`);
}
if (checks.compactTermLists < 1) throw new Error('Expected at least one compact terminology list');
if (!/data-font-scale="50"/.test(minFontHtml) || !/data-article-action="font-decrease"[^>]*disabled/.test(minFontHtml)) {
  throw new Error('The 50% minimum font boundary is not rendered correctly');
}
if (!/data-font-scale="150"/.test(maxFontHtml) || !/data-article-action="font-increase"[^>]*disabled/.test(maxFontHtml)) {
  throw new Error('The 150% maximum font boundary is not rendered correctly');
}

console.log(JSON.stringify({ ok: true, fontRange: '50%-150%', fontStep: '1%', ...checks }, null, 2));
