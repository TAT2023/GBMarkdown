import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

await mkdir('artifacts',{recursive:true});
const native=Boolean(process.env.GBM_CDP_URL);
const browser=native?await chromium.connectOverCDP(process.env.GBM_CDP_URL):await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=native?browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url())):await browser.newPage({viewport:{width:1440,height:1000}});
  assert.ok(page);
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  if(!native){
    const fixture=await readFile('tests/fixtures/latex-delimiters.md','utf8');
    await page.route('**/sample.md',route=>route.fulfill({contentType:'text/markdown',body:fixture}));
    await page.goto('http://127.0.0.1:1420');
    await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  }
  await page.getByRole('heading',{name:'LaTeX Delimiters',exact:true}).waitFor();
  if(native)await page.waitForFunction(()=>document.querySelector('.index-status')?.textContent?.includes('已就绪'));
  await page.getByRole('button',{name:'跳到开头',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.math-rendered').length===9&&document.querySelectorAll('.math-fallback').length===1);
  assert.equal(await page.locator('[data-math]').count(),10);
  assert.equal(await page.locator('.math-display').count(),2);
  assert.equal(await page.locator('code .katex').count(),0);
  assert.ok((await page.locator('.markdown-body').allTextContents()).join('').includes('\\(escaped\\)'));
  assert.equal(await page.getByRole('heading',{name:'After Unclosed',exact:true}).count(),1);
  assert.deepEqual(await page.locator('.outline-row').allTextContents(),['#LaTeX Delimiters','·Literals','·Recovery','·After Unclosed']);
  const tex='\\phi(\\Delta t_i)\n=\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}';
  const display=page.locator('.source-copy-display').filter({hasText:'\\phi(\\Delta t_i)'});
  assert.equal((await display.locator('annotation').textContent()).trim().replaceAll('\r\n','\n'),tex);
  const expectCopy=async(button,expected)=>{
    await page.bringToFront();await button.click();
    await page.waitForFunction(el=>el.dataset.copyState==='copied',await button.elementHandle());
    const value=native?Buffer.from(execFileSync('powershell.exe',['-NoProfile','-STA','-Command','[Console]::Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string](Get-Clipboard -Raw))))'],{encoding:'utf8',windowsHide:true}).trim(),'base64').toString('utf8'):await page.evaluate(()=>navigator.clipboard.readText());
    assert.equal(value.replaceAll('\r\n','\n'),expected);
  };
  await expectCopy(display.locator('button'),tex);
  await expectCopy(page.locator('.source-copy-inline').first().locator('button'),'E = mc^2');
  await expectCopy(page.locator('.source-copy-code button'),'\\(code\\)\n\\[code\\]\n');
  await page.getByRole('button',{name:'全文搜索',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索关键词'}).fill('phi');
  await page.locator('.search-result').first().waitFor();await page.locator('.search-result').first().click();
  await page.waitForFunction(()=>document.querySelector('.math-search-match.math-rendered'));
  await expectCopy(display.locator('button'),tex);
  await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
  await page.getByRole('button',{name:'跳到开头',exact:true}).click();
  if(await page.locator('html').getAttribute('data-theme')==='dark')await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.screenshot({path:`artifacts/latex-${native?'native':'browser'}-light.png`});
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.screenshot({path:`artifacts/latex-${native?'native':'browser'}-dark.png`});
  if(!native){
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'切换侧边栏',exact:true}).click();
    await page.screenshot({path:'artifacts/latex-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  assert.deepEqual(errors,[]);
  console.log(`LaTeX delimiter ${native?'native':'browser'} checks passed: inline, display, multiline, code exclusions, recovery, source copying, search and themes.`);
}finally{await browser.close();}
