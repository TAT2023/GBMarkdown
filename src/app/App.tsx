import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Check, ChevronDown, FileText, FolderOpen, History, ListTree, LoaderCircle, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Search, Sun, X, RotateCw, Minus, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api, native, type DocumentInfo, type IndexStatus, type Settings } from '../services/document-api';
import Outline from '../components/Outline';
import MarkdownView from '../components/MarkdownView';
import SearchPanel from '../components/SearchPanel';
import { version } from '../../package.json';

const defaultSettings:Settings={recent:[],theme:'light',sidebar:true,fontSize:16,width:1280,height:860};
const formatBytes=(bytes:number)=>bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GiB`:bytes>=1024**2?`${(bytes/1024**2).toFixed(1)} MiB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KB`:`${bytes} B`;
export default function App(){
  const [settings,setSettings]=useState<Settings>(defaultSettings);const settingsRef=useRef(settings);settingsRef.current=settings;
  const [doc,setDoc]=useState<DocumentInfo|null>(null);const docRef=useRef(doc);docRef.current=doc;
  const [status,setStatus]=useState<IndexStatus|null>(null);const [opening,setOpening]=useState(false);const [changed,setChanged]=useState(false);const [warning,setWarning]=useState<string|null>(null);const [error,setError]=useState('');
  const [outlinePosition,setOutlinePosition]=useState(0);const indexReady=useRef(false);
  const [target,setTarget]=useState({offset:0,version:0});const [offset,setOffset]=useState(0);const offsetRef=useRef(offset);offsetRef.current=offset;
  const [searchOpen,setSearchOpen]=useState(false);const [query,setQuery]=useState('');const [tab,setTab]=useState<'outline'|'recent'>('outline');const [menu,setMenu]=useState(false);const [jumpOpen,setJumpOpen]=useState(false);const [jumpValue,setJumpValue]=useState('0');const generation=useRef(0);
  const progress=doc?Math.min(100,offset/Math.max(1,doc.size)*100):0;
  const jump=useCallback((n:number)=>{setOffset(n);setTarget(t=>({offset:n,version:t.version+1}));},[]);
  const updateSettings=(partial:Partial<Settings>)=>setSettings(old=>({...old,...partial}));
  const remember=useCallback(()=>{
    const d=docRef.current;if(!d)return;
    setSettings(s=>({...s,recent:[{path:d.path,name:d.name,size:d.size,offset:offsetRef.current,openedAt:Date.now()},...s.recent.filter(r=>r.path!==d.path)].slice(0,20)}));
  },[]);
  const accept=useCallback((info:DocumentInfo)=>{
    remember();setDoc(info);setChanged(false);setWarning(null);setError('');setStatus(null);indexReady.current=false;setOutlinePosition(0);setSearchOpen(false);setQuery('');setTab('outline');
    const saved=settingsRef.current.recent.find(r=>r.path===info.path);const start=saved?.offset||0;setOffset(start);setTarget(t=>({offset:start,version:t.version+1}));
    setSettings(s=>({...s,recent:[{path:info.path,name:info.name,size:info.size,offset:start,openedAt:Date.now()},...s.recent.filter(r=>r.path!==info.path)].slice(0,20)}));
  },[remember]);
  const openPath=useCallback(async(path:string)=>{const g=++generation.current;setOpening(true);setError('');remember();try{const info=await api.open(path);if(g===generation.current)accept(info);}catch(e){if(g===generation.current){setError(String(e));setDoc(null);}}finally{if(g===generation.current)setOpening(false);}},[accept,remember]);
  const pick=useCallback(async()=>{const g=++generation.current;setOpening(true);remember();try{const info=await api.pick();if(info&&g===generation.current)accept(info);}catch(e){setError(String(e));}finally{setOpening(false);}},[accept,remember]);
  const close=useCallback(async()=>{generation.current++;remember();const d=docRef.current;setDoc(null);setStatus(null);setSearchOpen(false);setWarning(null);setChanged(false);if(d)await api.close(d.id).catch(e=>setError(String(e)));},[remember]);
  useEffect(()=>{let cancelled=false;
    void api.settings().then(async(s)=>{if(cancelled)return;setSettings({...defaultSettings,...s});settingsRef.current={...defaultSettings,...s};const path=await api.launch();if(cancelled)return;if(path)void openPath(path);else if(!native){const info=await api.demo();if(!cancelled)accept(info);}}).catch(e=>setError(String(e)));
    return()=>{cancelled=true;};
  },[]);
  useEffect(()=>{document.documentElement.dataset.theme=settings.theme;},[settings.theme]);
  useEffect(()=>{const timer=setTimeout(()=>{void api.save(settings).catch(()=>{});},400);return()=>clearTimeout(timer);},[settings]);
  useEffect(()=>{if(!doc)return;let stopped=false;let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{try{const s=await api.status(doc.id,offsetRef.current);if(stopped)return;setStatus(s.index);setOutlinePosition(s.outlinePosition);if(s.index.complete&&!indexReady.current){indexReady.current=true;setTarget(t=>({offset:offsetRef.current,version:t.version+1}));}if(s.changed){setChanged(true);void api.cancel(doc.id);}if(s.index.error)setWarning(s.index.error);}catch(e){if(!stopped)setWarning(String(e));}if(!stopped)timer=setTimeout(poll,600);};void poll();return()=>{stopped=true;clearTimeout(timer);};
  },[doc?.id]);
  useEffect(()=>{const timer=setInterval(remember,5000);return()=>clearInterval(timer);},[remember]);
  useEffect(()=>{if(!native)return;let unlisten:(()=>void)|undefined;let cancelled=false;
    void import('@tauri-apps/api/webview').then(({getCurrentWebview})=>getCurrentWebview().onDragDropEvent(e=>{if(e.payload.type==='drop'){const path=e.payload.paths[0];if(path)void openPath(path);}})).then(fn=>{if(cancelled)fn();else unlisten=fn;});
    let offResize:(()=>void)|undefined;
    void import('@tauri-apps/api/window').then(async({getCurrentWindow,LogicalSize})=>{const win=getCurrentWindow();const s=await api.settings();if(s.width>=700&&s.height>=480)await win.setSize(new LogicalSize(s.width,s.height));offResize=await win.onResized(async()=>{const size=await win.innerSize();const factor=await win.scaleFactor();setSettings(old=>({...old,width:size.width/factor,height:size.height/factor}));});if(cancelled)offResize();});
    return()=>{cancelled=true;unlisten?.();offResize?.();};
  },[openPath]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{
    if(e.ctrlKey&&e.key.toLowerCase()==='o'){e.preventDefault();void pick();}
    if(e.ctrlKey&&e.key.toLowerCase()==='f'){e.preventDefault();if(docRef.current)setSearchOpen(true);}
    if(e.ctrlKey&&e.key.toLowerCase()==='g'){e.preventDefault();setJumpValue(progress.toFixed(1));setJumpOpen(true);}
    if(e.key==='Escape'){setMenu(false);setJumpOpen(false);setSearchOpen(false);setQuery('');}
    if(e.ctrlKey&&e.key==='Home'){e.preventDefault();jump(0);}
    if(e.ctrlKey&&e.key==='End'){e.preventDefault();if(docRef.current)jump(docRef.current.size-1);}
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[pick,jump,progress]);
  return <div className="application" onDragOver={e=>{if(!native)e.preventDefault();}} onDrop={e=>{if(native)return;e.preventDefault();setError('浏览器预览请使用打开文件按钮；桌面版支持资源管理器拖放。');}}>
    <header className="toolbar">
      <div className="brand"><span className="brand-icon"><FileText size={21}/></span><span>GBMarkdown</span></div>
      <div className="toolbar-separator"/>
      <button className="icon-button" title={settings.sidebar?'收起侧边栏':'显示侧边栏'} aria-label="切换侧边栏" onClick={()=>updateSettings({sidebar:!settings.sidebar})}>{settings.sidebar?<PanelLeftClose size={19}/>:<PanelLeftOpen size={19}/>}</button>
      <button className="open-button" onClick={()=>void pick()} disabled={opening}>{opening?<LoaderCircle size={16} className="spin"/>:<FolderOpen size={16}/>}<span>打开文件</span></button>
      <div className="toolbar-document">{doc&&<><span className="document-divider">/</span><span title={doc.path}>{doc.name}</span></>}</div>
      <div className="toolbar-actions"><button className={`icon-button ${searchOpen?'selected':''}`} title="全文搜索" aria-label="全文搜索" disabled={!doc} onClick={()=>setSearchOpen(!searchOpen)}><Search size={19}/></button><span className="toolbar-separator"/><button className="icon-button" title={settings.theme==='light'?'切换暗色主题':'切换亮色主题'} aria-label="切换主题" onClick={()=>updateSettings({theme:settings.theme==='light'?'dark':'light'})}>{settings.theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button><div className="menu-wrap"><button className="icon-button" title="阅读设置" aria-label="阅读设置" onClick={()=>setMenu(!menu)}><MoreHorizontal size={20}/></button>{menu&&<><div className="dismiss-layer" onClick={()=>setMenu(false)}/><div className="settings-menu"><div className="menu-label">阅读字号</div><div className="font-control"><button className="icon-button" title="缩小字号" disabled={settings.fontSize<=12} onClick={()=>updateSettings({fontSize:settings.fontSize-1})}><Minus size={16}/></button><span>{settings.fontSize} px</span><button className="icon-button" title="增大字号" disabled={settings.fontSize>=24} onClick={()=>updateSettings({fontSize:settings.fontSize+1})}><Plus size={16}/></button></div><hr/><button onClick={()=>{setTab('recent');updateSettings({sidebar:true});setMenu(false);}}><History size={16}/>最近文件</button><button disabled={!doc} onClick={()=>{void close();setMenu(false);}}><X size={16}/>关闭文档</button></div></>}</div></div>
    </header>
    <div className="workspace">
      {settings.sidebar&&<aside className="sidebar"><div className="sidebar-tabs"><button className={tab==='outline'?'active':''} onClick={()=>setTab('outline')}><ListTree size={15}/>文档大纲</button><button className={tab==='recent'?'active':''} onClick={()=>setTab('recent')} title="最近文件"><History size={16}/></button></div>
        {tab==='outline'?<><div className="outline-caption"><span>{doc?'目录':'工作区'}</span><span>{status?.headings?`${status.headings.toLocaleString()} 个标题`:''}</span></div>{doc?<Outline id={doc.id} count={status?.headings||0} offset={offset} currentIndex={outlinePosition} onJump={jump}/>:<div className="sidebar-empty"><ListTree size={25}/><span>打开文档后显示大纲</span></div>}</>:<div className="recent-list"><div className="outline-caption"><span>最近打开</span><span>{settings.recent.length}</span></div>{settings.recent.length?settings.recent.map(r=><button key={r.path} className="recent-item" title={r.path} onClick={()=>void openPath(r.path)}><FileText size={17}/><span><strong>{r.name}</strong><small>{formatBytes(r.size)} · {(r.offset/Math.max(1,r.size)*100).toFixed(1)}%</small></span></button>):<div className="sidebar-empty">暂无最近文件</div>}</div>}
        <div className="sidebar-footer"><span className="status-dot"/>本地 · 离线阅读<span className="version">v{version}</span></div>
      </aside>}
      <main className="reader-main">
        {doc&&<div className="document-bar"><div><FileText size={15}/><span>{doc.name}</span><span className="size-tag">{formatBytes(doc.size)}</span></div><button className="progress-button" title="跳转到阅读百分比" onClick={()=>{setJumpValue(progress.toFixed(1));setJumpOpen(true);}}>{progress.toFixed(1)}%<ChevronDown size={13}/></button></div>}
        {changed&&<div className="notice changed"><AlertCircle size={16}/><span>源文件已发生变化，请重新加载。</span><button onClick={()=>doc&&void openPath(doc.path)}><RotateCw size={14}/>重新加载</button></div>}
        {error&&<div className="notice error"><AlertCircle size={16}/><span>{error}</span><button className="icon-button small" title="关闭提示" onClick={()=>setError('')}><X size={14}/></button></div>}
        {doc?<MarkdownView key={doc.id} doc={doc} target={target} fontSize={settings.fontSize} query={query} onProgress={setOffset} onWarning={setWarning}/>:<div className="empty-reader"><div className="empty-logo"><FileText size={36}/></div><h1>GBMarkdown</h1><p>打开 Markdown 文档</p><button className="primary-button" onClick={()=>void pick()} disabled={opening}><FolderOpen size={18}/>选择本地文件</button>{settings.recent.length>0&&<div className="empty-recents"><span>最近打开</span>{settings.recent.slice(0,3).map(r=><button key={r.path} onClick={()=>void openPath(r.path)}><FileText size={15}/><span>{r.name}</span><small>{formatBytes(r.size)}</small></button>)}</div>}</div>}
        {doc&&<div className="global-navigation"><button className="icon-button small" title="跳到开头" onClick={()=>jump(0)}><ArrowUpToLine size={14}/></button><input type="range" min="0" max="1000" step="1" value={Math.round(progress*10)} aria-label="全局阅读进度" onChange={e=>{const n=Number(e.target.value)/1000*doc.size;setOffset(n);setTarget(t=>({offset:Math.min(doc.size-1,n),version:t.version+1}));}} style={{'--progress':`${progress}%`} as React.CSSProperties}/><button className="icon-button small" title="跳到结尾" onClick={()=>jump(doc.size-1)}><ArrowDownToLine size={14}/></button></div>}
      </main>
      {doc&&searchOpen&&<SearchPanel key={doc.id} id={doc.id} onJump={jump} onQuery={setQuery} onClose={()=>{setSearchOpen(false);setQuery('');}}/>}
    </div>
    <footer className="statusbar"><div>{doc?<><FileText size={12}/><span>{doc.name}</span><span className="status-divider"/><span>{formatBytes(doc.size)}</span><span className="status-divider"/><span>{doc.encoding}</span></>:<span>就绪</span>}</div><div className="status-right">{warning?<span className="warning-status" title={warning}><AlertCircle size={12}/>{warning.includes('Invalid')?'编码兼容模式':warning.includes('index')?'索引构建中 · 文本窗口':'兼容阅读模式'}</span>:doc?<span className="render-status"><Check size={12}/>按需渲染</span>:null}{doc&&<><span className="status-divider"/><span>阅读进度 {progress.toFixed(1)}%</span><span className="status-divider"/><span className="index-status">{status?.complete?<><CheckCircle2 size={12}/>索引已就绪</>:<><LoaderCircle size={12} className="spin"/>索引 {status?(status.scanned/Math.max(1,status.total)*100).toFixed(0):0}%</>}</span></>}</div></footer>
    {jumpOpen&&doc&&<div className="modal-backdrop" onClick={()=>setJumpOpen(false)}><form className="jump-dialog" onClick={e=>e.stopPropagation()} onSubmit={e=>{e.preventDefault();const value=Number(jumpValue);if(Number.isFinite(value)){jump(Math.min(doc.size-1,Math.max(0,value)/100*doc.size));setJumpOpen(false);}}}><div className="panel-heading"><span>跳转到文档位置</span><button type="button" className="icon-button" title="关闭" onClick={()=>setJumpOpen(false)}><X size={16}/></button></div><label>阅读百分比<div className="percent-input"><input autoFocus type="number" min="0" max="100" step="0.1" value={jumpValue} onChange={e=>setJumpValue(e.target.value)}/><span>%</span></div></label><button className="primary-button" type="submit">跳转</button></form></div>}
  </div>;
}
