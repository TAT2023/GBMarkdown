import { mkdir, open } from 'node:fs/promises';
import { resolve } from 'node:path';
const kind=process.argv[2]||'mixed';
const mib=Number(process.argv[3]||1024);
if (!Number.isFinite(mib)||mib<=0||mib>5120) throw new Error('size must be 1..5120 MiB');
const target=Math.floor(mib*1024*1024);
await mkdir('benchmarks/fixtures',{recursive:true});
const path=resolve(`benchmarks/fixtures/${kind}-${mib}MiB.md`);
const file=await open(path,'w');
const parts={
  mixed: '# Chapter {n}\n\nA Markdown reader should keep its memory bounded. 中文内容与日本語、emoji 😀. NeedleGBM-{n}\n\n## Architecture\n\n- Streaming reads\n- Disk index\n- Virtual rendering\n\n> A small window into a very large document.\n\n| Module | Budget |\n| --- | --- |\n| Source | 32 MiB |\n| Rendering | 64 MiB |\n\n```rust\nfn main() { println!("hello"); }\n```\n\n',
  paragraphs:'Small paragraph {n}.\n\n',headings:'# Heading {n}\n\n',
  code:'let value = 123; // NeedleGBM 中文😀\n',table:'| {n} | 中文 row | NeedleGBM |\n',
  longline:'LongLine中文😀 NeedleGBM ',unicode:'中文测试 日本語テスト 😀🧩 {n}\n\n',
  references:'[reference][target]\n\n[target]: https://example.com/ "Target"\n\n'
};
if (!parts[kind]) throw new Error(`unknown fixture ${kind}`);
let written=0,chapter=0;
const prefix=kind==='code'?'# Giant code\n\n```rust\n':kind==='table'?'| ID | Text | Search |\n|---|---|---|\n':'';
if(prefix){const b=Buffer.from(prefix);await file.write(b);written+=b.length;}
while(written<target){
  const pieces=[];let length=0;while(length<1024*1024){const piece=Buffer.from(parts[kind].replaceAll('{n}',String(chapter++)));pieces.push(piece);length+=piece.length;}
  let b=Buffer.concat(pieces);if(b.length>target-written){let length=target-written;while(length>0&&(b[length]&0xc0)===0x80)length--;b=b.subarray(0,length);}
  if (!b.length) break;
  await file.write(b);written+=b.length;
}
if(kind==='code'){await file.write('\n```\n');written+=5;}
await file.close();console.log(JSON.stringify({path,bytes:written,kind}));
