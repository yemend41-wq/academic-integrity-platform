import {maskPII,delta} from '../../src/privacy.mjs';
const bytes=new TextEncoder();
export function boundedBatch(events){
  const batch=[];let size=256;
  for(const event of events){
    const cost=bytes.encode(JSON.stringify(event)).length+1;
    if(batch.length && (batch.length>=50||size+cost>800000))break;
    if(size+cost>900000)throw new Error('draft_history_limit');
    batch.push(event);size+=cost;
  }
  return batch;
}
export function editKind(inputType,pasting=false){
  if(pasting||/Paste|Drop/i.test(inputType))return 'paste';
  if(/^delete/i.test(inputType))return 'delete';
  if(/replacement|history|composition/i.test(inputType))return 'replace';
  return 'type';
}
// Time between nearby gestures contributes while focused. An idle gap contributes no time.
export function activeInterval(last,current){
  const gap=current-last;
  return last!==null && gap>=0 && gap<=15000? Math.round(gap):0;
}
export function projectEvents(base,events){
  let current=base;const changes=[];
  for(const edit of events){
    const next=maskPII(edit.text),change=delta(current,next);
    if(change.remove||change.insert)changes.push({...change,kind:edit.type,bulk:edit.type==='paste'&&change.insert.length>=40,activeMs:Math.round(Math.min(15000,Math.max(0,Number(edit.activeMs)||0)))});
    current=next;
  }
  return {text:current,changes};
}
const same=(a,b)=>['start','remove','insert','kind','bulk','activeMs'].every(k=>a[k]===b[k]);
export function reconciles(base,remote,events,editId){
  if(remote.revision!==base.revision+1)return false;
  if(editId && remote.lastEditId)return remote.lastEditId===editId;
  const {changes,text}=projectEvents(base.text,events);
  if(remote.text!==text||remote.events.length!==base.events.length+changes.length)return false;
  return changes.every((change,i)=>same(change,remote.events[base.events.length+i])) && base.events.every((e,i)=>same(e,remote.events[i]));
}
function apply(text,e){return text.slice(0,e.start)+e.insert+text.slice(e.start+e.remove);}
export function timeline(events){
  const checkpoints=[''];let current='';
  events.forEach((e,i)=>{current=apply(current,e);if((i+1)%48===0)checkpoints.push(current);});
  return function revision(index){
    const capped=Math.min(events.length,Math.max(0,Math.trunc(index)||0)),block=Math.floor(capped/48);
    let output=checkpoints[block];
    for(let i=block*48;i<capped;i++)output=apply(output,events[i]);
    return output;
  };
}
