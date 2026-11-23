import {activeInterval,boundedBatch,editKind,projectEvents,reconciles,timeline} from './history.mjs';
const messages={
  en:{title:'Writing space',input:'Draft',write:'Start writing here…',time:'Active writing',entries:'Recorded edits',paste:'Bulk pastes',save:'Save now',submit:'Analyze draft',history:'Revision playback',frame:'Revision',play:'Play',pause:'Pause',saved:'Saved',saving:'Saving…',pending:'Unsaved changes',offline:'Changes are still in this tab. Retry saving.',conflict:'Another session saved a revision. Compare the drafts before continuing.',local:'Use my current draft',remote:'Use the saved draft',remoteLabel:'Other session’s saved draft',empty:'Write something before submitting.',retry:'Retry',load:'Loading your draft…',loadfail:'Your draft could not be loaded.',submitting:'Analyzing…',first:'Empty draft',seconds:'s',event:{type:'Typing',replace:'Replaced text',delete:'Deleted text',paste:'Pasted text'},bulk:'Bulk paste',history_limit:'Draft history is full. Copy your current draft before leaving.',timer:'Active time counts intervals of up to 15 seconds between writing actions.',initial:'Revision 0',word:'Words',failed:'Submission failed. Your saved draft is available.'},
  ar:{title:'مساحة الكتابة',input:'المسودة',write:'ابدأ الكتابة هنا…',time:'وقت الكتابة الفعلي',entries:'التعديلات المسجلة',paste:'عمليات اللصق الكبيرة',save:'حفظ الآن',submit:'تحليل المسودة',history:'سجل المراجعات',frame:'المراجعة',play:'تشغيل',pause:'إيقاف مؤقت',saved:'محفوظ',saving:'جارٍ الحفظ…',pending:'تغييرات بانتظار الحفظ',offline:'تغييراتك محفوظة مؤقتًا في هذه الصفحة. أعد محاولة الحفظ.',conflict:'حفظت جلسة أخرى نسخة أحدث. راجع المسودتين قبل المتابعة.',local:'اعتماد مسودتي الحالية',remote:'اعتماد النسخة المحفوظة',remoteLabel:'المسودة المحفوظة في الجلسة الأخرى',empty:'اكتب نصًا قبل إرسال المسودة.',retry:'إعادة المحاولة',load:'جارٍ فتح المسودة…',loadfail:'تعذّر فتح مسودتك.',submitting:'جارٍ التحليل…',first:'المسودة فارغة',seconds:'ث',event:{type:'كتابة',replace:'استبدال نص',delete:'حذف نص',paste:'لصق نص'},bulk:'لصق كبير',history_limit:'بلغ سجل الكتابة سعته القصوى. انسخ المسودة الحالية قبل المغادرة.',timer:'يحسب المؤقّت الفواصل التي لا تتجاوز ١٥ ثانية بين إجراءات الكتابة.',initial:'المراجعة ٠',word:'الكلمات',failed:'تعذّر التحليل. مسودتك المحفوظة متاحة.'}
};
function control(tag,props={},children=[]){
 const el=document.createElement(tag);
 for(const [k,v] of Object.entries(props)){if(k==='text')el.textContent=v;else if(k==='class')el.className=v;else el.setAttribute(k,v);}
 el.append(...children);return el;
}

