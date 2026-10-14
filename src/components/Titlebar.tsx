import { useEffect, useState } from 'react';
import { Copy, FileText, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export default function Titlebar({onError}:{onError:(message:string)=>void}) {
  const [maximized,setMaximized]=useState(false);
  useEffect(()=>{
    const win=getCurrentWindow();
    let cancelled=false;
    let unlisten:(()=>void)|undefined;
    const refresh=()=>{void win.isMaximized().then(value=>{if(!cancelled)setMaximized(value);}).catch(e=>{if(!cancelled)onError(String(e));});};
    refresh();
    void win.onResized(refresh).then(off=>{if(cancelled)off();else unlisten=off;}).catch(e=>{if(!cancelled)onError(String(e));});
    return()=>{cancelled=true;unlisten?.();};
  },[onError]);
  const run=(action:()=>Promise<void>)=>{void action().catch(e=>onError(`窗口操作失败：${String(e)}`));};
  return <div className="native-titlebar">
    <div className="titlebar-drag" data-tauri-drag-region><FileText size={14}/><span>GBMarkdown</span></div>
    <div className="window-controls">
      <button title="最小化" aria-label="最小化窗口" onClick={()=>run(()=>getCurrentWindow().minimize())}><Minus size={15}/></button>
      <button title={maximized?'还原':'最大化'} aria-label={maximized?'还原窗口':'最大化窗口'} onClick={()=>run(()=>getCurrentWindow().toggleMaximize())}>{maximized?<Copy size={13}/>:<Square size={13}/>}</button>
      <button className="window-close" title="关闭" aria-label="关闭窗口" onClick={()=>run(()=>getCurrentWindow().close())}><X size={16}/></button>
    </div>
  </div>;
}
