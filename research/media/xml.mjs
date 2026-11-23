import sax from './vendor/sax.mjs';
export const wordURI=/^http:\/\/(?:schemas\.openxmlformats\.org\/wordprocessingml\/2006\/main|purl\.oclc\.org\/ooxml\/wordprocessingml\/main)$/;

export function readXML(bytes,handlers){
  const enc=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  const xml=new TextDecoder(enc,{fatal:true}).decode(bytes);
  const parser=sax.parser(true,{xmlns:true,strictEntities:true});
  const stack=[];
  parser.ondoctype=()=>{throw new Error('DTD unsupported in document XML')};
  parser.onopentag=n=>{
    if(stack.length>128) throw new Error('XML nesting limit');
    const attrs=Object.create(null);
    for(const v of Object.values(n.attributes)){if(v.prefix!=='xmlns')attrs[v.local]=v.value;}
    const node={name:n.local,uri:n.uri,a:attrs};
    stack.push(node); handlers.open?.(node,stack);
  };
  parser.ontext=t=>handlers.text?.(t,stack.at(-1),stack);
  parser.oncdata=parser.ontext;
  parser.onclosetag=()=>{handlers.close?.(stack.at(-1),stack);stack.pop()};
  parser.write(xml).close();
}

export function readProperties(bytes,allowed){
  const out={};
  if(bytes)readXML(bytes,{text:(t,n,stack)=>{
    if(stack.length===2 && allowed.includes(n.name))out[n.name]=((out[n.name]||'')+t).slice(0,180);
  }});
  return out;
}

export const onProperty=value=>!['0','false','off'].includes(String(value).toLowerCase());
export function readVisibility(node,props){
  if(node.name==='vanish')props.hidden=onProperty(node.a.val);
  if(node.name!=='color')return;
  const {val,themeColor}=node.a;
  if(val==='auto'||themeColor)props.white=false;
  else if(/^[a-f0-9]{6}$/i.test(val||''))props.white=val.toUpperCase()==='FFFFFF';
}

export function wordXML(bytes,styleVisibility=()=>({hidden:false,white:false})){
  const fonts=new Set(), colors=new Set(), rsids=new Set(), paraIds=new Set();
  const pageSizes=[], paragraphs=[];
  let paragraph=[], paragraphStyle, run=null, inserted=0,deleted=0,hidden=0,white=0,lines=0;
  readXML(bytes,{
    open:(n,s)=>{
      if(!wordURI.test(n.uri))return;
      const {name,a}=n;
      // The previous formatting stored inside a tracked property change is not active.
      if(s.some(item=>wordURI.test(item.uri)&&['rPrChange','pPrChange'].includes(item.name)))return;
      for(const [key,value] of Object.entries(a)) if(/^rsid/i.test(key))rsids.add(value);
      if(name==='p'){paragraph=[];paragraphStyle=undefined;if(a.paraId)paraIds.add(a.paraId);lines++;}
      if(name==='pStyle'&&s.at(-2)?.name==='pPr')paragraphStyle=a.val;
      if(name==='r')run={chunks:[],excluded:s.some(item=>wordURI.test(item.uri)&&['del','moveFrom'].includes(item.name))};
      if(name==='rStyle'&&run&&s.at(-2)?.name==='rPr')run.style=a.val;
      if(name==='ins')inserted++;
      if(name==='del')deleted++;
      if(run&&s.at(-2)?.name==='rPr')readVisibility(n,run);
      if(name==='rFonts')for(const k of ['ascii','hAnsi','eastAsia','cs'])if(a[k])fonts.add(a[k].slice(0,100));
      if(name==='color'&&a.val&&/^[a-f\d]{6}$/i.test(a.val)){
        colors.add('#'+a.val.toUpperCase());
      }
      if(name==='pgSz'&&/^\d+$/.test(a.w)&&/^\d+$/.test(a.h)&&pageSizes.length<24)pageSizes.push({widthMm:+(Number(a.w)*25.4/1440).toFixed(2),heightMm:+(Number(a.h)*25.4/1440).toFixed(2)});
      if(run&&['br','tab','cr'].includes(name))run.chunks.push(name==='tab'?'\t':'\n');
    },
    text:(t,n)=>{if(run&&n&&wordURI.test(n.uri)&&n.name==='t')run.chunks.push(t)},
    close:n=>{
      if(!wordURI.test(n.uri))return;
      if(n.name==='r'&&run){
        const value=run.chunks.join('');
        if(!run.excluded){
          const inherited=styleVisibility(paragraphStyle,run.style);
          const isHidden=run.hidden??inherited.hidden,isWhite=run.white??inherited.white;
          if(value.trim()&&isHidden)hidden++;
          if(value.trim()&&isWhite)white++;
          if(!isHidden&&!isWhite)paragraph.push(value);
        }
        run=null;
      }
      if(n.name==='p')paragraphs.push(paragraph.join(''));
    }
  });
  return {text:paragraphs.join('\n'),data:{paragraphCount:lines,trackedInsertions:inserted,trackedDeletions:deleted,hiddenTextRuns:hidden,whiteTextRuns:white,
    rsidDiversity:rsids.size,paraIdDiversity:paraIds.size,pageSizes,fonts:[...fonts].slice(0,64),hexColors:[...colors].slice(0,128)}};
}
