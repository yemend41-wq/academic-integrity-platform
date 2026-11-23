const utf8=new TextDecoder();
const txt=b=>utf8.decode(b);
const byteHex=b=>[...b].map(v=>v.toString(16).padStart(2,'0')).join('');
export function join(parts){
  let n=0; for(const part of parts)n+=part.length;
  const out=new Uint8Array(n);
  let i=0;for(const part of parts){out.set(part,i);i+=part.length}
  return out;
}

function uint(bytes,i,count){
  if(i<0||i+count>bytes.length)throw new Error('Truncated integer');
  let result=0;for(let n=0;n<count;n++)result=result*256+bytes[i+n];
  if(!Number.isSafeInteger(result))throw new Error('Integer exceeds range');
  return result;
}

function readCBOR(bytes){
  let i=0,count=0;
  function read(depth){
    if(depth>28 || ++count>18000||i>=bytes.length)throw new Error('CBOR bounds');
    const header=bytes[i++],major=header>>>5, a=header&31;
    if(major===7 && a>=20 && a<=23)return [false,true,null,undefined][a-20];
    if(a===31&&[4,5].includes(major)){
      const result=major===4?[]:new Map();
      while(bytes[i]!==255){
        const k=read(depth+1);
        if(major===4)result.push(k);
        else{if(result.has(k))throw new Error('Duplicate CBOR key');result.set(k,read(depth+1))}
      }
      i++;return result;
    }
    if(a>=28)throw new Error('Unsupported CBOR type');
    const size=a<24?0:2**(a-24), n=size?uint(bytes,i,size):a;i+=size;
    if(major===0)return n;
    if(major===1)return -1-n;
    if(major===2||major===3){
      if(i+n>bytes.length)throw new Error('CBOR bounds');
      const part=bytes.subarray(i,i+n);i+=n;return major===2?part:txt(part);
    }
    if(major===6)return read(depth+1);
    if(n>10000)throw new Error('CBOR collection too large');
    if(major===4)return Array.from({length:n},()=>read(depth+1));
    if(major===5){
      const result=new Map();
      for(let j=0;j<n;j++){const k=read(depth+1);if(result.has(k))throw new Error('Duplicate CBOR key');result.set(k,read(depth+1))}
      return result;
    }
    throw new Error('Unsupported CBOR value');
  }
  const result=read(0);if(i!==bytes.length)throw new Error('Extra CBOR data');
  return result;
}

function boxes(bytes,depth=0,state={n:0}){
  const result=[];
  for(let i=0;i<bytes.length;){
    if(depth>14||++state.n>1500||bytes.length-i<8)throw new Error('JUMBF framing invalid');
    let size=uint(bytes,i,4),header=8;const type=txt(bytes.subarray(i+4,i+8));
    if(size===1){size=uint(bytes,i+8,8);header=16}
    if(size===0)size=bytes.length-i;
    if(size<header||size>bytes.length-i)throw new Error('JUMBF size invalid');
    const content=bytes.subarray(i+header,i+size);
    const box={type,content};
    if(type==='jumb'){
      box.children=boxes(content,depth+1,state);
      const desc=box.children[0];
      if(desc?.type==='jumd'&&desc.content.length>=17){
        box.uuid=byteHex(desc.content.subarray(0,16));
        if(desc.content[16]&2){const end=desc.content.indexOf(0,17);if(end>16)box.label=txt(desc.content.subarray(17,end));}
      }
    }
    result.push(box);i+=size;
  }
  return result;
}

