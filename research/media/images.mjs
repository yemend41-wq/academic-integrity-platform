import {inspectManifest,join,missingCredential} from './c2pa.mjs';
import {crc32} from './zip.mjs';

const ascii=b=>new TextDecoder('latin1').decode(b);
function view(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)}
function add(counts,key){counts[key]=(counts[key]||0)+1}
export async function png(bytes){
  const v=view(bytes),chunks={},ranges=[];
  let i=8,width=null,height=null,manifest=null,finished=false;
  while(i<bytes.length){
    if(i+12>bytes.length)throw new Error('Truncated PNG chunk');
    const len=v.getUint32(i),type=ascii(bytes.subarray(i+4,i+8)),end=i+12+len;
    if(end>bytes.length||!/^[A-Za-z]{4}$/.test(type))throw new Error('Invalid PNG chunk');
    if(crc32(bytes.subarray(i+4,end-4))!==v.getUint32(end-4))throw new Error('Invalid PNG checksum');
    if(i===8&&(type!=='IHDR'||len!==13))throw new Error('Invalid PNG header');
    add(chunks,type);
    if(type==='IHDR'){width=v.getUint32(i+8);height=v.getUint32(i+12)}
    if(type==='caBX'){manifest=bytes.subarray(i+8,end-4);ranges.push([i,end])}
    if(type==='IEND'){finished=true;break}
    i=end;
  }
  if(!finished||!width||!height||!chunks.IDAT)throw new Error('Incomplete PNG');
  const provenance=manifest?await inspectManifest(manifest,bytes,ranges):missingCredential();
  return {format:'PNG',text:'',forensics:{width,height,chunks},provenance};
}

export async function jpeg(bytes){
  const v=view(bytes),segments={},groups=new Map(),ranges=[];
  let i=2,width=null,height=null,sawScan=false;
  while(i<bytes.length){
    if(bytes[i++]!==255)throw new Error('Invalid JPEG marker');
    while(bytes[i]===255)i++;
    const marker=bytes[i++];
    if(marker===0xd9)break;
    if(marker===1||marker>=0xd0&&marker<=0xd7)continue;
    const begin=i-2,len=v.getUint16(i),end=i+len;
    if(len<2||end>bytes.length)throw new Error('Truncated JPEG segment');
    const type=marker>=0xe0&&marker<=0xef?'APP'+(marker-0xe0):'0x'+marker.toString(16).toUpperCase();
    add(segments,type);
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){
      if(len<8)throw new Error('Invalid JPEG frame');height=v.getUint16(i+3);width=v.getUint16(i+5);
    }
    if(marker===0xeb&&len>=18&&v.getUint16(i+2)===0x4a50){
      const id=v.getUint16(i+4),seq=v.getUint32(i+6);
      const g=groups.get(id)||{parts:[],ranges:[]};
      if(g.parts.length>512||seq!==g.parts.length+1)throw new Error('Invalid JUMBF segment sequence');
      if(ascii(bytes.subarray(i+14,i+18))==='jumb'){
        g.parts.push(bytes.subarray(i+(seq===1?10:18),end));g.ranges.push([begin,end]);groups.set(id,g);
      }
    }
    if(marker===0xda){sawScan=true;break}i=end;
  }
  if(!sawScan||!width||!height)throw new Error('Incomplete JPEG');
  let provenance=missingCredential();
  for(const g of groups.values()){
    for(const range of g.ranges){if(ranges.length&&ranges.at(-1)[1]===range[0])ranges.at(-1)[1]=range[1];else ranges.push(range.slice())}
    const result=await inspectManifest(join(g.parts),bytes,ranges);
    if(result.status!=='non_c2pa_container'){provenance=result;break}
    ranges.length=0;
  }
  return {format:'JPEG',text:'',forensics:{width,height,headerSegments:segments,scope:'before_first_scan'},provenance};
}
