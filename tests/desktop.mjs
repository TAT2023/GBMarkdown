import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('artifacts',{recursive:true});
const browser=await chromium.connectOverCDP(process.env.GBM_CDP_URL||'http://127.0.0.1:9229');
const page=browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url()));
if(!page)throw new Error('Reader WebView2 not found');
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.locator('.markdown-body h1').first().waitFor({timeout:60000});
await page.waitForFunction(()=>document.querySelector('.index-status')?.textContent?.includes('已就绪'),{},{timeout:90000});
await page.getByRole('button',{name:'跳到开头',exact:true}).click();
await page.waitForTimeout(600);
assert.ok(await page.locator('.reader-scroll').evaluate(el=>el.scrollTop<5));
assert.equal(await page.locator('.markdown-body h1').first().textContent(),'Chapter 0');
await page.screenshot({path:'artifacts/native-1GiB.png'});
await page.locator('.progress-button').click();
await page.locator('.percent-input input').fill('50');
await page.getByRole('button',{name:'跳转',exact:true}).click();
await page.waitForTimeout(700);
assert.ok(parseFloat(await page.locator('.progress-button').textContent())>45);
await page.screenshot({path:'artifacts/native-50percent.png'});
await page.getByRole('button',{name:'全文搜索',exact:true}).click();
await page.getByRole('textbox',{name:'搜索关键词'}).fill('NeedleGBM-12345');
await page.locator('.search-result').first().waitFor({timeout:60000});
await page.locator('.search-result').first().click();
await page.waitForFunction(()=>document.querySelectorAll('.markdown-body mark').length>0,{},{timeout:30000});
assert.ok(await page.locator('.markdown-body mark').count()>0);
await page.waitForFunction(()=>document.querySelector('.outline-row.active')?.textContent?.includes('Chapter 12345'),{},{timeout:10000});
const selected=await page.locator('.markdown-body mark').first().boundingBox();
assert.ok(selected&&selected.y>100&&selected.y<800);
await page.screenshot({path:'artifacts/native-search.png'});
await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
await page.getByRole('button',{name:'切换主题',exact:true}).click();
await page.screenshot({path:'artifacts/native-dark.png'});
await page.getByRole('button',{name:'切换主题',exact:true}).click();
const bounds=()=>page.locator('.render-block').evaluateAll(rows=>({first:Number(rows[0].dataset.block),last:Number(rows.at(-1).dataset.block)}));
const before=await bounds();
await page.locator('.reader-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
await page.waitForFunction(last=>Number([...document.querySelectorAll('.render-block')].at(-1)?.dataset.block)>last,before.last,{timeout:15000});
const forward=await bounds();
await page.locator('.reader-scroll').evaluate(el=>{el.scrollTop=0;});
await page.waitForFunction(first=>Number(document.querySelector('.render-block')?.dataset.block)<first,forward.first,{timeout:15000});
const backward=await bounds();
assert.ok(backward.first<forward.first);
const checks=await page.evaluate(()=>({
  isNative:!!window.__TAURI_INTERNALS__,
  activeBlocks:document.querySelectorAll('.render-block').length,
  domNodes:document.querySelectorAll('*').length,
  imageCount:document.images.length,
  highlightedTokens:document.querySelectorAll('pre code span').length,
  viewport:{width:innerWidth,height:innerHeight},
  progress:document.querySelector('.progress-button')?.textContent
}));
assert.equal(checks.isNative,true);assert.ok(checks.activeBlocks<=4);assert.ok(checks.highlightedTokens>0);
await writeFile('artifacts/desktop-checks.json',JSON.stringify({checks,paging:{before,forward,backward},errors},null,2));
assert.deepEqual(errors,[]);
console.log(JSON.stringify({checks,errors}));
await browser.close();