function children(box){return (box?.children||[]).filter(b=>b.type==='jumb')}
function cbor(box){const b=box?.children?.find(b=>b.type==='cbor');return b?.content}
function digestName(n){return {sha256:'SHA-256',sha384:'SHA-384',sha512:'SHA-512'}[n]}
async function matches(alg,data,expected){
  if(!digestName(alg)||!(expected instanceof Uint8Array))return 'unsupported';
  return byteHex(new Uint8Array(await crypto.subtle.digest(digestName(alg),data)))===byteHex(expected)?'match':'mismatch';
}
function tlv(b,pos){
  if(pos>=b.length)throw new Error('Invalid DER');
  const start=pos,tag=b[pos++];let s=b[pos++];
  if(s&128){const n=s&127;if(n<1||n>4)throw new Error('Invalid DER');s=uint(b,pos,n);pos+=n}
  if(pos+s>b.length)throw new Error('Truncated DER');return {tag,start,pos,end:pos+s};
}
function leafKey(cert){
  const der=tlv(cert,0),tbs=tlv(cert,der.pos);let pos=tbs.pos;
  if(cert[pos]===160)pos=tlv(cert,pos).end;
  for(let i=0;i<5;i++)pos=tlv(cert,pos).end;
  const key=tlv(cert,pos);
  if(key.tag!==48)throw new Error('Invalid SubjectPublicKeyInfo');
  return cert.subarray(key.start,key.end);
}
function byteString(b){
  const n=b.length;
  return join([n<24?Uint8Array.of(64+n):n<=255?Uint8Array.of(88,n):n<=65535?Uint8Array.of(89,n>>>8,n):Uint8Array.of(90,n>>>24,n>>>16,n>>>8,n),b]);
}

async function verifyClaimSignature(data,claim){
  const signed=readCBOR(data);
  if(!Array.isArray(signed)||signed.length!==4||signed[2]!==null)return 'unsupported';
  const [protectedHeader,headers,,sig]=signed, p=readCBOR(protectedHeader);
  const chain=p.get(33)??headers.get(33);
  const cert=Array.isArray(chain)?chain[0]:chain;
  if(!(cert instanceof Uint8Array))return 'no_leaf_certificate';
  const alg=p.get(1);
  const choices={
    '-37':[{name:'RSA-PSS',hash:'SHA-256'},{name:'RSA-PSS',saltLength:32}],
    '-38':[{name:'RSA-PSS',hash:'SHA-384'},{name:'RSA-PSS',saltLength:48}],
    '-39':[{name:'RSA-PSS',hash:'SHA-512'},{name:'RSA-PSS',saltLength:64}],
    '-7':[{name:'ECDSA',namedCurve:'P-256'},{name:'ECDSA',hash:'SHA-256'}],
    '-35':[{name:'ECDSA',namedCurve:'P-384'},{name:'ECDSA',hash:'SHA-384'}],
    '-36':[{name:'ECDSA',namedCurve:'P-521'},{name:'ECDSA',hash:'SHA-512'}],
    '-8':[{name:'Ed25519'},{name:'Ed25519'}]
  };
  if(!choices[alg])return 'unsupported_algorithm';
  const [importAlgorithm,verifyAlgorithm]=choices[alg];
  const spki=leafKey(cert);let key;
  try{key=await crypto.subtle.importKey('spki',spki,importAlgorithm,false,['verify'])}
  catch(error){
    // WebCrypto rejects RFC 4055 id-RSASSA-PSS SPKI on some engines. Permit
    // only explicit SHA/MGF1/salt constraints matching this COSE operation.
    if(importAlgorithm.name!=='RSA-PSS')throw error;
    const outer=tlv(spki,0),algorithm=tlv(spki,outer.pos),bits=tlv(spki,algorithm.end);
    const oid=({'-37':'01','-38':'02','-39':'03'})[alg],salt=verifyAlgorithm.saltLength.toString(16);
    const params='06092a864886f70d01010a3034a00f300d06096086480165030402'+oid+'0500a11c301a06092a864886f70d010108300d06096086480165030402'+oid+'0500a2030201'+salt;
    if(byteHex(spki.subarray(algorithm.pos,algorithm.end))!==params||bits.tag!==3||spki[bits.pos]!==0)throw error;
    const rsa=tlv(spki,bits.pos+1),n=tlv(spki,rsa.pos),e=tlv(spki,n.end);
    if(rsa.tag!==48||n.tag!==2||e.tag!==2||e.end!==rsa.end)throw error;
    const integer=el=>{
      let p=el.pos;while(spki[p]===0&&p<el.end-1)p++;
      return btoa(String.fromCharCode(...spki.subarray(p,el.end))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    };
    key=await crypto.subtle.importKey('jwk',{kty:'RSA',n:integer(n),e:integer(e)},importAlgorithm,false,['verify']);
  }
  const sigInput=join([Uint8Array.of(132,106),new TextEncoder().encode('Signature1'),byteString(protectedHeader),Uint8Array.of(64),byteString(claim)]);
  return await crypto.subtle.verify(verifyAlgorithm,key,sig,sigInput)?'verified_with_embedded_leaf':'invalid';
}

async function verifyDataBinding(bytes,hashBox,containerRanges){
  const h=readCBOR(cbor(hashBox)),ranges=h.get('exclusions')||[];
  if(!Array.isArray(ranges)||ranges.length>256)return 'unsupported';
  const parts=[];let pos=0;
  for(const r of ranges){
    const start=r.get('start'),end=start+r.get('length');
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<pos||end<=start||end>bytes.length)return 'invalid_ranges';
    if(!containerRanges.some(([lo,hi])=>start>=lo&&end<=hi))return 'unverified_exclusion_scope';
    parts.push(bytes.subarray(pos,start));pos=end;
  }
  parts.push(bytes.subarray(pos));return matches(h.get('alg')||'sha256',join(parts),h.get('hash'));
}

