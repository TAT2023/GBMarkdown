import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

await mkdir('artifacts',{recursive:true});
const native=Boolean(process.env.GBM_CDP_URL);
const browser=native?await chromium.connectOverCDP(process.env.GBM_CDP_URL):await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=native?browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url())):await browser.newPage({viewport:{width:1440,height:1000}});
  assert.ok(page);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  if(!native){const fixture=await readFile('tests/fixtures/copy.md','utf8');await page.route('**/sample.md',route=>route.fulfill({contentType:'text/markdown',body:fixture}));await page.goto('http://127.0.0.1:1420');}
  await page.getByRole('heading',{name:'Copy Sources',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.source-copy-button').length===5&&document.querySelectorAll('.math-rendered').length===2);
  if(await page.locator('html').getAttribute('data-theme')==='dark')await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.bringToFront();
  const clipboard=async()=>native?execFileSync('powershell.exe',['-NoProfile','-STA','-Command',"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $text=Get-Clipboard -Raw; [Console]::Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([string]$text)))"],{encoding:'utf8',windowsHide:true}).trim():page.evaluate(()=>navigator.clipboard.readText());
  if(!native)await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  const expectCopy=async(button,expected)=>{
    await button.click();await page.waitForFunction(el=>el.dataset.copyState==='copied',await button.elementHandle());
    assert.equal(await button.getAttribute('data-copy-state'),'copied');
    const value=await clipboard();const text=native?Buffer.from(value,'base64').toString('utf8'):value;
    assert.equal(text.replaceAll('\r\n','\n'),expected);
  };
  const code='fn main() {\n    let text = "中文 😀 <tag> & $literal$";\n    println!("{}", text);\n}\n';
  const firstCode=page.locator('.source-copy-button[data-copy-kind=code]').first();
  await expectCopy(firstCode,code);
  const firstMath=page.locator('.source-copy-button[data-copy-kind=math]').first();
  await expectCopy(firstMath,'E = mc^2');
  const display=page.locator('.source-copy-display .source-copy-button');
  const tex='\n\\begin{aligned}\n\\phi(t) &= \\sin(2\\pi t/P) \\\\\ny &= \\frac{a}{b}\n\\end{aligned}\n';
  await expectCopy(display,tex.trim());
  await expectCopy(page.locator('.source-copy-button[data-copy-kind=code]').nth(1),'  leading spaces\n\n\tTabbed line <&>\n');
  await expectCopy(page.locator('.source-copy-button[data-copy-kind=math]').last(),'\\unknowncommand{中文}');
  assert.equal(await page.locator('code .source-copy-button').count(),0);
  await page.getByRole('button',{name:'全文搜索',exact:true}).click();await page.getByRole('textbox',{name:'搜索关键词'}).fill('println');
  await page.locator('.search-result').first().waitFor();await page.locator('.search-result').first().click();
  await page.waitForFunction(()=>document.querySelector('pre mark'));
  await expectCopy(page.locator('.source-copy-button[data-copy-kind=code]').first(),code);
  assert.equal(await page.locator('[data-copy-controls] mark').count(),0);
  await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
  await page.getByRole('button',{name:'跳到开头',exact:true}).click();
  await page.screenshot({path:`artifacts/copy-${native?'native':'browser'}-light.png`});
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await expectCopy(page.locator('.source-copy-button[data-copy-kind=math]').first(),'E = mc^2');
  await page.screenshot({path:`artifacts/copy-${native?'native':'browser'}-dark.png`});
  if(!native){
    const sourceURL=await page.evaluate(()=>performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/services/source-copy.ts')?.name);
    // Denied clipboard access is visible and retryable; source text stays intact.
    await page.evaluate(()=>{window.clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');window.actualExecCommand=document.execCommand;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Denied');}}});document.execCommand=()=>false;});
    const retry=page.locator('.source-copy-button[data-copy-kind=code]').first();await retry.click();await page.waitForFunction(()=>document.querySelector('.source-copy-button[data-copy-state="error"]'));
    await page.evaluate(()=>{if(window.clipboardDescriptor)Object.defineProperty(navigator,'clipboard',window.clipboardDescriptor);else delete navigator.clipboard;document.execCommand=window.actualExecCommand;});
    await expectCopy(retry,code);
    const prepared=await page.evaluate(async(url)=>{const {prepareCopyTargets}=await import(url);const root=document.createElement('div');root.innerHTML='<pre><code>fragment only\n</code></pre>';const targets=prepareCopyTargets(root,true);return {label:targets[0].label,text:targets[0].text};},sourceURL);
    assert.deepEqual(prepared,{label:'复制当前代码片段',text:'fragment only\n'});
    await page.evaluate(()=>{window.clipboardDescriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Denied');}}});});
    await retry.click();await page.waitForFunction(el=>el.dataset.copyState==='copied',await retry.elementHandle());
    await page.evaluate(()=>{if(window.clipboardDescriptor)Object.defineProperty(navigator,'clipboard',window.clipboardDescriptor);else delete navigator.clipboard;});
    assert.equal((await clipboard()).replaceAll('\r\n','\n'),code,'Selection copy fallback must preserve the source');
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'切换侧边栏',exact:true}).click();await page.getByRole('button',{name:'跳到开头',exact:true}).click();
    await page.screenshot({path:'artifacts/copy-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('.source-copy-button').evaluateAll(nodes=>nodes.every(n=>n.getBoundingClientRect().width===24&&n.getBoundingClientRect().height===24)),true);
  }
  assert.deepEqual(errors,[]);console.log(`Copy ${native?'native':'browser'} checks passed: actual clipboard text, Unicode, code whitespace, LaTeX, search and themes.`);
}finally{await browser.close();}
