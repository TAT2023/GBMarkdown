import { invoke } from '@tauri-apps/api/core';
import DOMPurify from 'dompurify';
import { Lexer, Marked, Renderer, type Token } from 'marked';
import { mathPlaceholder } from './math';
import { latexDelimiters } from './latex-delimiters';

export interface DocumentInfo { id:string; path:string; name:string; size:number; encoding:string; bom:number }
export interface Block { start:number; end:number; html:string; mode:string; line:number }
export interface RenderWindow { start:number; end:number; blocks:Block[]; requestVersion:number; warning:string|null }
export interface Heading { offset:number; level:number; title:string }
export interface IndexStatus { scanned:number; total:number; pages:number; headings:number; complete:boolean; cached:boolean; error:string|null }
export interface SearchMatch { offset:number; end:number; preview:string }
export interface SearchStatus { scanned:number; total:number; count:number; retained:number; complete:boolean; cancelled:boolean; truncated:boolean; error:string|null }
export interface Recent { path:string; name:string; size:number; offset:number; openedAt:number }
export interface Settings { recent:Recent[]; theme:string; sidebar:boolean; fontSize:number; width:number; height:number }
export const native = '__TAURI_INTERNALS__' in window;
let imageRequests=0;const imageWaiters:Array<()=>void>=[];
let current: { file:File; info:DocumentInfo; headings:Heading[]; anchors:Map<string,number>; index:IndexStatus }|null=null;
let search: { id:string; status:SearchStatus; results:SearchMatch[]; cancel:boolean }|null=null;
let serial=0;
const defaults:Settings={recent:[],theme:'light',sidebar:true,fontSize:16,width:1280,height:860};
const encodeHTML=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const previewRenderer=new Renderer();previewRenderer.html=({text})=>encodeHTML(text);
function headingText(tokens:Token[]):string{return tokens.map(token=>{
  if(token.type==='html')return '';
  if('tokens' in token&&token.tokens)return headingText(token.tokens as Token[]);
  return 'text' in token?String(token.text):token.type==='br'?' ':'';
}).join('');}
function previewSlug(title:string){
  const holder=document.createElement('span');holder.innerHTML=encodeHTML(headingText(Lexer.lexInline(title)));
  // Decode Markdown entities without admitting markup into the document.
  const decoder=document.createElement('textarea');decoder.innerHTML=holder.textContent||'';
  return decoder.value.toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\-\s]/gu,'').replace(/\s/g,'-');
}
let previewMarkdown:Promise<Marked>|null=null;
const browserHTML=async(s:string,base:number)=>{
  previewMarkdown??=import('marked-katex-extension').then(({default:math})=>{
    const extension=math({nonStandard:true});
    for(const item of extension.extensions||[])if('renderer' in item)item.renderer=token=>mathPlaceholder(String(token.text),Boolean(token.displayMode));
    return new Marked({renderer:previewRenderer},extension,{extensions:latexDelimiters});
  });
  const parser=await previewMarkdown;
  const renderer=new Renderer();renderer.html=previewRenderer.html;let cursor=0;
  renderer.heading=function({tokens,depth,raw}){const position=s.indexOf(raw,cursor);if(position>=0)cursor=position+raw.length;const offset=base+new TextEncoder().encode(s.slice(0,Math.max(0,position))).length;return `<h${depth} data-source-offset="${offset}">${this.parser.parseInline(tokens)}</h${depth}>`;};
  const html=DOMPurify.sanitize(parser.parse(s,{async:false,renderer}) as string,{ADD_ATTR:['data-math','data-source-offset'],FORBID_TAGS:['img','script','iframe','style','video','audio'],FORBID_ATTR:['style']});
  return html;
};
async function browserOpen(file:File):Promise<DocumentInfo>{
  const info={id:`b${++serial}`,path:file.name,name:file.name,size:file.size,encoding:'UTF-8',bom:0};
  const doc={file,info,headings:[] as Heading[],anchors:new Map<string,number>(),index:{scanned:0,total:file.size,pages:0,headings:0,complete:false,cached:false,error:null} as IndexStatus}; current=doc;
  void (async()=>{
    let offset=0,carry='',fence='',longLine=false;const decoder=new TextDecoder();const counts=new Map<string,number>();
    const add=(position:number,level:number,title:string)=>{if(doc.headings.length>=20000)return;doc.headings.push({offset:position,level,title});const base=previewSlug(title);let slug=base,n=counts.get(base)||0;while(doc.anchors.has(slug))slug=`${base}-${++n}`;counts.set(base,n);doc.anchors.set(slug,position);};
    let previous:{offset:number;text:string}|null=null,inMath='';
    while(offset<file.size && current===doc){
      const bytes=new Uint8Array(await file.slice(offset,offset+1024*1024).arrayBuffer());
      let lineOffset=offset-new TextEncoder().encode(carry).length;
      const text=carry+decoder.decode(bytes,{stream:offset+bytes.length<file.size});
      const parts=text.split('\n');carry=offset+bytes.length<file.size?parts.pop()||'':'';
      // Browser preview stores a capped outline; the desktop uses an uncapped disk index.
      for(const line of parts){const f=!inMath&&line.match(/^ {0,3}(`{3,}|~{3,})/);if(f){if(!fence)fence=f[1][0];else if(f[1][0]===fence)fence='';}
        let delimiter=false;
        if(!fence){
          if(inMath==='\\['){if(/(?<!\\)(?:\\\\)*\\\]/.test(line)){inMath='';delimiter=true;}}
          else if(/^ {0,3}\$\$\s*$/.test(line)){inMath=inMath?'':'$$';delimiter=true;}
          else if(!inMath&&/^ {0,3}\\\[/.test(line)){inMath=/(?<!\\)(?:\\\\)*\\\]/.test(line.slice(line.indexOf('\\[')+2))?'':'\\[';delimiter=true;}
        }
        if(!fence&&!inMath&&!delimiter&&!longLine){const h=line.match(/^ {0,3}(#{1,6})(?:\s+(.*)|$)/);if(h)add(Math.max(0,lineOffset),h[1].length,(h[2]||'').replace(/\s+#+\s*$/,''));
          else if(previous&&/^ {0,3}(?:=+|-+)\s*$/.test(line))add(previous.offset,line.trim()[0]==='='?1:2,previous.text);
        }
        previous=!fence&&!inMath&&!delimiter&&!longLine&&/\S/.test(line)&&!/^\s*[#>`~*\[\-]/.test(line)?{offset:lineOffset,text:line}:null;
        lineOffset+=new TextEncoder().encode(line+'\n').length;
        longLine=false;
      }
      if(carry.length>65536){carry=carry.slice(-65536);longLine=true;}
      offset+=bytes.length;doc.index={...doc.index,scanned:offset,headings:doc.headings.length,pages:Math.ceil(offset/32768)};
      await new Promise(r=>setTimeout(r,0));
    }
    doc.index.complete=true;
  })();return info;
}

export const api={
  async pick():Promise<DocumentInfo|null>{
    if(native){const {open}=await import('@tauri-apps/plugin-dialog');const path=await open({multiple:false,filters:[{name:'Markdown',extensions:['md','markdown','mdown','txt']}]});return typeof path==='string'?api.open(path):null;}
    return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.hidden=true;input.accept='.md,.markdown,.mdown,.txt';document.body.append(input);input.onchange=()=>{const file=input.files?.[0];input.remove();if(file)void browserOpen(file).then(resolve,reject);else resolve(null);};input.addEventListener('cancel',()=>{input.remove();resolve(null);});input.click();});
  },
  async open(path:string):Promise<DocumentInfo>{if(native)return invoke('open_document',{path});if(current?.info.path===path)return current.info;throw new Error('浏览器预览请重新选择本地文件');},
  async demo():Promise<DocumentInfo>{const text=await (await fetch('/sample.md')).text();return browserOpen(new File([text],'大文档阅读架构.md',{type:'text/markdown'}));},
  async window(id:string,offset:number,version:number):Promise<RenderWindow>{
    if(native)return invoke('get_render_window',{documentId:id,byteOffset:Math.round(offset),maxBytes:64*1024,requestVersion:version});
    if(!current||current.info.id!==id)throw new Error('文档已关闭');
    const file=current.file;let start=Math.floor(Math.max(0,offset)/32768)*32768;
    const bytes=new Uint8Array(await file.slice(start,Math.min(file.size,start+65536)).arrayBuffer());
    let skip=0;while(skip<3&&(bytes[skip]&0xc0)===0x80)skip++;start+=skip;
    const text=new TextDecoder().decode(bytes.subarray(skip));
    const raw=start>0&&file.size>65536;
    const html=raw?`<pre class="plain-fragment">${encodeHTML(text)}</pre>`:await browserHTML(text,start);
    return {start,end:start+bytes.length-skip,blocks:[{start,end:start+bytes.length-skip,html,mode:raw?'compatibility':'markdown',line:0}],requestVersion:version,warning:raw?'浏览器预览使用文本窗口；完整索引与 Markdown 上下文由桌面版提供。':null};
  },
  async outline(id:string,start:number,limit=200):Promise<Heading[]>{if(native)return invoke('get_outline',{documentId:id,start,limit});return current?.headings.slice(start,start+limit)||[];},
  async anchor(id:string,fragment:string):Promise<{offset:number|null;complete:boolean}>{
    if(native)return invoke('resolve_anchor',{documentId:id,fragment});
    if(!current||current.info.id!==id)throw new Error('文档已关闭');
    return {offset:fragment===''?0:current.anchors.get(fragment)??null,complete:current.index.complete};
  },
  async status(id:string,byteOffset=0):Promise<{index:IndexStatus;changed:boolean;outlinePosition:number}>{if(native)return invoke('get_index_status',{documentId:id,byteOffset});if(!current)throw new Error('Closed');let lo=0,hi=current.headings.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(current.headings[mid].offset<=byteOffset)lo=mid+1;else hi=mid;}return {index:current.index,changed:false,outlinePosition:Math.max(0,lo-1)};},
  async startSearch(id:string,query:string,caseSensitive:boolean):Promise<string>{
    if(native)return invoke('start_search',{documentId:id,query,caseSensitive});
    if(search)search.cancel=true;
    if(!current)throw new Error('文档已关闭');
    const file=current.file;const job={id:`s${++serial}`,status:{scanned:0,total:file.size,count:0,retained:0,complete:false,cancelled:false,truncated:false,error:null} as SearchStatus,results:[] as SearchMatch[],cancel:false};search=job;
    void(async()=>{let offset=0,carry='',lastEnd=0;const needle=caseSensitive?query:query.toLowerCase();
      while(offset<file.size&&!job.cancel){const bytes=new Uint8Array(await file.slice(offset,offset+1024*1024).arrayBuffer());const original=carry+new TextDecoder().decode(bytes);const text=caseSensitive?original:original.toLowerCase();let pos=0;
        while((pos=text.indexOf(needle,pos))>=0){const begin=offset-new TextEncoder().encode(carry).length+new TextEncoder().encode(original.slice(0,pos)).length;const end=begin+new TextEncoder().encode(query).length;
          if(end>lastEnd){job.status.count++;lastEnd=end;if(job.results.length<10000)job.results.push({offset:begin,end,preview:original.slice(Math.max(0,pos-50),pos+query.length+80).replaceAll('\n',' ')});else job.status.truncated=true;}pos+=needle.length;
        }
        carry=original.slice(-(Math.max(needle.length,1)));offset+=bytes.length;job.status.scanned=offset;job.status.retained=job.results.length;await new Promise(r=>setTimeout(r,0));
      }job.status.complete=true;job.status.cancelled=job.cancel;
    })();return job.id;
  },
  async searchResults(id:string,searchId:string,start:number):Promise<[SearchStatus,SearchMatch[]]>{if(native)return invoke('get_search_results',{documentId:id,searchId,start,limit:200});if(!search||search.id!==searchId)throw new Error('搜索已过期');return [search.status,search.results.slice(start,start+200)];},
  async cancel(id:string,searchId?:string){if(native)await invoke('cancel_search',{documentId:id,searchId:searchId||null});else if(search)search.cancel=true;},
  async close(id:string){if(native)await invoke('close_document',{documentId:id});else {current=null;if(search)search.cancel=true;}},
  async image(id:string,path:string):Promise<{url:string;width:number;height:number}>{if(imageRequests>=2)await new Promise<void>(resolve=>imageWaiters.push(resolve));imageRequests++;try{return await invoke('get_local_image',{documentId:id,path});}finally{imageRequests--;imageWaiters.shift()?.();}},
  async settings():Promise<Settings>{if(native)return invoke('get_settings');try{return {...defaults,...JSON.parse(localStorage.getItem('gbm-settings')||'{}')};}catch{return defaults;}},
  async save(settings:Settings){if(native)await invoke('save_settings',{settings});else localStorage.setItem('gbm-settings',JSON.stringify(settings));},
  async launch():Promise<string|null>{return native?invoke('get_launch_path'):null;},
  async external(url:string){if(!/^(https?:\/\/|mailto:)/i.test(url))return;if(native){const {openUrl}=await import('@tauri-apps/plugin-opener');await openUrl(url);}else window.open(url,'_blank','noopener,noreferrer');}
};