const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export async function mountClarity(container,ctx){
 const l=messages[ctx.ar?'ar':'en'],formatter=new Intl.NumberFormat(ctx.ar?'ar':'en'),num=n=>formatter.format(n);
 const node=(tag,props,children)=>control(tag,props,children);
 const button=(text,action,cls)=>{const b=node('button',{type:'button',text,class:cls||''});b.onclick=action;return b;};
 const root=node('section',{class:'clarity-pane',dir:ctx.ar?'rtl':'ltr','aria-label':l.title});
 const status=node('p',{role:'status','aria-live':'polite',text:l.load});
 root.append(node('h2',{text:l.title}),status);
 container.replaceChildren(root);
 let state={revision:0,text:'',events:[],activeMs:0},queued=[],retryBatch=null,running=null,conflicted=null,closed=false,timer=0,firstPending=0,playTimer=0,last=null,pasting=false,submitting=false,loaded=false,failed=false,detachEvents=()=>{};
 let atFrame=0,rebuild=timeline([]),submitButton,saveButton;
 const area=node('textarea',{maxlength:'90000',dir:'auto',placeholder:l.write,spellcheck:'true'});
 const range=node('input',{type:'range',min:'0',max:'0',value:'0',step:'1','aria-label':l.frame});
 const frame=node('span'), preview=node('div',{class:'clarity-preview',dir:'auto',role:'region','aria-label':l.frame});
 const conflictText=node('pre',{class:'clarity-preview',dir:'auto'}),conflictPanel=node('div',{class:'clarity-conflict',hidden:''});
 const stats={},statRow=node('div',{class:'clarity-stats'});
 for(const [key,label] of [['word',l.word],['time',l.time],['entries',l.entries],['paste',l.paste]]){
  stats[key]=node('strong',{text:num(0)});statRow.append(node('span',{},[stats[key],node('span',{text:label})]));
 }
 const play=button(l.play,()=>{
  if(playTimer){stopPlay();return;}
  if(!state.events.length)return;
  if(atFrame===state.events.length)show(0);
  play.textContent=l.pause;
  playTimer=setInterval(()=>{show(atFrame+1);if(atFrame===state.events.length)stopPlay();},550);
 });
 function stopPlay(){clearInterval(playTimer);playTimer=0;play.textContent=l.play;}
 function show(n){
  atFrame=Math.max(0,Math.min(n,state.events.length));range.value=String(atFrame);
  const e=state.events[atFrame-1],kind=e?(e.bulk?l.bulk:l.event[e.kind]||e.kind):l.first;
  frame.textContent=l.frame+' '+num(atFrame)+' / '+num(state.events.length)+' · '+kind;
  range.setAttribute('aria-valuetext',frame.textContent);preview.textContent=rebuild(atFrame)||'—';
 }
 range.addEventListener('input',()=>{stopPlay();show(Number(range.value));});
 function statsUpdate(){
  stats.word.textContent=num((area.value.match(/[\p{L}\p{N}]+/gu)||[]).length);
  stats.time.textContent=num(Math.floor((state.activeMs+queued.reduce((s,e)=>s+e.activeMs,0))/1000))+' '+l.seconds;
  stats.entries.textContent=num(state.events.length);
  stats.paste.textContent=num(state.events.filter(e=>e.bulk).length);
  saveButton.disabled=submitting||!!conflicted||!queued.length;
  submitButton.disabled=submitting||!!conflicted||!area.value.trim();
 }
 function updateTimeline(follow){
  rebuild=timeline(state.events);range.max=String(state.events.length);range.disabled=!state.events.length;play.disabled=!state.events.length;
  show(follow?state.events.length:atFrame);statsUpdate();
 }
 function changeStatus(value){if(status.textContent!==value)status.textContent=value;}
 function schedule(delay=850){
  clearTimeout(timer);
  if(closed||conflicted)return;
  // Continuous typing must not postpone the first remote save indefinitely.
  if(delay===850){const t=performance.now();if(!firstPending)firstPending=t;delay=Math.min(delay,Math.max(0,2500-t+firstPending));}
  timer=setTimeout(()=>{void flush();},delay);
 }
 function acceptBatch(batch,reply){
  const projection=projectEvents(state.text,batch),follow=atFrame===state.events.length;
  state={revision:reply.revision,text:projection.text,activeMs:reply.activeMs,events:[...state.events,...projection.changes]};
  queued.splice(0,batch.length);retryBatch=null;updateTimeline(follow);
 }
 async function transmit(){
  while(queued.length&&!conflicted){
   const batch=retryBatch||boundedBatch(queued);retryBatch=batch;batch.editId ||= crypto.randomUUID();changeStatus(l.saving);
   try{
    const reply=await ctx.api('/api/draft',post({revision:state.revision,editId:batch.editId,events:batch.map(({text,type,activeMs})=>({text,type,activeMs}))}));
    if(reply.historyRewritten){
     // Drop stale playback immediately; past cells may now be private.
     const follow=atFrame===state.events.length;
     stopPlay();preview.textContent='';rebuild=()=>'';range.disabled=true;play.disabled=true;
     const canonical=await ctx.api('/api/draft');
     if(canonical.revision>reply.revision&&queued.length>batch.length){
      queued.splice(0,batch.length);retryBatch=null;enterConflict(canonical);return false;
     }
     state=canonical;queued.splice(0,batch.length);retryBatch=null;
     if(canonical.revision>reply.revision&&!queued.length)area.value=canonical.text;
     updateTimeline(follow);
    }else acceptBatch(batch,reply);
   }catch(err){
    if(err?.status===409||/draft_conflict|\b409\b/.test(String(err?.code||err?.message||err))){
     const remote=await ctx.api('/api/draft');
     if(reconciles(state,remote,batch,batch.editId)){const follow=atFrame===state.events.length;state=remote;queued.splice(0,batch.length);retryBatch=null;updateTimeline(follow);continue;}
     enterConflict(remote);return false;
    }
    throw err;
   }
  }
  if(!conflicted){changeStatus(l.saved);return true;}
  return false;
 }
 function flush(){
  clearTimeout(timer);firstPending=0;
  if(running)return running;
  if(conflicted)return Promise.resolve(false);
  running=transmit().catch(err=>{
   const full=/draft_history_limit|\b413\b/.test(String(err?.code||err?.message||err));
   changeStatus(full?l.history_limit:l.offline);statsUpdate();
   if(!full&&queued.length)schedule(5000);
   return false;
  }).finally(()=>{running=null;});
  return running;
 }
 function enterConflict(remote){
  const follow=atFrame===state.events.length;
  conflicted=remote;state=remote;conflictText.textContent=remote.text||'—';conflictPanel.hidden=false;area.readOnly=true;
  updateTimeline(follow);changeStatus(l.conflict);
 }
 function resolve(useLocal){
  const text=area.value;state=conflicted;conflicted=null;conflictPanel.hidden=true;area.readOnly=false;
  queued=[];retryBatch=null;area.value=useLocal?text:state.text;
  if(useLocal&&text!==state.text)queued.push({type:'replace',text,activeMs:0});
  updateTimeline(true);changeStatus(queued.length?l.pending:l.saved);if(queued.length)schedule(0);
 }
 conflictPanel.append(node('strong',{text:l.conflict}),node('span',{text:l.remoteLabel}),conflictText,node('div',{class:'clarity-controls'},[button(l.local,()=>resolve(true)),button(l.remote,()=>resolve(false))]));
 async function submit(){
  if(submitting||!area.value.trim()){if(!area.value.trim())changeStatus(l.empty);return;}
  submitting=true;area.readOnly=true;statsUpdate();
  try{
   if(!await flush())return;
   changeStatus(l.submitting);
   const report=await ctx.api('/api/draft/submit',post({revision:state.revision}));
   changeStatus(l.saved);await ctx.onReport(report);
  }catch{ctx.notify(l.failed);changeStatus(l.failed);}
  finally{submitting=false;area.readOnly=!!conflicted;statsUpdate();}
 }
 saveButton=button(l.save,()=>void flush());submitButton=button(l.submit,()=>void submit(),'primary');
 function attach(){
  area.addEventListener('focus',()=>{last=performance.now();});
  area.addEventListener('blur',()=>{last=null;if(queued.length)void flush();});
  area.addEventListener('paste',()=>{pasting=true;setTimeout(()=>{pasting=false;},0);});
  area.addEventListener('input',e=>{
   const t=performance.now(),type=editKind(e.inputType||'',pasting),interval=activeInterval(last,t);
   last=t;pasting=false;
   const event={type,text:area.value,activeMs:interval};
   // Coalesce adjacent keystrokes for up to 600 ms; preserve explicit pastes/deletes and any in-flight batch.
   const tail=queued[queued.length-1];
   if(type==='type'&&tail?.type==='type'&&!running&&(!retryBatch||!retryBatch.includes(tail))&&t-tail.observed<=600&&tail.activeMs+interval<=15000){
    tail.text=event.text;tail.activeMs+=interval;tail.observed=t;
   }else queued.push({...event,observed:t});
   changeStatus(l.pending);statsUpdate();schedule();
  });
  const onLeave=e=>{if(queued.length){e.preventDefault();e.returnValue='';}};
  const onVisibility=()=>{if(document.visibilityState==='hidden'){last=null;if(queued.length)void flush();}};
  const onOnline=()=>{if(queued.length)schedule(0);};
  window.addEventListener('beforeunload',onLeave);window.addEventListener('online',onOnline);document.addEventListener('visibilitychange',onVisibility);
  detachEvents=()=>{window.removeEventListener('beforeunload',onLeave);window.removeEventListener('online',onOnline);document.removeEventListener('visibilitychange',onVisibility);};
 }
 async function initialize(){
  failed=false;changeStatus(l.load);
  try{state=await ctx.api('/api/draft');if(closed)return;loaded=true;area.value=state.text;
   root.append(statRow,node('label',{text:l.input},[area]),node('p',{class:'clarity-note',text:l.timer}),node('div',{class:'clarity-controls'},[saveButton,submitButton]),conflictPanel,node('section',{class:'clarity-history'},[node('h3',{text:l.history}),node('div',{class:'clarity-controls'},[play,range,frame]),preview]));
   attach();updateTimeline(true);changeStatus(l.saved);
  }catch{failed=true;changeStatus(l.loadfail);const retry=button(l.retry,()=>{retry.remove();void initialize();});root.append(retry);}
 }
 await initialize();
 return async function unmount(){
  if(closed)return true;
  if(loaded&&!failed&&queued.length && !await flush())return false;
  clearTimeout(timer);stopPlay();detachEvents();closed=true;
  return true;
 };
}
