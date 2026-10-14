import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import DOMPurify from 'dompurify';
import { createPortal } from 'react-dom';
import { api, type Block, type DocumentInfo, type RenderWindow } from '../services/document-api';
import { ArrowUp, LoaderCircle } from 'lucide-react';
import { highlight } from '../services/highlight';
import { renderMath } from '../services/math';
import type { ReadingPosition } from '../services/navigation';
import { prepareCopyTargets, type CopyTarget } from '../services/source-copy';
import SourceCopyButton from './SourceCopyButton';
export interface ReaderHandle {position:()=>ReadingPosition}
let imageMemory=0;
function Fragment({block,documentId,query,onLink}:{block:Block;documentId:string;query:string;onLink:(href:string)=>void}){
  const root=useRef<HTMLDivElement>(null);
  const [copyTargets,setCopyTargets]=useState<CopyTarget[]>([]);
  const safeHTML=useMemo(()=>DOMPurify.sanitize(block.html,{ADD_ATTR:['data-local-image','data-title','data-source-offset','data-math'],FORBID_TAGS:['script','iframe','style','object'],FORBID_ATTR:['style']}),[block.html]);
  useLayoutEffect(()=>{
    const el=root.current;if(!el)return;const controller=new AbortController();
    el.innerHTML=safeHTML;
    setCopyTargets(prepareCopyTargets(el,block.mode==='code'));
    if(query)el.querySelectorAll<HTMLElement>('[data-math]').forEach(node=>{if(node.textContent?.toLowerCase().includes(query.toLowerCase()))node.classList.add('math-search-match');});
    const resources=new Map<HTMLElement,{visible:boolean;loading:boolean;memory:number;alt:string;image:HTMLImageElement|null}>();
    const release=(slot:HTMLElement)=>{const resource=resources.get(slot);if(!resource)return;imageMemory-=resource.memory;resource.memory=0;resource.image?.removeAttribute('src');resource.image=null;slot.textContent=resource.alt;};
    const observer=new IntersectionObserver(entries=>{for(const entry of entries){const slot=entry.target as HTMLElement;const path=slot.dataset.localImage;if(!path)continue;let resource=resources.get(slot);if(!resource){resource={visible:false,loading:false,memory:0,alt:slot.textContent||path,image:null};resources.set(slot,resource);}resource.visible=entry.isIntersecting;
      if(!entry.isIntersecting){if(resource.image){slot.style.minHeight=`${slot.getBoundingClientRect().height}px`;release(slot);}continue;}
      if(resource.loading||resource.image)continue;resource.loading=true;
      let relative=path;try{relative=decodeURIComponent(path);}catch{/* Keep literal malformed percent sequences in local filenames. */}
      void api.image(documentId,relative).then(({url,width,height})=>{const state=resources.get(slot)!;state.loading=false;if(controller.signal.aborted||!state.visible)return;const cost=url.length*2+width*height*4;if(imageMemory+cost>64*1024*1024)throw new Error('Image memory budget reached');imageMemory+=cost;state.memory=cost;const img=new Image();state.image=img;img.alt=state.alt;img.onload=()=>{if(controller.signal.aborted||!state.visible)return;slot.replaceChildren(img);slot.style.minHeight='';};img.onerror=()=>{release(slot);slot.textContent=`无法显示图片：${path}`;};img.src=url;}).catch(()=>{const state=resources.get(slot);if(state)state.loading=false;if(!controller.signal.aborted){release(slot);slot.classList.add('image-missing');slot.textContent=`图片不可用：${path}`;}});
    }},{rootMargin:'400px'});
    el.querySelectorAll('[data-local-image]').forEach(slot=>observer.observe(slot));
    void Promise.all([highlight(el,controller.signal).catch(()=>{}),renderMath(el,controller.signal).catch(()=>{})]).then(()=>{
      if(controller.signal.aborted||!query)return;
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];let n:Node|null;while((n=walker.nextNode())){if(n.parentElement?.closest('script,style,[data-math],[data-copy-controls]'))continue;nodes.push(n as Text);}
      for(const node of nodes){const text=node.data;const lower=text.toLowerCase();let start=0,pos=lower.indexOf(query.toLowerCase());if(pos<0)continue;const fragment=document.createDocumentFragment();while(pos>=0){fragment.append(text.slice(start,pos));const mark=document.createElement('mark');mark.textContent=text.slice(pos,pos+query.length);fragment.append(mark);start=pos+query.length;pos=lower.indexOf(query.toLowerCase(),start);}fragment.append(text.slice(start));node.replaceWith(fragment);}
    });
    return()=>{controller.abort();observer.disconnect();for(const slot of resources.keys())release(slot);};
  },[block.html,block.mode,documentId,query]);
  return <><div ref={root} className="markdown-body" data-source-start={block.start} dangerouslySetInnerHTML={{__html:safeHTML}} onClick={e=>{const link=(e.target as Element).closest('a');if(link){e.preventDefault();onLink(link.getAttribute('href')||'');}}}/>{copyTargets.map((target,index)=>createPortal(<SourceCopyButton target={target}/>,target.container,index))}</>;
}

