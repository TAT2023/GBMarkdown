import type { HighlighterCore, LanguageInput } from 'shiki/core';
const languages:Record<string,()=>Promise<{default:LanguageInput}>>={
  rust:()=>import('shiki/langs/rust.mjs'),javascript:()=>import('shiki/langs/javascript.mjs'),
  typescript:()=>import('shiki/langs/typescript.mjs'),python:()=>import('shiki/langs/python.mjs'),
  json:()=>import('shiki/langs/json.mjs'),html:()=>import('shiki/langs/html.mjs'),
  css:()=>import('shiki/langs/css.mjs'),bash:()=>import('shiki/langs/bash.mjs'),
  sql:()=>import('shiki/langs/sql.mjs'),c:()=>import('shiki/langs/c.mjs'),
  cpp:()=>import('shiki/langs/cpp.mjs'),java:()=>import('shiki/langs/java.mjs'),
  go:()=>import('shiki/langs/go.mjs'),yaml:()=>import('shiki/langs/yaml.mjs'),
  markdown:()=>import('shiki/langs/markdown.mjs'),powershell:()=>import('shiki/langs/powershell.mjs')
};
let engine:Promise<HighlighterCore>|null=null;
async function getEngine(){
  engine??=(async()=>{const [{createHighlighterCore},{createOnigurumaEngine},light,dark]=await Promise.all([import('shiki/core'),import('shiki/engine/oniguruma'),import('shiki/themes/github-light.mjs'),import('shiki/themes/github-dark.mjs')]);return createHighlighterCore({themes:[light.default,dark.default],langs:[],engine:createOnigurumaEngine(import('shiki/wasm'))});})();
  return engine;
}
export async function highlight(root:HTMLElement,signal:AbortSignal){
  const nodes=[...root.querySelectorAll<HTMLElement>('pre code[class*="language-"]')].filter(n=>(n.textContent?.length||0)<16000);
  if(!nodes.length)return;
  const h=await getEngine();
  for(const node of nodes){if(signal.aborted)return;const alias=node.className.match(/language-([\w-]+)/)?.[1]||'';const lang=({js:'javascript',ts:'typescript',py:'python',sh:'bash',ps1:'powershell'} as Record<string,string>)[alias]||alias;const load=languages[lang];if(!load)continue;
    try{if(!h.getLoadedLanguages().includes(lang))await h.loadLanguage((await load()).default);if(signal.aborted||!node.isConnected)return;const html=h.codeToHtml(node.textContent||'',{lang,themes:{light:'github-light',dark:'github-dark'}});const temp=document.createElement('div');temp.innerHTML=html;const code=temp.querySelector('code');if(code)node.replaceChildren(...code.childNodes);}catch{/* Keep the original code when a grammar cannot be loaded. */}
  }
}
