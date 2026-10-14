import type { TokenizerAndRendererExtension } from 'marked';
import { mathPlaceholder } from './math';

function formula(src:string,block:boolean){
  const prefix=block?src.match(/^ {0,3}(?=\\\[)/)?.[0]:'';
  if(prefix===undefined)return;
  const start=prefix.length;
  const opener=src.slice(start,start+2);
  if(opener!=='\\['&&(block||opener!=='\\('))return;
  const close=opener==='\\['?']':')';
  for(let i=start+2;i<src.length;i++){
    if(close===')'&&src[i]==='\n'&&/^[ \t\r]*\n/.test(src.slice(i+1)))return;
    if(src[i]!=='\\')continue;
    const next=src[++i];
    if(next===opener[1])return;
    if(next!==close)continue;
    const text=src.slice(start+2,i-1);
    if(!text.trim())return;
    return {type:block?'latexBlock':'latexInline',raw:src.slice(0,i+1),text,displayMode:close===']'};
  }
}
export const latexDelimiters:TokenizerAndRendererExtension[]=[
  {name:'latexBlock',level:'block',start:src=>{const match=/(?:^|\n) {0,3}\\\[/.exec(src);return match?match.index+(match[0].startsWith('\n')?1:0):undefined;},tokenizer:src=>formula(src,true),renderer:token=>mathPlaceholder(String(token.text),true)+'\n'},
  {name:'latexInline',level:'inline',start:src=>{const index=src.search(/\\[([]/);return index<0?undefined:index;},tokenizer:src=>formula(src,false),renderer:token=>mathPlaceholder(String(token.text),Boolean(token.displayMode))},
];
