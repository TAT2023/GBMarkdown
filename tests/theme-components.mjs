import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

await mkdir('artifacts/theme-components',{recursive:true});
const text='# Theme audit\n\n- [x] Checked task\n- [ ] Pending task\n\n```typescript\nconst message: string = "theme";\nconsole.log(message);\n```\n\n| Column | Value |\n| --- | --- |\n| First | Second |\n\n$$x^2 + y^2 = z^2$$\n\n'+Array.from({length:70},(_,i)=>`## Section ${i}\n\nA reading paragraph with enough content to scroll.\n\n`).join('');
const fixtures=Array.from({length:10},(_,i)=>({name:`theme-components-document-${i+1}.md`,mimeType:'text/markdown',buffer:Buffer.from(text)}));
for(const f of fixtures)await writeFile(resolve('artifacts/theme-components',f.name),f.buffer);
const native=Boolean(process.env.GBM_CDP_URL);
const browser=native?await chromium.connectOverCDP(process.env.GBM_CDP_URL):await chromium.launch({headless:true,channel:'msedge'});
try {
  const page=native?browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url())):await browser.newPage({viewport:{width:1440,height:960}});
  assert.ok(page);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  if(!native){await page.goto('http://127.0.0.1:1420');await page.locator('.reader-scroll').waitFor();}
  while(await page.locator('.tab-close').count())await page.locator('.tab-close').first().click();
  if(native)await page.evaluate(paths=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit_to',{target:{kind:'Webview',label:'main'},event:'tauri://drag-drop',payload:{paths,position:{x:0,y:0}}}),fixtures.map(f=>resolve('artifacts/theme-components',f.name)));
  else {const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'打开文件',exact:true}).click();await (await chooser).setFiles(fixtures);}
  await expect(page.getByRole('tab')).toHaveCount(10);
  await page.getByRole('button',{name:'对比阅读',exact:true}).click();
  await expect(page.locator('.reader-scroll')).toHaveCount(4);
  if(await page.locator('.sidebar').count()===0)await page.getByRole('button',{name:'切换侧边栏',exact:true}).click();
  await page.getByRole('button',{name:'全文搜索',exact:true}).click();
  await page.getByRole('textbox',{name:'搜索关键词'}).fill('reading');
  await page.locator('.search-result').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.markdown-body')].every(el=>el.dataset.renderState==='ready'));
  await page.evaluate(()=>document.fonts.ready);
  await page.emulateMedia({reducedMotion:'no-preference'});
  if(await page.locator('html').getAttribute('data-theme')==='dark')await page.getByRole('button',{name:'切换主题',exact:true}).click();
  await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-theme-transition'));
  await page.getByRole('button',{name:'阅读设置',exact:true}).click();
  await page.evaluate(()=>{
    document.querySelector('.document-pane.active .progress-button').click();
    const probes=document.createElement('div');probes.id='theme-probes';probes.style.cssText='position:fixed;left:-10000px;top:0';
    probes.innerHTML='<div class="notice changed">Changed</div><div class="notice error">Error</div>';
    document.body.append(probes);
  });
  const percent=page.locator('.percent-input input');await percent.fill('50');
  await page.getByRole('button',{name:'增加跳转百分比',exact:true}).click();await expect(percent).toHaveValue('50.1');
  await page.getByRole('button',{name:'减少跳转百分比',exact:true}).click();await expect(percent).toHaveValue('50');
  await percent.fill('100');await expect(page.getByRole('button',{name:'增加跳转百分比',exact:true})).toBeDisabled();
  await percent.fill('0');await expect(page.getByRole('button',{name:'减少跳转百分比',exact:true})).toBeDisabled();
  await page.mouse.move(0,0);
  const sample=async(reverse=false)=>page.evaluate(async reverse=>{
    const root=document.documentElement,frames=[];
    const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});ctx.canvas.width=ctx.canvas.height=1;
    const rgba=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
    const before=[...document.querySelectorAll('.reader-scroll')].map(el=>({top:el.scrollTop,height:el.scrollHeight}));
    const token=[...document.querySelectorAll('.markdown-body code span[style]')].find(el=>el.style.getPropertyValue('--shiki-light')!==el.style.getPropertyValue('--shiki-dark'));
    if(!token)throw new Error('Expected a highlighted token with distinct light/dark colors');
    let mutations=0;const observer=new MutationObserver(records=>{mutations+=records.length;});
    document.querySelectorAll('.markdown-body').forEach(el=>observer.observe(el,{subtree:true,childList:true}));
    const button=document.querySelector('[aria-label="切换主题"]');button.click();const start=performance.now();let reversed=false;
    while(performance.now()-start<450){
      await new Promise(requestAnimationFrame);const elapsed=performance.now()-start;
      const style=getComputedStyle(root),palette=name=>rgba(style.getPropertyValue(name).trim());const mismatches=[];
      const same=(label,actual,expected)=>{if(actual.some((v,i)=>Math.abs(v-expected[i])>1))mismatches.push({label,actual,expected});};
      const surfaces=[['.application','--bg'],['.toolbar','--bg'],['.native-titlebar','--bg'],['.sidebar','--surface'],['.statusbar','--surface'],['.document-tabs','--surface'],['.document-tab.selected','--bg'],['.document-pane','--bg'],['.reader-grid.compare .document-pane.active .document-bar','--accent-bg'],['.open-button','--bg'],['.reading-modes button[aria-pressed=true]','--accent-bg'],['.source-copy-button','--code'],['.search-panel','--bg'],['.settings-menu','--bg'],['.jump-dialog','--bg'],['.markdown-body pre','--code'],['.markdown-body th','--surface'],['#theme-probes .changed','--warning-bg'],['#theme-probes .error','--error-bg']];
      for(const [selector,name] of surfaces)for(const el of document.querySelectorAll(selector))same(`${selector} background`,rgba(getComputedStyle(el).backgroundColor),palette(name));
      for(const [selector,name] of [['.outline-row:not(.active)','--outline-text'],['#theme-probes .changed','--warning-text'],['#theme-probes .error','--error-text'],['.markdown-body .katex','--text']])for(const el of document.querySelectorAll(selector))same(`${selector} text`,rgba(getComputedStyle(el).color),palette(name));
      for(const el of document.querySelectorAll('.percent-stepper button'))same('numeric stepper text',rgba(getComputedStyle(el).color),palette('--muted'));
      for(const el of document.querySelectorAll('.reader-scroll,.outline-scroll,.search-results,.document-tabs,.markdown-body pre,.markdown-body table')){
        const colors=getComputedStyle(el).scrollbarColor.match(/(?:rgba?|color|oklab|oklch|lab|lch)\([^)]*\)/g);
        if(colors?.length!==2)throw new Error(`Expected explicit scrollbar colors for ${el.className}`);
        same(`${el.className} scrollbar thumb`,rgba(colors[0]),palette('--scroll-thumb'));
        same(`${el.className} scrollbar track`,rgba(colors[1]),palette(el.matches('.reader-scroll,.search-results,.markdown-body table')?'--bg':el.matches('pre')?'--code':'--surface'));
      }
      for(const el of document.querySelectorAll('.document-tab>input[type=checkbox],.markdown-body input[type=checkbox]'))same('checkbox background',rgba(getComputedStyle(el).backgroundColor),palette(el.checked?'--accent':'--bg'));
      const tone=Number(style.getPropertyValue('--theme-tone')),light=rgba(token.style.getPropertyValue('--shiki-light')),dark=rgba(token.style.getPropertyValue('--shiki-dark'));
      same('syntax token',rgba(getComputedStyle(token).color),light.map((value,i)=>Math.round(value*(1-tone)+dark[i]*tone)));
      frames.push({elapsed,tone,scrollbar:palette('--scroll-thumb'),mismatches});
      if(reverse&&!reversed&&elapsed>=75&&tone>0){button.click();reversed=true;}
    }
    observer.disconnect();
    return {frames,before,after:[...document.querySelectorAll('.reader-scroll')].map(el=>({top:el.scrollTop,height:el.scrollHeight})),mutations,theme:root.dataset.theme};
  },reverse);
  for(const [reverse,target] of [[false,'dark'],[false,'light'],[true,'light']]){
    const result=await sample(reverse);assert.equal(result.theme,target);assert.equal(result.mutations,0);assert.deepEqual(result.before,result.after);
    const mismatches=result.frames.flatMap(f=>f.mismatches.map(m=>({elapsed:f.elapsed,...m})));assert.deepEqual(mismatches,[],'Components must follow the shared palette in every frame');
    assert.ok(result.frames.some(f=>f.tone>0&&f.tone<1),`Expected intermediate theme colors: ${JSON.stringify(result.frames.map(f=>({elapsed:f.elapsed,tone:f.tone})))}`);
    await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-theme-transition'));
  }
  await page.screenshot({path:`artifacts/theme-components-${native?'native':'browser'}-light.png`});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>document.querySelector('[aria-label="切换主题"]').click());
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  assert.equal(await page.locator('html').getAttribute('data-theme-transition'),null);
  assert.equal(await page.locator('.open-button').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
  await page.screenshot({path:`artifacts/theme-components-${native?'native':'browser'}-dark.png`});
  await page.evaluate(()=>{document.querySelector('#theme-probes').remove();document.querySelector('.jump-dialog [title="关闭"]').click();document.querySelector('.dismiss-layer').click();});
  await page.getByRole('button',{name:'关闭搜索',exact:true}).click();
  await page.getByRole('button',{name:'单文档阅读',exact:true}).click();
  assert.deepEqual(errors,[]);
  console.log(`Theme component ${native?'native':'browser'} checks passed: scrollbars, tabs, buttons, panes, search, popups, notices, checkboxes and syntax colors follow every theme frame.`);
} finally {await browser.close();}
