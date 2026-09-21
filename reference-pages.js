/**
 * INDEX MATRIX - Public reference-page publisher.
 * Creates a useful, crawlable reference page for a validated third-party URL.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const DATA_DIR = path.join(__dirname, 'data');
const STORE_FILE = path.join(DATA_DIR, 'reference-pages.json');
const MAX_RECORDS = 10000;

function ensure(){ if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR,{recursive:true}); if(!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE,'[]','utf8'); }
function read(){ ensure(); try{const v=JSON.parse(fs.readFileSync(STORE_FILE,'utf8')); return Array.isArray(v)?v:[];}catch(_){return [];} }
function write(rows){ ensure(); fs.writeFileSync(STORE_FILE,JSON.stringify(rows.slice(0,MAX_RECORDS),null,2),'utf8'); }
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function normalize(u){try{return new URL(String(u).trim()).toString();}catch(_){return String(u||'').trim();}}
function idFor(u){const n=normalize(u);const p=(()=>{try{return new URL(n);}catch(_){return null;}})();const b=p?(p.pathname.split('/').filter(Boolean).pop()||p.hostname):'document';const clean=b.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,60)||'document';return clean+'-'+crypto.createHash('sha1').update(n).digest('hex').slice(0,8);}
function excerpt(t,max=700){const c=String(t||'').replace(/\s+/g,' ').trim();return c.length>max?c.slice(0,max-1)+'…':c;}
function upsert(url,meta={}){
 const sourceUrl=normalize(url),rows=read(),now=new Date().toISOString(); let row=rows.find(x=>x.sourceUrl===sourceUrl);
 if(!row){row={id:idFor(sourceUrl),sourceUrl,publishedAt:now,updatedAt:now};rows.unshift(row);}
 Object.assign(row,{type:meta.type||row.type||'URL',title:meta.title||row.title||sourceUrl,description:meta.description||row.description||'',excerpt:excerpt(meta.excerpt||row.excerpt||''),sourceDomain:meta.sourceDomain||row.sourceDomain||(()=>{try{return new URL(sourceUrl).hostname;}catch(_){return '';}})(),finalUrl:meta.finalUrl||row.finalUrl||sourceUrl,contentType:meta.contentType||row.contentType||'',canonical:meta.canonical||row.canonical||'',pages:meta.pages??row.pages??null,sha256:meta.sha256||row.sha256||'',textLength:meta.textLength??row.textLength??0,updatedAt:now});
 write(rows); return row;
}
function list(limit=1000){return read().slice(0,Math.min(Math.max(Number(limit)||1000,1),MAX_RECORDS));}
function getById(id){return read().find(x=>x.id===id)||null;}
function render(row,baseOrigin=''){
 const source=row.sourceUrl,title=row.title||source,description=row.description||('Reference page for '+source),pageUrl=baseOrigin.replace(/\/$/,'')+'/pdf/'+encodeURIComponent(row.id);
 const jsonLd={'@context':'https://schema.org','@type':'WebPage',name:title,description,url:pageUrl,about:{'@type':row.type==='PDF'?'DigitalDocument':'WebPage',name:title,url:source}};
 if(row.pages!=null) jsonLd.about.numberOfPages=row.pages;
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+' — INDEX MATRIX</title><meta name="description" content="'+esc(description)+'"><meta name="robots" content="index,follow"><link rel="canonical" href="'+esc(pageUrl)+'"><meta property="og:type" content="article"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(description)+'"><meta property="og:url" content="'+esc(pageUrl)+'"><script type="application/ld+json">'+JSON.stringify(jsonLd)+'</script></head><body><main><header><p>INDEX MATRIX · '+esc(row.type==='PDF'?'PDF':'WEB')+' REFERENCE</p><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></header><section><p><strong>Source:</strong> <a href="'+esc(source)+'" target="_blank" rel="noopener">'+esc(row.sourceDomain||source)+'</a></p>'+ (row.type==='PDF'?'<p><strong>PDF:</strong> validated · '+esc(row.pages??'unknown')+' page(s) · '+esc(row.textLength||0)+' extracted characters</p>':'') +(row.excerpt?'<p><strong>Excerpt:</strong> '+esc(row.excerpt)+'</p>':'')+'<p><a href="'+esc(source)+'" target="_blank" rel="noopener">Open original resource</a></p></section></main></body></html>';
}
function buildSitemap(origin){const urls=list().map(r=>{const loc=origin.replace(/\/$/,'')+'/pdf/'+encodeURIComponent(r.id);return '  <url><loc>'+esc(loc)+'</loc><lastmod>'+esc(r.updatedAt)+'</lastmod></url>';}).join('\n');return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls+'\n</urlset>\n';}
function buildRss(origin){const items=list(50).map(r=>{const link=origin.replace(/\/$/,'')+'/pdf/'+encodeURIComponent(r.id);return '<item><title>'+esc(r.title)+'</title><link>'+esc(link)+'</link><guid isPermaLink="true">'+esc(link)+'</guid><description>'+esc(r.description||r.excerpt)+'</description><pubDate>'+new Date(r.publishedAt).toUTCString()+'</pubDate></item>';}).join('\n');return '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>INDEX MATRIX — Published reference pages</title><link>'+esc(origin)+'</link><description>RSS feed of published reference pages.</description><language>en</language><lastBuildDate>'+new Date().toUTCString()+'</lastBuildDate>\n'+items+'\n</channel></rss>\n';}
module.exports={upsert,list,getById,render,buildSitemap,buildRss};
