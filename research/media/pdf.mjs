import {inspectManifest,missingCredential} from './c2pa.mjs';
let enginePromise;
function engine(){
  if(!enginePromise)enginePromise=(async()=>{
    // PDF.js imports its rendering API along with its text API. Headless mode
    // only needs the identity matrix at module initialization; no rendering runs.
    if(!globalThis.DOMMatrix)globalThis.DOMMatrix=class {
      constructor([a=1,b=0,c=0,d=1,e=0,f=0]=[]){Object.assign(this,{a,b,c,d,e,f})}
    };
    if(!Promise.try)Promise.try=(f,...args)=>new Promise(resolve=>resolve(f(...args)));
    if(!Uint8Array.prototype.toHex)Object.defineProperty(Uint8Array.prototype,'toHex',{configurable:true,value:function(){return [...this].map(v=>v.toString(16).padStart(2,'0')).join('')}});
    for(const proto of [Map.prototype,WeakMap.prototype]){
      if(!proto.getOrInsertComputed)Object.defineProperty(proto,'getOrInsertComputed',{configurable:true,value:function(k,f){if(!this.has(k))this.set(k,f(k));return this.get(k)}});
      if(!proto.getOrInsert)Object.defineProperty(proto,'getOrInsert',{configurable:true,value:function(k,v){if(!this.has(k))this.set(k,v);return this.get(k)}});
    }
    const {WorkerMessageHandler}=await import('./vendor/pdf.worker.min.mjs');
    globalThis.pdfjsWorker={WorkerMessageHandler};
    return import('./vendor/pdf.min.mjs');
  })();
  return enginePromise;
}
function pageText(items){
  const parts=[];
  let previous=null;
  for(const current of items){
    if(!('str' in current))continue;
    if(current.str){
      if(previous){
        const px=previous.transform[4],cx=current.transform[4];
        const sameLine=Math.abs(previous.transform[5]-current.transform[5])<Math.max(1,current.height*.4);
        const gap=cx<px?px-(cx+current.width):cx-(px+previous.width);
        if(!sameLine)parts.push('\n');
        else if(gap>Math.max(1,Math.min(previous.height,current.height)*.18)&&
          !/\s$/u.test(previous.str)&&!/^\s/u.test(current.str))parts.push(' ');
      }
      parts.push(current.str.replace(/[\uFB50-\uFDFF\uFE70-\uFEFC]+/gu,s=>s.normalize('NFKC')));
      previous=current;
    }
    if(current.hasEOL){parts.push('\n');previous=null}
  }
  return parts.join('');
}
export async function pdf(bytes){
  const pdfjs=await engine();
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,
    enableXfa:false,useWasm:false,isOffscreenCanvasSupported:false,isImageDecoderSupported:false,useWorkerFetch:false,
    stopAtErrors:true,verbosity:0,fontExtraProperties:true,disableAutoFetch:true,maxImageSize:1000000});
  let doc;
  try{
    doc=await task.promise;
    if(doc.numPages>150)throw new Error('PDF page limit (150)');
    const pages=[],sizes=[],fonts=new Set(),meta=await doc.getMetadata();
    let chars=0;
    for(let n=1;n<=doc.numPages;n++){
      const p=await doc.getPage(n),v=p.getViewport({scale:1}),tc=await p.getTextContent();
      const text=pageText(tc.items);
      if((chars+=text.length)>500000)throw new Error('PDF text limit');
      pages.push(text);sizes.push({widthPt:+v.width.toFixed(2),heightPt:+v.height.toFixed(2)});
      for(const style of Object.values(tc.styles))if(style.fontFamily)fonts.add(style.fontFamily);
      p.cleanup();
    }
    // Inspect attachment bytes, retaining no filenames, author names or original PDFs.
    const attachments=Object.values(await doc.getAttachments()||{});
    let provenance=missingCredential();
    for(const a of attachments){
      const data=a.content;
      if(data&&data.length>16&&String.fromCharCode(...data.slice(4,8))==='jumb'){
        const result=await inspectManifest(data,bytes,[]);
        if(result.status!=='non_c2pa_container'){provenance=result;break}
      }
    }
    const info=meta.info;
    const tailText=new TextDecoder('latin1').decode(bytes);
    const count=(re)=>(tailText.match(re)||[]).length;
    const baseFonts=[...tailText.matchAll(/\/BaseFont\s*\/([A-Za-z0-9_+.\-]{1,100})/g)].map(m=>m[1]);
    const software=(String(info.Producer||'')+' '+String(info.Creator||'')).toLowerCase();
    const generator=['reportlab','pymupdf','itext','pdftex','luatex','microsoft word','libreoffice','acrobat','quartz','skia'].find(v=>software.includes(v))||null;
    return {format:'PDF',text:pages.join('\n\n'),forensics:{pageCount:doc.numPages,pageSizes:sizes,fontFamilies:[...fonts],visibleBaseFontNames:[...new Set(baseFonts)].slice(0,64),generatorFamily:generator,version:info.PDFFormatVersion,
      creationDate:info.CreationDate||null,modificationDate:info.ModDate||null,hasAcroForm:!!info.IsAcroFormPresent,
      attachmentCount:attachments.length,xrefMarkers:count(/(?:^|[\r\n])xref[\r\n]/g),endOfFileMarkers:count(/%%EOF/g),
      embeddedFileStreams:count(/\/Type\s*\/EmbeddedFile\b/g),imageObjectMarkers:count(/\/Subtype\s*\/Image\b/g)},
      provenance:provenance.status==='no_embedded_manifest_found'?{...provenance,status:'no_document_level_manifest_found',scope:'catalog AF and named content credential attachments'}:provenance};
  }finally{await task.destroy()}
}
