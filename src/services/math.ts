import 'katex/dist/katex.min.css';

export function mathPlaceholder(tex:string,display:boolean){
  const escaped=tex.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  return `<span class="math-source${display?' math-display':''}" data-math="${display?'display':'inline'}">${escaped}</span>`;
}

export async function renderMath(root:HTMLElement,signal:AbortSignal){
  const nodes=[...root.querySelectorAll<HTMLElement>('[data-math]')];
  if(!nodes.length||signal.aborted)return;
  const {default:katex}=await import('katex');
  let inputs=0,outputs=0,elements=0,attempts=0,processed=0;
  let scrollResidual=0;
  for(const node of nodes){
    if(signal.aborted||!root.isConnected)return;
    const tex=node.textContent||'';
    try {
      if(attempts>=128||tex.length>4096||inputs+tex.length>16384)throw new Error('Formula budget exceeded');
      attempts++;
      inputs+=tex.length;
      const html=katex.renderToString(tex,{displayMode:node.dataset.math==='display',throwOnError:true,trust:false,strict:'ignore',maxExpand:500,maxSize:20,macros:{}});
      if(outputs+html.length>512*1024)throw new Error('Formula output budget exceeded');
      const fragment=document.createElement('span');fragment.innerHTML=html;
      const count=fragment.querySelectorAll('*').length;
      if(elements+count>12000)throw new Error('Formula node budget exceeded');
      outputs+=html.length;elements+=count;
      // Layout changes above the viewport must not move the current reading anchor.
      const viewport=root.closest<HTMLElement>('.reader-scroll');
      const top=viewport?.getBoundingClientRect().top||0;
      const anchor=viewport&&viewport.scrollTop>0&&node.getBoundingClientRect().top<top
        ?[...viewport.querySelectorAll<HTMLElement>('[data-source-offset],h1,h2,h3,h4,h5,h6,p,table,pre,li')].find(candidate=>!candidate.contains(node)&&candidate.getBoundingClientRect().top>=top)
        :undefined;
      const anchorTop=anchor?.getBoundingClientRect().top;
      node.replaceChildren(...fragment.childNodes);
      node.classList.add('math-rendered');
      if(viewport&&anchor&&anchorTop!==undefined){
        const desired=viewport.scrollTop+anchor.getBoundingClientRect().top-anchorTop+scrollResidual;
        viewport.scrollTop=desired;
        scrollResidual=desired-viewport.scrollTop;
      }
    } catch {
      node.classList.add('math-fallback');
      node.title='公式无法排版或超过渲染预算，保留原始内容';
    }
    if(++processed%8===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
}
