import {readXML,wordURI,readVisibility,onProperty} from './xml.mjs';

const defaultsOnly=()=>({hidden:false,white:false});
const unstyled={toggle:false};
const styleCache=new Map();
export async function visibilityStyles(bytes){
  if(!bytes)return defaultsOnly;
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const key=Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');
  if(styleCache.has(key))return styleCache.get(key);
  const styles=new Map(),defaults={},baseStyle={};
  let active;
  readXML(bytes,{
    open(node,stack){
      if(!wordURI.test(node.uri))return;
      const {name,a}=node;
      const parent=stack.at(-2)?.name,grand=stack.at(-3)?.name;
      if(name==='style'){
        active=null;
        if(['character','paragraph'].includes(a.type)&&a.styleId){
          active={props:{},type:a.type};
          styles.set(a.styleId,active);
          if(a.default!==undefined&&onProperty(a.default))baseStyle[a.type]=a.styleId;
        }
      }else if(name==='basedOn'&&parent==='style'&&active)active.parent=a.val;
      else if(parent==='rPr'&&grand==='rPrDefault')readVisibility(node,defaults);
      else if(parent==='rPr'&&grand==='style'&&active)readVisibility(node,active.props);
    },
    close(node){if(node.name==='style'&&wordURI.test(node.uri))active=null;}
  });
  const resolved=new Map();
  function style(id,type){
    if(!id||styles.get(id)?.type!==type)return unstyled;
    const cacheKey=type+'|'+id;
    if(resolved.has(cacheKey))return resolved.get(cacheKey);
    const chain=[],seen=new Set();
    for(let item=styles.get(id);item?.type===type&&!seen.has(item);item=styles.get(item.parent)){
      chain.push(item);seen.add(item);
    }
    const result={toggle:false};
    for(const {props} of chain.reverse()){
      if(props.hidden)result.toggle=!result.toggle;
      if(props.white!==undefined)result.white=props.white;
    }
    resolved.set(cacheKey,result);return result;
  }
  function resolve(para,char){
    const p=style(para||baseStyle.paragraph,'paragraph'),c=style(char||baseStyle.character,'character');
    let hidden=Boolean(defaults.hidden);
    if(p.toggle)hidden=!hidden;
    if(c.toggle)hidden=!hidden;
    return {hidden,white:c.white??p.white??defaults.white??false};
  }
  if(styleCache.size>=4)styleCache.delete(styleCache.keys().next().value);
  styleCache.set(key,resolve);return resolve;
}
