import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

await mkdir('artifacts',{recursive:true});
const filler='A bounded reading paragraph with enough content to exercise scrolling and source position restoration.\n\n';
const fixture='# Navigation\n\n[中文目标](#%E4%B8%AD%E6%96%87%E7%AB%A0%E8%8A%82) · [重复标题](#repeat-1) · [编号冲突](#repeat-1-1) · [格式标题](#bold-code) · [Setext](#setext-title) · [不存在](#missing) · [无效编码](#%ZZ) · [开头](#)\n\n'+filler.repeat(15)+'## Repeat\n\nFirst.\n\n## Repeat\n\nSecond.\n\n## Repeat-1\n\nCollision.\n\n'+filler.repeat(330)+'## 中文章节\n\nTarget body.\n\n## **Bold** `Code`\n\nFormatted body.\n\nSetext Title\n---\n\n'+filler.repeat(100);
if(process.argv.includes('--fixture')){await writeFile('artifacts/navigation.md',fixture);console.log('artifacts/navigation.md');process.exit(0);}
const native=Boolean(process.env.GBM_CDP_URL);
const browser=native?await chromium.connectOverCDP(process.env.GBM_CDP_URL):await chromium.launch({headless:true,channel:'msedge'});
try{
  const page=native?browser.contexts()[0].pages().find(p=>/tauri|localhost/.test(p.url())):await browser.newPage({viewport:{width:1440,height:960}});
  assert.ok(page);const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  if(!native){await page.route('**/sample.md',route=>route.fulfill({contentType:'text/markdown',body:fixture}));await page.goto('http://127.0.0.1:1420');}
  else{await page.evaluate(async()=>{const invoke=window.__TAURI_INTERNALS__.invoke;const settings=await invoke('get_settings');settings.recent=settings.recent.filter(item=>item.name!=='navigation.md');await invoke('save_settings',{settings});});await page.reload();}
  await page.waitForFunction(()=>document.querySelector('.index-status')?.textContent?.includes('已就绪'));
  const apiModuleURL=native?null:await page.evaluate(()=>performance.getEntriesByType('resource').find(entry=>new URL(entry.name).pathname==='/src/services/document-api.ts')?.name);
  if(await page.locator('html').getAttribute('data-theme')==='dark')await page.getByRole('button',{name:'切换主题',exact:true}).click();
  const back=page.getByRole('button',{name:'后退',exact:true}),forward=page.getByRole('button',{name:'前进',exact:true});
  assert.equal(await back.isDisabled(),true);assert.equal(await forward.isDisabled(),true);
  const headingY=name=>page.getByRole('heading',{name,exact:true}).boundingBox();
  const top=()=>page.locator('.reader-scroll').evaluate(el=>el.getBoundingClientRect().top);
  const expectHeading=async(name)=>{await page.waitForFunction(name=>{
    const el=[...document.querySelectorAll('.markdown-body h1,.markdown-body h2')].find(h=>h.textContent===name);const reader=document.querySelector('.reader-scroll');return el&&reader&&Math.abs(el.getBoundingClientRect().top-reader.getBoundingClientRect().top-20)<5;
  },name);};
  await page.getByRole('link',{name:'中文目标',exact:true}).click();await expectHeading('中文章节');
  assert.equal(await back.isEnabled(),true);assert.equal(await forward.isDisabled(),true);
  await page.keyboard.press('Alt+ArrowLeft');
  await page.waitForFunction(()=>document.querySelector('.reader-scroll')?.scrollTop<2);
  assert.equal(await forward.isEnabled(),true);
  await page.keyboard.press('Alt+ArrowRight');await expectHeading('中文章节');
  // Ordinary scrolling changes the position restored by the next Back operation.
  await page.locator('.reader-scroll').evaluate(el=>{el.scrollTop+=340;});await page.waitForTimeout(150);
  const savedY=(await headingY('中文章节')).y;
  await page.getByRole('button',{name:'跳到开头',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.reader-scroll')?.scrollTop<2);
  await back.click();await page.waitForTimeout(250);
  assert.ok(Math.abs((await headingY('中文章节')).y-savedY)<5,'Back must restore the scrolled viewport');
  await page.getByRole('button',{name:'跳到开头',exact:true}).click();
  await page.getByRole('link',{name:'编号冲突',exact:true}).click();await expectHeading('Repeat-1');
  assert.equal(await forward.isDisabled(),true,'A new navigation discards forward history');
  await back.click();await page.getByRole('link',{name:'重复标题',exact:true}).click();
  await page.waitForTimeout(250);
  const repeated=await page.getByRole('heading',{name:'Repeat',exact:true}).all();
  assert.ok(Math.abs((await repeated[1].boundingBox()).y-await top()-20)<5,'Duplicate slug targets the second heading');
  for(const [link,heading] of [['格式标题','Bold Code'],['Setext','Setext Title']]){
    await page.getByRole('button',{name:'跳到开头',exact:true}).click();await page.getByRole('link',{name:link,exact:true}).click();await expectHeading(heading);
  }
  await page.getByRole('button',{name:'跳到开头',exact:true}).click();
  await page.getByRole('link',{name:'不存在',exact:true}).click();await page.locator('.notice.error').filter({hasText:'未找到链接目标'}).waitFor();
  await page.getByRole('button',{name:'关闭提示',exact:true}).click();
  await page.getByRole('link',{name:'无效编码',exact:true}).click();await page.locator('.notice.error').filter({hasText:'锚点编码无效'}).waitFor();
  await page.getByRole('button',{name:'关闭提示',exact:true}).click();
  await page.getByRole('link',{name:'中文目标',exact:true}).click();await expectHeading('中文章节');
  await page.getByRole('button',{name:'切换主题',exact:true}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  if(native)await page.waitForFunction(async()=>await window.__TAURI_INTERNALS__.invoke('plugin:window|theme',{label:'main'})==='dark');
  await page.screenshot({path:`artifacts/navigation-${native?'native':'browser'}-dark.png`});
  if(!native){
    const historyCheck=await page.evaluate(async()=>{const {ReadingHistory}=await import('/src/services/navigation.ts');const h=new ReadingHistory();for(let i=0;i<220;i++)h.visit({offset:i,displacement:i/2});let count=0;while(h.move('back',{offset:999,displacement:0}))count++;const next=h.move('forward',{offset:0,displacement:0});h.visit({offset:123,displacement:4});return {count,next,forward:h.canForward};});
    assert.equal(historyCheck.count,200);assert.deepEqual(historyCheck.next,{offset:999,displacement:0});assert.equal(historyCheck.forward,false);
    await page.getByRole('button',{name:'跳到开头',exact:true}).click();
    await page.evaluate(async(url)=>{const {api}=await import(url);window.savedAnchor=api.anchor;api.anchor=async()=>({offset:null,complete:false});},apiModuleURL);
    await page.getByRole('link',{name:'中文目标',exact:true}).click();await page.locator('.notice').filter({hasText:'正在索引链接目标'}).waitFor();
    await page.getByRole('button',{name:'取消',exact:true}).click();
    await page.evaluate(async(url)=>{const {api}=await import(url);api.anchor=window.savedAnchor;},apiModuleURL);
    await page.waitForTimeout(450);assert.equal(await page.locator('.notice').filter({hasText:'正在索引链接目标'}).count(),0);
    assert.ok(await page.locator('.reader-scroll').evaluate(el=>el.scrollTop<2),'Cancelled resolution must not navigate later');
    // A late window response must not overwrite the last requested location.
    await page.evaluate(async(url)=>{const {api}=await import(url);window.savedWindow=api.window;api.window=async(...args)=>{const result=await window.savedWindow(...args);if(args[1]===0)await new Promise(resolve=>setTimeout(resolve,450));return result;};},apiModuleURL);
    await page.getByRole('button',{name:'跳到开头',exact:true}).click();
    await page.locator('.progress-button').click();await page.locator('.percent-input input').fill('80');await page.getByRole('button',{name:'跳转',exact:true}).click();
    await page.waitForTimeout(650);assert.ok(parseFloat(await page.locator('.progress-button').textContent())>60);
    await page.evaluate(async(url)=>{const {api}=await import(url);api.window=window.savedWindow;},apiModuleURL);
    await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'切换侧边栏',exact:true}).click();
    await page.screenshot({path:'artifacts/navigation-mobile.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const buttons=await page.locator('.toolbar button').evaluateAll(nodes=>nodes.map(n=>({left:n.getBoundingClientRect().left,right:n.getBoundingClientRect().right})));assert.ok(buttons.every(b=>b.left>=0&&b.right<=390));
    const [fileChooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'打开文件',exact:true}).click()]);
    await fileChooser.setFiles({name:'new.md',mimeType:'text/markdown',buffer:Buffer.from('# New document\n')});await page.getByRole('heading',{name:'New document',exact:true}).waitFor();assert.equal(await back.isDisabled(),true);assert.equal(await forward.isDisabled(),true);
  }
  assert.deepEqual(errors,[]);console.log(`Navigation ${native?'native':'browser'} checks passed.`);
}finally{await browser.close();}
