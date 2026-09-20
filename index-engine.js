/**
 * INDEX MATRIX - URL validation, PDF analysis and bounded processing queue.
 * This module performs technical checks; it never claims that a search engine
 * crawled or indexed a URL without independent evidence.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, 'data', 'index-queue.json');
const MAX_QUEUE = 10000;
const MAX_FETCH_BYTES = 35 * 1024 * 1024;
const CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.INDEX_QUEUE_CONCURRENCY) || 2));
let running = false;

function ensure(){const d=path.dirname(QUEUE_FILE);if(!fs.existsSync(d))fs.mkdirSync(d,{recursive:true});if(!fs.existsSync(QUEUE_FILE))fs.writeFileSync(QUEUE_FILE,'[]','utf8');}
function read(){ensure();try{const x=JSON.parse(fs.readFileSync(QUEUE_FILE,'utf8'));return Array.isArray(x)?x:[];}catch(e){return [];}}
function write(x){ensure();fs.writeFileSync(QUEUE_FILE,JSON.stringify(x.slice(0,MAX_QUEUE),null,2),'utf8');}
function now(){return new Date().toISOString();}

function enqueue(url){
 const q=read(); let item=q.find(x=>x.url===url && ['PENDING','RUNNING'].includes(x.status));
 if(item)return item;
 item={id:'q_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),url,status:'PENDING',attempts:0,createdAt:now(),updatedAt:now()};
 q.push(item);write(q);return item;
}
function list(limit=100){return read().slice(-Math.min(Math.max(Number(limit)||100,1),1000)).reverse();}
function stats(){const q=read();return {total:q.length,pending:q.filter(x=>x.status==='PENDING').length,running:q.filter(x=>x.status==='RUNNING').length,done:q.filter(x=>x.status==='DONE').length,failed:q.filter(x=>x.status==='FAILED').length};}

async function fetchBounded(url, options={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(), options.timeout||15000);
 try{
  const res=await fetch(url,{redirect:'follow',headers:{'User-Agent':'INDEX-MATRIX-Validator/2.0','Accept':'application/pdf,text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'},signal:controller.signal});
  const len=Number(res.headers.get('content-length')||0);
  if(len>MAX_FETCH_BYTES)throw new Error('Remote resource exceeds 35 MB limit.');
  const reader=res.body?.getReader();
  if(!reader)return {res,buffer:Buffer.from(await res.arrayBuffer())};
  const chunks=[];let total=0;
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>MAX_FETCH_BYTES){await reader.cancel();throw new Error('Remote resource exceeds 35 MB limit.');}chunks.push(Buffer.from(value));}
  return {res,buffer:Buffer.concat(chunks,total)};
 } finally {clearTimeout(timer);}
}

async function validateUrl(url){
 let parsed;try{parsed=new URL(url);}catch(e){return {ok:false,error:'Invalid URL'};}
 if(!['http:','https:'].includes(parsed.protocol))return {ok:false,error:'Only HTTP/HTTPS URLs are supported.'};
 const started=Date.now();
 try{
  const {res,buffer}=await fetchBounded(parsed.toString());
  const type=(res.headers.get('content-type')||'').split(';')[0].toLowerCase();
  return {ok:res.ok,httpStatus:res.status,contentType:type,contentLength:buffer.length,finalUrl:res.url,redirected:res.redirected,elapsedMs:Date.now()-started,buffer};
 }catch(e){return {ok:false,error:e.message,elapsedMs:Date.now()-started};}
}

async function analyzePdf(buffer,pdfParse){
 const sha256=crypto.createHash('sha256').update(buffer).digest('hex');
 const validMagic=buffer.subarray(0,5).toString('ascii')==='%PDF-';
 let text='';let pages=null;let info={};
 if(validMagic && typeof pdfParse==='function'){
  try{
   if(pdfParse.PDFParse && typeof pdfParse.PDFParse==='function'){
    const parser=new pdfParse.PDFParse({data:buffer});
    const result=await parser.getText();
    pages=Array.isArray(result?.pages)?result.pages.length:null;
    text=typeof result==='string'?result:(result?.text||'');
    await parser.destroy().catch(()=>{});
   }else{
    const result=await pdfParse(buffer);text=result?.text||'';pages=result?.numpages||null;info=result?.info||{};
   }
  }catch(e){info={parseError:e.message};}
 }
 return {valid:validMagic,textLength:text.trim().length,pages,sizeBytes:buffer.length,sha256,metadata:info,contentClass:text.trim().length?'TEXT_PDF':'SCANNED_OR_EMPTY_PDF'};
}

async function processOne(item, deps){
 const q=read();const row=q.find(x=>x.id===item.id);if(!row)return;
 row.status='RUNNING';row.attempts=(row.attempts||0)+1;row.updatedAt=now();write(q);
 try{
  const result=await validateUrl(row.url);
  deps.status.markValidated(row.url,{ok:result.ok,httpStatus:result.httpStatus,contentType:result.contentType,contentLength:result.contentLength,finalUrl:result.finalUrl});
  if(!result.ok)throw new Error(result.error||('HTTP '+result.httpStatus));
  if(/application\/pdf/i.test(result.contentType||'') || /\.pdf(?:$|[?#])/i.test(result.finalUrl||row.url)){
   const pdf=await analyzePdf(result.buffer,deps.pdfParse);
   deps.status.markPdfAnalysis(row.url,pdf);
   if(!pdf.valid)throw new Error('URL did not return a valid PDF file.');
  }
  deps.status.markDiscoverySubmitted(row.url,['relay-hub']);
  row.status='DONE';row.lastResult={httpStatus:result.httpStatus,contentType:result.contentType,finalUrl:result.finalUrl};row.updatedAt=now();write(q);
 }catch(e){
  row.status=row.attempts>=3?'FAILED':'PENDING';row.error=e.message;row.updatedAt=now();write(q);
 }
}

async function pump(deps){
 if(running)return;running=true;
 try{
  let active=[];
  while(true){
   const pending=read().filter(x=>x.status==='PENDING').slice(0,CONCURRENCY-active.length);
   if(!pending.length){if(!active.length)break;await Promise.race(active);active=active.filter(p=>!p.done);continue;}
   for(const item of pending){const p=processOne(item,deps).then(()=>{p.done=true;}).catch(()=>{p.done=true;});active.push(p);}
   if(active.length>=CONCURRENCY){await Promise.race(active);active=active.filter(p=>!p.done);}
  }
 }finally{running=false;}
}
module.exports={enqueue,list,stats,pump,validateUrl,analyzePdf};
