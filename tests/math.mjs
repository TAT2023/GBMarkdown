import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts',{recursive:true});
const native=Boolean(process.env.GBM_CDP_URL);
const browser=native?await chromium.connectOverCDP(process.env.GBM_CDP_URL):await chromium.launch({headless:true,channel:'msedge'});
try {
  const page=native?browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url())):await browser.newPage({viewport:{width:1440,height:1000}});
  assert.ok(page,'Reader WebView2 not found');
  const errors=[],external=[];
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{if(/^https?:/.test(request.url())&&!/\/\/(127\.0\.0\.1|localhost|tauri\.localhost|ipc\.localhost)(:|\/)/.test(request.url()))external.push(request.url());});
  if(!native){
    const fixture=await readFile('tests/fixtures/math.md','utf8');
    await page.route('**/sample.md',route=>route.fulfill({contentType:'text/markdown',body:fixture}));
    await page.goto('http://127.0.0.1:1420');
  }
  await page.locator('.markdown-body h1').first().waitFor();
  if(native){
    await page.waitForFunction(()=>document.querySelector('.index-status')?.textContent?.includes('已就绪'));
    await page.getByRole('button',{name:'跳到开头',exact:true}).click();
  }
  await page.waitForFunction(()=>document.querySelectorAll('.math-rendered').length>=9&&document.querySelectorAll('.math-fallback').length>=1);
  assert.ok((await page.locator('.math-fallback').allTextContents()).includes('\\unknowncommand{x}'));
  assert.equal(await page.locator('.markdown-body h1').first().textContent(),'Formula Rendering');
  assert.equal(await page.locator('.math-display.math-rendered').count(),5);
  const fourier=page.locator('.math-display.math-rendered').filter({hasText:'\\phi(\\Delta t_i)'});
  assert.equal(await fourier.count(),1);
  assert.ok((await fourier.locator('annotation').textContent()).includes('\\phi(\\Delta t_i)\n=\n['));
  assert.equal(await page.locator('.markdown-body code .katex').count(),0);
  assert.ok((await page.locator('.markdown-body code').allTextContents()).some(text=>text.includes('$not_math$')));
  assert.equal(await page.locator('.markdown-body a[href^="javascript:"]').count(),0);
  assert.equal(await page.locator('.markdown-body script,.markdown-body img').count(),0);
  await page.evaluate(()=>document.fonts.ready);
  const fonts=await page.evaluate(()=>[...document.fonts].filter(font=>font.family.includes('KaTeX')&&font.status==='loaded').map(font=>font.family));
  assert.ok(fonts.length>0,'Bundled KaTeX fonts must load');
  await page.screenshot({path:`artifacts/math-${native?'native':'browser'}-light.png`});
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.screenshot({path:`artifacts/math-${native?'native':'browser'}-dark.png`});
  if(native){
    await page.locator('.outline-row').filter({hasText:'Error Recovery'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.math-rendered').length>=9);
    const target=await page.getByRole('heading',{name:'Error Recovery',exact:true}).boundingBox();
    assert.ok(target&&target.y>100&&target.y<800,`Native math navigation drifted: ${JSON.stringify(target)}`);
  }
  await page.getByRole('button',{name:'全文搜索',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索关键词'}).fill('frac');
  await page.locator('.search-result').first().waitFor();
  await page.locator('.search-result').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('.math-search-match.math-rendered').length>0);
  assert.equal(await page.locator('.katex mark').count(),0,'Search must not alter formula layout');
  await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
  if(!native){
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'切换侧边栏',exact:true}).click();
    await page.getByRole('button',{name:'跳到开头',exact:true}).click();
    await page.screenshot({path:'artifacts/math-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const budgets=await page.evaluate(async()=>{
      const {renderMath}=await import('/src/services/math.ts');
      const root=document.createElement('div');document.body.append(root);
      const add=tex=>{const node=document.createElement('span');node.dataset.math='inline';node.textContent=tex;root.append(node);return node;};
      const oversized=add('x'.repeat(4097));
      add('\\gdef\\leaked{x}');const isolated=add('\\leaked');
      const recursive=add('\\def\\loop{\\loop}\\loop');
      for(let i=0;i<160;i++)add('x^2');
      await renderMath(root,new AbortController().signal);
      const result={rendered:root.querySelectorAll('.math-rendered').length,fallbacks:root.querySelectorAll('.math-fallback').length,oversizedPreserved:oversized.textContent.length===4097,isolated:isolated.classList.contains('math-fallback'),recursiveStopped:recursive.classList.contains('math-fallback')};
      root.remove();
      const cancelled=document.createElement('div');document.body.append(cancelled);cancelled.innerHTML='<span data-math="inline">x</span>';
      const controller=new AbortController();controller.abort();await renderMath(cancelled,controller.signal);result.cancelled=cancelled.querySelectorAll('.katex').length===0;cancelled.remove();
      return result;
    });
    assert.ok(budgets.rendered<=128&&budgets.fallbacks>0);
    assert.equal(budgets.oversizedPreserved,true);assert.equal(budgets.isolated,true);assert.equal(budgets.recursiveStopped,true);assert.equal(budgets.cancelled,true);
    const anchorPage=await browser.newPage({viewport:{width:1440,height:1000}});
    const aligned='$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\n\n';
    await anchorPage.route('**/sample.md',route=>route.fulfill({contentType:'text/markdown',body:'# Math Anchors\n\n'+aligned.repeat(60)+'## Destination\n\nTarget paragraph.\n\n'+'body text\n\n'.repeat(100)}));
    await anchorPage.goto('http://127.0.0.1:1420');
    await anchorPage.waitForFunction(()=>document.querySelectorAll('.math-rendered').length===60);
    const position=await anchorPage.evaluate(async()=>{
      const {renderMath}=await import('/src/services/math.ts');
      const root=document.querySelector('.markdown-body'),viewport=document.querySelector('.reader-scroll');
      for(const formula of root.querySelectorAll('[data-math]')){
        formula.textContent='\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}';
        formula.classList.remove('math-rendered');
      }
      const destination=[...root.querySelectorAll('h2')].find(heading=>heading.textContent==='Destination');
      viewport.scrollTop+=destination.getBoundingClientRect().top-viewport.getBoundingClientRect().top-20;
      const before=destination.getBoundingClientRect().top;
      await renderMath(root,new AbortController().signal);
      return {before,after:destination.getBoundingClientRect().top};
    });
    assert.ok(Math.abs(position.after-position.before)<3,`Formula layout shifted jump anchor: ${JSON.stringify(position)}`);
    await anchorPage.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({native,fonts,errors,external}));
} finally {
  await browser.close();
}
