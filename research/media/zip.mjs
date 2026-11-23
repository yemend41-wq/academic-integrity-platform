import {Inflate} from './vendor/inflate.mjs';

const decoder = new TextDecoder();
const maxEntry = 12 * 1024 * 1024;
const maxTotal = 32 * 1024 * 1024;
const crcTable = Array.from({length:256}, (_,i) => {
  for (let k=0;k<8;k++) i=i&1?(0xedb88320^(i>>>1)):i>>>1;
  return i>>>0;
});
export function crc32(bytes) {
  let crc=0xffffffff;
  for (const b of bytes) crc=(crc>>>8)^crcTable[(crc^b)&255];
  return (crc^0xffffffff)>>>0;
}

export function zipEntries(data) {
  const view = new DataView(data.buffer,data.byteOffset,data.byteLength);
  const u16=i=>view.getUint16(i,true), u32=i=>view.getUint32(i,true);
  let end=data.length-22;
  for (; end>=Math.max(0,data.length-65557);end--) {
    if (u32(end)===0x06054b50 && end+22+u16(end+20)===data.length) break;
  }
  if(end<Math.max(0,data.length-65557)||u16(end+4)!==0||u16(end+6)!==0) throw new Error('Invalid or multi-disk ZIP');
  const count = u16(end+10);
  if(count>2048) throw new Error('Too many ZIP entries');
  const entries = new Map();
  let pos=u32(end+16), total=0;
  for(let n=0;n<count;n++){
    if(pos+46>end || u32(pos)!==0x02014b50) throw new Error('Invalid ZIP directory');
    const flags=u16(pos+8), method=u16(pos+10), crc=u32(pos+16), comp=u32(pos+20), size=u32(pos+24);
    const pathLength=u16(pos+28), offset=u32(pos+42);
    const name=decoder.decode(data.subarray(pos+46,pos+46+pathLength));
    pos+=46+pathLength+u16(pos+30)+u16(pos+32);
    if(entries.has(name)||flags&1||size>maxEntry||(total+=size)>maxTotal) throw new Error('ZIP resource or format limit');
    entries.set(name,()=>{
      if(offset+30>data.length || u32(offset)!==0x04034b50) throw new Error('Invalid ZIP header');
      const start=offset+30+u16(offset+26)+u16(offset+28);
      if(start+comp>data.length) throw new Error('Invalid ZIP extent');
      const bytes=data.subarray(start,start+comp);
      let out;
      if(method===0) out=bytes;
      else if(method===8){
        out=new Uint8Array(size);
        let written=0;
        const inflater=new Inflate({raw:true,chunkSize:16384});
        inflater.onData=chunk=>{
          if(written+chunk.length>size) throw new Error('ZIP expanded size exceeds directory');
          out.set(chunk,written); written+=chunk.length;
        };
        inflater.push(bytes,true);
        if(inflater.err||!inflater.ended||written!==size) throw new Error('Invalid DEFLATE data');
      } else throw new Error('Unsupported ZIP method');
      if(out.length!==size||crc32(out)!==crc) throw new Error('ZIP integrity check failed');
      return out;
    });
  }
  return entries;
}
