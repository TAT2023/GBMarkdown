import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('artifacts/documents', { recursive:true });
const names=['架构.md','研究笔记.md','算法.md','实验.md','附录.md'];
const tex=Array.from({length:60},(_,i)=>`x_{${i}}`).join(' + ');
const inlineTex=`\\underbrace{${tex}}`;
const fixtures=names.map((name,i)=>({name,mimeType:'text/markdown',buffer:Buffer.from(`# Document ${i+1}\n\n[Target](#target-${i+1})\n\nInline $${inlineTex}$.\n\n$$\n${tex}\n$$\n\n${'A paragraph about independent document navigation and reading positions.\n\n'.repeat(24)}## Target ${i+1}\n\nNeedle-${i+1}\n\n${'Reading content after the target.\n\n'.repeat(80)}`)}));
for(const fixture of fixtures)await writeFile(`artifacts/documents/${fixture.name}`,fixture.buffer);
const native=Boolean(process.env.GBM_CDP_URL);
const browser=native?await chromium.connectOverCDP(process.env.GBM_CDP_URL):await chromium.launch({headless:true,channel:'msedge'});
try {
  const page=native?browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url())):await browser.newPage({viewport:{width:1600,height:1000}});
  assert.ok(page);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  if(!native){await page.goto('http://127.0.0.1:1420');await page.locator('.markdown-body h1').first().waitFor();}
  // Start from an empty workspace in the dedicated test window.
  while(await page.locator('.tab-close').count())await page.locator('.tab-close').first().click();
  const open=async(items)=>{
    if(native)await page.evaluate(paths=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to',{target:{kind:'Webview',label:'main'},event:'tauri://drag-drop',payload:{paths,position:{x:0,y:0}}}),items.map(item=>resolve('artifacts/documents',item.name)));
    else {const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'打开文件',exact:true}).click();await (await chooser).setFiles(items);}
  };
  await open(fixtures);
  await expect(page.getByRole('tab')).toHaveCount(5);
  await expect(page.getByRole('tab',{name:names[4],exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.reader-scroll')).toHaveCount(1);
  const first=page.getByRole('tab',{name:names[0],exact:true}),second=page.getByRole('tab',{name:names[1],exact:true});
  await first.click();
  await expect(page.getByRole('heading',{name:'Document 1',exact:true})).toBeVisible();
  await page.waitForFunction(()=>[...document.querySelectorAll('.markdown-body')].every(el=>el.dataset.renderState==='ready'));
  await page.evaluate(()=>document.fonts.ready);
  await page.getByRole('link',{name:'Target',exact:true}).click();
  await page.waitForFunction(()=>{const heading=document.querySelector('.reader-scroll h2');const reader=document.querySelector('.reader-scroll');return heading&&Math.abs(heading.getBoundingClientRect().top-reader.getBoundingClientRect().top-20)<5;});
  await page.locator('.reader-scroll').evaluate(el=>{el.scrollTop+=105;});
  await page.waitForTimeout(100);
  const saved=await page.locator('.reader-scroll').evaluate(el=>el.scrollTop);
  await second.click();
  await expect(page.getByRole('heading',{name:'Document 2',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'后退',exact:true})).toBeDisabled();
  await first.click();
  await expect.poll(()=>page.locator('.reader-scroll').evaluate(el=>el.scrollTop)).toBeCloseTo(saved,0);
  await expect(page.getByRole('button',{name:'后退',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'后退',exact:true}).click();
  await expect.poll(()=>page.locator('.reader-scroll').evaluate(el=>el.scrollTop)).toBeLessThan(2);
  await page.getByRole('button',{name:'对比阅读',exact:true}).click();
  await expect(page.locator('.reader-scroll')).toHaveCount(4);
  await expect(page.getByRole('checkbox').filter({visible:true})).toHaveCount(5);
  assert.equal(await page.locator('.document-tabs input:checked').count(),4);
  const unchecked=page.locator('.document-tabs input:not(:checked)');
  await expect(unchecked).toBeDisabled();
  const pane=page.locator('.document-pane:not([hidden])').filter({has:page.getByRole('heading',{name:'Document 1',exact:true})});
  await pane.locator('.document-bar').click();
  await page.getByRole('button',{name:'全文搜索',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索关键词'}).fill('Needle-1');
  await page.locator('.search-result').first().waitFor();await page.locator('.search-result').first().click();
  await expect(pane.locator('mark')).toHaveCount(1);
  await expect(page.locator('.document-pane:not([hidden])').filter({hasNot:page.getByRole('heading',{name:'Document 1',exact:true})}).locator('mark')).toHaveCount(0);
  await page.getByRole('button',{name:'区分大小写',exact:true}).click();
  await second.click();await expect(page.getByRole('textbox',{name:'搜索关键词'})).toHaveCount(0);
  await first.click();await expect(page.getByRole('textbox',{name:'搜索关键词'})).toHaveValue('Needle-1');
  await expect(page.getByRole('button',{name:'区分大小写',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.locator('.search-result').first().waitFor();
  await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
  const scrolls=await page.locator('.document-pane:not([hidden]) .reader-scroll').evaluateAll(nodes=>nodes.map(el=>el.scrollTop));
  await pane.locator('.reader-scroll').evaluate(el=>{el.scrollTop+=200;});await page.waitForTimeout(100);
  const after=await page.locator('.document-pane:not([hidden]) .reader-scroll').evaluateAll(nodes=>nodes.map(el=>el.scrollTop));
  assert.deepEqual(after.slice(1),scrolls.slice(1),'Scrolling one comparison pane must not move the others');
  await page.screenshot({path:`artifacts/documents-${native?'native':'browser'}-four.png`});
  // Long formulas keep their complete rendered content and horizontal scroll range.
  await pane.getByRole('button',{name:'跳到开头',exact:true}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll('.markdown-body')].every(el=>el.dataset.renderState==='ready'));
  for(const selector of ['.math-display','.source-copy-inline>.math-source']) {
    const metrics=await pane.locator(selector).first().evaluate(el=>{
      el.scrollLeft=0;const start=el.querySelector('.katex-html').getBoundingClientRect().left-el.getBoundingClientRect().left;
      el.scrollLeft=el.scrollWidth;const end=el.querySelector('.katex-html').getBoundingClientRect().right-el.getBoundingClientRect().right;
      return {start,end,width:el.clientWidth,full:el.scrollWidth,left:el.scrollLeft,scrollbar:getComputedStyle(el).scrollbarWidth,rendered:el.classList.contains('math-rendered'),source:el.querySelector('annotation')?.textContent};
    });
    assert.equal(metrics.scrollbar,'none');assert.equal(metrics.rendered,true);assert.ok(metrics.full>metrics.width&&metrics.left>0);assert.equal(metrics.source,selector==='.math-display'?tex:inlineTex);
    assert.ok(metrics.start>=-1&&metrics.end<=1,'Both ends of an overflowing formula must remain reachable');
  }
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-theme-transition'));
  await page.screenshot({path:`artifacts/documents-${native?'native':'browser'}-dark.png`});
  await page.getByRole('checkbox',{name:`对比 ${names[0]}`,exact:true}).uncheck();
  await expect(page.locator('.reader-scroll')).toHaveCount(3);
  await expect(page.locator('.document-tabs input:not(:checked)').first()).toBeEnabled();
  await page.getByRole('button',{name:'单文档阅读',exact:true}).click();
  await expect(page.locator('.reader-scroll')).toHaveCount(1);
  await page.getByRole('button',{name:'对比阅读',exact:true}).click();
  await expect(page.locator('.reader-scroll')).toHaveCount(3);
  await page.getByRole('button',{name:'单文档阅读',exact:true}).click();
  if(native){
    await open([fixtures[1]]);await expect(page.getByRole('tab')).toHaveCount(5);
    await writeFile(resolve('artifacts/documents',names[1]),Buffer.concat([fixtures[1].buffer,Buffer.from('\n## Reloaded\n')]));
    await page.locator('.notice.changed').waitFor();
    await page.getByRole('button',{name:'重新加载',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Reloaded',exact:true})).toHaveCount(1);
    await first.click();await expect(page.getByRole('heading',{name:'Document 1',exact:true})).toHaveCount(1);
  }
  const closedId=await page.getByRole('tab',{name:names[0],exact:true}).getAttribute('aria-controls');
  await page.getByRole('button',{name:`关闭 ${names[0]}`,exact:true}).click();
  await expect(page.getByRole('tab')).toHaveCount(4);
  if(native)assert.equal(await page.evaluate(async id=>{try{await window.__TAURI_INTERNALS__.invoke('get_index_status',{documentId:id,byteOffset:0});return false;}catch{return true;}},closedId.slice(5)),true);
  if(!native){
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'对比阅读',exact:true}).click();
    await page.getByRole('button',{name:'切换侧边栏',exact:true}).click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const boxes=await page.locator('.document-pane:not([hidden])').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    assert.ok(boxes.every(r=>r.width>300&&r.height>100));
    await page.screenshot({path:'artifacts/documents-mobile.png'});
    await page.keyboard.press('Control+w');await expect(page.getByRole('tab')).toHaveCount(3);
  }
  assert.deepEqual(errors,[]);
  console.log(`Multiple-document ${native?'native':'browser'} checks passed: batch open, five tabs, four-pane limit, positions, history, search isolation, independent scrolling, formula overflow, theme and close.`);
} finally {await browser.close();}
