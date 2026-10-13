import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronLeft, ChevronRight, ListTree, LoaderCircle } from 'lucide-react';
import { api, type Heading } from '../services/document-api';
export default function Outline({id,count,offset,currentIndex,onJump}:{id:string;count:number;offset:number;currentIndex:number;onJump:(n:number)=>void}){
  const parent=useRef<HTMLDivElement>(null);const pages=useRef(new Map<number,Heading[]>());const pending=useRef(new Set<number>());const [,refresh]=useState(0);
  const [base,setBase]=useState(0);const activeId=useRef(id);activeId.current=id;
  useEffect(()=>{pages.current.clear();pending.current.clear();setBase(0);refresh(n=>n+1);},[id]);
  const virtual=useVirtualizer({count:Math.max(0,Math.min(1000,count-base)),getScrollElement:()=>parent.current,estimateSize:()=>34,overscan:12});
  useEffect(()=>{const next=Math.floor(currentIndex/1000)*1000;setBase(next);requestAnimationFrame(()=>virtual.scrollToIndex(Math.max(0,currentIndex-next),{align:'auto'}));},[currentIndex]);
  const rows=virtual.getVirtualItems();const first=base+(rows[0]?.index||0);const last=base+(rows.at(-1)?.index||0);
  useEffect(()=>{
    for(let page=Math.floor(first/200);page<=Math.floor(last/200);page++){
      const existing=pages.current.get(page);const needed=Math.min(200,count-page*200);
      if((existing&&existing.length>=needed)||pending.current.has(page))continue;
      pending.current.add(page);
      void api.outline(id,page*200).then(items=>{if(activeId.current!==id)return;pages.current.set(page,items);if(pages.current.size>8){const oldest=pages.current.keys().next().value;if(oldest!==undefined&&oldest!==page)pages.current.delete(oldest);}refresh(n=>n+1);}).catch(()=>{}).finally(()=>pending.current.delete(page));
    }
  },[id,count,first,last]);
  function go(next:number){setBase(Math.max(0,Math.min(Math.max(0,Math.floor((count-1)/1000)*1000),next)));if(parent.current)parent.current.scrollTop=0;}
  return <div className="outline-container"><div className="outline-scroll" ref={parent}>
    {!count&&<div className="sidebar-empty"><ListTree size={24}/><span>暂无标题</span></div>}
    <div style={{height:virtual.getTotalSize(),position:'relative',width:'100%'}}>{rows.map(row=>{
      const number=base+row.index;const heading=pages.current.get(Math.floor(number/200))?.[number%200];
      return <button key={`${id}-${row.index}`} className={`outline-row ${number===currentIndex?'active':''}`} style={{position:'absolute',top:0,left:0,width:'100%',height:34,transform:`translateY(${row.start}px)`,paddingLeft:16+((heading?.level||1)-1)*14}} title={heading?.title} onClick={()=>heading&&onJump(heading.offset)}>
        {heading?<><span className="heading-level">{heading.level===1?'#':'·'}</span><span>{heading.title}</span></>:<LoaderCircle size={12} className="spin"/>}
      </button>;
    })}</div>
  </div>{count>1000&&<div className="outline-pagination"><div><button className="icon-button small" title="上一页目录" disabled={!base} onClick={()=>go(base-1000)}><ChevronLeft size={14}/></button><span>{Math.floor(base/1000)+1} / {Math.ceil(count/1000).toLocaleString()}</span><button className="icon-button small" title="下一页目录" disabled={base+1000>=count} onClick={()=>go(base+1000)}><ChevronRight size={14}/></button></div><input type="range" title="目录分页位置" aria-label="目录分页位置" min="0" max={Math.max(0,Math.ceil(count/1000)-1)} value={Math.floor(base/1000)} onChange={e=>go(Number(e.target.value)*1000)}/></div>}</div>;
}
