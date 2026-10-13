import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, CaseSensitive, LoaderCircle, Search, Square, X } from 'lucide-react';
import { api, type SearchMatch, type SearchStatus } from '../services/document-api';
export default function SearchPanel({id,onJump,onQuery,onClose}:{id:string;onJump:(n:number)=>void;onQuery:(s:string)=>void;onClose:()=>void}){
  const [query,setQuery]=useState('');const [sensitive,setSensitive]=useState(false);const [sid,setSid]=useState<string|null>(null);const [status,setStatus]=useState<SearchStatus|null>(null);
  const [selected,setSelected]=useState(-1);const [error,setError]=useState('');const [revision,refresh]=useState(0);const pages=useRef(new Map<number,SearchMatch[]>());const pending=useRef(new Set<number>());const generation=useRef(0);
  const activeSearch=useRef(sid);activeSearch.current=sid;
  const parent=useRef<HTMLDivElement>(null);const input=useRef<HTMLInputElement>(null);
  const virtual=useVirtualizer({count:status?.retained||0,getScrollElement:()=>parent.current,estimateSize:()=>76,overscan:6});
  const rows=virtual.getVirtualItems();const first=rows[0]?.index||0,last=rows.at(-1)?.index||0;
  useEffect(()=>{input.current?.focus();return()=>{generation.current++;void api.cancel(id).catch(()=>{});};},[id]);
  useEffect(()=>{const timer=setTimeout(()=>{if(query.trim())void run();else {generation.current++;void api.cancel(id);setSid(null);setStatus(null);pages.current.clear();onQuery('');}},260);return()=>clearTimeout(timer);},[query,sensitive,id]);
  async function run(){const g=++generation.current;setError('');pages.current.clear();pending.current.clear();setSelected(-1);setStatus(null);setSid(null);onQuery(query);
    try{const next=await api.startSearch(id,query,sensitive);if(g===generation.current)setSid(next);}catch(e){if(g===generation.current)setError(String(e));}
  }
  useEffect(()=>{if(!sid)return;let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const [s,items]=await api.searchResults(id,sid,0);if(stopped)return;setStatus(s);if(!pages.current.has(0)||pages.current.get(0)!.length<items.length){pages.current.set(0,items);refresh(n=>n+1);}if(s.error)setError(s.error);if(!s.complete)timer=setTimeout(poll,250);}catch(e){if(!stopped)setError(String(e));}};void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[id,sid]);
  useEffect(()=>{if(!sid||!status?.retained)return;
    for(let page=Math.floor(first/200);page<=Math.floor(last/200);page++){const needed=Math.min(200,status.retained-page*200);const old=pages.current.get(page);if((old&&old.length>=needed)||pending.current.has(page))continue;pending.current.add(page);
      void api.searchResults(id,sid,page*200).then(([,items])=>{if(activeSearch.current!==sid)return;pages.current.set(page,items);if(pages.current.size>8){const oldest=pages.current.keys().next().value;if(oldest!==undefined&&oldest!==page)pages.current.delete(oldest);}refresh(n=>n+1);}).catch(()=>{}).finally(()=>pending.current.delete(page));
    }
  },[id,sid,first,last,status?.retained,revision]);
  async function select(index:number){if(!sid||!status?.retained)return;const n=(index+status.retained)%status.retained;let item=pages.current.get(Math.floor(n/200))?.[n%200];if(!item){const [,items]=await api.searchResults(id,sid,Math.floor(n/200)*200);pages.current.set(Math.floor(n/200),items);item=items[n%200];refresh(x=>x+1);}if(item){setSelected(n);onJump(item.offset);virtual.scrollToIndex(n,{align:'auto'});}}
  return <aside className="search-panel">
    <div className="panel-heading"><span>全文搜索</span><button className="icon-button" title="关闭搜索" onClick={onClose}><X size={17}/></button></div>
    <div className="search-field"><Search size={16}/><input ref={input} value={query} aria-label="搜索关键词" placeholder="在文档中查找" maxLength={1024} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void select(selected+(e.shiftKey?-1:1));}if(e.key==='Escape')onClose();}}/><button className={`icon-button small ${sensitive?'selected':''}`} title="区分大小写" aria-pressed={sensitive} onClick={()=>setSensitive(!sensitive)}><CaseSensitive size={17}/></button></div>
    <div className="search-summary"><span>{status?`${status.count.toLocaleString()} 处匹配`:query?'正在准备搜索…':'搜索整份文档'}</span><div className="button-group"><button className="icon-button small" title="上一个结果" disabled={!status?.retained} onClick={()=>void select(selected-1)}><ArrowUp size={15}/></button><button className="icon-button small" title="下一个结果" disabled={!status?.retained} onClick={()=>void select(selected+1)}><ArrowDown size={15}/></button>{status&&!status.complete&&<button className="icon-button small" title="停止搜索" onClick={()=>void api.cancel(id,sid||undefined)}><Square size={12}/></button>}</div></div>
    {status&&!status.complete&&<div className="scan-progress"><div style={{width:`${status.scanned/Math.max(1,status.total)*100}%`}}/></div>}
    {error&&<div className="panel-message">{error}</div>}
    {status?.complete&&status.count===0&&<div className="sidebar-empty"><Search size={24}/><span>没有找到匹配内容</span></div>}
    {status?.truncated&&<div className="panel-message">显示前 10,000 个结果；扫描继续统计全部匹配。</div>}
    <div className="search-results" ref={parent}><div style={{height:virtual.getTotalSize(),position:'relative'}}>{rows.map(row=>{const item=pages.current.get(Math.floor(row.index/200))?.[row.index%200];return <button key={row.index} className={`search-result ${selected===row.index?'active':''}`} style={{position:'absolute',top:0,width:'100%',height:76,transform:`translateY(${row.start}px)`}} onClick={()=>void select(row.index)}>{item?<><span className="result-number">{String(row.index+1).padStart(2,'0')}<span>{(item.offset/1024).toFixed(1)} KB</span></span><span className="result-preview">{item.preview}</span></>:<LoaderCircle className="spin" size={14}/>}</button>;})}</div></div>
  </aside>;
}
