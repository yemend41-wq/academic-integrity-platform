// Query only identifiers. External services never receive document text, account
// identifiers, bibliographic excerpts, manuscript titles or author metadata.
import publisherIndex from './publisher-index.json' with { type: 'json' };
const indexedArticles=new Map(publisherIndex.records.map(record=>[record.id,record]));
const registryCache=new Map();
const TTL=6*60*60*1000;
const MAX_RESULTS=48;
const MAX_LOOKUPS=16;
function trimDOI(raw){
  let s=raw.replace(/[.,;:!?،؛]+$/gu,'');
  while(s.endsWith(')')&&(s.match(/\)/g)||[]).length>(s.match(/\(/g)||[]).length)s=s.slice(0,-1);
  return s.toLowerCase();
}
function asciiDigits(s){return s.replace(/[٠-٩۰-۹]/gu,c=>String(c.charCodeAt(0)-(c>='۰'?1776:1632)))}
export function validISBN(id){
  if(/^97[89]\d{10}$/.test(id)){
    return [...id].reduce((s,c,i)=>s+Number(c)*(i%2?3:1),0)%10===0;
  }
  if(/^\d{9}[\dX]$/.test(id))return [...id].reduce((s,c,i)=>s+(c==='X'?10:Number(c))*(10-i),0)%11===0;
  return false;
}
// ISBN-10 maps only to the 978 prefix. A 979 ISBN never receives a
// fabricated ISBN-10 counterpart. Validate every asserted catalog identifier.
export function canonicalISBN(value) {
  if(typeof value!=='string')return null;
  const digits=asciiDigits(value).replace(/[\s\p{Pd}]/gu,'').toUpperCase();
  if(!validISBN(digits))return null;
  if(digits.length===13)return digits;
  const prefix='978'+digits.slice(0,9);
  const sum=[...prefix].reduce((n,c,i)=>n+Number(c)*(i%2?3:1),0);
  return prefix+String((10-sum%10)%10);
}
export function findReferences(text){
  const ids=new Map();
  const add=(kind,id)=>{
    if(id.length<=200&&ids.size<MAX_RESULTS&&!ids.has(kind+id))ids.set(kind+id,{kind,id});
  };
  const wrapped=String(text).replace(/(10\.\d{4,9}\/[^\s<>]{1,180}[.\/])\r?\n[ \t]*(?=\d{2,})/giu,'$1');
  for(const m of wrapped.matchAll(/\b10\.\d{4,9}\/[A-Z0-9._;()/:+\-]+/gi))add('doi',trimDOI(m[0]));
  const normalized=asciiDigits(text);
  for(const m of normalized.matchAll(/(?:\bISBN(?:-1[03])?\s*:?[ \t]*|ردمك\s*:?[ \t]*)([\dX](?:[ \t\p{Pd}]*[\dX]){9,12})(?![ \t\p{Pd}]*[\dX])/giu)){
    add('isbn',m[1].replace(/[^\dX]/gi,'').toUpperCase());
  }
  for(const m of normalized.matchAll(/\b(97[89](?:[\p{Pd}]?\d){10})\b/gu))add('isbn',m[1].replace(/\p{Pd}/gu,''));
  return [...ids.values()];
}
async function request(url,deadline) {
  const remaining=deadline-Date.now();
  if(remaining<100)return {type:'unavailable',reason:'deadline'};
  const ctrl=new AbortController();
  const time=setTimeout(()=>ctrl.abort(),Math.min(2700,remaining));
  let httpStatus;
  try {
    const response=await fetch(url,{
      headers:{Accept:'application/json','User-Agent':'MizanAcademicIntegrity/1.0'},
      signal:ctrl.signal,redirect:'manual'
    });
    httpStatus=response.status;
    if(httpStatus!==404&&!response.ok){
      await response.body?.cancel();
      return {type:'unavailable',reason:'http_error',httpStatus};
    }
    const reader=response.body?.getReader();
    if(!reader)return {type:'unavailable',reason:'empty_response',httpStatus};
    const chunks=[];
    let length=0;
    try {
      for(;;){
        const {done,value}=await reader.read();
        if(done)break;
        if((length+=value.length)>1024*1024){
          await reader.cancel();
          return {type:'unavailable',reason:'body_limit',httpStatus};
        }
        chunks.push(value);
      }
    } finally {reader.releaseLock()}
    const data=new Uint8Array(length);
    let pos=0;
    for(const c of chunks){data.set(c,pos);pos+=c.length}
    let parsed;
    try {parsed=JSON.parse(new TextDecoder().decode(data))}
    catch {return {type:httpStatus===404?'not_found':'unavailable',httpStatus,reason:'non_json_response'}}
    return {type:httpStatus===404?'not_found':'ok',httpStatus,data:parsed,reason:'response'};
  } catch {
    return {type:'unavailable',reason:ctrl.signal.aborted?'timeout':'network_error',...(httpStatus?{httpStatus}:{})};
  } finally {clearTimeout(time)}
}
function diagnostic(registry,result) {
  return {registry,outcome:result.reason,...(result.httpStatus?{httpStatus:result.httpStatus}:{})};
}
function localEvidence(id,outcome) {
  const indexed=indexedArticles.get(id);
  if(!indexed||!['registry_unavailable','lookup_budget_exceeded'].includes(outcome.status))return outcome;
  return {...outcome,registryStatus:outcome.status,status:'matched_publisher_snapshot',title:indexed.title,
    publisher:indexed.publisher,publisherSource:indexed.source,publisherCheckedOn:publisherIndex.checkedOn};
}
async function doi(id,deadline) {
  const slash=id.indexOf('/');
  const suffix=id.slice(slash+1);
  if(!suffix||suffix==='.'||suffix==='..')return {status:'invalid_identifier',registry:null};
  // Preserve the prefix/suffix separator used by the official REST endpoints.
  // Encode the entire suffix as one URL component for every supported DOI.
  const key=id.slice(0,slash)+'/'+encodeURIComponent(suffix);
  const cr=await request('https://api.crossref.org/works/'+key,deadline);
  const attempts=[diagnostic('Crossref',cr)];
  if(cr.type==='ok'&&cr.data?.message?.DOI?.toLowerCase()===id){
    return {status:'verified',registry:'Crossref',title:String(cr.data.message.title?.[0]||'').slice(0,260),attempts};
  }
  const handle=await request('https://doi.org/api/handles/'+key,deadline);
  attempts.push(diagnostic('DOI Handle System',handle));
  if(handle.data&&[200,404].includes(handle.httpStatus)){
    if(handle.data.responseCode===1&&handle.httpStatus===200&&String(handle.data.handle).toLowerCase()===id)
      return {status:'verified',registry:'DOI Handle System',attempts};
    // The registry may return this application-level result in an HTTP 404.
    if(handle.data.responseCode===100)return {status:'not_found',registry:'DOI Handle System',attempts};
  }
  // A gateway can return generic 404 HTML. Only an explicit registry record
  // or semantic not-found response supports an authoritative DOI conclusion.
  return localEvidence(id,{status:'registry_unavailable',registry:'Crossref / DOI Handle System',attempts});
}
function exactCatalogRecords(records,id) {
  const target=canonicalISBN(id);
  return records.filter(record=>record.identifiers.some(code=>canonicalISBN(code)===target));
}
function bookMatch(registry,records,attempts) {
  const titles=[...new Set(records.map(r=>r.title).filter(v=>typeof v==='string'&&v.trim()).map(t=>t.slice(0,260)))];
  return {status:'verified',registry,matchedISBN:records[0].matchedISBN,
    ...(titles.length===1?{title:titles[0]}:{}),...(titles.length>1?{titleAmbiguous:true}:{}),attempts};
}
async function isbn(id,deadline) {
  const target=canonicalISBN(id);
  if(!target)return {status:'invalid_checksum',registry:null};
  const key='ISBN:'+id;
  const ol=await request('https://openlibrary.org/api/books?bibkeys='+encodeURIComponent(key)+'&format=json&jscmd=data',deadline);
  const attempts=[diagnostic('Open Library',ol)];
  const olEmpty=ol.type==='ok'&&ol.data&&typeof ol.data==='object'&&!Array.isArray(ol.data)&&Object.keys(ol.data).length===0;
  if(ol.type==='ok'&&typeof ol.data?.[key]?.title==='string'){
    const entry=ol.data[key],keys=entry.identifiers||{};
    const returned=[...(Array.isArray(keys.isbn_10)?keys.isbn_10:[]),...(Array.isArray(keys.isbn_13)?keys.isbn_13:[])];
    // A direct ISBN lookup echoes its unique bibkey. When the record also
    // declares ISBNs, at least one must identify the same edition.
    if(!returned.length||returned.some(v=>canonicalISBN(v)===target))
      return {status:'verified',registry:'Open Library',matchedISBN:target,title:entry.title.slice(0,260),attempts};
  }
  const crossrefUrl='https://api.crossref.org/works?filter='+encodeURIComponent('isbn:'+target)+'&rows=16&select=ISBN,type,title,container-title';
  const googleUrl='https://www.googleapis.com/books/v1/volumes?q='+encodeURIComponent('isbn:'+target)+'&maxResults=8&fields='+encodeURIComponent('totalItems,items(volumeInfo(title,industryIdentifiers))');
  const [cr,gb]=await Promise.all([request(crossrefUrl,deadline),request(googleUrl,deadline)]);
  attempts.push(diagnostic('Crossref',cr),diagnostic('Google Books',gb));
  const crossItems=cr.type==='ok'&&cr.data?.status==='ok'&&Array.isArray(cr.data?.message?.items)?cr.data.message.items:null;
  if(crossItems){
    const selected=exactCatalogRecords(crossItems.map(item=>{
      const standalone=['book','monograph','edited-book','reference-book','book-set','proceedings'].includes(item.type);
      return {standalone,identifiers:Array.isArray(item.ISBN)?item.ISBN:[],matchedISBN:target,
        title:standalone?item.title?.[0]:item['container-title']?.[0]};
    }),target);
    const books=selected.filter(r=>r.standalone);
    if(selected.length)return bookMatch('Crossref',books.length?books:selected,attempts);
  }
  const googleItems=gb.type==='ok'&&Array.isArray(gb.data?.items)?gb.data.items:null;
  if(googleItems){
    const selected=exactCatalogRecords(googleItems.map(item=>{
      const info=item.volumeInfo||{};
      return {title:info.title,matchedISBN:target,identifiers:(info.industryIdentifiers||[])
        .filter(v=>v.type==='ISBN_10'||v.type==='ISBN_13').map(v=>v.identifier)};
    }),target);
    if(selected.length)return bookMatch('Google Books',selected,attempts);
  }
  const googleEmpty=gb.type==='ok'&&(gb.data?.totalItems===0||Array.isArray(googleItems));
  const registry='Open Library / Crossref / Google Books';
  return {status:olEmpty&&crossItems&&googleEmpty?'not_found_in_queried_registries':'registry_unavailable',registry,attempts};
}
export async function verifyReferences(text){
  const found=findReferences(text),results=new Array(found.length),deadline=Date.now()+6000;let next=0;
  async function worker(){
    while(next<found.length){
      const i=next++,ref=found[i],key=ref.kind+ref.id,entry=registryCache.get(key);
      if(entry&&Date.now()-entry.at<TTL){results[i]={...ref,...entry.value,checkedAt:entry.at};continue}
      if(ref.kind==='isbn'&&!validISBN(ref.id)){results[i]={...ref,status:'invalid_checksum',registry:null};continue}
      if(i>=MAX_LOOKUPS||deadline-Date.now()<100){results[i]={...ref,...localEvidence(ref.id,{status:'lookup_budget_exceeded',registry:null})};continue}
      const outcome=await (ref.kind==='doi'?doi:isbn)(ref.id,deadline);
      const at=Date.now();results[i]={...ref,...outcome,checkedAt:at};
      if(['verified','not_found','not_found_in_queried_registries'].includes(outcome.status)){
        if(registryCache.size>=256)registryCache.delete(registryCache.keys().next().value);
        registryCache.set(key,{value:outcome,at});
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(4,found.length)},worker));
  return results;
}
