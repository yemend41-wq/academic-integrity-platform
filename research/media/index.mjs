import {zipEntries} from './zip.mjs';
import {readProperties,wordXML} from './xml.mjs';
import {png,jpeg} from './images.mjs';
import {pdf} from './pdf.mjs';
import {inspectManifest,missingCredential} from './c2pa.mjs';

const utf8=new TextDecoder();
function kind(bytes){
  if(bytes[0]===0x50&&bytes[1]===0x4b&&bytes[2]===3&&bytes[3]===4)return 'DOCX';
  if(utf8.decode(bytes.subarray(0,5))==='%PDF-')return 'PDF';
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'PNG';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'JPEG';
}

function textSignals(text){
  const count=r=>(text.match(r)||[]).length;
  return {zeroWidthCharacters:count(/[\u200B-\u200D\u2060\uFEFF]/gu),bidiControls:count(/[\u202A-\u202E\u2066-\u2069]/gu),
    mixedLatinCyrillicWords:(text.match(/\p{L}+/gu)||[]).filter(w=>/[A-Za-z]/.test(w)&&/[\u0400-\u052F]/.test(w)).length,
    usSpellingTokens:count(/\b(?:color|behavior|center|analyze|organize|defense|traveling|labor)\b/gi),
    ukSpellingTokens:count(/\b(?:colour|behaviour|centre|analyse|organise|defence|travelling|labour)\b/gi)};
}

async function docx(bytes){
  const entries=zipEntries(bytes);
  if(!entries.has('[Content_Types].xml')||!entries.has('word/document.xml'))throw new Error('Not a Word processing document');
  const {text,data}=wordXML(entries.get('word/document.xml')());
  // Only metadata relevant to process is retained. Author identities, document
  // titles, organisations and directory paths are never placed into reports.
  const core=readProperties(entries.get('docProps/core.xml')?.(),['revision','created','modified','lastPrinted']);
  const app=readProperties(entries.get('docProps/app.xml')?.(),['TotalTime','Application','AppVersion','Pages','Words','Characters','Paragraphs']);
  const embedded=[...entries.keys()].filter(k=>k.startsWith('word/media/')&&!k.endsWith('/'));
  const media=[];
  for(const name of embedded.slice(0,12)){
    const image=entries.get(name)(),type=kind(image);
    try{if(type==='JPEG'||type==='PNG'){
      const item=type==='JPEG'?await jpeg(image):await png(image);
      media.push({format:item.format,width:item.forensics.width,height:item.forensics.height,provenance:item.provenance});
    }else media.push({format:'other',provenance:{status:'unsupported'}})}
    catch{media.push({format:type||'unknown',provenance:{status:'unreadable_media'}})}
  }
  const packageManifest=entries.get('META-INF/content_credential.c2pa');
  const provenance=packageManifest?await inspectManifest(packageManifest(),bytes,[]):{...missingCredential(),scope:'OOXML package; see embedded media separately'};
  return {text,format:'DOCX',forensics:{...data,core,app,editingMinutes:app.TotalTime&&/^\d+$/.test(app.TotalTime)?Number(app.TotalTime):null,
    embeddedMediaCount:embedded.length,embeddedMediaScanned:media.length,embeddedMedia:media},
    provenance};
}

export async function inspectFile(input,filename=''){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(!bytes.length||bytes.length>8*1024*1024)throw new Error('File size must be 1 byte to 8 MiB');
  const fmt=kind(bytes);
  const suffix=filename.toLowerCase().split('.').pop();
  const extension={docx:'DOCX',pdf:'PDF',png:'PNG',jpg:'JPEG',jpeg:'JPEG'}[suffix];
  if(filename&&extension!==fmt)throw new Error('File extension and content disagree');
  let result;
  if(fmt==='DOCX')result=await docx(bytes);
  else if(fmt==='PDF')result=await pdf(bytes);
  else if(fmt==='PNG')result=await png(bytes);
  else if(fmt==='JPEG')result=await jpeg(bytes);
  else throw new Error('Unsupported file format');
  if(result.text.length>500000)throw new Error('Document text limit');
  Object.assign(result.forensics,textSignals(result.text),{byteLength:bytes.length});
  return result;
}