export async function inspectManifest(manifest,asset,ranges){
  const base={status:'container_unreadable',signature:'not_checked',assetBinding:'not_checked',assertionHashes:'not_checked',trust:'not_evaluated'};
  try{
    const root=boxes(manifest)[0];
    if(root?.uuid!=='6332706100110010800000aa00389b71'||root.label!=='c2pa')return {...base,status:'non_c2pa_container'};
    const manifests=children(root).filter(b=>['63326d6100110010800000aa00389b71','6332756d00110010800000aa00389b71'].includes(b.uuid));
    if(!manifests.length)return base;
    const active=manifests.at(-1),components=children(active),claimBox=components.find(b=>/^c2pa\.claim(?:\.v\d+)?$/.test(b.label)),
      sigBox=components.find(b=>b.label==='c2pa.signature'),store=components.find(b=>b.label==='c2pa.assertions');
    const claimBytes=cbor(claimBox),claim=readCBOR(claimBytes);
    const assertions=children(store);
    Object.assign(base,{status:'manifest_read',manifestCount:manifests.length,assertions:assertions.map(b=>b.label).filter(Boolean).slice(0,64)});
    const sigRef=claim.get('signature');
    if(typeof sigRef==='string'&&/(?:^self#jumbf=|\/)c2pa\.signature$/.test(sigRef)&&cbor(sigBox)){
      try{base.signature=await verifyClaimSignature(cbor(sigBox),claimBytes)}catch{base.signature='unsupported_or_unreadable'}
    }
    const refs=claim.get('assertions')??claim.get('created_assertions')??[];
    const allRefs=[...refs,...(claim.get('gathered_assertions')||[])];
    const verifiedBoxes=new Set(),results=[];
    for(const ref of allRefs){
      const url=ref.get('url');
      const name=typeof url==='string'&&url.match(/(?:^self#jumbf=|\/)c2pa\.assertions\/([^/]+)$/)?.[1];
      const box=assertions.find(b=>b.label===name);
      const check=box?await matches(ref.get('alg')||claim.get('alg')||'sha256',box.content,ref.get('hash')):'reference_unresolved';
      if(check==='match')verifiedBoxes.add(box);
      results.push(check);
    }
    base.assertionHashes=results.length?(results.every(r=>r==='match')?'match':results.find(r=>r!=='match')):'not_checked';
    const assetHash=assertions.find(b=>/^c2pa\.hash\.data(?:__\d+)?$/.test(b.label));
    if(assetHash&&verifiedBoxes.has(assetHash)){
      try{base.assetBinding=await verifyDataBinding(asset,assetHash,ranges)}catch{base.assetBinding='unsupported_or_unreadable'}
    }
    return base;
  }catch{return base}
}

export const missingCredential=()=>({status:'no_embedded_manifest_found',signature:'not_checked',assetBinding:'not_checked',trust:'not_evaluated'});
