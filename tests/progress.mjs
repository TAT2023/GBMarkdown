import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('artifacts/progress',{recursive:true});
const paragraph='A reading paragraph that exercises the difference between source offsets and the bottom of the viewport.\n\n';
const fixtures=[
  {name:'progress-first.md',buffer:Buffer.from('# First\n\n'+paragraph.repeat(100))},
  {name:'progress-second.md',buffer:Buffer.from('# Second\n\n'+paragraph.repeat(120))},
  {name:'progress-paged.md',buffer:Buffer.from('# Paged\n\n'+paragraph.repeat(4000))},
];
for(const fixture of fixtures)await writeFile(resolve('artifacts/progress',fixture.name),fixture.buffer);
const native=Boolean(process.env.GBM_CDP_URL);
const browser=native?await chromium.connectOverCDP(process.env.GBM_CDP_URL):await chromium.launch({headless:true,channel:'msedge'});
try {
  const page=native?browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url())):await browser.newPage({viewport:{width:1600,height:1000}});
  assert.ok(page);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  if(!native){await page.goto('http://127.0.0.1:1420');await page.locator('.reader-scroll').waitFor();}
  while(await page.locator('.tab-close').count())await page.locator('.tab-close').first().click();
  if(native)await page.evaluate(paths=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to',{target:{kind:'Webview',label:'main'},event:'tauri://drag-drop',payload:{paths,position:{x:0,y:0}}}),fixtures.map(f=>resolve('artifacts/progress',f.name)));
  else {const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'打开文件',exact:true}).click();await (await chooser).setFiles(fixtures.map(f=>({...f,mimeType:'text/markdown'})));}
  await expect(page.getByRole('tab')).toHaveCount(3);
  const active=()=>page.locator('.document-pane:not([hidden])');
  const slider=root=>root.getByRole('slider',{name:'全局阅读进度',exact:true});
  const bottom=async root=>{
    await root.locator('.reader-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
    await expect(slider(root)).toHaveValue('1000');
    await expect(root.locator('.progress-button')).toHaveText('100.0%');
  };
  const first=page.getByRole('tab',{name:fixtures[0].name,exact:true});
  const second=page.getByRole('tab',{name:fixtures[1].name,exact:true});
  await first.click();await expect(active().locator('.document-end')).toHaveText('文档结束');
  await bottom(active());await expect(page.locator('.status-right')).toContainText('阅读进度 100.0%');
  await second.click();await expect(slider(active())).toHaveValue('0');
  await first.click();await expect(slider(active())).toHaveValue('1000');
  await active().locator('.reader-scroll').evaluate(el=>{el.scrollTop-=300;});
  await expect.poll(async()=>Number(await slider(active()).inputValue())).toBeLessThan(1000);
  await active().getByRole('button',{name:'跳到开头',exact:true}).click();await expect(slider(active())).toHaveValue('0');
  await active().getByRole('button',{name:'跳到结尾',exact:true}).click();await expect(slider(active())).toHaveValue('1000');
  await page.getByRole('button',{name:'后退',exact:true}).click();await expect(slider(active())).toHaveValue('0');
  await page.getByRole('button',{name:'前进',exact:true}).click();await expect(slider(active())).toHaveValue('1000');
  await page.getByRole('tab',{name:fixtures[2].name,exact:true}).click();
  await expect(active().locator('.document-end')).toHaveText('继续滚动以读取后续内容');
  const previous=await active().locator('[data-block]').last().getAttribute('data-block');
  await active().locator('.reader-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect.poll(()=>active().locator('[data-block]').last().getAttribute('data-block')).not.toBe(previous);
  assert.ok(Number(await slider(active()).inputValue())<1000,'A local page boundary must not report end of document');
  await active().getByRole('button',{name:'跳到结尾',exact:true}).click();await expect(slider(active())).toHaveValue('1000');
  await active().getByRole('button',{name:'跳到开头',exact:true}).click();await expect(slider(active())).toHaveValue('0');
  await page.getByRole('button',{name:'对比阅读',exact:true}).click();
  const panes=page.locator('.document-pane:not([hidden])');await expect(panes).toHaveCount(3);
  const firstPane=panes.nth(0),secondPane=panes.nth(1);
  await firstPane.getByRole('button',{name:'跳到开头',exact:true}).click();await expect(slider(firstPane)).toHaveValue('0');
  await bottom(secondPane);await expect(slider(firstPane)).toHaveValue('0');
  await bottom(firstPane);await expect(slider(secondPane)).toHaveValue('1000');
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`artifacts/progress-${native?'native':'browser'}.png`});
  await page.getByRole('button',{name:'单文档阅读',exact:true}).click();
  console.log(`Reading progress ${native?'native':'browser'} checks passed: real end, page boundary, tab restoration, history and comparison isolation.`);
} finally {await browser.close();}
