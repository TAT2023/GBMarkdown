import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpToLine, Check, CheckCircle2, ChevronDown, FileText, LoaderCircle, RotateCw, Search, X } from 'lucide-react';
import { api, type DocumentInfo, type IndexStatus } from '../services/document-api';
import { ReadingHistory, type ReadingPosition } from '../services/navigation';
import MarkdownView, { type ReaderHandle } from './MarkdownView';
import Outline from './Outline';
import SearchPanel from './SearchPanel';
import { formatBytes } from '../services/format';

export interface PaneHandle { capture:()=>ReadingPosition }
export interface PaneHosts { controls:HTMLElement|null; outline:HTMLElement|null; search:HTMLElement|null; status:HTMLElement|null }
interface Props {
  doc:DocumentInfo; initialOffset:number; active:boolean; visible:boolean; comparing:boolean; fontSize:number;
  hosts:PaneHosts; onActivate:()=>void; onRemember:(doc:DocumentInfo,offset:number)=>void;
  onReload:(doc:DocumentInfo)=>void; onRemove:()=>void; ref:Ref<PaneHandle>;
}

export default function DocumentPane({doc,initialOffset,active,visible,comparing,fontSize,hosts,onActivate,onRemember,onReload,onRemove,ref}:Props) {
  const [status,setStatus]=useState<IndexStatus|null>(null);
  const [changed,setChanged]=useState(false),[warning,setWarning]=useState<string|null>(null),[error,setError]=useState('');
  const [target,setTarget]=useState({offset:initialOffset,displacement:0,version:0});
  const [offset,setOffset]=useState(initialOffset),[outlinePosition,setOutlinePosition]=useState(0);
  const offsetRef=useRef(offset);offsetRef.current=offset;
  const reader=useRef<ReaderHandle>(null),history=useRef(new ReadingHistory()),indexReady=useRef(false),navigation=useRef(0);
  const [historyState,setHistoryState]=useState({back:false,forward:false});
  const [locating,setLocating]=useState(false),[searchOpen,setSearchOpen]=useState(false),[query,setQuery]=useState('');
  const [sensitive,setSensitive]=useState(false);
  const [searchDraft,setSearchDraft]=useState('');
  const [jumpOpen,setJumpOpen]=useState(false),[jumpValue,setJumpValue]=useState('0');
  const sliderGesture=useRef({active:false,saved:false});
  const progress=Math.min(100,offset/Math.max(1,doc.size)*100);
  const position=useCallback(()=>reader.current?.position()||{offset:offsetRef.current,displacement:target.displacement},[target.displacement]);
  const refreshHistory=()=>setHistoryState({back:history.current.canBack,forward:history.current.canForward});
  const navigate=useCallback((p:ReadingPosition)=>{
    navigation.current++;setLocating(false);offsetRef.current=p.offset;setOffset(p.offset);setTarget(t=>({...p,version:t.version+1}));
  },[]);
  const jump=useCallback((n:number)=>{
    history.current.visit(position());refreshHistory();
    navigate({offset:Math.round(Math.max(doc.bom,Math.min(Math.max(doc.bom,doc.size-1),n))),displacement:0});
  },[doc.bom,doc.size,navigate,position]);
  const travel=useCallback((direction:'back'|'forward')=>{
    const p=history.current.move(direction,position());if(p){refreshHistory();navigate(p);}
  },[navigate,position]);
  useImperativeHandle(ref,()=>({
    capture:()=>{const p=position();setTarget(t=>({...p,version:t.version}));offsetRef.current=p.offset;setOffset(p.offset);onRemember(doc,p.offset);return p;}
  }),[position,doc,onRemember]);
  useEffect(()=>{
    if(!visible)return;let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try {
        const s=await api.status(doc.id,offsetRef.current);if(stopped)return;
        setStatus(s.index);setOutlinePosition(s.outlinePosition);
        if(s.index.complete&&!indexReady.current){indexReady.current=true;const p=reader.current?.position()||{offset:offsetRef.current,displacement:0};setTarget(t=>({...p,version:t.version+1}));}
        if(s.changed){navigation.current++;setLocating(false);setChanged(true);void api.cancel(doc.id).catch(()=>{});}
        if(s.index.error)setWarning(s.index.error);
      }catch(e){if(!stopped)setWarning(String(e));}
      if(!stopped)timer=setTimeout(poll,600);
    };
    void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[doc.id,visible]);
  useEffect(()=>{
    const timer=setInterval(()=>onRemember(doc,offsetRef.current),5000);
    return()=>{clearInterval(timer);navigation.current++;};
  },[doc,onRemember]);
  useEffect(()=>{
    if(active)return;
    navigation.current++;setLocating(false);setJumpOpen(false);
    // A hidden search panel cancels its scan; its query still belongs to this document.
  },[active]);
  const followLink=useCallback(async(href:string)=>{
    if(!href.startsWith('#')){try{await api.external(href);}catch(e){setError(String(e));}return;}
    const token=++navigation.current;
    try {
      const fragment=decodeURIComponent(href.slice(1));if(fragment.length>16384)throw new Error('链接目标过长');
      while(token===navigation.current){
        const result=await api.anchor(doc.id,fragment);if(token!==navigation.current)return;
        if(result.offset!==null){setError('');jump(result.offset);return;}
        if(result.complete)throw new Error(`未找到链接目标：${fragment}`);
        setLocating(true);await new Promise(resolve=>setTimeout(resolve,400));
      }
    }catch(e){if(token===navigation.current){setLocating(false);setError(e instanceof URIError?'链接的锚点编码无效':String(e));}}
  },[doc.id,jump]);
  useEffect(()=>{
    if(!active)return;
    const key=(e:KeyboardEvent)=>{
      if(e.altKey&&!e.ctrlKey&&!e.metaKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){e.preventDefault();travel(e.key==='ArrowLeft'?'back':'forward');}
      if(e.ctrlKey&&e.key.toLowerCase()==='f'){e.preventDefault();setSearchOpen(true);}
      if(e.ctrlKey&&e.key.toLowerCase()==='g'){e.preventDefault();setJumpValue(progress.toFixed(1));setJumpOpen(true);}
      if(e.ctrlKey&&e.key==='Home'){e.preventDefault();jump(0);}
      if(e.ctrlKey&&e.key==='End'){e.preventDefault();jump(doc.size-1);}
      if(e.key==='Escape'){setJumpOpen(false);setSearchOpen(false);setQuery('');setSearchDraft('');}
    };
    const mouse=(e:MouseEvent)=>{if(e.button===3||e.button===4){e.preventDefault();travel(e.button===3?'back':'forward');}};
    window.addEventListener('keydown',key);window.addEventListener('mouseup',mouse);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('mouseup',mouse);};
  },[active,travel,jump,doc.size,progress]);
  const closeSearch=()=>{setSearchOpen(false);setQuery('');setSearchDraft('');};
  return <>
    {active&&hosts.controls&&createPortal(<>
      <button className="icon-button" title="后退 (Alt+←)" aria-label="后退" disabled={!historyState.back} onClick={()=>travel('back')}><ArrowLeft size={18}/></button>
      <button className="icon-button" title="前进 (Alt+→)" aria-label="前进" disabled={!historyState.forward} onClick={()=>travel('forward')}><ArrowRight size={18}/></button>
      <button className={`icon-button ${searchOpen?'selected':''}`} title="全文搜索" aria-label="全文搜索" onClick={()=>setSearchOpen(!searchOpen)}><Search size={19}/></button>
    </>,hosts.controls)}
    {active&&hosts.outline&&createPortal(<>
      <div className="outline-caption"><span title={doc.path}>{doc.name}</span><span>{status?.headings?`${status.headings.toLocaleString()} 个标题`:''}</span></div>
      <Outline key={doc.id} id={doc.id} count={status?.headings||0} offset={offset} currentIndex={outlinePosition} onJump={jump}/>
    </>,hosts.outline)}
    {active&&searchOpen&&hosts.search&&createPortal(<SearchPanel key={doc.id} id={doc.id} initialQuery={searchDraft} initialSensitive={sensitive} onDraftChange={setSearchDraft} onSensitiveChange={setSensitive} onJump={jump} onQuery={setQuery} onClose={closeSearch}/>,hosts.search)}
    {active&&hosts.status&&createPortal(<>
      <div><FileText size={12}/><span title={doc.path}>{doc.name}</span><span className="status-divider"/><span>{formatBytes(doc.size)}</span><span className="status-divider"/><span>{doc.encoding}</span></div>
      <div className="status-right">{warning?<span className="warning-status" title={warning}><AlertCircle size={12}/>兼容阅读模式</span>:<span className="render-status"><Check size={12}/>按需渲染</span>}<span className="status-divider"/><span>阅读进度 {progress.toFixed(1)}%</span><span className="status-divider"/><span className="index-status">{status?.complete?<><CheckCircle2 size={12}/>索引已就绪</>:<><LoaderCircle size={12} className="spin"/>索引 {status?(status.scanned/Math.max(1,status.total)*100).toFixed(0):0}%</>}</span></div>
    </>,hosts.status)}
    <section id={`pane-${doc.id}`} role="tabpanel" aria-labelledby={`tab-${doc.id}`} className={`document-pane${active?' active':''}`} hidden={!visible} data-document-id={doc.id} onPointerDownCapture={onActivate} onFocusCapture={onActivate}>
      <div className="document-bar"><div><FileText size={15}/><span title={doc.path}>{doc.name}</span><span className="size-tag">{formatBytes(doc.size)}</span></div><div><button className="progress-button" title="跳转到阅读百分比" onClick={()=>{setJumpValue(progress.toFixed(1));setJumpOpen(true);}}>{progress.toFixed(1)}%<ChevronDown size={13}/></button>{comparing&&<button className="icon-button small" title="移出对比" aria-label={`移出对比 ${doc.name}`} onClick={onRemove}><X size={14}/></button>}</div></div>
      {changed&&<div className="notice changed"><AlertCircle size={16}/><span>源文件已发生变化，请重新加载。</span><button onClick={()=>onReload(doc)}><RotateCw size={14}/>重新加载</button></div>}
      {error&&<div className="notice error"><AlertCircle size={16}/><span>{error}</span><button className="icon-button small" title="关闭提示" onClick={()=>setError('')}><X size={14}/></button></div>}
      {locating&&<div className="notice"><LoaderCircle size={16} className="spin"/><span>正在索引链接目标…</span><button onClick={()=>{navigation.current++;setLocating(false);}}>取消</button></div>}
      {visible&&<MarkdownView ref={reader} doc={doc} target={target} fontSize={fontSize} query={query} onProgress={setOffset} onWarning={setWarning} onLink={href=>void followLink(href)} onJump={jump}/>}
      <div className="global-navigation"><button className="icon-button small" title="跳到开头" onClick={()=>jump(0)}><ArrowUpToLine size={14}/></button><input type="range" min="0" max="1000" step="1" value={Math.round(progress*10)} aria-label="全局阅读进度" onPointerDown={()=>{sliderGesture.current={active:true,saved:false};}} onPointerUp={()=>{sliderGesture.current.active=false;}} onPointerCancel={()=>{sliderGesture.current.active=false;}} onBlur={()=>{sliderGesture.current.active=false;}} onChange={e=>{
        const n=Math.round(Number(e.target.value)/1000*Math.max(0,doc.size-1));
        if(!sliderGesture.current.active){jump(n);return;}
        if(!sliderGesture.current.saved){history.current.visit(position());refreshHistory();sliderGesture.current.saved=true;}navigate({offset:n,displacement:0});
      }} style={{'--progress':`${progress}%`} as React.CSSProperties}/><button className="icon-button small" title="跳到结尾" onClick={()=>jump(doc.size-1)}><ArrowDownToLine size={14}/></button></div>
    </section>
    {active&&jumpOpen&&<div className="modal-backdrop" onClick={()=>setJumpOpen(false)}><form className="jump-dialog" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();const value=Number(jumpValue);if(Number.isFinite(value)){jump(Math.min(doc.size-1,Math.max(0,value)/100*doc.size));setJumpOpen(false);}}}><div className="panel-heading"><span>跳转到文档位置</span><button type="button" className="icon-button" title="关闭" onClick={()=>setJumpOpen(false)}><X size={16}/></button></div><label>阅读百分比<div className="percent-input"><input autoFocus type="number" min="0" max="100" step="0.1" value={jumpValue} onChange={e=>setJumpValue(e.target.value)}/><span>%</span></div></label><button className="primary-button" type="submit">跳转</button></form></div>}
  </>;
}
