import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, BookOpen, Columns2, FileText, FolderOpen, History, ListTree, LoaderCircle, Minus, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Sun, X } from 'lucide-react';
import { api, native, type DocumentInfo, type Settings } from '../services/document-api';
import { formatBytes } from '../services/format';
import { version } from '../../package.json';
import { useTheme } from '../hooks/useTheme';
import Titlebar from '../components/Titlebar';
import DocumentPane, { type PaneHandle, type PaneHosts } from '../components/DocumentPane';

const defaultSettings:Settings={recent:[],theme:'light',sidebar:true,fontSize:16,width:1280,height:860};
interface OpenTab { doc:DocumentInfo; initialOffset:number }
export default function App(){
  const [settings,setSettings]=useState<Settings>(defaultSettings),[settingsReady,setSettingsReady]=useState(false);
  const settingsRef=useRef(settings);settingsRef.current=settings;
  const [tabs,setTabs]=useState<OpenTab[]>([]),[activeId,setActiveId]=useState('');
  const tabsRef=useRef(tabs);tabsRef.current=tabs;
  const activeRef=useRef(activeId);activeRef.current=activeId;
  const [mode,setMode]=useState<'single'|'compare'>('single'),[comparison,setComparison]=useState<string[]>([]);
  const [opening,setOpening]=useState(false),[error,setError]=useState(''),[menu,setMenu]=useState(false),[sidebarTab,setSidebarTab]=useState<'outline'|'recent'>('outline');
  const [controlsHost,setControlsHost]=useState<HTMLDivElement|null>(null),[outlineHost,setOutlineHost]=useState<HTMLDivElement|null>(null);
  const [searchHost,setSearchHost]=useState<HTMLDivElement|null>(null),[statusHost,setStatusHost]=useState<HTMLElement|null>(null);
  const panes=useRef(new Map<string,PaneHandle>()),queue=useRef(Promise.resolve());
  const activeDoc=tabs.find(t=>t.doc.id===activeId)?.doc;
  const hosts:PaneHosts={controls:controlsHost,outline:sidebarTab==='outline'?outlineHost:null,search:searchHost,status:statusHost};
  const capture=useCallback(()=>{for(const pane of panes.current.values())pane.capture();},[]);
  const remember=useCallback((doc:DocumentInfo,offset:number)=>{
    setSettings(s=>({...s,recent:s.recent.map(r=>r.path===doc.path?{...r,offset}:r)}));
  },[]);
  const activate=useCallback((id:string)=>{
    if(activeRef.current===id)return;capture();const previous=activeRef.current;activeRef.current=id;setActiveId(id);
    setComparison(ids=>ids.includes(id)?ids:ids.length<4?[...ids,id]:ids.map(value=>value===previous?id:value));
  },[capture]);
  const accept=useCallback((doc:DocumentInfo)=>{
    capture();const existing=tabsRef.current.find(t=>t.doc.id===doc.id);
    const initialOffset=settingsRef.current.recent.find(r=>r.path===doc.path)?.offset||0;
    if(!existing){const next=[...tabsRef.current,{doc,initialOffset}];tabsRef.current=next;setTabs(next);}
    const previous=activeRef.current;activeRef.current=doc.id;setActiveId(doc.id);
    setComparison(ids=>ids.includes(doc.id)?ids:ids.length<4?[...ids,doc.id]:ids.map(id=>id===previous?doc.id:id));
    setSettings(s=>({...s,recent:[{path:doc.path,name:doc.name,size:doc.size,offset:existing?s.recent.find(r=>r.path===doc.path)?.offset||0:initialOffset,openedAt:Date.now()},...s.recent.filter(r=>r.path!==doc.path)].slice(0,20)}));
    setSidebarTab('outline');
  },[capture]);
  const openFiles=useCallback((files:Array<string|File>)=>{
    queue.current=queue.current.then(async()=>{
      setOpening(true);setError('');const failures:string[]=[];
      try{for(const file of files){try{accept(await api.open(file));}catch(e){failures.push(`${typeof file==='string'?file:file.name}：${String(e)}`);}}}
      finally{setOpening(false);if(failures.length)setError(failures.join('\n'));}
    });return queue.current;
  },[accept]);
  const pick=useCallback(async()=>{try{const files=await api.pickFiles();if(files.length)await openFiles(files);}catch(e){setError(String(e));}},[openFiles]);
  const close=useCallback(async(id:string)=>{
    panes.current.get(id)?.capture();
    const old=tabsRef.current,index=old.findIndex(t=>t.doc.id===id);const next=old.filter(t=>t.doc.id!==id);
    tabsRef.current=next;setTabs(next);
    setComparison(ids=>{const remaining=ids.filter(value=>value!==id);return remaining.length?remaining:next.slice(0,1).map(t=>t.doc.id);});
    if(activeRef.current===id){const nextId=next[Math.min(index,next.length-1)]?.doc.id||'';activeRef.current=nextId;setActiveId(nextId);setComparison(ids=>ids.includes(nextId)||!nextId?ids:ids.length<4?[...ids,nextId]:[nextId,...ids.slice(0,3)]);}
    try{await api.close(id);}catch(e){setError(String(e));}
  },[]);
  const reload=useCallback((doc:DocumentInfo)=>{
    queue.current=queue.current.then(async()=>{
      const position=panes.current.get(doc.id)?.capture();setOpening(true);
      try{
        await api.close(doc.id);const info=await api.open(doc.path);
        const next=tabsRef.current.map(t=>t.doc.id===doc.id?{doc:info,initialOffset:position?.offset||0}:t);
        // A tab may have been closed while the filesystem operation was in flight.
        if(!next.some(t=>t.doc.id===info.id)){await api.close(info.id);return;}
        tabsRef.current=next;setTabs(next);setComparison(ids=>ids.map(id=>id===doc.id?info.id:id));
        if(activeRef.current===doc.id){activeRef.current=info.id;setActiveId(info.id);}
      }catch(e){setError(String(e));}finally{setOpening(false);}
    });
  },[]);
  const switchMode=(next:'single'|'compare')=>{
    capture();setMode(next);
    if(next==='compare')setComparison(ids=>{const selection=ids.filter(id=>tabs.some(t=>t.doc.id===id));return selection.includes(activeId)?selection:[activeId,...selection].slice(0,4);});
  };
  const toggleComparison=(id:string)=>{
    capture();const next=comparison.includes(id)?comparison.filter(value=>value!==id):comparison.length<4?[...comparison,id]:comparison;
    if(!next.length){setMode('single');return;}
    setComparison(next);if(!next.includes(activeRef.current)){activeRef.current=next[0];setActiveId(next[0]);}
  };
  useEffect(()=>{let cancelled=false;
    void api.settings().then(async s=>{
      if(cancelled)return;const restored={...defaultSettings,...s};setSettings(restored);settingsRef.current=restored;setSettingsReady(true);
      const path=await api.launch();if(cancelled)return;
      if(path)void openFiles([path]);else if(!native){const info=await api.demo();if(cancelled)await api.close(info.id);else accept(info);}
    }).catch(e=>{if(!cancelled){setSettingsReady(true);setError(String(e));}});
    return()=>{cancelled=true;};
  },[]);
  useTheme(settings.theme,settingsReady,setError);
  useEffect(()=>{if(!settingsReady)return;const timer=setTimeout(()=>{void api.save(settings).catch(()=>{});},400);return()=>clearTimeout(timer);},[settings,settingsReady]);
  useEffect(()=>{
    if(!native)return;let cancelled=false;let unlisten:(()=>void)|undefined,offResize:(()=>void)|undefined;
    void import('@tauri-apps/api/webview').then(({getCurrentWebview})=>getCurrentWebview().onDragDropEvent(e=>{if(e.payload.type==='drop')void openFiles(e.payload.paths);})).then(fn=>{if(cancelled)fn();else unlisten=fn;});
    void import('@tauri-apps/api/window').then(async({getCurrentWindow,LogicalSize})=>{
      const win=getCurrentWindow(),s=await api.settings();if(cancelled)return;if(s.width>=700&&s.height>=480)await win.setSize(new LogicalSize(s.width,s.height));
      offResize=await win.onResized(async()=>{const size=await win.innerSize(),factor=await win.scaleFactor();setSettings(old=>({...old,width:size.width/factor,height:size.height/factor}));});if(cancelled)offResize();
    }).catch(e=>{if(!cancelled)setError(String(e));});
    return()=>{cancelled=true;unlisten?.();offResize?.();};
  },[openFiles]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.ctrlKey&&e.key.toLowerCase()==='o'){e.preventDefault();void pick();}
      if(e.ctrlKey&&e.key.toLowerCase()==='w'){e.preventDefault();if(activeRef.current)void close(activeRef.current);}
      if(e.ctrlKey&&e.key==='Tab'&&tabs.length){e.preventDefault();const index=tabs.findIndex(t=>t.doc.id===activeRef.current);activate(tabs[(index+(e.shiftKey?-1:1)+tabs.length)%tabs.length].doc.id);}
      if(e.key==='Escape')setMenu(false);
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[pick,close,activate,tabs]);
  useEffect(()=>{document.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});},[activeId]);
  const updateSettings=(partial:Partial<Settings>)=>setSettings(old=>({...old,...partial}));
  const visibleIds=mode==='single'?[activeId]:comparison;
  return <div className={`application${native?' has-native-titlebar':''}`} onDragOver={e=>{if(!native)e.preventDefault();}} onDrop={e=>{if(native)return;e.preventDefault();void openFiles([...e.dataTransfer.files]);}}>
    {native&&<Titlebar onError={setError}/>}
    <header className="toolbar">
      <div className="brand"><span className="brand-icon"><FileText size={21}/></span><span>GBMarkdown</span></div><div className="toolbar-separator"/>
      <div className="navigation-buttons" ref={setControlsHost}/>
      <button className="icon-button" title={settings.sidebar?'收起侧边栏':'显示侧边栏'} aria-label="切换侧边栏" onClick={()=>updateSettings({sidebar:!settings.sidebar})}>{settings.sidebar?<PanelLeftClose size={19}/>:<PanelLeftOpen size={19}/>}</button>
      <button className="open-button" title="打开文件" aria-label="打开文件" onClick={()=>void pick()} disabled={opening}>{opening?<LoaderCircle size={16} className="spin"/>:<FolderOpen size={16}/>}<span>打开文件</span></button>
      <div className="toolbar-document">{activeDoc&&<span title={activeDoc.path}>{activeDoc.name}</span>}</div>
      <div className="toolbar-actions"><div className="reading-modes" role="group" aria-label="阅读方式"><button title="单文档阅读" aria-label="单文档阅读" aria-pressed={mode==='single'} onClick={()=>switchMode('single')}><BookOpen size={17}/></button><button title="对比阅读（最多四个文件）" aria-label="对比阅读" aria-pressed={mode==='compare'} disabled={!tabs.length} onClick={()=>switchMode('compare')}><Columns2 size={17}/>{mode==='compare'&&<span>{comparison.length}/4</span>}</button></div>
        <button className="icon-button" title={settings.theme==='light'?'切换暗色主题':'切换亮色主题'} aria-label="切换主题" onClick={()=>updateSettings({theme:settings.theme==='light'?'dark':'light'})}>{settings.theme==='light'?<Moon size={18}/>:<Sun size={18}/>}</button>
        <div className="menu-wrap"><button className="icon-button" title="阅读设置" aria-label="阅读设置" onClick={()=>setMenu(!menu)}><MoreHorizontal size={20}/></button>{menu&&<><div className="dismiss-layer" onClick={()=>setMenu(false)}/><div className="settings-menu"><div className="menu-label">阅读字号</div><div className="font-control"><button className="icon-button" title="缩小字号" disabled={settings.fontSize<=12} onClick={()=>updateSettings({fontSize:settings.fontSize-1})}><Minus size={16}/></button><span>{settings.fontSize} px</span><button className="icon-button" title="增大字号" disabled={settings.fontSize>=24} onClick={()=>updateSettings({fontSize:settings.fontSize+1})}><Plus size={16}/></button></div><hr/><button onClick={()=>{setSidebarTab('recent');updateSettings({sidebar:true});setMenu(false);}}><History size={16}/>最近文件</button><button disabled={!activeDoc} onClick={()=>{void close(activeId);setMenu(false);}}><X size={16}/>关闭文档</button></div></>}</div>
      </div>
    </header>
    {tabs.length>0&&<div className="document-tabs" role="tablist" aria-label="已打开文件">{tabs.map((t,index)=><div className={`document-tab${activeId===t.doc.id?' selected':''}`} key={t.doc.id}>
      {mode==='compare'&&<input type="checkbox" aria-label={`对比 ${t.doc.name}`} title={comparison.includes(t.doc.id)?'移出对比':comparison.length===4?'最多对比四个文件':'加入对比'} checked={comparison.includes(t.doc.id)} disabled={!comparison.includes(t.doc.id)&&comparison.length>=4} onChange={()=>toggleComparison(t.doc.id)}/>}
      <button role="tab" id={`tab-${t.doc.id}`} aria-selected={activeId===t.doc.id} aria-controls={`pane-${t.doc.id}`} tabIndex={activeId===t.doc.id?0:-1} title={t.doc.path} onClick={()=>activate(t.doc.id)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;activate(tabs[next].doc.id);document.getElementById(`tab-${tabs[next].doc.id}`)?.focus();}}}><FileText size={14}/><span>{t.doc.name}</span></button>
      <button className="tab-close" title={`关闭 ${t.doc.name}`} aria-label={`关闭 ${t.doc.name}`} onClick={()=>void close(t.doc.id)}><X size={14}/></button>
    </div>)}</div>}
    {error&&<div className="notice error"><AlertCircle size={16}/><span>{error}</span><button className="icon-button small" title="关闭提示" onClick={()=>setError('')}><X size={14}/></button></div>}
    <div className="workspace">
      {settings.sidebar&&<aside className="sidebar"><div className="sidebar-tabs"><button className={sidebarTab==='outline'?'active':''} onClick={()=>setSidebarTab('outline')}><ListTree size={15}/>文档大纲</button><button className={sidebarTab==='recent'?'active':''} onClick={()=>setSidebarTab('recent')} title="最近文件"><History size={16}/></button></div>
        <div className="outline-host" ref={setOutlineHost} hidden={sidebarTab!=='outline'}/>
        {sidebarTab==='outline'&&!activeDoc&&<div className="sidebar-empty"><ListTree size={25}/><span>打开文档后显示大纲</span></div>}
        {sidebarTab==='recent'&&<div className="recent-list"><div className="outline-caption"><span>最近打开</span><span>{settings.recent.length}</span></div>{settings.recent.length?settings.recent.map(r=><button key={r.path} className="recent-item" title={r.path} onClick={()=>void openFiles([r.path])}><FileText size={17}/><span><strong>{r.name}</strong><small>{formatBytes(r.size)} · {(r.offset/Math.max(1,r.size)*100).toFixed(1)}%</small></span></button>):<div className="sidebar-empty">暂无最近文件</div>}</div>}
        <div className="sidebar-footer"><span className="status-dot"/>本地 · 离线阅读<span className="version">v{version}</span></div>
      </aside>}
      <main className={`reader-main reader-grid ${mode}`} data-pane-count={visibleIds.length}>
        {tabs.map(t=><DocumentPane key={t.doc.id} ref={handle=>{if(handle)panes.current.set(t.doc.id,handle);else panes.current.delete(t.doc.id);}} doc={t.doc} initialOffset={t.initialOffset} active={t.doc.id===activeId} visible={visibleIds.includes(t.doc.id)} comparing={mode==='compare'} fontSize={settings.fontSize} hosts={hosts} onActivate={()=>activate(t.doc.id)} onRemember={remember} onReload={reload} onRemove={()=>toggleComparison(t.doc.id)}/>)}
        {!tabs.length&&<div className="empty-reader"><div className="empty-logo"><FileText size={36}/></div><h1>GBMarkdown</h1><p>打开 Markdown 文档</p><button className="primary-button" onClick={()=>void pick()} disabled={opening}><FolderOpen size={18}/>选择本地文件</button>{settings.recent.length>0&&<div className="empty-recents"><span>最近打开</span>{settings.recent.slice(0,3).map(r=><button key={r.path} onClick={()=>void openFiles([r.path])}><FileText size={15}/><span>{r.name}</span><small>{formatBytes(r.size)}</small></button>)}</div>}</div>}
      </main>
      <div className="search-host" ref={setSearchHost}/>
    </div>
    <footer className="statusbar" ref={setStatusHost}>{!activeDoc&&<div>就绪</div>}</footer>
  </div>;
}
