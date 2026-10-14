import { useEffect, useRef, useState } from 'react';
import { Check, Copy, LoaderCircle, TriangleAlert } from 'lucide-react';
import { copyText, type CopyTarget } from '../services/source-copy';

export default function SourceCopyButton({target}:{target:CopyTarget}){
  const [state,setState]=useState<'idle'|'busy'|'copied'|'error'>('idle');
  const version=useRef(0);const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>{version.current++;clearTimeout(timer.current);},[]);
  const copy=async()=>{
    const current=++version.current;clearTimeout(timer.current);setState('busy');
    try{await copyText(target.text);if(current!==version.current)return;setState('copied');}
    catch{if(current!==version.current)return;setState('error');}
    timer.current=setTimeout(()=>{if(current===version.current)setState('idle');},2000);
  };
  const label=state==='copied'?'已复制':state==='error'?'复制失败，点击重试':target.label;
  return <button type="button" className="source-copy-button" data-copy-kind={target.kind} data-copy-state={state} title={label} aria-label={label} disabled={state==='busy'} onClick={e=>{e.preventDefault();e.stopPropagation();void copy();}}>
    {state==='copied'?<Check size={14}/>:state==='error'?<TriangleAlert size={14}/>:state==='busy'?<LoaderCircle size={14} className="spin"/>:<Copy size={14}/>}
    <span className="copy-feedback" role="status">{state==='copied'?'已复制':state==='error'?'复制失败':''}</span>
  </button>;
}
