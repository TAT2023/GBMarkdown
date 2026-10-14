import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts', { recursive: true });
const native = Boolean(process.env.GBM_CDP_URL);
const browser = native ? await chromium.connectOverCDP(process.env.GBM_CDP_URL) : await chromium.launch({ headless: true, channel: 'msedge' });
try {
  const page = native ? browser.contexts()[0].pages().find(p => /tauri|localhost/.test(p.url())) : await browser.newPage({ viewport: { width: 1440, height: 960 } });
  assert.ok(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (!native) await page.goto('http://127.0.0.1:1420');
  await page.locator('.markdown-body h1').first().waitFor();
  await page.waitForFunction(() => document.documentElement.dataset.theme);
  const settled = () => page.waitForFunction(() => !document.documentElement.hasAttribute('data-theme-transition'));
  const theme = page.getByRole('button', { name: '切换主题', exact: true });
  if (await page.locator('html').getAttribute('data-theme') === 'dark') await theme.click();
  await settled();

  const sample = async (reverse = false) => page.evaluate(async reverse => {
    const root = document.documentElement;
    const reader = document.querySelector('.reader-scroll');
    const content = document.querySelector('.markdown-body');
    const before = { scroll: reader.scrollTop, height: content.getBoundingClientRect().height };
    let mutations = 0;
    const observer = new MutationObserver(records => { mutations += records.length; });
    observer.observe(content, { subtree: true, childList: true });
    const button = document.querySelector('[aria-label="切换主题"]');
    button.click();
    const start = performance.now();
    const frames = [];
    let reversed = false;
    while (performance.now() - start < 480) {
      await new Promise(requestAnimationFrame);
      const elapsed = performance.now() - start;
      if (reverse && !reversed && elapsed >= 70) { button.click(); reversed = true; }
      const color = selector => getComputedStyle(document.querySelector(selector)).backgroundColor;
      frames.push({ elapsed, background: color('.application'), toolbar: color('.toolbar'), palette: getComputedStyle(root).getPropertyValue('--bg').trim() });
    }
    observer.disconnect();
    return { frames, before, after: { scroll: reader.scrollTop, height: content.getBoundingClientRect().height }, mutations, theme: root.dataset.theme };
  }, reverse);
  const red = value => Number(value.match(/[\d.]+/)[0]);
  const check = (result, dark) => {
    assert.equal(result.theme, dark ? 'dark' : 'light');
    assert.deepEqual(result.before, result.after, 'Theme must preserve reading position and layout');
    assert.equal(result.mutations, 0, 'Theme must not rebuild Markdown');
    const values = result.frames.map(frame => red(frame.background));
    assert.ok(values.some(value => value > 35 && value < 245), 'Expected intermediate palette colors');
    assert.ok(result.frames.every(frame => frame.background === frame.toolbar), 'Surfaces must transition together');
    assert.equal(values.at(-1), dark ? 25 : 255);
    for (let i = 1; i < values.length; i++) assert.ok(dark ? values[i] <= values[i - 1] + 1 : values[i] >= values[i - 1] - 1, 'Palette must not flash or reverse brightness');
  };
  check(await sample(), true);
  await settled();
  await page.screenshot({ path: `artifacts/theme-${native ? 'native' : 'browser'}-dark.png` });
  check(await sample(), false);
  await settled();
  const reversed = await sample(true);
  assert.equal(reversed.theme, 'light');
  assert.equal(red(reversed.frames.at(-1).background), 255);
  assert.deepEqual(reversed.before, reversed.after);
  await settled();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await theme.click();
  assert.equal(await page.locator('.application').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(25, 28, 31)');
  assert.equal(await page.locator('html').getAttribute('data-theme-transition'), null);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  if (!native) {
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('gbm-settings') || '{}').theme === 'dark');
    await page.reload();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
    assert.equal(await page.locator('html').getAttribute('data-theme-transition'), null, 'Restoring saved theme must not animate');
    await page.setViewportSize({ width: 390, height: 844 });
    await theme.click();
    await settled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: 'artifacts/theme-mobile-light.png' });
  }
  assert.deepEqual(errors, []);
  console.log(`Theme ${native ? 'native' : 'browser'} checks passed: smooth palette, no brightness flash, rapid reversal, stable layout, reduced motion and saved theme.`);
} finally {
  await browser.close();
}