export default function MarkdownView({doc,target,fontSize,query,onProgress,onWarning,onLink,onJump,ref}:{doc:DocumentInfo;target:ReadingPosition&{version:number};fontSize:number;query:string;onProgress:(n:number)=>void;onWarning:(s:string|null)=>void;onLink:(href:string)=>void;onJump:(offset:number)=>void;ref:Ref<ReaderHandle>}){
  const parent=useRef<HTMLDivElement>(null);const [windowData,setWindow]=useState<RenderWindow|null>(null);const [loading,setLoading]=useState(false);
  const request=useRef(0);const loadingEdge=useRef(false);const anchor=useRef<{offset:number;top:number}|null>(null);const jumpPending=useRef<number|null>(null);const navigating=useRef(false);
  const blocks=windowData?.blocks||[];
  useImperativeHandle(ref,()=>({position:()=>{
    const el=parent.current;if(!el||navigating.current||loading)return {offset:target.offset,displacement:target.displacement};
    if(el.scrollTop<1&&windowData?.start===doc.bom)return {offset:doc.bom,displacement:0};
    const top=el.getBoundingClientRect().top;
    const row=[...el.querySelectorAll<HTMLElement>('[data-block]')].find(r=>r.getBoundingClientRect().bottom>top+10);
    if(row){const marker=[...row.querySelectorAll<HTMLElement>('[data-source-offset]')].filter(m=>m.getBoundingClientRect().top<=top+30).at(-1)||row.querySelector<HTMLElement>('[data-source-offset]');
      if(marker)return {offset:Number(marker.dataset.sourceOffset),displacement:top+20-marker.getBoundingClientRect().top};
      const block=blocks.find(b=>b.start===Number(row.dataset.block));if(block){const rect=row.getBoundingClientRect();return {offset:Math.round(block.start+Math.max(0,Math.min(1,(top-rect.top)/rect.height))*(block.end-block.start)),displacement:0};}
    }return {offset:target.offset,displacement:0};
  }}));
  useEffect(()=>{
    const version=++request.current;let cancelled=false;navigating.current=true;setLoading(true);loadingEdge.current=false;
    void api.window(doc.id,target.offset,version).then(data=>{if(cancelled||version!==request.current)return;anchor.current=null;setWindow(data);jumpPending.current=target.offset;onWarning(data.warning);}).catch(e=>{if(!cancelled){navigating.current=false;onWarning(String(e));}}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[doc.id,target.version]);
  useLayoutEffect(()=>{
    const el=parent.current;if(!el||!blocks.length)return;
    if(anchor.current){const saved=anchor.current;const row=el.querySelector<HTMLElement>(`[data-block="${saved.offset}"]`);if(row)el.scrollTop+=row.getBoundingClientRect().top-saved.top;anchor.current=null;}
    else if(jumpPending.current!==null){const offset=jumpPending.current;jumpPending.current=null;
      const block=blocks.find(b=>b.start<=offset&&b.end>offset)||blocks[0];const row=el.querySelector<HTMLElement>(`[data-block="${block.start}"]`);
      if(offset<=doc.bom&&!target.displacement){el.scrollTop=0;}else if(offset>=doc.size-1){el.scrollTop=el.scrollHeight;}
      else if(row){const markers=[...row.querySelectorAll<HTMLElement>('[data-source-offset]')];const exact=markers.filter(m=>Number(m.dataset.sourceOffset)<=offset).at(-1);
        if(exact)el.scrollTop+=exact.getBoundingClientRect().top-el.getBoundingClientRect().top-20+target.displacement;
        else {const fraction=Math.max(0,Math.min(1,(offset-block.start)/Math.max(1,block.end-block.start)));el.scrollTop+=row.getBoundingClientRect().top-el.getBoundingClientRect().top+fraction*row.getBoundingClientRect().height;}
      }
    }
    requestAnimationFrame(()=>{navigating.current=false;});
  },[windowData]);
  useEffect(()=>{
    const el=parent.current;if(!el)return;let frame=0;
    const scroll=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(!windowData||loading||navigating.current)return;
      const top=el.getBoundingClientRect().top;const rows=[...el.querySelectorAll<HTMLElement>('[data-block]')];const row=rows.find(r=>r.getBoundingClientRect().bottom>top+10)||rows[0];const visible=blocks.findIndex(b=>b.start===Number(row?.dataset.block));const b=blocks[Math.max(0,visible)];
      if(b&&row){const rect=row.getBoundingClientRect();const fraction=Math.min(1,Math.max(0,(top-rect.top)/Math.max(1,rect.height)));const marker=[...row.querySelectorAll<HTMLElement>('[data-source-offset]')].filter(m=>m.getBoundingClientRect().top<=top+30).at(-1);onProgress(marker?Number(marker.dataset.sourceOffset):Math.round(b.start+fraction*(b.end-b.start)));}
      const down=el.scrollTop+el.clientHeight>el.scrollHeight-450&&windowData.end<doc.size;
      const up=el.scrollTop<200&&windowData.start>doc.bom;
      if(!down&&!up||loadingEdge.current)return;
      loadingEdge.current=true;const version=++request.current;
      const offset=down?windowData.end:Math.max(doc.bom,windowData.start-1);
      const saved=row&&b?{offset:b.start,top:row.getBoundingClientRect().top}:null;
      void api.window(doc.id,offset,version).then(next=>{
        if(version!==request.current)return;
        let combined:Block[];
        if(down){const retained=blocks.slice(Math.max(0,visible));combined=[...retained,...next.blocks.filter(n=>!retained.some(b=>b.start===n.start))];}
        else {const before=next.blocks.filter(b=>b.end<=windowData.start);if(!before.length)return;combined=[...before,...blocks.slice(0,Math.max(0,visible)+1)];}
        combined=combined.slice(0,4);anchor.current=saved;setWindow({...next,blocks:combined,start:combined[0].start,end:combined.at(-1)!.end});onWarning(next.warning);
      }).catch(e=>onWarning(String(e))).finally(()=>{loadingEdge.current=false;});
    });};
    el.addEventListener('scroll',scroll,{passive:true});return()=>{el.removeEventListener('scroll',scroll);cancelAnimationFrame(frame);};
  },[windowData,doc.id,loading]);
  return <div className="reader-scroll" ref={parent} style={{'--reading-size':`${fontSize}px`} as React.CSSProperties}>
    {loading&&!windowData?<div className="loading-document"><LoaderCircle className="spin" size={22}/>正在读取文档</div>:null}
    {windowData&&<div className="reading-content">
      <div className="document-meta"><span>MARKDOWN</span><span>{doc.encoding}</span><span>{doc.size>=1024*1024?'按需读取':'本地文档'}</span></div>
      {windowData.start>doc.bom&&<button className="fragment-label" onClick={()=>onJump(Math.max(doc.bom,windowData.start-1))}><ArrowUp size={12}/>前一阅读区段</button>}
      <div>{blocks.map(block=><div key={block.start} data-block={block.start} className="render-block"><Fragment block={block} documentId={doc.id} query={query} onLink={onLink}/></div>)}</div>
      <div className="document-end">{windowData.end>=doc.size?'文档结束':'继续滚动以读取后续内容'}</div>
    </div>}
  </div>;
}
