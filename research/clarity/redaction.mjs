import {delta,maskPII} from '../../src/privacy.mjs';
export const PRIVACY_VERSION=3;

// Each piece points to the exact insertion which introduced its UTF-16 units.
// Editing one origin also masks those units in every replay frame that inherited them.
class Origins{
 constructor(events){
  this.pieces=[];
  events.forEach((event,index)=>this.add(event,index));
 }
 boundary(position){
  let offset=0;
  for(let i=0;i<this.pieces.length;i++){
   const p=this.pieces[i];
   if(position===offset)return i;
   if(position<offset+p.length){
    const cut=position-offset;
    this.pieces.splice(i+1,0,{index:p.index,start:p.start+cut,length:p.length-cut});
    p.length=cut;return i+1;
   }
   offset+=p.length;
  }
  return this.pieces.length;
 }
 add(change,index){
  const a=this.boundary(change.start),b=this.boundary(change.start+change.remove);
  const inserted=change.insert.length?[{index,start:0,length:change.insert.length}]:[];
  this.pieces.splice(a,b-a,...inserted);
 }
 scrub(events,ranges){
  const edits=new Map();let offset=0,k=0;
  for(const p of this.pieces){
   const end=offset+p.length;
   while(k<ranges.length&&ranges[k][1]<=offset)k++;
   for(let j=k;j<ranges.length&&ranges[j][0]<end;j++){
    if(!edits.has(p.index))edits.set(p.index,[]);
    edits.get(p.index).push([p.start+Math.max(0,ranges[j][0]-offset),p.start+Math.min(p.length,ranges[j][1]-offset)]);
   }
   if(k===ranges.length)break;
   offset=end;
  }
  for(const [index,segments] of edits)events[index].insert=maskRanges(events[index].insert,segments);
 }
}
function maskRanges(text,ranges){
 const parts=[];let end=0;
 for(const [from,to] of ranges){
  parts.push(text.slice(end,from),text.slice(from,to).replace(/\S/g,'█'));end=to;
 }
 parts.push(text.slice(end));return parts.join('');
}
function pushRange(list,pos){
 const tail=list[list.length-1];
 if(tail?.[1]===pos)tail[1]++;
 else list.push([pos,pos+1]);
}
function ranges(before,raw,masked,legacy,kind,alignment){
 const back=[],sticky=[];
 if(!before.includes('█')&&!masked.includes('█'))return {back,sticky};
 // Equal prefixes/suffixes retain their character provenance. A blocked unit is
 // a wildcard only within a non-whitespace token, including after partial deletion.
 const equal=(a,b)=>a===b||(a==='█'&&/\S/.test(b))||(legacy&&b==='█'&&/\S/.test(a));
 const n=Math.min(before.length,raw.length);let left=0,right=0;
 while(left<n&&equal(alignment[left],raw[left]))left++;
 while(right<n-left&&equal(alignment[alignment.length-1-right],raw[raw.length-1-right]))right++;
 const record=(i,j)=>{
  if(masked[j]==='█' && before[i]!=='█' && /\S/.test(before[i]))pushRange(back,i);
  else if(before[i]==='█'&&masked[j]!=='█'&&/\S/.test(masked[j]))pushRange(sticky,j);
 };
 for(let i=0;i<left;i++)record(i,i);
 for(let i=0;i<right;i++)record(before.length-right+i,raw.length-right+i);
 // A short edit inside an already blocked token should not reveal the newly
 // inserted characters if its altered spelling no longer matches the detector.
 if(kind==='type'&&left>0&&right>0&&before[left-1]==='█'&&before[before.length-right]==='█'){
  for(let j=left;j<raw.length-right;j++)if(/\S/.test(masked[j])&&masked[j]!=='█')pushRange(sticky,j);
  sticky.sort((a,b)=>a[0]-b[0]);
 }
 return {back,sticky};
}
export function writer(state){
 let origins=null,canonical=false,previousInput=null;
 return {
  append(raw,meta,legacy=false,keepEvent=legacy){
   const masked=maskPII(raw);
   // Within the batch, raw adjacent inputs establish exact character ancestry.
   // The previous input is kept only in this request's memory.
   const {back,sticky}=ranges(state.text,raw,masked,legacy,meta.kind,previousInput??state.text);
   previousInput=raw;
   if(back.length){
    origins ||= new Origins(state.events);
    origins.scrub(state.events,back);
    state.text=maskRanges(state.text,back);
    canonical=true;
   }
   if(sticky.length)canonical=true;
   const next=sticky.length?maskRanges(masked,sticky):masked;
   const change=delta(state.text,next);
   if(!change.remove&&!change.insert&&!keepEvent)return;
   // Existing event metadata can be replayed without storing its original string.
   const event={...change,kind:meta.kind,bulk:meta.bulk??(meta.kind==='paste'&&change.insert.length>=40),at:meta.at,activeMs:meta.activeMs};
   origins?.add(event,state.events.length);
   state.events.push(event);state.text=next;state.activeMs+=event.activeMs;
  },
  requiresCanonical:()=>canonical
 };
}
// Existing rows can contain a newly recognized identifier only in an older
// frame. Replay every delta once under the current policy, including rows
// whose previous policy never emitted a block mask.
export function upgradeHistory(old){
 if(old.privacyVersion>=PRIVACY_VERSION)return null;
 const state={...old,text:'',events:[],activeMs:0,privacyVersion:PRIVACY_VERSION};
 const w=writer(state);let original='';
 for(const e of old.events){
  original=original.slice(0,e.start)+e.insert+original.slice(e.start+e.remove);
  w.append(original,e,(old.privacyVersion??1)<2,true);
 }
 return state;
}
