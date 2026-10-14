export interface CopyTarget {container:HTMLElement;text:string;kind:'code'|'math';label:string}

export function prepareCopyTargets(root:HTMLElement,partialCode:boolean):CopyTarget[]{
  const targets:CopyTarget[]=[];
  for(const node of root.querySelectorAll<HTMLElement>('pre > code,[data-math]')){
    const math=node.hasAttribute('data-math');
    const text=math?(node.textContent||'').trim():node.textContent||'';
    const content=math?node:node.parentElement!;
    const wrapper=document.createElement(math?'span':'div');
    wrapper.className=math?`source-copy-math source-copy-${node.dataset.math==='display'?'display':'inline'}`:'source-copy-code';
    const container=document.createElement('span');container.className='source-copy-slot';container.dataset.copyControls='';
    content.before(wrapper);wrapper.append(content,container);
    targets.push({container,text,kind:math?'math':'code',label:math?'复制 LaTeX':partialCode?'复制当前代码片段':'复制代码'});
  }
  return targets;
}

export async function copyText(text:string):Promise<void>{
  if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return;}catch{/* Older WebView2 permissions may require the selection-based copy path. */}}
  const active=document.activeElement as HTMLElement|null;
  const selection=window.getSelection();const ranges:Range[]=[];
  if(selection)for(let i=0;i<selection.rangeCount;i++)ranges.push(selection.getRangeAt(i).cloneRange());
  const input=document.createElement('textarea');input.value=text;input.setAttribute('aria-hidden','true');
  Object.assign(input.style,{position:'fixed',left:'0',top:'0',width:'1px',height:'1px',opacity:'0'});
  document.body.append(input);
  try{input.focus({preventScroll:true});input.select();if(!document.execCommand('copy'))throw new Error('Clipboard unavailable');}
  finally{input.remove();active?.focus({preventScroll:true});if(selection){selection.removeAllRanges();for(const range of ranges)selection.addRange(range);}}
}
